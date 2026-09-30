// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title AdextoToken
 * @notice Fixed-supply ERC-20 created by AdextoFactory for one ADEXTO market (adexto.xyz).
 *         The whole supply is minted to the factory and moved into the market's bonding
 *         curve inside the launch transaction.
 *
 * @dev NO OWNER. There is no `Ownable`, no pause, no blacklist, no fee on transfer, and no
 * mint after the constructor. The only restriction this contract ever applies is the
 * launch window below, and it ends by itself.
 *
 * LAUNCH WINDOW (ANTI-SNIPER)
 *
 * For `ANTI_SNIPE_WINDOW` seconds after deployment, no wallet may hold more than
 * `maxWalletAmount`, which is 1% of supply for every market AdextoFactory launches. The
 * check runs on the receiving side after the balance has been updated, so a wallet cannot
 * pass the limit in one purchase, by splitting a purchase across many transactions, or by
 * collecting transfers from other wallets. Once the window has passed there is no
 * restriction of any kind.
 *
 * Three recipients are exempt, and the market cannot work without each exemption:
 *   - the curve (`sovereignDexHook`), so that holders can sell during the window;
 *   - address(0), so that buyback burns are never blocked;
 *   - the launcher (the factory), which receives the mint and seeds the curve with it.
 *
 * Seconds rather than blocks: earlier generations counted five blocks with `block.number`.
 * Block times differ by chain, and on Arbitrum Nitro chains `block.number` follows the
 * parent chain, so one constant produced about 60 s on Arbitrum One, 10 s on Base and 2 s
 * on Monad. `block.timestamp` gives every chain the same window.
 *
 * Per wallet rather than per transaction: earlier generations capped each transfer at 1%,
 * which one wallet could repeat as often as it liked inside the window. Capping what a
 * wallet may hold removes that. Many wallets can still take 1% each; every one of them
 * pays its own gas and a price the curve has already raised, and that cost is what the
 * window exists to impose.
 *
 * AGENT IDENTITY
 *
 * `agentIdentity` is an operational address that may burn tokens it holds itself through
 * `executeTreasuryBuyback`. `agentBound`, `agentId` and `agentRegistry` record an optional
 * ERC-8004 identity, bound once at construction after the factory checked that the
 * launcher owns it. Read `agentBound` first: agent id 0 is a real, owned agent on every
 * chain ADEXTO runs on, so an id of 0 does not mean "no agent".
 */
contract AdextoToken is ERC20 {
    /// @notice Operational agent address. May burn its own tokens via `executeTreasuryBuyback`.
    address public immutable agentIdentity;

    /**
     * @notice True when this token is bound to an ERC-8004 agent identity.
     * @dev Read this before `agentId`, because agent id 0 is a real agent.
     */
    bool public immutable agentBound;

    /**
     * @notice ERC-8004 agent id bound to this token. Meaningful only when `agentBound`.
     * @dev Never reassignable. The agent NFT itself stays transferable; the binding to
     *      this token does not move with it.
     */
    uint256 public immutable agentId;

    /**
     * @notice ERC-8004 Identity Registry that `agentId` belongs to, or address(0) if unbound.
     * @dev An agent id is unique only together with its chain and registry, which ERC-8004
     *      writes as `{namespace}:{chainId}:{identityRegistry}`. The chain is implicit.
     */
    address public immutable agentRegistry;

    /// @notice Emitted once, at construction, when an ERC-8004 identity is attached.
    event AgentIdentityBound(uint256 indexed agentId, address indexed agentRegistry);

    /// @notice The market's bonding curve. The name is kept for ABI compatibility.
    address public immutable sovereignDexHook;

    /// @notice Most a single wallet may hold during the launch window, in token wei.
    uint256 public immutable maxWalletAmount;

    /// @notice `block.timestamp` at deployment. The launch window starts here.
    uint256 public immutable launchTime;

    /// @notice `block.number` at deployment. Informational only; nothing reads it on chain.
    uint256 public immutable launchBlock;

    /**
     * @dev The factory that deployed this token. Exempt as a recipient so it can receive the
     *      mint. It holds no other privilege: no function on this contract checks for it.
     */
    address private immutable _launcher;

    /// @notice Length of the launch window, in seconds.
    uint256 public constant ANTI_SNIPE_WINDOW = 180;

    event AgentTreasuryBuyback(uint256 amountIn, uint256 tokensBurned);

    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply,
        address _agentIdentity,
        address _sovereignDexHook,
        uint256 _maxWalletBps,
        bool _agentBound,
        uint256 _agentId,
        address _agentRegistry
    ) ERC20(name, symbol) {
        require(_agentIdentity != address(0), "Invalid agent identity");
        require(_sovereignDexHook != address(0), "Invalid curve");
        require(_maxWalletBps > 0 && _maxWalletBps <= 10_000, "Invalid wallet limit");
        // A binding needs a registry to resolve against, and an unbound token must not carry
        // an id or a registry that would read as a binding. Both halves are immutable once
        // this constructor returns, so they are checked rather than assumed.
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
        maxWalletAmount = (initialSupply * 10 ** decimals() * _maxWalletBps) / 10_000;
        launchTime = block.timestamp;
        launchBlock = block.number;
        _launcher = msg.sender;

        _mint(msg.sender, initialSupply * 10 ** decimals());
    }

    /**
     * @dev Applies the launch-window limit to the recipient's balance after the transfer.
     *      The time check comes first so that, once the window has passed, every transfer
     *      pays for one comparison and nothing else.
     */
    function _update(address from, address to, uint256 value) internal virtual override {
        super._update(from, to, value);
        if (
            block.timestamp < launchTime + ANTI_SNIPE_WINDOW && to != address(0) && to != sovereignDexHook
                && to != _launcher
        ) {
            require(balanceOf(to) <= maxWalletAmount, "Anti-sniper: wallet limit during launch window");
        }
    }

    /**
     * @notice Burn tokens held by the caller, reducing total supply.
     * @dev Called by the curve during a buyback, which buys on the curve first and then burns
     *      what it bought. Restricted to the two immutable addresses, and `_burn` takes from
     *      `msg.sender`, so this can only ever destroy the caller's own tokens.
     */
    function executeTreasuryBuyback(uint256 amountToBurn) external {
        require(msg.sender == agentIdentity || msg.sender == sovereignDexHook, "Unauthorized agent");
        _burn(msg.sender, amountToBurn);
        emit AgentTreasuryBuyback(amountToBurn, amountToBurn);
    }
}
