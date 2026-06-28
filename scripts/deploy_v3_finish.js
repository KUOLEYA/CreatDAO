const { ethers } = require("hardhat");
require("dotenv").config();

// 从 .env 读取合约地址，不再硬编码
const CEAT_ADDR = process.env.CEAT_TOKEN_ADDRESS;
const DAO_ADDR = process.env.AUDIT_DAO_ADDRESS;
const PROOF_ADDR = process.env.DEPOSIT_PROOF_ADDRESS || "";
const CERT_ADDR = process.env.AUDIT_CERTIFICATE_ADDRESS || "";

async function main() {
  if (!CEAT_ADDR || !DAO_ADDR) {
    console.error("ERROR: CEAT_TOKEN_ADDRESS and AUDIT_DAO_ADDRESS must be set in .env");
    process.exit(1);
  }

  const [deployer] = await ethers.getSigners();
  console.log("Finishing setup with:", deployer.address);
  console.log("DAO:", DAO_ADDR);
  console.log("CEAT:", CEAT_ADDR);

  const dao = await ethers.getContractAt("AuditDAOv2", DAO_ADDR);

  // 验证当前状态
  console.log("\n=== Current state ===");
  try { console.log("auditTeam:", await dao.auditTeam()); } catch { console.log("auditTeam: (not set)"); }
  try { console.log("klerosProxy:", await dao.klerosProxy()); } catch { console.log("klerosProxy: (not set)"); }
  try { console.log("committee:", await dao.getCommitteeMembers()); } catch { console.log("committee: (not set)"); }

  const steps = [];

  // 1. setCommitteeMembers
  try {
    const existing = await dao.getCommitteeMembers();
    if (existing.length === 0) {
      console.log("\n[1/4] Setting committee members...");
      const committeeMembers = [
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
        "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
        "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
        "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"
      ];
      const tx = await dao.setCommitteeMembers(committeeMembers);
      await tx.wait();
      console.log("Committee set");
    } else {
      console.log("\n[1/4] Committee already set, skipping");
    }
  } catch (e) { console.log("[1/4] Failed:", e.shortMessage); }

  // 2. DepositProof setAuditDAO
  if (PROOF_ADDR && PROOF_ADDR !== "0x0000000000000000000000000000000000000000") {
    console.log("\n[2/4] Setting DepositProof.auditDAO...");
    try {
      const proof = await ethers.getContractAt("DepositProof", PROOF_ADDR);
      const tx = await proof.setAuditDAO(DAO_ADDR);
      await tx.wait();
      console.log("DepositProof.auditDAO set");
    } catch (e) { console.log("[2/4] Failed:", e.shortMessage); }
  } else {
    console.log("\n[2/4] No PROOF_ADDR configured, skipping");
  }

  // 3. AuditCertificate setAuditDAO
  if (CERT_ADDR && CERT_ADDR !== "0x0000000000000000000000000000000000000000") {
    console.log("\n[3/4] Setting AuditCertificate.auditDAO...");
    try {
      const cert = await ethers.getContractAt("AuditCertificate", CERT_ADDR);
      const tx = await cert.setAuditDAO(DAO_ADDR);
      await tx.wait();
      console.log("AuditCertificate.auditDAO set");
    } catch (e) { console.log("[3/4] Failed:", e.shortMessage); }
  } else {
    console.log("\n[3/4] No CERT_ADDR configured, skipping");
  }

  // 4. Transfer rewards
  console.log("\n[4/4] Transferring rewards...");
  try {
    const ceat = await ethers.getContractAt("Ceattoken", CEAT_ADDR);
    const daoBalance = await ceat.balanceOf(DAO_ADDR);
    if (daoBalance < ethers.parseEther("1000")) {
      const tx = await ceat.transfer(DAO_ADDR, ethers.parseEther("100000"));
      await tx.wait();
      console.log("100,000 CEAT transferred to DAO");
    } else {
      console.log("DAO already has", ethers.formatEther(daoBalance), "CEAT, skipping");
    }
  } catch (e) { console.log("[4/4] Failed:", e.shortMessage); }

  console.log("\n========== FINAL STATE ==========");
  console.log("auditTeam:", await dao.auditTeam());
  console.log("klerosProxy:", await dao.klerosProxy());
  console.log("committee:", await dao.getCommitteeMembers());
  console.log("==================================");
}

main().catch((e) => { console.error(e); process.exit(1); });
