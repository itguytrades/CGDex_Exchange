// scripts/deploy_baseSepolia.js
// Run:
// npx hardhat run --network baseSepolia scripts/deploy_baseSepolia.js

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { NonceManager } = require("@ethersproject/experimental");

function keccak(code) {
  return hre.ethers.utils.keccak256(code);
}

async function getCodeHash(address) {
  const code = await hre.ethers.provider.getCode(address);
  return { codeLen: code.length, codeHash: keccak(code) };
}

function loadConfig() {
  const configPath = path.join(__dirname, "..", "src", "config.json");
  const raw = fs.readFileSync(configPath, "utf8");
  return { configPath, json: JSON.parse(raw) };
}

function saveConfig(configPath, json) {
  fs.writeFileSync(configPath, JSON.stringify(json, null, 2));
}

async function main() {
  const { ethers, network } = hre;

  console.log(`\nPreparing deployment on network: ${network.name}\n`);

  const signers = await ethers.getSigners();
  if (!signers.length) {
    throw new Error("No signer found. Check PRIVATE_KEY_BASE in .env + hardhat.config.js");
  }

  const deployerRaw = signers[0];
  const deployerAddr = await deployerRaw.getAddress();
  const deployer = new NonceManager(deployerRaw);

  console.log(`Deployer: ${deployerAddr}`);

  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  if (chainId !== 84532) {
    throw new Error(`Wrong network/chainId. Expected 84532 (Base Sepolia), got ${chainId}`);
  }

  // nonce state (debuggable)
  const nonceLatest = await ethers.provider.getTransactionCount(deployerAddr, "latest");
  const noncePending = await ethers.provider.getTransactionCount(deployerAddr, "pending");
  console.log(`Nonce latest: ${nonceLatest} | pending: ${noncePending}\n`);

  const feeAccount = process.env.FEE_ACCOUNT || deployerAddr;
  const feePercent = 10;

  // fee data + bump (40% bump tends to behave better on testnets)
  const feeData = await ethers.provider.getFeeData();

  const bump = (bn, num = 14, den = 10) => (bn ? bn.mul(num).div(den) : bn);

  let maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || ethers.utils.parseUnits("0.05", "gwei");
  let maxFeePerGas = feeData.maxFeePerGas || ethers.utils.parseUnits("0.5", "gwei");

  maxPriorityFeePerGas = bump(maxPriorityFeePerGas);
  maxFeePerGas = bump(maxFeePerGas);

  const overrides = { maxFeePerGas, maxPriorityFeePerGas };

  console.log("Fee overrides:", {
    maxFeePerGas: maxFeePerGas.toString(),
    maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
  });
  console.log("");

  const Token = await ethers.getContractFactory("Token", deployer);
  const Exchange = await ethers.getContractFactory("Exchange", deployer);

  // Deploy
  const cgd = await Token.deploy("CGDev Token", "CGD", "1000000", overrides);
  await cgd.deployed();
  console.log(`CGD deployed:     ${cgd.address}`);

  const mETH = await Token.deploy("mETH", "mETH", "1000000", overrides);
  await mETH.deployed();
  console.log(`mETH deployed:    ${mETH.address}`);

  const mDAI = await Token.deploy("mDAI", "mDAI", "1000000", overrides);
  await mDAI.deployed();
  console.log(`mDAI deployed:    ${mDAI.address}`);

  const exchange = await Exchange.deploy(feeAccount, feePercent, overrides);
  await exchange.deployed();
  console.log(`Exchange deployed:${exchange.address}\n`);

  // Code hashes (so you can compare vs localhost)
  const cgdHash = await getCodeHash(cgd.address);
  const mEthHash = await getCodeHash(mETH.address);
  const mDaiHash = await getCodeHash(mDAI.address);
  const exHash = await getCodeHash(exchange.address);

  console.log("Bytecode hashes:");
  console.log("  CGD:      ", cgdHash);
  console.log("  mETH:     ", mEthHash);
  console.log("  mDAI:     ", mDaiHash);
  console.log("  Exchange: ", exHash);
  console.log("");

  // Write to src/config.json
  const { configPath, json } = loadConfig();

  // Keep your existing shape
  json[chainId] = {
    exchange: { address: exchange.address },
    CGD: { address: cgd.address },
    mETH: { address: mETH.address },
    mDAI: { address: mDAI.address },
    explorerUrl: "https://sepolia.basescan.org", // use in UI
    // Optional: store code hashes to prevent mismatches later
    codeHash: {
      exchange: exHash.codeHash,
      CGD: cgdHash.codeHash,
      mETH: mEthHash.codeHash,
      mDAI: mDaiHash.codeHash,
    },
  };

  saveConfig(configPath, json);

  console.log(`✅ Updated ${configPath} for chainId ${chainId}`);
  console.log(`FeeAccount: ${feeAccount} | FeePercent: ${feePercent}%\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n[DEPLOY ERROR]", err);
    process.exit(1);
  });
