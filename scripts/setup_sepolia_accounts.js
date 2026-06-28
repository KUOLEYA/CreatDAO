// Sepolia 测试网：批量设置 10 个测试账户
// 用法: npx hardhat run scripts/setup_sepolia_accounts.js --network sepolia

const { ethers } = require("hardhat");

// 10 个测试地址
const ADDRESSES = [
  "0x147Fcf3EB8B9E305a5b4e16cbba90462F7126db9", // [0] Owner
  "0xdb03374034ca16Afe997038266886327d1efd3af", // [1] 审计团队
  "0x06157befB8Ca2Ba95dADAF0A1a5d7D13C4f2B523", // [2] 社区用户
  "0x513c4aF92b8D86786a3C14B51aF8cD08D442B697", // [3] 委员会成员1
  "0x8C0BF74416C5d2fE0025129e274185a2ac9ce144", // [4] 委员会成员2
  "0x8cD480e039415E45ebd2956A6A942D0062105E81", // [5] 委员会成员3
  "0x413Da6f14815929A1dd38EB98179C94dEa824F9B", // [6] 委员会成员4
  "0x32a8152c08EF7eE334Ee8BaB8c4c6F4277d737a7", // [7] 委员会成员5
  "0xE90AFceA4003e84452119546EC9B2Df6beA580C3", // [8] 社区用户
  "0x20Af5d715E41918e3C3697C70106c1C171484870", // [9] 社区用户
];

// 角色分配
const AUDIT_TEAM_IDX = 1;       // 地址[1] = 审计团队
const COMMITTEE_IDXS = [3, 4, 5, 6, 7]; // 地址[3-7] = 5个委员会成员
const CEAT_PER_USER = "10000";  // 每个用户转 10000 CEAT（可质押 100 票）

const DAO_ADDR = process.env.AUDIT_DAO_ADDRESS || "0x90badefFb1d35B0720c32073E6803a72aA41E005";
const CEAT_ADDR = process.env.CEAT_TOKEN_ADDRESS || "0x5Ae3d5bDC852D8f88B9ad2dde31bc4721cB6E523";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("=== Sepolia 测试账户批量设置 ===\n");
  console.log("执行账户 (Owner):", deployer.address);
  console.log("DAO 地址:", DAO_ADDR);
  console.log("CEAT 地址:", CEAT_ADDR);

  const dao = await ethers.getContractAt("AuditDAOv2", DAO_ADDR);
  const ceat = await ethers.getContractAt("Ceattoken", CEAT_ADDR);

  // ====== 0. 检查当前状态 ======
  console.log("\n--- 当前链上状态 ---");
  console.log("Owner:", await dao.owner());
  console.log("Audit Team:", await dao.auditTeam());
  
  const oldCommittee = await dao.getCommitteeMembers();
  console.log("当前委员会:", oldCommittee);

  const adminBalance = await ceat.balanceOf(deployer.address);
  console.log("Admin CEAT 余额:", ethers.formatEther(adminBalance));

  // ====== 1. 设置委员会成员 ======
  const committeeAddrs = COMMITTEE_IDXS.map(i => ADDRESSES[i]);
  console.log("\n--- 步骤1: 设置委员会成员 ---");
  console.log("新委员会:", committeeAddrs);

  if (JSON.stringify([...oldCommittee].sort()) === JSON.stringify([...committeeAddrs].sort())) {
    console.log("委员会已是最新，跳过");
  } else {
    const tx1 = await dao.setCommitteeMembers(committeeAddrs);
    console.log("交易已发送:", tx1.hash);
    await tx1.wait();
    console.log("委员会设置完成!");
    
    const newCommittee = await dao.getCommitteeMembers();
    console.log("确认委员会:", newCommittee);
  }

  // ====== 2. 设置审计团队 ======
  const auditTeamAddr = ADDRESSES[AUDIT_TEAM_IDX];
  console.log("\n--- 步骤2: 设置审计团队 ---");
  console.log("审计团队地址:", auditTeamAddr);

  const currentAuditTeam = await dao.auditTeam();
  if (currentAuditTeam.toLowerCase() === auditTeamAddr.toLowerCase()) {
    console.log("审计团队已是最新，跳过");
  } else {
    const tx2 = await dao.setAuditTeam(auditTeamAddr);
    console.log("交易已发送:", tx2.hash);
    await tx2.wait();
    console.log("审计团队设置完成!");
    console.log("确认审计团队:", await dao.auditTeam());
  }

  // ====== 3. 转移 CEAT 给所有非 Owner 地址 ======
  console.log("\n--- 步骤3: 转移 CEAT 代币 ---");
  const amount = ethers.parseEther(CEAT_PER_USER);
  let totalSent = 0n;

  for (let i = 1; i < ADDRESSES.length; i++) {
    const addr = ADDRESSES[i];
    const currentBalance = await ceat.balanceOf(addr);
    
    if (currentBalance >= amount) {
      console.log(`[${i}] ${addr} 已有 ${ethers.formatEther(currentBalance)} CEAT，跳过`);
      continue;
    }

    const sendAmount = amount - currentBalance;
    console.log(`[${i}] 转账 ${ethers.formatEther(sendAmount)} CEAT 到 ${addr} ...`);
    const tx = await ceat.transfer(addr, sendAmount);
    await tx.wait();
    totalSent += sendAmount;
    console.log(`     完成! tx: ${tx.hash}`);
  }

  // ====== 4. 最终状态确认 ======
  console.log("\n========================================");
  console.log("=== 最终状态确认 ===");
  console.log("========================================");
  
  console.log("\n角色配置:");
  console.log("  Owner:", await dao.owner());
  console.log("  Audit Team:", await dao.auditTeam());
  console.log("  Committee:", await dao.getCommitteeMembers());

  console.log("\n各地址 CEAT 余额:");
  for (let i = 0; i < ADDRESSES.length; i++) {
    const balance = await ceat.balanceOf(ADDRESSES[i]);
    const ethBal = await ethers.provider.getBalance(ADDRESSES[i]);
    const role = i === 0 ? "Owner" :
                 i === AUDIT_TEAM_IDX ? "审计团队" :
                 COMMITTEE_IDXS.includes(i) ? "委员会" : "社区用户";
    console.log(`  [${i}] ${role} | ${ADDRESSES[i]}`);
    console.log(`      CEAT: ${ethers.formatEther(balance)} | ETH: ${ethers.formatEther(ethBal)}`);
  }

  console.log("\n总计转移 CEAT:", ethers.formatEther(totalSent));
  console.log("\n=== 全部设置完成! ===");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("设置失败:", error);
    process.exit(1);
  });
