/**
 * Bagian launch kit yang murni (tanpa jaringan), dipakai Studio, halaman token dan kartu bukti.
 *
 * Aman diimpor dari komponen klien: hanya tipe yang diambil dari `launch-proof.ts`.
 */
import type { LaunchProof } from "@/lib/launch-proof";
import { composeLinks, marketUrlFor } from "@/lib/launch-announcement";

/** Tautan halaman token yang membawa kartu bukti sebagai pratinjau dan menggulir ke panelnya. */
export function launchProofUrlFor(origin: string, slug: string, chainId: number): string {
  return `${marketUrlFor(origin, slug, chainId)}&proof=1`;
}

/** Jangkar panel "Clean launch" di halaman token. */
export const CLEAN_LAUNCH_ANCHOR = "clean-launch";
/** Jangkar panel stake di halaman token. */
export const STAKE_ANCHOR = "stake";

/**
 * Draf post X untuk bukti launch: hanya baris yang benar-benar lolos pemeriksaan. Pemeriksaan yang
 * gagal tidak ditulis sebagai klaim, dan tautannya membawa pembaca ke panel yang menyebut semuanya.
 */
export function proofPostText(p: Pick<LaunchProof, "checks" | "launchWindow" | "feeSplit">, symbol: string, chainName: string): string {
  const ok = (id: string) => p.checks.some((c) => c.id === id && c.ok === true);
  const w = p.launchWindow;
  const cap = `${(w.capBps / 100).toFixed(w.capBps % 100 === 0 ? 0 : 2)}%`;
  const lines: string[] = [];
  if (ok("creator-zero")) lines.push("• creator held 0 tokens at launch");
  if (ok("supply-in-curve")) lines.push("• 100% of supply went into the curve");
  if (ok("launch-window")) {
    lines.push(
      w.kind === "wallet-cap-seconds"
        ? `• ${w.seconds}s launch window, max ${cap} per wallet`
        : `• first ${w.blocks} blocks capped at ${cap} per transfer`
    );
  }
  if (ok("fees-fixed")) lines.push(`• fees fixed at ${(p.feeSplit.totalBps / 100).toFixed(2)}% forever`);
  if (ok("no-owner")) lines.push("• no owner, no proxy");
  const head = `$${symbol.toUpperCase()} on ${chainName}: the launch facts, read from chain.`;
  return [head, "", ...lines, "", "Check it yourself:"].join("\n");
}

/** Composer X/Farcaster untuk teks bukti; tautannya tautan bukti, supaya pratinjaunya kartu bukti. */
export function proofComposeLinks(body: string, proofUrl: string) {
  return composeLinks(body, proofUrl);
}

/**
 * Deep link "tambahkan bot alert ke grup Telegram-mu". Null tanpa username bot (dari
 * `/api/telegram/info`, P2.2): tanpa bot, tombolnya akan membuka halaman t.me kosong.
 *
 * Parameter `startgroup` hanya boleh [A-Za-z0-9_-] dan maksimal 64 karakter. Bentuknya
 * `<chainId>_<token>` (huruf kecil), 48 karakter; `/start` di `src/lib/telegram-bot.ts` membacanya.
 */
export function telegramAlertLink(botUsername: string | null | undefined, chainId: number, token: string): string | null {
  const bot = (botUsername ?? "").trim().replace(/^@/, "");
  if (!/^[A-Za-z][A-Za-z0-9_]{3,31}bot$/i.test(bot)) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(token)) return null;
  return `https://t.me/${bot}?startgroup=${chainId}_${token.toLowerCase()}`;
}

/** Id chain di DEX Screener. 0G tidak didukung DEX Screener (terukur: tidak ada slug yang menjawab). */
export const DEXSCREENER_CHAIN: Record<number, string> = { 8453: "base", 42161: "arbitrum", 143: "monad", 4663: "robinhood" };
/** Id jaringan GeckoTerminal; kelima chain didukung. */
export const GECKOTERMINAL_NETWORK: Record<number, string> = { 8453: "base", 42161: "arbitrum", 143: "monad", 4663: "robinhood", 16661: "0g" };

export type ListingState = "listed" | "not-listed" | "unsupported-chain" | "unknown";

export interface AggregatorListing {
  name: "DEX Screener" | "GeckoTerminal";
  state: ListingState;
  /** Halaman pasar di agregator bila sudah terdaftar. */
  url: string | null;
}

export interface ListingStatus {
  chainId: number;
  token: string;
  aggregators: AggregatorListing[];
  checkedAt: number;
}
