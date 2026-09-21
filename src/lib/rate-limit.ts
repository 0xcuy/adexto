/**
 * Pembatas laju untuk endpoint publik yang membelanjakan uang.
 *
 * KENAPA INI ADA
 *
 * `/api/chat` dan `/api/generate-logo` memanggil 0G Router yang berbayar, tanpa autentikasi
 * dan tanpa batas apa pun. Siapa pun yang menemukan URL-nya bisa menghabiskan kuota kami
 * dengan satu loop `curl`, dan tidak ada satu pun galat yang akan muncul sampai kuotanya
 * habis — kegagalan yang tampil sebagai "agent chat mati" alih-alih "kami dikuras".
 *
 * `pay_and_buy` di server MCP juga dibatasi di sini, tetapi alasannya berbeda: ia sudah
 * dijaga `x-agent-key` dan dibatasi 0,20 USDC per panggilan, yang mengikat BESARNYA satu
 * pembelian dan bukan JUMLAHnya. Kunci yang bocor tanpa batas laju berarti saldo USDC
 * dikuras 0,20 sekali jalan, berapa kali pun.
 *
 * BATAS YANG DIAKUI JUJUR
 *
 * Penyimpanannya di memori proses. Produksi berjalan sebagai SATU kontainer
 * (`adexto-production`, tanpa `replicas` di docker-compose.yml), jadi hari ini satu proses
 * memang melihat semua permintaan. Kalau nanti diskalakan ke beberapa instans, batas ini
 * menjadi per instans dan efektifnya berlipat sejumlah instans — saat itu ia harus pindah ke
 * penyimpanan bersama. Ditulis di sini supaya keputusan itu tidak diambil tanpa sadar.
 *
 * Ia juga bukan pertahanan terhadap penyerang yang punya banyak IP. Tujuannya menutup
 * penyalahgunaan sepele dan tidak sengaja, bukan serangan terdistribusi.
 *
 * BENTUK CACHE DIVALIDASI, bukan hanya nullish-nya. `globalThis` bertahan melewati
 * hot-reload dan melewati deploy yang mengubah bentuknya, dan `??=` tidak menggantikan nilai
 * yang bukan nullish. Cache bentuk lama yang tertinggal pernah membuat setiap request balas
 * HTTP 500 `cache.get is not a function` di `src/lib/subgraph.ts`. Jadi `instanceof Map`
 * diperiksa, bukan diasumsikan.
 */

type Hits = number[];

const GLOBAL_KEY = "__adextoRateLimit" as const;

function store(): Map<string, Hits> {
  const g = globalThis as unknown as Record<string, unknown>;
  const existing = g[GLOBAL_KEY];
  if (existing instanceof Map) return existing as Map<string, Hits>;
  const fresh = new Map<string, Hits>();
  g[GLOBAL_KEY] = fresh;
  return fresh;
}

/**
 * Jumlah kunci maksimum yang disimpan. Tanpa batas ini, satu pemindai yang memutar IP
 * palsu di header akan menumbuhkan Map sampai proses mati — mengubah pembatas laju menjadi
 * jalur denial-of-service, yang justru kebalikan dari gunanya.
 */
const MAX_KEYS = 5_000;

/**
 * IP pemanggil, dibaca dari header proxy.
 *
 * Situs ini di belakang Cloudflare lalu nginx, jadi `cf-connecting-ip` adalah satu-satunya
 * yang tidak bisa dipalsukan pemanggil: Cloudflare menuliskannya sendiri dan menimpa apa pun
 * yang dikirim klien. `x-forwarded-for` BISA dipalsukan, jadi ia hanya dipakai sebagai
 * cadangan dan entri PERTAMA yang diambil — entri paling kanan ditulis proxy kita, entri
 * paling kiri diklaim klien, dan untuk pembatasan laju kita justru ingin identitas yang
 * paling spesifik walau bisa dibohongi. Pemalsuannya hanya merugikan si pemalsu sendiri
 * kecuali ia memutar nilainya, dan itu yang ditangani `MAX_KEYS` di atas.
 *
 * Tanpa header apa pun — misalnya permintaan langsung ke port kontainer — semuanya jatuh ke
 * satu keranjang `"unknown"`. Itu disengaja: satu keranjang bersama lebih aman daripada
 * tanpa batas sama sekali.
 */
