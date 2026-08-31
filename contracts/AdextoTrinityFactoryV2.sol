// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AdextoToken} from "./AdextoToken.sol";
import {SovereignHook} from "./SovereignHook.sol";

interface IERC20Approve {
    function approve(address spender, uint256 amount) external returns (bool);

    function transfer(address to, uint256 amount) external returns (bool);

    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title AdextoTrinityFactoryV2
 * @notice 1-click atomic deployment for the ADEXTO ecosystem (adexto.xyz).
 *
 * @dev v2 fixes three things the v1 factory got wrong:
 *      1. v1 minted the whole supply to the factory itself (the token's
 *         constructor mints to `msg.sender`), so the creator received nothing and
 *         the supply was permanently stranded. v2 seeds the pool and forwards the
 *         remainder to the creator.
 *      2. v1 never deployed a tradable pool, so the "Sovereign DEX" produced by a
 *         launch did not exist on-chain. v2 deploys a `SovereignHook` AMM and
 *         initializes it in the same transaction.
 *      3. v1's event did not expose the pool, so indexers/frontends had no way to
 *         learn the real trading venue. v2 emits token *and* pool.
 */
contract AdextoTrinityFactoryV2 {
    struct ProjectDeployment {
        address token;
        address pool;
        address creator;
        string name;
        string symbol;
        uint256 swapFeeBps;
        uint256 treasuryShareBps;
        bytes32 teeAttestationRoot;
        uint256 deployedAt;
    }

    ProjectDeployment[] public allProjects;
    mapping(address => address[]) public userDeployments;
    mapping(bytes32 => address) public symbolRegistry;

    /// @notice token => its SovereignHook pool. Lets any client resolve the real
    ///         trading venue straight from the chain, without trusting an
    ///         off-chain registry file. A mapping cannot be added after deploy, so
    ///         it ships now even though the backend does not strictly need it.
    mapping(address => address) public poolOf;
    /// @notice pool => its token, for the reverse lookup.
    mapping(address => address) public tokenOf;

    uint256 public constant MAX_SUPPLY = 1_000_000_000_000; // 1e12 whole tokens
    uint256 public constant BPS_DENOMINATOR = 10_000;

    event TrinityProjectCreated(
        address indexed token,
        address indexed creator,
        string symbol,
        bytes32 teeAttestationRoot
    );

    event TrinityProjectDeployed(
        address indexed token,
        address indexed pool,
        address indexed creator,
        string name,
        string symbol,
        uint256 initialSupply,
        uint256 poolTokenAmount,
        uint256 poolNativeAmount,
        uint256 swapFeeBps,
        uint256 treasuryShareBps,
        bytes32 teeAttestationRoot
    );

    /**
     * @param initialSupply whole-token supply (the token contract applies decimals)
     * @param swapFeeBps    total swap fee in bps (e.g. 30 = 0.30%)
     * @param treasuryShareBps buyback slice of the total fee (e.g. 10 = 0.10%)
     * @param poolTokenBps  share of supply seeded into the pool (e.g. 8000 = 80%)
     * @dev `msg.value` seeds the pool's native side and must be > 0.
     */
    function deployTrinityProject(
        string memory name,
        string memory symbol,
        uint256 initialSupply,
        address agentIdentity,
        uint256 swapFeeBps,
        uint256 treasuryShareBps,
        bytes32 teeAttestationRoot,
        uint256 poolTokenBps
    ) external payable returns (address token, address pool) {
        require(bytes(symbol).length > 0 && bytes(symbol).length <= 12, "Factory: bad symbol");
        require(bytes(name).length > 0 && bytes(name).length <= 64, "Factory: bad name");
        require(initialSupply > 0 && initialSupply <= MAX_SUPPLY, "Factory: bad supply");
        require(agentIdentity != address(0), "Factory: zero agent");
        require(treasuryShareBps <= swapFeeBps, "Factory: buyback exceeds fee");
        require(swapFeeBps <= 500, "Factory: fee too high");
        require(poolTokenBps > 0 && poolTokenBps <= BPS_DENOMINATOR, "Factory: bad pool share");
        require(msg.value > 0, "Factory: native liquidity required");

        bytes32 symbolKey = keccak256(abi.encodePacked(_toUpper(symbol)));
        require(symbolRegistry[symbolKey] == address(0), "Factory: symbol already taken");

        // 1. Deploy the pool first so the token can bind to it immutably.
        SovereignHook hook = new SovereignHook(
            address(this),
            agentIdentity,
            address(0),
            swapFeeBps - treasuryShareBps,
            treasuryShareBps
        );
        pool = address(hook);

        // 2. Deploy the token; whole supply is minted to this factory.
        AdextoToken newToken = new AdextoToken(
            name,
            symbol,
            initialSupply,
            agentIdentity,
            pool,
            100, // 1% max tx anti-sniper window
            // No ERC-8004 identity, same reason as the v1 factory: this generation
            // is already deployed and its bytecode is fixed.
            false,
            0,
            address(0)
        );
        token = address(newToken);

        // 3. Bind + seed the pool atomically.
        hook.bindToken(token);

        uint256 minted = IERC20Approve(token).balanceOf(address(this));
        uint256 poolTokens = (minted * poolTokenBps) / BPS_DENOMINATOR;
        require(poolTokens > 0, "Factory: pool share too small");

        require(IERC20Approve(token).approve(pool, poolTokens), "Factory: approve failed");
        hook.initializePool{value: msg.value}(poolTokens);

        // 4. Forward the remaining supply to the creator.
        uint256 remainder = minted - poolTokens;
        if (remainder > 0) {
            require(IERC20Approve(token).transfer(msg.sender, remainder), "Factory: creator transfer failed");
        }

        symbolRegistry[symbolKey] = token;
        poolOf[token] = pool;
        tokenOf[pool] = token;
        allProjects.push(
            ProjectDeployment({
                token: token,
                pool: pool,
                creator: msg.sender,
                name: name,
                symbol: symbol,
                swapFeeBps: swapFeeBps,
                treasuryShareBps: treasuryShareBps,
                teeAttestationRoot: teeAttestationRoot,
                deployedAt: block.timestamp
            })
        );
        userDeployments[msg.sender].push(token);

        emit TrinityProjectCreated(token, msg.sender, symbol, teeAttestationRoot);
        emit TrinityProjectDeployed(
            token,
            pool,
            msg.sender,
            name,
            symbol,
            initialSupply,
            poolTokens,
            msg.value,
            swapFeeBps,
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
        returns (address token, address pool, address creator, string memory symbol, uint256 deployedAt)
    {
        ProjectDeployment storage p = allProjects[index];
        return (p.token, p.pool, p.creator, p.symbol, p.deployedAt);
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
