// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

/**
 * @title MockIdentityRegistry
 * @notice TEST ONLY. Stands in for the ERC-8004 Identity Registry on a local chain.
 *
 * @dev WHY THIS FILE HAS TO EXIST
 *
 * The real registry is deployed only on mainnets. It is absent from 0G Testnet,
 * Base Sepolia, Arbitrum Sepolia and Monad Testnet — checked, all four return no
 * code at `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`. And because
 * `AdextoCurveFactory.AGENT_REGISTRY` is a constant, the agent-binding path cannot
 * be exercised on any testnet at all.
 *
 * Leaving it untested until mainnet was not acceptable for code that mints
 * permanent, immutable tokens. So a local devchain gets this contract's runtime
 * bytecode injected at the constant address via `hardhat_setCode`, which makes the
 * factory's real code path reachable without weakening the factory itself by
 * turning the registry address into a constructor argument.
 *
 * Only the two functions the factory calls are behaviourally relevant. `register`
 * exists so a test can mint an agent to a chosen owner and reproduce the ownership
 * checks; it deliberately mirrors the real signature rather than inventing one.
 *
 * NOT deployed to any real network. Kept under contracts/test/ so the deploy
 * scripts, which name their target explicitly, never pick it up.
 */
contract MockIdentityRegistry is ERC721URIStorage {
    /**
     * @dev NOTHING HERE MAY DEPEND ON THE CONSTRUCTOR HAVING RUN
     *
     * `hardhat_setCode` copies runtime bytecode only, so at the injected address
     * every storage slot is zero and the constructor never executed. A `_next = 1`
     * initialiser would therefore be silently ignored and ids would start at 0.
     *
     * That turned out to match the real registry: `ownerOf(0)` returns a live owner
     * on 0G, Base, Arbitrum One and Monad mainnet. So ids starting at 0 is the
     * accurate fixture, and it is what proved the factory's original
     * `agentId == 0 means unbound` sentinel was wrong.
     *
     * `name()` and `symbol()` are overridden as pure functions for the same reason:
     * ERC721 keeps them in constructor-set storage, which is empty here.
     */
    uint256 private _minted;

    constructor() ERC721("AgentIdentity", "AGENT") {}

    function name() public pure override returns (string memory) {
        return "AgentIdentity";
    }

    function symbol() public pure override returns (string memory) {
        return "AGENT";
    }

    /// @notice Mirrors ERC-8004 `register(string)`: mints the agent to the caller.
    function register(string calldata agentURI) external returns (uint256 agentId) {
        agentId = _minted;
        _minted = agentId + 1;
        _mint(msg.sender, agentId);
        _setTokenURI(agentId, agentURI);
    }

    /// @notice Mirrors ERC-8004 `register()`: id first, URI supplied later.
    function register() external returns (uint256 agentId) {
        agentId = _minted;
        _minted = agentId + 1;
        _mint(msg.sender, agentId);
    }

    function setAgentURI(uint256 agentId, string calldata newURI) external {
        require(ownerOf(agentId) == msg.sender, "Mock: not agent owner");
        _setTokenURI(agentId, newURI);
    }
}
