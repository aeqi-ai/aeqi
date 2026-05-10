// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Mock Governance module emitting the same event signatures as the real
/// aeqi-core Governance.module.
contract MockGovernance {
    event Governance_ProposalCreated(
        uint256 indexed proposalId,
        bytes32 indexed governanceConfigId,
        address proposer,
        address[] targets,
        uint256[] values,
        string[] signatures,
        bytes[] calldatas,
        uint256 voteStart,
        uint256 voteEnd,
        bytes ipfsCid
    );
    event Governance_ProposalCanceled(uint256 indexed proposalId);
    event Governance_ProposalSucceeded(uint256 indexed proposalId);
    event Governance_ProposalExecuted(uint256 indexed proposalId);
    event Governance_VoteCast(
        address indexed voter,
        uint256 indexed proposalId,
        uint8 support,
        uint256 weight,
        string reason
    );

    function emitProposalCreated(
        uint256 proposalId,
        bytes32 governanceConfigId,
        address proposer,
        uint256 voteStart,
        uint256 voteEnd,
        bytes calldata ipfsCid
    ) external {
        address[] memory targets = new address[](0);
        uint256[] memory values = new uint256[](0);
        string[] memory signatures = new string[](0);
        bytes[] memory calldatas = new bytes[](0);
        emit Governance_ProposalCreated(
            proposalId,
            governanceConfigId,
            proposer,
            targets,
            values,
            signatures,
            calldatas,
            voteStart,
            voteEnd,
            ipfsCid
        );
    }

    function emitVoteCast(
        address voter,
        uint256 proposalId,
        uint8 support,
        uint256 weight,
        string calldata reason
    ) external {
        emit Governance_VoteCast(voter, proposalId, support, weight, reason);
    }

    function emitProposalSucceeded(uint256 proposalId) external {
        emit Governance_ProposalSucceeded(proposalId);
    }

    function emitProposalExecuted(uint256 proposalId) external {
        emit Governance_ProposalExecuted(proposalId);
    }

    function emitProposalCanceled(uint256 proposalId) external {
        emit Governance_ProposalCanceled(proposalId);
    }

    /// Realistic flow: proposal is created, two votes cast (1 For, 1 Against),
    /// proposal succeeds, proposal executes. 5 events in one tx.
    function emitFullProposalLifecycle(
        uint256 proposalId,
        bytes32 governanceConfigId,
        address proposer,
        address voter1,
        address voter2,
        uint256 voteStart,
        uint256 voteEnd,
        bytes calldata ipfsCid
    ) external {
        address[] memory targets = new address[](0);
        uint256[] memory values = new uint256[](0);
        string[] memory signatures = new string[](0);
        bytes[] memory calldatas = new bytes[](0);
        emit Governance_ProposalCreated(
            proposalId,
            governanceConfigId,
            proposer,
            targets,
            values,
            signatures,
            calldatas,
            voteStart,
            voteEnd,
            ipfsCid
        );
        emit Governance_VoteCast(voter1, proposalId, 1, 1000, "for the win");
        emit Governance_VoteCast(voter2, proposalId, 0, 500, "against");
        emit Governance_ProposalSucceeded(proposalId);
        emit Governance_ProposalExecuted(proposalId);
    }
}
