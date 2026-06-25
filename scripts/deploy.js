const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // ============ 1. 部署 CEAT 代币 ============
  const CeatToken = await ethers.getContractFactory("Ceattoken");
  const ceat = await CeatToken.deploy(ethers.parseEther("1000000"));
  await ceat.waitForDeployment();
  console.log("CeatToken deployed to:", await ceat.getAddress());

  // ============ 2. 部署存证合约 ============
  const DepositProof = await ethers.getContractFactory("DepositProof");
  const proof = await DepositProof.deploy();
  await proof.waitForDeployment();
  console.log("DepositProof deployed to:", await proof.getAddress());

  // ============ 3. 部署审计团队管理合约 ============
  const AuditTeamManager = await ethers.getContractFactory("AuditTeamManager");
  const teamMgr = await AuditTeamManager.deploy();
  await teamMgr.waitForDeployment();
  console.log("AuditTeamManager deployed to:", await teamMgr.getAddress());

  // ============ 4. 部署 AuditDAOv2 ============
  const AuditDAOv2 = await ethers.getContractFactory("AuditDAOv2");
  const dao = await AuditDAOv2.deploy(
    await ceat.getAddress(),
    await proof.getAddress(),
    await teamMgr.getAddress()
  );
  await dao.waitForDeployment();
  console.log("AuditDAOv2 deployed to:", await dao.getAddress());

  // 设置团队管理器与 DAO 的关联
  await teamMgr.setDaoContract(await dao.getAddress());
  console.log("AuditTeamManager.daoContract set to AuditDAOv2");

  // ============ 5. 部署审计团队多签合约 ============
  const deployerAddress = deployer.address;
  const auditTeamMembers = [
    deployerAddress,
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
  ];
  console.log("Audit team members:", auditTeamMembers);

  const AuditTeamMultisig = await ethers.getContractFactory("AuditTeamMultisig");
  const multisig = await AuditTeamMultisig.deploy(auditTeamMembers, await dao.getAddress());
  await multisig.waitForDeployment();
  console.log("AuditTeamMultisig deployed to:", await multisig.getAddress());

  await dao.setAuditTeam(await multisig.getAddress());
  console.log("AuditDAOv2.auditTeam set to multisig");

  // ============ 6. 部署 Kleros 仲裁代理 ============
  const klerosCourtAddress = "0x71bE63f3384f5fb98995898A86B02Fb2426c5788";
  const arbitrationFee = ethers.parseEther("0.1");
  const KlerosArbitrationProxy = await ethers.getContractFactory("KlerosArbitrationProxy");
  const klerosProxy = await KlerosArbitrationProxy.deploy(
    await dao.getAddress(),
    klerosCourtAddress,
    arbitrationFee
  );
  await klerosProxy.waitForDeployment();
  console.log("KlerosArbitrationProxy deployed to:", await klerosProxy.getAddress());

  await dao.setKlerosProxy(await klerosProxy.getAddress());
  console.log("AuditDAOv2.klerosProxy set");

  // ============ 7. 设置争议委员会（5人） ============
  const committeeMembers = [
    deployerAddress,
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"
  ];
  await dao.setCommitteeMembers(committeeMembers);
  console.log("AuditDAOv2.committeeMembers set:", committeeMembers);

  // ============ 8. 存证合约权限 & 奖励池转账 ============
  await proof.setAuditDAO(await dao.getAddress());
  console.log("DepositProof.auditDAO set to AuditDAOv2");

  const rewardAmount = ethers.parseEther("100000");
  await ceat.transfer(await dao.getAddress(), rewardAmount);
  console.log("Transferred", ethers.formatEther(rewardAmount), "CEAT to AuditDAOv2");

  // ============ 部署摘要 ============
  console.log("\n========== Deploy Summary ==========");
  console.log("CeatToken:", await ceat.getAddress());
  console.log("DepositProof:", await proof.getAddress());
  console.log("AuditTeamManager:", await teamMgr.getAddress());
  console.log("AuditDAOv2:", await dao.getAddress());
  console.log("AuditTeamMultisig:", await multisig.getAddress());
  console.log("KlerosArbitrationProxy:", await klerosProxy.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});