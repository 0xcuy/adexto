// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title AdextoToken
 * @notice ERC-20 launched by AdextoCurveFactory for ADEXTO Protocol (adexto.xyz).
 *         Optionally bound to an ERC-8004 agent identity.
 *
 * @dev TWO DIFFERENT THINGS THAT BOTH GOT CALLED "THE AGENT"
 *
 * `agentIdentity` is an OPERATIONAL address: the only non-curve caller allowed to
 * invoke `executeTreasuryBuyback`. It has always existed here.
 *
 * `agentId` is an ERC-8004 IDENTITY: an ERC-721 token in the Identity Registry
 * whose `tokenURI` resolves to a registration file listing the agent's real service
 * endpoints. It is new, and it is what makes the agent discoverable by anything
 * outside this project.
 *
 * Earlier revisions carried only the address and the header of this file described
 * it as "ERC-8004 style". That phrasing was doing real work: `style` is an analogy,
 * and the product pages quietly upgraded the analogy into a compliance claim. The
 * contract implemented no `supportsInterface`, touched no registry, and had no
 * `agentId` — so anyone who checked found nothing. Rather than delete the claim,
 * this revision earns it: the factory verifies the caller owns `agentId` in the
 * canonical registry before binding it here, permanently.
 *
 * WHY THERE IS A SEPARATE `agentBound` FLAG INSTEAD OF TREATING id 0 AS "NONE"
 *
 * The first version of this used `agentId == 0` to mean "no identity". Testing
 * against the live registries killed that: `ownerOf(0)` returns a real owner on 0G,
 * Base, Arbitrum One and Monad mainnet, so agent 0 is an ordinary agent that
 * somebody owns on every chain we launch on. A zero sentinel would have made a
 * legitimately bound agent 0 indistinguishable from an unbound token, and locked
 * its owner out of ever binding it — permanently, because this bytecode is
 * immutable.
 *
 * The flag is explicit instead. Launching with no agent identity is still fully
 * supported and still the default, because requiring a registry round-trip would
 * turn a one-transaction launch into a two-transaction one for every creator,
 * including those who do not want an agent identity at all.
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
    /// @notice Operational agent address. May call `executeTreasuryBuyback`.
    address public immutable agentIdentity;

    /**
     * @notice True when this token is bound to an ERC-8004 agent identity.
     * @dev Read this BEFORE `agentId`. Agent id 0 is a real, owned agent on every
     *      mainnet we launch on, so the id alone cannot tell you whether a binding
     *      exists.
     */
    bool public immutable agentBound;

    /**
     * @notice ERC-8004 agent id bound to this token. Meaningful only if `agentBound`.
     * @dev Immutable and never reassignable. The factory checked that the launcher
     *      owned this agent at launch time; ownership of the agent NFT can change
     *      afterwards, which is by design — the agent is transferable, its binding
     *      to this token is not.
     */
    uint256 public immutable agentId;

    /**
     * @notice ERC-8004 Identity Registry that `agentId` lives in, or 0 if unbound.
     * @dev Recorded alongside the id because an agentId is only globally unique
     *      together with its chain and registry address. ERC-8004 writes that
     *      triple as `{namespace}:{chainId}:{identityRegistry}`; the chain id is
     *      implicit in where this token is deployed.
     */
    address public immutable agentRegistry;

    /// @notice Emitted once at construction when an ERC-8004 identity is attached.
    event AgentIdentityBound(uint256 indexed agentId, address indexed agentRegistry);

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
        uint256 _maxTxPercentBps,
        bool _agentBound,
        uint256 _agentId,
        address _agentRegistry
    ) ERC20(name, symbol) {
        require(_agentIdentity != address(0), "Invalid agent identity");
        // A binding needs somewhere to resolve, and an unbound token must not carry
        // an id or a registry that would read as one. Checked rather than assumed,
        // because both halves are immutable the moment this returns.
        if (_agentBound) {
            require(_agentRegistry != address(0), "Bound agent needs a registry");
        } else {
            require(_agentRegistry == address(0) && _agentId == 0, "Unbound agent must be zeroed");
        }
        agentIdentity = _agentIdentity;
        agentBound = _agentBound;
        agentId = _agentId;
        agentRegistry = _agentRegistry;
        sovereignDexHook = _sovereignDexHook;
        if (_agentBound) emit AgentIdentityBound(_agentId, _agentRegistry);
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
