// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AdextoToken} from "./AdextoToken.sol";

/**
 * @title AdextoGovernor
 * @notice On-chain DAO governance protocol for ADEXTO Ecosystem (adexto.xyz)
 * @dev Governs Uniswap v4 Sovereign Hook fee parameters, 0G TEE compute whitelist, and treasury rebalancing.
 */
contract AdextoGovernor {
    enum ProposalState { Pending, Active, Defeated, Succeeded, Executed }

    struct Proposal {
        uint256 id;
        address proposer;
        string title;
        string description;
        address targetContract;
        bytes callData;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 startTime;
        uint256 endTime;
        bool executed;
    }

    AdextoToken public immutable governanceToken;
    uint256 public constant VOTING_PERIOD = 3 days;
    uint256 public constant PROPOSAL_THRESHOLD = 100_000 * 1e18; // 100k ADAI to propose
    uint256 public constant QUORUM_VOTES = 4_000_000 * 1e18;    // 4M ADAI quorum

    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event ProposalCreated(uint256 indexed id, address indexed proposer, string title, uint256 endTime);
    event VoteCast(uint256 indexed id, address indexed voter, bool support, uint256 weight);
    event ProposalExecuted(uint256 indexed id);

    modifier onlyTokenHolder() {
        require(governanceToken.balanceOf(msg.sender) >= PROPOSAL_THRESHOLD, "Below proposal threshold");
        _;
    }

    constructor(address _governanceToken) {
        governanceToken = AdextoToken(_governanceToken);
    }

    function propose(
        string memory title,
        string memory description,
        address targetContract,
        bytes memory callData
    ) external onlyTokenHolder returns (uint256) {
        proposalCount++;
        uint256 proposalId = proposalCount;

        proposals[proposalId] = Proposal({
            id: proposalId,
            proposer: msg.sender,
            title: title,
            description: description,
            targetContract: targetContract,
            callData: callData,
            forVotes: 0,
            againstVotes: 0,
            startTime: block.timestamp,
            endTime: block.timestamp + VOTING_PERIOD,
            executed: false
        });

        emit ProposalCreated(proposalId, msg.sender, title, block.timestamp + VOTING_PERIOD);
        return proposalId;
    }

    function castVote(uint256 proposalId, bool support) external {
        Proposal storage p = proposals[proposalId];
        require(block.timestamp >= p.startTime && block.timestamp <= p.endTime, "Voting inactive");
        require(!hasVoted[proposalId][msg.sender], "Already voted");

        uint256 voterWeight = governanceToken.balanceOf(msg.sender);
        require(voterWeight > 0, "No voting weight");

        hasVoted[proposalId][msg.sender] = true;

        if (support) {
            p.forVotes += voterWeight;
        } else {
            p.againstVotes += voterWeight;
        }

        emit VoteCast(proposalId, msg.sender, support, voterWeight);
    }

    function state(uint256 proposalId) public view returns (ProposalState) {
        Proposal storage p = proposals[proposalId];
        if (p.executed) return ProposalState.Executed;
        if (block.timestamp <= p.endTime) return ProposalState.Active;
        if (p.forVotes > p.againstVotes && (p.forVotes + p.againstVotes) >= QUORUM_VOTES) {
            return ProposalState.Succeeded;
        }
        return ProposalState.Defeated;
    }

    function execute(uint256 proposalId) external {
        require(state(proposalId) == ProposalState.Succeeded, "Proposal not succeeded");
        Proposal storage p = proposals[proposalId];
        p.executed = true;

        if (p.targetContract != address(0) && p.callData.length > 0) {
            (bool success, ) = p.targetContract.call(p.callData);
            require(success, "Governance execution failed");
        }

        emit ProposalExecuted(proposalId);
    }
}
