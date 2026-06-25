const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying CeatToken with account:", deployer.address);

  const CeatToken = await ethers.getContractFactory("Ceattoken");
  const ceat = await CeatToken.deploy(ethers.parseEther("10000000"));
  await ceat.waitForDeployment();
  const addr = await ceat.getAddress();
  console.log("CeatToken deployed to:", addr);

  const balance = await ceat.balanceOf(deployer.address);
  console.log("Owner balance:", ethers.formatEther(balance), "CEAT");
  console.log("\nCEAT_TOKEN_ADDRESS=" + addr);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
