// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AdextoToken} from "./AdextoToken.sol";
import {SovereignCurveV2} from "./SovereignCurveV2.sol";
import {IIdentityRegistry} from "./IIdentityRegistry.sol";

/**
 * @title AdextoCurveFactoryV2
 * @notice Zero-deposit launch for ADEXTO (adexto.xyz), version 0.11.0: token +
 *         bonding curve in one transaction, no liquidity deposit, and a protocol
 *         fee leg that the protocol itself can actually collect.
 *
 * @dev WHY THIS CARRIES A VERSION SUFFIX WHEN `AdextoCurveFactory` DELIBERATELY DOES NOT
 *
 * `AdextoCurveFactory` argues at length that a version belongs in `VERSION` and not
 * in a contract name, because a name is permanent once verified and forces every
 * later fix to invent another one. That argument was correct and it assumed one
 * factory existed at a time.
 *
 * That assumption no longer holds. `AdextoCurveFactory` v0.10.0 is deployed and
 * immutable with five live markets on 0G, and its curves cannot be made to charge a
 * protocol fee because every fee rate in them is `immutable`. So two factories now
 * exist permanently and side by side, and two contracts cannot share one name.
 *
 * The suffix is therefore a direct consequence of having no upgrade lever, which is
 * the property the project chose on purpose. `VERSION` still carries the precise
 * number; the suffix only distinguishes two coexisting deployments.
 *
 * WHAT CHANGED FROM v0.10.0
 *
 * One addition: `PROTOCOL_FEE_BPS`, charged on top of the creator's configured
 * total and claimable only to the `immutable protocolTreasury` set at deployment.
 *
 * Everything a reader or indexer depends on is unchanged. `deployTrinity` keeps its
 * exact signature and therefore its selector; `TrinityProjectDeployed`,
 * `TrinityProjectCreated` and `AgentBound` keep their exact signatures and
 * therefore their `topic0`; `projectAt` keeps its return shape. A client can read
 * both factories through one code path, which is the only reason two live factories
 * are maintainable at all.
 *
 * There is deliberately NO per-launch event announcing the protocol fee. It is a
 * constant on this contract, identical for every market it deploys, so an event
 * would repeat a value that is already readable without a launch having happened.
 *
 * SIFAT EKONOMI YANG DIPERTAHANKAN DARI GENERASI SEBELUMNYA
 *
 *   - tanpa setoran native: kurva membuka terhadap reserve virtual;
 *   - 100% supply masuk kurva, jadi creator tidak memegang apa pun untuk dijual;
 *   - creator dibayar dari irisan fee setiap swap, ke alamat yang terkunci di
 *     kurva sejak deployment.
 */
