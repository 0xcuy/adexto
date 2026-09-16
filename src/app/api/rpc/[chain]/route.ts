import { NextResponse } from "next/server";

/**
 * Relai JSON-RPC sempit untuk Worker x402. Satu implementasi, beberapa chain.
 *
 * KENAPA INI PERLU ADA
 *
 * Worker Cloudflare tidak bisa memakai RPC Base publik. Diukur dari dalam Worker, keenam
 * kandidat menjawab begini: drpc 429, publicnode -32005 rate limit, 1rpc -32001 usage
 * limit, mainnet.base.org -32016 over rate limit, llamarpc 525. Hanya RPC 0G yang normal.
 * Penyebabnya IP egress Cloudflare dipakai bersama dan dibatasi penyedia RPC. Akibatnya
 * jalur pembayaran x402 gagal di titik pertama ia menyentuh Base: satu versi mengembalikan
 * `unexpected_verify_error`, versi berikutnya menggantung sampai Cloudflare membatalkannya.
 *
 * VPS ini punya IP sendiri dan tidak dibatasi, jadi ia yang meneruskan.
 *
 * KENAPA SEGMEN DINAMIS, BUKAN SATU RUTE PER CHAIN
 *
 * Berkas ini menggantikan `src/app/api/rpc/base/route.ts`. Menambahkan Arbitrum sebagai
 * rute kedua berarti menyalin seluruh daftar metode dan seluruh logika percobaan ulang —
 * dan daftar metode itu adalah permukaan keamanan: relai yang mengizinkan satu metode
 * lebih dari yang dibutuhkan menjadi RPC gratis yang tagihannya jatuh ke kita. Dua salinan
 * berarti dua daftar yang bisa menyimpang, dan yang menyimpang tidak akan terlihat sampai
 * ada yang menyalahgunakannya.
 *
 * `BASE_RPC` di Worker tetap menunjuk `/api/rpc/base` dan tidak berubah: rute dinamis
 * melayani jalur yang sama persis.
 *
 * KENAPA BERKUNCI DAN DIBATASI METODE
 *
 * Wajib `X-Relay-Key`, hanya metode yang benar-benar dipakai jalur pembayaran, tanpa batch.
 * `eth_sendRawTransaction` diizinkan karena transaksinya SUDAH ditandatangani sebelum
 * sampai di sini — relai hanya menyiarkan, ia tidak bisa mengubah isinya.
 */

/** Hanya yang dipakai verifyPayment, settlePayment, dan pengiriman kurva. Sengaja pendek. */
const ALLOWED = new Set([
  "eth_chainId",
  "net_version",
  "eth_blockNumber",
  "eth_call",
  "eth_getCode",
  "eth_getBalance",
  "eth_getTransactionCount",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getBlockByNumber",
  "eth_sendRawTransaction",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
]);

/**
 * Upstream per chain, diurutkan berdasarkan yang benar-benar menjawab dari mesin ini.
 *
 * Arbitrum SENGAJA tidak memuat `arbitrum-one-rpc.publicnode.com`. Endpoint itu melayani
 * `eth_call` dan `eth_estimateGas` dengan baik lalu menolak pencarian receipt dengan
 * "Archive requests require a personal token" (HTTP 403) — terukur saat menyiarkan
 * peluncuran $WOMBO, sesudah transaksinya masuk. Sebuah upstream yang gagal HANYA pada
 * langkah terakhir lebih buruk daripada yang gagal di awal, karena kegagalannya terjadi
 * setelah dana bergerak.
 */
const UPSTREAMS: Record<string, { chainId: number; urls: string[] }> = {
  base: {
    chainId: 8453,
    urls: ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.drpc.org"],
  },
  arbitrum: {
    chainId: 42161,
    urls: ["https://arb1.arbitrum.io/rpc", "https://arbitrum.drpc.org"],
  },
};

export async function POST(req: Request, ctx: { params: Promise<{ chain: string }> }) {
  const { chain: raw } = await ctx.params;
  const chain = String(raw || "").toLowerCase();
  const upstream = UPSTREAMS[chain];
  if (!upstream) {
    // Menyebut yang tersedia: relai yang menolak tanpa memberi tahu apa yang dilayani
    // membuat kesalahan ketik terbaca sebagai relai mati.
    return NextResponse.json(
      { error: `no relay for "${chain}"`, served: Object.keys(UPSTREAMS) },
      { status: 404 }
    );
  }

  const secret = process.env.RPC_RELAY_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "relay is not configured" }, { status: 503 });
  }
  if (req.headers.get("x-relay-key") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON-RPC" }, { status: 400 });
  }
  if (Array.isArray(body)) {
    return NextResponse.json({ error: "batched requests are not relayed" }, { status: 400 });
  }
  const method = (body as { method?: unknown })?.method;
  if (typeof method !== "string" || !ALLOWED.has(method)) {
    return NextResponse.json({ error: `method not relayed: ${method}` }, { status: 403 });
  }

  /**
   * `eth_sendRawTransaction` hanya menemui SATU upstream, selamanya.
   *
   * Mencoba node kedua sesudah yang pertama gagal di tingkat transport bisa berarti
   * transaksi yang sama tersiar dua kali — dan untuk peluncuran itu berarti dua pasar.
   * Kegagalannya dilaporkan alih-alih diulang.
   */
  const once = method === "eth_sendRawTransaction";
  const targets = once ? upstream.urls.slice(0, 1) : upstream.urls;
  let last = "no upstream tried";

  for (const url of targets) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12_000),
      });
      const text = await res.text();
      // Galat tingkat transport (429, 5xx) boleh dicoba ke node lain. Galat JSON-RPC yang
      // sah adalah jawaban dan diteruskan apa adanya — termasuk revert.
      if (!res.ok && !once) {
        last = `${url} HTTP ${res.status}`;
        continue;
      }
      return new NextResponse(text, {
        status: res.status,
        headers: { "content-type": "application/json" },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (once) return NextResponse.json({ error: `broadcast failed: ${msg}` }, { status: 502 });
      last = `${url} ${msg}`;
    }
  }
  return NextResponse.json({ error: `no upstream answered: ${last}` }, { status: 502 });
}
