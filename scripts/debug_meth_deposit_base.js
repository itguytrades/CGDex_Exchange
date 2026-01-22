// scripts/debug_meth_deposit_base.js
// npx hardhat run --network baseSepolia scripts/debug_meth_deposit_base.js

const config = require('../src/config.json')

function prettyErr(err) {
  return (
    err?.reason ||
    err?.error?.reason ||
    err?.data?.message ||
    err?.error?.message ||
    err?.message ||
    String(err)
  )
}

async function main() {
  const { chainId } = await ethers.provider.getNetwork()
  if (Number(chainId) !== 84532) throw new Error(`Wrong chainId: ${chainId}`)

  const signers = await ethers.getSigners()
  const user2 = signers[1]
  if (!user2) throw new Error('Need signer[1] (PRIVATE_KEY_BASE_2)')

  const user2Addr = await user2.getAddress()

  const mETH = await ethers.getContractAt('Token', config[chainId].mETH.address)
  const exchangeAddr = config[chainId].exchange.address
  const exchange = await ethers.getContractAt('Exchange', exchangeAddr)

  const decimals = await mETH.decimals()
  const amount = ethers.utils.parseUnits('1', decimals)

  console.log('user2:', user2Addr)
  console.log('mETH:', mETH.address)
  console.log('exchange:', exchangeAddr)

  // metadata sanity
  const name = await mETH.name().catch(() => '(name failed)')
  const symbol = await mETH.symbol().catch(() => '(symbol failed)')
  console.log('meta:', { name, symbol, decimals })

  const bal = await mETH.balanceOf(user2Addr)
  const allowance = await mETH.allowance(user2Addr, exchangeAddr)
  console.log('balance:', ethers.utils.formatUnits(bal, decimals), bal.toString())
  console.log('allowance:', allowance.toString())

  console.log('\n--- Preflight: callStatic depositToken ---')
  try {
    await exchange.connect(user2).callStatic.depositToken(mETH.address, amount)
    console.log('callStatic depositToken: OK')
  } catch (e) {
    console.log('callStatic depositToken: REVERTED ->', prettyErr(e))
  }

  console.log('\n--- Preflight: callStatic transferFrom to exchange ---')
  try {
    await mETH.connect(user2).callStatic.transferFrom(user2Addr, exchangeAddr, amount)
    console.log('callStatic transferFrom: OK')
  } catch (e) {
    console.log('callStatic transferFrom: REVERTED ->', prettyErr(e))
  }

  console.log('\n--- Try approve(0) then approve(MaxUint) ---')
  try {
    await (await mETH.connect(user2).approve(exchangeAddr, 0)).wait()
    await (await mETH.connect(user2).approve(exchangeAddr, ethers.constants.MaxUint256)).wait()
    const allowance2 = await mETH.allowance(user2Addr, exchangeAddr)
    console.log('allowance after re-approve:', allowance2.toString())
  } catch (e) {
    console.log('approve sequence failed ->', prettyErr(e))
  }
}

main().catch((e) => {
  console.error('[DEBUG ERROR]', prettyErr(e))
  process.exit(1)
})
