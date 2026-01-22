// scripts/seed_baseSepolia_full.js
// Run:
// npx hardhat run --network baseSepolia scripts/seed_baseSepolia_full.js

const config = require('../src/config.json')
const { NonceManager } = require('@ethersproject/experimental')

const wait = (s) => new Promise((r) => setTimeout(r, s * 1000))

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

async function assertDeployed(address, label) {
  const code = await ethers.provider.getCode(address)
  if (!code || code === '0x') throw new Error(`${label} not deployed at ${address} (no bytecode)`)
}

async function getEip1559Overrides(provider) {
  const fee = await provider.getFeeData()

  const bump = (bn, num = 14, den = 10) => (bn ? bn.mul(num).div(den) : bn)

  let maxPriorityFeePerGas = fee.maxPriorityFeePerGas
  let maxFeePerGas = fee.maxFeePerGas

  // Fallbacks if RPC doesn’t provide fee data
  if (!maxPriorityFeePerGas) maxPriorityFeePerGas = ethers.utils.parseUnits('0.05', 'gwei')
  if (!maxFeePerGas) maxFeePerGas = ethers.utils.parseUnits('0.5', 'gwei')

  // bump ~40%
  maxPriorityFeePerGas = bump(maxPriorityFeePerGas)
  maxFeePerGas = bump(maxFeePerGas)

  return { maxFeePerGas, maxPriorityFeePerGas }
}

async function logBalances({ token, tokenName, exchange, user, userAddr, decimals }) {
  const walletBal = await token.balanceOf(userAddr)
  const exBal = await exchange.balanceOf(token.address, userAddr)
  const allowance = await token.allowance(userAddr, exchange.address)

  console.log(`[${tokenName}] wallet:   ${ethers.utils.formatUnits(walletBal, decimals)} (${walletBal.toString()})`)
  console.log(`[${tokenName}] exchange: ${ethers.utils.formatUnits(exBal, decimals)} (${exBal.toString()})`)
  console.log(`[${tokenName}] allow:    ${ethers.utils.formatUnits(allowance, decimals)} (${allowance.toString()})`)

  return { walletBal, exBal, allowance }
}

// ERC-20-safe approval pattern:
// reset to 0 then approve MaxUint256
async function approveMax({ token, tokenName, owner, ownerAddr, spender, decimals, txOpts }) {
  const current = await token.allowance(ownerAddr, spender)

  console.log(`\n[${tokenName}] current allowance -> exchange: ${ethers.utils.formatUnits(current, decimals)} (${current.toString()})`)

  if (!current.isZero()) {
    console.log(`[${tokenName}] resetting allowance to 0...`)
    await (await token.connect(owner).approve(spender, 0, txOpts)).wait()
  }

  console.log(`[${tokenName}] approving MaxUint256...`)
  await (await token.connect(owner).approve(spender, ethers.constants.MaxUint256, txOpts)).wait()

  const after = await token.allowance(ownerAddr, spender)
  console.log(`[${tokenName}] allowance after approveMax: ${ethers.utils.formatUnits(after, decimals)} (${after.toString()})`)

  if (after.isZero()) throw new Error(`[${tokenName}] approveMax failed (allowance still 0)`)
}

async function depositWithChecks({ token, tokenName, exchange, user, userAddr, amount, decimals, txOpts }) {
  console.log(`\n=== Deposit ${tokenName} (${userAddr}) ===`)
  await logBalances({ token, tokenName, exchange, user, userAddr, decimals })

  const walletBal = await token.balanceOf(userAddr)
  console.log(`[${tokenName}] deposit amount: ${ethers.utils.formatUnits(amount, decimals)} (${amount.toString()})`)
  if (walletBal.lt(amount)) throw new Error(`[${tokenName}] insufficient wallet balance for deposit`)

  await approveMax({
    token,
    tokenName,
    owner: user,
    ownerAddr: userAddr,
    spender: exchange.address,
    decimals,
    txOpts
  })

  // Preflight (no gas spent if it would revert)
  try {
    await exchange.connect(user).callStatic.depositToken(token.address, amount)
  } catch (err) {
    console.error(`[${tokenName}] callStatic depositToken would revert:`, prettyErr(err))
    throw err
  }

  console.log(`[${tokenName}] depositing...`)
  await (await exchange.connect(user).depositToken(token.address, amount, txOpts)).wait()
  console.log(`[${tokenName}] deposit confirmed.`)

  const exAfter = await exchange.balanceOf(token.address, userAddr)
  console.log(`[${tokenName}] exchange balance after: ${ethers.utils.formatUnits(exAfter, decimals)} (${exAfter.toString()})`)
}

