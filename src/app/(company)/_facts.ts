/**
 * Fakta yang dipakai halaman Company, diambil dari sumber yang sama dengan bagian situs lain.
 *
 * KENAPA BERKAS INI ADA
 *
 * Halaman About menulis "four mainnets" dengan tangan, dan kalimat itu tetap berbunyi begitu
 * berhari-hari sesudah Robinhood Chain hidup. Angka yang bisa dibaca dari kode — chain yang bisa
 * meluncurkan, jumlah pasar terdaftar, jumlah alat MCP, skill A2A — diambil dari kode di sini,
 * supaya halaman hukum dan halaman "tentang" tidak bisa tertinggal lagi dari produknya.
 *
 * Yang tidak bisa dibaca dari kode (riwayat, keputusan) tetap ditulis di halamannya, dengan
 * tanggal di `UPDATED`.
 */
import { CHAIN_LIST } from "@/lib/chains";
import { MCP_OUTPUTS } from "@/lib/mcp-outputs";
import launchRecord from "@/config/onchain-launches.json";

/** Tanggal revisi isi halaman Company. Diubah tangan saat isinya diubah, bukan `new Date()`. */
export const UPDATED = "5 October 2026";

const DISPLAY: Record<number, string> = {
  143: "Monad",
  42161: "Arbitrum One",
  4663: "Robinhood Chain",
  8453: "Base",
  16661: "0G",
};

/** Chain yang benar-benar bisa meluncurkan di build ini, dengan nama seperti yang diucapkan. */
export const LAUNCH_CHAINS: string[] = CHAIN_LIST.filter((c) => c.dexLive && c.curveFactoryAddress && DISPLAY[c.chainId]).map(
  (c) => DISPLAY[c.chainId]
);

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export const chainCountWord = NUMBER_WORDS[LAUNCH_CHAINS.length] ?? String(LAUNCH_CHAINS.length);

/** "Monad, Arbitrum One, Robinhood Chain, Base and 0G". */
export const chainSentence =
  LAUNCH_CHAINS.length > 1 ? `${LAUNCH_CHAINS.slice(0, -1).join(", ")} and ${LAUNCH_CHAINS[LAUNCH_CHAINS.length - 1]}` : LAUNCH_CHAINS.join("");

/** Pasar yang terdaftar di situs, dari inventaris yang dijaga `audit_consistency.mjs`. */
export const LISTED_MARKETS: number = Number((launchRecord as { listedMarkets: number }).listedMarkets);

/** Alat server MCP: satu `outputSchema` per alat terdaftar. */
export const MCP_TOOL_COUNT: number = Object.keys(MCP_OUTPUTS).length;

/** Repositori publik. */
export const REPOS = [
  { name: "0xcuy/adexto", what: "contracts, tests, the web app, the MCP and A2A servers, the x402 gateway and the indexers" },
  { name: "0xcuy/adexto-mcp", what: "MCP connection guides, the tool reference and an agent kit that signs with your own key" },
  { name: "0xcuy/adexto-arbitrum", what: "the Arbitrum One engineering" },
  { name: "0xcuy/adexto-monad", what: "the Monad engineering" },
] as const;

/** Spread x402 bawaan gateway, sama dengan `X402_SPREAD_BPS` di Worker. Kutipan menyebut nilai yang berlaku. */
export const X402_SPREAD_PERCENT = "3%";
