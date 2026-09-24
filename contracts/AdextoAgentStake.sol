// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20Stake {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title AdextoAgentStake
 * @notice Stake $ADEXTO to activate an autonomous agent and unlock its compute quota.
 *
 * WHAT THIS CONTRACT DOES, AND DELIBERATELY DOES NOT DO
 *
 * It holds stake and reports it. That is all. It does not price compute, does not track token
 * usage, and does not know what a quota is.
 *
 * That split is the whole design. Compute policy — how many AI tokens a given stake is worth,
 * which model answers, what the beta ceiling is — will change many times, and none of those
 * changes should require touching a contract that holds other people's money. So the contract
 * answers one question, `stakedOf(address)`, and the policy lives off-chain where it can be
 * corrected without a migration.
 *
 * NO OWNER, AND NOTHING PRIVILEGED
 *
 * There is no owner, no pause, no emergency withdrawal, no upgrade path and no function that can
 * move somebody else's stake. `unstake` sends to `msg.sender` and nowhere else — the recipient is
 * not a parameter, so there is no version of this that lets one address drain another's position.
 * This follows the same rule as the curves: the guarantee is that nobody can be rescued, because
 * a contract that can rescue you can also rob you.
 *
 * NO LOCK PERIOD, AND THIS IS STATED RATHER THAN IMPLIED
 *
 * `unstake` works immediately. There is no cooldown and no vesting, and the word "stake" here
 * should not be read as promising one. The lesson is recent and specific: `executeBuyback` carried
 * a comment claiming "each further attempt must wait for the treasury to refill" while no waiting
 * existed, and a reporter found it (GHSA-g589-wjqq-86f2, finding 1). So what is written here is
 * exactly what the code does.
 *
 * What staking buys over simply holding is that the position is visibly committed while it earns
 * compute: the tokens cannot be spent or sold without first unstaking, and one balance cannot
 * activate two agents by being moved between wallets.
 *
 * @dev Deployed per chain, bound to one token, and that binding is immutable.
 */
contract AdextoAgentStake {
    /// @notice The staked token. Immutable: a stake contract that can change the asset underneath
    ///         its depositors is not a stake contract.
    IERC20Stake public immutable stakeToken;

    /**
     * @notice Smallest accepted stake, in the token's smallest unit.
     * @dev Immutable but set at deployment rather than hard-coded, because the figure is a policy
     *      choice that can reasonably differ per chain — the same nominal amount is not the same
     *      value everywhere — while still being fixed for the life of any one deployment.
     */
    uint256 public immutable minStake;

    /// @notice Current stake per address.
    mapping(address => uint256) public stakedOf;

    /// @notice Sum of every open position. Cheaper for readers than scanning events.
    uint256 public totalStaked;

    /// @notice Number of addresses holding a non-zero stake.
    uint256 public stakerCount;

    /**
     * @notice When each address last increased its stake.
     * @dev Recorded for off-chain policy — "activated since" in the UI, ordering, future
     *      eligibility rules — NOT used by this contract to restrict anything. It has no effect on
     *      `unstake`. Writing it here is cheap; needing it later and not having it is not.
     */
    mapping(address => uint256) public lastStakeAt;

    event Staked(address indexed staker, uint256 amount, uint256 newTotal);
    event Unstaked(address indexed staker, uint256 amount, uint256 newTotal);

    constructor(address token, uint256 minimumStake) {
        require(token != address(0), "AgentStake: zero token");
        require(minimumStake > 0, "AgentStake: zero minimum");
        stakeToken = IERC20Stake(token);
        minStake = minimumStake;
    }

    /**
     * @notice Stake `amount`. Requires an ERC-20 approval to this contract first.
     * @dev `minStake` is checked against the RESULTING position, not against `amount`, so topping
     *      up an existing position with a small addition is allowed while a first stake below the
     *      minimum is not. Checking `amount` instead would reject a 1-token top-up on a large
     *      position, which no reading of "minimum stake" implies.
     */
    function stake(uint256 amount) external {
        require(amount > 0, "AgentStake: zero amount");

        uint256 previous = stakedOf[msg.sender];
        uint256 updated = previous + amount;
        require(updated >= minStake, "AgentStake: below minimum stake");

        // Effects before the transfer: checks-effects-interactions. If the transfer fails the whole
        // transaction reverts, so these writes cannot survive a failed pull.
        stakedOf[msg.sender] = updated;
        totalStaked += amount;
        lastStakeAt[msg.sender] = block.timestamp;
        if (previous == 0) stakerCount += 1;

        /**
         * Return value is CHECKED, not assumed.
         *
         * `transferFrom` returning false rather than reverting is permitted by ERC-20 and real
         * tokens do it. Ignoring it here would credit a stake that never arrived, and the
         * accounting would be wrong from that moment on with nothing pointing at the cause.
         */
        require(
            stakeToken.transferFrom(msg.sender, address(this), amount),
            "AgentStake: transferFrom failed"
        );

        emit Staked(msg.sender, amount, updated);
    }

    /**
     * @notice Withdraw `amount` of your own stake. Always to `msg.sender`.
     * @dev The remaining position must be either zero or still at or above `minStake`. Partial
     *      exits that would leave a dust position below the minimum are rejected rather than
     *      silently closed for you, because closing someone's position on their behalf is a
     *      decision this contract has no business making.
     */
    function unstake(uint256 amount) external {
        uint256 current = stakedOf[msg.sender];
        require(amount > 0, "AgentStake: zero amount");
        require(amount <= current, "AgentStake: amount exceeds stake");

        uint256 remaining = current - amount;
        require(remaining == 0 || remaining >= minStake, "AgentStake: remainder below minimum");

        stakedOf[msg.sender] = remaining;
        totalStaked -= amount;
        if (remaining == 0) stakerCount -= 1;

        require(stakeToken.transfer(msg.sender, amount), "AgentStake: transfer failed");

        emit Unstaked(msg.sender, amount, remaining);
    }

    /// @notice Withdraw the whole position in one call.
    function unstakeAll() external {
        uint256 current = stakedOf[msg.sender];
        require(current > 0, "AgentStake: nothing staked");

        stakedOf[msg.sender] = 0;
        totalStaked -= current;
        stakerCount -= 1;

        require(stakeToken.transfer(msg.sender, current), "AgentStake: transfer failed");

        emit Unstaked(msg.sender, current, 0);
    }

    /// @notice Whether `account` currently meets the minimum, i.e. its agent is activated.
    function isActive(address account) external view returns (bool) {
        return stakedOf[account] >= minStake;
    }

    /**
     * @notice Token balance this contract holds versus what it has accounted for.
     * @dev Both returned so a reader can compare them. They are equal unless somebody transfers
     *      tokens straight to this address, which credits nobody — there is no function that can
     *      assign such a transfer to a staker, and no owner who could sweep it. Anyone doing that
     *      has donated to the contract permanently, and `surplus` is how it becomes visible
     *      instead of silently distorting `totalStaked`.
     */
    function accounting() external view returns (uint256 held, uint256 accounted, uint256 surplus) {
        held = stakeToken.balanceOf(address(this));
        accounted = totalStaked;
        surplus = held > accounted ? held - accounted : 0;
    }
}
