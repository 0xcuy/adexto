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

function compileContracts() {
  console.log("--------------------------------------------------");
  console.log("1. Compiling SovereignHook & AdextoToken contracts...");
  console.log("--------------------------------------------------");

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
          "*": ["abi", "evm.bytecode"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

  if (output.errors) {
    let hasError = false;
    output.errors.forEach((err: any) => {
      if (err.severity === "error") {
        console.error("Solidity Error:", err.formattedMessage);
        hasError = true;
      } else {
        console.warn("Solidity Warning:", err.formattedMessage);
      }
    });
    if (hasError) throw new Error("Compilation failed");
  }

  console.log("✅ Compilation Successful!");
  return output.contracts;
}

async function deployContracts() {
  const contracts = compileContracts();

  const OG_RPC_URL = process.env.OG_RPC_URL || "https://evmrpc.0g.ai";
  const PRIVATE_KEY = process.env.OG_PRIVATE_KEY || process.env.PRIVATE_KEY;

  console.log("--------------------------------------------------");
  console.log("2. Deploying to 0G Mainnet (Chain ID 16661)...");
  console.log("--------------------------------------------------");
  console.log(`📡 RPC Endpoint: ${OG_RPC_URL}`);

  if (!PRIVATE_KEY) {
    console.log("⚠️ OG_PRIVATE_KEY not found in .env.local.");
    console.log("ℹ️ Bytecode & ABI successfully compiled and verified ready for deployment when key is provided.");
    return;
  }

  const provider = new ethers.JsonRpcProvider(OG_RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  console.log(`🔑 Deployer: ${wallet.address}`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} A0GI / 0G`);

  // Deploy SovereignHook
  const hookAbi = contracts["SovereignHook.sol"]["SovereignHook"].abi;
  const hookBytecode = contracts["SovereignHook.sol"]["SovereignHook"].evm.bytecode.object;

  const HookFactory = new ethers.ContractFactory(hookAbi, hookBytecode, wallet);
  console.log("🚀 Broadcasting SovereignHook.sol...");
  const hookContract = await HookFactory.deploy(
    wallet.address, // factory placeholder
    wallet.address, // agent treasury
    wallet.address  // token target
  );
  await hookContract.waitForDeployment();
  const hookAddress = await hookContract.getAddress();
  console.log(`✅ SovereignHook Deployed to: ${hookAddress}`);

  // Deploy TrinityFactory
  const factoryAbi = contracts["AdextoTrinityFactory.sol"]["AdextoTrinityFactory"].abi;
  const factoryBytecode = contracts["AdextoTrinityFactory.sol"]["AdextoTrinityFactory"].evm.bytecode.object;
  const TrinityFactory = new ethers.ContractFactory(factoryAbi, factoryBytecode, wallet);
  console.log("🚀 Broadcasting AdextoTrinityFactory.sol...");
  const factoryContract = await TrinityFactory.deploy();
  await factoryContract.waitForDeployment();
  const factoryAddress = await factoryContract.getAddress();
  console.log(`✅ AdextoTrinityFactory Deployed to: ${factoryAddress}`);

  console.log("--------------------------------------------------");
  console.log("Deployment Complete!");
}

deployContracts().catch(console.error);
