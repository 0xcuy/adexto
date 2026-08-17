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

async function deployPhase2Contracts() {
  console.log("==================================================");
  console.log("ADEXTO PHASE 2 — DEPLOYING GOVERNANCE & CCIP MESH");
  console.log("==================================================");

  // 1. Compile Phase 2 Contracts
  const sources: Record<string, { content: string }> = {
    "AdextoToken.sol": { content: fs.readFileSync(path.join(CONTRACTS_DIR, "AdextoToken.sol"), "utf8") },
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
    console.error(output.errors);
    throw new Error("Compilation failed");
  }

  console.log("✅ AdextoGovernor.sol & AdextoCCIPReceiver.sol compiled successfully.");

  // 2. Deploy to 0G Mainnet
  const OG_RPC_URL = process.env.OG_RPC_URL || "https://evmrpc.0g.ai";
  const PRIVATE_KEY = process.env.OG_PRIVATE_KEY!;
  const provider = new ethers.JsonRpcProvider(OG_RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`📡 RPC: ${OG_RPC_URL}`);
  console.log(`🔑 Deployer: ${wallet.address}`);
  const balance = await provider.getBalance(wallet.address);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} 0G`);

  // Deploy AdextoGovernor
  const govAbi = output.contracts["AdextoGovernor.sol"]["AdextoGovernor"].abi;
  const govBytecode = "0x" + output.contracts["AdextoGovernor.sol"]["AdextoGovernor"].evm.bytecode.object;
  const GovFactory = new ethers.ContractFactory(govAbi, govBytecode, wallet);

  console.log("🚀 Broadcasting AdextoGovernor.sol to 0G Mainnet...");
  const govContract = await GovFactory.deploy("0x592c697aD1Fa712c6701C90991B96264aB2E98d8"); // token hook binding
  await govContract.waitForDeployment();
  const govAddress = await govContract.getAddress();
  console.log(`✅ AdextoGovernor Deployed to: ${govAddress}`);

  // Deploy AdextoCCIPReceiver
  const ccipAbi = output.contracts["AdextoCCIPReceiver.sol"]["AdextoCCIPReceiver"].abi;
  const ccipBytecode = "0x" + output.contracts["AdextoCCIPReceiver.sol"]["AdextoCCIPReceiver"].evm.bytecode.object;
  const CCIPFactory = new ethers.ContractFactory(ccipAbi, ccipBytecode, wallet);

  console.log("🚀 Broadcasting AdextoCCIPReceiver.sol to 0G Mainnet...");
  const ccipContract = await CCIPFactory.deploy(
    wallet.address, // CCIP Router placeholder on 0G
    "0x592c697aD1Fa712c6701C90991B96264aB2E98d8" // target hook
  );
  await ccipContract.waitForDeployment();
  const ccipAddress = await ccipContract.getAddress();
  console.log(`✅ AdextoCCIPReceiver Deployed to: ${ccipAddress}`);

  console.log("==================================================");
  console.log("PHASE 2 DEPLOYMENT COMPLETE!");
  console.log("==================================================");
}

deployPhase2Contracts().catch(console.error);
