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
/**
 * URUTAN BACA DAN TUJUAN SIARAN DIPISAH, DAN ITU MEMPERBAIKI KEGAGALAN TERUKUR
 *
 * `mainnet.base.org` dulu berada di urutan PERTAMA untuk semua metode. Digabung dengan
 * batas waktu 12 detik per upstream di bawah, akibatnya bukan "agak lambat" melainkan
 * setiap `eth_call` membakar 12 detik gagal lebih dulu sebelum jatuh ke upstream yang
 * melayani. Satu kutipan x402 membutuhkan banyak `eth_call`, jadi biayanya berlipat.
 *
 * Terukur terhadap gerbang produksi, `?symbol=BLOOP&chainId=8453`, lima percobaan:
 *
 *   3 dari 5  habis waktu pada 70 detik tanpa jawaban
 *   1 dari 5  berhasil dalam 27,3 detik
 *   1 dari 5  habis waktu
 *
 * Yaitu pembeli Base ditolak lebih sering daripada dilayani, dan penyebabnya urutan
 * daftar ini — bukan kurva, bukan stok.
 *
 * KENAPA ALASAN DI RUNBOOK TIDAK BERLAKU DI SINI, dan ini inti koreksinya.
 *
 * Catatan "IP egress Cloudflare dibatasi penyedia RPC publik" itu benar, dan ia alasan
 * `BASE_RPC` menunjuk relai ini alih-alih menunjuk publicnode langsung. Tetapi upstream
 * relai dipanggil dari VPS kami, BUKAN dari Cloudflare. Jadi alasan itu berlaku pada hop
 * Worker→relai, dan pernah dipakai untuk memutuskan hop relai→upstream — hop yang
 * berbeda. Dari VPS, publicnode melayani `eth_call` pada 208 ms terhadap 21.377 ms milik
 * `mainnet.base.org`, dan angka itu sudah ada di runbook sejak lama.
 *
 * Yang ditolak publicnode adalah permintaan ARSIP, dan daftar izin di bawah tidak memuat
 * `eth_getLogs` sama sekali. Kalaupun ia menolak sebuah pencarian receipt dengan 403,
 * lingkaran di bawah meneruskan ke upstream berikutnya karena `!res.ok` memang dicoba
 * ulang — jadi jalur uang tetap punya jaring.
 *
 * `broadcast` DIPERTAHANKAN di `mainnet.base.org` dan sengaja tidak ikut diubah.
 * `eth_sendRawTransaction` hanya pernah menemui satu upstream, jadi mengubahnya berarti
 * mengubah perilaku jalur uang tanpa pengukuran yang menuntutnya. Yang diperbaiki di sini
 * adalah kutipan, dan kutipan tidak menyiarkan apa pun.
 */
const UPSTREAMS: Record<string, { chainId: number; urls: string[]; broadcast: string }> = {
  base: {
    chainId: 8453,
    urls: ["https://base-rpc.publicnode.com", "https://mainnet.base.org", "https://base.drpc.org"],
    broadcast: "https://mainnet.base.org",
  },
  arbitrum: {
    chainId: 42161,
    urls: ["https://arb1.arbitrum.io/rpc", "https://arbitrum.drpc.org"],
    broadcast: "https://arb1.arbitrum.io/rpc",
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
  // Siaran memakai tujuan yang dinamai sendiri, bukan `urls[0]`. Dulu keduanya sama, jadi
  // menyusun ulang urutan baca akan diam-diam memindahkan tujuan siaran juga — perubahan
  // pada jalur uang yang tidak diminta siapa pun dan tidak terlihat di diff.
  const targets = once ? [upstream.broadcast] : upstream.urls;
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
