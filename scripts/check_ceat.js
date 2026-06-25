const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const ceatAddr = "0x1C8aE2804ac7083a7abC340185cFA630BB587AE9";
  
  const ceat = await ethers.getContractAt("Ceattoken", ceatAddr);
  
  console.log("Owner:", deployer.address);
  const balance = await ceat.balanceOf(deployer.address);
  console.log("Current balance:", ethers.formatEther(balance), "CEAT");
  
  const amount = ethers.parseEther("1000000");
  
  // Check if owner has enough or need to mint/buy
  if (balance < amount) {
    console.log("Insufficient balance, trying to buy CEAT...");
    // Buy CEAT with ETH
    const tx = await ceat.buyCEAT({ value: ethers.parseEther("50") });
    await tx.wait();
    const newBalance = await ceat.balanceOf(deployer.address);
    console.log("After buy:", ethers.formatEther(newBalance), "CEAT");
  } else {
    console.log("Already have enough CEAT");
  }
}

main().catch(console.error);
