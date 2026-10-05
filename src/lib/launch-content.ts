/**
 * Pemeriksaan isi peluncuran: nama, ticker, pitch dan tautan, terhadap /acceptable-use.
 *
 * APA INI, DAN APA YANG BUKAN
 *
 * Ini saringan kasar untuk pola yang hampir tidak pernah sah, bukan moderasi. Ia menolak LISTING di
 * situs ini dan alat agen kami (prepare, register, sunting metadata). Ia tidak bisa menolak peluncuran
 * langsung ke factory, dan halaman Acceptable Use mengatakan itu. Sisanya ditangani laporan
 * (/report) dan pencabutan (`src/config/delisted-markets.ts`).
 *
 * Daftarnya SENGAJA pendek dan konservatif. Saringan yang terlalu lebar menolak pasar yang sah — "Base
 * Camp", "Circle of Friends" — dan creator yang ditolak tanpa alasan masuk akal akan meluncur langsung
 * ke factory, di luar jangkauan apa pun. Jadi yang ditolak hanya:
 *
 *   1. kata yang menyamar sebagai resmi atau hadiah (official, airdrop, giveaway, …) di nama atau ticker
 *   2. nama ADEXTO sendiri di nama pasar, kecuali dari deployer resmi
 *   3. nama penerbit dan bursa besar yang paling sering dipakai penipu, sebagai kata utuh di nama
 *   4. pitch yang meminta frasa pemulihan atau kunci privat, atau menjanjikan imbal hasil pasti
 *   5. tautan lewat penyingkat URL, ke alamat IP, atau ke host punycode (domain tiruan)
 *
 * Pesan penolakan berbahasa Inggris (dibaca creator) dan menunjuk aturan di /acceptable-use.
 */

export interface LaunchContent {
  name?: string | null;
  symbol?: string | null;
  description?: string | null;
  links?: Partial<Record<"website" | "github" | "x" | "docs", string | null>> | null;
}

export type ContentCheck = { ok: true } | { ok: false; reason: string; rule: string };

const POLICY = "See adexto.xyz/acceptable-use.";

/** Kata yang membuat pasar tampak resmi atau tampak membagi hadiah. Kata utuh, tanpa beda huruf. */
const OFFICIAL_WORDS = ["official", "airdrop", "giveaway", "claim", "reward drop", "free mint", "presale bonus"];

/**
 * Penerbit dan bursa yang namanya paling sering dipinjam penipu. Kata utuh di NAMA saja: ticker sudah
 * dijaga daftar blue-chip di registry, dan nama-nama ini nyaris tidak pernah dipakai pasar yang sah.
 */
const BRAND_WORDS = [
  "binance",
  "coinbase",
  "tether",
  "metamask",
  "kraken",
  "bybit",
  "okx",
  "opensea",
  "phantom wallet",
  "trust wallet",
  "ledger",
];

/** Pitch yang meminta rahasia dompet atau menjanjikan hasil. */
const PHISHING_PATTERNS: Array<[RegExp, string]> = [
  [/\b(seed|recovery|secret|mnemonic)\s+phrase\b/i, "asks for a wallet recovery phrase"],
  [/\bprivate\s+key\b/i, "asks for a private key"],
  [/\b(validate|verify|sync|rectify)\s+(your\s+)?wallet\b/i, "asks the reader to validate a wallet"],
  [/\bconnect\s+(your\s+)?wallet\s+to\s+claim\b/i, "asks the reader to connect a wallet to claim"],
  [/\bguaranteed?\s+(returns?|profits?|income|gains?|apy|apr|\d+\s*x)\b/i, "promises a guaranteed return"],
  [/\brisk[-\s]?free\b/i, "promises a risk-free return"],
];

/** Penyingkat URL: menyembunyikan tujuan, jadi tidak diterima di halaman pasar. */
const SHORTENER_HOSTS = new Set([
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "is.gd",
  "cutt.ly",
  "rb.gy",
  "ow.ly",
  "shorturl.at",
  "tiny.cc",
  "buff.ly",
  "rebrand.ly",
]);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordIn = (text: string, word: string) => new RegExp(`(^|[^a-z0-9])${escape(word)}([^a-z0-9]|$)`, "i").test(text);

function linkProblem(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null; // bentuknya dinilai `normalizeLinks` di registry, bukan di sini
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (SHORTENER_HOSTS.has(host)) return `uses the URL shortener ${host}, which hides where it leads`;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return "points to a bare IP address";
  if (host.split(".").some((label) => label.startsWith("xn--"))) return "uses a lookalike (punycode) domain";
  return null;
}

/**
 * `officialCreator`: true bila peluncurnya deployer resmi (`ADEXTO_OFFICIAL_DEPLOYER`), satu-satunya yang
 * boleh memakai nama ADEXTO. Pemanggil yang menentukannya, dengan aturan yang sama seperti ticker cadangan.
 */
export function checkLaunchContent(c: LaunchContent, officialCreator = false): ContentCheck {
  const name = String(c.name ?? "").trim();
  const symbol = String(c.symbol ?? "").trim();
  const description = String(c.description ?? "");

  for (const w of OFFICIAL_WORDS) {
    if (wordIn(name, w) || (!w.includes(" ") && symbol.toLowerCase().includes(w))) {
      return {
        ok: false,
        rule: "impersonation",
        reason: `The name or ticker contains "${w}", which makes a market look official or like a giveaway. ${POLICY}`,
      };
    }
  }
  if (!officialCreator && /adexto/i.test(name)) {
    return { ok: false, rule: "impersonation", reason: `Only ADEXTO itself can launch a market named after ADEXTO. ${POLICY}` };
  }
  for (const w of BRAND_WORDS) {
    if (wordIn(name, w)) {
      return {
        ok: false,
        rule: "impersonation",
        reason: `The name uses "${w}", the name of a company this market is not. ${POLICY}`,
      };
    }
  }
  for (const [re, why] of PHISHING_PATTERNS) {
    if (re.test(description) || re.test(name)) {
      return { ok: false, rule: "fraud", reason: `The description ${why}. ${POLICY}` };
    }
  }
  for (const [key, value] of Object.entries(c.links ?? {})) {
    if (key === "x") continue; // handle X, bukan URL
    const problem = linkProblem(value ?? null);
    if (problem) return { ok: false, rule: "malicious-links", reason: `The ${key} link ${problem}. ${POLICY}` };
  }
  return { ok: true };
}
