import { ethers } from "ethers";
import {
  buildPaymentRequirements,
  decodePaymentPayload,
  settlePayment,
  verifyPayment,
  X402_VERSION,
  type PaymentRequirements,
} from "./x402";

/**
 * Cloudflare Worker — gerbang x402 untuk ADEXTO: BELI TOKEN LINTAS CHAIN.
 *
 * APA YANG DIJUAL
 *
 * Pembeli punya USDC di Base dan ingin token yang pasarnya hidup di 0G. Tanpa ini ia
 * harus menjembatani dana, mendapatkan gas 0G, lalu berdagang sendiri — tiga langkah
 * dan satu aset gas yang tidak ia pegang. Endpoint ini menerima satu pembayaran USDC
 * di Base lalu mengeksekusi `buy` di kurva 0G, dan tokennya dikirim LANGSUNG ke alamat
 * pembeli oleh kontrak. Yang dijual eksekusi, bukan informasi.
 *
 * TIDAK ADA KUSTODI ATAS TOKENNYA
 *
 * `buy(minTokensOut, to, deadline)` menerima `to`, jadi kurva mengirim token ke pembeli
 * sendiri. Kami tidak pernah memegangnya. Yang kami pegang persediaan 0G milik sendiri
 * yang dibelanjakan untuk pembelian itu.
 *
 * KAMI PRINCIPAL, DAN ITU HARUS DISEBUT
 *
 * Kami membelanjakan 0G lalu menerima USDC. Jadi persediaan 0G terkuras sementara USDC
 * menumpuk, dan itu menuntut rebalancing berkala. Plafonnya nyata: saldo 0G operator
 * dibagi harga per pembelian. Kalau persediaan habis, endpoint menjawab 503 SEBELUM
 * menyentuh uang siapa pun, bukan menerima pembayaran yang tidak bisa dipenuhi.
 *
 * URUTANNYA: ANTAR DULU, BARU TAGIH
 *
 * Kalau ditagih dulu lalu `buy` gagal, kami memegang USDC orang tanpa mengantar token
 * — utang, dan kepercayaan yang justru dihindari seluruh desain kurva ini. Kalau
 * diantar dulu lalu penagihan gagal, yang hilang 0G kami sendiri. Risiko kedua
 * ditanggung sendiri; risiko pertama ditanggung pengguna. Ini juga urutan yang
 * direkomendasikan spesifikasi x402: verify, serve, settle.
 *
 * PASAR TIDAK PERNAH DATANG DARI PEMANGGIL
 *
 * Permintaan menyebut SIMBOL, dan simbol itu diselesaikan lewat registry kami sendiri
 * di /api/pool. Menerima alamat kurva dari header atau query berarti pemanggil memilih
 * kontrak mana yang kami panggil dengan dana kami — kelas kesalahan yang sama dengan
 * `X-Creator-Vault`, header yang dulu menentukan siapa yang dibayar dan sudah dihapus.
 */
export interface Env {
  /** Penerima USDC. Var worker, TIDAK PERNAH dari header permintaan. */
  X402_PAYEE: string;
  /** Harga satu pembelian dalam satuan terkecil USDC (6 desimal). */
  X402_PRICE_ATOMIC: string;
  /** Membayar gas di Base DAN memegang persediaan 0G yang dibelanjakan. */
  X402_RELAYER_PRIVATE_KEY: string;
  /** Potongan yang ditahan dari nilai USDC sebelum dikonversi ke native, dalam bps. */
  X402_SPREAD_BPS: string;
  /** Toleransi pergerakan harga antara kutipan dan eksekusi, dalam bps. */
  X402_SLIPPAGE_BPS: string;
  /**
   * Harus menunjuk relai kami sendiri, bukan RPC Base publik.
   *
   * Diukur dari dalam Worker ini: drpc 429, publicnode -32005, 1rpc -32001,
   * mainnet.base.org -32016, llamarpc 525. IP egress Cloudflare dibatasi penyedia RPC,
   * jadi setiap pembayaran gagal di titik pertama ia menyentuh Base.
   */
  BASE_RPC: string;
  /** Kunci bersama untuk relai di BASE_RPC. Tanpa ini relai menjawab 401. */
  RPC_RELAY_SECRET: string;
  OG_RPC: string;
  /** Asal registry dan harga. Satu asal, supaya tidak ada sumber kebenaran kedua. */
  ADEXTO_ORIGIN: string;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  // X-Creator-Vault sengaja TIDAK ada lagi: payee bukan urusan pemanggil.
  "Access-Control-Allow-Headers": "Content-Type, X-PAYMENT",
  "Access-Control-Expose-Headers": "WWW-Authenticate, X-PAYMENT-RESPONSE",
};

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...extra },
  });
}

