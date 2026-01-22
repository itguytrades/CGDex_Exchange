// scripts/compare_token_bytecode.js
// npx hardhat run --network baseSepolia scripts/compare_token_bytecode.js
// npx hardhat run --network localhost scripts/compare_token_bytecode.js

const config = require('../src/config.json')
const { keccak256 } = ethers.utils

async function main() {
  const { chainId } = await ethers.provider.getNetwork()
  const addr = config[chainId].mETH.address
  const code = await ethers.provider.getCode(addr)
  console.log('chainId:', chainId)
  console.log('mETH:', addr)
  console.log('codeHash:', keccak256(code))
  console.log('codeLen:', code.length)
}
main().catch(console.error)