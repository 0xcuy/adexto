// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @dev The four ERC-20 calls the hub makes. Named for this contract so no artifact collides.
interface IERC20StakeHub {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

/// @dev The one factory view the hub reads. Both AdextoFactory 0.11.0 and 1.0.0 expose it.
interface IAdextoFactoryLookup {
    function curveOf(address token) external view returns (address);
}

/**
 * @title AdextoStakeHub
 * @notice One stake contract per chain for every market launched through ADEXTO.
 *
 * WHY ONE HUB INSTEAD OF ONE CONTRACT PER TOKEN
 *
 * `AdextoAgentStake` is bound to one token and has to be deployed for it, by somebody, after the
 * market exists. That made staking something a market got only if we deployed for it. The hub
 * removes the step: any token created by an ADEXTO factory can be staked here from its first
 * block, with nothing deployed and nobody asked.
 *
 * WHICH TOKENS IT ACCEPTS, AND WHY THAT CHECK CANNOT BE FAKED
 *
 * A token is accepted when one of the factories fixed at construction returns a curve for it from
 * `curveOf(token)`. That mapping is written by the factory itself inside `deployTrinity`, in the
 * same transaction that creates the token, so a token from anywhere else cannot appear in it. The
 * factories have no owner and no upgrade path, so the answer cannot change later either.
 *
 * Tokens listed at construction as having their own `AdextoAgentStake` are refused, so a market
 * never has two stake contracts whose positions disagree. That list is written once, in the
 * constructor, and has no setter: the same pattern as the reserved tickers in `AdextoFactory`.
 *
 * THE MINIMUM IS A SHARE OF SUPPLY, NOT A FIXED AMOUNT
 *
 * One hub serves markets of any supply and any price, so a fixed number of tokens would mean a
 * different thing in every market. The minimum is 0.001% of the token's current total supply
 * (`totalSupply() / 100_000`): 10,000 tokens for a 1,000,000,000 supply, the same as the dedicated
 * $SAI stakes. Supply only falls (buyback burns), so a position that met the minimum keeps meeting
 * it. Like `AdextoAgentStake`, the minimum applies to the resulting position, not to each amount.
 *
 * NO OWNER, AND NOTHING PRIVILEGED
 *
 * There is no owner, no pause, no emergency withdrawal, no upgrade path and no function that can
 * move somebody else's stake. `unstake` and `unstakeAll` pay `msg.sender` and nobody else.
 *
 * NO LOCK, AND NO REWARD
 *
 * Unstaking works at any time. The hub pays nothing: what a stake opens (the market's agent over
 * MCP, and compute funded by that market's own trading) is decided off chain from what this
 * contract reports, exactly as with `AdextoAgentStake`.
 *
 * ONE INTERACTION WORTH KNOWING: THE LAUNCH WINDOW
 *
 * For its first 180 seconds an ADEXTO v1 token lets no wallet hold more than 1% of supply, and
 * the hub is a wallet like any other. During that window the hub's whole balance of that token,
 * summed over every staker, cannot pass 1% of supply, and a stake that would take it past reverts
 * with the token's own message. After the window there is no limit.
 */
contract AdextoStakeHub {
    string public constant VERSION = "1.0.0";

    /// @notice The minimum stake is `totalSupply() / MIN_STAKE_DIVISOR`, i.e. 0.001% of supply.
    uint256 public constant MIN_STAKE_DIVISOR = 100_000;

    /// @notice Most factories one hub can read. Each stake call checks each of them once.
    uint256 public constant MAX_FACTORIES = 4;

    /// @dev Written in the constructor only. Exposed through `factories()`.
    address[] private _factories;

    /// @dev Written in the constructor only. Exposed through `tokensWithOwnStake()`.
    address[] private _ownStakeTokens;

    /// @notice Tokens that have their own `AdextoAgentStake` and are therefore refused here.
    mapping(address => bool) public hasOwnStake;

    /// @notice Current stake of `account` in `token`: `stakedOf[token][account]`.
    mapping(address => mapping(address => uint256)) public stakedOf;

    /// @notice Sum of every open position in `token`.
    mapping(address => uint256) public totalStaked;

    /// @notice Number of addresses holding a non-zero stake in `token`.
    mapping(address => uint256) public stakerCount;

    /// @notice When `account` last increased its stake in `token`. Recorded, never enforced.
    mapping(address => mapping(address => uint256)) public lastStakeAt;

    /// @dev 1 = not entered, 2 = entered. Starts at 1 so the first call pays no zero-to-nonzero write.
    uint256 private _lock = 1;

    event FactoryAccepted(address indexed factory);
    event OwnStakeExcluded(address indexed token);
    event Staked(address indexed token, address indexed staker, uint256 amount, uint256 newPosition);
    event Unstaked(address indexed token, address indexed staker, uint256 amount, uint256 newPosition);

    modifier nonReentrant() {
        require(_lock == 1, "StakeHub: reentrant call");
        _lock = 2;
        _;
        _lock = 1;
    }

    /**
     * @param adextoFactories The ADEXTO factories on this chain whose tokens may be staked, one to
     *        four. Each must already have code, so a mistyped address fails here, not later.
     * @param ownStakeTokens Tokens that already have an `AdextoAgentStake`, refused here.
     */
    constructor(address[] memory adextoFactories, address[] memory ownStakeTokens) {
        require(adextoFactories.length > 0 && adextoFactories.length <= MAX_FACTORIES, "StakeHub: one to four factories");
        for (uint256 i = 0; i < adextoFactories.length; i++) {
            address f = adextoFactories[i];
            require(f.code.length > 0, "StakeHub: factory has no code");
            for (uint256 j = 0; j < i; j++) {
                require(adextoFactories[j] != f, "StakeHub: duplicate factory");
            }
            _factories.push(f);
            emit FactoryAccepted(f);
        }
        for (uint256 i = 0; i < ownStakeTokens.length; i++) {
            address t = ownStakeTokens[i];
            require(t != address(0), "StakeHub: zero token");
            require(!hasOwnStake[t], "StakeHub: duplicate token");
            hasOwnStake[t] = true;
            _ownStakeTokens.push(t);
            emit OwnStakeExcluded(t);
        }
    }

    // ─── staking ───────────────────────────────────────────────────────────────

    /**
     * @notice Stake `amount` of `token`. Requires an ERC-20 approval to this contract first.
     * @dev The minimum is checked against the RESULTING position, so a small top-up of an active
     *      position is allowed while a first stake below the minimum is not.
     */
    function stake(address token, uint256 amount) external nonReentrant {
        require(amount > 0, "StakeHub: zero amount");
        require(!hasOwnStake[token], "StakeHub: token has its own stake contract");
        require(_madeByAdexto(token), "StakeHub: not an ADEXTO market token");

        uint256 previous = stakedOf[token][msg.sender];
        uint256 updated = previous + amount;
        require(updated >= minStakeOf(token), "StakeHub: below minimum stake");

        IERC20StakeHub erc20 = IERC20StakeHub(token);
        uint256 before = erc20.balanceOf(address(this));

        // Effects before the transfer. If the pull fails the whole call reverts with them.
        stakedOf[token][msg.sender] = updated;
        totalStaked[token] += amount;
        lastStakeAt[token][msg.sender] = block.timestamp;
        if (previous == 0) stakerCount[token] += 1;

        // The return value is checked, and so is what actually arrived: a position must never be
        // credited with more than this contract received.
        require(erc20.transferFrom(msg.sender, address(this), amount), "StakeHub: transferFrom failed");
        require(erc20.balanceOf(address(this)) == before + amount, "StakeHub: amount not received in full");

        emit Staked(token, msg.sender, amount, updated);
    }

    /**
     * @notice Withdraw `amount` of your own stake in `token`. Always to `msg.sender`.
     * @dev What remains must be zero or still at or above the minimum, so a partial exit cannot
     *      leave a dust position. `unstakeAll` closes a position whatever its size.
     */
    function unstake(address token, uint256 amount) external nonReentrant {
        uint256 current = stakedOf[token][msg.sender];
        require(amount > 0, "StakeHub: zero amount");
        require(amount <= current, "StakeHub: amount exceeds stake");

        uint256 remaining = current - amount;
        require(remaining == 0 || remaining >= minStakeOf(token), "StakeHub: remainder below minimum");

        stakedOf[token][msg.sender] = remaining;
        totalStaked[token] -= amount;
        if (remaining == 0) stakerCount[token] -= 1;

        require(IERC20StakeHub(token).transfer(msg.sender, amount), "StakeHub: transfer failed");

        emit Unstaked(token, msg.sender, amount, remaining);
    }

    /// @notice Withdraw your whole position in `token` in one call. Reads nothing but your position.
    function unstakeAll(address token) external nonReentrant {
        uint256 current = stakedOf[token][msg.sender];
        require(current > 0, "StakeHub: nothing staked");

        stakedOf[token][msg.sender] = 0;
        totalStaked[token] -= current;
        stakerCount[token] -= 1;

        require(IERC20StakeHub(token).transfer(msg.sender, current), "StakeHub: transfer failed");

        emit Unstaked(token, msg.sender, current, 0);
    }

    // ─── views ─────────────────────────────────────────────────────────────────

    /// @notice Smallest accepted position in `token`, in its smallest unit: 0.001% of current supply.
    function minStakeOf(address token) public view returns (uint256) {
        uint256 m = IERC20StakeHub(token).totalSupply() / MIN_STAKE_DIVISOR;
        return m == 0 ? 1 : m;
    }

    /// @notice Whether `account` holds a position in `token` at or above the minimum.
    function isActive(address token, address account) external view returns (bool) {
        uint256 s = stakedOf[token][account];
        return s > 0 && s >= minStakeOf(token);
    }

    /// @notice Whether `token` can be staked here: made by an accepted factory and not excluded.
    function isEligible(address token) external view returns (bool) {
        if (token == address(0) || hasOwnStake[token]) return false;
        return _madeByAdexto(token);
    }

    /// @notice The factories fixed at construction.
    function factories() external view returns (address[] memory) {
        return _factories;
    }

    /// @notice The tokens refused because they have their own stake contract.
    function tokensWithOwnStake() external view returns (address[] memory) {
        return _ownStakeTokens;
    }

    /**
     * @notice What this contract holds of `token` against what it has accounted for.
     * @dev Equal unless somebody transferred `token` straight to this address. That credits
     *      nobody and cannot be withdrawn by anyone; `surplus` makes it visible.
     */
    function accounting(address token) external view returns (uint256 held, uint256 accounted, uint256 surplus) {
        held = IERC20StakeHub(token).balanceOf(address(this));
        accounted = totalStaked[token];
        surplus = held > accounted ? held - accounted : 0;
    }

    /// @dev True when an accepted factory returns a curve for `token`. A reverting factory counts as no.
    function _madeByAdexto(address token) internal view returns (bool) {
        if (token == address(0)) return false;
        uint256 n = _factories.length;
        for (uint256 i = 0; i < n; i++) {
            try IAdextoFactoryLookup(_factories[i]).curveOf(token) returns (address curve) {
                if (curve != address(0)) return true;
            } catch {}
        }
        return false;
    }
}