const b64 = (o: unknown) =>
  typeof btoa === "function" ? btoa(JSON.stringify(o)) : Buffer.from(JSON.stringify(o), "utf8").toString("base64");

/**
 * Provider Base lewat relai kami, dengan kunci bersama di header.
 *
 * `new JsonRpcProvider(url)` tidak bisa menambah header, jadi FetchRequest dipakai.
 * Tanpa header itu relai menjawab 401 dan setiap pembayaran gagal.
 */
function baseProviderVia(env: Env): ethers.JsonRpcProvider {
  const fr = new ethers.FetchRequest(env.BASE_RPC);
  if (env.RPC_RELAY_SECRET) fr.setHeader("x-relay-key", env.RPC_RELAY_SECRET);
  return new ethers.JsonRpcProvider(fr, 8453, { staticNetwork: true });
}

const CURVE_ABI = [
  "function getBuyQuote(uint256 nativeIn) view returns (uint256,uint256,uint256,uint256,uint256)",
  "function buy(uint256 minTokensOut,address to,uint256 deadline) payable returns (uint256)",
];

/**
 * Tunggu receipt dengan mencobanya berulang, JANGAN pakai `tx.wait()`.
 *
 * Ini bukan kehati-hatian berlebihan. RPC 0G membalas `-32000 no matching receipts
 * found` untuk transaksi yang SUDAH masuk blok, dan `tx.wait()` menerjemahkannya
 * menjadi galat "could not coalesce error". Akibatnya persis terjadi pada pembelian
 * sungguhan pertama: token BERHASIL diantar ke pembeli, worker menyimpulkan gagal,
 * lalu tidak menagih apa pun. Pembeli dapat token gratis dan 0G kami hilang.
 *
 * Kalau setelah semua percobaan receipt-nya tetap tidak terbaca, jangan mengaku gagal
 * dan jangan pula menagih: hash-nya dikembalikan sebagai belum terkonfirmasi. Menagih
 * tanpa konfirmasi berarti bisa memungut untuk pembelian yang revert; mengaku gagal
 * padahal berhasil sudah terbukti membuang persediaan.
 */
