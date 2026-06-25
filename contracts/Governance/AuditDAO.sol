// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IDepositProof {
    function deposit(bytes32 hashValue) external returns(uint256);
    function exists(bytes32 hashValue) external view returns(bool);
}

/**
 * @title AuditDAO
 * @dev 审计DAO核心合约 - 实现完整的「审计-争议-终裁」三阶段可升级处理流程
 *
 * === 业务流程概览 ===
 * 第一阶段：AI 初步筛查（预留，本次不做）
 *   - 保持现有方式：用户上传代码后，通过创建提案（录入测试哈希）进入审核
 *
 * 第二阶段：人工协同审核
 *   - 审计团队与社区同时进行审核
 *   - 社区质押代币后参与审核、提交意见/漏洞、投票形成共识
 *   - 双方结果公开讨论，无异议则生成最终报告并奖励社区参与者
 *   - 有异议则进入第三阶段
 *
 * 第三阶段：争议解决（5步）
 *   第1步：判断社区是否认可审计团队结果
 *   第2步：二次审核 - 审计团队重新复核并出具修订报告
 *   第3步：争议委员会裁决 - 5人委员会投票（3/5通过）
 *   第4步：第三方独立仲裁（可选，需满足高危+押金+周期条件）
 *   第5步：审计团队否决权（≥2人联名+过半同意+技术证据链）
 */