contract AdextoCurveFactoryV2 {
    /**
     * @notice Versi factory, dibaca on-chain.
     * @dev `0.y.z` berarti pengembangan awal: API publiknya belum boleh dianggap
     *      stabil. Naik ke 1.0.0 hanya setelah factory ini ter-broadcast ke mainnet
     *      dan satu peluncuran nyata berhasil.
     */
    string public constant VERSION = "0.11.0";

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_SUPPLY = 1_000_000_000_000; // 1e12 whole tokens
    /// @dev Anti-sniper window: 1% max transaction for the first blocks.
    uint256 public constant ANTI_SNIPER_BPS = 100;

    /**
     * @notice Protocol fee charged on every swap, in basis points. 10 bps = 0.10%.
     *
     * @dev A CONSTANT, AND ADDITIVE TO `swapFeeBps` RATHER THAN CARVED OUT OF IT
     *
     * A market configured as 0.30% total therefore charges 0.40%: depth 0.15%,
     * creator 0.10%, buyback 0.05%, protocol 0.10%.
     *
     * Carving it out of the existing 0.30% was the alternative and it was rejected.
     * Taking it from depth weakens the rising price floor, which is the reason the
     * curve can never be drained. Taking it from the creator's share guts the one
     * mechanism that replaces a free token allocation, and the creator's 0.10% has
     * already been published as it stands. Charging 10bps more is the only option
     * that is visible at the point of trade rather than quietly reallocating money
     * somebody was already promised.
     *
     * 0.10% matches the creator's share on purpose: the protocol should not earn
     * more from a market than the person who launched it.
     *
     * A constant, not a parameter, so every market this factory deploys charges the
     * same and the figure is readable here before anyone trades. It cannot be
     * changed for a deployed factory; a different rate means a different factory at
     * a different address, which is a visible event rather than a silent one.
     */
    uint256 public constant PROTOCOL_FEE_BPS = 10;

    /**
     * @notice Where protocol fees from every market this factory deploys are sent.
     *
     * @dev Immutable, and passed to each curve as that curve's own immutable
     *      `protocolTreasury`. There is no setter here and none in the curve, so
     *      revenue from a launched market can never be redirected — including by
     *      us. A setter would make both contracts owned, which contradicts the
     *      claim on /security that nobody can change the terms of a launched
     *      market, and that claim is the product rather than a detail of it.
     *
     *      A constructor parameter rather than a hardcoded constant because the
     *      address differs per chain, and editing source per chain would mean four
     *      slightly different sources to verify against four deployments.
     */
    address public immutable protocolTreasury;

    /**
     * @notice ERC-8004 Identity Registry, used to check agent ownership at launch.
     * @dev Same deterministic `0x8004`-prefixed singleton on every chain we launch
     *      on: 0G (16661), Base (8453), Arbitrum One (42161), Monad (143). Only a
     *      `view` function is ever called through it, so a hostile or broken upgrade
     *      of that proxy can make an agent-bound launch revert but can never alter
     *      what a launch does.
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
        /// @dev Root penyimpanan 0G DA dari metadata launch. Bukan attestation.
        bytes32 metadataRoot;
        uint256 deployedAt;
    }

    ProjectDeployment[] public allProjects;
    mapping(address => address) public curveOf;
    mapping(address => address) public tokenOf;
    mapping(bytes32 => address) public symbolRegistry;
    mapping(address => address[]) public userDeployments;
    mapping(address => uint256) public agentIdOf;

    event TrinityProjectCreated(
        address indexed token,
        address indexed creator,
        string symbol,
        bytes32 metadataRoot
    );
    /**
     * @dev Signature identical to v0.10.0, therefore same `topic0`. The protocol
     *      fee is deliberately absent: it is a constant on this factory and an
     *      immutable on each curve, so adding it here would change the signature
     *      and silently stop every existing subgraph mapping from matching, in
     *      exchange for repeating a value that is already readable.
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
    event AgentBound(
        address indexed token,
        uint256 indexed agentId,
        address indexed agentRegistry,
        address owner
    );

    constructor(address _protocolTreasury) {
        require(_protocolTreasury != address(0), "Factory: zero protocol treasury");
        protocolTreasury = _protocolTreasury;
    }

    /**
     * @notice Deploy a token and its bonding curve in one transaction.
     * @param swapFeeBps Creator-configured total, split three ways by the two share
     *        parameters. `PROTOCOL_FEE_BPS` is charged in addition to this.
     * @param creatorShareBps Portion of `swapFeeBps` streamed to the creator.
     * @param treasuryShareBps Portion of `swapFeeBps` routed to the agent vault.
     * @param metadataRoot 0G DA storage root of the launch metadata.
     * @param bindAgent Whether to attach an ERC-8004 agent identity at all.
     * @param agentId ERC-8004 agent id to bind. Required to be 0 when `bindAgent`
     *        is false, rather than silently ignored, because handing back a token
     *        whose agent the creator believes is attached cannot be fixed later.
     *
     * @dev Signature identical to v0.10.0, therefore same selector. Deliberately
     *      NOT payable: requiring native here is the barrier this generation exists
     *      to remove.
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
        // The 5% cap applies to what a trader actually pays, so the protocol leg is
        // inside the comparison. Checking `swapFeeBps` alone would let a 5% market
        // deploy a curve whose true total is 5.1%, and the curve's own constructor
        // would then revert — turning a bad request into a confusing failure late
        // in the call instead of a clear one here.
        require(swapFeeBps + PROTOCOL_FEE_BPS <= 500, "Factory: fee too high");
        require(creatorShareBps + treasuryShareBps <= swapFeeBps, "Factory: shares exceed fee");

        bytes32 symbolKey = keccak256(abi.encodePacked(_toUpper(symbol)));
        require(symbolRegistry[symbolKey] == address(0), "Factory: symbol already taken");

        // Bind an agent only to the address that owns it. Without this check any
        // launch could attach itself to somebody else's registered agent and
        // inherit its reputation. `try` is used because the registry is external
        // and upgradeable: a revert there must produce this contract's own message.
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

        uint256 depthFeeBps = swapFeeBps - creatorShareBps - treasuryShareBps;

        // 1. Deploy the curve first so the token can bind to it immutably.
        SovereignCurveV2 sovereignCurve = new SovereignCurveV2(
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

        // 2. Deploy the token; the whole supply is minted to this factory.
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

        // 3. Bind and load the curve atomically with 100% of supply. No native
        //    changes hands, so a launch costs the creator gas only.
        sovereignCurve.bindToken(token);
        uint256 minted = IERC20Balance(token).balanceOf(address(this));
        require(minted > 0, "Factory: nothing minted");
        require(IERC20Balance(token).approve(curve, minted), "Factory: approve failed");
        sovereignCurve.initializeCurve(minted);

        // 4. Nothing is forwarded to the creator on purpose: no free allocation
        //    means no supply to dump. The creator earns from `creatorShareBps`.
        require(IERC20Balance(token).balanceOf(address(this)) == 0, "Factory: supply not fully seeded");

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

    /// @dev Return shape identical to v0.10.0 so one client path reads both factories.
    function projectAt(uint256 index)
        external
        view
        returns (address token, address curve, address creator, string memory symbol, uint256 deployedAt)
    {
        ProjectDeployment storage p = allProjects[index];
        return (p.token, p.curve, p.creator, p.symbol, p.deployedAt);
    }

    function isSymbolAvailable(string memory symbol) external view returns (bool) {
        return symbolRegistry[keccak256(abi.encodePacked(_toUpper(symbol)))] == address(0);
    }

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

interface IERC20Balance {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
