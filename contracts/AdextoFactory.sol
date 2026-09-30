// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {AdextoToken} from "./AdextoToken.sol";
import {AdextoCurve} from "./AdextoCurve.sol";
import {IIdentityRegistry} from "./IIdentityRegistry.sol";

/**
 * @title AdextoFactory
 * @notice Opens an ADEXTO market (adexto.xyz) in one transaction: a token and its bonding
 *         curve, with no liquidity deposit, optionally bound to an ERC-8004 agent identity.
 *
 * @dev WHAT A LAUNCH GUARANTEES
 *
 *   - No deposit. The curve opens against a virtual native reserve, so `deployTrinity` is not
 *     payable and a launch costs gas only.
 *   - No allocation. 100% of supply is loaded into the curve, and the factory then requires
 *     its own balance to be exactly zero. The creator is paid from trading instead.
 *   - Fixed terms. Every fee leg is an immutable of the curve. Neither contract has an owner,
 *     a setter, a proxy or a pause. A different rate means a different factory at a different
 *     address.
 *   - Checked identity. When an agent is bound, the factory requires the caller to own that
 *     ERC-8004 agent before the market exists.
 *
 * WHAT A TRADER PAYS
 *
 * `swapFeeBps` is the whole fee on every trade. It is split four ways: the creator's share,
 * the buyback share, the protocol's `PROTOCOL_FEE_BPS`, and depth as the remainder, so the
 * four legs always add up to exactly what the trader was quoted. The studio's standard split
 * is 100 bps: creator 70, depth 10, buyback 10, protocol 10.
 *
 * The protocol leg is carved out of that total. It is not added on top of it. Generation
 * 0.11.0 added it on top, and every market that generation created keeps its own rates
 * permanently, because they are immutable.
 *
 * COMPATIBILITY
 *
 * `deployTrinity`, `projectAt` and every event keep the signatures of generation 0.11.0, so
 * one client path, one ABI and one indexer mapping read both generations.
 */
