// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @dev Suffix `V2` pada kedua interface di berkas ini BUKAN kosmetik.
 *
 * Keduanya semula bernama `IERC20Minimal` dan `IAdextoToken`, sama dengan yang
 * dideklarasikan `SovereignCurve.sol`. Aderyn menandainya sebagai "Contract Name
 * Reused in Different Files", dan itu benar: dua deklarasi bernama sama membuat
 * pencarian artifact berdasarkan NAMA jadi ambigu, sehingga skrip deploy yang meminta
 * `IERC20Minimal` bisa mengambil salah satu tanpa memberi tahu.
 *
 * Menariknya ke satu berkas bersama akan lebih rapi, tetapi itu berarti menyunting
 * `SovereignCurve.sol` — yang sengaja dibekukan supaya source di HEAD tetap cocok
 * dengan bytecode lima pasar yang hidup di 0G. Jadi yang dinamai ulang adalah berkas
 * yang belum di-deploy.
 */
interface IERC20MinimalV2 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

interface IAdextoTokenV2 {
    function executeTreasuryBuyback(uint256 amountToBurn) external;
}

/**
 * @title SovereignCurveV2
 * @notice Virtual-reserve bonding curve for ADEXTO (adexto.xyz), version 0.11.0.
 *
 * @dev WHY THIS IS A SEPARATE FILE INSTEAD OF AN EDIT TO SovereignCurve.sol
 *
 * v0.10.0 is already live: five markets on 0G mainnet reference its bytecode, and
 * all three of its fee rates are `immutable` with no setter and no admin. Editing
 * `SovereignCurve.sol` in place would leave the source at HEAD no longer matching
 * the contracts those markets actually run, so anyone verifying the live curve
 * against this repository would find a mismatch and be right to distrust it.
 *
 * So `SovereignCurve.sol` stays frozen as the source of the deployed v0.10.0
 * markets, and this file is what new launches use. The duplication is the cost of
 * having no upgrade lever, which is the property the project chose on purpose.
 *
 * Existing v0.10.0 markets never pay a protocol fee. That is not a migration
 * that is pending — it is permanent. There is no path by which ADEXTO, ADT or the
 * NOVA* markets can be made to pay one.
 *
 * WHAT CHANGED FROM v0.10.0
 *
 * One addition: a fourth fee leg, `protocolFeeBps`, accruing to `protocolOwed` and
 * claimable only to the `immutable protocolTreasury`. Everything else — the
 * pricing, the solvency proof, the permissionless payout paths, the buyback size
 * cap — is unchanged.
 *
 * The protocol leg is ADDITIVE, not carved out of the existing split. A market
 * configured as 0.30% total now charges 0.40%: depth 0.15%, creator 0.10%,
 * buyback 0.05%, protocol 0.10%. Taking it out of depth would weaken the rising
 * price floor, and taking it out of the creator's share would gut the one thing
 * that replaces a free token allocation. Both were published as they stand, so
 * neither is available to quietly reduce. Charging traders 10bps more is the
 * honest option because it is the only one visible at the point of trade.
 *
 * WHY THERE IS NO SETTER AND NO TIMELOCK
 *
 * `protocolFeeBps` and `protocolTreasury` are both `immutable`. A setter would
 * make this contract owned, which contradicts the claim on /security that nobody
 * can change the terms of a launched market — and that claim is the product. A
 * timelock is only meaningful if something is mutable, so adding one would mean
 * first adding the admin it is supposed to restrain.
 *
 * `claimProtocolFees` is callable by anyone, exactly like `claimCreatorFees`,
 * because the destination is fixed at deployment and cannot be chosen by the
 * caller. Requiring an authorised caller would add a key that can be lost, and
 * losing it would strand `protocolOwed` forever since there is no withdrawal
 * function anywhere in this contract.
 *
 * WHY THIS EXISTS
 *
 * `SovereignHook` requires a real native seed (`require(msg.value > 0)`) that can
 * never be withdrawn. Measured on Base, that seed is ~16x the launch gas cost, and
 * a multi-chain launch needs it again in every chain's native asset. That is the
 * single largest barrier to a creator launching anything.
 *
 * This contract removes the seed entirely. The native side of the curve starts as
 * a *virtual* number in storage — `virtualNative` — which sets the opening price
 * without anyone depositing money. Real native only ever arrives from buyers, and
 * sellers are only ever paid from that real native.
 *
 * PRICING
 *
 *   nativeReserve = virtualNative + curveNative      (curveNative = real, starts 0)
 *   tokenReserve  = curveTokens   - tokensSold
 *   price         = nativeReserve / tokenReserve
 *
 * Because 100% of supply enters the curve, `virtualNative` is exactly the opening
 * market capitalisation denominated in the chain's native asset.
 *
 * SOLVENCY, PROVEN RATHER THAN CHECKED
 *
 * The dangerous failure in any launchpad is a pool that promises more than it
 * holds: early sellers drain it and later sellers get reverts. That cannot happen
 * here, and not because of a runtime `if`.
 *
 * Let F be the depth fees retained so far and C_pure the native that moved along
 * the curve, so curveNative = C_pure + F. The curve relation gives
 * C_pure = V*S/(T-S). Selling every outstanding token at once (ds = S) pays
 *
 *   grossOut = (V + C_pure + F) * S / T
 *            = V*S/(T-S) + F*S/T
 *            = C_pure + F*(S/T)
 *
 * and since S <= T that is <= C_pure + F = curveNative. So even the worst case —
 * everyone selling everything — is covered exactly, with the depth fees as slack.
 * Integer division floors every payout, which can only add to that slack.
 *
 * The protocol leg does not disturb this. Like the creator and buyback legs it is
 * excluded from `curveNative` on the way in and subtracted from it on the way out,
 * so it never appears in C_pure or F. The proof is about depth fees only, and the
 * number of carve-outs alongside them does not enter it.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * No withdrawal function, no LP shares, no graduation to another pool. Migration
 * from a curve to an AMM is where most launchpad exploits live, and a permanent
 * curve keeps the "no rug lever" property the project already chose.
 *
 * FEES
 *
 * Four legs. Three of them stay inside the total the creator configured; the
 * protocol leg is added on top of it:
 *   - depth    -> stays in `curveNative`, so the price floor rises with volume
 *   - creator  -> accrues to `creatorOwed` for a locked creator address
 *   - buyback  -> accrues to `treasuryNative`, spent by `executeBuyback`
 *   - protocol -> accrues to `protocolOwed`, claimable only to `protocolTreasury`
 *
 * Fees accrue and are claimed rather than pushed. Pushing native on every swap
 * would let a recipient contract that reverts brick trading for everyone.
 *
 * The 1% anti-sniper window is enforced by `AdextoToken._update`, so it applies to
 * curve payouts automatically.
 */
