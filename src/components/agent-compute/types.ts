/**
 * Tipe sisi peramban untuk halaman Agent Compute. Bentuknya sama dengan `sourceView()` di
 * `src/lib/agent-compute-catalog.ts` dan baris `stakes` di `/api/agent/keys`; ditulis ulang di sini
 * supaya komponen klien tidak mengimpor modul server (registry, fs) walau hanya untuk tipe.
 */
export type TierView = { label: string; stake: number; allowance: number };

export type SourceView = {
  id: string;
  kind: "tiered" | "hub";
  chainId: number;
  chainName: string;
  symbol: string;
  name: string;
  token: string;
  decimals: number;
  contract: string | null;
  minStake: number;
  buyHref: string;
  tiers: TierView[];
  hidden: boolean;
  eligible: boolean | null;
  deployedAt: number | null;
  totalStaked: number | null;
  stakers: number | null;
  feesNative: number | null;
  nativeSymbol: string | null;
  budgetUsd: number | null;
  budgetTokens: number | null;
  shareBps: number | null;
  usdPerMillionTokens: number | null;
};

export type KeyView = {
  keyPrefix: string;
  createdAt: string;
  tierLabel: string | null;
  allowance: number;
  usedInput: number;
  usedOutput: number;
  requests: number;
  active: boolean;
  disabledReason: string | null;
  stakeSource: string | null;
  lastSweepAt: string | null;
  accrued: number | null;
};

/** Satu sumber untuk dompet yang tersambung, dari `/api/agent/keys?address=`. */
export type WalletRow = {
  id: string;
  kind: "tiered" | "hub";
  staked: number | null;
  error: string | null;
  tier: TierView | null;
  key: KeyView | null;
  source: SourceView;
};

export type WalletStatus = {
  configured: boolean;
  durable: boolean;
  address: string | null;
  stakes: WalletRow[];
  unreadable?: number;
};

export type DirectorySort = "staked" | "stakers" | "funded" | "newest" | "name";

export type DirectoryResponse = {
  items: SourceView[];
  total: number;
  page: number;
  pages: number;
  limit: number;
  sort: DirectorySort;
  counts: Record<string, number>;
  summary: {
    markets: number;
    tiered: number;
    chains: number;
    keysIssued: number | null;
    keysActive: number | null;
  };
  refreshedAt: string | null;
  warming: boolean;
};

const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const short = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** 12,345 */
export const fmt = (n: number) => whole.format(n);
/** 12.3K, 4.2M — untuk kolom sempit. Di bawah 10.000 tetap angka penuh supaya minimum terbaca persis. */
export const fmtShort = (n: number) => (Math.abs(n) < 10_000 ? whole.format(n) : short.format(n));
