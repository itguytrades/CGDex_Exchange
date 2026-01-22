require('@nomiclabs/hardhat-ethers')
require('dotenv').config()

const baseAccounts = [
  process.env.PRIVATE_KEY_BASE,
  process.env.PRIVATE_KEY_BASE_2
].filter(Boolean) // removes undefined

module.exports = {
  solidity: '0.8.20',
  networks: {
    hardhat: { chainId: 31337 },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL,
      accounts: [process.env.PRIVATE_KEY].filter(Boolean),
      chainId: 11155111
    },
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
      accounts: baseAccounts,
      chainId: 84532
    }
  }
}