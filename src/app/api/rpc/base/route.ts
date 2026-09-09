import { NextResponse } from "next/server";

/**
 * Relai JSON-RPC Base yang sempit, hanya untuk Worker x402.
 *
 * KENAPA INI PERLU ADA
 *
 * Worker Cloudflare tidak bisa memakai RPC Base publik. Diukur dari dalam Worker,
 * keenam kandidat menjawab begini: drpc 429, publicnode -32005 rate limit, 1rpc
 * -32001 usage limit, mainnet.base.org -32016 over rate limit, llamarpc 525. Hanya
 * RPC 0G yang normal. Penyebabnya IP egress Cloudflare dipakai bersama dan dibatasi
 * penyedia RPC. Akibatnya jalur pembayaran x402 gagal di titik pertama ia menyentuh
 * Base: versi sebelumnya mengembalikan `unexpected_verify_error`, versi berikutnya
 * menggantung sampai Cloudflare membatalkan permintaannya.
 *
 * VPS ini punya IP sendiri dan tidak dibatasi, jadi ia yang meneruskan.
 *
 * KENAPA BERKUNCI DAN DIBATASI METODE
 *
 * Relai RPC terbuka berarti siapa pun bisa memakai server ini sebagai RPC gratis, dan
 * tagihannya jatuh ke kita. Jadi: wajib `X-Relay-Key`, hanya metode yang benar-benar
 * dipakai jalur pembayaran, dan tanpa batch. `eth_sendRawTransaction` diizinkan karena
 * transaksinya SUDAH ditandatangani sebelum sampai di sini — relai hanya menyiarkan,
 * ia tidak bisa mengubah isinya.
 */

/** Hanya yang dipakai verifyPayment dan settlePayment. Sengaja pendek. */
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
 * Diurutkan berdasarkan yang benar-benar menjawab dari mesin ini. Kalau satu membalas
 * galat tingkat transport, yang berikutnya dicoba — kecuali untuk
 * `eth_sendRawTransaction`, di mana mencoba ulang ke node lain bisa berarti transaksi
 * yang sama disiarkan dua kali.
 */
const UPSTREAMS = [
  "https://mainnet.base.org",
  "https://base-rpc.publicnode.com",
  "https://base.drpc.org",
];

export async function POST(req: Request) {
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
  const method = (body as any)?.method;
  if (typeof method !== "string" || !ALLOWED.has(method)) {
    return NextResponse.json({ error: `method not relayed: ${method}` }, { status: 403 });
  }

  const once = method === "eth_sendRawTransaction";
  const targets = once ? UPSTREAMS.slice(0, 1) : UPSTREAMS;
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
      // Galat tingkat transport (429, 5xx) boleh dicoba ke node lain. Galat JSON-RPC
      // yang sah adalah jawaban dan diteruskan apa adanya — termasuk revert.
      if (!res.ok && !once) {
        last = `${url} HTTP ${res.status}`;
        continue;
      }
      return new NextResponse(text, {
        status: res.status,
        headers: { "content-type": "application/json" },
      });
    } catch (e: any) {
      if (once) return NextResponse.json({ error: `broadcast failed: ${e?.message}` }, { status: 502 });
      last = `${url} ${e?.message}`;
    }
  }
  return NextResponse.json({ error: `no upstream answered: ${last}` }, { status: 502 });
}
