// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/**
 * @dev The ERC-20 surface the curve calls on its token. Named distinctly from the factory's
 *      interface so that looking artifacts up by name is never ambiguous.
 */
interface IERC20Curve {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

interface IAdextoBurnable {
    function executeTreasuryBuyback(uint256 amountToBurn) external;
}

/**
 * @title AdextoCurve
 * @notice Virtual-reserve bonding curve for one ADEXTO market (adexto.xyz). It is the market's
 *         permanent venue: there is no graduation to another pool, no LP share, no owner and
 *         no withdrawal function.
 *
 * @dev PRICING
 *
 *   nativeReserve = virtualNative + curveNative      (curveNative is real native, starts at 0)
 *   tokenReserve  = curveTokens   - tokensSold
 *   price         = nativeReserve / tokenReserve
 *
 * Trades follow the constant product of those two reserves. `virtualNative` is a number in
 * storage, never money: it sets the opening price without anybody depositing anything. Real
 * native arrives only from buyers, and sellers are only ever paid from that real native.
 * Because 100% of supply enters the curve, `virtualNative` equals the opening market
 * capitalisation in the chain's native asset.
 *
 * FEES
 *
 * Four legs, each an immutable set by the factory at deployment. Together they are the whole
 * fee a trader pays, readable in one call as `totalFeeBps()`:
 *   - depth    stays in `curveNative`, so the price floor rises with volume;
 *   - creator  accrues to `creatorOwed`, claimable only to the immutable `creator`;
 *   - buyback  accrues to `treasuryNative`, spent only by `executeBuyback`;
 *   - protocol accrues to `protocolOwed`, claimable only to the immutable `protocolTreasury`.
 *
 * How the total is split is decided by the factory. The curve does not know whether the
 * protocol leg was carved out of a total or added to one; it charges exactly the four rates it
 * was given, capped together at `MAX_TOTAL_FEE_BPS`. Fees accrue and are claimed rather than
 * pushed, because pushing native on every swap would let a recipient that reverts halt trading.
 *
 * SOLVENCY
 *
 * Let F be the depth fees retained so far and C the native that moved along the curve, so
 * curveNative = C + F. The curve relation gives C = V*S/(T-S) for virtual reserve V, curve
 * tokens T and tokens sold S. Selling every outstanding token at once (ds = S) pays
 *
 *   grossOut = (V + C + F) * S / T
 *            = V*S/(T-S) + F*S/T
 *            = C + F*(S/T)
 *
 * and since S <= T that is at most C + F = curveNative. Even everyone selling everything is
 * covered, with depth fees as slack, and integer division only ever adds to that slack. The
 * creator, buyback and protocol legs are excluded from curveNative on the way in and taken out
 * of it on the way out, so they never enter C or F. `_assertSolvent` re-checks the balance
 * after every state change.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * No withdrawal, no rescue, no sweep, no setter, no owner, no graduation. Migration from a
 * curve to a pool is where most launchpad exploits have happened, and a curve that stays the
 * venue keeps the property that nobody can pull the market's reserves.
 *
 * The launch window's per-wallet limit is enforced by `AdextoToken._update`, so it applies to
 * curve payouts automatically.
 */
contract AdextoCurve {
    /// @notice Generation of this curve, equal to the factory that deploys it.
    string public constant VERSION = "1.0.0";

    // ─── Immutable wiring ────────────────────────────────────────────────────
    address public immutable factory;
    /**
     * @notice The agent identity this market was launched under.
     * @dev Reference only. It authorises nothing on this contract, because the buyback is
     *      permissionless and bounded by size and time instead. Kept so the declared agent is
     *      readable on chain and matches `AdextoToken.agentIdentity`.
     */
    address public immutable agentTreasury;
    /// @notice Creator fee recipient, fixed at deployment so it can never be redirected.
    address public immutable creator;
    /**
     * @notice Protocol fee recipient, fixed at deployment.
     * @dev Immutable for the same reason as `creator`: the only way to redirect revenue from
     *      where a trader was told it goes is a setter, and this contract has none.
     */
    address public immutable protocolTreasury;

    /// @notice ERC-20 traded against the chain's native asset. Bound once, by the factory.
    address public targetToken;

    /// @notice Virtual native reserve. Never real money; sets the opening price.
    uint256 public immutable virtualNative;

    uint256 public immutable depthFeeBps;
    uint256 public immutable creatorFeeBps;
    uint256 public immutable treasuryBuybackBps;
    /// @notice Protocol share of every swap. One of the four legs that make up `totalFeeBps()`.
    uint256 public immutable protocolFeeBps;

    uint256 public constant MAX_TOTAL_FEE_BPS = 500; // hard cap 5%
    uint256 public constant BPS_DENOMINATOR = 10_000;
    /**
     * @notice Minimum gap between two buybacks on this curve.
     * @dev What the cooldown must break is atomicity: the profitable attack buys, loops the
     *      buyback and sells inside one transaction, so the price it moved never reaches anyone
     *      else. Any gap breaks that. One hour also bounds the patient version, at most 24
     *      buybacks a day of at most 1% of the reserve each, while keeping the feature usable,
     *      since a buyback is meant to run periodically and not every block.
     */
    uint256 public constant BUYBACK_COOLDOWN = 1 hours;

    // ─── Curve state ─────────────────────────────────────────────────────────
    bool public initialized;

    /// @notice Tokens held by the curve at initialisation (T).
    uint256 public curveTokens;

    /// @dev Real native accumulated along the curve (C). A full uint256 on purpose: packing
    ///      reserves into a narrower type needs explicit narrowing casts, which in Solidity 0.8
    ///      truncate silently instead of reverting.
    uint256 private _curveNative;
    /// @dev Tokens sold out of the curve (S).
    uint256 private _tokensSold;

    /// @notice Native owed to the creator, claimable. Excluded from the curve.
    uint256 public creatorOwed;
    /// @notice Native accrued for buyback-and-burn. Excluded from the curve.
    uint256 public treasuryNative;
    /**
     * @notice Block timestamp of the most recent buyback. Zero until the first one.
     * @dev Turns `executeBuyback`'s per-call cap into a budget. Without it the whole buyback
     *      bucket could be pushed into the curve in one transaction, because each call raises
     *      the reserve and with it the 1% ceiling.
     */
    uint256 public lastBuybackAt;
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
     * @dev Carries `protocolFee` as its own field rather than folding it into `depthFee`. An
     *      indexer that could not separate them would report a rising price floor that never
     *      rose, because the protocol leg leaves the curve while the depth leg stays in it.
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
     * @dev Carries `depthFee` and both reserves. A buyback adds to `totalDepthFeesRetained`,
     *      which moves the floor price, and it moves the curve without emitting `Swap`. An
     *      indexer reading only the amounts would have to guess the floor or re-derive the
     *      reserves, and would drift from the contract on any rounding difference.
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
        require(_locked == 0, "AdextoCurve: reentrant");
        _locked = 1;
        _;
        _locked = 0;
    }

