const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AuditDAOv2 - V1 全功能测试", function () {
  let AuditDAOv2, dao, CeatToken, ceat, DepositProof, proof, AuditTeamManager, teamMgr;
  let owner, auditTeam, committee1, committee2, committee3, committee4, committee5;
  let user1, user2, user3, user4, member1, member2, member3;

  const MIN_STAKE = ethers.parseEther("500");
  const STAKE_AMOUNT = ethers.parseEther("1000");
  const INITIAL_SUPPLY = ethers.parseEther("1000000");

  before(async function () {
    const signers = await ethers.getSigners();
    owner = signers[0];
    auditTeam = signers[1];
    committee1 = signers[2];
    committee2 = signers[3];
    committee3 = signers[4];
    committee4 = signers[5];
    committee5 = signers[6];
    user1 = signers[7];
    user2 = signers[8];
    user3 = signers[9];
    user4 = signers[10];
    member1 = signers[11];
    member2 = signers[12];
    member3 = signers[13];

    // 1. 部署 CEAT 代币
    const CeatTokenFactory = await ethers.getContractFactory("Ceattoken");
    ceat = await CeatTokenFactory.deploy(INITIAL_SUPPLY);
    await ceat.waitForDeployment();

    // 2. 部署存证合约
    const DepositProofFactory = await ethers.getContractFactory("DepositProof");
    proof = await DepositProofFactory.deploy();
    await proof.waitForDeployment();

    // 3. 部署审计团队管理合约
    const TeamManagerFactory = await ethers.getContractFactory("AuditTeamManager");
    teamMgr = await TeamManagerFactory.deploy();
    await teamMgr.waitForDeployment();

    // 4. 部署 AuditDAOv2
    const AuditDAOv2Factory = await ethers.getContractFactory("AuditDAOv2");
    dao = await AuditDAOv2Factory.deploy(ceat.target, proof.target, teamMgr.target);
    await dao.waitForDeployment();

    // 5. 设置关联
    await proof.setAuditDAO(dao.target);
    await teamMgr.connect(owner).setDaoContract(dao.target);

    // 6. 给用户分配代币用于测试
    const users = [user1, user2, user3, user4, member1, member2, member3];
    for (const u of users) {
      await ceat.transfer(u.address, ethers.parseEther("10000"));
    }
  });

  // ==================== 测试 1: 质押功能 (Staking) ====================
  describe("1. 质押功能 (Staking & Rewards)", function () {
    it("应该允许用户质押 CEAT", async function () {
      await ceat.connect(user1).approve(dao.target, STAKE_AMOUNT);
      await dao.connect(user1).stake(STAKE_AMOUNT);
      const staker = await dao.stakers(user1.address);
      expect(staker.balance).to.equal(STAKE_AMOUNT);
      expect(staker.reputationScore).to.equal(100n);
    });

    it("应该允许用户提取质押", async function () {
      const amount = ethers.parseEther("100");
      const before = (await dao.stakers(user1.address)).balance;
      await dao.connect(user1).unstake(amount);
      const after = (await dao.stakers(user1.address)).balance;
      expect(after).to.equal(before - amount);
    });

    it("应该拒绝提取超过余额的质押", async function () {
      await expect(
        dao.connect(user1).unstake(ethers.parseEther("100000"))
      ).to.be.revertedWith("Insufficient balance");
    });

    it("质押者初始信誉分应为100", async function () {
      await ceat.connect(user2).approve(dao.target, STAKE_AMOUNT);
      await dao.connect(user2).stake(STAKE_AMOUNT);
      const staker = await dao.stakers(user2.address);
      expect(staker.reputationScore).to.equal(100n);
    });
  });

  // ==================== 测试 2: 提案创建与查询 ====================
  describe("2. 提案创建与查询功能", function () {
    it("应该创建提案并自动标记为未分配", async function () {
      const codeHash = ethers.keccak256(ethers.toUtf8Bytes("code_v1"));
      await dao.connect(owner).createProposal(codeHash);
      const proposal = await dao.proposals(0);
      expect(proposal.status).to.equal(0n); // Submitted
      expect(proposal.codeHash).to.equal(codeHash);
      expect(await dao.isProposalUnassigned(0)).to.equal(true);
    });

    it("getUnpublishedProposals 应返回未发布的提案", async function () {
      await dao.connect(owner).createProposal(
        ethers.keccak256(ethers.toUtf8Bytes("code_v2"))
      );
      const unpublished = await dao.getUnpublishedProposals();
      expect(unpublished.length).to.equal(2);
    });

    it("getUnassignedProposals 应返回未分配的提案", async function () {
      const unassigned = await dao.getUnassignedProposals();
      expect(unassigned.length).to.equal(2);
      expect(unassigned[0]).to.equal(0n);
      expect(unassigned[1]).to.equal(1n);
    });

    it("仅管理员可创建提案", async function () {
      await expect(
        dao.connect(user1).createProposal(
          ethers.keccak256(ethers.toUtf8Bytes("code_v3"))
        )
      ).to.be.reverted;
    });
  });

  // ==================== 测试 3: 审计团队管理 ====================
  describe("3. 审计团队管理功能", function () {
    it("应该注册审计团队", async function () {
      await teamMgr.connect(owner).registerAuditTeam(
        "Team Alpha",
        auditTeam.address,
        [member1.address, member2.address, member3.address]
      );
      const team = await teamMgr.auditTeams(0);
      expect(team.name).to.equal("Team Alpha");
      expect(team.active).to.equal(true);
      expect(team.reputation).to.equal(50n);
    });

    it("应该添加审计团队成员", async function () {
      const newMember = user4.address;
      await teamMgr.connect(owner).addAuditTeamMember(0, newMember);
      const team = await teamMgr.getAuditTeam(0);
      expect(team.members.length).to.equal(4);
    });

    it("应该删除审计团队成员", async function () {
      await teamMgr.connect(owner).removeAuditTeamMember(0, user4.address);
      const team = await teamMgr.getAuditTeam(0);
      expect(team.members.length).to.equal(3);
    });

    it("团队成员不能少于2人", async function () {
      // 当前3人，先删一个到2人，再删除应该失败
      await teamMgr.connect(owner).removeAuditTeamMember(0, member3.address);
      await expect(
        teamMgr.connect(owner).removeAuditTeamMember(0, member2.address)
      ).to.be.revertedWith("Cannot reduce below 2 members");
    });

    it("getActiveAuditTeams 应返回活跃团队", async function () {
      const active = await teamMgr.getActiveAuditTeams();
      expect(active.length).to.equal(1);
    });

    it("getTeamAccuracy 应返回准确率", async function () {
      const accuracy = await teamMgr.getTeamAccuracy(0);
      expect(accuracy).to.equal(0n); // 还没有审计记录
    });
  });

  // ==================== 测试 4: 审计团队接取提案 ====================
  describe("4. 审计团队接取提案功能", function () {
    it("应该允许审计团队接取提案", async function () {
      await dao.connect(owner).claimProposal(0, 0);
      const claimed = await dao.isProposalClaimed(0);
      expect(claimed).to.equal(true);
      expect(await dao.isProposalUnassigned(0)).to.equal(false);
    });

    it("提案被接取后 getUnassignedProposals 不应包含它", async function () {
      const unassigned = await dao.getUnassignedProposals();
      expect(unassigned.length).to.equal(1);
      expect(unassigned[0]).to.equal(1n);
    });

    it("getTeamClaimedProposals 应返回团队已接取的提案", async function () {
      const claimed = await teamMgr.getTeamClaimedProposals(0);
      expect(claimed.length).to.equal(1);
      expect(claimed[0]).to.equal(0n);
    });

    it("不能重复接取同一个提案", async function () {
      await expect(
        dao.connect(owner).claimProposal(0, 0)
      ).to.be.revertedWith("Already claimed");
    });
  });

  // ==================== 测试 5: 审计团队报告与社区审核 ====================
  describe("5. 审计团队报告与社区审核", function () {
    it("审计团队应提交报告", async function () {
      await dao.setAuditTeam(auditTeam.address);
      const reportHash = ethers.keccak256(ethers.toUtf8Bytes("team_report_v1"));
      await dao.connect(owner).submitTeamReport(0, reportHash);
      const proposal = await dao.proposals(0);
      expect(proposal.auditReportHash).to.equal(reportHash);
      expect(proposal.status).to.equal(1n); // TeamReview
    });

    it("社区成员应提交审核意见", async function () {
      const reviewHash = ethers.keccak256(ethers.toUtf8Bytes("review_v1"));
      await dao.connect(user1).submitCommunityReview(0, reviewHash, 5);
      const reviews = await dao.getCommunityReviews(0);
      expect(reviews.length).to.equal(1);
    });

    it("质押不足应拒绝提交审核意见", async function () {
      // user3 还没质押
      const reviewHash = ethers.keccak256(ethers.toUtf8Bytes("review_user3"));
      await expect(
        dao.connect(user3).submitCommunityReview(0, reviewHash, 3)
      ).to.be.reverted;
    });
  });

  // ==================== 测试 6: 社区投票与奖惩 ====================
  describe("6. 社区投票与奖惩机制", function () {
    before(async function () {
      await dao.connect(owner).startCommunityReview(0);
    });

    it("质押者应提交社区方案", async function () {
      const resultHash = ethers.keccak256(ethers.toUtf8Bytes("community_result_v1"));
      await dao.connect(user1).submitCommunityProposal(0, resultHash);
      const hashes = await dao.getCommunityProposalHashes(0);
      expect(hashes.length).to.equal(1);
    });

    it("质押者应进行投票", async function () {
      const resultHash = ethers.keccak256(ethers.toUtf8Bytes("community_result_v1"));
      await dao.connect(owner).startVoting(0);
      await dao.connect(user1).vote(0, resultHash, 0); // 0 = 使用全部质押量
    });

    it("应该能结束投票并确定胜出方案", async function () {
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine");
      await dao.connect(owner).finalizeVoting(0);
      const proposal = await dao.proposals(0);
      expect(proposal.status).to.equal(3n); // Discussion
    });
  });

  // ==================== 测试 7: 讨论与争议触发 ====================
  describe("7. 讨论与争议触发", function () {
    it("讨论结束应进入争议阶段（方案不一致时）", async function () {
      await ethers.provider.send("evm_increaseTime", [2 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine");
      await dao.connect(owner).finalizeDiscussion(0);
      const proposal = await dao.proposals(0);
      expect(proposal.status).to.equal(4n); // FirstDispute
    });
  });

  // ==================== 测试 8: 争议解决第1步 ====================
  describe("8. 争议解决 - 接受/拒绝投票", function () {
    it("质押者应对团队结果进行接受/拒绝投票", async function () {
      await ceat.connect(user3).approve(dao.target, STAKE_AMOUNT);
      await dao.connect(user3).stake(STAKE_AMOUNT);
      await dao.connect(user1).voteOnAcceptance(0, false); // 不接受
      await dao.connect(user3).voteOnAcceptance(0, false);
    });

    it("管理员应结束争议第1步进入二次审核", async function () {
      await dao.connect(owner).resolveDisputeStep1(0);
      const proposal = await dao.proposals(0);
      expect(proposal.status).to.equal(5n); // SecondReview
    });
  });

  // ==================== 测试 9: 二次审核 ====================
  describe("9. 二次审核", function () {
    it("审计团队应提交修订报告", async function () {
      const revisedHash = ethers.keccak256(ethers.toUtf8Bytes("revised_report_v1"));
      await dao.connect(auditTeam).submitRevisedReport(0, revisedHash);
      const proposal = await dao.proposals(0);
      expect(proposal.secondReviewHash).to.equal(revisedHash);
    });

    it("拒绝则进入争议委员会", async function () {
      await dao.connect(user1).voteOnSecondReview(0, false);
      await dao.connect(user3).voteOnSecondReview(0, false);
      await dao.connect(owner).resolveSecondReview(0);
      const proposal = await dao.proposals(0);
      expect(proposal.status).to.equal(6n); // CommitteeRuling
    });
  });

  // ==================== 测试 10: 争议委员会 ====================
  describe("10. 争议委员会功能", function () {
    it("应该设置委员会成员", async function () {
      await dao.connect(owner).setCommitteeMembers([
        committee1.address,
        committee2.address,
        committee3.address,
        committee4.address,
        committee5.address,
      ]);
      const members = await dao.getCommitteeMembers();
      expect(members.length).to.equal(5);
    });

    it("委员会成员应投票（支持社区方）", async function () {
      await dao.connect(committee1).committeeVote(0, false); // 支持社区
      await dao.connect(committee2).committeeVote(0, false);
      await dao.connect(committee3).committeeVote(0, false); // 3票 → 社区胜
      const proposal = await dao.proposals(0);
      expect(proposal.status).to.equal(8n); // Finalized
    });
  });

  // ==================== 测试 11: 提案2 - 完整流程（含仲裁） ====================
  describe("11. 提案2 - 仲裁流程", function () {
    before(async function () {
      // 创建提案2并走基本流程到社区投票
      await dao.connect(owner).createProposal(
        ethers.keccak256(ethers.toUtf8Bytes("code_v2_arb"))
      );
      // 提案id=2 (之前创建了0和1)
      const reportHash = ethers.keccak256(ethers.toUtf8Bytes("team_report_v2"));
      const resultHash = ethers.keccak256(ethers.toUtf8Bytes("community_result_v2"));

      await dao.connect(owner).submitTeamReport(2, reportHash);
      await dao.connect(owner).startCommunityReview(2);
      await dao.connect(user1).submitCommunityProposal(2, resultHash);
      await dao.connect(owner).startVoting(2);
      await dao.connect(user1).vote(2, resultHash, 0);

      await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine");
      await dao.connect(owner).finalizeVoting(2);

      await ethers.provider.send("evm_increaseTime", [2 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine");
      await dao.connect(owner).finalizeDiscussion(2); // 进入 FirstDispute

      // 社区不接受 → SecondReview
      await dao.connect(user1).voteOnAcceptance(2, false);
      await dao.connect(user3).voteOnAcceptance(2, false);
      await dao.connect(owner).resolveDisputeStep1(2);

      // 二次审核 → CommitteeRuling
      await dao.connect(auditTeam).submitRevisedReport(2, resultHash);
      await dao.connect(user1).voteOnSecondReview(2, false);
      await dao.connect(user3).voteOnSecondReview(2, false);
      await dao.connect(owner).resolveSecondReview(2);
    });

    it("应设置高危风险等级并申请仲裁", async function () {
      await dao.connect(owner).setRiskLevel(2, 3); // RiskLevel.High = 3
      const proposal = await dao.proposals(2);
      expect(proposal.riskLevel).to.equal(3n);

      await ethers.provider.send("evm_increaseTime", [3 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine");

      const deposit = ethers.parseEther("1000");
      await dao.connect(user1).requestArbitration(2, { value: deposit });
      const proposal2 = await dao.proposals(2);
      expect(proposal2.status).to.equal(7n); // Arbitration
      expect(proposal2.arbitrationRequested).to.equal(true);
    });
  });

  // ==================== 测试 12: 委员会裁决功能 ====================
  describe("12. 委员会裁决功能", function () {
    before(async function () {
      // 用提案1（id=1）来做否决测试
      // 提案1目前是Submitted状态，需要走完前面的流程到CommitteeRuling
      await dao.setAuditTeam(auditTeam.address);
      const reportHash = ethers.keccak256(ethers.toUtf8Bytes("team_report_veto"));
      await dao.connect(owner).submitTeamReport(1, reportHash);

      await dao.connect(owner).startCommunityReview(1);
      const resultHash = ethers.keccak256(ethers.toUtf8Bytes("community_veto"));
      await dao.connect(user1).submitCommunityProposal(1, resultHash);
      await dao.connect(owner).startVoting(1);
      await dao.connect(user1).vote(1, resultHash, 0);

      await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine");
      await dao.connect(owner).finalizeVoting(1);

      await ethers.provider.send("evm_increaseTime", [2 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine");
      await dao.connect(owner).finalizeDiscussion(1);

      await dao.connect(user1).voteOnAcceptance(1, false);
      await dao.connect(user3).voteOnAcceptance(1, false);
      await dao.connect(owner).resolveDisputeStep1(1);

      await dao.connect(auditTeam).submitRevisedReport(1, reportHash);
      // 接受修订报告
      await dao.connect(user1).voteOnSecondReview(1, true);
      await dao.connect(user3).voteOnSecondReview(1, true);
      await dao.connect(owner).resolveSecondReview(1);
      // 现在 status = Finalized（因为接受了）
    });

    it("拒绝修订报告后应进入委员会裁决阶段", async function () {
      // 需要在CommitteeRuling状态才能否决，重新创建提案3演示
      await dao.connect(owner).createProposal(
        ethers.keccak256(ethers.toUtf8Bytes("code_veto2"))
      );
      const idx = 3;
      const rptHash = ethers.keccak256(ethers.toUtf8Bytes("team_rpt_veto2"));
      await dao.connect(owner).submitTeamReport(idx, rptHash);
      await dao.connect(owner).startCommunityReview(idx);
      const resHash = ethers.keccak256(ethers.toUtf8Bytes("comm_veto2"));
      await dao.connect(user1).submitCommunityProposal(idx, resHash);
      await dao.connect(owner).startVoting(idx);
      await dao.connect(user1).vote(idx, resHash, 0);
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine");
      await dao.connect(owner).finalizeVoting(idx);
      await ethers.provider.send("evm_increaseTime", [2 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine");
      await dao.connect(owner).finalizeDiscussion(idx);
      await dao.connect(user1).voteOnAcceptance(idx, false);
      await dao.connect(user3).voteOnAcceptance(idx, false);
      await dao.connect(owner).resolveDisputeStep1(idx);
      await dao.connect(auditTeam).submitRevisedReport(idx, rptHash);
      await dao.connect(user1).voteOnSecondReview(idx, false);
      await dao.connect(user3).voteOnSecondReview(idx, false);
      await dao.connect(owner).resolveSecondReview(idx);
      // 现在 idx=3 在 CommitteeRuling 状态
    });

    it("应能通过委员会投票终结提案", async function () {
      const idx = 3;
      await dao.connect(committee1).committeeVote(idx, false); // 支持社区
      await dao.connect(committee2).committeeVote(idx, false);
      await dao.connect(committee3).committeeVote(idx, false); // 3票 → 社区胜
      const proposal = await dao.proposals(idx);
      expect(proposal.status).to.equal(8n); // Finalized
    });
  });

  // ==================== 测试 13: 查询接口 ====================
  describe("13. 查询接口功能", function () {
    it("getProposalSummary 应返回提案摘要", async function () {
      const summary = await dao.getProposalSummary(0);
      expect(summary[0]).to.equal(0n);
    });

    it("getStakerInfo 应返回质押者信息", async function () {
      const info = await dao.getStakerInfo(user1.address);
      expect(info[0]).to.be.gt(0n); // balance > 0
    });

    it("isProposalDisputed 应正确判断争议状态", async function () {
      expect(await dao.isProposalDisputed(0)).to.equal(false); // finalized
    });

    it("isProposalVetoable 应正确判断可否决状态", async function () {
      expect(await dao.isProposalVetoable(0)).to.equal(false);
    });
  });

  // ==================== 测试 14: 审计团队统计更新 ====================
  describe("14. 审计团队统计功能", function () {
    it("应更新团队统计", async function () {
      await teamMgr.connect(owner).updateTeamStats(0, true);
      const team = await teamMgr.auditTeams(0);
      expect(team.totalAudits).to.equal(1n);
      expect(team.successfulAudits).to.equal(1n);
      expect(team.reputation).to.equal(55n);
    });
  });
});
