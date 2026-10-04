import { ipBucket, isCloudflareIp } from "@/lib/cloudflare-ips";

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

/**
 * Satu keranjang: stempel waktu permintaan di jendelanya, ditambah jendela dan batas MILIK
 * keranjang itu sendiri.
 *
 * KENAPA JENDELA DAN BATAS IKUT DISIMPAN
 *
 * Versi sebelumnya menyimpan stempel waktunya saja, lalu saat Map penuh menilai "basi" memakai
 * jendela PEMANGGIL yang kebetulan sedang berjalan. Akibatnya `/api/agent/ping` (jendela 60 s)
 * menghapus keranjang `agentkeys:post` (jendela 1 jam) yang baru diam 61 detik — termasuk
 * keranjang yang sedang MEMBLOKIR seseorang. Dan bila Map masih penuh, kunci tertua dibuang
 * tanpa melihat isinya. Penyerang yang bisa mencetak kunci baru (alamat segar ke `ask_agent`,
 * atau alamat IPv6 yang diputar) bisa mengosongkan keranjang mana pun, termasuk batas global
 * `pay_and_buy`. Dengan jendela dan batasnya tersimpan, keranjang hanya dibuang ketika ia
 * benar-benar kedaluwarsa menurut aturannya sendiri.
 */
interface Bucket {
  hits: number[];
  windowMs: number;
  limit: number;
}

/**
 * Nama baru, bukan `__adextoRateLimit`. Map lama berisi `number[]`, dan `globalThis` bisa
 * menyimpannya melewati hot-reload; nama baru berarti bentuk lama tidak pernah terbaca sebagai
 * `Bucket`. Isinya tetap divalidasi per entri di bawah, untuk perubahan bentuk berikutnya.
 */
const STORE_KEY = "__adextoRateLimitV2" as const;
const PINNED_KEY = "__adextoRateLimitPinned" as const;

function mapAt(name: string): Map<string, Bucket> {
  const g = globalThis as unknown as Record<string, unknown>;
  const existing = g[name];
  if (existing instanceof Map) return existing as Map<string, Bucket>;
  const fresh = new Map<string, Bucket>();
  g[name] = fresh;
  return fresh;
}

function hitsOf(b: Bucket | undefined): number[] {
  return b && Array.isArray(b.hits) ? b.hits : [];
}

/**
 * Jumlah kunci maksimum yang disimpan. Tanpa batas ini, satu pemindai yang memutar IP
 * palsu di header akan menumbuhkan Map sampai proses mati — mengubah pembatas laju menjadi
 * jalur denial-of-service, yang justru kebalikan dari gunanya.
 *
 * 10.000, naik dari 5.000: kunci sekarang per /64 untuk IPv6 sehingga lebih sedikit kunci per
 * pengunjung, dan ruang yang lebih lebar membuat penggusuran (yang selalu kehilangan
 * informasi) lebih jarang terjadi. Kasus terburuknya 10.000 × 240 stempel × 8 byte ≈ 19 MB.
 */
const MAX_KEYS = 10_000;

/** Kunci global ditulis di kode, jadi jumlahnya kecil; batas ini hanya pagar pengaman. */
const MAX_PINNED_KEYS = 256;

/** Penyapuan penuh itu O(n), jadi dijalankan paling sering sekali per detik. */
const SWEEP_EVERY_MS = 1_000;
let lastSweepAt = 0;

/** Berapa entri tertua yang diperiksa saat mencari korban penggusuran yang tidak memblokir. */
const EVICT_SCAN = 64;

function liveCount(b: Bucket, now: number): number {
  const cutoff = now - b.windowMs;
  let n = 0;
  for (const t of hitsOf(b)) if (t > cutoff) n += 1;
  return n;
}

function expired(b: Bucket | undefined, now: number): boolean {
  const hits = hitsOf(b);
  const last = hits[hits.length - 1];
  return !b || last === undefined || !(b.windowMs > 0) || now - last > b.windowMs;
}

