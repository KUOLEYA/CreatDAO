// Hardhat 本地节点完整测试：
// AI审计(代码上传→DeepSeek分析→存证) → DAO(创建提案→团队报告→社区审核→方案→投票→结束)
const { ethers } = require("hardhat");

async function main() {
  const [owner, auditTeam, c1, c2, c3, c4, c5, user1, user2, user3] = await ethers.getSigners();
  const committeeMembers = [c1.address, c2.address, c3.address, c4.address, c5.address];
  const communityUsers = [user1, user2, user3];
  
  // ======== 步骤0: AI审计(模拟) ========
  console.log("=== 步骤0: AI审计 ===");
  // 模拟: 项目方提交Solidity代码, DeepSeek分析, 生成报告哈希
  const sampleCode = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract TestToken {
    mapping(address => uint256) public balances;
    address public owner;
    constructor() { owner = msg.sender; }
    function transfer(address to, uint256 amount) external {
        require(balances[msg.sender] >= amount, "insufficient");
        balances[msg.sender] -= amount;
        balances[to] += amount;
    }
    function mint(address to, uint256 amount) external {
        require(msg.sender == owner, "only owner");
        balances[to] += amount;
    }
}`;
  
  // 计算 code_hash (SHA-256 of source)
  const codeHash = ethers.keccak256(ethers.toUtf8Bytes(sampleCode));
  console.log("Code Hash:", codeHash);
  
  // 模拟AI审计报告哈希
  const aiReportContent = JSON.stringify({
    task_info: { audit_id: "AUD-20260702-001", code_hash: codeHash },
    execution_summary: {
      ai_engine: "DeepSeek-V4", coverage: "SWC-101~136",
      timestamp: new Date().toISOString()
    },
    findings: [
      { id: "AI-001", severity: "中危", location: "TestToken.sol→transfer→L8",
        vuln_type: "整数下溢(SWC-102)", description: "balances[msg.sender]-=amount前虽检查>=amount但未防0地址转账",
        conclusion: "PASS-WARN" },
      { id: "AI-002", severity: "低危", location: "TestToken.sol→mint→L12",
        vuln_type: "中心化风险", description: "mint函数仅owner可调用，存在中心化增发风险",
        conclusion: "PASS-WARN" }
    ],
    final_verdict: { overall_conclusion: "PASS", pass_timestamp: new Date().toISOString() }
  });
  const aiReportHash = ethers.keccak256(ethers.toUtf8Bytes(aiReportContent));
  console.log("AI Report Hash:", aiReportHash);
  
  // ======== 步骤1: 部署合约 ========
  console.log("\n=== 步骤1: 部署合约 ===");
  
  const Ceat = await ethers.getContractFactory("Ceattoken");
  const ceat = await Ceat.deploy(ethers.parseEther("1000000"));
  await ceat.waitForDeployment();
  console.log("CeatToken:", await ceat.getAddress());
  
  const Proof = await ethers.getContractFactory("DepositProof");
  const proof = await Proof.deploy();
  await proof.waitForDeployment();
  console.log("DepositProof:", await proof.getAddress());
  
  const Mgr = await ethers.getContractFactory("AuditTeamManager");
  const mgr = await Mgr.deploy();
  await mgr.waitForDeployment();
  console.log("AuditTeamManager:", await mgr.getAddress());
  
  const DAO = await ethers.getContractFactory("AuditDAOv2");
  const dao = await DAO.deploy(await ceat.getAddress(), await proof.getAddress(), await mgr.getAddress());
  await dao.waitForDeployment();
  const daoAddr = await dao.getAddress();
  console.log("AuditDAOv2:", daoAddr);
  const ceatAddr = await ceat.getAddress();
  
  // 设置关联
  await proof.setAuditDAO(daoAddr);
  await mgr.setDaoContract(daoAddr);
  console.log("关联设置完成");
  
  // ======== 步骤2: 初始化角色 & 分发CEAT ========
  console.log("\n=== 步骤2: 初始化角色与分发CEAT ===");
  
  await dao.setAuditTeam(auditTeam.address);
  await dao.setCommitteeMembers(committeeMembers);
  console.log("Audit Team:", auditTeam.address);
  console.log("Committee:", committeeMembers.map(a => a.slice(0,10)+'...').join(', '));
  
  // 分发CEAT给测试用户
  const amount = ethers.parseEther("10000");
  const allUsers = [auditTeam, ...committeeMembers, ...communityUsers];
  for (const u of allUsers) {
    const addr = typeof u === 'string' ? u : u.address;
    await ceat.transfer(addr, amount);
  }
  // 转移奖励池
  await ceat.transfer(daoAddr, ethers.parseEther("100000"));
  console.log("CEAT分发完成(各10000 + 奖励池100000)");
  
  // ======== 步骤3: Owner用AI报告的codeHash创建提案 ========
  console.log("\n=== 步骤3: Owner创建提案(关联AI审计报告) ===");
  const tx1 = await dao.createProposal(codeHash);
  const receipt1 = await tx1.wait();
  console.log("提案0创建完成, tx:", receipt1.hash);
  
  const s1 = await dao.getProposalSummary(0);
  console.log("提案0 codeHash:", s1.codeHash);
  console.log("提案0状态: Submitted");
  
  // ======== 步骤4: 审计团队提交正式报告 ========
  console.log("\n=== 步骤4: 审计团队提交正式报告(引用AI报告) ===");
  // 正式报告引用AI审计结果
  const teamReport = ethers.keccak256(ethers.toUtf8Bytes("Team-verified-AI-report:" + aiReportHash));
  const tx2 = await dao.connect(auditTeam).submitTeamReport(0, teamReport);
  await tx2.wait();
  console.log("审计报告已提交, hash:", teamReport);
  
  // ======== 步骤5: Owner开启社区审核 ========
  console.log("\n=== 步骤5: Owner开启社区审核 ===");
  const tx3 = await dao.startCommunityReview(0);
  await tx3.wait();
  const s3 = await dao.getProposalSummary(0);
  console.log("状态: CommunityReview (status=", s3.status, ")");
  
  // ======== 步骤6: 社区用户质押+提交方案(3个用户各提交一个) ========
  console.log("\n=== 步骤6: 社区用户质押+提交方案 ===");
  const minStake = await dao.minStakeAmount();
  console.log("minStakeAmount:", ethers.formatEther(minStake), "CEAT");
  
  const communityHashes = [];
  for (let i = 0; i < communityUsers.length; i++) {
    const u = communityUsers[i];
    // 授权+质押
    await ceat.connect(u).approve(daoAddr, ethers.parseEther("1000"));
    await dao.connect(u).stake(ethers.parseEther("600"));
    
    // 提交方案(每个用户不同哈希)
    const propHash = ethers.keccak256(ethers.toUtf8Bytes(`community-proposal-${i}-${Date.now()}`));
    await dao.connect(u).submitCommunityProposal(0, propHash);
    communityHashes.push(propHash);
    console.log(`用户${i+1} (${u.address.slice(0,10)}...): 质押600CEAT, 方案 ${propHash.slice(0,20)}...`);
  }
  
  // ======== 步骤7: Owner开启投票 ========
  console.log("\n=== 步骤7: Owner开启投票 ===");
  const tx7 = await dao.startVoting(0);
  await tx7.wait();
  console.log("投票已开启, tx:", tx7.hash);
  
  // ======== 步骤8: 社区用户投票 ========
  console.log("\n=== 步骤8: 社区用户投票 ===");
  for (let i = 0; i < communityUsers.length; i++) {
    const u = communityUsers[i];
    // 每人投不同的方案(或相同)
    const voteHash = communityHashes[i % communityHashes.length];
    const tx = await dao.connect(u).vote(0, voteHash, 0); // 0 = 全部质押权重
    await tx.wait();
    console.log(`用户${i+1} 投票: ${voteHash.slice(0,20)}...`);
  }
  
  // 显示票数
  for (const h of communityHashes) {
    const v = await dao.getCommunityProposalVotes(0, h);
    console.log(`  方案 ${h.slice(0,20)}...: ${ethers.formatEther(v)} 票`);
  }
  
  // ======== 步骤9: Owner结束投票 ========
  console.log("\n=== 步骤9: Owner结束投票 ===");
  const tx9 = await dao.finalizeVoting(0);
  await tx9.wait();
  const s9 = await dao.getProposalSummary(0);
  const statusNames = ["Submitted","TeamReview","CommunityReview","Discussion","FirstDispute","SecondReview","CommitteeRuling","Arbitration","Finalized"];
  console.log("最终状态:", statusNames[s9.status], "(", s9.status, ")");
  
  // ======== 最终验证 ========
  console.log("\n========================================");
  console.log("  全链路测试结果");
  console.log("========================================");
  console.log("AI审计 → 代码哈希:", codeHash);
  console.log("AI审计 → 报告哈希:", aiReportHash);
  console.log("DAO提案 → codeHash匹配:", s9.codeHash === codeHash ? "✅" : "❌");
  console.log("审计团队 → 报告已提交:", s9.auditReportHash !== ethers.ZeroHash ? "✅" : "❌");
  console.log("社区方案 → 数量:", communityHashes.length, communityHashes.length >= 3 ? "✅" : "❌");
  console.log("投票       → 完成:", "✅");
  console.log("结束投票   → 状态:", statusNames[s9.status], s9.status >= 3 ? "✅" : "❌");
  console.log("========================================");
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error("❌ 测试失败:", e.shortMessage || e.message); process.exit(1); });
