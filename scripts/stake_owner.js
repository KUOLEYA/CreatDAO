const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Account:", deployer.address);

  const ceatAddr = "0x0c47280B0540ef2A161c567cfBB7056dA1ab8c09";
  const daoAddr = "0x05b2a841A5fe807429677eAbe5Ec2EB908D446a4";

  const ceat = await ethers.getContractAt("Ceattoken", ceatAddr);
  const dao = await ethers.getContractAt("AuditDAOv2", daoAddr);

  // Check current stake
  const info = await dao.getStakerInfo(deployer.address);
  console.log("Current stake:", ethers.formatEther(info.balance), "CEAT");

  const stakeAmount = ethers.parseEther("5000");

  // Approve
  console.log("Approving CEAT...");
  const approveTx = await ceat.approve(daoAddr, stakeAmount);
  await approveTx.wait();
  console.log("Approved:", approveTx.hash);

  // Stake
  console.log("Staking", ethers.formatEther(stakeAmount), "CEAT...");
  const stakeTx = await dao.stake(stakeAmount);
  await stakeTx.wait();
  console.log("Staked:", stakeTx.hash);

  const info2 = await dao.getStakerInfo(deployer.address);
  console.log("New stake:", ethers.formatEther(info2.balance), "CEAT");

  console.log("\nDone! Owner can now submit community proposals.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
