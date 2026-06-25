const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AuditDAO", function () {
  let AuditDAO, dao, CeatToken, ceat, DepositProof, proof;
  let owner, user1, user2, auditTeam, committee;

  before(async function () {
    [owner, user1, user2, auditTeam, ...committee] = await ethers.getSigners();

    // 部署 CEAT 代币
    const CeatTokenFactory = await ethers.getContractFactory("Ceattoken");
    ceat = await CeatTokenFactory.deploy(ethers.parseEther("1000000"));
    await ceat.waitForDeployment();

    // 部署存证合约
    const DepositProofFactory = await ethers.getContractFactory("DepositProof");
    proof = await DepositProofFactory.deploy();
    await proof.waitForDeployment();

    // 部署 AuditDAO
    const AuditDAOFactory = await ethers.getContractFactory("AuditDAO");
    dao = await AuditDAOFactory.deploy(ceat.target, proof.target);
    await dao.waitForDeployment();

    // 设置存证合约的 auditDAO 地址
    await proof.setAuditDAO(dao.target);
  });

  it("Should allow staking", async function () {
    // 授权
    await ceat.connect(user1).approve(dao.target, ethers.parseEther("100"));
    // 质押
    await dao.connect(user1).stake(ethers.parseEther("100"));
    const staker = await dao.stakers(user1.address);
    expect(staker.balance).to.equal(ethers.parseEther("100"));
  });

  it("Should create a proposal", async function () {
    const codeHash = ethers.keccak256(ethers.toUtf8Bytes("code_v1"));
    await dao.connect(owner).createProposal(codeHash);
    const proposal = await dao.proposals(0);
    expect(proposal.codeHash).to.equal(codeHash);
    expect(proposal.status).to.equal(0); // AIPassed
  });

  // 继续添加更多测试...
});