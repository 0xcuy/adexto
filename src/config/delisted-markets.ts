/**
 * Pasar yang DICABUT dari adexto.xyz karena melanggar /acceptable-use, dengan alasannya, di repo publik.
 *
 * BEDANYA DENGAN `hidden-markets.ts`
 *
 *   - Tersembunyi: pasar uji kami sendiri. Tidak dipajang di daftar, tetapi halamannya, `/api/pool`,
 *     `get_market` dan pembelian x402 tetap jalan.
 *   - Dicabut (berkas ini): pasar yang tidak boleh lagi dilayani. Hilang dari setiap daftar DAN dari
 *     setiap pencarian satu pasar: halamannya menjadi pemberitahuan pencabutan, `/api/pool` menjawab
 *     404 sehingga gerbang x402 menolak menjual, alat MCP/A2A menjawab `unknown_market`, Telegram dan
 *     feed agregator berhenti menyebutnya.
 *
 * KENAPA BERKAS, BUKAN MENGHAPUS BARIS REGISTRY DI VPS
 *
 * $CURB dan $ADX dulu dicabut dengan menyunting `projects.json` produksi dengan tangan. Tiga akibatnya:
 * tidak ada catatan publik kenapa, tickernya menjadi "bebas" lagi di registry (padahal di factory tetap
 * terpakai selamanya), dan data produksi disunting langsung. Di sini barisnya tetap ada, tickernya tetap
 * terpakai (`checkSymbolAvailable` membaca `listProjects()` penuh), dan setiap pencabutan punya alasan
 * yang bisa dibaca siapa pun lewat riwayat git.
 *
 * Yang TIDAK bisa dilakukan, dan dinyatakan di halaman pencabutan: kontraknya tanpa owner, jadi trade
 * langsung ke kurva tetap jalan dan tidak ada yang bisa dibekukan atau dikembalikan.
 *
 * Darurat: `ADEXTO_DELISTED_MARKETS` (env, `chainId:SYMBOL` dipisah koma) mencabut tanpa menunggu
 * deploy. Itu jalan sementara; catatannya tetap harus masuk ke daftar di bawah pada deploy berikutnya.
 * Tes juga memakainya.
 */
export interface DelistedMarket {
  chainId: number;
  /** Ticker, huruf besar. */
  symbol: string;
  /** Alamat token, supaya catatannya tidak ambigu kalau dibaca tanpa registry. */
  token: string;
  /** Alasan publik, dalam bahasa Inggris. Merujuk aturan di /acceptable-use. */
  reason: string;
  /** Tanggal keputusan, YYYY-MM-DD. */
  decidedAt: string;
}

export const DELISTED_MARKETS: readonly DelistedMarket[] = [];

const ENV_REASON = "Removed from this site for breaking the acceptable use policy.";

function envEntries(): DelistedMarket[] {
  return (process.env.ADEXTO_DELISTED_MARKETS || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d+:[A-Za-z0-9]{2,12}$/.test(s))
    .map((s) => {
      const [chainId, symbol] = s.split(":");
      return { chainId: Number(chainId), symbol: symbol.toUpperCase(), token: "", reason: ENV_REASON, decidedAt: "" };
    });
}

/** Catatan pencabutan pasar ini, atau null. */
export function delistedEntry(chainId: number, symbol: string | null | undefined): DelistedMarket | null {
  if (!symbol) return null;
  const want = String(symbol).toUpperCase();
  const id = Number(chainId);
  return (
    DELISTED_MARKETS.find((d) => d.chainId === id && d.symbol.toUpperCase() === want) ??
    envEntries().find((d) => d.chainId === id && d.symbol === want) ??
    null
  );
}

export function isDelistedMarket(chainId: number, symbol: string | null | undefined): boolean {
  return delistedEntry(chainId, symbol) !== null;
}
