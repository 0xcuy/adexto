// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title SovereignHook
 * @notice Sovereign AMM pool + fee router for the ADEXTO Protocol (adexto.xyz).
 *
 * @dev v2 — this contract is now an executable native<->token AMM, not just a
 *      Uniswap v4 fee callback. The previous revision exposed only `afterSwap`
 *      and `executeScheduledBurn`, had no `receive()` / `fallback()` and no swap
 *      entrypoint, so every native transfer sent to it by the UI reverted and no
 *      trade could ever settle. That is fixed here:
 *
 *      - `buy()`   : native -> token, payable, with minAmountOut + deadline
 *      - `sell()`  : token -> native, pulls tokens via `transferFrom` (approve first)
 *      - `receive()`: plain native transfers are treated as a market buy so funds
 *                    are never stuck and the tx never reverts for lack of a hook
 *      - `getBuyQuote` / `getSellQuote`: exact on-chain quoting for the frontend
 *
 *      Fee model (unchanged economics, now actually enforced on-chain):
 *      - `lpFeeBps`        stays inside the pool reserves (accrues to LPs)
 *      - `treasuryFeeBps`  accrues to `treasuryNative`, spent by `executeBuyback`
 */

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

interface IPoolManager {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }
}

contract SovereignHook {
    // ─── Immutable wiring ────────────────────────────────────────────────────
    address public immutable factory;
    address public immutable agentTreasury;

    /// @notice ERC-20 traded against the chain's native asset. Bound once by the factory.
    address public targetToken;

    uint256 public immutable lpFeeBps;
    uint256 public immutable treasuryBuybackBps;

    uint256 public constant MAX_TOTAL_FEE_BPS = 500; // hard cap 5%
    uint256 public constant BPS_DENOMINATOR = 10_000;

    // Legacy constants kept so existing integrations/ABIs keep resolving.
    uint256 public constant LP_FEE_BPS = 20;
    uint256 public constant TREASURY_BUYBACK_BPS = 10;
    uint256 public constant TOTAL_FEE_BPS = 30;

    // ─── Pool state ──────────────────────────────────────────────────────────
    bool public initialized;

    // Reserves are uint256 on purpose. They were uint112 to pack into one slot,
    // but every update went through an explicit `uint112(...)` cast, and in
    // Solidity 0.8 an explicit narrowing conversion does NOT revert on overflow —
    // it truncates silently. A single truncation would corrupt the invariant and
    // there is no way to repair an immutable contract. One extra storage slot is
    // a cheap price for removing that class of failure entirely.
    uint256 private _reserveNative;
    uint256 private _reserveToken;

    /// @notice Native accrued for the agent buyback vault. Excluded from reserves.
    uint256 public treasuryNative;

    uint256 public totalTreasuryFeesCollected;
    uint256 public totalTokensBurned;
    uint256 public totalVolumeNative;
    uint256 public swapCount;

    uint256 private _locked;

    // ─── Events ──────────────────────────────────────────────────────────────
    event PoolInitialized(uint256 reserveNative, uint256 reserveToken);
    event Swap(
        address indexed trader,
        address indexed recipient,
        bool isBuy,
        uint256 amountIn,
        uint256 amountOut,
        uint256 lpFee,
        uint256 treasuryFee,
        uint256 reserveNativeAfter,
        uint256 reserveTokenAfter
    );
    event TreasuryFeeCollected(address indexed currency, uint256 amount);
    event AutoBuybackExecuted(uint256 amountIn, uint256 tokensBurned);
    event TokensLockedAsBurn(uint256 amount);

    // ─── Modifiers ───────────────────────────────────────────────────────────
    modifier nonReentrant() {
        require(_locked == 0, "SovereignHook: reentrant");
        _locked = 1;
        _;
        _locked = 0;
    }

    modifier onlyAgent() {
        require(msg.sender == agentTreasury || msg.sender == factory, "SovereignHook: unauthorized");
        _;
    }

    modifier onlyFactory() {
        require(msg.sender == factory, "SovereignHook: only factory");
        _;
    }

    modifier ensure(uint256 deadline) {
        require(deadline == 0 || block.timestamp <= deadline, "SovereignHook: expired");
        _;
    }

    modifier live() {
        require(initialized, "SovereignHook: pool not initialized");
        _;
    }

    constructor(
        address _factory,
        address _agentTreasury,
        address _targetToken,
        uint256 _lpFeeBps,
        uint256 _treasuryBuybackBps
    ) {
        require(_factory != address(0) && _agentTreasury != address(0), "SovereignHook: zero address");
        require(_lpFeeBps + _treasuryBuybackBps <= MAX_TOTAL_FEE_BPS, "SovereignHook: fee too high");
        factory = _factory;
        agentTreasury = _agentTreasury;
        targetToken = _targetToken;
        lpFeeBps = _lpFeeBps;
        treasuryBuybackBps = _treasuryBuybackBps;
    }

    // ─── Setup ───────────────────────────────────────────────────────────────

    /// @notice Bind the ERC-20 after deployment. Lets the factory deploy the pool
    ///         first so the token can reference the pool address immutably.
    function bindToken(address token) external onlyFactory {
        require(targetToken == address(0), "SovereignHook: token already bound");
        require(token != address(0), "SovereignHook: zero token");
        targetToken = token;
    }

    /// @notice Seed the pool. Caller must have approved `tokenAmount` first.
    function initializePool(uint256 tokenAmount) external payable nonReentrant {
        require(!initialized, "SovereignHook: already initialized");
        require(targetToken != address(0), "SovereignHook: token not bound");
        require(msg.value > 0, "SovereignHook: native seed required");
        require(tokenAmount > 0, "SovereignHook: token seed required");

        require(
            IERC20Minimal(targetToken).transferFrom(msg.sender, address(this), tokenAmount),
            "SovereignHook: token seed transfer failed"
        );

        _reserveNative = msg.value;
        _reserveToken = tokenAmount;
        initialized = true;

        emit PoolInitialized(msg.value, tokenAmount);
    }

    // ─── Quoting (view) ──────────────────────────────────────────────────────

    function getReserves() external view returns (uint256 reserveNative, uint256 reserveToken) {
        return (uint256(_reserveNative), uint256(_reserveToken));
    }

    /// @return tokensOut tokens the caller receives for `nativeIn`
    /// @return lpFee     portion retained by the pool for LPs
    /// @return treasuryFee portion routed to the agent buyback vault
    function getBuyQuote(uint256 nativeIn)
        public
        view
        returns (uint256 tokensOut, uint256 lpFee, uint256 treasuryFee)
    {
        if (!initialized || nativeIn == 0) return (0, 0, 0);
        lpFee = (nativeIn * lpFeeBps) / BPS_DENOMINATOR;
        treasuryFee = (nativeIn * treasuryBuybackBps) / BPS_DENOMINATOR;
        uint256 amountInAfterFee = nativeIn - lpFee - treasuryFee;
        tokensOut = (uint256(_reserveToken) * amountInAfterFee) / (uint256(_reserveNative) + amountInAfterFee);
    }

    /// @return nativeOut native the caller receives for `tokenIn`
    function getSellQuote(uint256 tokenIn)
        public
        view
        returns (uint256 nativeOut, uint256 lpFee, uint256 treasuryFee)
    {
        if (!initialized || tokenIn == 0) return (0, 0, 0);
        uint256 grossOut = (uint256(_reserveNative) * tokenIn) / (uint256(_reserveToken) + tokenIn);
        lpFee = (grossOut * lpFeeBps) / BPS_DENOMINATOR;
        treasuryFee = (grossOut * treasuryBuybackBps) / BPS_DENOMINATOR;
        nativeOut = grossOut - lpFee - treasuryFee;
    }

    /// @notice Spot price expressed as native wei per 1e18 token units.
    function spotPriceNativePerToken() external view returns (uint256) {
        if (!initialized || _reserveToken == 0) return 0;
        return (uint256(_reserveNative) * 1e18) / uint256(_reserveToken);
    }

    // ─── Trading ─────────────────────────────────────────────────────────────

    /// @notice Buy the target token with the chain's native asset.
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

    /// @notice Sell the target token for the chain's native asset.
    /// @dev Requires `IERC20(targetToken).approve(pool, tokenAmountIn)` beforehand.
    function sell(uint256 tokenAmountIn, uint256 minNativeOut, address to, uint256 deadline)
        external
        nonReentrant
        live
        ensure(deadline)
        returns (uint256 nativeOut)
    {
        require(tokenAmountIn > 0, "SovereignHook: zero token amount");
        address recipient = to == address(0) ? msg.sender : to;

        (uint256 quotedOut, uint256 lpFee, uint256 treasuryFee) = getSellQuote(tokenAmountIn);
        require(quotedOut > 0, "SovereignHook: insufficient output");
        require(quotedOut >= minNativeOut, "SovereignHook: slippage");
        require(quotedOut + treasuryFee < uint256(_reserveNative), "SovereignHook: insufficient native liquidity");

        // Explicit pre-checks so the caller gets an actionable reason instead of
        // an opaque ERC-20 custom error bubbling up through the pool.
        require(
            IERC20Minimal(targetToken).balanceOf(msg.sender) >= tokenAmountIn,
            "SovereignHook: insufficient token balance"
        );
        require(
            IERC20Minimal(targetToken).allowance(msg.sender, address(this)) >= tokenAmountIn,
            "SovereignHook: approve the pool before selling"
        );

        require(
            IERC20Minimal(targetToken).transferFrom(msg.sender, address(this), tokenAmountIn),
            "SovereignHook: transferFrom failed"
        );

        _reserveToken = _reserveToken + tokenAmountIn;
        _reserveNative = _reserveNative - quotedOut - treasuryFee;
        treasuryNative += treasuryFee;
        totalTreasuryFeesCollected += treasuryFee;
        totalVolumeNative += quotedOut;
        swapCount += 1;

        (bool sent, ) = payable(recipient).call{value: quotedOut}("");
        require(sent, "SovereignHook: native transfer failed");

        emit TreasuryFeeCollected(address(0), treasuryFee);
        emit Swap(
            msg.sender,
            recipient,
            false,
            tokenAmountIn,
            quotedOut,
            lpFee,
            treasuryFee,
            uint256(_reserveNative),
            uint256(_reserveToken)
        );

        return quotedOut;
    }

    /// @notice Plain native transfers are executed as a market buy (no slippage bound).
    receive() external payable {
        require(initialized, "SovereignHook: pool not initialized");
        require(_locked == 0, "SovereignHook: reentrant");
        _locked = 1;
        _buy(0, msg.sender);
        _locked = 0;
    }

    function _buy(uint256 minTokensOut, address recipient) private returns (uint256 tokensOut) {
        require(msg.value > 0, "SovereignHook: zero native in");

        uint256 lpFee;
        uint256 treasuryFee;
        (tokensOut, lpFee, treasuryFee) = getBuyQuote(msg.value);

        require(tokensOut > 0, "SovereignHook: insufficient output");
        require(tokensOut >= minTokensOut, "SovereignHook: slippage");
        require(tokensOut < uint256(_reserveToken), "SovereignHook: insufficient token liquidity");

        // LP fee stays in the pool; treasury fee is carved out of the reserves.
        _reserveNative = _reserveNative + msg.value - treasuryFee;
        _reserveToken = _reserveToken - tokensOut;
        treasuryNative += treasuryFee;
        totalTreasuryFeesCollected += treasuryFee;
        totalVolumeNative += msg.value;
        swapCount += 1;

        require(
            IERC20Minimal(targetToken).transfer(recipient, tokensOut),
            "SovereignHook: token transfer failed"
        );

        emit TreasuryFeeCollected(address(0), treasuryFee);
        emit Swap(
            msg.sender,
            recipient,
            true,
            msg.value,
            tokensOut,
            lpFee,
            treasuryFee,
            uint256(_reserveNative),
            uint256(_reserveToken)
        );
    }

    // ─── Agent buyback & burn ────────────────────────────────────────────────

    /// @notice Spend the accrued treasury native to buy tokens from the pool and
    ///         remove them from circulation.
    function executeBuyback(uint256 nativeAmount, uint256 minTokensBurned)
        external
        onlyAgent
        nonReentrant
        live
        returns (uint256 tokensBurned)
    {
        uint256 spend = nativeAmount == 0 ? treasuryNative : nativeAmount;
        require(spend > 0 && spend <= treasuryNative, "SovereignHook: invalid buyback amount");

        tokensBurned = (uint256(_reserveToken) * spend) / (uint256(_reserveNative) + spend);
        require(tokensBurned > 0 && tokensBurned < uint256(_reserveToken), "SovereignHook: buyback too small");
        require(tokensBurned >= minTokensBurned, "SovereignHook: buyback slippage");

        treasuryNative -= spend;
        _reserveNative = _reserveNative + spend;
        _reserveToken = _reserveToken - tokensBurned;
        totalTokensBurned += tokensBurned;

        // Prefer a real supply burn; otherwise the tokens stay locked in this
        // contract and permanently outside the tradable reserves.
        try IAdextoToken(targetToken).executeTreasuryBuyback(tokensBurned) {
            emit AutoBuybackExecuted(spend, tokensBurned);
        } catch {
            emit TokensLockedAsBurn(tokensBurned);
            emit AutoBuybackExecuted(spend, tokensBurned);
        }
    }

    /// @notice Kept for the 0G TEE agent / Helm scheduler.
    function executeScheduledBurn(uint256 tokensToBurn) external onlyAgent {
        require(tokensToBurn > 0, "SovereignHook: zero burn amount");
        totalTokensBurned += tokensToBurn;
        IAdextoToken(targetToken).executeTreasuryBuyback(tokensToBurn);
        emit AutoBuybackExecuted(tokensToBurn, tokensToBurn);
    }

    // ─── Uniswap v4 compatibility ────────────────────────────────────────────

    function afterSwap(
        address,
        IPoolManager.PoolKey calldata key,
        int128 amount0Delta,
        int128 amount1Delta,
        bytes calldata
    ) external returns (bytes4, int128) {
        uint256 swapVolume = amount0Delta > 0 ? uint256(int256(amount0Delta)) : uint256(int256(amount1Delta));
        uint256 treasuryFee = (swapVolume * treasuryBuybackBps) / BPS_DENOMINATOR;

        if (treasuryFee > 0) {
            totalTreasuryFeesCollected += treasuryFee;
            emit TreasuryFeeCollected(key.currency0, treasuryFee);
        }

        return (this.afterSwap.selector, 0);
    }
}
