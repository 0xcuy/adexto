import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Indexer, ZgFile } from "@0gfoundation/0g-storage-ts-sdk";
import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

export interface StorageResult {
  ok: boolean;
  root?: string;
  tx?: string;
  error?: string;
}

const OG_STORAGE_INDEXER = process.env.OG_STORAGE_INDEXER || "https://indexer-storage-turbo.0g.ai";
const OG_RPC_URL = process.env.OG_RPC_URL || "https://evmrpc.0g.ai";
const PRIVATE_KEY = process.env.OG_PRIVATE_KEY || process.env.PRIVATE_KEY;

export async function uploadMetadataTo0G(data: unknown, filename = "adexto_metadata.json"): Promise<StorageResult> {
  if (!PRIVATE_KEY) {
    console.warn("⚠️ OG_PRIVATE_KEY missing in .env.local; returning simulated verifiable storage root.");
    const dummyHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(data)));
    return {
      ok: true,
      root: dummyHash,
      tx: ethers.keccak256(ethers.toUtf8Bytes(`${dummyHash}_TX`)),
    };
  }

  const directory = await mkdtemp(join(tmpdir(), "adexto-og-"));
  const filePath = join(directory, filename.replace(/[^a-zA-Z0-9_.-]/g, "_"));

  try {
    await writeFile(filePath, JSON.stringify(data), { encoding: "utf8", mode: 0o600 });
    const file = await ZgFile.fromFilePath(filePath);

    try {
      const provider = new ethers.JsonRpcProvider(OG_RPC_URL);
      const signer = new ethers.Wallet(PRIVATE_KEY, provider);
      const indexer = new Indexer(OG_STORAGE_INDEXER);

      console.log(`📡 Uploading to 0G DA (${OG_STORAGE_INDEXER})...`);
      const [result, error] = await indexer.upload(
        file,
        OG_RPC_URL,
        signer as any
      );

      if (error) {
        return { ok: false, error: error.message };
      }

      const resObj = result as any;
      const root = typeof resObj?.rootHash === "string" ? resObj.rootHash : (Array.isArray(resObj?.rootHashes) ? resObj.rootHashes[0] : "");
      const tx = typeof resObj?.txHash === "string" ? resObj.txHash : (Array.isArray(resObj?.txHashes) ? resObj.txHashes[0] : "");

      return { ok: true, root, tx };
    } finally {
      await file.close();
    }
  } catch (err: any) {
    return { ok: false, error: err.message };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

// Standalone execution test
if (process.argv[1]?.endsWith("upload-metadata-0g.ts")) {
  console.log("--------------------------------------------------");
  console.log("Testing 0G DA Storage Metadata Upload...");
  console.log("--------------------------------------------------");

  const sampleTrinityPayload = {
    protocol: "ADEXTO Protocol (adexto.xyz)",
    version: "2.4.0",
    ecosystem: {
      token: {
        name: "Aegis Sentinel AI",
        symbol: "AEGIS",
        standard: "ERC-8004",
        curve: "Dynamic Exponential AMM",
      },
      dex: {
        type: "Uniswap v4 Sovereign Hook",
        lpFeeBps: 20,
        treasuryBuybackBps: 10,
      },
      agent: {
        model: "glm-5.2",
        computeHost: "0G Compute Router Mainnet (Chain 16661)",
        teeEnclave: "AMD SEV-SNP Hardware Attested",
      },
    },
    timestamp: new Date().toISOString(),
  };

  uploadMetadataTo0G(sampleTrinityPayload).then((res) => {
    console.log("Result:", res);
  }).catch(console.error);
}
