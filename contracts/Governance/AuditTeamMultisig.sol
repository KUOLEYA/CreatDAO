// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AuditTeamMultisig
 * @dev 审计团队多签合约 - 团队成员管理（否决权已废弃，详见 AuditDAOv2）
 *
 * === 否决权说明 ===
 * 原有的否决权（proposeVeto / confirmVeto）已从 AuditDAOv2 中移除，
 * Kleros 仲裁为终局裁决。本合约保留仅用于审计团队成员变更的多签管理。
 *
 * === 当前功能 ===
 * 1. 成员变更多签：新增/移除团队成员（≥requiredConfirmations 通过）
 * 2. 成员查询：团队成员列表、确认数等
 */
contract AuditTeamMultisig {
    address[] public members;
    mapping(address => bool) public isMember;
    uint256 public requiredConfirmations;

    enum MemberChangeStatus {
        Pending,
        Approved,
        Executed
    }

    struct MemberChangeProposal {
        uint256 id;
        address targetMember;
        bool isAdd;
        address proposer;
        address[] confirmations;
        mapping(address => bool) hasConfirmed;
        MemberChangeStatus status;
        uint256 createdAt;
    }

    mapping(uint256 => MemberChangeProposal) public memberChangeProposals;
    uint256 public nextMemberChangeId;

    event MemberAdded(address indexed member);
    event MemberRemoved(address indexed member);
    event MemberChangeProposed(uint256 indexed proposalId, address targetMember, bool isAdd);
    event MemberChangeConfirmed(uint256 indexed proposalId, address confirmer);
    event MemberChangeExecuted(uint256 indexed proposalId);

    modifier onlyMember() {
        require(isMember[msg.sender], "Not a team member");
        _;
    }

    constructor(address[] memory _members) {
        require(_members.length >= 2, "Need at least 2 members");

        for (uint256 i = 0; i < _members.length; i++) {
            require(!isMember[_members[i]], "Duplicate member");
            require(_members[i] != address(0), "Invalid member address");
            isMember[_members[i]] = true;
            members.push(_members[i]);
        }

        requiredConfirmations = (_members.length / 2) + 1;
    }

    // ==================== 成员变更多签流程 ====================

    function proposeMemberChange(address targetMember, bool isAdd) external onlyMember returns (uint256) {
        require(targetMember != address(0), "Invalid address");

        if (isAdd) {
            require(!isMember[targetMember], "Already a member");
        } else {
            require(isMember[targetMember], "Not a member");
            require(members.length > 2, "Cannot reduce below 2 members");
        }

        uint256 proposalId = nextMemberChangeId++;
        MemberChangeProposal storage proposal = memberChangeProposals[proposalId];
        proposal.id = proposalId;
        proposal.targetMember = targetMember;
        proposal.isAdd = isAdd;
        proposal.proposer = msg.sender;
        proposal.status = MemberChangeStatus.Pending;
        proposal.createdAt = block.timestamp;

        proposal.hasConfirmed[msg.sender] = true;
        proposal.confirmations.push(msg.sender);

        emit MemberChangeProposed(proposalId, targetMember, isAdd);
        return proposalId;
    }

    function confirmMemberChange(uint256 proposalId) external onlyMember {
        MemberChangeProposal storage proposal = memberChangeProposals[proposalId];

        require(proposal.proposer != address(0), "Proposal does not exist");
        require(proposal.status == MemberChangeStatus.Pending, "Invalid status");
        require(!proposal.hasConfirmed[msg.sender], "Already confirmed");

        proposal.hasConfirmed[msg.sender] = true;
        proposal.confirmations.push(msg.sender);

        emit MemberChangeConfirmed(proposalId, msg.sender);

        if (proposal.confirmations.length >= requiredConfirmations) {
            _executeMemberChange(proposalId);
        }
    }

    function _executeMemberChange(uint256 proposalId) internal {
        MemberChangeProposal storage proposal = memberChangeProposals[proposalId];
        require(proposal.status == MemberChangeStatus.Pending, "Already executed");

        proposal.status = MemberChangeStatus.Approved;

        if (proposal.isAdd) {
            isMember[proposal.targetMember] = true;
            members.push(proposal.targetMember);
            emit MemberAdded(proposal.targetMember);
        } else {
            isMember[proposal.targetMember] = false;

            for (uint256 i = 0; i < members.length; i++) {
                if (members[i] == proposal.targetMember) {
                    members[i] = members[members.length - 1];
                    members.pop();
                    break;
                }
            }
            emit MemberRemoved(proposal.targetMember);
        }

        requiredConfirmations = (members.length / 2) + 1;
        proposal.status = MemberChangeStatus.Executed;

        emit MemberChangeExecuted(proposalId);
    }

    // ==================== 查询函数 ====================

    function getMemberCount() external view returns (uint256) {
        return members.length;
    }

    function getMemberChangeProposal(uint256 proposalId) external view returns (
        uint256 id,
        address targetMember,
        bool isAdd,
        address proposer,
        uint256 confirmationCount,
        MemberChangeStatus status,
        uint256 createdAt
    ) {
        MemberChangeProposal storage proposal = memberChangeProposals[proposalId];
        require(proposal.proposer != address(0), "Proposal does not exist");

        return (
            proposal.id,
            proposal.targetMember,
            proposal.isAdd,
            proposal.proposer,
            proposal.confirmations.length,
            proposal.status,
            proposal.createdAt
        );
    }

    function getMemberChangeConfirmations(uint256 proposalId) external view returns (address[] memory) {
        MemberChangeProposal storage proposal = memberChangeProposals[proposalId];
        require(proposal.proposer != address(0), "Proposal does not exist");
        return proposal.confirmations;
    }
}
