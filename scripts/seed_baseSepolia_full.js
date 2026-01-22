// scripts/seed_baseSepolia_full.js
// Run:
// npx hardhat run --network baseSepolia scripts/seed_baseSepolia_full.js

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

async function approveMax({ token, tokenLabel, owner, ownerAddr, spenderAddr, decimals, txOpts }) {
  const current = await token.allowance(ownerAddr, spenderAddr);

  if (current.gt(0)) {
    console.log(`[${tokenLabel}] allowance already set, skipping approve.`);
    return;
  }

  // preflight approve
  await token.connect(owner).callStatic.approve(spenderAddr, ethers.constants.MaxUint256);

  const tx = await token.connect(owner).approve(spenderAddr, ethers.constants.MaxUint256, txOpts);
  await tx.wait(2); // confirmations help on public RPCs

  const after = await token.allowance(ownerAddr, spenderAddr);
  if (after.isZero()) {
    throw new Error(`[${tokenLabel}] approve mined but allowance stayed 0 (token non-standard or RPC issue).`);
  }
}

function parseDepositEvent(exchange, receipt, exchangeAddr) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== exchangeAddr.toLowerCase()) continue;
    try {
      const parsed = exchange.interface.parseLog(log);
      if (parsed.name === "Deposit") {
        return parsed.args; // { token, user, amount, balance }
      }
    } catch (_) {}
  }
  return null;
}

async function safeRead(label, fn) {
  try {
    return await fn();
  } catch (e) {
    console.log(`[WARN] ${label} read failed (RPC limitation). Continuing. -> ${prettyErr(e)}`);
    return null;
  }
}

async function ensureDeposit({
  token,
  tokenLabel,
  exchange,
  exchangeAddr,
  user,
  userAddr,
  amount,
  decimals,
  txOpts,
  minExchangeBalance, // optional guard
}) {
  console.log(`\n=== Ensure Deposit ${tokenLabel} (${userAddr}) ===`);

  // Guard: if already funded >= minExchangeBalance, skip
  if (minExchangeBalance) {
    const current = await safeRead(
      `${tokenLabel} exchange.balanceOf(latest)`,
      () => exchange.balanceOf(token.address, userAddr)
    );

    if (current && current.gte(minExchangeBalance)) {
      console.log(
        `[${tokenLabel}] already funded: ${ethers.utils.formatUnits(current, decimals)} >= ${ethers.utils.formatUnits(
          minExchangeBalance,
          decimals
        )} (skipping deposit)`
      );
      return;
    }
  }

  // Basic prints (best effort)
  const walletBal = await safeRead(`${tokenLabel} wallet balance`, () => token.balanceOf(userAddr));
  if (walletBal) {
    console.log(`[${tokenLabel}] wallet: ${ethers.utils.formatUnits(walletBal, decimals)} (${walletBal.toString()})`);
  }

  await approveMax({ token, tokenLabel, owner: user, ownerAddr: userAddr, spenderAddr: exchangeAddr, decimals, txOpts });

  // Preflight deposit (if this reverts, it’s real)
  await exchange.connect(user).callStatic.depositToken(token.address, amount);

  console.log(`[${tokenLabel}] depositing ${ethers.utils.formatUnits(amount, decimals)}...`);
  const tx = await exchange.connect(user).depositToken(token.address, amount, txOpts);
  console.log(`[${tokenLabel}] tx: ${tx.hash}`);

  const receipt = await tx.wait(2);
  if (receipt.status !== 1) throw new Error(`[${tokenLabel}] deposit tx reverted (status=0)`);

  const dep = parseDepositEvent(exchange, receipt, exchangeAddr);
  if (!dep) throw new Error(`[${tokenLabel}] deposit tx succeeded but Deposit event not found (wrong ABI/address?)`);

  console.log(`[${tokenLabel}] ✅ Deposit event confirms new exchange balance: ${ethers.utils.formatUnits(dep.balance, decimals)} (${dep.balance.toString()})`);

  // Post-reads are informational only (don’t fail due to RPC lag)
  const afterInternal = await safeRead(
    `${tokenLabel} exchange.balanceOf(latest)`,
    () => exchange.balanceOf(token.address, userAddr)
  );
  if (afterInternal) {
    console.log(`[${tokenLabel}] exchange.balanceOf(latest): ${ethers.utils.formatUnits(afterInternal, decimals)} (${afterInternal.toString()})`);
  }
}

