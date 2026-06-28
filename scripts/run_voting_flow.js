// 一键完成：质押 + 提交社区方案 + 开启投票
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const daoAddr = process.env.AUDIT_DAO_ADDRESS || "0x90badefFb1d35B0720c32073E6803a72aA41E005";
  const ceatAddr = process.env.CEAT_TOKEN_ADDRESS || "0x5Ae3d5bDC852D8f88B9ad2dde31bc4721cB6E523";
  
  console.log("Deployer:", deployer.address);
  
  const dao = await ethers.getContractAt("AuditDAOv2", daoAddr);
  const ceat = await ethers.getContractAt("Ceattoken", ceatAddr);
  
  // Check current state
  const info = await dao.getStakerInfo(deployer.address);
  console.log("Staked:", ethers.formatEther(info.balance), "CEAT");
  console.log("minStakeAmount:", ethers.formatEther(await dao.minStakeAmount()), "CEAT");
  
  const summary = await dao.getProposalSummary(0);
  console.log("Proposal 0 status:", summary.status, "(2=CommunityReview)");
  
  // Step 1: Stake enough (need >= 500 CEAT)
  const minStake = await dao.minStakeAmount();
  if (info.balance < minStake) {
    const need = minStake + ethers.parseEther("100");
    console.log("Need to stake total:", ethers.formatEther(need), "CEAT");
    
    // Approve first
    const allowance = await ceat.allowance(deployer.address, daoAddr);
    if (allowance < need) {
      console.log("Approving CEAT...");
      const tx = await ceat.approve(daoAddr, need);
      await tx.wait();
      console.log("Approved:", tx.hash);
    }
    
    // Stake
    const toStake = need - info.balance;
    console.log("Staking", ethers.formatEther(toStake), "more CEAT...");
    const tx = await dao.stake(toStake);
    await tx.wait();
    console.log("Staked:", tx.hash);
  }
  
  // Step 2: Submit community proposal
  const proposalHash = ethers.keccak256(ethers.toUtf8Bytes("community-proposal-1"));
  console.log("Community hash:", proposalHash);
  
  try {
    const hashes = await dao.getCommunityProposalHashes(0);
    console.log("Existing hashes:", hashes.length);
    
    if (hashes.length === 0) {
      console.log("Submitting community proposal...");
      const tx = await dao.submitCommunityProposal(0, proposalHash);
      await tx.wait();
      console.log("Submitted:", tx.hash);
    }
  } catch (e) {
    console.log("Submit error:", e.shortMessage || e.message);
  }
  
  // Step 3: Start voting
  try {
    const hashes = await dao.getCommunityProposalHashes(0);
    console.log("Hashes after submit:", hashes.length);
    
    if (hashes.length > 0) {
      console.log("Starting voting...");
      const tx = await dao.startVoting(0);
      await tx.wait();
      console.log("Voting started:", tx.hash);
      
      // Verify
      const s2 = await dao.getProposalSummary(0);
      console.log("votingEndTime:", new Date(Number(s2.votingEndTime) * 1000).toISOString());
    }
  } catch (e) {
    console.log("Start voting error:", e.shortMessage || e.message);
  }
  
  console.log("\nDone!");
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });
