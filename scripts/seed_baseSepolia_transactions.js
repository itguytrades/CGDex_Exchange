// scripts/seed_baseSepolia_transactions.js
// Run:
// npx hardhat run --network baseSepolia scripts/seed_baseSepolia_transactions.js

const config = require("../src/config.json");
const { NonceManager } = require("@ethersproject/experimental");

const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

function prettyErr(err) {
  return (
    err?.reason ||
    err?.error?.reason ||
    err?.data?.message ||
    err?.error?.message ||
    err?.message ||
    String(err)
  );
}

async function assertDeployed(address, label) {
  const code = await ethers.provider.getCode(address);
  if (!code || code === "0x") throw new Error(`${label} not deployed at ${address} (no bytecode)`);
}

async function getEip1559Overrides(provider) {
  const fee = await provider.getFeeData();
  const bump = (bn, num = 14, den = 10) => (bn ? bn.mul(num).div(den) : bn);

  let maxPriorityFeePerGas = fee.maxPriorityFeePerGas;
  let maxFeePerGas = fee.maxFeePerGas;

  if (!maxPriorityFeePerGas) maxPriorityFeePerGas = ethers.utils.parseUnits("0.05", "gwei");
  if (!maxFeePerGas) maxFeePerGas = ethers.utils.parseUnits("0.5", "gwei");

  return {
    maxPriorityFeePerGas: bump(maxPriorityFeePerGas),
    maxFeePerGas: bump(maxFeePerGas),
  };
}

function parseEvent(exchange, receipt, exchangeAddr, eventName) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== exchangeAddr.toLowerCase()) continue;
    try {
      const parsed = exchange.interface.parseLog(log);
      if (parsed.name === eventName) return parsed.args;
    } catch (_) {}
  }
  return null;
}

async function sendAndConfirm(txPromise, label, exchange, exchangeAddr, expectedEventName) {
  const tx = await txPromise;
  console.log(`[${label}] tx: ${tx.hash}`);
  const receipt = await tx.wait(2);
  if (receipt.status !== 1) throw new Error(`[${label}] tx reverted (status=0)`);

  const args = expectedEventName ? parseEvent(exchange, receipt, exchangeAddr, expectedEventName) : null;
  if (expectedEventName && !args) {
    throw new Error(`[${label}] tx succeeded but missing ${expectedEventName} event`);
  }
  return { receipt, args };
}

async function makeOrderSafe({ exchange, exchangeAddr, user, tokenGet, amountGet, tokenGive, amountGive, label, txOpts }) {
  // Preflight catches real reverts
  await exchange.connect(user).callStatic.makeOrder(tokenGet, amountGet, tokenGive, amountGive);

  const { args } = await sendAndConfirm(
    exchange.connect(user).makeOrder(tokenGet, amountGet, tokenGive, amountGive, txOpts),
    label,
    exchange,
    exchangeAddr,
    "Order"
  );

  // Order event args: (id, user, tokenGet, amountGet, tokenGive, amountGive, timestamp)
  const id = args.id;
  console.log(`[${label}] ✅ Order created id=${id.toString()}`);
  return id;
}

async function cancelOrderSafe({ exchange, exchangeAddr, user, orderId, label, txOpts }) {
  await exchange.connect(user).callStatic.cancelOrder(orderId);

  const { args } = await sendAndConfirm(
    exchange.connect(user).cancelOrder(orderId, txOpts),
    label,
    exchange,
    exchangeAddr,
    "Cancel"
  );

  console.log(`[${label}] ✅ Cancelled id=${args.id.toString()}`);
}

async function fillOrderSafe({ exchange, exchangeAddr, user, orderId, label, txOpts }) {
  await exchange.connect(user).callStatic.fillOrder(orderId);

  const { args } = await sendAndConfirm(
    exchange.connect(user).fillOrder(orderId, txOpts),
    label,
    exchange,
    exchangeAddr,
    "Trade"
  );

  console.log(`[${label}] ✅ Filled -> Trade id=${args.id.toString()}`);
}

