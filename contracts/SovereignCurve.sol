// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

interface IAdextoToken {
    function executeTreasuryBuyback(uint256 amountToBurn) external;
}

/**
 * @title SovereignCurve
 * @notice Virtual-reserve bonding curve for ADEXTO (adexto.xyz).
 *
 * @dev WHY THIS EXISTS
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
 * WHAT IS DELIBERATELY ABSENT
 *
 * No withdrawal function, no LP shares, no graduation to another pool. Migration
 * from a curve to an AMM is where most launchpad exploits live, and a permanent
 * curve keeps the "no rug lever" property the project already chose.
 *
 * FEES
 *
 * The total fee is split three ways *inside* the existing total, so traders are
 * never charged extra to pay the creator:
 *   - depth    -> stays in `curveNative`, so the price floor rises with volume
 *   - creator  -> accrues to `creatorOwed` for a locked creator address
 *   - buyback  -> accrues to `treasuryNative`, spent by `executeBuyback`
 *
 * Creator fees accrue and are claimed rather than pushed. Pushing native on every
 * swap would let a creator contract that reverts brick trading for everyone.
 *
 * NEITHER PAYOUT PATH NEEDS PERMISSION
 *
 * `claimCreatorFees` and `executeBuyback` are both callable by anyone, and neither
 * lets the caller choose a destination: creator fees can only reach the immutable
 * `creator`, and buyback native can only buy-and-burn on this curve. Nothing here
 * can be redirected, so requiring an authorised caller would only add a key that
 * can be lost — and losing it would strand `treasuryNative` permanently, since
 * there is no withdrawal function anywhere in this contract.
 *
 * The 1% anti-sniper window is enforced by `AdextoToken._update`, so it applies to
 * curve payouts automatically.
 */