/**
 * Sediakan satu tempat sebelum kunci BARU disisipkan.
 *
 * Urutan pilihannya, dari yang tidak kehilangan apa pun ke yang paling terpaksa:
 *
 *   1. kunci yang sudah kedaluwarsa menurut jendelanya sendiri — membuangnya tidak mengubah
 *      satu putusan pun;
 *   2. kunci paling lama tidak dipakai yang TIDAK sedang memblokir — membuangnya paling buruk
 *      memberi pemiliknya hitungan baru, tetapi tidak pernah membuka blokir;
 *   3. kunci paling lama tidak dipakai, apa pun isinya — hanya kalau semua yang diperiksa
 *      sedang memblokir, karena Map yang tumbuh tanpa batas lebih buruk.
 *
 * "Paling lama tidak dipakai" murah karena `rateLimit()` menyisipkan ulang kunci pada setiap
 * pemakaian, jadi urutan sisip Map adalah urutan LRU.
 */
function makeRoom(s: Map<string, Bucket>, max: number, now: number): void {
  if (s.size < max) return;

  if (now - lastSweepAt >= SWEEP_EVERY_MS) {
    lastSweepAt = now;
    for (const [k, b] of s) if (expired(b, now)) s.delete(k);
    if (s.size < max) return;
  }

  let scanned = 0;
  for (const [k, b] of s) {
    if (scanned++ >= EVICT_SCAN) break;
    if (expired(b, now) || liveCount(b, now) < b.limit) {
      s.delete(k);
      return;
    }
  }

  const first = s.keys().next();
  if (!first.done) s.delete(first.value);
}

export interface RateLimitOptions {
  /**
   * Untuk kunci GLOBAL yang tidak memuat identitas pemanggil, seperti `"pay_and_buy"`.
   *
   * Disimpan di Map terpisah yang tidak pernah ikut penggusuran keranjang per-IP. Tanpa ini,
   * kunci global hanyalah satu entri di antara 10.000 dan bisa didorong keluar oleh kunci
   * yang dicetak penyerang — persis keranjang yang membatasi berapa kali saldo USDC penanda
   * tangan bisa dikuras. Hanya untuk kunci yang ditulis literal di kode.
   */
  pinned?: boolean;
}