    modifier onlyFactory() {
        require(msg.sender == factory, "AdextoCurve: only factory");
        _;
    }

    modifier ensure(uint256 deadline) {
        require(deadline == 0 || block.timestamp <= deadline, "AdextoCurve: expired");
        _;
    }

    modifier live() {
        require(initialized, "AdextoCurve: curve not initialized");
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
            "AdextoCurve: zero address"
        );
        // Checked even when `_protocolFeeBps` is zero. A zero treasury with a non-zero fee would
        // accrue `protocolOwed` that could never be claimed, and nothing here is mutable.
        require(_protocolTreasury != address(0), "AdextoCurve: zero protocol treasury");
        require(_virtualNative > 0, "AdextoCurve: zero virtual reserve");
        require(
            _depthFeeBps + _creatorFeeBps + _treasuryBuybackBps + _protocolFeeBps <= MAX_TOTAL_FEE_BPS,
            "AdextoCurve: fee too high"
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
        require(targetToken == address(0), "AdextoCurve: token already bound");
        require(token != address(0), "AdextoCurve: zero token");
        targetToken = token;
    }

    /**
     * @notice Load the curve with tokens. Deliberately NOT payable: no native seed is needed.
     * @dev Caller must have approved `tokenAmount` first.
     */
    function initializeCurve(uint256 tokenAmount) external nonReentrant onlyFactory {
        require(!initialized, "AdextoCurve: already initialized");
        require(targetToken != address(0), "AdextoCurve: token not bound");
        require(tokenAmount > 0, "AdextoCurve: token seed required");

        // State first, transfer second (checks-effects-interactions). If the transfer fails the
        // whole transaction reverts and both values return to what they were.
        curveTokens = tokenAmount;
        initialized = true;

        require(
            IERC20Curve(targetToken).transferFrom(msg.sender, address(this), tokenAmount),
            "AdextoCurve: token transfer failed"
        );

        emit CurveInitialized(virtualNative, tokenAmount, (virtualNative * 1e18) / tokenAmount);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /// @notice Pricing reserves. The native side includes the virtual component.
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
     * @notice Lowest price the curve can return to, i.e. the price once every outstanding
     *         token has been sold back. Rises as depth fees settle.
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
     * @notice Every fee leg in one call, so a caller never has to add them up and risk
     *         disagreeing with the contract about what a trade costs.
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
        require(initialized, "AdextoCurve: curve not initialized");
        require(_locked == 0, "AdextoCurve: reentrant");
        _locked = 1;
        _buy(0, msg.sender);
        _locked = 0;
    }

