const { ethers } = require("hardhat");

// 公链部署辅助：等待交易确认 + 延迟，避免 nonce 冲突
async function waitAndDelay(tx, label, delaySec = 5) {
  const receipt = await tx.wait();
  console.log(`${label} - tx confirmed, block ${receipt.blockNumber}, gas ${receipt.gasUsed.toString()}`);
  if (delaySec > 0) {
    console.log(`  waiting ${delaySec}s for nonce sync...`);
    await new Promise(r => setTimeout(r, delaySec * 1000));
  }
  return receipt;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Deployer ETH balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));
  console.log("(Waiting 10s between deploy steps for Sepolia nonce safety)\n");

  // ============ 1. 部署 CEAT 代币 ============
  console.log("[1/8] Deploying CeatToken...");
  const CeatToken = await ethers.getContractFactory("Ceattoken");
  const ceat = await CeatToken.deploy(ethers.parseEther("1000000"));
  await waitAndDelay(ceat.deploymentTransaction(), "CeatToken", 10);
  const ceatAddr = await ceat.getAddress();
  console.log("CeatToken: " + ceatAddr + "\n");

  // ============ 2. 部署存证合约 ============
  console.log("[2/8] Deploying DepositProof...");
  const DepositProof = await ethers.getContractFactory("DepositProof");
  const proof = await DepositProof.deploy();
  await waitAndDelay(proof.deploymentTransaction(), "DepositProof", 10);
  const proofAddr = await proof.getAddress();
  console.log("DepositProof: " + proofAddr + "\n");

  // ============ 3. 部署审计团队管理合约 ============
  console.log("[3/8] Deploying AuditTeamManager...");
  const AuditTeamManager = await ethers.getContractFactory("AuditTeamManager");
  const teamMgr = await AuditTeamManager.deploy();
  await waitAndDelay(teamMgr.deploymentTransaction(), "AuditTeamManager", 10);
  const teamMgrAddr = await teamMgr.getAddress();
  console.log("AuditTeamManager: " + teamMgrAddr + "\n");

  // ============ 4. 部署 AuditDAOv2 ============
  console.log("[4/8] Deploying AuditDAOv2...");
  const AuditDAOv2 = await ethers.getContractFactory("AuditDAOv2");
  const dao = await AuditDAOv2.deploy(ceatAddr, proofAddr, teamMgrAddr);
  await waitAndDelay(dao.deploymentTransaction(), "AuditDAOv2", 15); // 主合约，多等一会
  const daoAddr = await dao.getAddress();
  console.log("AuditDAOv2: " + daoAddr + "\n");

  // 设置团队管理器关联
  console.log("  -> Setting teamMgr.daoContract...");
  const txDao = await teamMgr.setDaoContract(daoAddr);
  await waitAndDelay(txDao, "teamMgr.setDaoContract", 10);
  console.log("");

  // ============ 5. 部署审计团队多签合约 ============
  console.log("[5/8] Deploying AuditTeamMultisig...");
  const auditTeamMembers = [
    deployer.address,
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
  ];
  const AuditTeamMultisig = await ethers.getContractFactory("AuditTeamMultisig");
  const multisig = await AuditTeamMultisig.deploy(auditTeamMembers);
  await waitAndDelay(multisig.deploymentTransaction(), "AuditTeamMultisig", 10);
  const multisigAddr = await multisig.getAddress();
  console.log("AuditTeamMultisig: " + multisigAddr + "\n");

  console.log("  -> Setting dao.auditTeam...");
  const txAt = await dao.setAuditTeam(multisigAddr);
  await waitAndDelay(txAt, "dao.setAuditTeam", 10);
  console.log("");

  // ============ 6. 部署 Kleros 仲裁代理 ============
  console.log("[6/8] Deploying KlerosArbitrationProxy...");
  const klerosCourtAddress = "0x71bE63f3384f5fb98995898A86B02Fb2426c5788";
  const arbitrationFee = ethers.parseEther("0.1");
  const KlerosArbitrationProxy = await ethers.getContractFactory("KlerosArbitrationProxy");
  const klerosProxy = await KlerosArbitrationProxy.deploy(daoAddr, klerosCourtAddress, arbitrationFee);
  await waitAndDelay(klerosProxy.deploymentTransaction(), "KlerosArbitrationProxy", 10);
  const klerosAddr = await klerosProxy.getAddress();
  console.log("KlerosArbitrationProxy: " + klerosAddr + "\n");

  console.log("  -> Setting dao.klerosProxy...");
  const txkp = await dao.setKlerosProxy(klerosAddr);
  await waitAndDelay(txkp, "dao.setKlerosProxy", 10);
  console.log("");

  // ============ 7. 设置争议委员会（5人） ============
  console.log("[7/8] Setting committee members...");
  const committeeMembers = [
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
    "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"
  ];
  const txCm = await dao.setCommitteeMembers(committeeMembers);
  await waitAndDelay(txCm, "dao.setCommitteeMembers", 10);
  console.log("Committee: " + committeeMembers.join(", ") + "\n");

  // ============ 8. 部署审计证书NFT ============
  console.log("[8/8] Deploying AuditCertificate (NFT)...");
  const AuditCertificate = await ethers.getContractFactory("AuditCertificate");
  const cert = await AuditCertificate.deploy();
  await waitAndDelay(cert.deploymentTransaction(), "AuditCertificate", 10);
  const certAddr = await cert.getAddress();
  console.log("AuditCertificate: " + certAddr + "\n");

  console.log("  -> Setting cert.auditDAO...");
  const txCert = await cert.setAuditDAO(daoAddr);
  await waitAndDelay(txCert, "cert.setAuditDAO", 10);
  console.log("");

  // ============ 存证合约权限 & 奖励池转账 ============
  console.log("[Setup] Configuring permissions...");
  const txProof = await proof.setAuditDAO(daoAddr);
  await waitAndDelay(txProof, "proof.setAuditDAO", 10);

  const rewardAmount = ethers.parseEther("100000");
  const txReward = await ceat.transfer(daoAddr, rewardAmount);
  await waitAndDelay(txReward, "Reward pool transfer", 10);
  console.log("Transferred 100,000 CEAT to AuditDAOv2 reward pool\n");

  // ============ 部署摘要 ============
  console.log("==============================================");
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