export function clientIp(req: Request): string {
  const h = req.headers;
  const cf = h.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const real = h.get("x-real-ip");
  if (real) return real.trim();
  const fwd = h.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

export interface RateLimitVerdict {
  ok: boolean;
  /** Sisa permintaan di jendela ini setelah yang sekarang dihitung. */
  remaining: number;
  /** Detik sampai slot berikutnya bebas. `0` kalau masih diizinkan. */
  retryAfter: number;
  limit: number;
  windowMs: number;
}

/**
 * Jendela geser, bukan ember per jam.
 *
 * Ember yang di-reset pada batas jam mengizinkan dua kali limit secara berurutan di sekitar
 * batasnya — kirim limit penuh di detik terakhir jendela lama lalu limit penuh lagi di detik
 * pertama jendela baru. Untuk endpoint yang setiap panggilannya berbiaya uang, itu selisih
 * yang nyata.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitVerdict {
  const now = Date.now();
  const s = store();

  // Bersihkan sebelum menulis, supaya kunci mati tidak ikut dihitung ke MAX_KEYS.
  if (s.size > MAX_KEYS) {
    for (const [k, hits] of s) {
      if (hits.length === 0 || now - hits[hits.length - 1] > windowMs) s.delete(k);
      if (s.size <= MAX_KEYS) break;
    }
    // Masih penuh berarti lalu lintasnya memang sedang banyak, bukan kuncinya basi.
    // Kunci tertua dibuang; membiarkan Map tumbuh tanpa batas lebih buruk.
    if (s.size > MAX_KEYS) {
      const first = s.keys().next();
      if (!first.done) s.delete(first.value);
    }
  }

  const cutoff = now - windowMs;
  const hits = (s.get(key) ?? []).filter((t) => t > cutoff);

  if (hits.length >= limit) {
    const oldest = hits[0];
    s.set(key, hits);
    return {
      ok: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
      limit,
      windowMs,
    };
  }

  hits.push(now);
  s.set(key, hits);
  return { ok: true, remaining: limit - hits.length, retryAfter: 0, limit, windowMs };
}

/**
 * Header standar untuk jawaban yang dibatasi, supaya klien bisa mundur dengan benar alih-alih
 * mencoba lagi secepatnya. `Retry-After` yang hilang membuat 429 dibalas dengan loop ulang,
 * yang menghasilkan beban lebih besar daripada tanpa pembatas.
 */
export function rateLimitHeaders(v: RateLimitVerdict): Record<string, string> {
  return {
    "RateLimit-Limit": String(v.limit),
    "RateLimit-Remaining": String(v.remaining),
    "RateLimit-Policy": `${v.limit};w=${Math.round(v.windowMs / 1000)}`,
    ...(v.ok ? {} : { "Retry-After": String(v.retryAfter) }),
  };
}

/**
 * Perbandingan rahasia waktu-konstan.
 *
 * `a !== b` keluar pada karakter pertama yang berbeda, jadi lama jawabannya membocorkan
 * berapa banyak prefiks yang benar. Lewat HTTP derau jaringan membuat ini nyaris tidak bisa
 * dieksploitasi, dan itu sebabnya ini Low dan bukan High — tetapi biayanya nol dan
 * satu-satunya alasan memakai `!==` adalah karena belum dipikirkan.
 *
 * Panjang dibandingkan lebih dulu dan itu memang membocorkan panjang kunci. Alternatifnya
 * meng-hash keduanya, dan untuk kunci yang dibuat acak panjangnya bukan rahasia.
 */
export function secretEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
