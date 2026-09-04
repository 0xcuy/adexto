import { createPublicClient, createWalletClient, http, parseEther, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const chainOgMainnet = {
  id: 16661,
  name: "0G Mainnet",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.OG_RPC_URL || "https://evmrpc.0g.ai"] },
  },
};

const chainOgTestnet = {
  id: 16602,
  name: "0G Galileo Testnet",
  nativeCurrency: { name: "A0GI", symbol: "A0GI", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.OG_TESTNET_RPC_URL || "https://evmrpc-testnet.0g.ai"] },
  },
};

async function testDeployerLocal() {
  console.log("==================================================");
  console.log("ADEXTO 1-Click Engine — Local Simulator & Test");
  console.log("==================================================");
  
  const rawKey = process.env.OG_PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const account = privateKeyToAccount(rawKey.startsWith("0x") ? rawKey as `0x${string}` : `0x${rawKey}` as `0x${string}`);
  
  console.log(`🔑 Deployer Account : ${account.address}`);
  console.log(`📡 0G Router Key     : ${process.env.OG_ROUTER_API_KEY ? "CONFIGURED" : "MISSING"}`);
  console.log(`⚡ 0G AI Model       : ${process.env.OG_MODEL || "glm-5.3"}`);
  console.log(`🌐 0G Mainnet Chain  : 16661 (evmrpc.0g.ai)`);
  console.log("--------------------------------------------------");
  console.log("Simulating atomic Trinity deployment batch...");
  
  const sampleToken = {
    name: "Aegis Sentinel AI",
    symbol: "AEGIS",
    supply: "1000000000",
    swapFee: "0.30%",
    treasuryShare: "0.10%",
    teeAttestation: keccak256(toHex("0G_AMD_SEV_SNP_HARDWARE_ATTESTATION")),
  };

  console.log("✅ Token (ERC-8004)    :", sampleToken.name, `(${sampleToken.symbol})`);
  console.log("✅ Sovereign Hook Pool :", `${sampleToken.swapFee} swap / ${sampleToken.treasuryShare} treasury`);
  console.log("✅ 0G TEE Enclave Root :", sampleToken.teeAttestation);
  console.log("==================================================");
  console.log("Status: READY FOR LOCAL DEMO & VIDEO RECORDING.");
}

testDeployerLocal().catch(console.error);
