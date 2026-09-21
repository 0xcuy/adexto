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
 * Worker→relai, lalu pernah dipakai untuk memutuskan hop relai→upstream — hop yang
 * berbeda.
 *
 * URUTANNYA DARI PENGUKURAN, DAN PENGUKURANNYA SUDAH BERUBAH SEKALI
 *
 * Percobaan pertama menaruh publicnode di depan, dengan dasar angka 208 ms yang tercatat
 * di runbook. Itu memperbaiki sebagian — 3 dari 5 kutipan berhasil, terbaik 1,5 detik —
 * lalu diukur ulang dan ternyata publicnode sudah tidak seperti itu lagi.
 *
 * 15 `eth_call` sah berurutan dari VPS, ke `totalSupply()` token $BLOOP:
 *
 *   base.drpc.org             15/15 berhasil   0 rate limit    198 ms
 *   base-rpc.publicnode.com   12/15 berhasil   0 rate limit  3.617 ms
 *   mainnet.base.org           5/15 berhasil  10 rate limit    337 ms
 *
 * Jadi `mainnet.base.org` cepat tetapi menolak dua dari tiga permintaan, publicnode
 * menjawab tetapi kini 3,6 detik, dan drpc melayani semuanya pada 198 ms. Ini kali ketiga
 * dalam satu hari sebuah konstanta penyedia basi: petak Base turun 10.000→2.000, petak 0G
 * 2.000.000→100.000, dan sekarang latensi publicnode. **Ukur ulang sebelum mempercayai
 * urutan ini; jangan warisi angkanya.**
 *
 * drpc juga melayani `eth_getTransactionReceipt` untuk transaksi di kedalaman ~223.000
 * blok — justru permintaan arsip yang ditolak publicnode dengan 403, yaitu kegagalan #1
 * di runbook. Jadi menaruhnya di depan memperbaiki kutipan DAN memperkuat jalur receipt.
 *
 * Daftar izin di bawah tidak memuat `eth_getLogs`, jadi batas `getLogs` drpc pada paket
 * gratis tidak pernah tersentuh di jalur ini. Dan kalau upstream mana pun menjawab
 * non-2xx, lingkaran di bawah meneruskan ke berikutnya karena `!res.ok` dicoba ulang.
 *
 * `broadcast` DIPERTAHANKAN di `mainnet.base.org` dan sengaja tidak ikut diubah.
 * `eth_sendRawTransaction` hanya pernah menemui satu upstream, jadi mengubahnya berarti
 * mengubah perilaku jalur uang tanpa pengukuran yang menuntutnya. Yang diperbaiki di sini
 * adalah kutipan, dan kutipan tidak menyiarkan apa pun. Rate limit yang diukur di atas
 * menyangkut volume `eth_call` satu kutipan, bukan satu siaran tunggal.
 */
const UPSTREAMS: Record<string, { chainId: number; urls: string[]; broadcast: string }> = {
  base: {
    chainId: 8453,
    // Diukur 2026-09-21 dari VPS. Lihat tabel di atas sebelum menyusun ulang.
    urls: ["https://base.drpc.org", "https://base-rpc.publicnode.com", "https://mainnet.base.org"],
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