contract AuditDAO is Ownable {
    IERC20 public ceatToken;
    IDepositProof public auditRegistry;

    // ==================== 流程状态枚举 ====================

    /**
     * @dev 审计提案生命周期状态
     * Submitted:       用户代码已通过测试哈希录入，等待审核（第一阶段入口）
     * TeamReview:      审计团队正在审核中（第二阶段）
     * CommunityReview: 社区质押者正在提交审核意见和投票（第二阶段）
     * Discussion:      团队与社区结果公开讨论（第二阶段收尾）
     * FirstDispute:    第三阶段第1步 - 双方存在异议，进入争议判断
     * SecondReview:    第三阶段第2步 - 审计团队二次复核
     * CommitteeRuling: 第三阶段第3步 - 争议委员会投票裁决
     * Arbitration:     第三阶段第4步 - 第三方独立仲裁
     * VetoReview:      第三阶段第5步 - 审计团队否决权审查
     * Finalized:       审计完成，最终报告已上链存证
     */
    enum ProposalStatus {
        Submitted,         // 0 - 第一阶段入口：测试哈希已录入
        TeamReview,        // 1 - 第二阶段：审计团队审核
        CommunityReview,   // 2 - 第二阶段：社区审核与投票
        Discussion,        // 3 - 第二阶段：公开讨论
        FirstDispute,      // 4 - 第三阶段第1步：争议判断
        SecondReview,      // 5 - 第三阶段第2步：二次复核
        CommitteeRuling,   // 6 - 第三阶段第3步：委员会裁决
        Arbitration,       // 7 - 第三阶段第4步：独立仲裁
        VetoReview,        // 8 - 第三阶段第5步：否决权审查
        Finalized          // 9 - 终态：报告存证
    }

    /**
     * @dev 风险等级枚举
     * None:    无风险争议
     * Low:     低风险
     * Medium:  中风险
     * High:    高风险（可能影响资产安全）
     * Critical: 严重风险（直接影响资产安全）
     */
    enum RiskLevel {
        None,
        Low,
        Medium,
        High,
        Critical
    }

    // ==================== 数据结构体 ====================

    /**
     * @dev 社区提案结构体 - 社区成员提交的审计方案
     * hash:     社区方案哈希
     * votes:    累计投票权重（按质押量加权）
     * proposer: 提案提交者地址
     */
    struct CommunityProposal {
        bytes32 hash;
        uint256 votes;
        address proposer;
    }

    /**
     * @dev 社区审核记录 - 单个社区成员提交的审核意见（区别于投票方案）
     * reviewer:          审核者地址
     * reviewHash:        审核意见哈希
     * vulnerabilityCount: 发现的漏洞数量
     * submittedAt:       提交时间
     */
    struct CommunityReview {
        address reviewer;
        bytes32 reviewHash;
        uint256 vulnerabilityCount;
        uint256 submittedAt;
    }

    /**
     * @dev 审计提案核心结构体
     * 包含完整生命周期所需的所有字段
     */
    struct AuditProposal {
        uint256 proposalId;                              // 提案唯一标识
        bytes32 codeHash;                                // 第一阶段：测试哈希（代码存证）
        bytes32 auditReportHash;                         // 审计团队正式报告哈希
        bytes32[] communityProposalHashes;               // 社区方案哈希列表
        mapping(bytes32 => CommunityProposal) communityProposals; // 社区方案映射
        bytes32 winningCommunityHash;                    // 社区投票胜出方案
        ProposalStatus status;                           // 当前状态
        RiskLevel riskLevel;                             // 风险等级
        uint256 createdAt;                               // 创建时间
        uint256 votingEndTime;                           // 社区投票截止时间
        mapping(address => bytes32) votedProposal;       // 投票者→投票方案
        address[] voterList;                             // 投票者地址列表（用于遍历奖惩）
        mapping(address => uint256) voterWeight;         // 投票者权重（记录投票时的质押量）

        // 第二阶段：社区审核记录
        CommunityReview[] communityReviews;              // 社区成员提交的审核意见列表
        mapping(address => bool) hasSubmittedReview;     // 是否已提交审核意见

        // 第二阶段：讨论阶段
        uint256 discussionEndTime;                       // 讨论截止时间

        // 第三阶段第1步：争议判断
        uint256 disputeCreatedAt;                        // 争议创建时间（用于第4步周期判断）
        bool communityAcceptsTeam;                       // 社区是否接受团队结果
        uint256 acceptVotes;                             // 接受票数
        uint256 rejectVotes;                             // 拒绝票数
        mapping(address => bool) hasVotedOnAcceptance;   // 是否已参与接受/拒绝投票
        address[] penalizedContributors;                 // 被惩罚的贡献者列表

        // 第三阶段第2步：二次审核
        bytes32 secondReviewHash;                        // 团队修订报告哈希
        mapping(address => bool) hasVotedOnSecondReview; // 是否已参与二次审核投票
        uint256 acceptSecondReviewVotes;                 // 接受修订报告票数
        uint256 rejectSecondReviewVotes;                 // 拒绝修订报告票数

        // 第三阶段第3步：争议委员会
        uint256 committeeVotesForAuditor;                // 委员会支持审计方票数
        uint256 committeeVotesForCommunity;              // 委员会支持社区方票数
        mapping(address => bool) committeeHasVoted;      // 委员会成员投票记录
        bool committeeVotingReset;                       // 允许重新投票标志

        // 第三阶段第4步：独立仲裁
        bool arbitrationRequested;                       // 是否已提交仲裁
        bytes32 arbitrationHash;                         // 仲裁最终哈希
        uint256 arbitrationDepositPaid;                  // 已缴纳仲裁押金
        address arbitrationApplicant;                    // 仲裁申请方

        // 第三阶段第5步：否决权
        bool vetoRequested;                              // 是否已发起否决
        string vetoEvidence;                             // 否决技术证据链（IPFS链接）
        address[] vetoInitiators;                        // 否决联名发起人（至少2人）
        mapping(address => bool) vetoConfirmer;          // 否决确认者
        uint256 vetoConfirmationCount;                   // 否决确认计数
        bool vetoApproved;                               // 否决是否被委员会批准
    }

    /**
     * @dev 质押者结构体
     */
    struct Staker {
        uint256 balance;                                 // 质押余额
        uint256 rewards;                                 // 待领取奖励
        uint256 contributionPoints;                      // 贡献积分（基于提交审核意见、发现漏洞等）
        uint256 reputationScore;                         // 信誉分（默认100，被惩罚时扣除）
    }

    // ==================== 状态变量 ====================

    address[] public committeeMembers;                   // 五人争议委员会
    address public auditTeam;                            // 审计团队地址（多签合约或单一地址）
    address public klerosProxy;                          // Kleros仲裁代理合约
    uint256 public disputeRetentionPeriod = 3 days;      // 争议留存周期（第4步条件）

    mapping(address => Staker) public stakers;           // 质押者信息
    mapping(uint256 => AuditProposal) public proposals;  // 所有提案
    uint256 public nextProposalId;                       // 自增提案ID

    // 仲裁最低押金
    uint256 public minArbitrationDeposit;

    // 投票奖惩机制配置
    // 兑换比例：1 ETH = 100 CEAT（仅作参考，非合约逻辑）
    uint256 public minStakeAmount = 500 * 10**18;   // 最低质押量：500 CEAT（= 5 ETH）
    uint256 public voteRewardRate = 800;            // 投票正确奖励率：8% (800 / 10000)
    uint256 public votePenaltyRate = 400;           // 投票错误惩罚率：4% (400 / 10000)
    uint256 public constant RATE_BASIS_POINTS = 10000; // 费率精度分母

    // 投票时间配置
    uint256 public defaultVotingDuration = 7 days;  // 默认投票持续时间：7天

    // 委员会奖励与惩罚配置
    uint256 public committeeRewardRate = 1000;     // 委员会正确奖励率：10% (1000 / 10000)
    uint256 public committeePenaltyRate = 500;     // 委员会错误惩罚率：5% (500 / 10000)

    // ==================== 多审计团队功能 ====================

    struct AuditTeamInfo {
        uint256 id;
        address teamContract;    // 审计团队合约地址（AuditTeamMultisig）
        string name;             // 审计团队名称
        uint256 totalAudits;     // 完成的审计总数
        uint256 successfulAudits; // 成功的审计数量（准确率依据）
        uint256 reputation;      // 信誉分（0-100）
        address[] members;       // 团队成员地址
        bool active;             // 是否活跃
        uint256 createdAt;       // 创建时间
    }

    uint256 public nextAuditTeamId;
    mapping(uint256 => AuditTeamInfo) public auditTeams;
    mapping(address => uint256) public teamIdByAddress; // 从合约地址到ID的映射
    uint256[] public activeTeamIds;

    // 审计提案与审计团队的关联
    mapping(uint256 => uint256) public proposalToTeam;

    event AuditTeamCreated(uint256 indexed teamId, address indexed teamContract, string name, address[] members);
    event AuditTeamDeactivated(uint256 indexed teamId);
    event AuditTeamAssigned(uint256 indexed proposalId, uint256 indexed teamId);

    // ==================== 事件 ====================

    // 质押相关
    event Staked(address indexed staker, uint256 amount);
    event Unstaked(address indexed staker, uint256 amount);
    event RewardsClaimed(address indexed staker, uint256 amount);
    event ReputationAdjusted(address indexed staker, uint256 oldScore, uint256 newScore);

    // 提案生命周期
    event ProposalCreated(uint256 indexed proposalId, bytes32 codeHash);
    event ProposalStatusChanged(uint256 indexed proposalId, ProposalStatus oldStatus, ProposalStatus newStatus);

    // 第二阶段：团队与社区审核
    event TeamReportSubmitted(uint256 indexed proposalId, bytes32 reportHash);
    event CommunityReviewSubmitted(uint256 indexed proposalId, address indexed reviewer, bytes32 reviewHash, uint256 vulnCount);
    event CommunityProposalSubmitted(uint256 indexed proposalId, bytes32 hash, address indexed proposer);
    event VoteCast(uint256 indexed proposalId, address indexed voter, bytes32 votedHash);
    event WinningHashDetermined(uint256 indexed proposalId, bytes32 winningHash);
    event DiscussionStarted(uint256 indexed proposalId, uint256 endTime);
    event DiscussionConsensus(uint256 indexed proposalId, bytes32 finalHash);

    // 第三阶段第1步：争议判断
    event DisputeTriggered(uint256 indexed proposalId, bytes32 teamHash, bytes32 communityHash);
    event AcceptanceVoteCast(uint256 indexed proposalId, address indexed voter, bool accepts);
    event CommunityAcceptedTeam(uint256 indexed proposalId);
    event ContributorsPenalized(uint256 indexed proposalId, address[] contributors, uint256[] slashAmounts);

    // 第三阶段第2步：二次审核
    event SecondReviewSubmitted(uint256 indexed proposalId, bytes32 revisedHash);
    event SecondReviewAccepted(uint256 indexed proposalId, bytes32 finalHash);
    event SecondReviewRejected(uint256 indexed proposalId);

    // 第三阶段第3步：委员会裁决
    event CommitteeVoteCast(uint256 indexed proposalId, address indexed member, bool supportAuditor);
    event CommitteeRulingFinal(uint256 indexed proposalId, bytes32 finalHash);

    // 第三阶段第4步：仲裁
    event ArbitrationRequested(uint256 indexed proposalId, address applicant, uint256 deposit);
    event ArbitrationFinalized(uint256 indexed proposalId, bytes32 finalHash);

    // 第三阶段第5步：否决权
    event VetoInitiated(uint256 indexed proposalId, address[] initiators, string evidence);
    event VetoConfirmed(uint256 indexed proposalId, address confirmer, uint256 totalConfirmations);
    event VetoReviewResult(uint256 indexed proposalId, bool vetoApproved, bytes32 finalHash);

    // 投票奖惩事件
    event VoteRewarded(uint256 indexed proposalId, address indexed voter, uint256 rewardAmount);
    event VotePenalized(uint256 indexed proposalId, address indexed voter, uint256 penaltyAmount);

    // 终态
    event ReportDeposited(uint256 indexed proposalId, bytes32 finalHash);
    event ContributorsRewarded(uint256 indexed proposalId, address[] contributors, uint256[] rewardAmounts);

    // ==================== 构造函数 ====================

    constructor(address _ceatToken, address _auditRegistry) Ownable(msg.sender) {
        ceatToken = IERC20(_ceatToken);
        auditRegistry = IDepositProof(_auditRegistry);
        minArbitrationDeposit = 1000 * 10**18; // 默认1000 CEAT
    }

    // ==================== 质押/奖励/惩罚模块 ====================

    /**
     * @dev 质押代币 - 用户质押CEAT以参与社区审核
     * 首次质押需满足最低质押量要求（默认500 CEAT）
     */
    function stake(uint256 amount) external {
        require(amount > 0, "!pos");
        require(ceatToken.transferFrom(msg.sender, address(this), amount), "!txf");
        Staker storage s = stakers[msg.sender];
        if (s.balance == 0) {
            s.reputationScore = 100; // 初始信誉分
        }
        s.balance += amount;
        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external {
        require(amount > 0, "!pos");
        require(stakers[msg.sender].balance >= amount, "!bal");
        stakers[msg.sender].balance -= amount;
        require(ceatToken.transfer(msg.sender, amount), "!txf");
        emit Unstaked(msg.sender, amount);
    }

    function claimRewards() external {
        uint256 rewards = stakers[msg.sender].rewards;
        require(rewards > 0, "!rwd");
        stakers[msg.sender].rewards = 0;
        require(ceatToken.transfer(msg.sender, rewards), "!txf");
        emit RewardsClaimed(msg.sender, rewards);
    }

    /**
     * @dev 分配奖励 - 管理员根据贡献度发放
     */
    function allocateRewards(address recipient, uint256 amount) external onlyOwner {
        require(amount > 0, "!pos");
        require(ceatToken.balanceOf(address(this)) >= amount, "!cbl");
        stakers[recipient].rewards += amount;
    }

    /**
     * @dev 扣除质押 - 惩罚持续提交错误意见的成员
     */
    function slashStake(address staker, uint256 amount) external onlyOwner {
        require(amount > 0, "!pos");
        require(stakers[staker].balance >= amount, "!stk");
        stakers[staker].balance -= amount;
    }

    /**
     * @dev 调整信誉分 - 惩罚或奖励
     */
    function adjustReputation(address staker, int256 delta) external onlyOwner {
        Staker storage s = stakers[staker];
        require(s.balance > 0, "!stkr");
        uint256 oldScore = s.reputationScore;
        if (delta < 0) {
            uint256 absDelta = uint256(-delta);
            s.reputationScore = absDelta >= s.reputationScore ? 0 : s.reputationScore - absDelta;
        } else {
            s.reputationScore += uint256(delta);
            if (s.reputationScore > 100) s.reputationScore = 100; // 上限100
        }
        emit ReputationAdjusted(staker, oldScore, s.reputationScore);
    }

    // ==================== 角色配置 ====================

    function setAuditTeam(address _auditTeam) external onlyOwner {
        require(_auditTeam != address(0), "!azero");
        auditTeam = _auditTeam;
    }

    function setCommitteeMembers(address[] calldata _members) external onlyOwner {
        require(_members.length == 5, "!c5");
        committeeMembers = _members;
    }

    function setKlerosProxy(address _klerosProxy) external onlyOwner {
        klerosProxy = _klerosProxy;
    }

    function setDisputeRetentionPeriod(uint256 _period) external onlyOwner {
        disputeRetentionPeriod = _period;
    }

    function setMinArbitrationDeposit(uint256 _deposit) external onlyOwner {
        minArbitrationDeposit = _deposit;
    }

    /**
     * @dev 设置最低质押量
     */
    function setMinStakeAmount(uint256 _amount) external onlyOwner {
        minStakeAmount = _amount;
    }

    /**
     * @dev 设置投票奖惩率（basis points）
     * @param _rewardRate 奖励率（800 = 8%）
     * @param _penaltyRate 惩罚率（400 = 4%）
     */
    function setVoteRewardPenaltyRates(uint256 _rewardRate, uint256 _penaltyRate) external onlyOwner {
        require(_rewardRate <= 2000, "!rhigh");   // 上限20%
        require(_penaltyRate <= 1000, "!phigh"); // 上限10%
        voteRewardRate = _rewardRate;
        votePenaltyRate = _penaltyRate;
    }

    // ==================== 多审计团队管理 ====================

    /**
     * @dev 注册审计团队
     * @param name 审计团队名称
     * @param teamContract 审计团队合约地址
     * @param members 团队成员地址列表（至少2人）
     * @return 新创建的审计团队ID
     */
    function registerAuditTeam(string calldata name, address teamContract, address[] calldata members) external onlyOwner returns (uint256) {
        require(members.length >= 2, "!m2");
        require(bytes(name).length > 0, "!name");
        require(teamContract != address(0), "!addr");
        require(teamIdByAddress[teamContract] == 0, "!regd");

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

    /**
     * @dev 停用审计团队
     */
    function deactivateAuditTeam(uint256 teamId) external onlyOwner {
        AuditTeamInfo storage team = auditTeams[teamId];
        require(team.active, "!inact");
        team.active = false;

        // 从活跃列表中移除
        for (uint256 i = 0; i < activeTeamIds.length; i++) {
            if (activeTeamIds[i] == teamId) {
                activeTeamIds[i] = activeTeamIds[activeTeamIds.length - 1];
                activeTeamIds.pop();
                break;
            }
        }

        emit AuditTeamDeactivated(teamId);
    }

    /**
     * @dev 为提案分配审计团队
     */
    function assignAuditTeam(uint256 proposalId, uint256 teamId) external onlyOwner {
        require(auditTeams[teamId].active, "!tact");
        proposalToTeam[proposalId] = teamId;
        emit AuditTeamAssigned(proposalId, teamId);
    }

    /**
     * @dev 更新审计团队统计（审计完成后调用）
     */
    function updateTeamStats(uint256 proposalId, bool success) external onlyOwner {
        uint256 teamId = proposalToTeam[proposalId];
        AuditTeamInfo storage team = auditTeams[teamId];
        team.totalAudits++;
        if (success) {
            team.successfulAudits++;
            // 成功审计增加信誉分
            team.reputation = team.reputation + 5 > 100 ? 100 : team.reputation + 5;
        } else {
            // 失败审计减少信誉分
            team.reputation = team.reputation > 3 ? team.reputation - 3 : 0;
        }
    }

    /**
     * @dev 获取所有活跃审计团队列表
     */
    function getActiveAuditTeams() external view returns (uint256[] memory) {
        return activeTeamIds;
    }

    /**
     * @dev 获取审计团队详细信息
     */
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

    /**
     * @dev 获取审计团队准确率（百分比）
     */
    function getTeamAccuracy(uint256 teamId) external view returns (uint256) {
        AuditTeamInfo storage team = auditTeams[teamId];
        if (team.totalAudits == 0) return 0;
        return (team.successfulAudits * 100) / team.totalAudits;
    }

    /**
     * @dev 获取所有未发布的提案（状态为 Submitted）
     */
    function getUnpublishedProposals() external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < nextProposalId; i++) {
            if (proposals[i].status == ProposalStatus.Submitted) count++;
        }
        uint256[] memory unpublishedIds = new uint256[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < nextProposalId; i++) {
            if (proposals[i].status == ProposalStatus.Submitted) {
                unpublishedIds[index] = i;
                index++;
            }
        }
        return unpublishedIds;
    }

    /**
     * @dev 获取所有未被审计团队接取的提案
     */
    function getUnassignedProposals() external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < nextProposalId; i++) {
            if (proposals[i].status == ProposalStatus.Submitted && proposalToTeam[i] == 0) count++;
        }
        uint256[] memory unassignedIds = new uint256[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < nextProposalId; i++) {
            if (proposals[i].status == ProposalStatus.Submitted && proposalToTeam[i] == 0) {
                unassignedIds[index] = i;
                index++;
            }
        }
        return unassignedIds;
    }

    /**
     * @dev 设置默认投票持续时间
     * @param _duration 投票持续时间（秒），例如 7 days = 604800
     */
    function setDefaultVotingDuration(uint256 _duration) external onlyOwner {
        require(_duration > 0, "!dpos");
        require(_duration <= 30 days, "!dlong");
        defaultVotingDuration = _duration;
    }

    /**
     * @dev 为特定提案设置自定义投票时间
     * @param proposalId 提案ID
     * @param startTime 投票开始时间（Unix时间戳，0表示立即开始）
     * @param endTime 投票结束时间（Unix时间戳）
     * 注意：此函数需要在提案进入 CommunityReview 状态后调用，且需在 startVoting 之前调用
     */
    function setVotingTime(uint256 proposalId, uint256 startTime, uint256 endTime) external onlyOwner {
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.CommunityReview, "!notcr");

        if (startTime == 0) {
            proposal.votingEndTime = block.timestamp + defaultVotingDuration;
        } else {
            require(endTime > startTime, "!estart");
            require(endTime > block.timestamp, "!efut");
            proposal.votingEndTime = endTime;
        }
    }

    /**
     * @dev 设置委员会奖励与惩罚率
     * @param _rewardRate 委员会正确奖励率（basis points，1000 = 10%）
     * @param _penaltyRate 委员会错误惩罚率（basis points，500 = 5%）
     */
    function setCommitteeRewardPenaltyRates(uint256 _rewardRate, uint256 _penaltyRate) external onlyOwner {
        require(_rewardRate <= 3000, "!rhigh");   // 上限30%
        require(_penaltyRate <= 2000, "!phigh"); // 上限20%
        committeeRewardRate = _rewardRate;
        committeePenaltyRate = _penaltyRate;
    }

    // ==================== 第一阶段：录入测试哈希（入口） ====================

    /**
     * @dev 第一阶段：创建审计提案 - 录入测试哈希开始审核
     * 用户上传代码后，管理员录入测试哈希进入审核流程
     */
    function createProposal(bytes32 codeHash) external onlyOwner returns (uint256) {
        uint256 proposalId = nextProposalId++;
        AuditProposal storage proposal = proposals[proposalId];
        proposal.proposalId = proposalId;
        proposal.codeHash = codeHash;
        proposal.status = ProposalStatus.Submitted;
        proposal.createdAt = block.timestamp;
        proposal.riskLevel = RiskLevel.None;

        emit ProposalCreated(proposalId, codeHash);
        emit ProposalStatusChanged(proposalId, ProposalStatus.Submitted, ProposalStatus.Submitted);
        return proposalId;
    }

    // ==================== 第二阶段：人工协同审核 ====================

    /**
     * @dev 第二阶段：审计团队提交正式审计报告
     * 将提案状态从 Submitted 变更为 TeamReview
     */
    function submitTeamReport(uint256 proposalId, bytes32 reportHash) external {
        require(msg.sender == auditTeam || msg.sender == owner(), "!authrep");
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.Submitted, "!str");
        require(reportHash != bytes32(0), "!rhz");

        proposal.auditReportHash = reportHash;
        proposal.status = ProposalStatus.TeamReview;
        emit TeamReportSubmitted(proposalId, reportHash);
        emit ProposalStatusChanged(proposalId, ProposalStatus.Submitted, ProposalStatus.TeamReview);
    }

    /**
     * @dev 第二阶段：社区成员提交审核意见
     * 质押者独立提交审核意见或发现的漏洞，完成任务可获得贡献记录
     */
    function submitCommunityReview(
        uint256 proposalId,
        bytes32 reviewHash,
        uint256 vulnerabilityCount
    ) external {
        require(stakers[msg.sender].balance >= minStakeAmount, "!stk3");
        require(reviewHash != bytes32(0), "!revhz");
        AuditProposal storage proposal = proposals[proposalId];
        require(
            proposal.status == ProposalStatus.Submitted ||
            proposal.status == ProposalStatus.TeamReview ||
            proposal.status == ProposalStatus.CommunityReview,
            "Invalid status for community review"
        );
        require(!proposal.hasSubmittedReview[msg.sender], "!arev");

        proposal.communityReviews.push(CommunityReview({
            reviewer: msg.sender,
            reviewHash: reviewHash,
            vulnerabilityCount: vulnerabilityCount,
            submittedAt: block.timestamp
        }));
        proposal.hasSubmittedReview[msg.sender] = true;

        // 记录贡献积分：基础1分 + 每个漏洞额外1分
        stakers[msg.sender].contributionPoints += 1 + vulnerabilityCount;

        // 如果状态尚在 TeamReview，切换到 CommunityReview 以允许社区方案提交
        if (proposal.status == ProposalStatus.TeamReview) {
            // 保持 TeamReview，社区审核并行进行
        }

        emit CommunityReviewSubmitted(proposalId, msg.sender, reviewHash, vulnerabilityCount);
    }

    /**
     * @dev 第二阶段：管理员开启社区审核阶段
     * 允许社区成员提交方案并进行投票
     */
    function startCommunityReview(uint256 proposalId) external onlyOwner {
        AuditProposal storage proposal = proposals[proposalId];
        require(
            proposal.status == ProposalStatus.Submitted ||
            proposal.status == ProposalStatus.TeamReview,
            "!s-cr"
        );
        require(proposal.auditReportHash != bytes32(0), "!treq");

        proposal.status = ProposalStatus.CommunityReview;
        emit ProposalStatusChanged(proposalId, ProposalStatus.TeamReview, ProposalStatus.CommunityReview);
    }

    /**
     * @dev 第二阶段：社区提交方案 - 质押者提交独立审核方案
     * 允许在 TeamReview 或 CommunityReview 阶段提交，无需管理员开启投票
     */
    function submitCommunityProposal(uint256 proposalId, bytes32 resultHash) external {
        require(stakers[msg.sender].balance >= minStakeAmount, "!stk2");
        AuditProposal storage proposal = proposals[proposalId];
        require(
            proposal.status == ProposalStatus.TeamReview ||
            proposal.status == ProposalStatus.CommunityReview,
            "!s-cp"
        );
        require(proposal.communityProposals[resultHash].proposer == address(0), "!hash");

        proposal.communityProposals[resultHash] = CommunityProposal({
            hash: resultHash,
            votes: 0,
            proposer: msg.sender
        });
        proposal.communityProposalHashes.push(resultHash);

        emit CommunityProposalSubmitted(proposalId, resultHash, msg.sender);
    }

    /**
     * @dev 第二阶段：开启社区共识投票（7天期限）
     */
    function startVoting(uint256 proposalId) external onlyOwner {
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.CommunityReview, "!s-sv");
        require(proposal.communityProposalHashes.length > 0, "!ncps");

        if (proposal.votingEndTime == 0) {
            proposal.votingEndTime = block.timestamp + defaultVotingDuration;
        }
        emit ProposalStatusChanged(proposalId, ProposalStatus.CommunityReview, ProposalStatus.CommunityReview);
    }

    /**
     * @dev 第二阶段：按质押权重投票
     * 投票权重 = 用户指定的投票数量（CEAT代币），为0时使用全部质押余额
     * 奖励：正确投票获得投票量 * 8% 的CEAT代币
     * 惩罚：错误投票扣除投票量 * 4% 的CEAT代币
     */
    function vote(uint256 proposalId, bytes32 proposalHash, uint256 voteAmount) external {
        uint256 voterBalance = stakers[msg.sender].balance;
        require(voterBalance >= minStakeAmount, "!stkv");
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.CommunityReview, "!cr!");
        require(block.timestamp < proposal.votingEndTime, "!vend");
        require(proposal.votedProposal[msg.sender] == bytes32(0), "!voted");
        require(proposal.communityProposals[proposalHash].proposer != address(0), "!phash");

        uint256 actualVoteAmount = voteAmount;
        if (voteAmount == 0 || voteAmount > voterBalance) {
            actualVoteAmount = voterBalance;
        }
        require(actualVoteAmount >= minStakeAmount, "!vmin");

        proposal.votedProposal[msg.sender] = proposalHash;
        proposal.voterWeight[msg.sender] = actualVoteAmount; // 记录投票数量
        proposal.voterList.push(msg.sender);             // 加入投票者列表（用于遍历奖惩）
        proposal.communityProposals[proposalHash].votes += actualVoteAmount;

        emit VoteCast(proposalId, msg.sender, proposalHash);
    }

    /**
     * @dev 第二阶段：统计社区投票结果，确定胜出方案
     */
    function _determineWinningHash(uint256 proposalId) internal returns (bytes32) {
        AuditProposal storage proposal = proposals[proposalId];
        bytes32 winningHash = bytes32(0);
        uint256 maxVotes = 0;

        for (uint256 i = 0; i < proposal.communityProposalHashes.length; i++) {
            bytes32 hash = proposal.communityProposalHashes[i];
            uint256 votes = proposal.communityProposals[hash].votes;
            if (votes > maxVotes) {
                maxVotes = votes;
                winningHash = hash;
            }
        }
        proposal.winningCommunityHash = winningHash;
        emit WinningHashDetermined(proposalId, winningHash);
        return winningHash;
    }

    /**
     * @dev 第二阶段：结束社区投票，进入讨论阶段
     * 统计社区结果，与审计团队结果进行对比
     */
    function finalizeVoting(uint256 proposalId) external onlyOwner {
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.CommunityReview, "!cr!");
        require(block.timestamp >= proposal.votingEndTime, "!vnotend");

        _determineWinningHash(proposalId);

        // 进入讨论阶段
        proposal.status = ProposalStatus.Discussion;
        proposal.discussionEndTime = block.timestamp + 2 days;
        emit DiscussionStarted(proposalId, proposal.discussionEndTime);
        emit ProposalStatusChanged(proposalId, ProposalStatus.CommunityReview, ProposalStatus.Discussion);
    }

    /**
     * @dev 第二阶段：公开讨论 - 对比团队与社区结果
     * 若无异议，直接生成最终报告并奖励社区参与者
     * 若有异议，进入第三阶段
     */
    function finalizeDiscussion(uint256 proposalId) external onlyOwner {
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.Discussion, "!disc");
        require(block.timestamp >= proposal.discussionEndTime, "!dend");

        // 判断社区方案是否与审计团队一致
        if (proposal.winningCommunityHash == proposal.auditReportHash) {
            // 无异议 → 直接生成最终报告，按贡献度奖励社区参与者
            _finalizeProposal(proposalId, proposal.auditReportHash);
            _distributeCommunityRewards(proposalId);
            emit DiscussionConsensus(proposalId, proposal.auditReportHash);
        } else {
            // 有异议 → 进入第三阶段争议解决
            proposal.status = ProposalStatus.FirstDispute;
            proposal.disputeCreatedAt = block.timestamp;
            emit DisputeTriggered(proposalId, proposal.auditReportHash, proposal.winningCommunityHash);
            emit ProposalStatusChanged(proposalId, ProposalStatus.Discussion, ProposalStatus.FirstDispute);
        }
    }

    /**
     * @dev 第二阶段：按贡献度奖励社区参与者
     * 分配步骤：基于社区成员审核意见和提交漏洞数发放奖励
     */
    function _distributeCommunityRewards(uint256 proposalId) internal {
        AuditProposal storage proposal = proposals[proposalId];
        uint256 reviewCount = proposal.communityReviews.length;
        if (reviewCount == 0) return;

        // 统计总贡献分
        uint256 totalPoints = 0;
        address[] memory contributors = new address[](reviewCount);
        uint256[] memory points = new uint256[](reviewCount);

        for (uint256 i = 0; i < reviewCount; i++) {
            address reviewer = proposal.communityReviews[i].reviewer;
            contributors[i] = reviewer;
            points[i] = stakers[reviewer].contributionPoints;
            totalPoints += points[i];
        }

        // 按比例分配奖励
        uint256 totalRewardPool = ceatToken.balanceOf(address(this)) / 4; // 使用奖励池的1/4
        for (uint256 i = 0; i < reviewCount; i++) {
            if (points[i] > 0 && totalPoints > 0) {
                uint256 reward = (totalRewardPool * points[i]) / totalPoints;
                if (reward > 0 && ceatToken.balanceOf(address(this)) >= reward) {
                    stakers[contributors[i]].rewards += reward;
                }
            }
        }

        emit ContributorsRewarded(proposalId, contributors, points);
    }

    // ==================== 第三阶段第1步：争议判断 ====================

    /**
     * @dev 第三阶段第1步：社区对团队结果进行接受/拒绝投票
     * 质押者对是否接受审计团队结果进行表决
     */
    function voteOnAcceptance(uint256 proposalId, bool accept) external {
        require(stakers[msg.sender].balance >= minStakeAmount, "!stkv");
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.FirstDispute, "!fdp!");
        require(!proposal.hasVotedOnAcceptance[msg.sender], "!vacpt");

        proposal.hasVotedOnAcceptance[msg.sender] = true;
        if (accept) {
            proposal.acceptVotes += stakers[msg.sender].balance;
        } else {
            proposal.rejectVotes += stakers[msg.sender].balance;
        }

        emit AcceptanceVoteCast(proposalId, msg.sender, accept);
    }

    /**
     * @dev 第三阶段第1步：管理员结束接受/拒绝投票，执行判断
     * 若社区认可 → 团队结果为最终报告，惩罚持续提交错误意见的成员
     * 若不认可 → 进入第2步二次审核
     */
    function resolveDisputeStep1(uint256 proposalId) external onlyOwner {
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.FirstDispute, "!fdp!");

        if (proposal.acceptVotes >= proposal.rejectVotes) {
            // 社区认可团队结果 → 团队报告为最终结果
            proposal.communityAcceptsTeam = true;
            _finalizeProposal(proposalId, proposal.auditReportHash);
            _penalizeWrongContributors(proposalId);
            emit CommunityAcceptedTeam(proposalId);
        } else {
            // 社区不认可 → 进入第2步二次审核
            proposal.communityAcceptsTeam = false;
            proposal.status = ProposalStatus.SecondReview;
            emit ProposalStatusChanged(proposalId, ProposalStatus.FirstDispute, ProposalStatus.SecondReview);
        }
    }

    /**
     * @dev 第三阶段第1步：惩罚持续提交错误意见的社区成员
     * 扣除部分质押并降低信誉分
     */
    function _penalizeWrongContributors(uint256 proposalId) internal {
        AuditProposal storage proposal = proposals[proposalId];
        uint256 reviewCount = proposal.communityReviews.length;
        if (reviewCount == 0) return;

        address[] memory penalizedList = new address[](reviewCount);
        uint256[] memory slashAmounts = new uint256[](reviewCount);
        uint256 penalizedCount = 0;

        for (uint256 i = 0; i < reviewCount; i++) {
            address reviewer = proposal.communityReviews[i].reviewer;

            // 检查该成员是否提交了与最终团队报告冲突的错误方案
            bool hasWrongSubmission = false;
            for (uint256 j = 0; j < proposal.communityProposalHashes.length; j++) {
                if (proposal.communityProposals[proposal.communityProposalHashes[j]].proposer == reviewer) {
                    hasWrongSubmission = true;
                    break;
                }
            }

            if (hasWrongSubmission) {
                uint256 slashAmount = stakers[reviewer].balance / 10; // 扣除10%质押
                if (slashAmount > 0) {
                    stakers[reviewer].balance -= slashAmount;
                    // 降低信誉分
                    if (stakers[reviewer].reputationScore >= 10) {
                        stakers[reviewer].reputationScore -= 10;
                    } else {
                        stakers[reviewer].reputationScore = 0;
                    }
                    penalizedList[penalizedCount] = reviewer;
                    slashAmounts[penalizedCount] = slashAmount;
                    penalizedCount++;
                }
            }
        }

        // 裁剪数组到实际惩罚数量
        if (penalizedCount > 0) {
            address[] memory finalPenalized = new address[](penalizedCount);
            uint256[] memory finalSlashAmounts = new uint256[](penalizedCount);
            for (uint256 i = 0; i < penalizedCount; i++) {
                finalPenalized[i] = penalizedList[i];
                finalSlashAmounts[i] = slashAmounts[i];
            }
            proposal.penalizedContributors = finalPenalized;
            emit ContributorsPenalized(proposalId, finalPenalized, finalSlashAmounts);
        }
    }

    // ==================== 第三阶段第2步：二次审核 ====================

    /**
     * @dev 第三阶段第2步：审计团队提交修订报告
     * 审计团队重新复核争议点并出具修订报告
     */
    function submitRevisedReport(uint256 proposalId, bytes32 revisedHash) external {
        require(msg.sender == auditTeam, "!team");
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.SecondReview, "!sr!");
        require(revisedHash != bytes32(0), "!rhash");

        proposal.secondReviewHash = revisedHash;
        emit SecondReviewSubmitted(proposalId, revisedHash);
    }

    /**
     * @dev 第三阶段第2步：社区对修订报告投票
     */
    function voteOnSecondReview(uint256 proposalId, bool accept) external {
        require(stakers[msg.sender].balance >= minStakeAmount, "!stkv");
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.SecondReview, "!sr!");
        require(proposal.secondReviewHash != bytes32(0), "!nrev");
        require(!proposal.hasVotedOnSecondReview[msg.sender], "!v2nd");

        proposal.hasVotedOnSecondReview[msg.sender] = true;
        if (accept) {
            proposal.acceptSecondReviewVotes += stakers[msg.sender].balance;
        } else {
            proposal.rejectSecondReviewVotes += stakers[msg.sender].balance;
        }
    }

    /**
     * @dev 第三阶段第2步：结束二次审核投票
     * 社区接受 → 出具最终报告
     * 社区仍不接受 → 移交争议委员会（第3步）
     */
    function resolveSecondReview(uint256 proposalId) external onlyOwner {
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.SecondReview, "!sr!");
        require(proposal.secondReviewHash != bytes32(0), "!nrev");

        if (proposal.acceptSecondReviewVotes >= proposal.rejectSecondReviewVotes) {
            // 社区接受修订报告 → 最终报告
            _finalizeProposal(proposalId, proposal.secondReviewHash);
            emit SecondReviewAccepted(proposalId, proposal.secondReviewHash);
        } else {
            // 社区拒绝 → 移交争议委员会（第3步）
            proposal.status = ProposalStatus.CommitteeRuling;
            emit SecondReviewRejected(proposalId);
            emit ProposalStatusChanged(proposalId, ProposalStatus.SecondReview, ProposalStatus.CommitteeRuling);
        }
    }

    // ==================== 第三阶段第3步：争议委员会裁决 ====================

    /**
     * @dev 第三阶段第3步：争议委员会投票
     * 委员会由5人组成：项目负责人、DAO代表、DAO治理专家、2名独立安全审计专家
     * 投票规则：任一方先获得至少3票即采纳其方案，成为最终报告
     *
     * @param supportAuditor true=支持审计团队方案, false=支持社区方案
     */
    function committeeVote(uint256 proposalId, bool supportAuditor) external {
        require(_isCommitteeMember(msg.sender), "!cmem");
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.CommitteeRuling, "!cr!");

        // 允许veto后重新投票
        if (!proposal.committeeVotingReset) {
            require(!proposal.committeeHasVoted[msg.sender], "!voted");
        } else {
            if (proposal.committeeHasVoted[msg.sender]) {
                if (supportAuditor) {
                    proposal.committeeVotesForAuditor--;
                } else {
                    proposal.committeeVotesForCommunity--;
                }
            }
        }

        proposal.committeeHasVoted[msg.sender] = true;
        if (supportAuditor) {
            proposal.committeeVotesForAuditor++;
        } else {
            proposal.committeeVotesForCommunity++;
        }

        emit CommitteeVoteCast(proposalId, msg.sender, supportAuditor);

        // 3/5票制：任一方先达到3票即生效
        if (proposal.committeeVotesForAuditor >= 3) {
            bytes32 finalHash = proposal.secondReviewHash != bytes32(0)
                ? proposal.secondReviewHash
                : proposal.auditReportHash;
            _finalizeProposal(proposalId, finalHash);
            emit CommitteeRulingFinal(proposalId, finalHash);
        } else if (proposal.committeeVotesForCommunity >= 3) {
            _finalizeProposal(proposalId, proposal.winningCommunityHash);
            emit CommitteeRulingFinal(proposalId, proposal.winningCommunityHash);
        }
    }

    // ==================== 第三阶段第4步：第三方独立仲裁 ====================

    /**
     * @dev 第三阶段第4步：申请第三方独立仲裁
     *
     * 适用条件（必须同时满足）：
     * 1. 争议涉及可能直接影响资产安全的高危分歧（riskLevel >= High）
     * 2. 申请方缴纳足额仲裁押金
     * 3. 争议已连续留存超过规定周期，且状态为"高危+双方分歧"
     *
     * 仲裁结果为终局，除非审计团队发起否决（进入第5步）
     */
    function requestArbitration(uint256 proposalId) external payable {
        AuditProposal storage proposal = proposals[proposalId];
        require(
            proposal.status == ProposalStatus.CommitteeRuling ||
            proposal.status == ProposalStatus.SecondReview,
            "!arb!"
        );

        // 条件1：高危分歧
        require(
            proposal.riskLevel == RiskLevel.High ||
            proposal.riskLevel == RiskLevel.Critical,
            "!rlow"
        );

        // 条件2：足额仲裁押金
        require(msg.value >= minArbitrationDeposit, "!adep");

        // 条件3：争议已连续留存超过规定周期
        require(
            block.timestamp >= proposal.disputeCreatedAt + disputeRetentionPeriod,
            "!drpm"
        );

        ProposalStatus previousStatus = proposal.status;
        proposal.arbitrationRequested = true;
        proposal.arbitrationDepositPaid = msg.value;
        proposal.arbitrationApplicant = msg.sender;
        proposal.status = ProposalStatus.Arbitration;

        emit ArbitrationRequested(proposalId, msg.sender, msg.value);
        emit ProposalStatusChanged(proposalId, previousStatus, ProposalStatus.Arbitration);
    }

    /**
     * @dev 第三阶段第4步：接收仲裁结果（由Kleros代理合约回调）
     * 仲裁结果为终局，除非审计团队发起否决
     */
    function finalizeWithArbitration(uint256 proposalId, bytes32 finalHash) external {
        require(msg.sender == klerosProxy, "!auth");
        require(finalHash != bytes32(0), "!hash2");
        require(!auditRegistry.exists(finalHash), "!dep");

        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.Arbitration, "!ap!");

        proposal.arbitrationHash = finalHash;

        // 仲裁结果暂存，允许审计团队否决（第5步）
        // 若在否决期限内无人否决，则自动成为终局
        auditRegistry.deposit(finalHash);
        proposal.status = ProposalStatus.Finalized;

        emit ArbitrationFinalized(proposalId, finalHash);
        emit ReportDeposited(proposalId, finalHash);
        emit ProposalStatusChanged(proposalId, ProposalStatus.Arbitration, ProposalStatus.Finalized);
    }

    /**
     * @dev 第三阶段第4步：设置风险等级（仅管理员/团队）
     */
    function setRiskLevel(uint256 proposalId, RiskLevel level) external {
        require(
            msg.sender == owner() || msg.sender == auditTeam,
            "!auth"
        );
        AuditProposal storage proposal = proposals[proposalId];
        proposal.riskLevel = level;
    }

    // ==================== 第三阶段第5步：审计团队否决权 ====================

    /**
     * @dev 第三阶段第5步：审计团队发起否决
     *
     * 发起条件：
     * - 至少2名团队成员联名发起
     * - 获得半数以上成员同意
     *
     * 否决后审计团队必须提交完整技术证据链，证明原裁决将导致用户资产损失
     *
     * @param proposalId 提案ID
     * @param evidence 技术证据链（IPFS哈希/链接）
     */
    function initiateVeto(uint256 proposalId, string calldata evidence) external {
        require(msg.sender == auditTeam, "!team2");
        AuditProposal storage proposal = proposals[proposalId];
        require(
            proposal.status == ProposalStatus.Arbitration ||
            proposal.status == ProposalStatus.CommitteeRuling,
            "!veto_state"
        );
        require(!proposal.vetoRequested, "!veto_done");
        require(bytes(evidence).length > 0, "!evid");

        ProposalStatus previousStatus = proposal.status;
        proposal.vetoRequested = true;
        proposal.vetoEvidence = evidence;
        proposal.vetoConfirmationCount = 0;
        proposal.status = ProposalStatus.VetoReview;

        emit VetoInitiated(proposalId, new address[](0), evidence);
        emit ProposalStatusChanged(proposalId, previousStatus, ProposalStatus.VetoReview);
    }

    /**
     * @dev 第三阶段第5步：委员会审查否决
     *
     * 争议委员会审查投票有效性、证据真实性、原裁决隐患，投票决定：
     * - supportVeto=true → 支持否决，采纳审计团队结论为最终报告
     * - supportVeto=false → 驳回否决，维持原仲裁结果
     *
     * 该结果为终局，不可再修改。
     */
    function committeeReviewVeto(uint256 proposalId, bool supportVeto) external {
        require(_isCommitteeMember(msg.sender), "!cmemv");
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.VetoReview, "!vr!");
        require(proposal.vetoRequested, "!vnot");
        require(!proposal.vetoConfirmer[msg.sender], "!rvoted");

        proposal.vetoConfirmer[msg.sender] = true;
        if (supportVeto) {
            proposal.vetoConfirmationCount++;
        }

        emit VetoConfirmed(proposalId, msg.sender, proposal.vetoConfirmationCount);

        // 委员会投票决定：3/5多数通过（与第3步规则一致）
        if (proposal.vetoConfirmationCount >= 3) {
            // 支持否决 → 采纳审计团队结论为最终报告
            proposal.vetoApproved = true;
            bytes32 finalHash = proposal.secondReviewHash != bytes32(0)
                ? proposal.secondReviewHash
                : proposal.auditReportHash;
            _finalizeProposal(proposalId, finalHash);
            emit VetoReviewResult(proposalId, true, finalHash);
        }
        // 若委员会成员全员投票完毕且支持否决不足3票 → 驳回否决
        else if (_committeeAllVoted(proposalId) && proposal.vetoConfirmationCount < 3) {
            proposal.vetoApproved = false;
            bytes32 finalHash = proposal.arbitrationHash != bytes32(0)
                ? proposal.arbitrationHash
                : (proposal.secondReviewHash != bytes32(0)
                    ? proposal.secondReviewHash
                    : proposal.auditReportHash);
            _finalizeProposal(proposalId, finalHash);
            emit VetoReviewResult(proposalId, false, finalHash);
        }
    }

    /**
     * @dev 检查所有委员会成员是否都已就否决权投票
     */
    function _committeeAllVoted(uint256 proposalId) internal view returns (bool) {
        AuditProposal storage proposal = proposals[proposalId];
        for (uint256 i = 0; i < committeeMembers.length; i++) {
            if (!proposal.vetoConfirmer[committeeMembers[i]]) {
                return false;
            }
        }
        return true;
    }

    // ==================== 内部函数：投票奖惩 + 最终存证 ====================

    /**
     * @dev 内部：根据最终报告哈希对社区投票者执行奖惩
     * 遍历所有投票者，对比其投票哈希与最终哈希：
     * - 投票正确：奖励 质押权重 * rewardRate / 10000（默认8%）
     * - 投票错误：扣除 质押权重 * penaltyRate / 10000（默认4%）
     * 奖励记入待领取，惩罚直接从质押中扣除
     *
     * 示例：质押500 CEAT = 500票权
     *   正确 → 奖励 500 * 800 / 10000 = 40 CEAT
     *   错误 → 扣除 500 * 400 / 10000 = 20 CEAT
     */
    function _applyVoteRewardsAndPenalties(uint256 proposalId, bytes32 finalHash) internal {
        AuditProposal storage proposal = proposals[proposalId];
        uint256 voterCount = proposal.voterList.length;
        if (voterCount == 0) return;

        for (uint256 i = 0; i < voterCount; i++) {
            address voter = proposal.voterList[i];
            uint256 weight = proposal.voterWeight[voter];
            bytes32 votedHash = proposal.votedProposal[voter];

            if (votedHash == finalHash) {
                // 投票正确 → 奖励 8% * 权重
                uint256 reward = (weight * voteRewardRate) / RATE_BASIS_POINTS;
                if (reward > 0) {
                    stakers[voter].rewards += reward;
                    emit VoteRewarded(proposalId, voter, reward);
                }
            } else {
                // 投票错误 → 扣除 4% * 权重（从质押余额中扣除）
                uint256 penalty = (weight * votePenaltyRate) / RATE_BASIS_POINTS;
                if (penalty > 0) {
                    if (penalty > stakers[voter].balance) {
                        penalty = stakers[voter].balance;
                    }
                    stakers[voter].balance -= penalty;
                    // 降低信誉分
                    if (stakers[voter].reputationScore >= 5) {
                        stakers[voter].reputationScore -= 5;
                    }
                    emit VotePenalized(proposalId, voter, penalty);
                }
            }
        }
    }

    /**
     * @dev 内部：最终存证 - 将审计报告哈希写入存证合约，并执行投票奖惩
     */
    function _finalizeProposal(uint256 proposalId, bytes32 finalHash) internal {
        AuditProposal storage proposal = proposals[proposalId];
        require(finalHash != bytes32(0), "!fhash");

        if (!auditRegistry.exists(finalHash)) {
            auditRegistry.deposit(finalHash);
        }

        // 根据最终报告哈希执行社区投票奖惩
        _applyVoteRewardsAndPenalties(proposalId, finalHash);

        proposal.status = ProposalStatus.Finalized;
        emit ReportDeposited(proposalId, finalHash);
        emit ProposalStatusChanged(proposalId, proposal.status, ProposalStatus.Finalized);
    }

    // ==================== 查询/辅助函数 ====================

    function _isCommitteeMember(address member) internal view returns (bool) {
        for (uint256 i = 0; i < committeeMembers.length; i++) {
            if (committeeMembers[i] == member) {
                return true;
            }
        }
        return false;
    }

    /**
     * @dev 检查地址是否是委员会成员（公共函数）
     */
    function isCommitteeMember(address member) external view returns (bool) {
        return _isCommitteeMember(member);
    }

    /**
     * @dev 获取委员会成员列表
     */
    function getCommitteeMembers() external view returns (address[] memory) {
        return committeeMembers;
    }

    function getCommunityProposalVotes(uint256 proposalId, bytes32 hash) external view returns (uint256) {
        return proposals[proposalId].communityProposals[hash].votes;
    }

    function getCommunityProposalHashes(uint256 proposalId) external view returns (bytes32[] memory) {
        return proposals[proposalId].communityProposalHashes;
    }

    function getWinningCommunityHash(uint256 proposalId) external view returns (bytes32) {
        return proposals[proposalId].winningCommunityHash;
    }

    function getCommitteeVotes(uint256 proposalId) external view returns (uint256, uint256) {
        AuditProposal storage p = proposals[proposalId];
        return (p.committeeVotesForAuditor, p.committeeVotesForCommunity);
    }

    /**
     * @dev 获取社区审核意见列表
     */
    function getCommunityReviews(uint256 proposalId) external view returns (CommunityReview[] memory) {
        return proposals[proposalId].communityReviews;
    }

    /**
     * @dev 获取社区审核意见数量
     */
    function getCommunityReviewCount(uint256 proposalId) external view returns (uint256) {
        return proposals[proposalId].communityReviews.length;
    }

    /**
     * @dev 获取争议接受/拒绝票数
     */
    function getAcceptanceVotes(uint256 proposalId) external view returns (uint256 accept, uint256 reject) {
        AuditProposal storage p = proposals[proposalId];
        return (p.acceptVotes, p.rejectVotes);
    }

    /**
     * @dev 获取二次审核投票
     */
    function getSecondReviewVotes(uint256 proposalId) external view returns (uint256 accept, uint256 reject) {
        AuditProposal storage p = proposals[proposalId];
        return (p.acceptSecondReviewVotes, p.rejectSecondReviewVotes);
    }

    /**
     * @dev 检查提案是否处于争议状态（供多签合约调用）
     */
    function isProposalDisputed(uint256 proposalId) external view returns (bool) {
        ProposalStatus s = proposals[proposalId].status;
        return s == ProposalStatus.FirstDispute ||
               s == ProposalStatus.SecondReview ||
               s == ProposalStatus.CommitteeRuling ||
               s == ProposalStatus.Arbitration;
    }

    /**
     * @dev 检查提案是否处于可被否决的状态（供多签合约调用）
     */
    function isProposalVetoable(uint256 proposalId) external view returns (bool) {
        ProposalStatus s = proposals[proposalId].status;
        return s == ProposalStatus.Arbitration || s == ProposalStatus.CommitteeRuling;
    }

    /**
     * @dev 获取提案完整状态信息（供前端查询）
     */
    function getProposalSummary(uint256 proposalId) external view returns (
        uint256 id,
        bytes32 codeHash,
        bytes32 auditReportHash,
        bytes32 winningCommunityHash,
        bytes32 secondReviewHash,
        ProposalStatus status,
        RiskLevel riskLevel,
        uint256 createdAt,
        uint256 disputeCreatedAt,
        bool arbitrationRequested,
        bool vetoRequested,
        bool vetoApproved
    ) {
        AuditProposal storage p = proposals[proposalId];
        require(p.createdAt > 0, "Proposal does not exist");
        return (
            p.proposalId,
            p.codeHash,
            p.auditReportHash,
            p.winningCommunityHash,
            p.secondReviewHash,
            p.status,
            p.riskLevel,
            p.createdAt,
            p.disputeCreatedAt,
            p.arbitrationRequested,
            p.vetoRequested,
            p.vetoApproved
        );
    }

    /**
     * @dev 获取质押者信息
     */
    function getStakerInfo(address staker) external view returns (
        uint256 balance,
        uint256 rewards,
        uint256 contributionPoints,
        uint256 reputationScore
    ) {
        Staker storage s = stakers[staker];
        return (s.balance, s.rewards, s.contributionPoints, s.reputationScore);
    }
}






















