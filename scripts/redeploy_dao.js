const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const ceatTokenAddr = "0x1C8aE2804ac7083a7abC340185cFA630BB587AE9";
  const depositProofAddr = "0x814f56A8BCe31bAbE7073D26EeE2A70B069600ea";
  const oldDaoAddr = "0x0A531f1085458f5d7b04bbD16120c37E9b1784CE";
  const multisigAddr = "0xdDED45157a6e66fda3d5760BF2D70A4ED3E2b22b";
  const klerosProxyAddr = "0x347b86C13c73AB4D07047DEA152E0776465E9e97";

  console.log("Reading teamManager from old DAO...");
  const oldDao = await ethers.getContractAt("AuditDAOv2", oldDaoAddr);
  const teamMgrAddr = await oldDao.teamManager();
  console.log("TeamManager:", teamMgrAddr);

  const oldCommittee = await oldDao.getCommitteeMembers();
  console.log("Old committee members:", oldCommittee);

  // ============ Deploy new AuditDAOv2 ============
  const AuditDAOv2 = await ethers.getContractFactory("AuditDAOv2");
  const dao = await AuditDAOv2.deploy(ceatTokenAddr, depositProofAddr, teamMgrAddr);
  await dao.waitForDeployment();
  const daoAddr = await dao.getAddress();
  console.log("\n===== NEW AuditDAOv2 deployed to:", daoAddr, "=====\n");

  // ============ Setup ============
  const teamMgr = await ethers.getContractAt("AuditTeamManager", teamMgrAddr);
  await teamMgr.setDaoContract(daoAddr);
  console.log("TeamManager.daoContract updated");

  await dao.setAuditTeam(multisigAddr);
  console.log("AuditTeam set");

  await dao.setKlerosProxy(klerosProxyAddr);
  console.log("KlerosProxy set");

  const validCommittee = oldCommittee.filter(a => a !== "0x0000000000000000000000000000000000000000");
  await dao.setCommitteeMembers(validCommittee);
  console.log("Committee members set:", validCommittee);

  const proof = await ethers.getContractAt("DepositProof", depositProofAddr);
  await proof.setAuditDAO(daoAddr);
  console.log("DepositProof.auditDAO updated");

  const ceat = await ethers.getContractAt("Ceattoken", ceatTokenAddr);
  const rewardAmount = ethers.parseEther("100000");
  await ceat.transfer(daoAddr, rewardAmount);
  console.log("Transferred 100000 CEAT to new DAO");

  console.log("\n==============================================");
  console.log("NEW_AUDIT_DAO_ADDRESS=" + daoAddr);
  console.log("==============================================");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