/**
 * IP pemanggil, dan header mana yang boleh dipercaya untuk menentukannya.
 *
 * VERSI SEBELUMNYA SALAH, DAN INI ALASANNYA
 *
 * Dulu baris pertamanya mengembalikan `cf-connecting-ip` apa adanya, dengan komentar bahwa
 * Cloudflare menimpanya sehingga klien tidak bisa memalsukannya. Itu benar hanya untuk
 * permintaan yang memang melewati Cloudflare, dan dua hal membatalkannya:
 *
 *   - `deploy/Caddyfile` menulis ulang `X-Real-IP` dan `X-Forwarded-For` dari `{remote_host}`
 *     tetapi tidak menyentuh `cf-connecting-ip`, jadi satu-satunya header yang tidak
 *     disanitasi justru yang paling dipercaya
 *   - origin melayani permintaan langsung di IP publiknya — terukur 200, dan `ufw` mengizinkan
 *     443 dari mana saja — sehingga pada jalur itu tidak ada Cloudflare yang menimpa apa pun
 *
 * Hasilnya kunci keranjang bisa dipilih penyerang: 200 permintaan dengan header diputar lolos
 * semuanya di PoC pelapor. Temuan 4 di GHSA-g589-wjqq-86f2.
 *
 * KENAPA BUKAN SEKADAR MENUKAR URUTANNYA
 *
 * Karena lewat Cloudflare, `{remote_host}` adalah IP edge Cloudflare, bukan IP pengunjung —
 * memakai `x-real-ip` lebih dulu akan menaruh SEMUA pengunjung di beberapa keranjang bersama
 * dan mulai menolak orang yang tidak bersalah. Itu sebabnya `cf-connecting-ip` dipilih sejak
 * awal, dan kesalahannya bukan pada pilihan itu melainkan pada tidak adanya pemeriksaan siapa
 * yang mengirimnya.
 *
 * Jadi Caddy sekarang menuliskan peer sebenarnya ke `X-Peer-IP` — menimpa nilai apa pun yang
 * dikirim klien — dan `cf-connecting-ip` hanya dipercaya kalau peer itu memang berada di
 * rentang Cloudflare. Di luar itu, yang dipakai adalah peer-nya sendiri, yang tidak bisa
 * dipalsukan karena proxy yang menuliskannya.
 *
 * `unknown` tetap ada sebagai jalur terakhir, misalnya permintaan langsung ke port kontainer.
 * Satu keranjang bersama lebih aman daripada tanpa batas sama sekali.
 *
 * DUA PERUBAHAN SESUDAH ITU
 *
 *   - `X-Forwarded-For` diambil entri TERAKHIRNYA, bukan yang pertama. Entri pertama ditulis
 *     siapa pun yang pertama mengirim permintaan — yaitu pemanggil — sedangkan entri terakhir
 *     ditambahkan hop yang menyambung ke kita. Caddy versi sekarang (tanpa `trusted_proxies`)
 *     menimpa header itu dengan peer-nya, jadi untuk jalur produksi keduanya sama; bedanya
 *     hanya terasa di jalur yang memang bisa dipalsukan.
 *   - Hasilnya dilewatkan `ipBucket()`: IPv6 dikunci per /64, bukan per alamat. Alasannya di
 *     `src/lib/cloudflare-ips.ts`.
 *
 * Yang TIDAK bisa diselesaikan berkas ini: permintaan yang tidak melewati Caddy bisa menulis
 * `X-Peer-IP` sendiri. Itu ditutup di jaringan — port kontainer diikat ke 127.0.0.1 di
 * `docker-compose.yml`, sehingga satu-satunya yang bisa menyambung ke Next adalah Caddy.
 */
export function clientIp(req: Request): string {
  const h = req.headers;

  // Ditulis Caddy dari `{remote_host}`. Kalau ia tidak ada, permintaannya tidak lewat proxy
  // kita dan tidak ada apa pun di sini yang boleh dipercaya sebagai identitas.
  const peer =
    h.get("x-peer-ip")?.trim() || h.get("x-real-ip")?.trim() || lastForwardedFor(h.get("x-forwarded-for"));

  if (isCloudflareIp(peer)) {
    const cf = h.get("cf-connecting-ip")?.trim();
    if (cf) return ipBucket(cf);
  }

  // Peer-nya bukan Cloudflare: pemanggil menyambung langsung, jadi yang mengidentifikasinya
  // adalah peer itu sendiri. `cf-connecting-ip` DIABAIKAN di jalur ini justru karena di sinilah
  // ia bisa dipalsukan.
  if (peer) return ipBucket(peer);
  return "unknown";
}

function lastForwardedFor(value: string | null): string {
  if (!value) return "";
  const parts = value.split(",");
  return parts[parts.length - 1]?.trim() ?? "";
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
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  opts: RateLimitOptions = {}
): RateLimitVerdict {
  const now = Date.now();
  const s = mapAt(opts.pinned ? PINNED_KEY : STORE_KEY);

  const prev = s.get(key);
  const cutoff = now - windowMs;
  const hits = hitsOf(prev).filter((t) => t > cutoff);

  if (prev) {
    // Disisipkan ulang supaya urutan sisip Map tetap urutan LRU (lihat `makeRoom`).
    s.delete(key);
  } else {
    makeRoom(s, opts.pinned ? MAX_PINNED_KEYS : MAX_KEYS, now);
  }
  s.set(key, { hits, windowMs, limit });

  if (hits.length >= limit) {
    const oldest = hits[0] ?? now;
    return {
      ok: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
      limit,
      windowMs,
    };
  }

  hits.push(now);
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
