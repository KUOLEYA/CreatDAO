const hre = require("hardhat");

async function main() {
  console.log("\n========================================");
  console.log("  开始部署至 Sepolia 测试网");
  console.log("========================================\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(await deployer.getBalance()), "ETH\n");

  // 1. 部署 CEAT 代币
  console.log("(1/5) 部署 CeatToken...");
  const CeatToken = await hre.ethers.getContractFactory("CeatToken");
  const ceat = await CeatToken.deploy();
  await ceat.waitForDeployment();
  console.log("CeatToken 已部署:", await ceat.getAddress());

  // 2. 部署 DepositProof
  console.log("\n(2/5) 部署 DepositProof...");
  const DepositProof = await hre.ethers.getContractFactory("DepositProof");
  const depositProof = await DepositProof.deploy();
  await depositProof.waitForDeployment();
  console.log("DepositProof 已部署:", await depositProof.getAddress());

  // 3. 部署 AuditTeamManager
  console.log("\n(3/5) 部署 AuditTeamManager...");
  const AuditTeamManager = await hre.ethers.getContractFactory("AuditTeamManager");
  const auditTeamManager = await AuditTeamManager.deploy(
    await ceat.getAddress(),
    deployer.address, // 初始管理员
    [deployer.address] // 初始审计团队
  );
  await auditTeamManager.waitForDeployment();
  console.log("AuditTeamManager 已部署:", await auditTeamManager.getAddress());

  // 4. 部署 AuditDAOv2
  console.log("\n(4/5) 部署 AuditDAOv2...");
  const AuditDAOv2 = await hre.ethers.getContractFactory("AuditDAOv2");
  const auditDAOv2 = await AuditDAOv2.deploy(
    await ceat.getAddress(),
    await depositProof.getAddress(),
    await auditTeamManager.getAddress(),
    deployer.address,
    [
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
      "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
      "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"
    ]
  );
  await auditDAOv2.waitForDeployment();
  console.log("AuditDAOv2 已部署:", await auditDAOv2.getAddress());

  // 5. 部署 AuditCertificate
  console.log("\n(5/5) 部署 AuditCertificate...");
  const AuditCertificate = await hre.ethers.getContractFactory("AuditCertificate");
  const auditCert = await AuditCertificate.deploy(await auditDAOv2.getAddress());
  await auditCert.waitForDeployment();
  console.log("AuditCertificate 已部署:", await auditCert.getAddress());

  console.log("\n========================================");
  console.log("  部署完成");
  console.log("========================================");
  console.log("Owner           :", deployer.address);
  console.log("CeatToken       :", await ceat.getAddress());
  console.log("DepositProof    :", await depositProof.getAddress());
  console.log("AuditTeamManager:", await auditTeamManager.getAddress());
  console.log("AuditDAOv2      :", await auditDAOv2.getAddress());
  console.log("AuditCertificate:", await auditCert.getAddress());
  console.log("========================================\n");

  // 验证部署
  console.log("  开始验证合约... (请稍后在 etherscan 上验证)\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
