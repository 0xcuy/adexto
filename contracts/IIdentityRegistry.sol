// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IIdentityRegistry
 * @notice The slice of the ERC-8004 Identity Registry that ADEXTO actually calls.
 *
 * @dev THIS INTERFACE IS DELIBERATELY TINY, AND THAT IS THE POINT
 *
 * A previous contract in this repo (`SovereignHook`) declared its own
 * `IPoolManager` interface and an `afterSwap` function, and the product pages then
 * described the result as a Uniswap v4 integration. Nothing ever called it. An
 * interface declaration is not an integration — it is a claim about someone else's
 * contract that costs nothing to write and cannot be checked by reading our source.
 *
 * The difference here is that `ownerOf` is genuinely invoked during a launch, and
 * a launch that names an agent reverts when the call fails. The interface is
 * narrowed to exactly the functions we invoke so that nothing in this file can
 * suggest capability we do not exercise. Registration, metadata, wallet proofs and
 * URI updates all belong to the agent owner and are performed against the registry
 * directly, not through us.
 *
 * VERIFIED AGAINST THE DEPLOYED CONTRACT, NOT ONLY THE SPEC
 *
 * ERC-8004 is still Draft, so the markdown is not authoritative. The registry at
 * `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` was probed on 0G, Base, Arbitrum One
 * and Monad mainnet: same address on all four, a 130-byte EIP-1967 proxy over a
 * 14,474-byte implementation, and it reports ERC-165, ERC-721 and ERC-721Metadata
 * as supported. `ownerOf` answers on every one of them.
 *
 * Note that the proxy is UPGRADEABLE and controlled by a third party. That is why
 * only a `view` function is on this path: the worst a future implementation can do
 * to a launch is make it revert, never silently change what a launch means.
 */
interface IIdentityRegistry {
    /**
     * @notice Owner of an agent. ERC-8004 calls the ERC-721 `tokenId` an `agentId`.
     * @dev Reverts for an agent that was never minted, which is the behaviour the
     *      factory relies on to reject an unknown `agentId`.
     */
    function ownerOf(uint256 agentId) external view returns (address);

    /// @notice Resolves to the agent's registration file, e.g. `ipfs://{cid}`.
    function tokenURI(uint256 agentId) external view returns (string memory);
}
