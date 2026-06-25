const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Deployer ETH balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  // ============ 1. 部署 CEAT 代币 ============
  console.log("\n[1/8] Deploying CeatToken...");
  const CeatToken = await ethers.getContractFactory("Ceattoken");
  const ceat = await CeatToken.deploy(ethers.parseEther("1000000"));
  await ceat.waitForDeployment();
  const ceatAddr = await ceat.getAddress();
  console.log("CeatToken:", ceatAddr);

  // ============ 2. 部署存证合约 ============
  console.log("\n[2/8] Deploying DepositProof...");
  const DepositProof = await ethers.getContractFactory("DepositProof");
  const proof = await DepositProof.deploy();
  await proof.waitForDeployment();
  const proofAddr = await proof.getAddress();
  console.log("DepositProof:", proofAddr);

  // ============ 3. 部署审计团队管理合约 ============
  console.log("\n[3/8] Deploying AuditTeamManager...");
  const AuditTeamManager = await ethers.getContractFactory("AuditTeamManager");
  const teamMgr = await AuditTeamManager.deploy();
  await teamMgr.waitForDeployment();
  const teamMgrAddr = await teamMgr.getAddress();
  console.log("AuditTeamManager:", teamMgrAddr);

  // ============ 4. 部署 AuditDAOv2 ============
  console.log("\n[4/8] Deploying AuditDAOv2...");
  const AuditDAOv2 = await ethers.getContractFactory("AuditDAOv2");
  const dao = await AuditDAOv2.deploy(ceatAddr, proofAddr, teamMgrAddr);
  await dao.waitForDeployment();
  const daoAddr = await dao.getAddress();
  console.log("AuditDAOv2:", daoAddr);

  // 设置团队管理器关联
  await teamMgr.setDaoContract(daoAddr);
  console.log("AuditTeamManager.daoContract set");

  // ============ 5. 部署审计团队多签合约 ============
  console.log("\n[5/8] Deploying AuditTeamMultisig...");
  const auditTeamMembers = [
    deployer.address,
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
  ];
  // 注意：构造函数不再需要dao地址（否决权已移除）
  const AuditTeamMultisig = await ethers.getContractFactory("AuditTeamMultisig");
  const multisig = await AuditTeamMultisig.deploy(auditTeamMembers);
  await multisig.waitForDeployment();
  const multisigAddr = await multisig.getAddress();
  console.log("AuditTeamMultisig:", multisigAddr);

  await dao.setAuditTeam(multisigAddr);
  console.log("AuditDAOv2.auditTeam set");

  // ============ 6. 部署 Kleros 仲裁代理 ============
  console.log("\n[6/8] Deploying KlerosArbitrationProxy...");
  const klerosCourtAddress = "0x71bE63f3384f5fb98995898A86B02Fb2426c5788";
  const arbitrationFee = ethers.parseEther("0.1");
  const KlerosArbitrationProxy = await ethers.getContractFactory("KlerosArbitrationProxy");
  const klerosProxy = await KlerosArbitrationProxy.deploy(daoAddr, klerosCourtAddress, arbitrationFee);
  await klerosProxy.waitForDeployment();
  const klerosAddr = await klerosProxy.getAddress();
  console.log("KlerosArbitrationProxy:", klerosAddr);

  await dao.setKlerosProxy(klerosAddr);
  console.log("AuditDAOv2.klerosProxy set");

  // ============ 7. 设置争议委员会（5人，不含owner避免利益冲突） ============
  console.log("\n[7/8] Setting committee members...");
  const committeeMembers = [
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
    "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"
  ];
  await dao.setCommitteeMembers(committeeMembers);
  console.log("Committee members:", committeeMembers);

  // ============ 8. 部署审计证书NFT ============
  console.log("\n[8/8] Deploying AuditCertificate (NFT)...");
  const AuditCertificate = await ethers.getContractFactory("AuditCertificate");
  const cert = await AuditCertificate.deploy();
  await cert.waitForDeployment();
  const certAddr = await cert.getAddress();
  console.log("AuditCertificate:", certAddr);
  await cert.setAuditDAO(daoAddr);
  console.log("AuditCertificate.auditDAO set");

  // ============ 9. 存证合约权限 & 奖励池转账 ============
  console.log("\n[Setup] Configuring permissions...");
  await proof.setAuditDAO(daoAddr);
  console.log("DepositProof.auditDAO set");

  const rewardAmount = ethers.parseEther("100000");
  await ceat.transfer(daoAddr, rewardAmount);
  console.log("Transferred 100,000 CEAT to AuditDAOv2 reward pool");

  // ============ 部署摘要 ============
  console.log("\n==============================================");
  console.log("           DEPLOYMENT SUMMARY");
  console.log("==============================================");
  console.log("CeatToken:           ", ceatAddr);
  console.log("DepositProof:        ", proofAddr);
  console.log("AuditTeamManager:    ", teamMgrAddr);
  console.log("AuditDAOv2:          ", daoAddr);
  console.log("AuditTeamMultisig:   ", multisigAddr);
  console.log("KlerosArbitrationProxy:", klerosAddr);
  console.log("AuditCertificate:    ", certAddr);
  console.log("==============================================\n");

  console.log("Copy to .env:");
  console.log("CEAT_TOKEN_ADDRESS=" + ceatAddr);
  console.log("AUDIT_DAO_ADDRESS=" + daoAddr);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
