const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const ceatAddr = "0x1C8aE2804ac7083a7abC340185cFA630BB587AE9";
  const target = ethers.parseEther("1000000");

  const ceat = await ethers.getContractAt("Ceattoken", ceatAddr);

  console.log("Owner:", deployer.address);

  let balance = await ceat.balanceOf(deployer.address);
  console.log("Current CEAT:", ethers.formatEther(balance));

  if (balance >= target) {
    console.log("Already have enough CEAT");
    return;
  }

  const needed = target - balance;
  const ethNeeded = needed / 100n; // 1 ETH = 100 CEAT
  console.log("Need", ethers.formatEther(needed), "more CEAT");
  console.log("Buying with", ethers.formatEther(ethNeeded), "ETH...");

  const tx = await ceat.buyCEAT({ value: ethNeeded });
  await tx.wait();
  console.log("Tx:", tx.hash);

  balance = await ceat.balanceOf(deployer.address);
  console.log("Final CEAT:", ethers.formatEther(balance));
}

main().catch(console.error);
