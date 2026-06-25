const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Using account:", deployer.address);

  // 新部署的合约地址（必须与你的 .env 完全一致）
  const CEAT_ADDRESS   = "0x4D4561575c42A50309AC0605D77Ce9245Afd2CDE";
  const PROOF_ADDRESS  = "0xDA01b15507de1281E767EF1d701Bbc04E4288D9a";
  const DAO_ADDRESS    = "0xF7Da60eD39a7d968Fe22E8A4Cf7028B7B69387b2";

  const CeatToken    = await ethers.getContractAt("Ceattoken", CEAT_ADDRESS);
  const DepositProof = await ethers.getContractAt("DepositProof", PROOF_ADDRESS);
  const AuditDAO     = await ethers.getContractAt("AuditDAO", DAO_ADDRESS);

  // 1. DepositProof 设置 auditDAO
  console.log("1/4 Setting DepositProof.auditDAO...");
  let tx = await DepositProof.setAuditDAO(DAO_ADDRESS);
  await tx.wait();
  console.log("   ✅ Done");

  // 2. AuditDAO 设置 auditTeam（暂时用管理员）
  console.log("2/4 Setting auditTeam to deployer...");
  tx = await AuditDAO.setAuditTeam(deployer.address);
  await tx.wait();
  console.log("   ✅ Done");

  // 3. AuditDAO 设置 klerosProxy（暂时用管理员）
  console.log("3/4 Setting klerosProxy to deployer...");
  tx = await AuditDAO.setKlerosProxy(deployer.address);
  await tx.wait();
  console.log("   ✅ Done");

  // 4. 转 100000 CEAT 到 AuditDAO 作为奖励池
  const rewardAmount = ethers.parseEther("100000");
  console.log(`4/4 Transferring ${ethers.formatEther(rewardAmount)} CEAT...`);
  tx = await CeatToken.transfer(DAO_ADDRESS, rewardAmount);
  await tx.wait();
  console.log("   ✅ Done");

  console.log("\n🎉 Initialization complete! Try frontend again.");
}

main().catch((error) => {
  console.error("❌ Setup failed:", error);
  process.exit(1);
});