contract AdextoFactory {
    /**
     * @notice Generation of this factory and of the curves it deploys, read on chain.
     * @dev A behaviour change always raises this number. Two different bytecodes must never
     *      report the same version, or nothing outside the chain could tell them apart.
     */
    string public constant VERSION = "1.0.0";

    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Largest `initialSupply`, in WHOLE tokens (not wei).
    uint256 public constant MAX_SUPPLY = 1_000_000_000_000;

    /**
     * @notice Launch-window holding limit, in bps of supply: 1%.
     * @dev Passed to every token this factory deploys. The token enforces it per wallet for
     *      its `ANTI_SNIPE_WINDOW`. See `AdextoToken`.
     */
    uint256 public constant ANTI_SNIPER_BPS = 100;

    /**
     * @notice Protocol share of every trade, in bps: 0.10%. Carved out of `swapFeeBps`.
     * @dev A constant, so every market from this factory pays the same rate and the rate is
     *      readable before anyone trades.
     */
    uint256 public constant PROTOCOL_FEE_BPS = 10;

    /**
     * @notice Receives the protocol leg of every market this factory deploys.
     * @dev Immutable here and immutable in each curve, with no setter in either, so revenue
     *      from a launched market cannot be redirected by anyone, including us. A constructor
     *      argument rather than a constant so the same source deploys on every chain.
     */
    address public immutable protocolTreasury;

    /**
     * @notice ERC-8004 Identity Registry used to check agent ownership at launch.
     * @dev The same singleton address on every chain ADEXTO deploys to. Only `ownerOf` is ever
     *      called on it, declared `view`, so the call compiles to STATICCALL: an upgraded or
     *      hostile registry can make an agent-bound launch revert, but cannot change state
     *      during it or alter what the launch does.
     */
    address public constant AGENT_REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;

    struct ProjectDeployment {
        address token;
        address curve;
        address creator;
        string name;
        string symbol;
        uint256 virtualNative;
        uint256 depthFeeBps;
        uint256 creatorFeeBps;
        uint256 treasuryBuybackBps;
        uint256 protocolFeeBps;
        /// @dev 0G DA storage root of the launch metadata. A content pointer, not an attestation.
        bytes32 metadataRoot;
        uint256 deployedAt;
    }

    /// @notice Every market this factory created, in order. Append-only.
    ProjectDeployment[] public allProjects;
    mapping(address => address) public curveOf;
    mapping(address => address) public tokenOf;

    /**
     * @notice Upper-cased ticker hash to the token that claimed it, or `SYMBOL_RESERVED`.
     * @dev Tickers are claimed permanently. There is no function that releases one.
     */
    mapping(bytes32 => address) public symbolRegistry;

    /**
     * @notice Marker stored in `symbolRegistry` for tickers reserved at construction.
     * @dev Reserved tickers have no token, so this value occupies their slot and the existing
     *      `symbolRegistry[key] == address(0)` check in `deployTrinity` rejects them. It can
     *      never be a real token: it has no code, and `deployTrinity` only ever writes
     *      addresses returned by `new AdextoToken`.
     */
    address public constant SYMBOL_RESERVED = address(1);

    mapping(address => address[]) public userDeployments;
    mapping(address => uint256) public agentIdOf;

    event TrinityProjectCreated(
        address indexed token,
        address indexed creator,
        string symbol,
        bytes32 metadataRoot
    );

    /**
     * @dev Same signature as generation 0.11.0, therefore the same `topic0`. The protocol fee
     *      is deliberately absent: it is a constant here and an immutable on each curve, and
     *      adding it would silently stop every existing indexer mapping from matching.
     */
    event TrinityProjectDeployed(
        address indexed token,
        address indexed curve,
        address indexed creator,
        string name,
        string symbol,
        uint256 initialSupply,
        uint256 curveTokens,
        uint256 virtualNative,
        uint256 depthFeeBps,
        uint256 creatorFeeBps,
        uint256 treasuryBuybackBps,
        bytes32 metadataRoot
    );

    /**
     * @notice One ticker reserved when the factory was created.
     * @dev Makes the reserved list readable from logs. A mapping cannot be enumerated, and
     *      `isSymbolAvailable` needs the caller to know which name to ask about.
     */
    event SymbolReserved(string symbol);

    event AgentBound(
        address indexed token,
        uint256 indexed agentId,
        address indexed agentRegistry,
        address owner
    );

    /**
     * @param _protocolTreasury Permanent destination of the protocol leg of every market.
     * @param reservedSymbols Tickers that nobody can ever launch on this factory.
     *
     * @dev WHY RESERVATION HAPPENS HERE AND NOWHERE ELSE
     *
     * `symbolRegistry` belongs to one factory. A new factory starts with an empty ticker book,
     * so without this list every name used by an earlier generation, including live markets and
     * major assets such as ETH or USDC, would be free to claim again. An off-chain block list
     * cannot close that gap, because `deployTrinity` has no access control and can be called
     * directly. A `reserve()` function would need an address allowed to call it, and that key
     * could be lost or used to reserve somebody else's name later. Fixing the list at
     * construction needs nobody's permission, stays readable in the deployment calldata and in
     * `SymbolReserved` logs, and cannot be changed afterwards.
     *
     * Reservation is permanent and case-insensitive. A typo in this list locks that name on
     * this factory forever, so the list must be checked before broadcast. Duplicates are
     * harmless: a second write stores the same value in the same slot.
     */
    constructor(address _protocolTreasury, string[] memory reservedSymbols) {
        require(_protocolTreasury != address(0), "Factory: zero protocol treasury");
        protocolTreasury = _protocolTreasury;

        for (uint256 i = 0; i < reservedSymbols.length; i++) {
            symbolRegistry[keccak256(abi.encodePacked(_toUpper(reservedSymbols[i])))] = SYMBOL_RESERVED;
            emit SymbolReserved(reservedSymbols[i]);
        }
    }

    /**
     * @notice Deploy a token and its bonding curve in one transaction.
     * @param initialSupply Supply in WHOLE tokens, at most `MAX_SUPPLY`. Not wei.
     * @param agentIdentity Operational address recorded on the token and the curve. Must not be
     *        zero, even when no agent is bound.
     * @param virtualNative Virtual native reserve, in wei. Sets the opening price; never deposited.
     * @param swapFeeBps The WHOLE fee a trader pays, at most 500. Nothing is charged on top.
     * @param creatorShareBps Part of `swapFeeBps` paid to the creator (the caller).
     * @param treasuryShareBps Part of `swapFeeBps` spent on buyback-and-burn.
     * @param metadataRoot 0G DA storage root of the launch metadata.
     * @param bindAgent Whether to bind an ERC-8004 agent identity.
     * @param agentId Agent to bind. Must be 0 when `bindAgent` is false, rather than silently
     *        ignored, because a creator who believes an agent is attached cannot fix it later.
     *
     * @dev Symbols are upper-cased in place. `_toUpper` rewrites the `symbol` string in memory,
     *      so the token's symbol, the registry entry and both events all carry the upper-case
     *      form of whatever was passed in. Deliberately not payable.
     */
    function deployTrinity(
        string memory name,
        string memory symbol,
        uint256 initialSupply,
        address agentIdentity,
        uint256 virtualNative,
        uint256 swapFeeBps,
        uint256 creatorShareBps,
        uint256 treasuryShareBps,
        bytes32 metadataRoot,
        bool bindAgent,
        uint256 agentId
    ) external returns (address token, address curve) {
        require(bytes(symbol).length > 0 && bytes(symbol).length <= 12, "Factory: bad symbol");
        require(bytes(name).length > 0 && bytes(name).length <= 64, "Factory: bad name");
        require(initialSupply > 0 && initialSupply <= MAX_SUPPLY, "Factory: bad supply");
        require(agentIdentity != address(0), "Factory: zero agent");
        require(virtualNative > 0, "Factory: zero virtual reserve");
        // The 5% cap applies to what a trader actually pays, which is `swapFeeBps` alone.
        require(swapFeeBps <= 500, "Factory: fee too high");
        /**
         * The protocol leg is inside this comparison, which is what makes the carve-out real.
         * Without it a launch could give the creator and buyback legs the whole fee, and the
         * subtraction that computes `depthFeeBps` below would underflow into an unexplained
         * panic. It also sets the floor: `swapFeeBps` can never be below `PROTOCOL_FEE_BPS`.
         */
        require(
            creatorShareBps + treasuryShareBps + PROTOCOL_FEE_BPS <= swapFeeBps,
            "Factory: shares exceed fee"
        );

        bytes32 symbolKey = keccak256(abi.encodePacked(_toUpper(symbol)));
        require(symbolRegistry[symbolKey] == address(0), "Factory: symbol already taken");

        // Bind an agent only to the address that owns it, so a launch cannot attach itself to
        // somebody else's agent and borrow its reputation. `try` turns a revert inside the
        // external, upgradeable registry into this contract's own message.
        address agentRegistry = address(0);
        if (bindAgent) {
            try IIdentityRegistry(AGENT_REGISTRY).ownerOf(agentId) returns (address agentOwner) {
                require(agentOwner == msg.sender, "Factory: agent not owned by caller");
            } catch {
                revert("Factory: agent id not registered");
            }
            agentRegistry = AGENT_REGISTRY;
        } else {
            require(agentId == 0, "Factory: agentId set without bindAgent");
        }

        // Depth is the remainder after the three named legs, so the four always sum to exactly
        // `swapFeeBps`. The require above guarantees this cannot underflow.
        uint256 depthFeeBps = swapFeeBps - creatorShareBps - treasuryShareBps - PROTOCOL_FEE_BPS;

        // 1. The curve first, so the token can record it immutably.
        AdextoCurve sovereignCurve = new AdextoCurve(
            address(this),
            agentIdentity,
            msg.sender,
            protocolTreasury,
            virtualNative,
            depthFeeBps,
            creatorShareBps,
            treasuryShareBps,
            PROTOCOL_FEE_BPS
        );
        curve = address(sovereignCurve);

        // 2. The token. Its whole supply is minted to this factory.
        AdextoToken newToken = new AdextoToken(
            name,
            symbol,
            initialSupply,
            agentIdentity,
            curve,
            ANTI_SNIPER_BPS,
            bindAgent,
            agentId,
            agentRegistry
        );
        token = address(newToken);

        // The ticker and the market record are written before the curve is loaded. Both
        // addresses are final here, and a reentrant attempt to claim the same ticker during the
        // calls below now fails the check above.
        symbolRegistry[symbolKey] = token;
        curveOf[token] = curve;
        tokenOf[curve] = token;
        allProjects.push(
            ProjectDeployment({
                token: token,
                curve: curve,
                creator: msg.sender,
                name: name,
                symbol: symbol,
                virtualNative: virtualNative,
                depthFeeBps: depthFeeBps,
                creatorFeeBps: creatorShareBps,
                treasuryBuybackBps: treasuryShareBps,
                protocolFeeBps: PROTOCOL_FEE_BPS,
                metadataRoot: metadataRoot,
                deployedAt: block.timestamp
            })
        );
        userDeployments[msg.sender].push(token);
        if (bindAgent) {
            agentIdOf[token] = agentId;
            emit AgentBound(token, agentId, agentRegistry, msg.sender);
        }

        // 3. Bind and load the curve with 100% of supply. No native changes hands.
        sovereignCurve.bindToken(token);
        uint256 minted = IERC20SupplySeed(token).balanceOf(address(this));
        require(minted > 0, "Factory: nothing minted");
        require(IERC20SupplySeed(token).approve(curve, minted), "Factory: approve failed");
        sovereignCurve.initializeCurve(minted);

        // 4. Nothing is left for anyone. The strict equality is the on-chain proof that the
        //    creator holds no allocation to sell into the first buyers.
        require(IERC20SupplySeed(token).balanceOf(address(this)) == 0, "Factory: supply not fully seeded");

        emit TrinityProjectCreated(token, msg.sender, symbol, metadataRoot);
        emit TrinityProjectDeployed(
            token,
            curve,
            msg.sender,
            name,
            symbol,
            initialSupply,
            minted,
            virtualNative,
            depthFeeBps,
            creatorShareBps,
            treasuryShareBps,
            metadataRoot
        );
    }

    function totalProjectsCount() external view returns (uint256) {
        return allProjects.length;
    }

    /// @dev Same return shape as generation 0.11.0, so one client path reads both.
    function projectAt(uint256 index)
        external
        view
        returns (address token, address curve, address creator, string memory symbol, uint256 deployedAt)
    {
        ProjectDeployment storage p = allProjects[index];
        return (p.token, p.curve, p.creator, p.symbol, p.deployedAt);
    }

    /// @notice False for a ticker already launched or reserved, compared case-insensitively.
    function isSymbolAvailable(string memory symbol) external view returns (bool) {
        return symbolRegistry[keccak256(abi.encodePacked(_toUpper(symbol)))] == address(0);
    }

    /// @dev ASCII a-z to A-Z, rewriting `input` in place and returning it.
    function _toUpper(string memory input) private pure returns (string memory) {
        bytes memory b = bytes(input);
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] >= 0x61 && b[i] <= 0x7A) {
                b[i] = bytes1(uint8(b[i]) - 32);
            }
        }
        return string(b);
    }
}

/**
 * @dev The ERC-20 surface the factory needs to load a curve: approve it, then confirm its own
 *      balance is zero. Named distinctly from the curve's interfaces so that looking artifacts
 *      up by name is never ambiguous.
 */
interface IERC20SupplySeed {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
