/**
 * Rentang IP Cloudflare, dan pemeriksaan apakah sebuah alamat berada di dalamnya.
 *
 * KENAPA INI DIBUTUHKAN
 *
 * `clientIp()` di `src/lib/rate-limit.ts` mempercayai `cf-connecting-ip` lebih dulu, dengan
 * alasan yang tertulis di sana: Cloudflare menimpanya sendiri, jadi klien tidak bisa
 * memalsukannya. Alasan itu benar HANYA untuk permintaan yang benar-benar melewati Cloudflare.
 *
 * Dua fakta membatalkannya, dan keduanya diukur:
 *
 *   1. `deploy/Caddyfile` menulis ulang `X-Real-IP` dan `X-Forwarded-For` dari `{remote_host}`,
 *      tetapi TIDAK menyentuh `cf-connecting-ip`. Jadi header yang paling dipercaya justru
 *      satu-satunya yang diteruskan apa adanya, dan presedennya terbalik.
 *   2. Origin melayani permintaan langsung ke IP publiknya: `https://168.144.249.185/` menjawab
 *      200, dan `ufw` mengizinkan 443 dari Anywhere. Pada jalur itu Cloudflare tidak terlibat
 *      sama sekali, sehingga `cf-connecting-ip` sepenuhnya milik pemanggil.
 *
 * Akibatnya kunci keranjang pembatas laju bisa dipilih penyerang, dan setiap batas per-IP
 * menjadi nol untuk satu mesin yang memutar headernya. Dilaporkan sebagai temuan 4 di
 * GHSA-g589-wjqq-86f2, di mana pelapor mencatat 200 dari 200 permintaan lolos.
 *
 * Perbaikannya bukan menukar urutan header. Melewati Cloudflare, `{remote_host}` adalah IP edge
 * Cloudflare dan bukan IP pengunjung — itulah sebabnya `cf-connecting-ip` dipilih sejak awal.
 * Yang benar adalah menegaskan SIAPA YANG MENYAMBUNG: Caddy menuliskan peer sebenarnya ke
 * `X-Peer-IP`, dan `cf-connecting-ip` hanya dipercaya ketika peer itu memang Cloudflare.
 *
 * KENAPA DAFTARNYA DITANAM, BUKAN DIAMBIL SAAT JALAN
 *
 * Mengambilnya lewat jaringan pada setiap proses berarti pembatas laju berhenti bekerja ketika
 * `api.cloudflare.com` tidak bisa dihubungi — sebuah kegagalan yang membuka justru hal yang
 * hendak ditutup. Daftarnya juga jarang berubah.
 *
 * Diambil 24 September 2026 dari <https://api.cloudflare.com/client/v4/ips>, etag
 * `38f79d050aa027e3be3865e495dcc9bc`. Segarkan dengan:
 *
 *   curl -s https://api.cloudflare.com/client/v4/ips | python3 -m json.tool
 */

const IPV4_CIDRS = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
] as const;

const IPV6_CIDRS = [
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
] as const;

/** Etag daftar yang ditanam, supaya kapan ia terakhir diselaraskan bisa diperiksa. */
export const CLOUDFLARE_IPS_ETAG = "38f79d050aa027e3be3865e495dcc9bc";

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out = (out << 8) | n;
  }
  return out >>> 0;
}

/**
 * IPv6 diperluas menjadi 16 byte, sebab `::` boleh muncul di mana saja dan perbandingan
 * berbasis teks akan gagal pada bentuk yang sah tapi ditulis berbeda.
 */
function ipv6ToBytes(ip: string): Uint8Array | null {
  let addr = ip.trim().toLowerCase();
  // Bentuk berkurung dan zona antarmuka dibuang lebih dulu.
  if (addr.startsWith("[") && addr.endsWith("]")) addr = addr.slice(1, -1);
  const pct = addr.indexOf("%");
  if (pct >= 0) addr = addr.slice(0, pct);

  // IPv4-mapped, mis. ::ffff:1.2.3.4 — dipetakan ke 12 byte nol lalu empat oktetnya.
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (v4) {
    const n = ipv4ToInt(v4[1]);
    if (n === null) return null;
    const out = new Uint8Array(16);
    out[10] = 0xff;
    out[11] = 0xff;
    out[12] = (n >>> 24) & 0xff;
    out[13] = (n >>> 16) & 0xff;
    out[14] = (n >>> 8) & 0xff;
    out[15] = n & 0xff;
    return out;
  }

  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : [];
  if (halves.length === 1 && head.length !== 8) return null;
  if (head.length + tail.length > 8) return null;

  const groups: number[] = [];
  for (const g of head) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    groups.push(parseInt(g, 16));
  }
  for (let i = head.length + tail.length; i < 8; i++) groups.push(0);
  for (const g of tail) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    groups.push(parseInt(g, 16));
  }
  if (groups.length !== 8) return null;

  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    out[i * 2] = (groups[i] >> 8) & 0xff;
    out[i * 2 + 1] = groups[i] & 0xff;
  }
  return out;
}

function inV4Cidr(ip: number, cidr: string): boolean {
  const [net, bitsRaw] = cidr.split("/");
  const netInt = ipv4ToInt(net);
  const bits = Number(bitsRaw);
  if (netInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (netInt & mask);
}

function inV6Cidr(bytes: Uint8Array, cidr: string): boolean {
  const [net, bitsRaw] = cidr.split("/");
  const netBytes = ipv6ToBytes(net);
  const bits = Number(bitsRaw);
  if (!netBytes || !Number.isInteger(bits) || bits < 0 || bits > 128) return false;
  const full = bits >> 3;
  for (let i = 0; i < full; i++) if (bytes[i] !== netBytes[i]) return false;
  const rem = bits & 7;
  if (rem === 0) return true;
  const mask = (0xff << (8 - rem)) & 0xff;
  return (bytes[full] & mask) === (netBytes[full] & mask);
}

/**
 * Apakah alamat ini milik Cloudflare.
 *
 * Alamat yang tidak bisa diurai menjawab `false`, dan itu arah gagal yang benar: nilai yang
 * tidak dikenali tidak boleh memberi kepercayaan. Loopback juga `false` — kalau `X-Peer-IP`
 * berisi `127.0.0.1`, berarti Caddy tidak menuliskannya dan kita tidak tahu siapa peer-nya.
 */
export function isCloudflareIp(ip: string | null | undefined): boolean {
  if (!ip) return false;
  const addr = ip.trim();
  if (!addr) return false;

  const v4 = ipv4ToInt(addr);
  if (v4 !== null) return IPV4_CIDRS.some((c) => inV4Cidr(v4, c));

  const v6 = ipv6ToBytes(addr);
  if (!v6) return false;
  // IPv4-mapped diperiksa juga terhadap daftar IPv4, sebab Cloudflare bisa menyambung
  // sebagai ::ffff:x.x.x.x tergantung tumpukan jaringannya.
  const mapped = v6.slice(0, 12).every((b, i) => (i < 10 ? b === 0 : b === 0xff));
  if (mapped) {
    const n = ((v6[12] << 24) | (v6[13] << 16) | (v6[14] << 8) | v6[15]) >>> 0;
    return IPV4_CIDRS.some((c) => inV4Cidr(n, c));
  }
  return IPV6_CIDRS.some((c) => inV6Cidr(v6, c));
}
