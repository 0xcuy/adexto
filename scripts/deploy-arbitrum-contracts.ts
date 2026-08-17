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
  console.log("1. Compiling Smart Contracts for Arbitrum One...");
  console.log("--------------------------------------------------");

  const sources: Record<string, { content: string }> = {
    "AdextoToken.sol": { content: fs.readFileSync(path.join(CONTRACTS_DIR, "AdextoToken.sol"), "utf8") },
    "SovereignHook.sol": { content: fs.readFileSync(path.join(CONTRACTS_DIR, "SovereignHook.sol"), "utf8") },
    "AdextoTrinityFactory.sol": { content: fs.readFileSync(path.join(CONTRACTS_DIR, "AdextoTrinityFactory.sol"), "utf8") },
    "AdextoGovernor.sol": { content: fs.readFileSync(path.join(CONTRACTS_DIR, "AdextoGovernor.sol"), "utf8") },
    "AdextoCCIPReceiver.sol": { content: fs.readFileSync(path.join(CONTRACTS_DIR, "AdextoCCIPReceiver.sol"), "utf8") },
  };

  const input = {
    language: "Solidity",
    sources,
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
  if (output.errors?.some((e: any) => e.severity === "error")) {
    console.error("Compilation error:", output.errors);
    throw new Error("Compilation failed");
  }

  console.log("✅ All Contracts compiled successfully.");
  return output.contracts;
}

async function deployArbitrum() {
  const contracts = compileContracts();

  const ARB_RPC = "https://arb1.arbitrum.io/rpc";
  const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.OG_PRIVATE_KEY!;

  const provider = new ethers.JsonRpcProvider(ARB_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log("--------------------------------------------------");
  console.log("2. Broadcasting to Arbitrum One (Chain ID 42161)...");
  console.log("--------------------------------------------------");
  console.log(`🔑 Deployer: ${wallet.address}`);
  const balance = await provider.getBalance(wallet.address);
  console.log(`💰 Balance on Arbitrum: ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    throw new Error("Zero balance on Arbitrum");
  }

  // 1. Deploy SovereignHook
  const hookAbi = contracts["SovereignHook.sol"]["SovereignHook"].abi;
  const hookBytecode = "0x" + contracts["SovereignHook.sol"]["SovereignHook"].evm.bytecode.object;
  const HookFactory = new ethers.ContractFactory(hookAbi, hookBytecode, wallet);

  console.log("🚀 Deploying SovereignHook.sol...");
  const hook = await HookFactory.deploy(
    wallet.address, // factory placeholder
    wallet.address, // agent treasury
    wallet.address  // token target
  );
  await hook.waitForDeployment();
  const hookAddress = await hook.getAddress();
  console.log(`✅ SovereignHook on Arbitrum: ${hookAddress}`);

  // 2. Deploy AdextoTrinityFactory
  const factoryAbi = contracts["AdextoTrinityFactory.sol"]["AdextoTrinityFactory"].abi;
  const factoryBytecode = "0x" + contracts["AdextoTrinityFactory.sol"]["AdextoTrinityFactory"].evm.bytecode.object;
  const Factory = new ethers.ContractFactory(factoryAbi, factoryBytecode, wallet);

  console.log("🚀 Deploying AdextoTrinityFactory.sol...");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log(`✅ AdextoTrinityFactory on Arbitrum: ${factoryAddress}`);

  // 3. Deploy AdextoGovernor
  const govAbi = contracts["AdextoGovernor.sol"]["AdextoGovernor"].abi;
  const govBytecode = "0x" + contracts["AdextoGovernor.sol"]["AdextoGovernor"].evm.bytecode.object;
  const GovFactory = new ethers.ContractFactory(govAbi, govBytecode, wallet);

  console.log("🚀 Deploying AdextoGovernor.sol...");
  const gov = await GovFactory.deploy(hookAddress);
  await gov.waitForDeployment();
  const govAddress = await gov.getAddress();
  console.log(`✅ AdextoGovernor on Arbitrum: ${govAddress}`);

  // 4. Deploy AdextoCCIPReceiver
  const ccipAbi = contracts["AdextoCCIPReceiver.sol"]["AdextoCCIPReceiver"].abi;
  const ccipBytecode = "0x" + contracts["AdextoCCIPReceiver.sol"]["AdextoCCIPReceiver"].evm.bytecode.object;
  const CCIPFactory = new ethers.ContractFactory(ccipAbi, ccipBytecode, wallet);

  console.log("🚀 Deploying AdextoCCIPReceiver.sol...");
  // Arbitrum One Official CCIP Router: 0x141f05786fFb2F4787255078633F626453071522
  const ccipRouterAddress = ethers.getAddress("0x141f05786ffb2f4787255078633f626453071522");
  const ccip = await CCIPFactory.deploy(
    ccipRouterAddress,
    hookAddress
  );
  await ccip.waitForDeployment();
  const ccipAddress = await ccip.getAddress();
  console.log(`✅ AdextoCCIPReceiver on Arbitrum: ${ccipAddress}`);

  console.log("==================================================");
  console.log("ARBITRUM ONE DEPLOYMENT COMPLETE!");
  console.log("==================================================");
  console.log("Factory       :", factoryAddress);
  console.log("SovereignHook :", hookAddress);
  console.log("Governor      :", govAddress);
  console.log("CCIPReceiver  :", ccipAddress);
}

deployArbitrum().catch(console.error);
