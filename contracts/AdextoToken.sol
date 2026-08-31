// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title AdextoToken
 * @notice ERC-20 launched by AdextoCurveFactory for ADEXTO Protocol (adexto.xyz).
 *         Carries an immutable agent identity reference (ERC-8004 style).
 *
 * @dev NO OWNER, AND THAT IS THE FIX
 *
 * This contract used to inherit `Ownable` with `Ownable(msg.sender)`. `msg.sender`
 * at construction is the factory, so `owner()` was the factory on every token ever
 * launched — and the factory has no function that uses it. The single `onlyOwner`
 * function was `disableAntiSnipe()`, which therefore could never be called by
 * anyone, so `antiSnipeActive` was permanently stuck at `true`.
 *
 * That combination was worse than useless. Every transfer paid an SLOAD to read a
 * flag that could not change, and every explorer and honeypot scanner reported the
 * token as having an owner — implying an admin lever that in fact did not exist.
 * "Has an owner" is one of the first things a buyer checks, and the honest answer
 * here is that nobody does.
 *
 * `Ownable` is gone. The anti-sniper exemption that needed `owner()` now uses
 * `_launcher`, an immutable set to the deployer at construction.
 *
 * WHY `_launcher` MUST EXIST AND MUST BE EXEMPT
 *
 * The factory mints the whole supply to itself and then moves 100% of it into the
 * curve in the same transaction. That single transfer is, by definition, far above
 * the 1% per-transaction anti-sniper limit. If the launcher were not exempt, every
 * launch would revert on its own seeding step. The old code got this right via
 * `owner()`; removing `Ownable` without replacing that check would have broken
 * every launch.
 */
contract AdextoToken is ERC20 {
    address public immutable agentIdentity;
    address public immutable sovereignDexHook;
    uint256 public immutable maxTxAmount;
    uint256 public immutable launchBlock;

    /**
     * @dev The factory that deployed this token. Exempt from the anti-sniper limit
     *      so it can move the whole supply into the curve during the launch
     *      transaction. Holds no privileges beyond that exemption: there is no
     *      function it can call on this contract.
     */
    address private immutable _launcher;

    /// @notice Blocks after `launchBlock` during which the per-transaction cap applies.
    uint256 public constant ANTI_SNIPE_BLOCKS = 5;

    event AgentTreasuryBuyback(uint256 amountIn, uint256 tokensBurned);

    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply,
        address _agentIdentity,
        address _sovereignDexHook,
        uint256 _maxTxPercentBps
    ) ERC20(name, symbol) {
        require(_agentIdentity != address(0), "Invalid agent identity");
        agentIdentity = _agentIdentity;
        sovereignDexHook = _sovereignDexHook;
        maxTxAmount = (initialSupply * 10 ** decimals() * _maxTxPercentBps) / 10000;
        launchBlock = block.number;
        _launcher = msg.sender;

        _mint(msg.sender, initialSupply * 10 ** decimals());
    }

    function _update(address from, address to, uint256 value) internal virtual override {
        // The launcher moves the entire supply into the curve during the launch
        // transaction, which is far above `maxTxAmount` by construction.
        if (from != _launcher && to != _launcher && block.number <= launchBlock + ANTI_SNIPE_BLOCKS) {
            require(value <= maxTxAmount, "Anti-sniper: Exceeds max transaction limit");
        }
        super._update(from, to, value);
    }

    /**
     * @notice Burn tokens held by the caller, reducing total supply.
     * @dev Called by the curve during a buyback, which buys on the curve first and
     *      then burns what it bought. Restricted to the two immutable addresses so
     *      no third party can burn from a balance it does not control — `_burn`
     *      takes from `msg.sender`, so this can only ever destroy the caller's own
     *      tokens.
     */
    function executeTreasuryBuyback(uint256 amountToBurn) external {
        require(msg.sender == agentIdentity || msg.sender == sovereignDexHook, "Unauthorized agent");
        _burn(msg.sender, amountToBurn);
        emit AgentTreasuryBuyback(amountToBurn, amountToBurn);
    }
}
