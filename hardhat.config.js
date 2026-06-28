require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: "cancun",
      viaIR: true,
      optimizer: { 
        enabled: true, 
        runs: 200
      },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode"],
          "": ["irOptimized", "ir"]
        }
      }
    },
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: (function() {
        const pk = (process.env.ADMIN_PRIVATE_KEY || "").replace(/^0x/, "");
        return /^[0-9a-fA-F]{64}$/.test(pk) ? ["0x" + pk] : [];
      })(),
      chainId: 11155111,
    },
  },
};