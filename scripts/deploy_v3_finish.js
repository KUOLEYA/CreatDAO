const { ethers } = require("hardhat");

const CEAT_ADDR = "0x502AEEFe3dD38138aFe5f0b53CeA2F0D6e93909F";
const PROOF_ADDR = "0xd0b7090F0074b36bC213150a33f6548265AFE6c9";
const TEAM_MGR_ADDR = "0x383888e823aCa8eFa5274Ce7A061A8b88758F504";
const DAO_ADDR = "0xdF6e49Ee87531BEE0e60A21EA94F662e90847cBa";
const MULTISIG_ADDR = "0xe16c8f2b5D40179252D6b42C777206d493aC2ca2";
const KLEROS_ADDR = "0xeE036ff0adCCC3572E4c46970739AEF33d60E267";
const CERT_ADDR = "0x01946b0E502bB00c8c05F17F7c812069766d9Dc4";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Finishing setup with:", deployer.address);
  console.log("ETH balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  const overrides = {
    gasPrice: ethers.parseUnits("40", "gwei"),
    gasLimit: 300000
  };

  const dao = await ethers.getContractAt("AuditDAOv2", DAO_ADDR);

  // 验证已完成的设置
  console.log("\n=== Verifying existing setup ===");
  console.log("auditTeam:", await dao.auditTeam());
  console.log("klerosProxy:", await dao.klerosProxy());

  // ============ 1. setCommitteeMembers ============
  console.log("\n[1/4] Setting committee members...");
  const committeeMembers = [
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
    "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"
  ];
  let tx = await dao.setCommitteeMembers(committeeMembers, overrides);
  await tx.wait();
  console.log("Committee set:", committeeMembers);

  // ============ 2. DepositProof setAuditDAO ============
  console.log("\n[2/4] Setting DepositProof.auditDAO...");
  const proof = await ethers.getContractAt("DepositProof", PROOF_ADDR);
  tx = await proof.setAuditDAO(DAO_ADDR, overrides);
  await tx.wait();
  console.log("DepositProof.auditDAO set");

  // ============ 3. AuditCertificate setAuditDAO ============
  console.log("\n[3/4] Setting AuditCertificate.auditDAO...");
  const cert = await ethers.getContractAt("AuditCertificate", CERT_ADDR);
  tx = await cert.setAuditDAO(DAO_ADDR, overrides);
  await tx.wait();
  console.log("AuditCertificate.auditDAO set");

  // ============ 4. Transfer rewards ============
  console.log("\n[4/4] Transferring rewards...");
  const ceat = await ethers.getContractAt("Ceattoken", CEAT_ADDR);
  tx = await ceat.transfer(DAO_ADDR, ethers.parseEther("100000"), overrides);
  await tx.wait();
  console.log("100,000 CEAT transferred to DAO");

  // ============ 验证 ============
  console.log("\n========== VERIFICATION ==========");
  console.log("auditTeam:", await dao.auditTeam());
  console.log("klerosProxy:", await dao.klerosProxy());
  console.log("committeeMembers:", await dao.getCommitteeMembers());
  console.log("proposalCreationFee:", ethers.formatEther(await dao.proposalCreationFee()));
  console.log("==================================\n");

  console.log("ALL DONE. Summary:");
  console.log("CeatToken:", CEAT_ADDR);
  console.log("DepositProof:", PROOF_ADDR);
  console.log("AuditTeamManager:", TEAM_MGR_ADDR);
  console.log("AuditDAOv2:", DAO_ADDR);
  console.log("AuditTeamMultisig:", MULTISIG_ADDR);
  console.log("KlerosArbitrationProxy:", KLEROS_ADDR);
  console.log("AuditCertificate:", CERT_ADDR);
}

main().catch((e) => { console.error(e); process.exit(1); });
