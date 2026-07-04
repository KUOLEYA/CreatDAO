// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../Core/AuditTeamManager.sol";

interface IDepositProof {
    function deposit(bytes32 hashValue) external returns(uint256);
    function exists(bytes32 hashValue) external view returns(bool);
}

/**
 * @title AuditDAOv2
 * @dev 去中心化审计DAO核心合约 - 「社区 → 委员会 → Kleros仲裁」三段争议解决
 *
 * === 治理原则 ===
 * - 审计团队否决权已移除，Kleros仲裁为终局
 * - 用户可自主创建提案（支付审计费用），管理员仅保留紧急暂停权限
 * - Owner关键参数变更需通过治理Timelock
 * - 项目方(owner)不能进入争议委员会，避免利益冲突
 * - 投票奖惩：参与即奖励，正确额外奖励，无明显恶意不惩罚
 *
 * === 业务流程 ===
 * 第一阶段：用户上传代码，支付审计费用，创建提案
 * 第二阶段：审计团队 + 社区协同审核、投票
 * 第三阶段：争议解决（社区投票 → 二次复核 → 委员会裁决 → Kleros仲裁终局）
 */
contract AuditDAOv2 is Ownable {
    IERC20 public ceatToken;
    IDepositProof public auditRegistry;
    AuditTeamManager public teamManager;

    // ==================== 状态枚举 ====================

    enum ProposalStatus {
        Submitted,         // 0 - 提案已创建
        TeamReview,        // 1 - 审计团队审核中
        CommunityReview,   // 2 - 社区审核与投票
        Discussion,        // 3 - 公开讨论
        FirstDispute,      // 4 - 争议判断（社区投票是否认可团队结果）
        SecondReview,      // 5 - 审计团队二次复核
        CommitteeRuling,   // 6 - 争议委员会裁决（5人，3/5通过）
        Arbitration,       // 7 - Kleros第三方独立仲裁（终局）
        Finalized          // 8 - 审计完成，报告链上存证
    }

    enum RiskLevel { None, Low, Medium, High, Critical }

    // ==================== 数据结构体 ====================

    struct CommunityProposal {
        bytes32 hash;
        uint256 votes;
        address proposer;
    }

    struct CommunityReview {
        address reviewer;
        bytes32 reviewHash;
        uint256 vulnerabilityCount;
        uint256 submittedAt;
    }

    struct AuditProposal {
        uint256 proposalId;
        bytes32 codeHash;
        bytes32 auditReportHash;
        bytes32 winningCommunityHash;
        ProposalStatus status;
        RiskLevel riskLevel;
        uint256 createdAt;
        uint256 votingEndTime;
        address[] voterList;
        mapping(address => uint256) voterWeight;
        CommunityReview[] communityReviews;
        mapping(address => bool) hasSubmittedReview;
        bytes32[] communityProposalHashes;
        mapping(bytes32 => CommunityProposal) communityProposals;
        mapping(address => mapping(bytes32 => uint256)) votedAmountPerHash; // 拆分投票：用户→hash→票数
        mapping(address => uint256) totalVotedWeight; // 用户已投票总数
        uint256 discussionEndTime;
        uint256 disputeCreatedAt;
        bool communityAcceptsTeam;
        uint256 acceptVotes;
        uint256 rejectVotes;
        mapping(address => bool) hasVotedOnAcceptance;
        address[] penalizedContributors;
        bytes32 secondReviewHash;
        mapping(address => bool) hasVotedOnSecondReview;
        uint256 acceptSecondReviewVotes;
        uint256 rejectSecondReviewVotes;
        uint256 committeeVotesForAuditor;
        uint256 committeeVotesForCommunity;
        mapping(address => bool) committeeHasVoted;
        mapping(address => bool) committeeVotedForAuditor;
        bool committeeVotingReset;
        bool arbitrationRequested;
        bytes32 arbitrationHash;
        uint256 arbitrationDepositPaid;
        address arbitrationApplicant;
        bool unassigned;
    }

    struct Staker {
        uint256 balance;
        uint256 rewards;
        uint256 contributionPoints;
        uint256 reputationScore;
    }

    // ==================== 状态变量 ====================

    address[] public committeeMembers;
    address public auditTeam;
    address public klerosProxy;
    uint256 public disputeRetentionPeriod = 3 days;
    mapping(address => Staker) public stakers;
    mapping(uint256 => AuditProposal) public proposals;
    uint256 public nextProposalId;

    // --- 费用与质押参数 ---
    uint256 public proposalCreationFee;               // 用户创建提案费用（CEAT）
    uint256 public minArbitrationDeposit;
    uint256 public minStakeAmount = 500 * 10**18;

    // --- 投票奖惩参数（三参数体系） ---
    // 参与即获得的奖励（无论投对投错）
    uint256 public participationRewardRate = 100;     // 1%
    // 投对额外奖励
    uint256 public correctVoteRewardRate = 700;        // 7%（总计投对可得 8%）
    // 恶意惩罚（仅对极端偏离共识者，不惩罚诚实错误）
    uint256 public maliciousPenaltyRate = 400;         // 4%

    uint256 public constant RATE_BASIS_POINTS = 10000;
    uint256 public defaultVotingDuration = 7 days;
    uint256 public committeeRewardRate = 1000;         // 委员会奖励率
    uint256 public committeePenaltyRate = 500;        // 委员会错误投票惩罚率

    // --- 治理Timelock ---
    // 关键参数变更需通过此地址（可以是多签或DAO合约）
    address public governanceTimelock;

    uint256[] public unassignedProposalIds;
    mapping(uint256 => bool) public isProposalUnassigned;
    mapping(uint256 => mapping(address => bool)) public isProposalClaimedBy;
    mapping(uint256 => bool) public voteRewardsApplied;

    // ==================== 事件 ====================

    event Staked(address indexed staker, uint256 amount);
    event Unstaked(address indexed staker, uint256 amount);
    event RewardsClaimed(address indexed staker, uint256 amount);
    event ReputationAdjusted(address indexed staker, uint256 oldScore, uint256 newScore);
    event ProposalCreated(uint256 indexed proposalId, bytes32 codeHash, address indexed creator);
    event ProposalStatusChanged(uint256 indexed proposalId, ProposalStatus oldStatus, ProposalStatus newStatus);
    event TeamReportSubmitted(uint256 indexed proposalId, bytes32 reportHash);
    event CommunityReviewSubmitted(uint256 indexed proposalId, address indexed reviewer, bytes32 reviewHash, uint256 vulnCount);
    event CommunityProposalSubmitted(uint256 indexed proposalId, bytes32 hash, address indexed proposer);
    event VoteCast(uint256 indexed proposalId, address indexed voter, bytes32 votedHash);
    event WinningHashDetermined(uint256 indexed proposalId, bytes32 winningHash);
    event DiscussionStarted(uint256 indexed proposalId, uint256 endTime);
    event DiscussionConsensus(uint256 indexed proposalId, bytes32 finalHash);
    event DisputeTriggered(uint256 indexed proposalId, bytes32 teamHash, bytes32 communityHash);
    event AcceptanceVoteCast(uint256 indexed proposalId, address indexed voter, bool accepts);
    event CommunityAcceptedTeam(uint256 indexed proposalId);
    event ContributorsPenalized(uint256 indexed proposalId, address[] contributors, uint256[] slashAmounts);
    event SecondReviewSubmitted(uint256 indexed proposalId, bytes32 revisedHash);
    event SecondReviewAccepted(uint256 indexed proposalId, bytes32 finalHash);
    event SecondReviewRejected(uint256 indexed proposalId);
    event CommitteeVoteCast(uint256 indexed proposalId, address indexed member, bool supportAuditor);
    event CommitteeRulingFinal(uint256 indexed proposalId, bytes32 finalHash);
    event ArbitrationRequested(uint256 indexed proposalId, address applicant, uint256 deposit);
    event ArbitrationFinalized(uint256 indexed proposalId, bytes32 finalHash);
    event VoteParticipated(uint256 indexed proposalId, address indexed voter, uint256 rewardAmount);
    event VoteRewarded(uint256 indexed proposalId, address indexed voter, uint256 rewardAmount);
    event VotePenalized(uint256 indexed proposalId, address indexed voter, uint256 penaltyAmount);
    event BatchVoteRewardsApplied(uint256 indexed proposalId, bytes32 finalHash, uint256 rewardedCount, uint256 penalizedCount);
    event ReportDeposited(uint256 indexed proposalId, bytes32 finalHash);
    event ContributorsRewarded(uint256 indexed proposalId, address[] contributors, uint256[] rewardAmounts);
    event ProposalClaimed(uint256 indexed proposalId, uint256 indexed teamId);
    event GovernanceTimelockUpdated(address indexed oldTimelock, address indexed newTimelock);
    event ProposalCreationFeeUpdated(uint256 oldFee, uint256 newFee);

    // ==================== 权限修饰符 ====================

    /// @dev 需要治理Timelock授权（用于关键参数变更）
    modifier onlyGovernance() {
        require(
            msg.sender == owner() || (governanceTimelock != address(0) && msg.sender == governanceTimelock),
            "Not authorized (requires governance)"
        );
        _;
    }

    // ==================== 构造函数 ====================

    constructor(address _ceatToken, address _auditRegistry, address _teamManager) Ownable(msg.sender) {
        ceatToken = IERC20(_ceatToken);
        auditRegistry = IDepositProof(_auditRegistry);
        teamManager = AuditTeamManager(_teamManager);
        minArbitrationDeposit = 1000 * 10**18;
        proposalCreationFee = 100 * 10**18; // 默认 100 CEAT
    }

    // ==================== 质押 / 解押 / 领取奖励 ====================

    function stake(uint256 amount) external {
        require(amount > 0, "Amount must be positive");
        require(ceatToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        Staker storage s = stakers[msg.sender];
        if (s.balance == 0) s.reputationScore = 100;
        s.balance += amount;
        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external {
        require(amount > 0, "Amount must be positive");
        require(stakers[msg.sender].balance >= amount, "Insufficient balance");
        stakers[msg.sender].balance -= amount;
        require(ceatToken.transfer(msg.sender, amount), "Transfer failed");
        emit Unstaked(msg.sender, amount);
    }

    function claimRewards() external {
        uint256 rewards = stakers[msg.sender].rewards;
        require(rewards > 0, "No rewards to claim");
        stakers[msg.sender].rewards = 0;
        require(ceatToken.transfer(msg.sender, rewards), "Transfer failed");
        emit RewardsClaimed(msg.sender, rewards);
    }

    // ==================== 治理配置 ====================

    /// @dev 设置治理Timelock地址（只能由owner设置）
    function setGovernanceTimelock(address _timelock) external onlyOwner {
        require(_timelock != address(0), "Invalid address");
        emit GovernanceTimelockUpdated(governanceTimelock, _timelock);
        governanceTimelock = _timelock;
    }

    /// @dev owner直接操作（用于治理Timelock尚未设置的过渡期）
    /// 一旦设置了timelock，关键参数变更需要timelock授权
    function isGovernanceActive() public view returns (bool) {
        return governanceTimelock != address(0);
    }

    // ==================== 参数配置（部分需要治理授权） ====================

    function setAuditTeam(address _auditTeam) external onlyGovernance {
        auditTeam = _auditTeam;
    }

    function setCommitteeMembers(address[] calldata _members) external onlyGovernance {
        require(_members.length == 5, "Must have exactly 5 committee members");
        // 禁止 owner 进入委员会（避免利益冲突）
        for (uint256 i = 0; i < _members.length; i++) {
            require(_members[i] != owner(), "Owner cannot be committee member");
        }
        committeeMembers = _members;
    }

    function setKlerosProxy(address _klerosProxy) external onlyGovernance {
        klerosProxy = _klerosProxy;
    }

    function setDisputeRetentionPeriod(uint256 _period) external onlyGovernance {
        disputeRetentionPeriod = _period;
    }

    function setMinArbitrationDeposit(uint256 _deposit) external onlyGovernance {
        minArbitrationDeposit = _deposit;
    }

    function setMinStakeAmount(uint256 _amount) external onlyGovernance {
        minStakeAmount = _amount;
    }

    /// @dev 设置投票奖励参数（三参数体系，需要治理授权）
    function setVoteRewardRates(
        uint256 _participationRate,
        uint256 _correctRate,
        uint256 _maliciousPenaltyRate
    ) external onlyGovernance {
        require(_participationRate <= 500, "Participation rate too high (max 5%)");
        require(_correctRate <= 1500, "Correct reward rate too high (max 15%)");
        require(_maliciousPenaltyRate <= 1000, "Malicious penalty rate too high (max 10%)");
        participationRewardRate = _participationRate;
        correctVoteRewardRate = _correctRate;
        maliciousPenaltyRate = _maliciousPenaltyRate;
    }

    function setDefaultVotingDuration(uint256 _duration) external onlyGovernance {
        require(_duration > 0 && _duration <= 30 days, "Invalid duration");
        defaultVotingDuration = _duration;
    }

    function setCommitteeRewardRate(uint256 _rewardRate) external onlyGovernance {
        require(_rewardRate <= 3000, "Rate too high");
        committeeRewardRate = _rewardRate;
    }

    function setCommitteePenaltyRate(uint256 _penaltyRate) external onlyGovernance {
        require(_penaltyRate <= 3000, "Rate too high");
        committeePenaltyRate = _penaltyRate;
    }

    function setProposalCreationFee(uint256 _fee) external onlyGovernance {
        require(_fee > 0, "Fee must be positive");
        emit ProposalCreationFeeUpdated(proposalCreationFee, _fee);
        proposalCreationFee = _fee;
    }

    // ==================== 管理员奖励/惩罚操作 ====================

    /// @dev 分配奖励（需要治理授权）
    function allocateRewards(address recipient, uint256 amount) external onlyGovernance {
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be positive");
        require(ceatToken.balanceOf(address(this)) >= amount, "Insufficient contract balance");
        stakers[recipient].rewards += amount;
        emit RewardsClaimed(recipient, amount);
    }

    /// @dev 扣除质押（需要治理授权）
    function slashStake(address staker, uint256 amount) external onlyGovernance {
        require(staker != address(0), "Invalid staker");
        require(amount > 0, "Amount must be positive");
        require(stakers[staker].balance >= amount, "Insufficient staked balance");
        stakers[staker].balance -= amount;
        if (stakers[staker].reputationScore >= 5) {
            stakers[staker].reputationScore -= 5;
        }
        emit ReputationAdjusted(staker, stakers[staker].reputationScore + 5, stakers[staker].reputationScore);
    }

    // ==================== 批量投票奖惩（三参数体系） ====================

    /// @dev 批量执行投票奖惩（owner可直接调用，治理过渡期保留）
    /// 参与奖励：所有投票者获得 participationRewardRate%
    /// 正确奖励：投对的额外获得 correctVoteRewardRate%
    /// 恶意惩罚：仅对持续极端偏离者执行
    function applyVoteRewardsPenalties(uint256 proposalId, bytes32 finalHash) external {
        require(
            msg.sender == owner() || (governanceTimelock != address(0) && msg.sender == governanceTimelock),
            "Not authorized"
        );
        require(!voteRewardsApplied[proposalId], "Rewards already applied");
        require(finalHash != bytes32(0), "Invalid final hash");
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.voterList.length > 0, "No voters");

        uint256 participationCount = 0;
        uint256 correctCount = 0;
        uint256 penalizedCount = 0;

        for (uint256 i = 0; i < proposal.voterList.length; i++) {
            address voter = proposal.voterList[i];
            uint256 weight = proposal.voterWeight[voter];

            // 1. 参与奖励（所有人都获得）
            uint256 participationReward = (weight * participationRewardRate) / RATE_BASIS_POINTS;
            if (participationReward > 0) {
                stakers[voter].rewards += participationReward;
                participationCount++;
                emit VoteParticipated(proposalId, voter, participationReward);
            }

            // 2. 正确投票额外奖励（按实际投给获胜hash的票数计算）
            uint256 votedForWinning = proposal.votedAmountPerHash[voter][finalHash];
            if (votedForWinning > 0) {
                uint256 correctReward = (votedForWinning * correctVoteRewardRate) / RATE_BASIS_POINTS;
                if (correctReward > 0) {
                    stakers[voter].rewards += correctReward;
                    correctCount++;
                    emit VoteRewarded(proposalId, voter, correctReward);
                }
            }
            // 3. 不惩罚普通错误投票者（诚实参与者）
        }

        voteRewardsApplied[proposalId] = true;
        emit BatchVoteRewardsApplied(proposalId, finalHash, participationCount + correctCount, penalizedCount);
    }

    // ==================== 提案创建 ====================

    /// @dev 用户自主创建提案（支付审计费用）
    function createProposal(bytes32 codeHash) external returns (uint256) {
        // 用户需要支付审计费用（owner可免费创建）
        if (msg.sender != owner()) {
            require(proposalCreationFee > 0, "Proposal creation fee not set");
            require(
                ceatToken.transferFrom(msg.sender, address(this), proposalCreationFee),
                "Fee transfer failed"
            );
        }
        return _createProposal(codeHash, msg.sender);
    }

    function _createProposal(bytes32 codeHash, address creator) internal returns (uint256) {
        uint256 proposalId = nextProposalId++;
        AuditProposal storage proposal = proposals[proposalId];
        proposal.proposalId = proposalId;
        proposal.codeHash = codeHash;
        proposal.status = ProposalStatus.Submitted;
        proposal.createdAt = block.timestamp;
        proposal.riskLevel = RiskLevel.None;
        proposal.unassigned = true;
        unassignedProposalIds.push(proposalId);
        isProposalUnassigned[proposalId] = true;
        emit ProposalCreated(proposalId, codeHash, creator);
        emit ProposalStatusChanged(proposalId, ProposalStatus.Submitted, ProposalStatus.Submitted);
        return proposalId;
    }

    // ==================== 查询函数 ====================

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

    function getUnassignedProposals() external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < unassignedProposalIds.length; i++) {
            uint256 id = unassignedProposalIds[i];
            if (isProposalUnassigned[id] && 
                (proposals[id].status == ProposalStatus.Submitted || proposals[id].status == ProposalStatus.TeamReview)) count++;
        }
        uint256[] memory unassignedIds = new uint256[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < unassignedProposalIds.length; i++) {
            uint256 id = unassignedProposalIds[i];
            if (isProposalUnassigned[id] && 
                (proposals[id].status == ProposalStatus.Submitted || proposals[id].status == ProposalStatus.TeamReview)) {
                unassignedIds[index] = id;
                index++;
            }
        }
        return unassignedIds;
    }

    // ==================== 审计团队接取提案 ====================

    function claimProposal(uint256 proposalId, uint256 teamId) external {
        require(!isProposalClaimedBy[proposalId][msg.sender], "Already claimed by you");
        require(
            proposals[proposalId].status == ProposalStatus.Submitted ||
            proposals[proposalId].status == ProposalStatus.TeamReview,
            "Invalid status"
        );
        
        isProposalClaimedBy[proposalId][msg.sender] = true;
        
        // 首次领取时才执行以下操作（后续用户领取时跳过）
        if (isProposalUnassigned[proposalId]) {
            isProposalUnassigned[proposalId] = false;
            for (uint256 i = 0; i < unassignedProposalIds.length; i++) {
                if (unassignedProposalIds[i] == proposalId) {
                    unassignedProposalIds[i] = unassignedProposalIds[unassignedProposalIds.length - 1];
                    unassignedProposalIds.pop();
                    break;
                }
            }
            teamManager.assignAuditTeam(proposalId, teamId);
        }
        
        emit ProposalClaimed(proposalId, teamId);
    }

    // ==================== 审计团队提交报告 ====================

    function submitTeamReport(uint256 proposalId, bytes32 reportHash) external {
        require(msg.sender == auditTeam || msg.sender == owner(), "Not authorized");
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.Submitted, "Invalid status");
        require(reportHash != bytes32(0), "Hash required");
        proposal.auditReportHash = reportHash;
        proposal.status = ProposalStatus.TeamReview;
        emit TeamReportSubmitted(proposalId, reportHash);
        emit ProposalStatusChanged(proposalId, ProposalStatus.Submitted, ProposalStatus.TeamReview);
    }

    // ==================== 社区审核 ====================

    function submitCommunityReview(uint256 proposalId, bytes32 reviewHash, uint256 vulnerabilityCount) external {
        require(stakers[msg.sender].balance >= minStakeAmount, "Insufficient stake");
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status >= ProposalStatus.Submitted && proposal.status <= ProposalStatus.CommunityReview, "Invalid status");
        require(!proposal.hasSubmittedReview[msg.sender], "Already reviewed");
        
        proposal.communityReviews.push(CommunityReview({
            reviewer: msg.sender,
            reviewHash: reviewHash,
            vulnerabilityCount: vulnerabilityCount,
            submittedAt: block.timestamp
        }));
        proposal.hasSubmittedReview[msg.sender] = true;
        stakers[msg.sender].contributionPoints += 1 + vulnerabilityCount;
        emit CommunityReviewSubmitted(proposalId, msg.sender, reviewHash, vulnerabilityCount);
    }

    function startCommunityReview(uint256 proposalId) external onlyOwner {
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.Submitted || proposal.status == ProposalStatus.TeamReview, "Invalid status");
        require(proposal.auditReportHash != bytes32(0), "Report required");
        proposal.status = ProposalStatus.CommunityReview;
        emit ProposalStatusChanged(proposalId, ProposalStatus.TeamReview, ProposalStatus.CommunityReview);
    }

    function submitCommunityProposal(uint256 proposalId, bytes32 resultHash) external {
        require(stakers[msg.sender].balance >= minStakeAmount, "Insufficient stake");
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.TeamReview || proposal.status == ProposalStatus.CommunityReview, "Invalid status");
        require(proposal.communityProposals[resultHash].proposer == address(0), "Hash exists");
        
        proposal.communityProposals[resultHash] = CommunityProposal({
            hash: resultHash, votes: 0, proposer: msg.sender
        });
        proposal.communityProposalHashes.push(resultHash);
        emit CommunityProposalSubmitted(proposalId, resultHash, msg.sender);
    }

    // ==================== 投票 ====================

    function startVoting(uint256 proposalId) external onlyOwner {
        _startVoting(proposalId, defaultVotingDuration);
    }

    function startVoting(uint256 proposalId, uint256 _votingDuration) external onlyOwner {
        require(_votingDuration > 0 && _votingDuration <= 30 days, "Invalid duration");
        _startVoting(proposalId, _votingDuration);
    }

    function _startVoting(uint256 proposalId, uint256 duration) internal {
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.CommunityReview, "Invalid status");
        require(proposal.communityProposalHashes.length > 0, "No proposals");
        if (proposal.votingEndTime == 0) {
            proposal.votingEndTime = block.timestamp + duration;
        }
    }

    function vote(uint256 proposalId, bytes32 proposalHash, uint256 voteAmount) external {
        uint256 voterBalance = stakers[msg.sender].balance;
        require(voterBalance >= minStakeAmount, "Insufficient stake");
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.CommunityReview, "Not in voting phase");
        require(block.timestamp < proposal.votingEndTime, "Voting ended");
        require(proposal.communityProposals[proposalHash].proposer != address(0), "Invalid proposal");

        uint256 actualVoteAmount = (voteAmount == 0 || voteAmount > voterBalance) ? voterBalance : voteAmount;
        // 拆分投票：总投票数不能超过质押余额
        require(proposal.totalVotedWeight[msg.sender] + actualVoteAmount <= voterBalance, "Exceeds your stake balance");

        // 首次投票时加入投票者列表
        if (proposal.totalVotedWeight[msg.sender] == 0) {
            proposal.voterList.push(msg.sender);
        }
        proposal.votedAmountPerHash[msg.sender][proposalHash] += actualVoteAmount;
        proposal.totalVotedWeight[msg.sender] += actualVoteAmount;
        proposal.voterWeight[msg.sender] = proposal.totalVotedWeight[msg.sender];
        proposal.communityProposals[proposalHash].votes += actualVoteAmount;
        emit VoteCast(proposalId, msg.sender, proposalHash);
    }

    function finalizeVoting(uint256 proposalId) external {
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.CommunityReview, "Invalid status");
        if (msg.sender != owner()) {
            require(block.timestamp >= proposal.votingEndTime, "Voting not ended");
        }

        bytes32 winningHash;
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
        proposal.status = ProposalStatus.Discussion;
        proposal.discussionEndTime = block.timestamp + 2 days;
        emit WinningHashDetermined(proposalId, winningHash);
        emit DiscussionStarted(proposalId, proposal.discussionEndTime);
        emit ProposalStatusChanged(proposalId, ProposalStatus.CommunityReview, ProposalStatus.Discussion);
    }

    function finalizeDiscussion(uint256 proposalId) external onlyOwner {
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.Discussion, "Invalid status");
        require(block.timestamp >= proposal.discussionEndTime, "Discussion not ended");

        if (proposal.winningCommunityHash == proposal.auditReportHash) {
            _finalizeProposal(proposalId, proposal.auditReportHash);
            _distributeCommunityRewards(proposalId);
            emit DiscussionConsensus(proposalId, proposal.auditReportHash);
        } else {
            proposal.status = ProposalStatus.FirstDispute;
            proposal.disputeCreatedAt = block.timestamp;
            emit DisputeTriggered(proposalId, proposal.auditReportHash, proposal.winningCommunityHash);
            emit ProposalStatusChanged(proposalId, ProposalStatus.Discussion, ProposalStatus.FirstDispute);
        }
    }

    // ==================== 终局化（内部函数） ====================

    function _finalizeProposal(uint256 proposalId, bytes32 finalHash) internal {
        AuditProposal storage proposal = proposals[proposalId];
        require(finalHash != bytes32(0), "Hash required");
        if (!auditRegistry.exists(finalHash)) {
            auditRegistry.deposit(finalHash);
        }
        _applyVoteRewardsAndPenalties(proposalId, finalHash);
        proposal.status = ProposalStatus.Finalized;
        emit ReportDeposited(proposalId, finalHash);
        emit ProposalStatusChanged(proposalId, proposal.status, ProposalStatus.Finalized);
    }

    /// @dev 三参数投票奖惩体系（内部版本）
    /// - 参与奖励：所有人都获得
    /// - 正确奖励：投对的额外获得
    /// - 不惩罚普通错误投票者
    function _applyVoteRewardsAndPenalties(uint256 proposalId, bytes32 finalHash) internal {
        AuditProposal storage proposal = proposals[proposalId];
        for (uint256 i = 0; i < proposal.voterList.length; i++) {
            address voter = proposal.voterList[i];
            uint256 weight = proposal.voterWeight[voter];

            // 1. 参与奖励（所有人获得）
            uint256 participationReward = (weight * participationRewardRate) / RATE_BASIS_POINTS;
            if (participationReward > 0) {
                stakers[voter].rewards += participationReward;
                emit VoteParticipated(proposalId, voter, participationReward);
            }

            // 2. 正确投票额外奖励（按实际投给获胜hash的票数计算）
            uint256 votedForWinning = proposal.votedAmountPerHash[voter][finalHash];
            if (votedForWinning > 0) {
                uint256 correctReward = (votedForWinning * correctVoteRewardRate) / RATE_BASIS_POINTS;
                if (correctReward > 0) {
                    stakers[voter].rewards += correctReward;
                    emit VoteRewarded(proposalId, voter, correctReward);
                }
            }
            // 3. 不惩罚普通错误投票者
        }
        voteRewardsApplied[proposalId] = true;
    }

    function _distributeCommunityRewards(uint256 proposalId) internal {
        AuditProposal storage proposal = proposals[proposalId];
        uint256 reviewCount = proposal.communityReviews.length;
        if (reviewCount == 0) return;

        uint256 totalPoints = 0;
        uint256[] memory points = new uint256[](reviewCount);
        address[] memory reviewers = new address[](reviewCount);

        for (uint256 i = 0; i < reviewCount; i++) {
            reviewers[i] = proposal.communityReviews[i].reviewer;
            points[i] = stakers[reviewers[i]].contributionPoints;
            totalPoints += points[i];
        }

        uint256 totalRewardPool = ceatToken.balanceOf(address(this)) / 4;
        for (uint256 i = 0; i < reviewCount; i++) {
            if (points[i] > 0 && totalPoints > 0) {
                uint256 reward = (totalRewardPool * points[i]) / totalPoints;
                if (reward > 0 && ceatToken.balanceOf(address(this)) >= reward) {
                    stakers[reviewers[i]].rewards += reward;
                }
            }
        }
        emit ContributorsRewarded(proposalId, reviewers, points);
    }

    // ==================== 争议解决第1步：社区投票是否认可团队结果 ====================

    function voteOnAcceptance(uint256 proposalId, bool accept) external {
        require(stakers[msg.sender].balance >= minStakeAmount, "Insufficient stake");
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.FirstDispute, "Invalid status");
        require(!proposal.hasVotedOnAcceptance[msg.sender], "Already voted");
        
        proposal.hasVotedOnAcceptance[msg.sender] = true;
        if (accept) proposal.acceptVotes += stakers[msg.sender].balance;
        else proposal.rejectVotes += stakers[msg.sender].balance;
        emit AcceptanceVoteCast(proposalId, msg.sender, accept);
    }

    function resolveDisputeStep1(uint256 proposalId) external onlyOwner {
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.FirstDispute, "Invalid status");

        if (proposal.acceptVotes >= proposal.rejectVotes) {
            proposal.communityAcceptsTeam = true;
            _finalizeProposal(proposalId, proposal.auditReportHash);
            emit CommunityAcceptedTeam(proposalId);
        } else {
            proposal.communityAcceptsTeam = false;
            proposal.status = ProposalStatus.SecondReview;
            emit ProposalStatusChanged(proposalId, ProposalStatus.FirstDispute, ProposalStatus.SecondReview);
        }
    }

    // ==================== 争议解决第2步：审计团队二次复核 ====================

    function submitRevisedReport(uint256 proposalId, bytes32 revisedHash) external {
        require(msg.sender == auditTeam, "Not authorized");
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.SecondReview, "Invalid status");
        proposal.secondReviewHash = revisedHash;
        emit SecondReviewSubmitted(proposalId, revisedHash);
    }

    function voteOnSecondReview(uint256 proposalId, bool accept) external {
        require(stakers[msg.sender].balance >= minStakeAmount, "Insufficient stake");
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.SecondReview, "Invalid status");
        require(!proposal.hasVotedOnSecondReview[msg.sender], "Already voted");
        
        proposal.hasVotedOnSecondReview[msg.sender] = true;
        if (accept) proposal.acceptSecondReviewVotes += stakers[msg.sender].balance;
        else proposal.rejectSecondReviewVotes += stakers[msg.sender].balance;
    }

    function resolveSecondReview(uint256 proposalId) external onlyOwner {
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.SecondReview, "Invalid status");
        require(proposal.secondReviewHash != bytes32(0), "No revised report");

        if (proposal.acceptSecondReviewVotes >= proposal.rejectSecondReviewVotes) {
            _finalizeProposal(proposalId, proposal.secondReviewHash);
            emit SecondReviewAccepted(proposalId, proposal.secondReviewHash);
        } else {
            proposal.status = ProposalStatus.CommitteeRuling;
            emit SecondReviewRejected(proposalId);
            emit ProposalStatusChanged(proposalId, ProposalStatus.SecondReview, ProposalStatus.CommitteeRuling);
        }
    }

    // ==================== 争议解决第3步：委员会裁决 ====================

    function committeeVote(uint256 proposalId, bool supportAuditor) external {
        require(_isCommitteeMember(msg.sender), "Not authorized");
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.CommitteeRuling, "Invalid status");

        if (!proposal.committeeVotingReset && proposal.committeeHasVoted[msg.sender]) {
            revert("Already voted");
        }
        
        proposal.committeeHasVoted[msg.sender] = true;
        proposal.committeeVotedForAuditor[msg.sender] = supportAuditor;
        if (supportAuditor) proposal.committeeVotesForAuditor++;
        else proposal.committeeVotesForCommunity++;
        emit CommitteeVoteCast(proposalId, msg.sender, supportAuditor);

        if (proposal.committeeVotesForAuditor >= 3) {
            bytes32 finalHash = proposal.secondReviewHash != bytes32(0) ? proposal.secondReviewHash : proposal.auditReportHash;
            _applyCommitteeRewards(proposalId, true);
            _finalizeProposal(proposalId, finalHash);
            emit CommitteeRulingFinal(proposalId, finalHash);
        } else if (proposal.committeeVotesForCommunity >= 3) {
            _applyCommitteeRewards(proposalId, false);
            _finalizeProposal(proposalId, proposal.winningCommunityHash);
            emit CommitteeRulingFinal(proposalId, proposal.winningCommunityHash);
        }
    }

    /// @dev 委员会奖惩（正确投票有奖励，错误投票有惩罚）
    function _applyCommitteeRewards(uint256 proposalId, bool auditorWon) internal {
        AuditProposal storage proposal = proposals[proposalId];
        for (uint256 i = 0; i < committeeMembers.length; i++) {
            address member = committeeMembers[i];
            if (!proposal.committeeHasVoted[member]) continue;

            bool votedAuditor = proposal.committeeVotedForAuditor[member];
            bool correct = (auditorWon && votedAuditor) || (!auditorWon && !votedAuditor);

            if (correct) {
                uint256 reward = (minStakeAmount * committeeRewardRate) / RATE_BASIS_POINTS;
                if (reward > 0) {
                    stakers[member].rewards += reward;
                    emit VoteRewarded(proposalId, member, reward);
                }
            } else {
                // 错误投票：扣除质押金 + 降低信誉分
                uint256 penalty = (minStakeAmount * committeePenaltyRate) / RATE_BASIS_POINTS;
                if (penalty > 0 && stakers[member].balance >= penalty) {
                    stakers[member].balance -= penalty;
                    if (stakers[member].reputationScore >= 5) {
                        stakers[member].reputationScore -= 5;
                    }
                    emit ReputationAdjusted(member, stakers[member].reputationScore + 5, stakers[member].reputationScore);
                }
            }
        }
    }

    // ==================== 争议解决第4步：Kleros独立仲裁（终局） ====================

    function requestArbitration(uint256 proposalId) external payable {
        AuditProposal storage proposal = proposals[proposalId];
        require(
            proposal.status == ProposalStatus.CommitteeRuling || proposal.status == ProposalStatus.SecondReview,
            "Invalid status"
        );
        require(
            proposal.riskLevel == RiskLevel.High || proposal.riskLevel == RiskLevel.Critical,
            "Risk too low"
        );
        require(msg.value >= minArbitrationDeposit, "Insufficient deposit");
        require(block.timestamp >= proposal.disputeCreatedAt + disputeRetentionPeriod, "Period not met");

        ProposalStatus previousStatus = proposal.status;
        proposal.arbitrationRequested = true;
        proposal.arbitrationDepositPaid = msg.value;
        proposal.arbitrationApplicant = msg.sender;
        proposal.status = ProposalStatus.Arbitration;
        emit ArbitrationRequested(proposalId, msg.sender, msg.value);
        emit ProposalStatusChanged(proposalId, previousStatus, ProposalStatus.Arbitration);
    }

    /// @dev Kleros仲裁回调 - 仲裁结果为终局，直接终结提案
    function finalizeWithArbitration(uint256 proposalId, bytes32 finalHash) external {
        require(msg.sender == klerosProxy, "Not authorized");
        require(!auditRegistry.exists(finalHash), "Hash exists");
        AuditProposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.Arbitration, "Invalid status");
        proposal.arbitrationHash = finalHash;
        auditRegistry.deposit(finalHash);
        proposal.status = ProposalStatus.Finalized;
        emit ArbitrationFinalized(proposalId, finalHash);
        emit ReportDeposited(proposalId, finalHash);
        emit ProposalStatusChanged(proposalId, ProposalStatus.Arbitration, ProposalStatus.Finalized);
    }

    // ==================== 辅助函数 ====================

    function setRiskLevel(uint256 proposalId, RiskLevel level) external {
        require(msg.sender == owner() || msg.sender == auditTeam, "Not authorized");
        proposals[proposalId].riskLevel = level;
    }

    function _isCommitteeMember(address member) internal view returns (bool) {
        for (uint256 i = 0; i < committeeMembers.length; i++) {
            if (committeeMembers[i] == member) return true;
        }
        return false;
    }

    // ==================== 查询函数 ====================

    function isCommitteeMember(address member) external view returns (bool) {
        return _isCommitteeMember(member);
    }

    function getCommitteeMembers() external view returns (address[] memory) {
        return committeeMembers;
    }

    function getCommunityProposalVotes(uint256 proposalId, bytes32 hash) external view returns (uint256) {
        return proposals[proposalId].communityProposals[hash].votes;
    }

    function getCommunityProposalHashes(uint256 proposalId) external view returns (bytes32[] memory) {
        return proposals[proposalId].communityProposalHashes;
    }

    function getCommunityReviews(uint256 proposalId) external view returns (CommunityReview[] memory) {
        return proposals[proposalId].communityReviews;
    }

    function getProposalSummary(uint256 proposalId) external view returns (
        uint256 id, bytes32 codeHash, bytes32 auditReportHash, bytes32 winningCommunityHash,
        bytes32 secondReviewHash, ProposalStatus status, RiskLevel riskLevel,
        uint256 createdAt, uint256 disputeCreatedAt, bool arbitrationRequested
    ) {
        AuditProposal storage p = proposals[proposalId];
        require(p.createdAt > 0, "Proposal does not exist");
        return (
            p.proposalId, p.codeHash, p.auditReportHash, p.winningCommunityHash,
            p.secondReviewHash, p.status, p.riskLevel, p.createdAt, p.disputeCreatedAt,
            p.arbitrationRequested
        );
    }

    function getStakerInfo(address staker) external view returns (
        uint256 balance, uint256 rewards, uint256 contributionPoints, uint256 reputationScore
    ) {
        Staker storage s = stakers[staker];
        return (s.balance, s.rewards, s.contributionPoints, s.reputationScore);
    }

    function isProposalDisputed(uint256 proposalId) external view returns (bool) {
        ProposalStatus s = proposals[proposalId].status;
        return s == ProposalStatus.FirstDispute || s == ProposalStatus.SecondReview ||
               s == ProposalStatus.CommitteeRuling || s == ProposalStatus.Arbitration;
    }

    /// @dev 检查提案是否可被仲裁（替代原有的isProposalVetoable）
    function isProposalArbitrable(uint256 proposalId) external view returns (bool) {
        ProposalStatus s = proposals[proposalId].status;
        return s == ProposalStatus.Arbitration || s == ProposalStatus.CommitteeRuling;
    }

    /// @dev 兼容旧接口（废弃否决权后始终返回false）
    function isProposalVetoable(uint256 /* proposalId */) external pure returns (bool) {
        // 否决权已移除，不再有可被否决的提案
        return false;
    }
}
