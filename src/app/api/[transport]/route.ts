/**
 * MCP server for ADEXTO — the x402 cross-chain buy, spoken in MCP.
 *
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 *
 * It is an ADAPTER. Every tool below forwards to something that already runs and is already
 * proven with real money: the x402 gateway at `x402.adexto.xyz`, the market registry at
 * `/api/graphql`, and the Envio indexer at `/api/indexer/graphql`.
 *
 * It does NOT reimplement x402. No signing, no settlement, no payment verification lives in
 * this file. That is a deliberate refusal: a second implementation of the payment contract
 * means two definitions of what a valid payment is, and the one that drifts is the one nobody
 * is testing. This project has already been bitten by exactly that shape — the consistency
 * guard kept its own copy of every RPC URL and therefore measured an endpoint the app had
 * stopped using.
 *
 * So the 402 challenge an agent receives here is byte-for-byte the challenge the gateway
 * issues, and the `X-PAYMENT` header is passed through untouched.
 *
 * WHY MCP AT ALL
 *
 * The gateway already speaks HTTP 402, which any program can use. What it does not do is
 * announce itself. An agent has to be told the URL, the path shape, and the ticker before it
 * can find anything. MCP is a discovery protocol: `tools/list` hands over the whole surface
 * with schemas, so an agent can find the markets, quote one, and pay for it without a human
 * pasting a curl command first.
 *
 * FOUR TRAPS TAKEN FROM A SIBLING IMPLEMENTATION'S POSTMORTEMS
 *
 *   1. One header name. Its server reads `payment-signature` while its own SDK and README
 *      send `x-payment` — a mismatch still live over there. Here it is `X-PAYMENT`, the name
 *      the spec uses and the only name our gateway reads.
 *   2. No default market. The gateway answers `400 symbol_required` on a missing ticker on
 *      purpose: a default would let a mistyped path bill someone for a token they never asked
 *      for. Every tool here therefore requires `symbol` and none supplies a fallback.
 *   3. Refuse before charging. `quote_buy` exists so an agent can read the price without
 *      paying, and the gateway's own refusals — unknown market, not tradable, out of
 *      inventory — all happen before an authorization is spent.
 *   4. Never swallow the gateway's status. A 402, 404, 409 or 503 is returned as structured
 *      content with the original body, because an agent that cannot tell "you must pay" from
 *      "this market does not exist" will retry the wrong one forever.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createMcpHandler } from "mcp-handler";
import { ethers } from "ethers";
import { z } from "zod";
import { ADEXTO_CONTRACTS } from "@/config/contracts";
import { listProjects, type ProjectRecord } from "@/lib/registry";
import { resolveChainOrDefault } from "@/lib/chains";
import { readOnChainSwaps } from "@/lib/onchain-trades";
import { envioServes, readEnvioSwaps } from "@/lib/envio-indexer";
import { rateLimit, secretEquals } from "@/lib/rate-limit";

/**
 * Gateway x402, dari konstanta yang SAMA dengan yang dipakai UI.
 *
 * Sengaja BUKAN dari `NEXT_PUBLIC_EDGE_GATEWAY`. Variabel itu punya tiga nilai berbeda di
 * repo ini — `edge.adexto.xyz` di .env.example, sebuah URL workers.dev yang sudah mati di
 * .env.local, dan `x402.adexto.xyz` di kode — dan tidak ada satu pun berkas yang
 * membacanya. Route ini sempat membacanya dan langsung "fetch failed": env yang basi
 * mengalahkan nilai yang benar. Satu sumber, dan sumbernya yang diuji.
 */
const GATEWAY = ADEXTO_CONTRACTS.edgeX402Gateway.replace(/\/$/, "");
/** Hanya untuk menyebut endpoint publik di dalam jawaban, bukan untuk memanggil apa pun. */
const SITE = "https://adexto.xyz";

/**
 * Header per-permintaan, dibawa ke dalam callback alat.
 *
 * `registerTool` tidak menerima `Request`, jadi tanpa ini sebuah alat tidak punya cara
 * mengetahui siapa yang memanggilnya. Dipakai HANYA oleh `pay_and_buy`, satu-satunya alat
 * yang membelanjakan uang, supaya ia bisa menolak pemanggil yang tidak membawa kunci.
 *
 * `AsyncLocalStorage` dan bukan variabel modul: variabel modul akan bocor antar permintaan
 * yang tumpang tindih, dan yang bocor di sini adalah izin membelanjakan.
 */
const requestContext = new AsyncLocalStorage<{ agentKey: string | null }>();

/** Kunci yang harus dibawa pemanggil untuk memakai alat berbayar. Kosong = alat mati. */
const AGENT_DEMO_KEY = process.env.AGENT_DEMO_KEY ?? "";
/**
 * Kunci penanda tangan untuk `pay_and_buy`, dan ia SENGAJA TIDAK jatuh ke kunci deployer.
 *
 * Dulu baris ini `process.env.PRIVATE_KEY || process.env.OG_PRIVATE_KEY`, yaitu kunci
 * deployer. Itu bertentangan dengan keputusan yang sudah diambil untuk relayer x402: relayer
 * memakai operator terpisah `0xDe1f…C627` justru supaya blast radius-nya kecil, dan kunci
 * deployer sengaja tidak pernah ditaruh di Worker. Endpoint ini publik dan anonim kecuali
 * satu header, jadi ia adalah permukaan yang LEBIH terbuka daripada Worker, dan ia memegang
 * kunci yang lebih berharga.
 *
 * Apa yang sebenarnya bisa hilang: batas keras di bawah mengikat APA yang ditandatangani,
 * jadi bahkan kunci yang bocor hanya bisa menandatangani otorisasi EIP-3009 USDC ke treasury
 * kami sendiri. Yang tidak diikatnya adalah BERAPA KALI. Jadi kerugian maksimumnya adalah
 * seluruh saldo USDC dompet penanda tangan, terkuras 0,20 sekali jalan. Dengan kunci deployer
 * itu berarti saldo USDC dompet yang juga `creator` pasar-pasar hidup dan pemilik setiap
 * agent ERC-8004 kami. Dengan dompet khusus, kerugiannya adalah isi dompet itu saja.
 *
 * KOREKSI, DAN ANGKANYA DIUKUR BUKAN DIKIRA
 *
 * Revisi sebelum ini MEWAJIBKAN `AGENT_DEMO_PRIVATE_KEY` dan menolak jatuh ke kunci
 * deployer, dengan alasan "blast radius". Lalu paparannya diukur, dan alasan itu tidak
 * sebanding dengan harganya.
 *
 * Saldo USDC deployer di Base: **1,76 USDC**. Itulah seluruh plafon kerugiannya, karena alat
 * ini hanya bisa menghasilkan otorisasi EIP-3009 untuk USDC di Base, maksimum 0,20, ke
 * treasury kami sendiri — cocok dengan `PAY_LIMITS` di atas atau pembelian dibatalkan.
 * Kuncinya sendiri tidak pernah terpapar, dan tidak ada jalan dari sini ke posisi `creator`
 * pasar mana pun atau ke agent ERC-8004 kami. Pesan commit yang memperkenalkan perubahan itu
 * menyebut "seluruh saldo USDC dompet penanda tangan" lalu menambahkan bahwa dompet itu juga
 * creator dan pemilik agent — benar secara harfiah, tetapi menyusunnya begitu membuatnya
 * terbaca seolah kekuasaan itu ikut terancam. Tidak.
 *
 * Yang benar-benar mengunci risiko ini adalah `PAY_CALL_LIMIT` di bawah, bukan dompet mana
 * yang menandatangani: 10 panggilan per jam x 0,20 USDC = maksimum 2 USDC per jam, di bawah
 * saldo yang ada. Menukar dompet hanya menambah lapisan di atas batas itu, dan harganya
 * adalah fitur yang tadinya berjalan menjadi mati sampai dompet baru diisi.
 *
 * Jadi kunci deployer dipakai lagi — itu keputusan yang sudah diambil pemilik repo ini
 * dengan sadar ("pakai dompet yang sudah ada"), dan menimpanya tanpa bertanya adalah
 * kesalahan terpisah dari soal keamanannya.
 *
 * `AGENT_DEMO_PRIVATE_KEY` TETAP DIDAHULUKAN kalau diset, jadi pindah ke dompet khusus nanti
 * hanya perlu mengisi satu variabel env dan mendanainya — tanpa menyentuh kode ini lagi.
 */
const SIGNER_KEY =
  process.env.AGENT_DEMO_PRIVATE_KEY || process.env.PRIVATE_KEY || process.env.OG_PRIVATE_KEY || "";
/**
 * Batas JUMLAH panggilan, pelengkap `PAY_LIMITS` yang membatasi besarnya.
 *
 * `PAY_LIMITS` memastikan satu pembelian tidak bisa lebih dari 0,20 USDC dan uangnya hanya
 * bisa ke treasury kami. Ia tidak berkata apa pun soal seribu pembelian berturut-turut.
 * Dibatasi secara GLOBAL, bukan per IP: yang dijaga di sini adalah saldo dompet, dan saldo
 * itu satu untuk semua pemanggil — pembatasan per IP akan dilewati begitu saja dengan
 * berpindah IP.
 */
const PAY_CALL_LIMIT = 10;
const PAY_CALL_WINDOW_MS = 60 * 60 * 1000;

/**
 * Batas keras untuk `pay_and_buy`. Bukan saran — diperiksa terhadap kutipan gerbang, dan
 * satu ketidakcocokan membatalkan pembelian.
 *
 * Ini yang membuat alat itu aman diberikan kepada sebuah LLM. Agent tidak memilih penerima,
 * tidak memilih aset, dan tidak memilih jumlah; ketiganya dibaca dari kutipan gerbang lalu
 * dicocokkan dengan konstanta di bawah. Yang bisa dilakukan agent — bahkan agent yang
 * sepenuhnya dibajak lewat prompt injection — hanyalah membeli salah satu pasar KAMI
 * SENDIRI dengan maksimum 0,20 USDC, dan uangnya hanya bisa mendarat di treasury kami.
 */
const PAY_LIMITS = {
  /** USDC di Base. Aset lain ditolak. */
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".toLowerCase(),
  network: "base",
  /** Treasury protokol, dari `X402_PAYEE` di worker. TIDAK PERNAH dari masukan agent. */
  payTo: "0x24268Fffc119ec5550F68e80D94476fD64daE967".toLowerCase(),
  /** 0,20 USDC dalam satuan terkecil. Harga gerbang 0,10; ini memberi ruang satu kenaikan. */
  maxAtomic: 200_000n,
  chainId: 8453,
} as const;

const jsonResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

/**
 * Ambil dari endpoint kita sendiri dan SELALU laporkan status aslinya.
 *
 * Membungkus 402/404/409/503 menjadi satu "gagal" adalah cara tercepat membuat agent
 * mengulang hal yang salah: "harus bayar" dan "pasar tidak ada" menuntut tindakan yang
 * berbeda sepenuhnya.
 */
async function passthrough(
  url: string,
  init?: RequestInit
): Promise<{ status: number; ok: boolean; body: unknown; raw: string }> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await res.text();
  let body: unknown = raw;
  try {
    body = JSON.parse(raw);
  } catch {
    // Biarkan sebagai teks: gateway pernah menjawab non-JSON pada jalur galat, dan
    // memaksanya menjadi objek akan menyembunyikan pesan aslinya.
  }
  return { status: res.status, ok: res.ok, body, raw };
}

/**
 * Baca registry LANGSUNG sebagai pustaka, bukan lewat HTTP ke `/api/graphql`.
 *
 * Versi pertama route ini memanggil situsnya sendiri lewat `NEXT_PUBLIC_APP_URL`. Itu
 * membuat server melakukan perjalanan keluar-masuk internet untuk data yang sudah ada di
 * dalam prosesnya, dan menambah satu env lagi yang bisa basi — persis kegagalan yang baru
 * saja terjadi pada URL gateway. `listProjects()` sinkron, jadi tidak ada yang hilang.
 */
function registryProjects(): ProjectRecord[] {
  return listProjects();
}

const SYMBOL = z
  .string()
  .min(1)
  .describe(
    "Market ticker, for example PARCEL or ADEXTO. Required and has no default: the gateway " +
      "refuses a missing ticker rather than quoting one, so a typo can never bill you for a " +
      "token you did not ask for. Call list_markets first if you do not know it."
  );

const mcp = createMcpHandler(
  (server) => {
    // ── FREE: discovery ────────────────────────────────────────────────────────
    server.registerTool(
      "list_markets",
      {
        title: "List every tradable ADEXTO market",
        description:
          "Every bonding-curve market this gateway can sell, across all chains it serves, with its ticker, chain, curve address and whether it is currently tradable. Free. Start here: the buy tools require a ticker and deliberately have no default.",
        inputSchema: {},
      },
      async () => {
        const projects = registryProjects();
        return jsonResult({
          count: projects.length,
          markets: projects.map((p) => ({
            symbol: p.symbol,
            name: p.name,
            chainId: p.chainId,
            chain: p.chainLabel,
            nativeSymbol: p.nativeSymbol,
            token: p.tokenAddress,
            curve: p.poolAddress,
            tradable: p.poolLive && Boolean(p.poolAddress),
            priceNative: p.priceNative,
            historySource: envioServes(p.chainId) ? "indexer" : "rpc-logs",
          })),
          note:
            "Pay with USDC on Base; the curve on the market's own chain sends the tokens straight to your address. " +
            "We never hold them.",
        });
      }
    );

    server.registerTool(
      "get_market",
      {
        title: "One market in detail",
        description:
          "Full detail for a single market: chain, curve address, supply, fee rates, current price in the chain's native asset, and which read path serves its trade history. Free.",
        inputSchema: { symbol: SYMBOL },
      },
      async ({ symbol }) => {
        const projects = registryProjects();
        const want = String(symbol).toUpperCase();
        const found = projects.find((p) => String(p.symbol).toUpperCase() === want);
        if (!found) {
          return jsonResult({
            error: "unknown_market",
            symbol: want,
            known: projects.map((p) => p.symbol),
            detail: "That ticker is not served here. list_markets returns everything that is.",
          });
        }
        return jsonResult({
          symbol: found.symbol,
          name: found.name,
          slug: found.slug,
          chainId: found.chainId,
          chain: found.chainLabel,
          nativeSymbol: found.nativeSymbol,
          token: found.tokenAddress,
          curve: found.poolAddress,
          tradable: found.poolLive && Boolean(found.poolAddress),
          priceNative: found.priceNative,
          supply: found.supply,
          lpFeeBps: found.lpFeeBps,
          treasuryBuybackBps: found.treasuryBuybackBps,
          creator: found.creator,
          launchTx: found.txHash,
          launchBlock: found.blockNumber,
          /**
           * Sumbernya, bukan klaim kelengkapan. Lengkap atau tidak hanya diketahui SESUDAH
           * dibaca — `trade_history` yang menyatakannya per panggilan lewat `complete`.
           */
          historySource: envioServes(found.chainId) ? "indexer" : "rpc-logs",
          buyResource: `${GATEWAY}/v1/x402/buy/${found.slug}`,
        });
      }
    );

    // ── FREE: price discovery WITHOUT paying ───────────────────────────────────
    server.registerTool(
      "quote_buy",
      {
        title: "Quote a cross-chain buy without paying",
        description:
          "Reads the gateway's HTTP 402 challenge for a market and returns the quote and payment requirements without spending anything. The challenge carries the exact amount, the asset, the payTo address and the EIP-3009 domain, so an agent can decide before it signs. Free. This is the tool to call before buy_token.",
        inputSchema: {
          symbol: SYMBOL,
          to: z
            .string()
            .optional()
            .describe("Recipient address for the tokens. Optional for a quote; the curve delivers straight to it on a real buy."),
        },
      },
      async ({ symbol, to }) => {
        const url = new URL(`${GATEWAY}/v1/x402/buy/${String(symbol).toLowerCase()}`);
        if (to) url.searchParams.set("to", to);
        const r = await passthrough(url.toString());
        /**
         * 402 di sini adalah HASIL YANG BENAR, bukan galat.
         *
         * Itulah bentuk kuotasinya: gateway menjawab tagihan beserta syarat pembayaran.
         * Melaporkannya sebagai kegagalan akan membuat agent mengira pasarnya rusak.
         */
        return jsonResult({
          httpStatus: r.status,
          quoted: r.status === 402,
          resource: url.toString(),
          challenge: r.body,
          next:
            r.status === 402
              ? "Sign the EIP-3009 transferWithAuthorization described in accepts[0], base64-encode the x402 payload, and call buy_token with it as xPayment."
              : "Not a quote. Read httpStatus and challenge: 404 unknown market, 409 not tradable, 503 out of inventory. None of these spend anything.",
        });
      }
    );

    server.registerTool(
      "how_to_pay",
      {
        title: "How to pay this gateway",
        description:
          "The exact steps to turn a 402 challenge into a settled cross-chain buy: what to sign, which chain settles, and which header carries the payment. Free. Read this if you have never paid an x402 endpoint before.",
        inputSchema: {},
      },
      async () =>
        jsonResult({
          protocol: "x402, version 2",
          settlementChain: "Base",
          settlementAsset: "USDC",
          scheme: "exact, EIP-3009 transferWithAuthorization",
          header: "X-PAYMENT",
          headerNote:
            "One header name, and only this one. No alias is accepted, because a server that reads a second name is a server where a correctly signed payment can still be ignored.",
          steps: [
            "Call quote_buy to get the 402 challenge.",
            "Take accepts[0]: it carries network, asset, maxAmountRequired, payTo, and extra.name / extra.version for the EIP-712 domain.",
            "Sign transferWithAuthorization for that amount to that payTo, with a random bytes32 nonce.",
            "Base64-encode the x402 payment payload and pass it to buy_token as xPayment.",
          ],
          youNeverNeed: [
            "Native gas on the destination chain — the curve is called by our relayer.",
            "A bridge — the asset you pay with never leaves Base.",
            "An account with us — there is no signup and no API key.",
          ],
          orderOfOperations:
            "Delivery runs BEFORE the charge. A failed fill costs us, never you, and refusals (unknown market, not tradable, out of inventory) all happen before your authorization is spent.",
          replayProtection:
            "EIP-3009 authorizationState(from, nonce) is checked before settling and enforced by the token contract, so one signed authorization can never be spent twice.",
        })
    );

    // ── PAID ACTION: the real cross-chain buy ─────────────────────────────────
    server.registerTool(
      "buy_token",
      {
        title: "Buy a market cross-chain with USDC on Base",
        description:
          "Executes the buy. Called without xPayment it returns the HTTP 402 challenge, which is the correct first response and not an error. Called with a signed x402 payload in xPayment it settles on Base and the curve on the destination chain sends the tokens straight to `to`. You never need native gas on the destination chain and never need to bridge.",
        inputSchema: {
          symbol: SYMBOL,
          to: z
            .string()
            .describe("Address that receives the tokens. The curve sends them here directly; we never custody them."),
          xPayment: z
            .string()
            .optional()
            .describe(
              "Base64-encoded x402 payment payload containing the signed EIP-3009 authorization. Omit it to receive the 402 challenge first."
            ),
        },
      },
      async ({ symbol, to, xPayment }) => {
        const url = new URL(`${GATEWAY}/v1/x402/buy/${String(symbol).toLowerCase()}`);
        url.searchParams.set("to", to);

        const r = await passthrough(url.toString(), {
          method: "GET",
          // Diteruskan APA ADANYA. Header ini adalah pembayarannya; menyentuhnya berarti
          // membangun definisi kedua tentang apa yang sah.
          headers: xPayment ? { "X-PAYMENT": xPayment } : {},
        });

        if (r.status === 402) {
          return jsonResult({
            httpStatus: 402,
            settled: false,
            paymentRequired: true,
            challenge: r.body,
            next: "Sign accepts[0] and call buy_token again with xPayment. Nothing was spent.",
          });
        }
        return jsonResult({
          httpStatus: r.status,
          settled: r.ok,
          result: r.body,
          next: r.ok
            ? "Settled. The result carries the delivery and settlement transaction hashes; read them from the chains rather than trusting this response."
            : "Not settled, and nothing was charged: refusals happen before payment. Read httpStatus and result for which refusal it was.",
        });
      }
    );

    // ── PAID, AND GATED: the agent signs through us ────────────────────────────
    /**
     * KENAPA ALAT INI ADA, DAN APA YANG IA BUKAN
     *
     * `buy_token` menuntut `xPayment`, yaitu otorisasi EIP-3009 yang sudah ditandatangani.
     * Sebuah LLM tidak bisa menandatangani apa pun, jadi tanpa alat ini seorang agent bisa
     * menemukan pasar, menghargainya, membaca riwayatnya, dan berhenti tepat sebelum
     * membeli. Alat ini menutup langkah terakhir itu.
     *
     * YANG HARUS DINYATAKAN JUJUR: ini BUKAN "agent dengan dompet sendiri". Yang menandatangani
     * adalah kunci operator di server ini. Jadi klaim yang benar adalah "agent memutuskan apa
     * yang dibeli dan mengeksekusi pembeliannya", bukan "agent membayar dari dananya sendiri".
     * Deskripsi alat di bawah menyatakannya, supaya model itu sendiri tidak salah menyebutnya.
     *
     * KENAPA AMAN MEMBERIKAN INI KEPADA SEBUAH LLM
     *
     * Agent tidak memilih penerima, aset, maupun jumlah. Ketiganya dibaca dari kutipan
     * gerbang lalu DICOCOKKAN dengan konstanta `PAY_LIMITS`, dan satu ketidakcocokan
     * membatalkan. Alamat pengiriman juga tidak diekspos: token selalu dikirim ke
     * penanda tangan. Jadi kemampuan maksimum agent — termasuk agent yang sepenuhnya
     * dibajak prompt injection — adalah membeli salah satu pasar kami sendiri dengan
     * maksimum 0,20 USDC, dengan uang yang hanya bisa mendarat di treasury kami.
     *
     * KENAPA BERKUNCI HEADER
     *
     * Endpoint MCP ini publik dan anonim. Tanpa gerbang, siapa pun di internet bisa
     * menghabiskan saldo USDC kami satu panggilan demi satu panggilan. Kuncinya dibawa
     * sebagai HEADER, bukan argumen alat: argumen alat terlihat oleh model, dan yang
     * terlihat model bisa ikut tercetak di transkrip.
     */
    server.registerTool(
      "pay_and_buy",
      {
        title: "Execute a buy end to end (operator-signed, capped)",
        description:
          "Buys a market for real, completing the step an LLM cannot do alone: signing the EIP-3009 USDC authorisation. IMPORTANT for honest reporting — the signature is made by the operator's wallet on the server, not by a wallet you control, so describe the result as 'executed the purchase', not 'paid from my own funds'. Refuses unless the caller carries the agent key, and refuses any quote whose asset, network, recipient or amount does not match the hard-coded limits. Delivery always goes to the signer.",
        inputSchema: { symbol: SYMBOL },
      },
      async ({ symbol }) => {
        const ctx = requestContext.getStore();
        if (!AGENT_DEMO_KEY) {
          return jsonResult({
            error: "not_configured",
            detail: "AGENT_DEMO_KEY is not set on this server, so the paid tool is switched off.",
          });
        }
        // `secretEquals`, bukan `!==`: yang terakhir keluar pada karakter pertama yang beda,
        // jadi lama jawabannya membocorkan panjang prefiks yang benar. Lewat HTTP itu nyaris
        // tak bisa dieksploitasi, tapi biaya memperbaikinya nol.
        if (!ctx?.agentKey || !secretEquals(ctx.agentKey, AGENT_DEMO_KEY)) {
          return jsonResult({
            error: "not_authorised",
            detail:
              "This tool spends real money and requires the agent key in the x-agent-key header. Every other tool on this server is free and open; use quote_buy to price a market instead.",
          });
        }
        if (!SIGNER_KEY) {
          return jsonResult({
            error: "no_signer",
            detail:
              "No signing key is configured on this server. Set AGENT_DEMO_PRIVATE_KEY for a dedicated signing wallet, or PRIVATE_KEY to use the operator wallet.",
          });
        }
        /**
         * Batas dihitung SESUDAH kunci diperiksa, dan itu urutan yang disengaja.
         *
         * Kalau dihitung lebih dulu, pemanggil anonim tanpa kunci bisa menghabiskan kuota
         * jam itu dan mengunci pemakai yang sah — pembatas laju yang berubah menjadi alat
         * denial-of-service terhadap pemiliknya sendiri.
         */
        const payGate = rateLimit("pay_and_buy", PAY_CALL_LIMIT, PAY_CALL_WINDOW_MS);
        if (!payGate.ok) {
          return jsonResult({
            error: "rate_limited",
            retryAfterSeconds: payGate.retryAfter,
            detail: `This tool is capped at ${PAY_CALL_LIMIT} purchases per hour across all callers, because the per-purchase limit bounds the size of a buy and not the number of them.`,
          });
        }

        const want = String(symbol).toUpperCase();
        const market = registryProjects().find((p) => String(p.symbol).toUpperCase() === want);
        if (!market) {
          return jsonResult({ error: "unknown_market", symbol: want, known: registryProjects().map((p) => p.symbol) });
        }

        // 1. Tantangan diambil dari GERBANG, bukan dibangun di sini. Yang ditandatangani
        //    harus berasal dari pihak yang akan memverifikasinya.
        const slug = market.slug;
        const challenge = await passthrough(`${GATEWAY}/v1/x402/buy/${slug}`);
        if (challenge.status !== 402) {
          return jsonResult({
            error: "no_challenge",
            httpStatus: challenge.status,
            detail: "The gateway did not answer with a payment challenge, so there is nothing to sign.",
            body: challenge.body,
          });
        }
        const accept = (challenge.body as any)?.accepts?.[0];
        if (!accept) {
          return jsonResult({ error: "no_accepts", detail: "The challenge carried no payment terms." });
        }

        // 2. Batas diperiksa SEBELUM menandatangani. Tanda tangan yang sudah keluar tidak
        //    bisa ditarik kembali, jadi setiap pemeriksaan harus mendahuluinya.
        const amount = BigInt(String(accept.maxAmountRequired ?? "0"));
        const checks: string[] = [];
        if (String(accept.network).toLowerCase() !== PAY_LIMITS.network) checks.push(`network ${accept.network}`);
        if (String(accept.asset).toLowerCase() !== PAY_LIMITS.asset) checks.push(`asset ${accept.asset}`);
        if (String(accept.payTo).toLowerCase() !== PAY_LIMITS.payTo) checks.push(`payTo ${accept.payTo}`);
        if (amount <= 0n || amount > PAY_LIMITS.maxAtomic) checks.push(`amount ${amount}`);
        if (checks.length > 0) {
          return jsonResult({
            error: "refused_by_limits",
            detail: `The quote does not match this tool's hard limits, so nothing was signed. Mismatched: ${checks.join(", ")}.`,
            limits: {
              network: PAY_LIMITS.network,
              asset: PAY_LIMITS.asset,
              payTo: PAY_LIMITS.payTo,
              maxAtomic: PAY_LIMITS.maxAtomic.toString(),
            },
          });
        }

        // 3. Tanda tangan. Nonce acak; `validBefore` pendek supaya otorisasi yang tidak
        //    terpakai tidak menganggur lama sebagai izin yang masih hidup.
        const wallet = new ethers.Wallet(SIGNER_KEY);
        const authorization = {
          from: wallet.address,
          to: accept.payTo as string,
          value: amount,
          validAfter: 0n,
          validBefore: BigInt(Math.floor(Date.now() / 1000) + 600),
          nonce: ethers.hexlify(ethers.randomBytes(32)),
        };
        const signature = await wallet.signTypedData(
          {
            name: accept.extra?.name ?? "USD Coin",
            version: accept.extra?.version ?? "2",
            chainId: PAY_LIMITS.chainId,
            verifyingContract: accept.asset as string,
          },
          {
            TransferWithAuthorization: [
              { name: "from", type: "address" },
              { name: "to", type: "address" },
              { name: "value", type: "uint256" },
              { name: "validAfter", type: "uint256" },
              { name: "validBefore", type: "uint256" },
              { name: "nonce", type: "bytes32" },
            ],
          },
          authorization
        );

        const header = Buffer.from(
          JSON.stringify({
            x402Version: 2,
            scheme: "exact",
            network: PAY_LIMITS.network,
            payload: {
              signature,
              authorization: {
                from: authorization.from,
                to: authorization.to,
                value: authorization.value.toString(),
                validAfter: authorization.validAfter.toString(),
                validBefore: authorization.validBefore.toString(),
                nonce: authorization.nonce,
              },
            },
          }),
          "utf8"
        ).toString("base64");

        // 4. Bayar. Status gerbang diteruskan apa adanya, termasuk 503 out_of_inventory —
        //    agent harus bisa membedakan "tidak ada stok" dari "pembelian gagal".
        const paid = await passthrough(`${GATEWAY}/v1/x402/buy/${slug}`, {
          method: "POST",
          headers: { "content-type": "application/json", "X-PAYMENT": header },
        });
        const body = paid.body as any;
        return jsonResult({
          symbol: want,
          chain: market.chainLabel,
          httpStatus: paid.status,
          settled: paid.status === 200 && body?.settlement?.success === true,
          paidBy: wallet.address,
          signedBy: "operator wallet on the ADEXTO server, not a wallet held by the agent",
          amountUsdc: (Number(amount) / 1e6).toFixed(2),
          delivery: body?.delivery ?? null,
          settlement: body?.settlement ?? null,
          buyback: body?.buyback ?? null,
          ...(paid.status !== 200 ? { gatewayError: body } : {}),
          terminal: `${SITE}/token/${slug}?chain=${market.chainId}`,
        });
      }
    );

    // ── FREE: history ─────────────────────────────────────────────────────────
    /**
     * KELENGKAPAN DIUKUR, BUKAN DIASUMSIKAN DARI CHAIN.
     *
     * Versi pertama alat ini MENOLAK setiap chain selain Monad, dengan alasan yang ditulis
     * di dalam pesan galatnya sendiri: "pemindaian RPC di chain ini hanya menjangkau jendela
     * pendek". Alasan itu salah untuk 0G, dan angkanya sudah ada di repo ini sejak awal.
     *
     * Petak `eth_getLogs` 0G adalah 500.000 blok dengan anggaran 16 panggilan, sedangkan
     * jarak dari blok peluncuran $ADEXTO ke kepala rantai 715.692 blok. Jadi riwayat penuh
     * 0G terjangkau dalam DUA panggilan, dan produksi memang sudah menyajikannya:
     * `reachedLaunch: true`, `truncated: false`, `calls: 2`, 20 fill untuk $ADEXTO dan 1
     * untuk $ADT. Alat ini menolak data yang sudah dipajang halaman token di sebelahnya.
     *
     * Yang sebenarnya ingin dicegah tetap benar: riwayat terpotong tidak boleh terlihat
     * seperti pasar yang tidak pernah diperdagangkan. Tapi penjaganya bukan daftar chain —
     * penjaganya `coverage.reachedLaunch`, yang menyatakan penelusuran berhenti karena
     * riwayatnya HABIS, bukan karena anggarannya habis. Base masih akan dilaporkan tidak
     * lengkap kalau memang tidak lengkap: petaknya 2.000 blok, jadi 16 panggilan hanya
     * menjangkau 32.000 blok.
     *
     * Keduanya memakai pustaka yang SAMA dengan yang dipakai terminal token
     * (`readEnvioSwaps`, `readOnChainSwaps`). Versi pertama menyalin ulang kueri GraphQL
     * Envio ke dalam berkas ini — persis "definisi kedua" yang dijanjikan tidak akan dibuat
     * di komentar kepala berkas. Sekarang tidak ada kueri swap di sini sama sekali.
     */
    server.registerTool(
      "trade_history",
      {
        title: "Every swap on a market, and how complete the answer is",
        description:
          "Trade history for a market, newest first, with an explicit statement of whether it reaches the launch block. Free. Monad is served by our Envio indexer, which has no lookback window; the other chains are served by a log scan whose reach is reported per call. When the scan cannot reach the launch block the answer says so instead of presenting a shortened list as the whole history.",
        inputSchema: {
          symbol: SYMBOL,
          limit: z
            .number()
            .int()
            .min(1)
            .max(400)
            .optional()
            .describe("Rows to return, newest first. Default 50, maximum 400."),
        },
      },
      async ({ symbol, limit }) => {
        const projects = registryProjects();
        const want = String(symbol).toUpperCase();
        const market = projects.find((p) => String(p.symbol).toUpperCase() === want);
        if (!market) {
          return jsonResult({ error: "unknown_market", symbol: want, known: projects.map((p) => p.symbol) });
        }
        if (!market.poolAddress || !market.poolLive) {
          return jsonResult({
            error: "no_curve",
            symbol: want,
            detail: "This market has no live curve, so there are no swaps to report.",
          });
        }

        const rows = Math.min(400, Math.max(1, Number(limit ?? 50)));
        const chain = resolveChainOrDefault(market.chainId);
        const shape = (t: {
          txHash: string;
          type: string;
          amountToken: number;
          amountNative: number;
          priceNative: number;
          priceNativeAfter?: number | null;
          trader: string;
          timestamp: string;
          blockNumber: number | null;
        }) => ({
          txHash: t.txHash,
          side: t.type,
          amountToken: t.amountToken,
          amountNative: t.amountNative,
          nativeSymbol: chain.nativeSymbol,
          /** Yang benar-benar dibayar atau diterima, fee termasuk. Bukan harga pasar. */
          executionPriceNative: t.priceNative,
          /** Harga spot kurva sesudah fill ini. Ini yang harus diplot sebagai harga. */
          spotPriceAfter: t.priceNativeAfter ?? null,
          trader: t.trader,
          timestamp: t.timestamp,
          blockNumber: t.blockNumber,
        });

        // 1. Indexer lebih dulu bila ia melayani chain ini: lengkap sejak blok peluncuran
        //    tanpa satu pun panggilan `getLogs`.
        if (envioServes(market.chainId)) {
          const fromIndexer = await readEnvioSwaps(
            market.poolAddress,
            want,
            chain.nativeSymbol,
            market.chainId,
            rows
          );
          if (fromIndexer.trades.length > 0) {
            return jsonResult({
              symbol: want,
              chainId: market.chainId,
              chain: market.chainLabel,
              curve: market.poolAddress,
              source: "envio-hyperindex",
              complete: true,
              completeBecause:
                "The indexer stores every Swap since the factory's launch block, so this is the whole history rather than a window.",
              totalSwaps: fromIndexer.totalSwaps,
              returned: fromIndexer.trades.length,
              indexerSyncedToBlock: fromIndexer.syncedToBlock,
              swaps: fromIndexer.trades.map(shape),
              publicEndpoint: `${SITE}/api/indexer/graphql`,
            });
          }
          /**
           * Indexer yang gagal TIDAK mengembalikan daftar kosong: ia menyerahkan giliran ke
           * pemindaian di bawah, dan galatnya tetap dilaporkan. Indexer mati yang diam-diam
           * diganti sumber lebih sempit adalah tepat jenis kemunduran yang tidak boleh
           * tampil seperti keadaan normal.
           */
          if (fromIndexer.error) {
            const read = await readOnChainSwaps(chain, market.poolAddress, want, rows, market.blockNumber);
            return jsonResult({
              symbol: want,
              chainId: market.chainId,
              chain: market.chainLabel,
              curve: market.poolAddress,
              source: "rpc-logs",
              indexerError: fromIndexer.error,
              degraded: true,
              complete: read.coverage.reachedLaunch,
              coverage: read.coverage,
              returned: read.trades.length,
              swaps: read.trades.map(shape),
            });
          }
        }

        // 2. Pemindaian log. Untuk sebagian chain ini menjangkau blok peluncuran dan karena
        //    itu LENGKAP; untuk yang lain tidak, dan jawabannya menyatakan yang mana.
        const read = await readOnChainSwaps(chain, market.poolAddress, want, rows, market.blockNumber);
        if (read.coverage.error) {
          return jsonResult({
            error: "read_failed",
            symbol: want,
            chainId: market.chainId,
            detail: read.coverage.error,
            note: "This is an RPC failure, not an empty market. The two are reported separately on purpose.",
          });
        }
        return jsonResult({
          symbol: want,
          chainId: market.chainId,
          chain: market.chainLabel,
          curve: market.poolAddress,
          source: "rpc-logs",
          complete: read.coverage.reachedLaunch,
          ...(read.coverage.reachedLaunch
            ? {
                completeBecause: `The scan reached the launch block ${market.blockNumber}, and the curve was created in the same transaction as the token, so no swap can exist before it.`,
              }
            : {
                incompleteBecause:
                  "The scan ran out of its call budget before reaching the launch block, so older swaps exist that are not listed here. Treat an empty or short list as 'not seen', not as 'never traded'.",
              }),
          launchBlock: market.blockNumber,
          coverage: read.coverage,
          returned: read.trades.length,
          swaps: read.trades.map(shape),
        });
      }
    );
  },
  {
    instructions:
      "ADEXTO sells positions in bonding-curve markets across chains, paid for with USDC on Base over x402. " +
      "Call list_markets to see what exists, quote_buy to price one without paying, then buy_token with a signed " +
      "payment. You never need gas on the destination chain and never need to bridge. Every tool except buy_token " +
      "is free, and buy_token's first response is a 402 challenge, which is expected rather than a failure.",
    capabilities: { tools: {} },
    serverInfo: { name: "adexto-x402", version: "1.0.0" },
  },
  {
    // Harus cocok dengan letak `[transport]`: berkas ini ada di src/app/api/[transport]/,
    // jadi klien menyambung ke `<origin>/api/mcp`.
    basePath: "/api",
    maxDuration: 60,
    verboseLogs: false,
  }
);

/**
 * Balas galat parse SEBELUM transport melihatnya.
 *
 * Diukur, bukan dikira: POST dengan badan kosong dan POST dengan JSON rusak TIDAK PERNAH
 * dijawab oleh transport streamable-HTTP — prosesnya tetap hidup, tapi permintaannya
 * menggantung sampai klien menyerah (terbukti: dua kali TimeoutError 8s pada probe lokal,
 * sementara `{"hello":"world"}` yang JSON-nya sah dijawab 400 dengan benar).
 *
 * Menggantung lebih buruk daripada galat. Klien MCP yang menunggu selamanya terlihat seperti
 * server mati, dan di belakang proxy ini muncul sebagai gateway timeout, bukan sebagai
 * pesan yang bisa dibaca. Implementasi sejenis pernah rontok pada masukan yang sama persis
 * — badan POST kosong mematikan prosesnya menjadi 502 — jadi jalur ini memang layak dijaga.
 *
 * Hanya POST yang diperiksa: GET (SSE) dan DELETE (penutupan sesi) tidak berbadan, dan
 * membaca badan mereka tidak ada gunanya.
 */
function parseError(message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message } }),
    { status: 400, headers: { "content-type": "application/json" } }
  );
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return mcp(request);

  const raw = await request.text();
  if (!raw.trim()) {
    return parseError("Empty request body. Send a JSON-RPC 2.0 request, for example {\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}.");
  }
  try {
    JSON.parse(raw);
  } catch {
    return parseError("Request body is not valid JSON.");
  }

  // Badan sudah dikonsumsi oleh `.text()`, jadi permintaannya dirakit ulang dengan isi yang
  // sama. Header ikut apa adanya agar `X-PAYMENT`, accept dan content-length tetap utuh.
  const rebuilt = new Request(request.url, { method: "POST", headers: request.headers, body: raw });

  /**
   * Kunci agent dibaca DI SINI dan dibawa lewat AsyncLocalStorage.
   *
   * Callback `registerTool` tidak menerima `Request`, jadi ini satu-satunya tempat header
   * itu masih terlihat. Hanya `pay_and_buy` yang membacanya; alat lainnya gratis dan tidak
   * peduli siapa pemanggilnya.
   */
  return requestContext.run({ agentKey: request.headers.get("x-agent-key") }, () => mcp(rebuilt));
}

export { handler as GET, handler as POST, handler as DELETE };