    function _buy(uint256 minTokensOut, address recipient) private returns (uint256 tokensOut) {
        require(msg.value > 0, "AdextoCurve: zero native in");

        uint256 depthFee;
        uint256 creatorFee;
        uint256 treasuryFee;
        uint256 protocolFee;
        (tokensOut, depthFee, creatorFee, treasuryFee, protocolFee) = getBuyQuote(msg.value);

        require(tokensOut > 0, "AdextoCurve: insufficient output");
        require(tokensOut >= minTokensOut, "AdextoCurve: slippage");
        require(tokensOut < curveTokens - _tokensSold, "AdextoCurve: insufficient curve liquidity");

        // Depth stays with the curve; creator, buyback and protocol are carved out of it.
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
            IERC20Curve(targetToken).transfer(recipient, tokensOut),
            "AdextoCurve: token transfer failed"
        );

        _assertSolvent();

        // Guarded because a zero-value log still costs the trader gas. `Swap` carries the fee.
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
        require(tokenAmountIn > 0, "AdextoCurve: zero token amount");
        // Nobody can return more tokens than the curve ever released.
        require(tokenAmountIn <= _tokensSold, "AdextoCurve: exceeds outstanding supply");
        address recipient = to == address(0) ? msg.sender : to;

        (uint256 quotedOut, uint256 depthFee, uint256 creatorFee, uint256 treasuryFee, uint256 protocolFee) =
            getSellQuote(tokenAmountIn);
        require(quotedOut > 0, "AdextoCurve: insufficient output");
        require(quotedOut >= minNativeOut, "AdextoCurve: slippage");

        // Actionable errors instead of an opaque ERC-20 revert bubbling up.
        require(
            IERC20Curve(targetToken).balanceOf(msg.sender) >= tokenAmountIn,
            "AdextoCurve: insufficient token balance"
        );
        require(
            IERC20Curve(targetToken).allowance(msg.sender, address(this)) >= tokenAmountIn,
            "AdextoCurve: approve the curve before selling"
        );

        // Leaves the curve: payout + creator + buyback + protocol. Depth is retained.
        uint256 leaving = quotedOut + creatorFee + treasuryFee + protocolFee;
        require(leaving <= _curveNative, "AdextoCurve: curve solvency");

        require(
            IERC20Curve(targetToken).transferFrom(msg.sender, address(this), tokenAmountIn),
            "AdextoCurve: transferFrom failed"
        );

        _curveNative -= leaving;
        _tokensSold -= tokenAmountIn;
        creatorOwed += creatorFee;
        treasuryNative += treasuryFee;
        protocolOwed += protocolFee;
        totalDepthFeesRetained += depthFee;
        totalTreasuryFeesCollected += treasuryFee;
        // Gross, before fees, the same basis as `buy()`, which counts `msg.value`. Counting the
        // net payout would measure the same trade size differently depending on direction.
        totalVolumeNative += leaving + depthFee;
        swapCount += 1;

        (bool sent, ) = payable(recipient).call{value: quotedOut}("");
        require(sent, "AdextoCurve: native transfer failed");

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
     * @notice Pull accrued creator fees. Anyone may trigger it, but the funds can only ever go
     *         to the immutable `creator` address.
     */
    function claimCreatorFees() external nonReentrant returns (uint256 amount) {
        amount = creatorOwed;
        require(amount > 0, "AdextoCurve: nothing to claim");
        creatorOwed = 0;
        totalCreatorFeesPaid += amount;

        // Unreachable by construction, since the constructor rejects a zero `creator`, and kept
        // on purpose: it makes the transfer visibly safe without tracing back to the constructor.
        require(creator != address(0), "AdextoCurve: zero creator");
        (bool sent, ) = payable(creator).call{value: amount}("");
        require(sent, "AdextoCurve: creator transfer failed");

        _assertSolvent();
        emit CreatorFeesClaimed(creator, amount);
    }

    // ─── Protocol revenue ────────────────────────────────────────────────────

    /**
     * @notice Pull accrued protocol fees to the immutable `protocolTreasury`.
     * @dev Same shape as `claimCreatorFees`: permissionless trigger, fixed destination,
     *      accrue-then-claim. Permissionless because the caller cannot choose where the money
     *      goes and gains nothing by calling. A privileged claimer would be a key that can be
     *      lost, and with no withdrawal function anywhere a lost key would strand
     *      `protocolOwed` forever.
     */
    function claimProtocolFees() external nonReentrant returns (uint256 amount) {
        amount = protocolOwed;
        require(amount > 0, "AdextoCurve: nothing to claim");
        protocolOwed = 0;
        totalProtocolFeesPaid += amount;

        // Unreachable by construction, like the check in `claimCreatorFees`, and kept for the
        // same reason.
        require(protocolTreasury != address(0), "AdextoCurve: zero protocol treasury");
        (bool sent, ) = payable(protocolTreasury).call{value: amount}("");
        require(sent, "AdextoCurve: protocol transfer failed");

        _assertSolvent();
        emit ProtocolFeesClaimed(protocolTreasury, amount);
    }

