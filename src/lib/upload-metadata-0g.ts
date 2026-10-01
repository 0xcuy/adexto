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
  /**
   * FAILS CLOSED. This used to return `ok: true` with `root` set to a keccak hash of
   * the payload and `tx` set to a keccak hash of that hash, logged as a "simulated
   * verifiable storage root". Nothing had been stored and no transaction existed, so
   * a missing key silently produced a fabricated anchor — which the caller then put
   * into launch calldata as `metadataRoot` and the UI reported as anchored.
   *
   * A hash of the content is a legitimate commitment, but it is not a storage root
   * and inventing a `tx` for it is not defensible. The caller now decides what to do
   * with a failure, and it can still commit to the content by hashing it itself.
   */
  if (!PRIVATE_KEY) {
    return { ok: false, error: "OG_PRIVATE_KEY is not configured, so nothing was uploaded to 0G DA." };
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
      /**
       * Dibatasi waktu, dan batasnya di bawah batas proxy.
       *
       * Diukur 2026-10-01 di produksi: SDK mencetak "Waiting for storage node to sync" berulang
       * tanpa batas ketika node storage tertinggal dari chain. `prepare` menunggu bersamanya,
       * Cloudflare memutus permintaan di 100 detik dengan halaman HTML, dan Studio melaporkan
       * "Unexpected token '<'" — peluncuran berhenti padahal tidak ada yang salah dengan
       * pasarnya. Dengan batas ini unggahan yang macet berakhir sebagai `ok: false`, dan
       * pemanggil memakai commitment keccak atas isi metadatanya, yang memang jalur yang sudah
       * ada untuk kegagalan unggah dan dilaporkan sebagai `daStorageOk: false`.
       *
       * Unggahan SDK tidak bisa dibatalkan dari luar, jadi ia boleh selesai di latar; yang
       * dihentikan hanya penantian peluncuran.
       */
      const UPLOAD_TIMEOUT_MS = Number(process.env.OG_DA_UPLOAD_TIMEOUT_MS || 45_000);
      const timedOut = new Promise<[null, Error]>((resolve) =>
        setTimeout(
          () => resolve([null, new Error(`0G DA upload did not finish within ${UPLOAD_TIMEOUT_MS / 1000} s (storage node behind the chain)`)]),
          UPLOAD_TIMEOUT_MS
        )
      );
      const [result, error] = await Promise.race([
        indexer.upload(file, OG_RPC_URL, signer as any, { skipIfFinalized: true, finalityRequired: false }) as Promise<[unknown, Error | null]>,
        timedOut,
      ]);

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
        // Tokennya ERC-20 biasa; ERC-8004 itu identitas OPSIONAL yang diikat saat
        // launch, bukan standar tokennya. Menulis "ERC-8004" di sini mengulang klaim
        // yang sudah ditarik di README.
        standard: "ERC-20",
        agentIdentity: "ERC-8004, optional",
        // "Dynamic Exponential AMM" salah: kurvanya produk-konstan. Frasa itu bahkan
        // sudah ada di daftar BANNED audit_claims.mjs untuk halaman web, jadi
        // membiarkannya di sini cuma memindahkan klaim yang sama ke tempat yang tidak
        // diaudit.
        curve: "Constant-product bonding curve (x*y=k) with a virtual native reserve",
      },
      dex: {
        // Dulu "Uniswap v4 Sovereign Hook" — integrasi yang tidak pernah ada di repo
        // ini. Sama seperti string SEV-SNP di bawah, yang membuat ini penting bukan
        // besarnya kesalahan tapi tujuannya: payload ini ditambatkan ke 0G DA dan
        // tidak bisa ditarik kembali.
        type: "SovereignCurve, deployed per launch",
        lpFeeBps: 20,
        treasuryBuybackBps: 10,
      },
      agent: {
        model: "glm-5.3",
        computeHost: "0G Compute Router Mainnet (Chain 16661)",
        // Router menyatakan Intel TDX lewat dstack. String lama di sini berbunyi
        // "AMD SEV-SNP Hardware Attested" — vendor TEE yang salah, DAN kata
        // "Hardware Attested" yang menyiratkan kita memverifikasi quote-nya
        // sendiri. Kita tidak. Ini yang paling penting diperbaiki dari semua
        // kemunculan SEV-SNP, karena metadata ini ditambatkan ke 0G DA dan
        // tidak bisa ditarik kembali.
        teeEnclave: "Intel TDX via dstack (router-reported)",
      },
    },
    timestamp: new Date().toISOString(),
  };

  uploadMetadataTo0G(sampleTrinityPayload).then((res) => {
    console.log("Result:", res);
  }).catch(console.error);
}
