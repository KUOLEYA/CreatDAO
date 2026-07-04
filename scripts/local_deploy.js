// Hardhat 本地节点部署脚本（仅部署，不跑流程）
const { ethers } = require("hardhat");

async function main() {
  const [owner] = await ethers.getSigners();
  console.log("Owner:", owner.address);

  // 1. 部署 CeatToken
  const Ceat = await ethers.getContractFactory("Ceattoken");
  const ceat = await Ceat.deploy(ethers.parseEther("1000000"));
  await ceat.waitForDeployment();
  const ceatAddr = await ceat.getAddress();

  // 2. 部署 DepositProof
  const Proof = await ethers.getContractFactory("DepositProof");
  const proof = await Proof.deploy();
  await proof.waitForDeployment();
  const proofAddr = await proof.getAddress();

  // 3. 部署 AuditTeamManager
  const Mgr = await ethers.getContractFactory("AuditTeamManager");
  const mgr = await Mgr.deploy();
  await mgr.waitForDeployment();
  const mgrAddr = await mgr.getAddress();

  // 4. 部署 AuditDAOv2
  const DAO = await ethers.getContractFactory("AuditDAOv2");
  const dao = await DAO.deploy(ceatAddr, proofAddr, mgrAddr);
  await dao.waitForDeployment();
  const daoAddr = await dao.getAddress();

  // 5. 设置关联
  await proof.setAuditDAO(daoAddr);
  await mgr.setDaoContract(daoAddr);

  // 6. 设置角色（使用 Hardhat 默认账户）
  const signers = await ethers.getSigners();
  const auditTeam = signers[1];
  const committeeMembers = [
    signers[4].address, signers[5].address, signers[6].address,
    signers[7].address, signers[8].address
  ];
  await dao.setAuditTeam(auditTeam.address);
  await dao.setCommitteeMembers(committeeMembers);

  // 6.5 注册审计团队到 AuditTeamManager
  await mgr.registerAuditTeam("CreatDAO Core Audit Team", auditTeam.address, [signers[1].address, signers[2].address]);
  console.log(" Audtit Team 注册完成: teamId=0, contract=", auditTeam.address);

  // 7. 分发 CEAT（账户 2-10 各 10000，奖励池 100000）
  const allUsers = [signers[1], signers[2], signers[3], ...signers.slice(4, 10)];
  for (const u of allUsers) {
    await ceat.transfer(u.address, ethers.parseEther("100000"));
  }
  await ceat.transfer(daoAddr, ethers.parseEther("100000"));

  // 8. 设置提案创建费
  await dao.setProposalCreationFee(ethers.parseEther("100"));

  // 9. 部署 Hello 合约（用于 AI 审计测试）
  const Hello = await ethers.getContractFactory("Hello");
  const hello = await Hello.deploy();
  await hello.waitForDeployment();
  const helloAddr = await hello.getAddress();

  // 输出部署结果
  console.log("\n========================================");
  console.log("  部署完成");
  console.log("========================================");
  console.log("--- 合约地址 ---");
  console.log("CeatToken        :", ceatAddr);
  console.log("AuditDAOv2       :", daoAddr);
  console.log("AuditTeamManager :", mgrAddr);
  console.log("DepositProof     :", proofAddr);
  console.log("Hello (测试)      :", helloAddr);
  console.log("--- 角色地址 ---");
  console.log("Owner            :", owner.address);
  console.log("Audit Team       :", auditTeam.address);
  console.log("Committee(5)     :", committeeMembers.join(',\n                   '));
  console.log("========================================");

  // 自动生成 .env 文件
  const fs = require("fs");
  const path = require("path");
  const envPath = path.join(__dirname, "..", ".env");

  // 读取现有 .env（如果存在），保留 Sepolia 等已有配置
  let existingEnv = {};
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const eqIdx = line.indexOf("=");
      if (eqIdx > 0 && !line.startsWith("#")) {
        const key = line.substring(0, eqIdx).trim();
        if (key && !key.startsWith("LOCAL_")) {
          existingEnv[key] = line.substring(eqIdx + 1).trim();
        }
      }
    }
  }

  const envLines = [
    "# ================================================",
    "# 自动生成 - 本地 Hardhat 部署地址",
    "# 手动编辑请保留 SEPOLIA_* 配置行",
    "# ================================================",
    "CHAIN_ID=31337",
    "RPC_URL=http://127.0.0.1:8545",
    "ADMIN_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "",
    "# --- 本地 Hardhat (自动生成) ---",
    `LOCAL_AUDIT_DAO_ADDRESS=${daoAddr}`,
    `LOCAL_CEAT_TOKEN_ADDRESS=${ceatAddr}`,
    `LOCAL_TEAM_MANAGER_ADDRESS=${mgrAddr}`,
    "",
  ];

  // 保留已有的非 LOCAL_ 配置（如 Sepolia 地址）
  for (const [key, value] of Object.entries(existingEnv)) {
    if (!key.startsWith("#") && key !== "CHAIN_ID" && key !== "RPC_URL" && key !== "ADMIN_PRIVATE_KEY") {
      envLines.push(`${key}=${value}`);
    }
  }

  envLines.push("");
  fs.writeFileSync(envPath, envLines.join("\n"), "utf8");
  console.log("\n.env file generated at:", envPath);
  console.log("========================================");
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error("Deploy failed:", e.shortMessage || e.message); process.exit(1); });
