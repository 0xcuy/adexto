// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AdextoToken} from "./AdextoToken.sol";

/**
 * @title AdextoTrinityFactory
 * @notice 1-Click Atomic Deployment for ADEXTO Ecosystem (adexto.xyz)
 */
contract AdextoTrinityFactory {
    struct ProjectDeployment {
        address token;
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

    event TrinityProjectCreated(
        address indexed token,
        address indexed creator,
        string symbol,
        bytes32 teeAttestationRoot
    );

    function deployTrinityProject(
        string memory name,
        string memory symbol,
        uint256 initialSupply,
        address agentIdentity,
        uint256 swapFeeBps,
        uint256 treasuryShareBps,
        bytes32 teeAttestationRoot
    ) external payable returns (address) {
        AdextoToken newToken = new AdextoToken(
            name,
            symbol,
            initialSupply,
            agentIdentity,
            address(this),
            100 // 1% max tx anti-sniper
        );

        ProjectDeployment memory deployment = ProjectDeployment({
            token: address(newToken),
            creator: msg.sender,
            name: name,
            symbol: symbol,
            swapFeeBps: swapFeeBps,
            treasuryShareBps: treasuryShareBps,
            teeAttestationRoot: teeAttestationRoot,
            deployedAt: block.timestamp
        });

        allProjects.push(deployment);
        userDeployments[msg.sender].push(address(newToken));

        emit TrinityProjectCreated(address(newToken), msg.sender, symbol, teeAttestationRoot);
        return address(newToken);
    }

    function totalProjectsCount() external view returns (uint256) {
        return allProjects.length;
    }
}
