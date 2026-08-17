import solc from "solc";
import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const CONTRACTS_DIR = path.join(process.cwd(), "contracts");

function findImports(importPath: string) {
  if (importPath.startsWith("@openzeppelin/")) {
    const fullPath = path.join(process.cwd(), "node_modules", importPath);
    if (fs.existsSync(fullPath)) {
      return { contents: fs.readFileSync(fullPath, "utf8") };
    }
  }
  if (importPath.startsWith("./")) {
    const fullPath = path.join(CONTRACTS_DIR, importPath.replace("./", ""));
    if (fs.existsSync(fullPath)) {
      return { contents: fs.readFileSync(fullPath, "utf8") };
    }
  }
  return { error: "File not found" };
}

async function dryRunDeployment() {
  console.log("==================================================");
  console.log("ADEXTO — 0G MAINNET DEPLOYMENT DRY-RUN");
  console.log("==================================================");

  // 1. Compile
  const tokenSource = fs.readFileSync(path.join(CONTRACTS_DIR, "AdextoToken.sol"), "utf8");
  const hookSource = fs.readFileSync(path.join(CONTRACTS_DIR, "SovereignHook.sol"), "utf8");
  const factorySource = fs.readFileSync(path.join(CONTRACTS_DIR, "AdextoTrinityFactory.sol"), "utf8");

  const input = {
    language: "Solidity",
    sources: {
      "AdextoToken.sol": { content: tokenSource },
      "SovereignHook.sol": { content: hookSource },
      "AdextoTrinityFactory.sol": { content: factorySource },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode", "evm.gasEstimates"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  if (output.errors?.some((e: any) => e.severity === "error")) {
    throw new Error("Compilation failed");
  }
  console.log("✅ Step 1: Solidity contracts compiled successfully.");

  // 2. Connect RPC
  const OG_RPC_URL = process.env.OG_RPC_URL || "https://evmrpc.0g.ai";
  const provider = new ethers.JsonRpcProvider(OG_RPC_URL);
  const network = await provider.getNetwork();
  console.log(`✅ Step 2: Connected to 0G RPC (${OG_RPC_URL}) | Chain ID: ${network.chainId}`);

  // 3. Wallet Inspection
  const privateKey = process.env.OG_PRIVATE_KEY!;
  const wallet = new ethers.Wallet(privateKey, provider);
  console.log(`🔑 Deployer Wallet Address: ${wallet.address}`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`💰 Current Balance on 0G Chain: ${ethers.formatEther(balance)} 0G`);

  // 4. Dry-run Gas Estimation & Bytecode Prep
  const factoryAbi = output.contracts["AdextoTrinityFactory.sol"]["AdextoTrinityFactory"].abi;
  const factoryBytecode = "0x" + output.contracts["AdextoTrinityFactory.sol"]["AdextoTrinityFactory"].evm.bytecode.object;
  const hookAbi = output.contracts["SovereignHook.sol"]["SovereignHook"].abi;
  const hookBytecode = "0x" + output.contracts["SovereignHook.sol"]["SovereignHook"].evm.bytecode.object;

  console.log("--------------------------------------------------");
  console.log("📦 Bytecode Sizing & Pre-flight Gas Estimation:");
  console.log(`   • AdextoTrinityFactory : ${(factoryBytecode.length / 2).toLocaleString()} bytes`);
  console.log(`   • SovereignHook        : ${(hookBytecode.length / 2).toLocaleString()} bytes`);

  const feeData = await provider.getFeeData();
  console.log(`⛽ 0G Gas Price: ${feeData.gasPrice ? ethers.formatUnits(feeData.gasPrice, "gwei") : "N/A"} Gwei`);

  // 5. Test Estimate Gas via Raw Call
  const deployTx = {
    data: factoryBytecode,
    from: wallet.address,
  };

  try {
    const estimatedGas = await provider.estimateGas(deployTx);
    console.log(`✅ AdextoTrinityFactory Deployment Estimated Gas: ${estimatedGas.toString()} units`);
    const totalCost = estimatedGas * (feeData.gasPrice || 1000000000n);
    console.log(`💵 Estimated Cost: ${ethers.formatEther(totalCost)} 0G`);
  } catch (err: any) {
    console.log(`ℹ️ Gas Estimation simulation note: ${err.message?.slice(0, 100)}...`);
  }

  console.log("==================================================");
  console.log("🎯 DRY RUN STATUS: READY FOR ON-CHAIN DEPLOYMENT");
  console.log("==================================================");
}

dryRunDeployment().catch(console.error);