contract SovereignCurveV2 {
    string public constant VERSION = "0.11.0";

    // ─── Immutable wiring ────────────────────────────────────────────────────
    address public immutable factory;
    /**
     * @notice The agent identity this market was launched under (ERC-8004 style).
     * @dev REFERENCE ONLY. This used to gate `executeBuyback` through an
     *      `onlyAgent` modifier; it no longer authorises anything, because the
     *      buyback is permissionless and bounded by size instead. Kept so the
     *      declared agent stays readable on-chain and matches
     *      `AdextoToken.agentIdentity`.
     */
    address public immutable agentTreasury;
    /// @notice Fee recipient, fixed at deployment so it can never be redirected.
    address public immutable creator;
    /**
     * @notice Protocol fee recipient, fixed at deployment.
     * @dev Immutable for the same reason `creator` is: the only way to redirect
     *      revenue away from where a trader was told it goes is a setter, and this
     *      contract has none. Set by the factory, which hardcodes it as a constant,
     *      so every market from one factory pays the same address and that address
     *      is readable on-chain before anyone trades.
     */
    address public immutable protocolTreasury;

    /// @notice ERC-20 traded against the chain's native asset. Bound once by the factory.
    address public targetToken;

    /// @notice Virtual native reserve. Never real money; sets the opening price.
    uint256 public immutable virtualNative;

    uint256 public immutable depthFeeBps;
    uint256 public immutable creatorFeeBps;
    uint256 public immutable treasuryBuybackBps;
    /// @notice Protocol share of every swap. Additive to the other three.
    uint256 public immutable protocolFeeBps;

    uint256 public constant MAX_TOTAL_FEE_BPS = 500; // hard cap 5%
    uint256 public constant BPS_DENOMINATOR = 10_000;

    // ─── Curve state ─────────────────────────────────────────────────────────
    bool public initialized;

    /// @notice Tokens held by the curve at initialisation (T).
    uint256 public curveTokens;

    /// @dev Real native accumulated along the curve (C). uint256 on purpose: the
    ///      predecessor packed reserves into uint112 and every write went through
    ///      an explicit narrowing cast, which in Solidity 0.8 truncates silently
    ///      instead of reverting. One extra slot removes that class of failure.
    uint256 private _curveNative;
    /// @dev Tokens sold out of the curve (S).
    uint256 private _tokensSold;

    /// @notice Native owed to the creator, claimable. Excluded from the curve.
    uint256 public creatorOwed;
    /// @notice Native accrued for the agent buyback vault. Excluded from the curve.
    uint256 public treasuryNative;
    /// @notice Native owed to the protocol treasury, claimable. Excluded from the curve.
    uint256 public protocolOwed;

    uint256 public totalCreatorFeesPaid;
    uint256 public totalTreasuryFeesCollected;
    uint256 public totalProtocolFeesPaid;
    uint256 public totalDepthFeesRetained;
    uint256 public totalTokensBurned;
    uint256 public totalVolumeNative;
    uint256 public swapCount;

    uint256 private _locked;

    // ─── Events ──────────────────────────────────────────────────────────────
    event CurveInitialized(uint256 virtualNative, uint256 curveTokens, uint256 openingPrice);
    /**
     * @dev Carries `protocolFee` as its own field rather than folding it into
     *      `depthFee`. An indexer that could not separate them would report a
     *      rising price floor that never rose, because the protocol leg leaves the
     *      curve while the depth leg stays in it.
     */
    event Swap(
        address indexed trader,
        address indexed recipient,
        bool isBuy,
        uint256 amountIn,
        uint256 amountOut,
        uint256 depthFee,
        uint256 creatorFee,
        uint256 treasuryFee,
        uint256 protocolFee,
        uint256 nativeReserveAfter,
        uint256 tokenReserveAfter
    );
    event CreatorFeesClaimed(address indexed to, uint256 amount);
    event ProtocolFeesClaimed(address indexed to, uint256 amount);
    event TreasuryFeeCollected(address indexed currency, uint256 amount);
    /**
     * @notice Buyback executed: native spent, tokens bought and burned.
     * @dev CARRIES `depthFee` AND BOTH RESERVES ON PURPOSE.
     *
     * The previous signature was `(amountIn, tokensBurned)` only, and that made
     * one number permanently unknowable to any indexer: `executeBuyback` adds to
     * `totalDepthFeesRetained`, and the floor price is
     * `(virtualNative + totalDepthFeesRetained) / curveTokens`. Without `depthFee`
     * in the log, a reader had to either skip it — leaving the displayed floor
     * price lower than the real one, permanently, drifting further with every
     * buyback — or guess it, which moves a price floor on no evidence.
     *
     * The reserves are here for the same reason `Swap` carries them: a buyback
     * moves the curve but emits no `Swap`, so a reader that only saw `amountIn`
     * would have to re-derive the new reserves by arithmetic and would diverge
     * from the contract on any rounding difference. Reading them from the log
     * makes divergence impossible.
     */
    event AutoBuybackExecuted(
        uint256 amountIn,
        uint256 tokensBurned,
        uint256 depthFee,
        uint256 nativeReserveAfter,
        uint256 tokenReserveAfter
    );

    // ─── Modifiers ───────────────────────────────────────────────────────────
    modifier nonReentrant() {
        require(_locked == 0, "SovereignCurve: reentrant");
        _locked = 1;
        _;
        _locked = 0;
    }

    modifier onlyFactory() {
        require(msg.sender == factory, "SovereignCurve: only factory");
        _;
    }

    modifier ensure(uint256 deadline) {
        require(deadline == 0 || block.timestamp <= deadline, "SovereignCurve: expired");
        _;
    }

    modifier live() {
        require(initialized, "SovereignCurve: curve not initialized");
        _;
    }

    constructor(
        address _factory,
        address _agentTreasury,
        address _creator,
        address _protocolTreasury,
        uint256 _virtualNative,
        uint256 _depthFeeBps,
        uint256 _creatorFeeBps,
        uint256 _treasuryBuybackBps,
        uint256 _protocolFeeBps
    ) {
        require(
            _factory != address(0) && _agentTreasury != address(0) && _creator != address(0),
            "SovereignCurve: zero address"
        );
        // Checked even when `_protocolFeeBps` is zero. A curve deployed with a zero
        // treasury and a non-zero fee would accrue `protocolOwed` that can never be
        // claimed, and since nothing here is mutable it would be stranded forever.
        require(_protocolTreasury != address(0), "SovereignCurve: zero protocol treasury");
        require(_virtualNative > 0, "SovereignCurve: zero virtual reserve");
        require(
            _depthFeeBps + _creatorFeeBps + _treasuryBuybackBps + _protocolFeeBps <= MAX_TOTAL_FEE_BPS,
            "SovereignCurve: fee too high"
        );
        factory = _factory;
        agentTreasury = _agentTreasury;
        creator = _creator;
        protocolTreasury = _protocolTreasury;
        virtualNative = _virtualNative;
        depthFeeBps = _depthFeeBps;
        creatorFeeBps = _creatorFeeBps;
        treasuryBuybackBps = _treasuryBuybackBps;
        protocolFeeBps = _protocolFeeBps;
    }

    // ─── Setup ───────────────────────────────────────────────────────────────

    function bindToken(address token) external onlyFactory {
        require(targetToken == address(0), "SovereignCurve: token already bound");
        require(token != address(0), "SovereignCurve: zero token");
        targetToken = token;
    }

    /**
     * @notice Load the curve with tokens. Deliberately NOT payable — the whole
     *         point is that no native seed is required.
     * @dev Caller must have approved `tokenAmount` first.
     */
    function initializeCurve(uint256 tokenAmount) external onlyFactory nonReentrant {
        require(!initialized, "SovereignCurve: already initialized");
        require(targetToken != address(0), "SovereignCurve: token not bound");
        require(tokenAmount > 0, "SovereignCurve: token seed required");

        require(
            IERC20MinimalV2(targetToken).transferFrom(msg.sender, address(this), tokenAmount),
            "SovereignCurve: token transfer failed"
        );

        curveTokens = tokenAmount;
        initialized = true;

        emit CurveInitialized(virtualNative, tokenAmount, (virtualNative * 1e18) / tokenAmount);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /// @notice Pricing reserves. Native side includes the virtual component.
    function getReserves() external view returns (uint256 reserveNative, uint256 reserveToken) {
        if (!initialized) return (0, 0);
        return (virtualNative + _curveNative, curveTokens - _tokensSold);
    }

    /// @notice Real native actually held for the curve, excluding fee buckets.
    function realNative() external view returns (uint256) {
        return _curveNative;
    }

    function tokensSold() external view returns (uint256) {
        return _tokensSold;
    }

    /**
     * @notice Lowest price the curve can return to, i.e. the price once every
     *         outstanding token has been sold back. Rises as depth fees settle.
     */
    function floorPriceNativePerToken() external view returns (uint256) {
        if (!initialized || curveTokens == 0) return 0;
        return ((virtualNative + totalDepthFeesRetained) * 1e18) / curveTokens;
    }

    function spotPriceNativePerToken() external view returns (uint256) {
        if (!initialized) return 0;
        uint256 tokenReserve = curveTokens - _tokensSold;
        if (tokenReserve == 0) return 0;
        return ((virtualNative + _curveNative) * 1e18) / tokenReserve;
    }

    /// @dev ABI compatibility: the frontend reads `lpFeeBps` for the depth share.
    function lpFeeBps() external view returns (uint256) {
        return depthFeeBps;
    }

    /**
     * @notice Every fee leg in one call, so a caller never has to add them up and
     *         risk disagreeing with the contract about what a trade costs.
     */
    function totalFeeBps() external view returns (uint256) {
        return depthFeeBps + creatorFeeBps + treasuryBuybackBps + protocolFeeBps;
    }

    function getBuyQuote(uint256 nativeIn)
        public
        view
        returns (uint256 tokensOut, uint256 depthFee, uint256 creatorFee, uint256 treasuryFee, uint256 protocolFee)
    {
        if (!initialized || nativeIn == 0) return (0, 0, 0, 0, 0);
        depthFee = (nativeIn * depthFeeBps) / BPS_DENOMINATOR;
        creatorFee = (nativeIn * creatorFeeBps) / BPS_DENOMINATOR;
        treasuryFee = (nativeIn * treasuryBuybackBps) / BPS_DENOMINATOR;
        protocolFee = (nativeIn * protocolFeeBps) / BPS_DENOMINATOR;

        uint256 dx = nativeIn - depthFee - creatorFee - treasuryFee - protocolFee;
        uint256 nativeReserve = virtualNative + _curveNative;
        uint256 tokenReserve = curveTokens - _tokensSold;
        // Floors, so any rounding error stays with the curve.
        tokensOut = (tokenReserve * dx) / (nativeReserve + dx);
    }

    function getSellQuote(uint256 tokenIn)
        public
        view
        returns (uint256 nativeOut, uint256 depthFee, uint256 creatorFee, uint256 treasuryFee, uint256 protocolFee)
    {
        if (!initialized || tokenIn == 0) return (0, 0, 0, 0, 0);
        uint256 nativeReserve = virtualNative + _curveNative;
        uint256 tokenReserve = curveTokens - _tokensSold;

        uint256 grossOut = (nativeReserve * tokenIn) / (tokenReserve + tokenIn);
        depthFee = (grossOut * depthFeeBps) / BPS_DENOMINATOR;
        creatorFee = (grossOut * creatorFeeBps) / BPS_DENOMINATOR;
        treasuryFee = (grossOut * treasuryBuybackBps) / BPS_DENOMINATOR;
        protocolFee = (grossOut * protocolFeeBps) / BPS_DENOMINATOR;
        nativeOut = grossOut - depthFee - creatorFee - treasuryFee - protocolFee;
    }

    // ─── Trading ─────────────────────────────────────────────────────────────

    function buy(uint256 minTokensOut, address to, uint256 deadline)
        external
        payable
        nonReentrant
        live
        ensure(deadline)
        returns (uint256 tokensOut)
    {
        return _buy(minTokensOut, to == address(0) ? msg.sender : to);
    }

    /// @notice Plain native transfers execute as a market buy with no slippage bound.
    receive() external payable {
        require(initialized, "SovereignCurve: curve not initialized");
        require(_locked == 0, "SovereignCurve: reentrant");
        _locked = 1;
        _buy(0, msg.sender);
        _locked = 0;
    }

    function _buy(uint256 minTokensOut, address recipient) private returns (uint256 tokensOut) {
        require(msg.value > 0, "SovereignCurve: zero native in");

        uint256 depthFee;
        uint256 creatorFee;
        uint256 treasuryFee;
        uint256 protocolFee;
        (tokensOut, depthFee, creatorFee, treasuryFee, protocolFee) = getBuyQuote(msg.value);

        require(tokensOut > 0, "SovereignCurve: insufficient output");
        require(tokensOut >= minTokensOut, "SovereignCurve: slippage");
        require(tokensOut < curveTokens - _tokensSold, "SovereignCurve: insufficient curve liquidity");

        // Depth fee stays with the curve; creator, buyback and protocol are carved out.
        _curveNative = _curveNative + msg.value - creatorFee - treasuryFee - protocolFee;
        _tokensSold += tokensOut;
        creatorOwed += creatorFee;
        treasuryNative += treasuryFee;
        protocolOwed += protocolFee;
        totalDepthFeesRetained += depthFee;
        totalTreasuryFeesCollected += treasuryFee;
        totalVolumeNative += msg.value;
        swapCount += 1;

        require(
            IERC20MinimalV2(targetToken).transfer(recipient, tokensOut),
            "SovereignCurve: token transfer failed"
        );

        _assertSolvent();

        // Guarded: this fired on every swap regardless of value, and a zero-value
        // log still costs the trader gas. `Swap` already carries `treasuryFee`.
        if (treasuryFee > 0) emit TreasuryFeeCollected(address(0), treasuryFee);
        emit Swap(
            msg.sender,
            recipient,
            true,
            msg.value,
            tokensOut,
            depthFee,
            creatorFee,
            treasuryFee,
            protocolFee,
            virtualNative + _curveNative,
            curveTokens - _tokensSold
        );
    }

    function sell(uint256 tokenAmountIn, uint256 minNativeOut, address to, uint256 deadline)
        external
        nonReentrant
        live
        ensure(deadline)
        returns (uint256 nativeOut)
    {
        require(tokenAmountIn > 0, "SovereignCurve: zero token amount");
        // Nobody can return more tokens than the curve ever released.
        require(tokenAmountIn <= _tokensSold, "SovereignCurve: exceeds outstanding supply");
        address recipient = to == address(0) ? msg.sender : to;

        (uint256 quotedOut, uint256 depthFee, uint256 creatorFee, uint256 treasuryFee, uint256 protocolFee) =
            getSellQuote(tokenAmountIn);
        require(quotedOut > 0, "SovereignCurve: insufficient output");
        require(quotedOut >= minNativeOut, "SovereignCurve: slippage");

        // Actionable errors instead of an opaque ERC-20 revert bubbling up.
        require(
            IERC20MinimalV2(targetToken).balanceOf(msg.sender) >= tokenAmountIn,
            "SovereignCurve: insufficient token balance"
        );
        require(
            IERC20MinimalV2(targetToken).allowance(msg.sender, address(this)) >= tokenAmountIn,
            "SovereignCurve: approve the curve before selling"
        );

        // Leaves the curve: payout + creator + buyback + protocol. Depth is retained.
        uint256 leaving = quotedOut + creatorFee + treasuryFee + protocolFee;
        require(leaving <= _curveNative, "SovereignCurve: curve solvency");

        require(
            IERC20MinimalV2(targetToken).transferFrom(msg.sender, address(this), tokenAmountIn),
            "SovereignCurve: transferFrom failed"
        );

        _curveNative -= leaving;
        _tokensSold -= tokenAmountIn;
        creatorOwed += creatorFee;
        treasuryNative += treasuryFee;
        protocolOwed += protocolFee;
        totalDepthFeesRetained += depthFee;
        totalTreasuryFeesCollected += treasuryFee;
        // Gross, before fees, matching `buy()` which counts `msg.value`. This read
        // `quotedOut` — the amount left AFTER fees — so buys were measured gross
        // and sells net, and the same trade size registered as two different
        // volumes depending on direction.
        totalVolumeNative += leaving + depthFee;
        swapCount += 1;

        (bool sent, ) = payable(recipient).call{value: quotedOut}("");
        require(sent, "SovereignCurve: native transfer failed");

        _assertSolvent();

        if (treasuryFee > 0) emit TreasuryFeeCollected(address(0), treasuryFee);
        emit Swap(
            msg.sender,
            recipient,
            false,
            tokenAmountIn,
            quotedOut,
            depthFee,
            creatorFee,
            treasuryFee,
            protocolFee,
            virtualNative + _curveNative,
            curveTokens - _tokensSold
        );

        return quotedOut;
    }

    // ─── Creator revenue ─────────────────────────────────────────────────────

    /**
     * @notice Pull accrued creator fees. Anyone may trigger it, but the funds can
     *         only ever go to the immutable `creator` address.
     */
    function claimCreatorFees() external nonReentrant returns (uint256 amount) {
        amount = creatorOwed;
        require(amount > 0, "SovereignCurve: nothing to claim");
        creatorOwed = 0;
        totalCreatorFeesPaid += amount;

        (bool sent, ) = payable(creator).call{value: amount}("");
        require(sent, "SovereignCurve: creator transfer failed");

        _assertSolvent();
        emit CreatorFeesClaimed(creator, amount);
    }

    // ─── Protocol revenue ────────────────────────────────────────────────────

    /**
     * @notice Pull accrued protocol fees to the immutable `protocolTreasury`.
     * @dev Deliberately identical in shape to `claimCreatorFees`: permissionless
     *      trigger, fixed destination, accrue-then-claim rather than push.
     *
     *      Permissionless because the destination is immutable, so a caller cannot
     *      choose where the money goes and gains nothing by calling it. The reason
     *      to prefer that over an access check is failure mode, not convenience: a
     *      privileged claimer is a key that can be lost, and there is no withdrawal
     *      function anywhere in this contract, so a lost key would strand
     *      `protocolOwed` permanently.
     *
     *      Accrue-then-claim rather than push, because pushing native on every swap
     *      would let a treasury address that reverts on receive halt all trading.
     *      An EOA cannot revert today, but `protocolTreasury` is immutable and this
     *      contract cannot know what will control that address later.
     */
    function claimProtocolFees() external nonReentrant returns (uint256 amount) {
        amount = protocolOwed;
        require(amount > 0, "SovereignCurve: nothing to claim");
        protocolOwed = 0;
        totalProtocolFeesPaid += amount;

        (bool sent, ) = payable(protocolTreasury).call{value: amount}("");
        require(sent, "SovereignCurve: protocol transfer failed");

        _assertSolvent();
        emit ProtocolFeesClaimed(protocolTreasury, amount);
    }

    // ─── Agent buyback ───────────────────────────────────────────────────────

    /**
     * @notice Spend accrued buyback native on tokens and burn them.
     * @dev Buys along the curve, so the burn is priced by the same maths as any
     *      other trade rather than at an administratively chosen rate.
     *
     * PERMISSIONLESS, AND WHY THE SIZE CAP IS WHAT MAKES THAT SAFE
     *
     * This was `onlyAgent`, meaning `agentTreasury || factory`. In practice the
     * factory passes the creator's own wallet as the agent and has no function
     * that calls this, so the "autonomous 24/7 buyback" had exactly one possible
     * caller: the creator, by hand. Across every testnet curve it was called zero
     * times. Meanwhile `treasuryNative` accrues from every single swap and can
     * leave through this function and nowhere else — there is no withdrawal path —
     * so an idle creator meant the buyback share of every trade sat inert forever.
     *
     * Opening it to anyone fixes that, but not on its own. The caller chooses both
     * `nativeAmount` and `minTokensBurned`, so an unbounded version is
     * sandwichable: buy large, trigger the buyback with `minTokensBurned = 0` so
     * it fills at the inflated price and burns fewer tokens than the treasury paid
     * for, then sell. Curve solvency still holds; what is destroyed is the
     * treasury's purchasing power, and the loss lands on holders.
     *
     * Whether that is profitable is a matter of magnitude, so it was measured
     * against a real testnet curve (depth 15bps, creator 10bps, treasury 5bps,
     * virtualNative 1500). At low volume `treasuryNative` is ~0.03% of the native
     * reserve, so a buyback moves price ~3bps against a 60bps round trip — the
     * attack loses money. But `treasuryNative` grows with cumulative volume while
     * the reserve does not keep pace, so once cumulative volume reaches roughly
     * 100x the reserve, the treasury is ~5% of it and a single unbounded buyback
     * moves price ~5%. The attack becomes profitable precisely in the markets that
     * succeeded.
     *
     * Hence the cap: at most 1% of the native reserve per call. That holds the
     * sandwich's ceiling near its 60bps cost, and each further attempt must wait
     * for the treasury to refill from real volume. The real constraint is size per
     * call, not the identity of the caller — so once the size is bounded,
     * permission buys nothing and costs the feature its only working caller.
     *
     * `minTokensBurned` stays a parameter: an honest caller should still be able
     * to protect their own call, and the cap already bounds what a dishonest one
     * can waste.
     *
     * NO FEE LEG IS CHARGED ON A BUYBACK, INCLUDING THE PROTOCOL LEG.
     *
     * The whole `nativeAmount` moves from `treasuryNative` into `_curveNative`,
     * while `getBuyQuote` sizes `tokensOut` as though fees had been taken. The
     * difference stays in the curve. That is deliberately conservative, and the
     * protocol leg follows the creator and buyback legs in being ignored here: a
     * buyback is the protocol recycling money that already came from fees, not new
     * trading volume, so charging it again would be taking a fee on a fee.
     */
    function executeBuyback(uint256 nativeAmount, uint256 minTokensBurned)
        external
        nonReentrant
        live
        returns (uint256 tokensBurned)
    {
        require(nativeAmount > 0 && nativeAmount <= treasuryNative, "SovereignCurve: bad buyback amount");
        // At most 1% of the native reserve in one call. Multiplied rather than
        // divided so no precision is lost on small reserves.
        require(
            nativeAmount * 100 <= virtualNative + _curveNative,
            "SovereignCurve: buyback exceeds 1% of reserve"
        );

        (uint256 tokensOut, uint256 depthFee, , , ) = getBuyQuote(nativeAmount);
        require(tokensOut > 0, "SovereignCurve: buyback output zero");
        require(tokensOut >= minTokensBurned, "SovereignCurve: buyback slippage");
        require(tokensOut < curveTokens - _tokensSold, "SovereignCurve: insufficient curve liquidity");

        // Moves from the buyback bucket into the curve; nothing leaves the contract.
        treasuryNative -= nativeAmount;
        _curveNative += nativeAmount;
        _tokensSold += tokensOut;
        totalDepthFeesRetained += depthFee;
        swapCount += 1;

        // Tokens bought are burned by the token contract, permanently reducing supply.
        IAdextoTokenV2(targetToken).executeTreasuryBuyback(tokensOut);
        totalTokensBurned += tokensOut;

        _assertSolvent();
        emit AutoBuybackExecuted(
            nativeAmount,
            tokensOut,
            depthFee,
            virtualNative + _curveNative,
            curveTokens - _tokensSold
        );
        return tokensOut;
    }

    // ─── Invariant ───────────────────────────────────────────────────────────

    /**
     * @dev Every native unit the contract holds is accounted for exactly once:
     *      the curve, the creator's claim, the buyback vault, or the protocol's
     *      claim. A shortfall would mean a payout path spent money it did not own.
     *
     *      `protocolOwed` MUST be a term here. Adding a fee leg that accrues a
     *      balance without adding it to this sum would leave the assertion
     *      satisfied by money the curve does not actually own free, so the curve
     *      would read as solvent while being short by exactly the unclaimed
     *      protocol fees, and the shortfall would only surface as a failed sell
     *      for whoever happened to be last.
     */
    function _assertSolvent() private view {
        require(
            address(this).balance >= _curveNative + creatorOwed + treasuryNative + protocolOwed,
            "SovereignCurve: accounting mismatch"
        );
    }
}
