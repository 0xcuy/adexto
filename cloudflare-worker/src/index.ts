import { ethers } from "ethers";

/**
 * Cloudflare Worker — gerbang x402 untuk endpoint agen ADEXTO.
 *
 * Judul lama berkas ini: "Sub-50ms Global Payment Verification & 0G TEE
 * Dispatcher". Tidak satu pun dari tiga bagian itu benar: 50ms bukan hasil
 * pengukuran kami, tidak ada pembayaran yang diverifikasi, dan tidak ada apa pun
 * yang dikirim ke TEE.
 *
 * Yang benar-benar dilakukan worker ini:
 *   1. permintaan tanpa voucher  -> HTTP 402 berisi harga dan alamat vault
 *   2. voucher yang tidak sah    -> HTTP 401/400 beserta alasannya
 *   3. voucher yang sah          -> HTTP 501, karena penyelesaiannya belum dibangun
 */
export interface Env {
  VAULT_TREASURY: string;
  OG_COMPUTE_ENDPOINT: string;
  SIGNER_PRIVATE_KEY: string;
}

/** Satu tempat untuk header JSON + CORS, supaya tidak ada jawaban yang lupa memakainya. */
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      // Tanpa ini peramban tidak bisa membaca WWW-Authenticate pada jawaban
      // lintas-asal, dan halaman demo tidak bisa menampilkan tantangannya utuh.
      "Access-Control-Expose-Headers": "WWW-Authenticate",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 1. CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-402-Authorization, X-Target-Chain, X-Chain-Id, X-Creator-Vault",
        },
      });
    }

    const url = new URL(request.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    // Dynamic agent ticker routing: /v1/x402/:agent or /:agent
    const agentSymbol = (pathParts[pathParts.length - 1] || "AEGIS").toUpperCase();

    const authHeader = request.headers.get("X-402-Authorization");
    const targetChain = request.headers.get("X-Target-Chain") || "Base";
    const customVault = request.headers.get("X-Creator-Vault") || env.VAULT_TREASURY || "0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D";

    // 2. Gatekeeper: Challenge with 402 Payment Required if no auth provided
    if (!authHeader) {
      return new Response(
        JSON.stringify({
          error: "Payment Required",
          protocol: "ADEXTO x402 Edge Protocol (adexto.xyz)",
          agent: `$${agentSymbol}`,
          targetChain,
          acceptedTokens: ["USDC", "USDT", "ETH", "0G"],
          pricing: {
            inferenceQuery: "0.005 USDC",
            quantSignal: "0.010 USDC",
            customExecution: "0.020 USDC",
          },
          settlementVault: customVault,
          // Dinyatakan di dalam jawaban itu sendiri, bukan hanya di halaman web:
          // siapa pun yang mengintegrasikan endpoint ini harus tahu batasnya dari
          // jawaban pertama, bukan setelah membangun klien pembayaran.
          settlementImplemented: false,
          settlementNote:
            "This endpoint quotes terms only. Sending a signed voucher returns 501: " +
            "on-chain settlement and agent dispatch are not built yet.",
          gatewayUrl: `https://adexto-x402-edge.cucuvirtual.workers.dev/v1/x402/${agentSymbol.toLowerCase()}`,
        }, null, 2),
        {
          status: 402,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "WWW-Authenticate",
            "WWW-Authenticate": `x402 realm="adexto-agent-${agentSymbol.toLowerCase()}"`,
          },
        }
      );
    }

    /**
     * Cabang ini SEBELUMNYA membalas HTTP 200 dengan objek yang seluruhnya
     * ditulis tangan: `edgeLatencyMs: 32` sebagai konstanta, `attestation:
     * "AMD SEV-SNP Quote Valid"` tanpa satu pun laporan attestation dibaca,
     * `storageRoot` yang panjangnya bahkan bukan 32 byte, dan
     * `buybackStatus: "Scheduled to Uniswap v4 Hook"` — merujuk integrasi Uniswap
     * yang tidak pernah ada di repo ini. Komentarnya berbunyi "Fast EIP-712
     * Signature Verification" sementara satu-satunya yang dilakukan adalah
     * `JSON.parse`. Artinya siapa pun yang mengirim header berisi `{}` menerima
     * jawaban "pembayaran diselesaikan".
     *
     * Sekarang tanda tangannya benar-benar diperiksa — `ethers` sudah diimpor
     * untuk itu sejak awal, hanya tidak pernah dipakai. Dan karena penyelesaian
     * on-chain memang belum dibangun, jawabannya 501, bukan 200. Endpoint yang
     * jujur berkata "belum saya bangun" lebih berguna daripada endpoint yang
     * mengaku sudah membayar.
     */
    try {
      const payload = JSON.parse(authHeader);
      const { signer, signature, amount, nonce } = payload ?? {};

      if (!signer || !signature || !amount || nonce === undefined) {
        return json(
          {
            error: "Malformed x402 voucher",
            required: ["signer", "signature", "amount", "nonce"],
          },
          400
        );
      }

      // Domain dan tipe HARUS cocok dengan apa yang ditandatangani klien.
      // Diverifikasi di sini, bukan dipercaya dari badan permintaan.
      const domain = {
        name: "ADEXTO x402",
        version: "1",
        chainId: Number(request.headers.get("X-Chain-Id") || 8453),
        verifyingContract: customVault,
      };
      const types = {
        Voucher: [
          { name: "agent", type: "string" },
          { name: "amount", type: "string" },
          { name: "nonce", type: "uint256" },
        ],
      };
      const value = { agent: agentSymbol, amount: String(amount), nonce: BigInt(nonce) };

      let recovered: string;
      try {
        recovered = ethers.verifyTypedData(domain, types, value, signature);
      } catch (e: any) {
        return json({ error: "Signature does not verify", details: e.message }, 401);
      }
      if (recovered.toLowerCase() !== String(signer).toLowerCase()) {
        return json({ error: "Signature was not produced by the declared signer", recovered }, 401);
      }

      return json(
        {
          status: "voucher_verified_settlement_not_implemented",
          agent: `$${agentSymbol}`,
          payer: recovered,
          quotedAmount: String(amount),
          settlementVault: customVault,
          note:
            "The EIP-712 voucher is well formed and signed by the declared address. " +
            "On-chain settlement, agent dispatch and buyback forwarding are not built yet, " +
            "so no payment has been taken and no work has been performed.",
        },
        501
      );
    } catch (err: any) {
      return json({ error: "X-402-Authorization must be JSON", details: err.message }, 400);
    }
  },
};
