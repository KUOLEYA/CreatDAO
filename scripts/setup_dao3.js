const { ethers } = require("hardhat");

async function main() {
  const daoAddr = "0x722292fB006F2B4AAbC9ba8925dd4A205fFD9328";
  const ceatTokenAddr = "0x0c47280B0540ef2A161c567cfBB7056dA1ab8c09";
  const depositProofAddr = "0x814f56A8BCe31bAbE7073D26EeE2A70B069600ea";

  console.log("Target DAO:", daoAddr);

  async function doTx(name, fn) {
    console.log("Executing:", name, "...");
    const tx = await fn();
    await tx.wait();
    console.log("  -> done, tx:", tx.hash);
  }

  await doTx("DepositProof.setAuditDAO", async () => {
    const proof = await ethers.getContractAt("DepositProof", depositProofAddr);
    return proof.setAuditDAO(daoAddr);
  });

  await doTx("Transfer 100000 CEAT", async () => {
    const ceat = await ethers.getContractAt("Ceattoken", ceatTokenAddr);
    return ceat.transfer(daoAddr, ethers.parseEther("100000"));
  });

  console.log("\n===== All done:", daoAddr, "=====");
}

main().catch(console.error);