async function main() {
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  console.log(`\nSeeding Base Sepolia — chainId: ${chainId}\n`);
  if (chainId !== 84532) throw new Error(`Wrong network. Expected 84532, got ${chainId}`);

  const signersRaw = await ethers.getSigners();
  if (signersRaw.length < 2) {
    throw new Error("Need PRIVATE_KEY_BASE + PRIVATE_KEY_BASE_2 in hardhat.config.js accounts.");
  }

  const user1Addr = await signersRaw[0].getAddress();
  const user2Addr = await signersRaw[1].getAddress();

  const user1 = new NonceManager(signersRaw[0]);
  const user2 = new NonceManager(signersRaw[1]);

  console.log(`User1 (maker):  ${user1Addr}`);
  console.log(`User2 (filler): ${user2Addr}\n`);

  const chainCfg = config?.[chainId];
  if (!chainCfg?.CGD?.address || !chainCfg?.mETH?.address || !chainCfg?.exchange?.address) {
    throw new Error(`Missing addresses in src/config.json for chainId ${chainId}`);
  }

  const CGD = await ethers.getContractAt("Token", chainCfg.CGD.address);
  const mETH = await ethers.getContractAt("Token", chainCfg.mETH.address);
  const mDAI = chainCfg.mDAI?.address ? await ethers.getContractAt("Token", chainCfg.mDAI.address) : null;
  const exchange = await ethers.getContractAt("Exchange", chainCfg.exchange.address);

  await assertDeployed(CGD.address, "CGD");
  await assertDeployed(mETH.address, "mETH");
  if (mDAI) await assertDeployed(mDAI.address, "mDAI");
  await assertDeployed(exchange.address, "Exchange");

  console.log(`CGD:      ${CGD.address}`);
  console.log(`mETH:     ${mETH.address}`);
  if (mDAI) console.log(`mDAI:     ${mDAI.address}`);
  console.log(`Exchange: ${exchange.address}\n`);

  const [cgdDecimals, mEthDecimals] = await Promise.all([CGD.decimals(), mETH.decimals()]);
  const txOpts = await getEip1559Overrides(ethers.provider);

  console.log("Using fee overrides:", {
    maxFeePerGas: txOpts.maxFeePerGas.toString(),
    maxPriorityFeePerGas: txOpts.maxPriorityFeePerGas.toString(),
  });
  console.log("");

  // Fund user2 with some mETH so it can deposit / fill orders
  const fundmETH = ethers.utils.parseUnits("2000", mEthDecimals);
  console.log(`Funding user2 with ${ethers.utils.formatUnits(fundmETH, mEthDecimals)} mETH...`);
  await (await mETH.connect(user1).transfer(user2Addr, fundmETH, txOpts)).wait(2);
  console.log("Funding complete.\n");
  await wait(2);

  // Target deposits
  const depositCGD = ethers.utils.parseUnits("1000", cgdDecimals);
  const depositmETH = ethers.utils.parseUnits("1000", mEthDecimals);

  // Guards to avoid endlessly stacking deposits every run
  const targetCGD = ethers.utils.parseUnits("5000", cgdDecimals);
  const targetmETH = ethers.utils.parseUnits("5000", mEthDecimals);

  await ensureDeposit({
    token: CGD,
    tokenLabel: "CGD",
    exchange,
    exchangeAddr: exchange.address,
    user: user1,
    userAddr: user1Addr,
    amount: depositCGD,
    decimals: cgdDecimals,
    txOpts,
    minExchangeBalance: targetCGD,
  });

  await wait(2);

  await ensureDeposit({
    token: mETH,
    tokenLabel: "mETH",
    exchange,
    exchangeAddr: exchange.address,
    user: user2,
    userAddr: user2Addr,
    amount: depositmETH,
    decimals: mEthDecimals,
    txOpts,
    minExchangeBalance: targetmETH,
  });

  console.log("\n✅ Deposits confirmed via events. Stopping here (stable baseline).\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n[SEED ERROR]", prettyErr(err));
    process.exit(1);
  });