async function waitReceipt(
  provider: ethers.Provider,
  hash: string,
  tries = 8,
  delayMs = 2000
): Promise<ethers.TransactionReceipt | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const rc = await provider.getTransactionReceipt(hash);
      if (rc) return rc;
    } catch {
      // -32000 "no matching receipts found" untuk tx yang sudah mined: coba lagi.
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

interface Market {
  symbol: string;
  name: string;
  chainId: number;
  chainName: string;
  nativeSymbol: string;
  tokenAddress: string;
  poolAddress: string;
  tradable: boolean;
  reason: string | null;
}

/** Pasar diselesaikan lewat registry kami, bukan diterima dari pemanggil. */
async function resolveMarket(origin: string, symbol: string): Promise<Market | { error: string }> {
  try {
    const res = await fetch(`${origin}/api/pool?symbol=${encodeURIComponent(symbol)}`);
    if (!res.ok) return { error: `market lookup HTTP ${res.status}` };
    const m: any = await res.json();
    if (!m?.poolAddress) return { error: `no market for ${symbol}` };
    return m as Market;
  } catch (e: any) {
    return { error: String(e?.message ?? e).slice(0, 140) };
  }
}

/** Harga native dibaca hidup, tidak pernah ditulis tetap di berkas ini. */
async function nativePriceUsd(origin: string, nativeSymbol: string): Promise<number | null> {
  try {
    const res = await fetch(`${origin}/api/prices`);
    if (!res.ok) return null;
    const j: any = await res.json();
    const p = j?.prices?.[nativeSymbol];
    const live = j?.live?.[nativeSymbol];
    return typeof p === "number" && p > 0 && live ? p : null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: { ...CORS, "Access-Control-Allow-Methods": "GET, POST, OPTIONS" } });
    }

    const url = new URL(request.url);

    /**
     * Satu pemeriksaan kesehatan: apakah Base benar-benar terjangkau dari sini.
     *
     * Ini bukan diagnostik sisa. Kegagalan yang membuat seluruh jalur pembayaran mati
     * TIDAK terlihat di jalur mana pun yang bisa dipanggil tanpa uang: tantangan 402
     * hanya menyentuh 0G dan origin kami, jadi Base yang tidak terjangkau baru muncul
     * saat seseorang benar-benar membayar. Endpoint ini membuatnya bisa diperiksa lebih
     * dulu, dan itulah kelas bug yang menghabiskan satu pembelian sungguhan.
     */
    if (url.searchParams.get("health") === "1") {
      const t0 = Date.now();
      try {
        const net = await baseProviderVia(env).getNetwork();
        return json({ base: { reachable: true, chainId: Number(net.chainId), ms: Date.now() - t0, via: env.BASE_RPC } }, 200);
      } catch (e: any) {
        return json(
          { base: { reachable: false, ms: Date.now() - t0, via: env.BASE_RPC, detail: String(e?.message).slice(0, 200) } },
          503
        );
      }
    }

    const parts = url.pathname.split("/").filter(Boolean);
    const symbol = (url.searchParams.get("symbol") || parts[parts.length - 1] || "ADEXTO").toUpperCase();
    const recipient = url.searchParams.get("to") || "";

    const origin = env.ADEXTO_ORIGIN || "https://adexto.xyz";
    const priceAtomic = BigInt(env.X402_PRICE_ATOMIC || "20000");
    const spreadBps = BigInt(env.X402_SPREAD_BPS || "300");
    const slippageBps = BigInt(env.X402_SLIPPAGE_BPS || "150");

    const market = await resolveMarket(origin, symbol);
    if ("error" in market) {
      return json({ error: "unknown_market", detail: market.error, symbol }, 404);
    }
    if (!market.tradable) {
      return json({ error: "market_not_tradable", detail: market.reason, symbol: market.symbol }, 409);
    }

    const requirements: PaymentRequirements = buildPaymentRequirements({
      resource: `${origin}/v1/x402/buy/${market.symbol.toLowerCase()}`,
      description:
        `Buy $${market.symbol} on ${market.chainName} with USDC on Base. ` +
        `The curve sends the tokens straight to your address; we never hold them.`,
      amountAtomic: priceAtomic,
      payTo: env.X402_PAYEE,
    });

    const ogProvider = new ethers.JsonRpcProvider(env.OG_RPC, market.chainId);
    const curve = new ethers.Contract(market.poolAddress, CURVE_ABI, ogProvider);

    // Kutipan: USDC -> native pada harga hidup, dikurangi spread, lalu native -> token
    // lewat kurva itu sendiri. Tidak ada langkah yang memakai angka tertulis tetap.
    const priceUsd = await nativePriceUsd(origin, market.nativeSymbol);
    if (priceUsd === null) {
      return json(
        { error: "quote_unavailable", detail: `no live ${market.nativeSymbol} price; refusing to quote a rate we cannot source` },
        503
      );
    }

    const usdc = Number(priceAtomic) / 1e6;
    const nativeAfterSpread = (usdc / priceUsd) * (1 - Number(spreadBps) / 10_000);
    const nativeIn = ethers.parseEther(nativeAfterSpread.toFixed(18));

    let quotedOut: bigint;
    try {
      const q = await curve.getBuyQuote(nativeIn);
      quotedOut = BigInt(q[0]);
    } catch (e: any) {
      return json({ error: "quote_unavailable", detail: String(e?.shortMessage ?? e?.message).slice(0, 160) }, 503);
    }
    const minTokensOut = (quotedOut * (10_000n - slippageBps)) / 10_000n;

    // Persediaan diperiksa SEBELUM uang disentuh. Menerima pembayaran yang tidak bisa
    // dipenuhi adalah cara paling buruk untuk kehabisan stok.
    const operator = new ethers.Wallet(env.X402_RELAYER_PRIVATE_KEY, ogProvider);
    let inventory: bigint;
    try {
      inventory = await ogProvider.getBalance(operator.address);
    } catch (e: any) {
      return json({ error: "inventory_unknown", detail: String(e?.message).slice(0, 140) }, 503);
    }
    // Sisakan ruang gas: eksekusi `buy` juga dibayar dari saldo yang sama.
    const gasHeadroom = ethers.parseEther("0.05");
    const inStock = inventory >= nativeIn + gasHeadroom;

    const quote = {
      symbol: market.symbol,
      token: market.tokenAddress,
      curve: market.poolAddress,
      chainId: market.chainId,
      chain: market.chainName,
      payWith: { asset: requirements.asset, network: "base", amountAtomic: requirements.maxAmountRequired, amount: `${usdc} USDC` },
      deliver: {
        nativeSpent: ethers.formatEther(nativeIn),
        nativeSymbol: market.nativeSymbol,
        quotedTokensOut: ethers.formatEther(quotedOut),
        minTokensOut: ethers.formatEther(minTokensOut),
        to: recipient || "the address that signed the payment",
      },
      rate: { source: `${origin}/api/prices`, [`${market.nativeSymbol}Usd`]: priceUsd, spreadBps: Number(spreadBps), slippageBps: Number(slippageBps) },
      inventory: { inStock, remainingBuys: Number(inventory / (nativeIn > 0n ? nativeIn : 1n)) },
    };

    const paymentHeader = request.headers.get("X-PAYMENT");
    if (!paymentHeader) {
      // Header lama tidak diterima diam-diam: klien yang masih memakainya harus tahu
      // kenapa voucher itu tidak pernah bisa memindahkan uang.
      const legacy = request.headers.get("X-402-Authorization")
        ? "X-402-Authorization is no longer accepted: that voucher was a signed statement of intent that no contract could act on, so it could not move funds."
        : undefined;
      return json(
        { x402Version: X402_VERSION, error: "X-PAYMENT header is required", legacy, accepts: [requirements], quote },
        402,
        { "WWW-Authenticate": `x402 realm="adexto-buy-${market.symbol.toLowerCase()}"` }
      );
    }

    if (!inStock) {
      return json(
        {
          error: "out_of_inventory",
          detail:
            `Delivering $${market.symbol} means spending ${market.nativeSymbol} we hold, and the operator balance ` +
            `(${ethers.formatEther(inventory)}) cannot cover ${ethers.formatEther(nativeIn)} plus gas. ` +
            `No payment was taken and the authorization you signed is unused.`,
          quote,
        },
        503
      );
    }

    const payload = decodePaymentPayload(paymentHeader);
    if (!payload) {
      return json({ x402Version: X402_VERSION, error: "invalid_payload", detail: "X-PAYMENT must be base64 JSON", accepts: [requirements] }, 402);
    }

    const baseProvider = baseProviderVia(env);
    const pre = await verifyPayment({ payload, requirements, provider: baseProvider });
    if (!pre.isValid) {
      return json(
        { x402Version: X402_VERSION, error: pre.invalidReason, detail: pre.detail, payer: pre.payer, accepts: [requirements] },
        402
      );
    }

    // Tujuan pengiriman: `to` kalau diberikan, kalau tidak alamat yang MENANDATANGANI
    // pembayaran. Bukan alamat sembarang dari badan permintaan — yang menandatangani
    // adalah satu-satunya pihak yang terbukti memiliki dananya.
    const to = ethers.isAddress(recipient) ? ethers.getAddress(recipient) : (pre.payer as string);

    // Antar dulu.
    let buyTx: string;
    const deliveredTo = to;
    try {
      const signer = new ethers.Contract(market.poolAddress, CURVE_ABI, operator);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
      const tx = await signer.buy(minTokensOut, to, deadline, { value: nativeIn });
      buyTx = tx.hash;
      const rc = await waitReceipt(ogProvider, tx.hash);
      if (!rc) {
        // Tidak mengaku gagal dan tidak menagih: hash-nya sudah ada, pembeli bisa
        // memeriksanya sendiri. Biaya ketidakpastian ini ditanggung kami.
        return json(
          {
            error: "delivery_unconfirmed",
            detail: `buy was submitted but its receipt could not be read back within the timeout`,
            delivery: { transaction: tx.hash, chainId: market.chainId, to, curve: market.poolAddress, unconfirmed: true },
            note: "No payment was taken. Check the transaction before retrying, or the purchase may happen twice.",
          },
          202
        );
      }
      if (rc.status !== 1) {
        return json(
          { error: "delivery_failed", detail: `buy reverted in ${rc.hash}`, note: "No payment was taken." },
          502
        );
      }
    } catch (e: any) {
      return json(
        {
          error: "delivery_failed",
          detail: String(e?.shortMessage ?? e?.message ?? e).slice(0, 200),
          note: "No payment was taken. The authorization you signed is unused and still spendable.",
        },
        502
      );
    }

    // Baru tagih.
    const settled = await settlePayment({
      payload,
      requirements,
      provider: baseProvider,
      relayerKey: env.X402_RELAYER_PRIVATE_KEY,
    });

    const body = {
      symbol: market.symbol,
      chain: market.chainName,
      delivery: {
        success: true,
        transaction: buyTx,
        chainId: market.chainId,
        to: deliveredTo,
        token: market.tokenAddress,
        curve: market.poolAddress,
        minTokensOut: ethers.formatEther(minTokensOut),
        nativeSpent: ethers.formatEther(nativeIn),
      },
      settlement: settled.success
        ? {
            success: true,
            transaction: settled.transaction,
            network: settled.network,
            payer: settled.payer,
            asset: requirements.asset,
            amount: requirements.maxAmountRequired,
            payTo: requirements.payTo,
          }
        : { success: false, errorReason: settled.errorReason, detail: settled.detail, payer: settled.payer },
      note: settled.success
        ? undefined
        : "The tokens were delivered but the payment did not settle, so this purchase was free. Nothing is owed.",
    };

    return json(body, 200, {
      "X-PAYMENT-RESPONSE": b64({
        success: settled.success,
        transaction: settled.transaction,
        errorReason: settled.errorReason,
        network: requirements.network,
        payer: settled.payer,
      }),
    });
  },
};
