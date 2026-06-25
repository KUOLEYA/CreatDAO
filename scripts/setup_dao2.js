const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const daoAddr = "0x722292fB006F2B4AAbC9ba8925dd4A205fFD9328";
  const ceatTokenAddr = "0x0c47280B0540ef2A161c567cfBB7056dA1ab8c09";
  const depositProofAddr = "0x814f56A8BCe31bAbE7073D26EeE2A70B069600ea";
  const klerosProxyAddr = "0x347b86C13c73AB4D07047DEA152E0776465E9e97";
  const committeeMembers = [deployer.address,"0x70997970C51812dc3A010C7d01b50e0d17dc79C8","0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC","0x90F79bf6EB2c4f870365E785982E1f101E93b906","0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"];

  console.log("Target DAO:", daoAddr);
  const dao = await ethers.getContractAt("AuditDAOv2", daoAddr);

  async function doTx(name, fn) {
    console.log("Executing:", name, "...");
    try {
      const tx = await fn();
      await tx.wait();
      console.log("  -> done, tx:", tx.hash);
    } catch(e) {
      const msg = e.data?.message || e.message || String(e);
      if (msg.toLowerCase().includes("already")) {
        console.log("  -> already set, skipping");
      } else {
        throw e;
      }
    }
  }

  await doTx("setKlerosProxy", () => dao.setKlerosProxy(klerosProxyAddr));
  await doTx("setCommitteeMembers", () => dao.setCommitteeMembers(committeeMembers));
  await doTx("DepositProof.setAuditDAO", async () => {
    const proof = await ethers.getContractAt("DepositProof", depositProofAddr);
    return proof.setAuditDAO(daoAddr);
  });
  await doTx("Transfer CEAT", async () => {
    const ceat = await ethers.getContractAt("Ceattoken", ceatTokenAddr);
    return ceat.transfer(daoAddr, ethers.parseEther("100000"));
  });

  console.log("\n===== Setup complete:", daoAddr, "=====");
}

main().catch(console.error);
