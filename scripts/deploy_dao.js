const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const ceatTokenAddr = "0x0c47280B0540ef2A161c567cfBB7056dA1ab8c09";
  const depositProofAddr = "0x814f56A8BCe31bAbE7073D26EeE2A70B069600ea";
  const teamMgrAddr = "0x468b354a182bd667b1fF2BBa011322fe34A66Dca";

  const AuditDAOv2 = await ethers.getContractFactory("AuditDAOv2");
  const dao = await AuditDAOv2.deploy(ceatTokenAddr, depositProofAddr, teamMgrAddr);
  await dao.waitForDeployment();
  const daoAddr = await dao.getAddress();
  console.log("AuditDAOv2 deployed to:", daoAddr);
  console.log("\nNEW_AUDIT_DAO_ADDRESS=" + daoAddr);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