async function main() {
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  console.log(`\nSeeding Base Sepolia TRANSACTIONS — chainId: ${chainId}\n`);
  if (chainId !== 84532) throw new Error(`Wrong network. Expected 84532, got ${chainId}`);

  const signersRaw = await ethers.getSigners();
  if (signersRaw.length < 2) {
    throw new Error("Need PRIVATE_KEY_BASE + PRIVATE_KEY_BASE_2 configured and funded with Base Sepolia ETH.");
  }

  const user1Addr = await signersRaw[0].getAddress();
  const user2Addr = await signersRaw[1].getAddress();

  const user1 = new NonceManager(signersRaw[0]); // maker
  const user2 = new NonceManager(signersRaw[1]); // filler

  console.log(`User1 (maker):  ${user1Addr}`);
  console.log(`User2 (filler): ${user2Addr}\n`);

  const chainCfg = config?.[chainId];
  if (!chainCfg?.CGD?.address || !chainCfg?.mETH?.address || !chainCfg?.exchange?.address) {
    throw new Error(`Missing addresses in src/config.json for chainId ${chainId}`);
  }

  const CGD = await ethers.getContractAt("Token", chainCfg.CGD.address);
  const mETH = await ethers.getContractAt("Token", chainCfg.mETH.address);
  const exchange = await ethers.getContractAt("Exchange", chainCfg.exchange.address);

  await assertDeployed(CGD.address, "CGD");
  await assertDeployed(mETH.address, "mETH");
  await assertDeployed(exchange.address, "Exchange");

  console.log(`CGD:      ${CGD.address}`);
  console.log(`mETH:     ${mETH.address}`);
  console.log(`Exchange: ${exchange.address}\n`);

  const [cgdDecimals, mEthDecimals] = await Promise.all([CGD.decimals(), mETH.decimals()]);
  const txOpts = await getEip1559Overrides(ethers.provider);

  console.log("Using fee overrides:", {
    maxFeePerGas: txOpts.maxFeePerGas.toString(),
    maxPriorityFeePerGas: txOpts.maxPriorityFeePerGas.toString(),
  });
  console.log("");

  // IMPORTANT:
  // This script assumes BOTH users already deposited enough tokens into the Exchange.
  // If fillOrder preflight reverts, it’s almost always because the filler lacks tokenGet (+ fee).

  // -----------------------
  // 1) Seed a CANCELLED order
  // user1 wants to GET 25 mETH, gives 50 CGD
  console.log("\n--- Seeding: 1 Cancelled Order ---");
  let orderId = await makeOrderSafe({
    exchange,
    exchangeAddr: exchange.address,
    user: user1,
    tokenGet: mETH.address,
    amountGet: ethers.utils.parseUnits("25", mEthDecimals),
    tokenGive: CGD.address,
    amountGive: ethers.utils.parseUnits("50", cgdDecimals),
    label: "ORDER-CANCEL-1",
    txOpts,
  });

  await wait(1);

  await cancelOrderSafe({
    exchange,
    exchangeAddr: exchange.address,
    user: user1,
    orderId,
    label: "CANCEL-1",
    txOpts,
  });

  await wait(2);

  // -----------------------
  // 2) Seed 2 FILLED trades
  console.log("\n--- Seeding: 2 Filled Trades ---");

  // Trade #1: user1 wants 10 mETH, gives 20 CGD
  orderId = await makeOrderSafe({
    exchange,
    exchangeAddr: exchange.address,
    user: user1,
    tokenGet: mETH.address,
    amountGet: ethers.utils.parseUnits("10", mEthDecimals),
    tokenGive: CGD.address,
    amountGive: ethers.utils.parseUnits("20", cgdDecimals),
    label: "ORDER-FILL-1",
    txOpts,
  });

  await wait(1);

  await fillOrderSafe({
    exchange,
    exchangeAddr: exchange.address,
    user: user2,
    orderId,
    label: "FILL-1",
    txOpts,
  });

  await wait(2);

  // Trade #2: user2 wants 30 CGD, gives 8 mETH
  orderId = await makeOrderSafe({
    exchange,
    exchangeAddr: exchange.address,
    user: user2,
    tokenGet: CGD.address,
    amountGet: ethers.utils.parseUnits("30", cgdDecimals),
    tokenGive: mETH.address,
    amountGive: ethers.utils.parseUnits("8", mEthDecimals),
    label: "ORDER-FILL-2",
    txOpts,
  });

  await wait(1);

  await fillOrderSafe({
    exchange,
    exchangeAddr: exchange.address,
    user: user1,
    orderId,
    label: "FILL-2",
    txOpts,
  });

  await wait(2);

  // -----------------------
  // 3) Seed OPEN orders (order book)
  console.log("\n--- Seeding: Open Orders (3 each side) ---");

  // user1 places 3 "sell mETH" style orders (tokenGet=mETH, tokenGive=CGD)
  for (let i = 1; i <= 3; i++) {
    await makeOrderSafe({
      exchange,
      exchangeAddr: exchange.address,
      user: user1,
      tokenGet: mETH.address,
      amountGet: ethers.utils.parseUnits(String(2 * i), mEthDecimals),
      tokenGive: CGD.address,
      amountGive: ethers.utils.parseUnits(String(5 * i), cgdDecimals),
      label: `OPEN-U1-${i}`,
      txOpts,
    });
    await wait(1);
  }

  // user2 places 3 "buy mETH" style orders (tokenGet=CGD, tokenGive=mETH)
  for (let i = 1; i <= 3; i++) {
    await makeOrderSafe({
      exchange,
      exchangeAddr: exchange.address,
      user: user2,
      tokenGet: CGD.address,
      amountGet: ethers.utils.parseUnits(String(5 * i), cgdDecimals),
      tokenGive: mETH.address,
      amountGive: ethers.utils.parseUnits(String(1 * i), mEthDecimals),
      label: `OPEN-U2-${i}`,
      txOpts,
    });
    await wait(1);
  }

  console.log("\n✅ Transactions seeded (Cancel + Trades + Open Orders).\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n[SEED ERROR]", prettyErr(err));
    process.exit(1);
  });