contract SovereignCurve {
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

    /// @notice ERC-20 traded against the chain's native asset. Bound once by the factory.
    address public targetToken;

    /// @notice Virtual native reserve. Never real money; sets the opening price.
    uint256 public immutable virtualNative;

    uint256 public immutable depthFeeBps;
    uint256 public immutable creatorFeeBps;
    uint256 public immutable treasuryBuybackBps;

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

    uint256 public totalCreatorFeesPaid;
    uint256 public totalTreasuryFeesCollected;
    uint256 public totalDepthFeesRetained;
    uint256 public totalTokensBurned;
    uint256 public totalVolumeNative;
    uint256 public swapCount;

    uint256 private _locked;

    // ─── Events ──────────────────────────────────────────────────────────────
    event CurveInitialized(uint256 virtualNative, uint256 curveTokens, uint256 openingPrice);
    event Swap(
        address indexed trader,
        address indexed recipient,
        bool isBuy,
        uint256 amountIn,
        uint256 amountOut,
        uint256 depthFee,
        uint256 creatorFee,
        uint256 treasuryFee,
        uint256 nativeReserveAfter,
        uint256 tokenReserveAfter
    );
    event CreatorFeesClaimed(address indexed to, uint256 amount);
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
        uint256 _virtualNative,
        uint256 _depthFeeBps,
        uint256 _creatorFeeBps,
        uint256 _treasuryBuybackBps
    ) {
        require(
            _factory != address(0) && _agentTreasury != address(0) && _creator != address(0),
            "SovereignCurve: zero address"
        );
        require(_virtualNative > 0, "SovereignCurve: zero virtual reserve");
        require(
            _depthFeeBps + _creatorFeeBps + _treasuryBuybackBps <= MAX_TOTAL_FEE_BPS,
            "SovereignCurve: fee too high"
        );
        factory = _factory;
        agentTreasury = _agentTreasury;
        creator = _creator;
        virtualNative = _virtualNative;
        depthFeeBps = _depthFeeBps;
        creatorFeeBps = _creatorFeeBps;
        treasuryBuybackBps = _treasuryBuybackBps;
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
     *
     *      `onlyFactory` was missing here while `bindToken` had it. In the current
     *      factory both are called atomically inside `deployTrinity`, so nothing
     *      could interleave and the gap was not exploitable. It was still wrong to
     *      leave: a curve that is bound but not yet initialised could be
     *      initialised by anyone with 1 wei of tokens, pinning `curveTokens = 1`
     *      and making the price meaningless. That made this contract unsafe to
     *      reuse with any other deployment flow, and an access modifier cannot be
     *      added after broadcast.
     */
    function initializeCurve(uint256 tokenAmount) external onlyFactory nonReentrant {
        require(!initialized, "SovereignCurve: already initialized");
        require(targetToken != address(0), "SovereignCurve: token not bound");
        require(tokenAmount > 0, "SovereignCurve: token seed required");

        require(
            IERC20Minimal(targetToken).transferFrom(msg.sender, address(this), tokenAmount),
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

    function getBuyQuote(uint256 nativeIn)
        public
        view
        returns (uint256 tokensOut, uint256 depthFee, uint256 creatorFee, uint256 treasuryFee)
    {
        if (!initialized || nativeIn == 0) return (0, 0, 0, 0);
        depthFee = (nativeIn * depthFeeBps) / BPS_DENOMINATOR;
        creatorFee = (nativeIn * creatorFeeBps) / BPS_DENOMINATOR;
        treasuryFee = (nativeIn * treasuryBuybackBps) / BPS_DENOMINATOR;

        uint256 dx = nativeIn - depthFee - creatorFee - treasuryFee;
        uint256 nativeReserve = virtualNative + _curveNative;
        uint256 tokenReserve = curveTokens - _tokensSold;
        // Floors, so any rounding error stays with the curve.
        tokensOut = (tokenReserve * dx) / (nativeReserve + dx);
    }

    function getSellQuote(uint256 tokenIn)
        public
        view
        returns (uint256 nativeOut, uint256 depthFee, uint256 creatorFee, uint256 treasuryFee)
    {
        if (!initialized || tokenIn == 0) return (0, 0, 0, 0);
        uint256 nativeReserve = virtualNative + _curveNative;
        uint256 tokenReserve = curveTokens - _tokensSold;

        uint256 grossOut = (nativeReserve * tokenIn) / (tokenReserve + tokenIn);
        depthFee = (grossOut * depthFeeBps) / BPS_DENOMINATOR;
        creatorFee = (grossOut * creatorFeeBps) / BPS_DENOMINATOR;
        treasuryFee = (grossOut * treasuryBuybackBps) / BPS_DENOMINATOR;
        nativeOut = grossOut - depthFee - creatorFee - treasuryFee;
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
        (tokensOut, depthFee, creatorFee, treasuryFee) = getBuyQuote(msg.value);

        require(tokensOut > 0, "SovereignCurve: insufficient output");
        require(tokensOut >= minTokensOut, "SovereignCurve: slippage");
        require(tokensOut < curveTokens - _tokensSold, "SovereignCurve: insufficient curve liquidity");

        // Depth fee stays with the curve; creator and buyback are carved out.
        _curveNative = _curveNative + msg.value - creatorFee - treasuryFee;
        _tokensSold += tokensOut;
        creatorOwed += creatorFee;
        treasuryNative += treasuryFee;
        totalDepthFeesRetained += depthFee;
        totalTreasuryFeesCollected += treasuryFee;
        totalVolumeNative += msg.value;
        swapCount += 1;

        require(
            IERC20Minimal(targetToken).transfer(recipient, tokensOut),
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

        (uint256 quotedOut, uint256 depthFee, uint256 creatorFee, uint256 treasuryFee) =
            getSellQuote(tokenAmountIn);
        require(quotedOut > 0, "SovereignCurve: insufficient output");
        require(quotedOut >= minNativeOut, "SovereignCurve: slippage");

        // Actionable errors instead of an opaque ERC-20 revert bubbling up.
        require(
            IERC20Minimal(targetToken).balanceOf(msg.sender) >= tokenAmountIn,
            "SovereignCurve: insufficient token balance"
        );
        require(
            IERC20Minimal(targetToken).allowance(msg.sender, address(this)) >= tokenAmountIn,
            "SovereignCurve: approve the curve before selling"
        );

        // Leaves the curve: payout + creator + buyback. The depth fee is retained.
        uint256 leaving = quotedOut + creatorFee + treasuryFee;
        require(leaving <= _curveNative, "SovereignCurve: curve solvency");

        require(
            IERC20Minimal(targetToken).transferFrom(msg.sender, address(this), tokenAmountIn),
            "SovereignCurve: transferFrom failed"
        );

        _curveNative -= leaving;
        _tokensSold -= tokenAmountIn;
        creatorOwed += creatorFee;
        treasuryNative += treasuryFee;
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

        (uint256 tokensOut, uint256 depthFee, , ) = getBuyQuote(nativeAmount);
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
        IAdextoToken(targetToken).executeTreasuryBuyback(tokensOut);
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
     *      the curve, the creator's claim, or the buyback vault. A shortfall
     *      would mean a payout path spent money it did not own. This is a
     *      belt-and-braces assertion; the curve maths already makes it
     *      unreachable (see the contract header).
     */
    function _assertSolvent() private view {
        require(
            address(this).balance >= _curveNative + creatorOwed + treasuryNative,
            "SovereignCurve: accounting mismatch"
        );
    }
}