async function makeOrderSafe({ exchange, user, tokenGet, amountGet, tokenGive, amountGive, label, txOpts }) {
  try {
    await exchange.connect(user).callStatic.makeOrder(tokenGet, amountGet, tokenGive, amountGive)
  } catch (err) {
    console.error(`[ORDER ${label}] callStatic makeOrder would revert:`, prettyErr(err))
    throw err
  }

  const tx = await exchange.connect(user).makeOrder(tokenGet, amountGet, tokenGive, amountGive, txOpts)
  const receipt = await tx.wait()

  const orderEvent = receipt.events?.find((e) => e.event === 'Order')
  const id = orderEvent?.args?.id
  if (!id) throw new Error(`[ORDER ${label}] could not read Order event id`)

  console.log(`[ORDER ${label}] created id: ${id.toString()}`)
  return id
}

async function cancelOrderSafe(exchange, user, orderId, txOpts) {
  try {
    await exchange.connect(user).callStatic.cancelOrder(orderId)
  } catch (err) {
    console.error(`[CANCEL] callStatic cancelOrder would revert:`, prettyErr(err))
    throw err
  }
  await (await exchange.connect(user).cancelOrder(orderId, txOpts)).wait()
}

async function fillOrderSafe(exchange, user, orderId, txOpts) {
  try {
    await exchange.connect(user).callStatic.fillOrder(orderId)
  } catch (err) {
    console.error(`[FILL] callStatic fillOrder would revert:`, prettyErr(err))
    throw err
  }
  await (await exchange.connect(user).fillOrder(orderId, txOpts)).wait()
}

