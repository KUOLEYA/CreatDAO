// 准备新提案 + 让社区用户准备好（转 ETH + CEAT + 质押）
// 流程: 创建提案 → 提交团队报告 → 开启社区审核 → 社区用户提交方案（你手动）
// 用法: npx hardhat run scripts/prep_proposal_and_fund.js --network sepolia

const { ethers } = require("hardhat");

const DAO_ADDR = process.env.AUDIT_DAO_ADDRESS || "0x90badefFb1d35B0720c32073E6803a72aA41E005";
const CEAT_ADDR = process.env.CEAT_TOKEN_ADDRESS || "0x5Ae3d5bDC852D8f88B9ad2dde31bc4721cB6E523";

// 社区用户地址（账户3、9、10）
const COMMUNITY_USERS = [
  "0x06157befB8Ca2Ba95dADAF0A1a5d7D13C4f2B523", // [3] 社区用户1
  "0xE90AFceA4003e84452119546EC9B2Df6beA580C3", // [9] 社区用户2
  "0x20Af5d715E41918e3C3697C70106c1C171484870", // [10] 社区用户3
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("=== 为新提案准备环境 ===\n");
  console.log("Owner:", deployer.address);

  const dao = await ethers.getContractAt("AuditDAOv2", DAO_ADDR);
  const ceat = await ethers.getContractAt("Ceattoken", CEAT_ADDR);

  // ====== 1. 给社区用户转 ETH（付 Gas） ======
  console.log("\n--- 步骤1: 给社区用户转 ETH ---");
  const ethAmount = ethers.parseEther("0.05");
  for (const addr of COMMUNITY_USERS) {
    const balance = await ethers.provider.getBalance(addr);
    if (balance >= ethAmount) {
      console.log(`${addr} 已有 ${ethers.formatEther(balance)} ETH，跳过`);
      continue;
    }
    console.log(`转账 0.05 ETH 到 ${addr} ...`);
    const tx = await deployer.sendTransaction({ to: addr, value: ethAmount });
    await tx.wait();
    console.log(`  done: ${tx.hash}`);
  }

  // ====== 2. 确保社区用户有足够 CEAT 并质押 ======
  console.log("\n--- 步骤2: 确保社区用户有 CEAT 并质押 ---");
  const minStake = await dao.minStakeAmount();
  console.log("minStakeAmount:", ethers.formatEther(minStake), "CEAT");

  for (const addr of COMMUNITY_USERS) {
    const ceatBal = await ceat.balanceOf(addr);
    const staked = await dao.getStakerInfo(addr);
    console.log(`${addr}: CEAT=${ethers.formatEther(ceatBal)}, Staked=${ethers.formatEther(staked.balance)}`);

    // 确保 CEAT 余额 >= minStake + 100
    const needCEAT = minStake + ethers.parseEther("100");
    if (ceatBal < needCEAT) {
      const toSend = needCEAT - ceatBal;
      console.log(`  转账 ${ethers.formatEther(toSend)} CEAT ...`);
      const tx = await ceat.transfer(addr, toSend);
      await tx.wait();
    }
  }

  // ====== 3. 创建新提案 ======
  console.log("\n--- 步骤3: 创建新提案 ---");
  const nextId = await dao.nextProposalId();
  console.log("下一个提案ID:", nextId.toString());

  // 用不同的 codeHash 区分
  const codeHash = ethers.keccak256(ethers.toUtf8Bytes("test-proposal-v2-" + Date.now()));
  console.log("codeHash:", codeHash);
  
  const tx1 = await dao.createProposal(codeHash);
  await tx1.wait();
  console.log("提案创建完成:", tx1.hash);

  // ====== 4. 提交审计团队报告 ======
  console.log("\n--- 步骤4: 提交审计团队报告 ---");
  const reportHash = ethers.keccak256(ethers.toUtf8Bytes("team-report-" + Date.now()));
  const tx2 = await dao.submitTeamReport(nextId, reportHash);
  await tx2.wait();
  console.log("团队报告已提交:", tx2.hash);

  // ====== 5. 开启社区审核 ======
  console.log("\n--- 步骤5: 开启社区审核 ---");
  const tx3 = await dao.startCommunityReview(nextId);
  await tx3.wait();
  console.log("社区审核已开启:", tx3.hash);

  // ====== 6. 确认状态 ======
  const summary = await dao.getProposalSummary(nextId);
  console.log("\n=== 最终状态 ===");
  console.log("提案ID:", summary.id.toString());
  console.log("状态:", summary.status, "(2 = CommunityReview)");
  console.log("审计报告:", "0x" + Buffer.from(summary.auditReportHash.slice(2), 'hex').toString('hex'));

  console.log("\n========================================");
  console.log("现在请在前端用以下账户各提交一个社区方案：");
  for (let i = 0; i < COMMUNITY_USERS.length; i++) {
    console.log(`  ${i+1}. 地址 ${i+3}: ${COMMUNITY_USERS[i]}`);
  }
  console.log("提交完成后告诉我，我帮你开启投票。");
  console.log("========================================");
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });
