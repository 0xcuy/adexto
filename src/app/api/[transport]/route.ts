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
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { ADEXTO_CONTRACTS } from "@/config/contracts";
import { listProjects, type ProjectRecord } from "@/lib/registry";

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
const INDEXER = process.env.ENVIO_GRAPHQL_URL ?? "";
const INDEXER_SECRET = process.env.ENVIO_HASURA_SECRET ?? "";

/** Chain yang diindeks Envio. Menanyakan chain lain ke indexer itu akan bohong. */
const INDEXED_CHAINS = new Set([143]);

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
            indexedHistory: INDEXED_CHAINS.has(Number(p.chainId)),
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
          "Full detail for a single market: chain, curve address, supply, current price in the chain's native asset, and whether its trade history is indexed. Free.",
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
          indexedHistory: INDEXED_CHAINS.has(Number(found.chainId)),
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

    // ── FREE: history, from the indexer ───────────────────────────────────────
    server.registerTool(
      "trade_history",
      {
        title: "Every swap on a market, from the indexer",
        description:
          "Full trade history for a market since its launch block, read from our Envio HyperIndex — not from an RPC log scan, so it has no lookback window. Free. Currently indexed for Monad only; other chains report that plainly instead of returning a shortened history that looks complete.",
        inputSchema: {
          symbol: SYMBOL,
          limit: z.number().int().min(1).max(200).optional().describe("Rows to return, newest first. Default 50."),
        },
      },
      async ({ symbol, limit }) => {
        const projects = registryProjects();
        const want = String(symbol).toUpperCase();
        const market = projects.find((p) => String(p.symbol).toUpperCase() === want);
        if (!market) {
          return jsonResult({ error: "unknown_market", symbol: want, known: projects.map((p) => p.symbol) });
        }
        if (!INDEXED_CHAINS.has(Number(market.chainId))) {
          return jsonResult({
            error: "not_indexed",
            symbol: want,
            chainId: market.chainId,
            detail:
              "This chain has no indexer. Returning a partial history here would be worse than refusing: an RPC scan on this chain reaches only a short window and looks identical to a market that has never traded.",
          });
        }
        if (!market.poolAddress) {
          return jsonResult({
            error: "no_curve",
            symbol: want,
            detail: "This market is registered but has no curve address, so it has no swaps to report.",
          });
        }
        if (!INDEXER) {
          return jsonResult({ error: "indexer_unavailable", detail: "The indexer endpoint is not configured." });
        }

        const rows = Math.min(200, Math.max(1, Number(limit ?? 50)));
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (INDEXER_SECRET) headers["x-hasura-admin-secret"] = INDEXER_SECRET;
        const r = await passthrough(INDEXER, {
          method: "POST",
          headers,
          body: JSON.stringify({
            query: `query H($curve: String!, $limit: Int!) {
              Swap(where: { curve_id: { _eq: $curve } }, order_by: [{ blockNumber: desc }, { logIndex: desc }], limit: $limit) {
                txHash isBuy amountIn amountOut priceNativeAfter trader timestamp blockNumber
              }
              Curve(where: { id: { _eq: $curve } }) { swapCount volumeNative floorPriceNative spotPriceNative }
            }`,
            // Alamat di-lowercase: indexer memakai `address_format: lowercase`, sementara
            // registry menyimpan alamat ber-checksum. Tanpa ini kecocokannya nol dan
            // gejalanya sama dengan pasar yang belum pernah diperdagangkan.
            variables: { curve: String(market.poolAddress).toLowerCase(), limit: rows },
          }),
        });
        const data = (r.body as any)?.data;
        return jsonResult({
          symbol: want,
          chainId: market.chainId,
          curve: market.poolAddress,
          source: "envio-hyperindex",
          curveState: data?.Curve?.[0] ?? null,
          swaps: data?.Swap ?? [],
          publicEndpoint: `${SITE}/api/indexer/graphql`,
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
  return mcp(new Request(request.url, { method: "POST", headers: request.headers, body: raw }));
}

export { handler as GET, handler as POST, handler as DELETE };
