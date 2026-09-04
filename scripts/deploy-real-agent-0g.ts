import { ethers } from "ethers";
import * as dotenv from "dotenv";
import { uploadMetadataTo0G } from "../src/lib/upload-metadata-0g";
import fs from "fs";
import path from "path";
import solc from "solc";

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

async function main() {
  console.log("==================================================");
  console.log("LAUNCHING REAL AI AGENT ON 0G MAINNET (WITH IMAGE & DA)");
  console.log("==================================================");

  const OG_RPC_URL = process.env.OG_RPC_URL || "https://evmrpc.0g.ai";
  const PRIVATE_KEY = process.env.OG_PRIVATE_KEY || process.env.PRIVATE_KEY!;
  // Jangan pernah menaruh kunci asli sebagai fallback di sumber: ia ikut ter-commit
  // dan rotasi env tidak akan mencabutnya.
  const OG_ROUTER_API_KEY = process.env.OG_ROUTER_API_KEY;
  if (!OG_ROUTER_API_KEY) throw new Error("OG_ROUTER_API_KEY belum diset di environment.");

  const provider = new ethers.JsonRpcProvider(OG_RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`🔑 Deployer Wallet: ${wallet.address}`);
  const balance = await provider.getBalance(wallet.address);
  console.log(`💰 Current Balance: ${ethers.formatEther(balance)} 0G`);

  // 1. Generate / Render High-Res AI Logo Emblem
  console.log("\n🎨 Step 1: Generating Agent Logo (0G z-image-turbo / High-Res Emblem)...");
  let logoDataUrl = "";
  try {
    const res = await fetch("https://router-api.0g.ai/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OG_ROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: "z-image-turbo",
        prompt: "Cyberpunk vector emblem for Aegis Sentinel AI token, neon cyan and purple shield icon, dark obsidian background, 8k quality, centered insignia",
        n: 1,
        response_format: "b64_json",
      }),
    });
    if (res.ok) {
      const json = await res.json();
      const b64 = json?.data?.[0]?.b64_json;
      if (b64) {
        logoDataUrl = `data:image/png;base64,${b64}`;
        console.log("   ✅ Successfully rendered logo via 0G Compute (z-image-turbo)!");
      }
    }
  } catch (e) {
    console.log("   ℹ️ 0G router note:", e);
  }

  if (!logoDataUrl) {
    // Elegant fallback SVG
    logoDataUrl = `https://adexto.xyz/logo.svg`;
    console.log("   ✅ Using Official Vector Logo Emblem:", logoDataUrl);
  }

  // 2. Upload Metadata & Image to 0G DA Storage Turbo
  console.log("\n📦 Step 2: Uploading Metadata + Image Emblem to 0G DA Storage Turbo...");
  const agentMetadata = {
    protocol: "ADEXTO Protocol (adexto.xyz)",
    version: "2.4.0",
    name: "Aegis Sentinel AI",
    symbol: "AEGIS",
    decimals: 18,
    totalSupply: "1,000,000,000",
    standard: "ERC-8004 (Agent Identity Bound)",
    image: logoDataUrl,
    creator: wallet.address,
    chain: "0G Mainnet (Chain ID 16661)",
    dex: {
      hook: "0x592c697aD1Fa712c6701C90991B96264aB2E98d8",
      feeSplit: "0.20% LP / 0.10% Buyback",
      subdomain: "https://aegis.adexto.xyz",
    },
    enclave: {
      model: "glm-5.3",
      host: "pc.0g.ai/v1",
      // Vendor TEE yang benar menurut router: Intel TDX lewat dstack. Ini masuk
      // ke metadata yang ditambatkan ke 0G DA, jadi salahnya permanen.
      attestation: "Intel TDX via dstack (router-reported)",
      signer: wallet.address,
    },
    createdAt: new Date().toISOString(),
  };

  const daResult = await uploadMetadataTo0G(agentMetadata, "aegis_sentinel_0g_metadata.json");
  console.log(`   ✅ 0G DA Merkle Root: ${daResult.root}`);
  console.log(`   ✅ 0G DA Tx Hash    : ${daResult.tx}`);

  // 3. Compile Factory
  console.log("\n⚙️ Step 3: Compiling Contract ABI & Bytecode...");
  const tokenSource = fs.readFileSync(path.join(CONTRACTS_DIR, "AdextoToken.sol"), "utf8");
  const factorySource = fs.readFileSync(path.join(CONTRACTS_DIR, "AdextoTrinityFactory.sol"), "utf8");

  const input = {
    language: "Solidity",
    sources: {
      "AdextoToken.sol": { content: tokenSource },
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
  const factoryAbi = output.contracts["AdextoTrinityFactory.sol"]["AdextoTrinityFactory"].abi;

  // 4. Execute Real On-Chain Trinity Deployment on 0G Mainnet
  const factoryAddress = "0xe8E9Cf43f88D065892c35c4aDa002C7B8b11F3e0";
  console.log(`\n🚀 Step 4: Broadcasting Trinity Deployment to 0G Factory (${factoryAddress})...`);
  
  const factory = new ethers.Contract(factoryAddress, factoryAbi, wallet);
  
  const teeBytes32 = daResult.root ? ethers.getBytes(daResult.root) : ethers.keccak256(ethers.toUtf8Bytes("AEGIS_0G_TEE_AGENT"));

  const tx = await factory.deployTrinityProject(
    "Aegis Sentinel AI",
    "AEGIS",
    ethers.parseEther("1000000000"), // 1B tokens
    wallet.address, // agent identity
    30, // 0.30% fee
    10, // 0.10% buyback
    teeBytes32
  );

  console.log(`   ⏳ Tx Submitted! Hash: ${tx.hash}`);
  console.log("   Waiting for confirmation on 0G Mainnet block...");
  const receipt = await tx.wait();
  console.log(`   ✅ Confirmed in Block #${receipt.blockNumber}! Gas Used: ${receipt.gasUsed.toString()}`);

  // Retrieve TrinityProjectCreated event
  const iface = new ethers.Interface(factoryAbi);
  let deployedTokenAddress = "";
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === "TrinityProjectCreated") {
        deployedTokenAddress = parsed.args[0];
        break;
      }
    } catch {}
  }

  console.log("\n==================================================");
  console.log("🎉 REAL 0G MAINNET AGENT LAUNCH COMPLETE!");
  console.log("==================================================");
  console.log("Token Name        : Aegis Sentinel AI");
  console.log("Token Symbol      : $AEGIS");
  console.log("Token Address     :", deployedTokenAddress);
  console.log("Factory Tx Hash   :", receipt.hash);
  console.log("0G DA Storage Root:", daResult.root);
  console.log("0G DA Storage Tx  :", daResult.tx);
  console.log("0G Explorer Link  :", `https://chainscan.0g.ai/tx/${receipt.hash}`);
  console.log("==================================================");

  // Write deployment result to local cache / verified state
  const resultPayload = {
    name: "Aegis Sentinel AI",
    symbol: "AEGIS",
    tokenAddress: deployedTokenAddress,
    factoryTx: receipt.hash,
    daRoot: daResult.root,
    daTx: daResult.tx,
    image: logoDataUrl,
    blockNumber: receipt.blockNumber,
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(process.cwd(), "public", "last_deployed_0g_agent.json"), JSON.stringify(resultPayload, null, 2));
}

main().catch(console.error);
