const { ethers } = require("hardhat");

// 已部署地址
const CEAT_ADDR = "0x502AEEFe3dD38138aFe5f0b53CeA2F0D6e93909F";
const PROOF_ADDR = "0xd0b7090F0074b36bC213150a33f6548265AFE6c9";
const TEAM_MGR_ADDR = "0x383888e823aCa8eFa5274Ce7A061A8b88758F504";
const DAO_ADDR = "0xdF6e49Ee87531BEE0e60A21EA94F662e90847cBa";

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Continuing deployment with:", deployer.address);
  console.log("ETH balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  // ============ 5. 部署 AuditTeamMultisig ============
  console.log("\n[5/8] Deploying AuditTeamMultisig...");
  const auditTeamMembers = [
    deployer.address,
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
  ];
  const AuditTeamMultisig = await ethers.getContractFactory("AuditTeamMultisig");
  const multisig = await AuditTeamMultisig.deploy(auditTeamMembers);
  await multisig.waitForDeployment();
  const multisigAddr = await multisig.getAddress();
  console.log("AuditTeamMultisig:", multisigAddr);

  await sleep(2000);

  // ============ 6. 部署 KlerosArbitrationProxy ============
  console.log("\n[6/8] Deploying KlerosArbitrationProxy...");
  const KlerosArbitrationProxy = await ethers.getContractFactory("KlerosArbitrationProxy");
  const klerosProxy = await KlerosArbitrationProxy.deploy(
    DAO_ADDR,
    "0x71bE63f3384f5fb98995898A86B02Fb2426c5788",
    ethers.parseEther("0.1")
  );
  await klerosProxy.waitForDeployment();
  const klerosAddr = await klerosProxy.getAddress();
  console.log("KlerosArbitrationProxy:", klerosAddr);

  await sleep(2000);

  // ============ 7. 部署 AuditCertificate NFT ============
  console.log("\n[7/8] Deploying AuditCertificate...");
  const AuditCertificate = await ethers.getContractFactory("AuditCertificate");
  const cert = await AuditCertificate.deploy();
  await cert.waitForDeployment();
  const certAddr = await cert.getAddress();
  console.log("AuditCertificate:", certAddr);

  await sleep(2000);

  // ============ 8. 配置 DAO 参数 ============
  console.log("\n[8/8] Configuring DAO and permissions...");

  const dao = await ethers.getContractAt("AuditDAOv2", DAO_ADDR);

  // 设置审计团队（多签地址）
  await dao.setAuditTeam(multisigAddr);
  console.log("auditTeam ->", multisigAddr);
  await sleep(2000);

  // 设置 Kleros 代理
  await dao.setKlerosProxy(klerosAddr);
  console.log("klerosProxy ->", klerosAddr);
  await sleep(2000);

  // 设置委员会（不含owner）
  const committeeMembers = [
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
    "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"
  ];
  await dao.setCommitteeMembers(committeeMembers);
  console.log("committeeMembers:", committeeMembers);
  await sleep(2000);

  // 存证合约关联
  const proof = await ethers.getContractAt("DepositProof", PROOF_ADDR);
  await proof.setAuditDAO(DAO_ADDR);
  console.log("DepositProof.auditDAO set");
  await sleep(2000);

  // AuditCertificate 关联
  await cert.setAuditDAO(DAO_ADDR);
  console.log("AuditCertificate.auditDAO set");
  await sleep(2000);

  // 奖励池转账
  const ceat = await ethers.getContractAt("Ceattoken", CEAT_ADDR);
  const rewardAmount = ethers.parseEther("100000");
  await ceat.transfer(DAO_ADDR, rewardAmount);
  console.log("Transferred 100,000 CEAT to DAO reward pool");

  // ============ 部署摘要 ============
  console.log("\n==============================================");
  console.log("         FINAL DEPLOYMENT SUMMARY");
  console.log("==============================================");
  console.log("CeatToken:           ", CEAT_ADDR);
  console.log("DepositProof:        ", PROOF_ADDR);
  console.log("AuditTeamManager:    ", TEAM_MGR_ADDR);
  console.log("AuditDAOv2:          ", DAO_ADDR);
  console.log("AuditTeamMultisig:   ", multisigAddr);
  console.log("KlerosArbitrationProxy:", klerosAddr);
  console.log("AuditCertificate:    ", certAddr);
  console.log("==============================================\n");

  console.log(".env update:");
  console.log("CEAT_TOKEN_ADDRESS=" + CEAT_ADDR);
  console.log("AUDIT_DAO_ADDRESS=" + DAO_ADDR);
  console.log("AUDIT_CERTIFICATE_ADDRESS=" + certAddr);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
