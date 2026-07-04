const hre = require("hardhat");

async function main() {
  await hre.network.provider.send("evm_increaseTime", [172800]); // +2 天
  await hre.network.provider.send("evm_mine");
  console.log("✅ 时间已快进 2 天");
}

main().catch(console.error);
