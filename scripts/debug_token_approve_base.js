// scripts/debug_token_approve_base.js
// npx hardhat run --network baseSepolia scripts/debug_token_approve_base.js

const config = require('../src/config.json')

async function main() {
  const { chainId } = await ethers.provider.getNetwork()
  if (Number(chainId) !== 84532) throw new Error(`Wrong chainId: ${chainId}`)

  const [signer] = await ethers.getSigners()
  const signerAddr = await signer.getAddress()

  const CGD = await ethers.getContractAt('Token', config[chainId].CGD.address)
  const exchangeAddr = config[chainId].exchange.address

  console.log('Signer:', signerAddr)
  console.log('CGD:', CGD.address)
  console.log('Exchange:', exchangeAddr)

  const before = await CGD.allowance(signerAddr, exchangeAddr)
  console.log('allowance before:', before.toString())

  const tx = await CGD.connect(signer).approve(exchangeAddr, ethers.constants.MaxUint256)
  console.log('approve tx:', tx.hash)
  await tx.wait()

  const after = await CGD.allowance(signerAddr, exchangeAddr)
  console.log('allowance after:', after.toString())
}

main().catch(console.error)
