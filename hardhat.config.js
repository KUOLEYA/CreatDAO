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
      accounts: (process.env.ADMIN_PRIVATE_KEY && /^[0-9a-fA-F]{64}$/.test(process.env.ADMIN_PRIVATE_KEY))
        ? [process.env.ADMIN_PRIVATE_KEY] : [],
      chainId: 11155111,
    },
  },
};