async function main() {
  const net = await ethers.provider.getNetwork()
  const chainId = Number(net.chainId)

  console.log(`\nSeeding Base Sepolia — chainId: ${chainId}\n`)
  if (chainId !== 84532) throw new Error(`Wrong network. Expected Base Sepolia (84532), got ${chainId}`)

  const signersRaw = await ethers.getSigners()
  if (signersRaw.length < 2) {
    throw new Error('Need 2 signers. Set PRIVATE_KEY_BASE_2 and fund it with Base Sepolia ETH.')
  }

  const user1Addr = await signersRaw[0].getAddress()
  const user2Addr = await signersRaw[1].getAddress()

  // Wrap signers to avoid nonce collisions on repeated runs
  const user1 = new NonceManager(signersRaw[0])
  const user2 = new NonceManager(signersRaw[1])

  console.log(`User1 (maker):  ${user1Addr}`)
  console.log(`User2 (filler): ${user2Addr}\n`)

  const chainCfg = config?.[chainId]
  if (!chainCfg?.CGD?.address || !chainCfg?.mETH?.address || !chainCfg?.exchange?.address) {
    throw new Error(`Missing addresses in src/config.json for chainId ${chainId}`)
  }

  const CGD = await ethers.getContractAt('Token', chainCfg.CGD.address)
  const mETH = await ethers.getContractAt('Token', chainCfg.mETH.address)
  const exchange = await ethers.getContractAt('Exchange', chainCfg.exchange.address)

  await assertDeployed(CGD.address, 'CGD')
  await assertDeployed(mETH.address, 'mETH')
  await assertDeployed(exchange.address, 'Exchange')

  console.log(`CGD:      ${CGD.address}`)
  console.log(`mETH:     ${mETH.address}`)
  console.log(`Exchange: ${exchange.address}\n`)

  const cgdDecimals = await CGD.decimals()
  const mEthDecimals = await mETH.decimals()

  // Fee overrides used for every tx to avoid "replacement fee too low"
  const txOpts = await getEip1559Overrides(ethers.provider)
  console.log('Using fee overrides:', {
    maxFeePerGas: txOpts.maxFeePerGas.toString(),
    maxPriorityFeePerGas: txOpts.maxPriorityFeePerGas.toString()
  })
  console.log('')

  // -----------------------------
  // 1) Fund user2 with mETH
  // -----------------------------
  const fundmETH = ethers.utils.parseUnits('2000', mEthDecimals)
  console.log(`Funding user2 with ${ethers.utils.formatUnits(fundmETH, mEthDecimals)} mETH...`)
  await (await mETH.connect(user1).transfer(user2Addr, fundmETH, txOpts)).wait()
  console.log('Funding complete.\n')
  await wait(2)

  // -----------------------------
  // 2) Deposits
  // -----------------------------
  const depositCGD = ethers.utils.parseUnits('1000', cgdDecimals)
  const depositmETH = ethers.utils.parseUnits('1000', mEthDecimals)

  await depositWithChecks({
    token: CGD,
    tokenName: 'CGD',
    exchange,
    user: user1,
    userAddr: user1Addr,
    amount: depositCGD,
    decimals: cgdDecimals,
    txOpts
  })
  await wait(2)

  await depositWithChecks({
    token: mETH,
    tokenName: 'mETH',
    exchange,
    user: user2,
    userAddr: user2Addr,
    amount: depositmETH,
    decimals: mEthDecimals,
    txOpts
  })
  await wait(2)

  // -----------------------------
  // 3) Cancelled order (user1)
  // tokenGet=mETH, tokenGive=CGD
  // -----------------------------
  console.log('\nSeeding cancelled order...\n')
  let orderId = await makeOrderSafe({
    exchange,
    user: user1,
    tokenGet: mETH.address,
    amountGet: ethers.utils.parseUnits('10', mEthDecimals),
    tokenGive: CGD.address,
    amountGive: ethers.utils.parseUnits('5', cgdDecimals),
    label: 'CANCEL-1',
    txOpts
  })

  await cancelOrderSafe(exchange, user1, orderId, txOpts)
  console.log(`Cancelled order ${orderId.toString()}\n`)
  await wait(2)

  // -----------------------------
  // 4) Filled orders (user1 maker, user2 filler)
  // filler pays tokenGet + fee in tokenGet, so user2 must have mETH deposited (done)
  // -----------------------------
  console.log('Seeding filled orders...\n')

  const filled = [
    { get: '25', give: '10' },
    { get: '15', give: '8' },
    { get: '40', give: '12' }
  ]

  for (let i = 0; i < filled.length; i++) {
    const spec = filled[i]

    orderId = await makeOrderSafe({
      exchange,
      user: user1,
      tokenGet: mETH.address,
      amountGet: ethers.utils.parseUnits(spec.get, mEthDecimals),
      tokenGive: CGD.address,
      amountGive: ethers.utils.parseUnits(spec.give, cgdDecimals),
      label: `FILL-${i + 1}`,
      txOpts
    })

    await fillOrderSafe(exchange, user2, orderId, txOpts)
    console.log(`Filled order ${orderId.toString()}\n`)
    await wait(2)
  }

  // -----------------------------
  // 5) Open orders (small count to save gas)
  // -----------------------------
  console.log('Seeding open orders...\n')

  for (let i = 1; i <= 3; i++) {
    await makeOrderSafe({
      exchange,
      user: user1,
      tokenGet: mETH.address,
      amountGet: ethers.utils.parseUnits(String(2 * i), mEthDecimals),
      tokenGive: CGD.address,
      amountGive: ethers.utils.parseUnits(String(5 * i), cgdDecimals),
      label: `OPEN-SELL-${i}`,
      txOpts
    })
    await wait(1)
  }

  for (let i = 1; i <= 3; i++) {
    await makeOrderSafe({
      exchange,
      user: user2,
      tokenGet: CGD.address,
      amountGet: ethers.utils.parseUnits(String(5 * i), cgdDecimals),
      tokenGive: mETH.address,
      amountGive: ethers.utils.parseUnits(String(1 * i), mEthDecimals),
      label: `OPEN-BUY-${i}`,
      txOpts
    })
    await wait(1)
  }

  console.log('\n✅ Base Sepolia seeding complete.\n')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n[SEED ERROR]', prettyErr(err))
    process.exit(1)
  })