    // ─── Buyback ─────────────────────────────────────────────────────────────

    /**
     * @notice Spend accrued buyback native on tokens along the curve, and burn them.
     * @dev Priced by the same curve maths as any other trade, not at a chosen rate.
     *
     * PERMISSIONLESS, AND WHAT MAKES THAT SAFE
     *
     * Anyone may call this. `treasuryNative` fills from every swap and can leave only through
     * this function, so gating it on one caller would let the buyback share sit idle whenever
     * that caller did. Because the caller chooses `nativeAmount` and `minTokensBurned`, the
     * risk is a sandwich: buy large, trigger the buyback at the inflated price so it burns less
     * than the bucket paid for, then sell. Solvency still holds; what is lost is the bucket's
     * purchasing power, and holders bear it.
     *
     * Two limits bound that. At most 1% of the native reserve per call, which keeps one
     * buyback's price impact near the round-trip cost of the sandwich. And at most one call per
     * `BUYBACK_COOLDOWN`. The per-call cap alone does not bound how many calls one transaction
     * makes, and each call raises the reserve and therefore the next cap, so without the
     * cooldown the whole bucket could be drained inside a single buy-then-sell (reported as
     * finding 1 of GHSA-g589-wjqq-86f2). The cooldown makes the attack non-atomic: the moved
     * price is exposed to everyone else before the attacker can close.
     *
     * `minTokensBurned` remains a parameter so an honest caller can protect their own call.
     *
     * NO FEE LEG IS CHARGED ON A BUYBACK
     *
     * The whole `nativeAmount` moves from `treasuryNative` into the curve, while `getBuyQuote`
     * sizes `tokensOut` as though fees had been taken, and the difference stays in the curve.
     * A buyback recycles money that already came from fees, so charging it again would be a
     * fee on a fee.
     */
    function executeBuyback(uint256 nativeAmount, uint256 minTokensBurned)
        external
        nonReentrant
        live
        returns (uint256 tokensBurned)
    {
        require(nativeAmount > 0 && nativeAmount <= treasuryNative, "AdextoCurve: bad buyback amount");
        // At most 1% of the native reserve in one call. Multiplied rather than divided so no
        // precision is lost on small reserves.
        require(
            nativeAmount * 100 <= virtualNative + _curveNative,
            "AdextoCurve: buyback exceeds 1% of reserve"
        );
        // Checked before any state moves, so a second call in the same transaction reverts
        // instead of partly running. Zero means "never run", not "ran at the epoch", which is
        // why it is tested explicitly: otherwise the first buyback would be blocked on any chain
        // whose timestamp is below the cooldown.
        require(
            lastBuybackAt == 0 || block.timestamp >= lastBuybackAt + BUYBACK_COOLDOWN,
            "AdextoCurve: buyback cooldown"
        );
        lastBuybackAt = block.timestamp;

        (uint256 tokensOut, uint256 depthFee, , , ) = getBuyQuote(nativeAmount);
        require(tokensOut > 0, "AdextoCurve: buyback output zero");
        require(tokensOut >= minTokensBurned, "AdextoCurve: buyback slippage");
        require(tokensOut < curveTokens - _tokensSold, "AdextoCurve: insufficient curve liquidity");

        // Moves from the buyback bucket into the curve; nothing leaves the contract.
        treasuryNative -= nativeAmount;
        _curveNative += nativeAmount;
        _tokensSold += tokensOut;
        totalDepthFeesRetained += depthFee;
        swapCount += 1;

        // Counted before the burn call, so that every state write precedes the external call.
        // If the burn fails the transaction reverts and the counter with it.
        totalTokensBurned += tokensOut;
        // The bought tokens are burned by the token contract, permanently reducing supply.
        IAdextoBurnable(targetToken).executeTreasuryBuyback(tokensOut);

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
     * @dev Every native unit the contract holds is accounted for exactly once: the curve, the
     *      creator's claim, the buyback bucket or the protocol's claim. A shortfall would mean a
     *      payout path spent money it did not own. `protocolOwed` must be a term here; leaving
     *      it out would let the check pass on money that already belongs to the treasury.
     */
    function _assertSolvent() private view {
        require(
            address(this).balance >= _curveNative + creatorOwed + treasuryNative + protocolOwed,
            "AdextoCurve: accounting mismatch"
        );
    }
}
