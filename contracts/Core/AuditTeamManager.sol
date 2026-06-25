// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AuditTeamManager
 * @dev 审计团队管理合约 - 注册、停用、分配审计团队
 *
 * === 治理改进 ===
 * - registerAuditTeam / deactivateAuditTeam 需要治理Timelock授权
 * - 团队统计更新由DAO合约自动触发
 */
contract AuditTeamManager is Ownable {
    struct AuditTeamInfo {
        uint256 id;
        address teamContract;
        string name;
        uint256 totalAudits;
        uint256 successfulAudits;
        uint256 reputation;
        address[] members;
        bool active;
        uint256 createdAt;
    }

    uint256 public nextAuditTeamId;
    mapping(uint256 => AuditTeamInfo) public auditTeams;
    mapping(address => uint256) public teamIdByAddress;
    uint256[] public activeTeamIds;
    
    mapping(uint256 => uint256) public proposalToTeam;
    address public daoContract;
    uint256 public maxAssignedProposalId;

    // 治理Timelock（与AuditDAOv2共用同一个地址）
    address public governanceTimelock;

    event AuditTeamCreated(uint256 indexed teamId, address indexed teamContract, string name, address[] members);
    event AuditTeamDeactivated(uint256 indexed teamId);
    event AuditTeamMemberAdded(uint256 indexed teamId, address indexed newMember);
    event AuditTeamMemberRemoved(uint256 indexed teamId, address indexed removedMember);
    event AuditTeamAssigned(uint256 indexed proposalId, uint256 indexed teamId);
    event GovernanceTimelockUpdated(address indexed oldTimelock, address indexed newTimelock);

    modifier onlyGovernance() {
        require(
            msg.sender == owner() || (governanceTimelock != address(0) && msg.sender == governanceTimelock),
            "Not authorized (requires governance)"
        );
        _;
    }

    constructor() Ownable(msg.sender) {}

    function setGovernanceTimelock(address _timelock) external onlyOwner {
        require(_timelock != address(0), "Invalid address");
        emit GovernanceTimelockUpdated(governanceTimelock, _timelock);
        governanceTimelock = _timelock;
    }

    /// @dev 注册审计团队（需要治理授权）
    function registerAuditTeam(
        string calldata name,
        address teamContract,
        address[] calldata members
    ) external onlyGovernance returns (uint256) {
        require(members.length >= 2, "At least 2 members required");
        require(bytes(name).length > 0, "Name required");
        require(teamContract != address(0), "Invalid contract address");
        require(teamIdByAddress[teamContract] == 0, "Team already registered");

        uint256 teamId = nextAuditTeamId++;
        AuditTeamInfo storage team = auditTeams[teamId];
        team.id = teamId;
        team.teamContract = teamContract;
        team.name = name;
        team.totalAudits = 0;
        team.successfulAudits = 0;
        team.reputation = 50;
        team.members = members;
        team.active = true;
        team.createdAt = block.timestamp;

        teamIdByAddress[teamContract] = teamId;
        activeTeamIds.push(teamId);

        emit AuditTeamCreated(teamId, teamContract, name, members);
        return teamId;
    }

    /// @dev 停用审计团队（需要治理授权）
    function deactivateAuditTeam(uint256 teamId) external onlyGovernance {
        AuditTeamInfo storage team = auditTeams[teamId];
        require(team.active, "Team already inactive");
        team.active = false;

        for (uint256 i = 0; i < activeTeamIds.length; i++) {
            if (activeTeamIds[i] == teamId) {
                activeTeamIds[i] = activeTeamIds[activeTeamIds.length - 1];
                activeTeamIds.pop();
                break;
            }
        }

        emit AuditTeamDeactivated(teamId);
    }

    /// @dev 设置DAO合约地址（需要治理授权）
    function setDaoContract(address _dao) external onlyGovernance {
        daoContract = _dao;
    }

    function assignAuditTeam(uint256 proposalId, uint256 teamId) external {
        require(msg.sender == owner() || msg.sender == daoContract, "Not authorized");
        require(auditTeams[teamId].active, "Team not active");
        proposalToTeam[proposalId] = teamId;
        if (proposalId > maxAssignedProposalId) {
            maxAssignedProposalId = proposalId;
        }
        emit AuditTeamAssigned(proposalId, teamId);
    }

    /// @dev 更新团队统计（由DAO合约自动调用）
    function updateTeamStats(uint256 proposalId, bool success) external {
        require(msg.sender == owner() || msg.sender == daoContract, "Not authorized");
        uint256 teamId = proposalToTeam[proposalId];
        AuditTeamInfo storage team = auditTeams[teamId];
        team.totalAudits++;
        if (success) {
            team.successfulAudits++;
            team.reputation = team.reputation + 5 > 100 ? 100 : team.reputation + 5;
        } else {
            team.reputation = team.reputation > 3 ? team.reputation - 3 : 0;
        }
    }

    function getActiveAuditTeams() external view returns (uint256[] memory) {
        return activeTeamIds;
    }

    function getAuditTeam(uint256 teamId) external view returns (
        uint256 id,
        address teamContract,
        string memory name,
        uint256 totalAudits,
        uint256 successfulAudits,
        uint256 reputation,
        address[] memory members,
        bool active,
        uint256 createdAt
    ) {
        AuditTeamInfo storage team = auditTeams[teamId];
        return (
            team.id,
            team.teamContract,
            team.name,
            team.totalAudits,
            team.successfulAudits,
            team.reputation,
            team.members,
            team.active,
            team.createdAt
        );
    }

    function getTeamAccuracy(uint256 teamId) external view returns (uint256) {
        AuditTeamInfo storage team = auditTeams[teamId];
        if (team.totalAudits == 0) return 0;
        return (team.successfulAudits * 100) / team.totalAudits;
    }

    function addAuditTeamMember(uint256 teamId, address newMember) external onlyGovernance {
        require(newMember != address(0), "Invalid member address");
        AuditTeamInfo storage team = auditTeams[teamId];
        require(team.id == teamId, "Team does not exist");
        require(team.active, "Team is not active");

        for (uint256 i = 0; i < team.members.length; i++) {
            require(team.members[i] != newMember, "Member already exists");
        }

        team.members.push(newMember);
        emit AuditTeamMemberAdded(teamId, newMember);
    }

    function removeAuditTeamMember(uint256 teamId, address memberToRemove) external onlyGovernance {
        require(memberToRemove != address(0), "Invalid member address");
        AuditTeamInfo storage team = auditTeams[teamId];
        require(team.id == teamId, "Team does not exist");
        require(team.active, "Team is not active");
        require(team.members.length > 2, "Cannot reduce below 2 members");

        bool found = false;
        for (uint256 i = 0; i < team.members.length; i++) {
            if (team.members[i] == memberToRemove) {
                team.members[i] = team.members[team.members.length - 1];
                team.members.pop();
                found = true;
                break;
            }
        }
        require(found, "Member not found in team");

        emit AuditTeamMemberRemoved(teamId, memberToRemove);
    }

    function getTeamMemberCount(uint256 teamId) external view returns (uint256) {
        return auditTeams[teamId].members.length;
    }

    function getTeamClaimedProposals(uint256 teamId) external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i <= maxAssignedProposalId; i++) {
            if (proposalToTeam[i] == teamId) {
                count++;
            }
        }
        uint256[] memory claimedIds = new uint256[](count);
        uint256 index = 0;
        for (uint256 i = 0; i <= maxAssignedProposalId; i++) {
            if (proposalToTeam[i] == teamId) {
                claimedIds[index] = i;
                index++;
            }
        }
        return claimedIds;
    }
}
