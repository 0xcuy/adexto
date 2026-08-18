// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AdextoToken} from "./AdextoToken.sol";
import {SovereignCurve} from "./SovereignCurve.sol";

interface IERC20Approve {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title AdextoTrinityFactoryV3
 * @notice Zero-deposit 1-click launch for ADEXTO (adexto.xyz).
 *
 * @dev WHAT CHANGED FROM V2, AND WHY
 *
 * v2 required a native seed (`require(msg.value > 0, "Factory: native liquidity
 * required")`) that was locked forever, and it split supply between the pool and
 * the creator via `poolTokenBps`. Both of those were wrong for a launchpad:
 *
 *   1. Measured on Base, the seed was ~16x the launch gas cost, and a four-chain
 *      launch needed it again in each chain's native asset. That is the largest
 *      barrier to anyone launching at all.
 *   2. Handing the creator a free slice of supply is a dump vector. It is also
 *      the exact mechanism that made rug pulls routine on other launchpads, where
 *      selling their own allocation was a creator's only way to earn.
 *
 * v3 therefore:
 *   - deploys a `SovereignCurve` with virtual reserves, so no native is required;
 *   - puts 100% of supply into the curve, so the creator holds nothing to dump;
 *   - pays the creator from a fee share on every swap instead, streamed to an
 *     address locked into the curve at deployment.
 *
 * `virtualNative` is passed per launch because it sets the opening price, and
 * since all supply is in the curve it equals the opening market capitalisation in
 * the chain's native asset.
 */
contract AdextoTrinityFactoryV3 {
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_SUPPLY = 1_000_000_000_000; // 1e12 whole tokens
    /// @dev Anti-sniper window: 1% max transaction for the first blocks.
    uint256 public constant ANTI_SNIPER_BPS = 100;

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
        bytes32 teeAttestationRoot;
        uint256 deployedAt;
    }

    ProjectDeployment[] public allProjects;
    mapping(address => address) public curveOf;
    mapping(address => address) public tokenOf;
    mapping(bytes32 => address) public symbolRegistry;
    mapping(address => address[]) public userDeployments;

    event TrinityProjectCreated(
        address indexed token,
        address indexed creator,
        string symbol,
        bytes32 teeAttestationRoot
    );
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
        bytes32 teeAttestationRoot
    );

    /**
     * @notice Deploy a token and its bonding curve in one transaction.
     * @param virtualNative Virtual native reserve; equals the opening market cap
     *        in native terms because all supply enters the curve.
     * @param swapFeeBps Total fee, split three ways by the two share parameters.
     * @param creatorShareBps Portion of `swapFeeBps` streamed to the creator.
     * @param treasuryShareBps Portion of `swapFeeBps` routed to the agent vault.
     * @dev Deliberately NOT payable. Requiring native here is precisely the
     *      barrier v3 exists to remove.
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
        bytes32 teeAttestationRoot
    ) external returns (address token, address curve) {
        require(bytes(symbol).length > 0 && bytes(symbol).length <= 12, "Factory: bad symbol");
        require(bytes(name).length > 0 && bytes(name).length <= 64, "Factory: bad name");
        require(initialSupply > 0 && initialSupply <= MAX_SUPPLY, "Factory: bad supply");
        require(agentIdentity != address(0), "Factory: zero agent");
        require(virtualNative > 0, "Factory: zero virtual reserve");
        require(swapFeeBps <= 500, "Factory: fee too high");
        require(creatorShareBps + treasuryShareBps <= swapFeeBps, "Factory: shares exceed fee");

        bytes32 symbolKey = keccak256(abi.encodePacked(_toUpper(symbol)));
        require(symbolRegistry[symbolKey] == address(0), "Factory: symbol already taken");

        uint256 depthFeeBps = swapFeeBps - creatorShareBps - treasuryShareBps;

        // 1. Deploy the curve first so the token can bind to it immutably.
        SovereignCurve sovereignCurve = new SovereignCurve(
            address(this),
            agentIdentity,
            msg.sender,
            virtualNative,
            depthFeeBps,
            creatorShareBps,
            treasuryShareBps
        );
        curve = address(sovereignCurve);

        // 2. Deploy the token; the whole supply is minted to this factory.
        AdextoToken newToken = new AdextoToken(
            name,
            symbol,
            initialSupply,
            agentIdentity,
            curve,
            ANTI_SNIPER_BPS
        );
        token = address(newToken);

        // 3. Bind and load the curve atomically with 100% of supply. No native
        //    changes hands, so a launch costs the creator gas only.
        sovereignCurve.bindToken(token);
        uint256 minted = IERC20Approve(token).balanceOf(address(this));
        require(minted > 0, "Factory: nothing minted");
        require(IERC20Approve(token).approve(curve, minted), "Factory: approve failed");
        sovereignCurve.initializeCurve(minted);

        // 4. Nothing is forwarded to the creator on purpose: no free allocation
        //    means no supply to dump. The creator earns from `creatorShareBps`.
        require(IERC20Approve(token).balanceOf(address(this)) == 0, "Factory: supply not fully seeded");

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
                teeAttestationRoot: teeAttestationRoot,
                deployedAt: block.timestamp
            })
        );
        userDeployments[msg.sender].push(token);

        emit TrinityProjectCreated(token, msg.sender, symbol, teeAttestationRoot);
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
            teeAttestationRoot
        );
    }

    function totalProjectsCount() external view returns (uint256) {
        return allProjects.length;
    }

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
