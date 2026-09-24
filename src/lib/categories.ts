/**
 * Kategori pasar — dipakai dropdown di studio DAN validasi di server.
 *
 * KENAPA DAFTAR TERTUTUP, BUKAN TEKS BEBAS
 *
 * `/explorer` menurunkan tab kategorinya dari pasar yang benar-benar ada, bukan dari daftar
 * yang dipaku. Itu keputusan yang benar dan sudah beralasan di berkas itu: tab literal
 * pernah MENYEMBUNYIKAN pasar yang kategorinya di luar daftar. Tapi konsekuensinya, apa pun
 * yang masuk ke field ini langsung menjadi tab yang terlihat publik. Dengan teks bebas,
 * "DeFi", "defi " dan "de-fi" menjadi tiga tab berbeda yang masing-masing berisi satu pasar,
 * dan index-nya justru lebih sulit dibaca daripada sebelum ada kategori.
 *
 * Jadi studio menawarkan daftar tertutup dan server menormalkannya. Menambah kategori berarti
 * menambah satu baris di sini — dan tab-nya muncul sendiri di /explorer tanpa berkas itu
 * disentuh.
 *
 * KENAPA KUNCINYA SATU KATA
 *
 * `/explorer` menulis label tab sebagai `cat.toUpperCase()`. Kunci bertanda hubung akan
 * tampil sebagai `AI-AGENT`, jadi kuncinya dijaga satu kata dan kalimat penjelasnya hidup di
 * `label`/`hint` yang hanya dipakai studio.
 */

export const MARKET_CATEGORIES = [
  { key: "defi", label: "DeFi", hint: "Trading, liquidity, yield" },
  { key: "agents", label: "AI agents", hint: "An autonomous agent is the product" },
  { key: "meme", label: "Meme", hint: "Community and culture first" },
  { key: "gaming", label: "Gaming", hint: "Games, items, in-game economies" },
  { key: "infra", label: "Infrastructure", hint: "Tooling, data, developer services" },
  { key: "rwa", label: "Real-world assets", hint: "Something off-chain backs it" },
  { key: "social", label: "Social", hint: "Creators, communities, media" },
  { key: "other", label: "Other", hint: "None of the above fits" },
] as const;

export type MarketCategory = (typeof MARKET_CATEGORIES)[number]["key"];

/** Dipakai kalau pemanggil tidak menyebut apa pun. Sama dengan bawaan registry sebelumnya. */
export const DEFAULT_CATEGORY: MarketCategory = "defi";

const KEYS = new Set<string>(MARKET_CATEGORIES.map((c) => c.key));

/**
 * Normalkan kategori yang datang dari klien.
 *
 * JATUH KE BAWAAN, TIDAK MENOLAK — dan itu berbeda dengan cara `image` ditangani di endpoint
 * yang sama, jadi perbedaannya perlu disebut. Gambar yang melewati batas ditolak 400 karena ia
 * risiko sumber daya: nilainya tersimpan inline di registry yang di-parse utuh. Kategori yang
 * tidak dikenal tidak membebani apa pun; ia hanya memecah tab di /explorer. Menolak peluncuran
 * karena satu string kosmetik akan menggagalkan pencatatan pasar yang SUDAH hidup di chain,
 * dan itu jauh lebih mahal daripada kategorinya turun ke "defi".
 */
export function normalizeCategory(input: unknown): MarketCategory {
  if (typeof input !== "string") return DEFAULT_CATEGORY;
  const key = input.toLowerCase().trim();
  return KEYS.has(key) ? (key as MarketCategory) : DEFAULT_CATEGORY;
}
