/**
 * Adapter HTTP DEX Screener untuk pasar ADEXTO.
 *
 * SPESIFIKASI YANG DIIKUTI
 *
 * "DEX Screener Adapter Specs" v1.1 (Des 2023), dibaca 2 Okt 2026 dari
 * https://dexscreener.notion.site/DEX-Screener-Adapter-Specs-cc1223cdf6e74a7799599106b65dcd0e
 * Empat endpoint relatif terhadap satu root per chain: `/latest-block`, `/asset?id=`,
 * `/pair?id=`, `/events?fromBlock=&toBlock=` (keduanya inklusif). Aturan yang membentuk desain:
 *
 *   - Indexer menanyakan SETIAP BLOK SEKALI. Data yang dilayani harus final saat ditanya.
 *   - `/latest-block` harus sinkron dengan `/events`: tidak boleh menyebut blok yang datanya
 *     belum tersedia.
 *   - Skema yang tidak valid atau nilai tak terduga (misalnya `priceNative = 0`) menghentikan
 *     indexing. Jadi lebih baik 5xx (indexer mencoba lagi) daripada data setengah.
 *   - Properti Pair immutable: indexer tidak menanyakan pair yang sama dua kali.
 *
 * KENAPA EVENTS DIBACA LANGSUNG DARI CHAIN, BUKAN DARI `market-index.ts`
 *
 * `market-index.ts` per pasar dan diperbarui malas per permintaan halaman, dan ia tidak
 * menyimpan `transactionIndex`, reserve, ataupun jumlah mentah (hanya float). Spesifikasi
 * menuntut ketiganya. Jadi adapter ini membaca log kurva per rentang blok untuk semua pasar
 * sebuah chain dalam satu `eth_getLogs`, dengan kedalaman konfirmasi YANG SAMA dengan indeks
 * itu (`confirmationsFor`) dan petak `getLogs` yang sama (`logSpanFor`). Registry dipakai
 * untuk memilih pasar yang ditampilkan dan sebagai petunjuk blok peluncuran.
 *
 * DAFTAR PASAR DIBACA DARI FACTORY, BUKAN DARI REGISTRY SAJA
 *
 * Karena tiap blok hanya ditanya sekali, pasar yang belum dikenal saat bloknya dilayani akan
 * hilang selamanya dari DEX Screener. Registry baru tahu sebuah pasar setelah Studio
 * mendaftarkannya, beberapa detik sesudah peluncuran — lebih lambat daripada konfirmasi di
 * Monad (3 blok). Jadi `totalProjectsCount()` setiap factory dibaca PADA BLOK `safe` itu
 * sendiri, dan `/latest-block` tidak pernah melewati blok tempat daftar itu terakhir dibaca.
 *
 * Komentar boleh Indonesia; semua teks yang keluar lewat HTTP English (README §2).
 */
import { ethers } from "ethers";
import { CHAINS, logReadProvider, readProvider, type ChainInfo, type ChainKey } from "@/lib/chains";
import { ADEXTO_CURVE_ABI } from "@/lib/dex";
import { confirmationsFor } from "@/lib/market-index";
import { logSpanFor } from "@/lib/onchain-trades";
import { listProjects, type ProjectRecord } from "@/lib/registry";
import { isHiddenMarket } from "@/config/hidden-markets";
import { isDelistedMarket } from "@/config/delisted-markets";
import { readJson, writeJson } from "@/lib/server-store";
import launchRecord from "@/config/onchain-launches.json";
import v1Deployments from "@/config/factory-deployments.json";

export const DEX_KEY = "adexto";
export const SPEC_VERSION = "DEX Screener Adapter Specs v1.1";
const PUBLIC_ORIGIN = "https://adexto.xyz";
const NATIVE_DECIMALS = 18;

export type ChainSlug = "base" | "arbitrum" | "monad" | "robinhood";

interface FactoryRef {
  address: string;
  version: string;
}

export interface AdapterChain {
  slug: ChainSlug;
  chain: ChainInfo;
  /** Wrapped native kanonik di chain ini, dipakai sebagai id asset1. */
  wrappedNative: string;
  factories: FactoryRef[];
}

/**
 * Factory ADEXTO per chain yang kurvanya memancarkan `Swap` 11 field dan
 * `AutoBuybackExecuted` 5 field (generasi 0.11.0, 0.12.0, 1.0.0 — tanda tangan event sengaja
 * dipertahankan sejak 0.11.0, lihat `contracts/AdextoFactory.sol`).
 *
 * Diperiksa ke chain 2 Okt 2026: `VERSION()` setiap alamat cocok, dan isinya
 *   Base       0.11.0: BLOOP              0.12.0: —                1.0.0: —
 *   Arbitrum   0.11.0: WOMBO              0.12.0: —                1.0.0: SAI
 *   Monad      0.11.0: CURB (uji), PARCEL 0.12.0: VOLT (uji)       1.0.0: SAI
 *   Robinhood  1.0.0: SAI (tanpa generasi lebih lama)
 *
 * Factory 0.10.0 di Base/Arbitrum/Monad TIDAK dimasukkan: `totalProjectsCount()` = 0 di
 * ketiganya, dan kurvanya memancarkan `Swap` 10 field dengan topic0 lain. Factory Base
 * `0x5a2f13f1…` yang terbuang tidak boleh masuk konfigurasi mana pun (`src/config/contracts.ts`).
 */
const KNOWN_FACTORIES: Record<ChainSlug, FactoryRef[]> = {
  base: [
    { address: "0x216E7880D64D94335B583c539802d3e61958d4A2", version: "0.11.0" },
    { address: "0xe5B9555fbbcE72A5739dD29c3939A23fd230136F", version: "0.12.0" },
    { address: "0xF5f904ca7763Fc6755bbCe5466a9DBd4C15c2708", version: "1.0.0" },
  ],
  arbitrum: [
    { address: "0xE17f1027FC5f294327D701829baeD9d6519e922C", version: "0.11.0" },
    { address: "0x75EeDEd196D2BE283d815D52F617eB70bCe865bC", version: "0.12.0" },
    { address: "0x79DF3671e7e7456832C84a34c2bC0DB7871C0E0E", version: "1.0.0" },
  ],
  monad: [
    { address: "0x5800e9715a47a598fce9bc3B65a95FD6BeBf76A3", version: "0.11.0" },
    { address: "0xcA9c77f050CD1e0685b03D0236579966DA9B39B9", version: "0.12.0" },
    { address: "0x3dFcBEd7dd889F465cC9f75c430B43Ef873b6056", version: "1.0.0" },
  ],
  robinhood: [{ address: "0x8e63e117E71A80Cfc10fDF375F079e2e29cd7D7D", version: "1.0.0" }],
};

/**
 * Wrapped native kanonik. Kurva menerima dan membayar NATIVE (`msg.value`), bukan token ini;
 * alamatnya dipakai sebagai id asset1 supaya DEX Screener bisa memberi harga USD pada kaki
 * native, sama seperti launchpad bonding-curve native lain dilaporkan sebagai TOKEN/WETH.
 * `name()`/`symbol()`/`decimals()` keempatnya dibaca dari chain 2 Okt 2026 (semuanya 18
 * desimal). Robinhood: alamat WETH dari https://docs.robinhood.com/chain/contracts.
 */
const CHAIN_SLUGS: Record<ChainSlug, { key: ChainKey; wrappedNative: string }> = {
  base: { key: "Base", wrappedNative: "0x4200000000000000000000000000000000000006" },
  arbitrum: { key: "Arbitrum", wrappedNative: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" },
  monad: { key: "Monad", wrappedNative: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A" },
  robinhood: { key: "Robinhood", wrappedNative: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" },
};

export const CHAIN_ORDER: ChainSlug[] = ["base", "arbitrum", "monad", "robinhood"];

/** Generasi kurva yang event-nya dipahami adapter ini. */
const SUPPORTED_CURVE_VERSIONS = new Set(["0.11.0", "0.12.0", "1.0.0"]);

/** Batas petak per permintaan `/events`: rentang maksimum = `logSpanFor` × angka ini. */
const MAX_WINDOWS_PER_REQUEST = 25;
/** Alamat kurva per satu `eth_getLogs`. */
const ADDRESS_CHUNK = 50;
/** `/latest-block` di-cache sependek ini. Indexer menanyainya terus-menerus. */
const LATEST_TTL_MS = 3_000;
const EVENTS_TTL_MS = 5 * 60_000;
const EVENTS_CACHE_MAX = 200;
const SUPPLY_TTL_MS = 60_000;
const BLOCK_TIME_CACHE_MAX = 20_000;
/** Pekerjaan `/events` berbarengan per chain, dan antrean maksimum di belakangnya. */
const MAX_PARALLEL = 2;
const MAX_QUEUE = 20;

const FACTORY_ABI = [
  "function totalProjectsCount() view returns (uint256)",
  "function projectAt(uint256 index) view returns (address token, address curve, address creator, string symbol, uint256 deployedAt)",
  "event TrinityProjectDeployed(address indexed token, address indexed curve, address indexed creator, string name, string symbol, uint256 initialSupply, uint256 curveTokens, uint256 virtualNative, uint256 depthFeeBps, uint256 creatorFeeBps, uint256 treasuryBuybackBps, bytes32 metadataRoot)",
];
const TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
];

const CURVE_IFACE = new ethers.Interface(ADEXTO_CURVE_ABI);
const FACTORY_IFACE = new ethers.Interface(FACTORY_ABI);
const SWAP_TOPIC = CURVE_IFACE.getEvent("Swap")!.topicHash;
const BUYBACK_TOPIC = CURVE_IFACE.getEvent("AutoBuybackExecuted")!.topicHash;
const DEPLOYED_TOPIC = FACTORY_IFACE.getEvent("TrinityProjectDeployed")!.topicHash;

// ─── Bentuk respons (spesifikasi §Schemas) ────────────────────────────────────

export interface AdapterBlock {
  blockNumber: number;
  blockTimestamp: number;
}

export interface AdapterSwapEvent {
  block: AdapterBlock;
  eventType: "swap";
  txnId: string;
  txnIndex: number;
  eventIndex: number;
  maker: string;
  pairId: string;
  asset0In?: string;
  asset1In?: string;
  asset0Out?: string;
  asset1Out?: string;
  priceNative: string;
  reserves: { asset0: string; asset1: string };
  metadata?: Record<string, string>;
}

export interface AdapterAsset {
  id: string;
  name: string;
  symbol: string;
  totalSupply?: string;
}

export interface AdapterPair {
  id: string;
  dexKey: string;
  asset0Id: string;
  asset1Id: string;
  createdAtBlockNumber?: number;
  createdAtBlockTimestamp?: number;
  createdAtTxnId?: string;
  creator?: string;
  feeBps?: number;
  metadata?: Record<string, string>;
}

/** Galat yang boleh dilihat pemanggil: status HTTP dan pesan English. */
export class AdapterError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfter?: number
  ) {
    super(message);
  }
}

// ─── Konfigurasi chain ────────────────────────────────────────────────────────

function factoriesFor(slug: ChainSlug, chain: ChainInfo): FactoryRef[] {
  const out = new Map<string, FactoryRef>();
  for (const f of KNOWN_FACTORIES[slug]) out.set(f.address.toLowerCase(), f);
  // Factory dari env ikut dibaca supaya generasi berikutnya tidak terlewat begitu env-nya
  // ditukar. Versinya tetap dibaca per kurva dari chain.
  for (const address of [chain.curveFactoryAddress, chain.supersededCurveFactoryAddress]) {
    if (address && !out.has(address.toLowerCase())) {
      out.set(address.toLowerCase(), { address: ethers.getAddress(address), version: "configured" });
    }
  }
  return [...out.values()];
}

/** `base`, `arbitrum`, `monad`, `robinhood`, atau chainId-nya. Selain itu null. */
export function adapterChain(param: string | null | undefined): AdapterChain | null {
  const raw = String(param ?? "").trim().toLowerCase();
  let slug: ChainSlug | null = null;
  // `hasOwnProperty`, bukan `in`: `in` menelusuri prototipe, jadi `/api/dextools/constructor/block`
  // lolos sebagai chain, lalu `KNOWN_FACTORIES["constructor"]` melempar "not iterable" SEBELUM
  // batas laju dihitung — 500 dan log galat tanpa batas untuk siapa pun yang memintanya.
  if (Object.prototype.hasOwnProperty.call(CHAIN_SLUGS, raw)) slug = raw as ChainSlug;
  else if (/^\d+$/.test(raw)) {
    slug = CHAIN_ORDER.find((s) => CHAINS[CHAIN_SLUGS[s].key].chainId === Number(raw)) ?? null;
  }
  if (!slug) return null;
  const chain = CHAINS[CHAIN_SLUGS[slug].key];
  return { slug, chain, wrappedNative: CHAIN_SLUGS[slug].wrappedNative, factories: factoriesFor(slug, chain) };
}

export function maxBlocksPerRequest(chainId: number): number {
  return logSpanFor(chainId) * MAX_WINDOWS_PER_REQUEST;
}

// ─── Keadaan per chain ────────────────────────────────────────────────────────

export interface CreatedAt {
  blockNumber: number;
  blockTimestamp: number;
  txnId: string;
}

/** Fakta immutable satu pasar, dibaca sekali dari chain lalu disimpan. */
export interface StoredMarket {
  pairId: string;
  tokenId: string;
  factory: string;
  factoryIndex: number;
  creator: string;
  name: string;
  symbol: string;
  decimals: number;
  curveVersion: string;
  /** Wei, string desimal. */
  virtualNative: string;
  feeBps: number;
  /** `deployedAt` dari factory (detik). */
  deployedAt: number;
  created?: CreatedAt;
}

interface StoredState {
  version: 1;
  chainId: number;
  /** Jumlah entri `allProjects` yang sudah dimuat, per factory (huruf kecil). */
  counts: Record<string, number>;
  /** Per alamat kurva huruf kecil. */
  markets: Record<string, StoredMarket>;
}

export interface Runtime {
  cfg: AdapterChain;
  call: ethers.JsonRpcProvider;
  logs: ethers.JsonRpcProvider;
  state: StoredState;
  /** Daftar pasar lengkap sampai blok ini (inklusif). -1 sebelum dibaca di proses ini. */
  knownThrough: number;
  /** Waktu penemuan terakhir selesai (ms), untuk membatasi penemuan yang dipicu id tak dikenal. */
  discoveredAt: number;
  discovering: Promise<void> | null;
  latest: { block: AdapterBlock; at: number } | null;
  latestInflight: Promise<AdapterBlock> | null;
  blockTimes: Map<number, number>;
  events: Map<string, { at: number; events: unknown[] }>;
  supply: Map<string, { at: number; value: string }>;
  wrapped: AdapterAsset | null;
  active: number;
  queue: Array<() => void>;
}

declare global {
  var __ADEXTO_DEXSCREENER_V1__: Map<number, Runtime> | undefined;
}

function runtimes(): Map<number, Runtime> {
  if (!(globalThis.__ADEXTO_DEXSCREENER_V1__ instanceof Map)) globalThis.__ADEXTO_DEXSCREENER_V1__ = new Map();
  return globalThis.__ADEXTO_DEXSCREENER_V1__;
}

const stateFile = (chainId: number) => `dexscreener-${chainId}.json`;

function loadState(chainId: number): StoredState {
  const raw = readJson<StoredState | null>(stateFile(chainId), null);
  if (raw && raw.version === 1 && raw.chainId === chainId && raw.counts && raw.markets) return raw;
  return { version: 1, chainId, counts: {}, markets: {} };
}

function persist(rt: Runtime): void {
  writeJson(stateFile(rt.cfg.chain.chainId), rt.state);
}

export function runtime(cfg: AdapterChain): Runtime {
  const map = runtimes();
  const existing = map.get(cfg.chain.chainId);
  if (existing) return existing;
  const rt: Runtime = {
    cfg,
    call: readProvider(cfg.chain),
    logs: logReadProvider(cfg.chain),
    state: loadState(cfg.chain.chainId),
    knownThrough: -1,
    discoveredAt: 0,
    discovering: null,
    latest: null,
    latestInflight: null,
    blockTimes: new Map(),
    events: new Map(),
    supply: new Map(),
    wrapped: null,
    active: 0,
    queue: [],
  };
  map.set(cfg.chain.chainId, rt);
  return rt;
}

// ─── Utilitas ─────────────────────────────────────────────────────────────────

/**
 * Panggilan RPC dengan percobaan ulang. Galat akhirnya menjadi 503 tanpa membawa pesan
 * mentah RPC ke luar (pesan itu bisa berisi URL penyedia); pesan aslinya ke log server.
 */
async function rpc<T>(rt: Runtime, label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      if (i < attempts) await new Promise((r) => setTimeout(r, 300 * i * i));
    }
  }
  const detail = String((last as any)?.error?.message ?? (last as any)?.shortMessage ?? (last as any)?.message ?? last);
  console.warn(`[dexscreener] ${rt.cfg.slug} ${label} failed: ${detail.slice(0, 300)}`);
  throw new AdapterError(503, `Upstream RPC request failed (${label}) on ${rt.cfg.chain.name}. Retry shortly.`, 5);
}

/** `numer / denom` sebagai desimal tepat sampai `places` angka di belakang koma, dibulatkan ke bawah. */
function ratioString(numer: bigint, denom: bigint, places: number): string {
  if (denom <= 0n) throw new AdapterError(500, "Division by a non-positive reserve.");
  const scaled = (numer * 10n ** BigInt(places)) / denom;
  if (places === 0) return scaled.toString();
  const digits = scaled.toString().padStart(places + 1, "0");
  const whole = digits.slice(0, -places);
  const frac = digits.slice(-places).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/** Jumlah mentah → string desimal tepat (`amount / 10 ** decimals`), tanpa nol di ekor. */
export function decimalString(value: bigint, decimals: number): string {
  return ratioString(value, 10n ** BigInt(decimals), decimals);
}

export function normalizeAddress(id: string | null): string {
  const raw = String(id ?? "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(raw)) throw new AdapterError(400, "Query parameter `id` must be a 0x-prefixed 20-byte address.");
  return ethers.getAddress(raw.toLowerCase());
}

export function registryRecord(rt: Runtime, curveOrToken: string): ProjectRecord | null {
  const needle = curveOrToken.toLowerCase();
  return (
    listProjects().find(
      (p) =>
        p.chainId === rt.cfg.chain.chainId &&
        (p.tokenAddress.toLowerCase() === needle || (p.poolAddress ?? "").toLowerCase() === needle)
    ) ?? null
  );
}

type LaunchRow = { chainId: number; curve: string; status: string };
const LAUNCHES: LaunchRow[] = (launchRecord as { launches: LaunchRow[] }).launches;

/**
 * Kenapa sebuah pasar factory tidak dilayani, atau null kalau dilayani.
 *
 * Yang dikecualikan hanya pasar yang KITA SENDIRI tandai `test` atau `superseded` di
 * `onchain-launches.json` (latihan rekaman, pasar yang digantikan) dan tidak ada di registry.
 * Pasar lain dari factory ADEXTO — termasuk peluncuran langsung ke factory tanpa Studio —
 * tetap dilayani: itu pasar ADEXTO di chain, dan agregator memang menampilkan semuanya.
 */
function exclusion(rt: Runtime, m: StoredMarket): string | null {
  if (!SUPPORTED_CURVE_VERSIONS.has(m.curveVersion)) return `curve version ${m.curveVersion} is not covered`;
  // Pasar tersembunyi (src/config/hidden-markets.ts) tidak dilayani ke agregator, meski terdaftar.
  // Diperiksa dari simbol on-chain juga, supaya tetap tersaring sebelum masuk registry.
  if (isHiddenMarket(rt.cfg.chain.chainId, m.symbol)) return "hidden market";
  // Pasar yang dicabut (src/config/delisted-markets.ts) juga tidak disajikan ke agregator.
  if (isDelistedMarket(rt.cfg.chain.chainId, m.symbol)) return "delisted market";
  if (registryRecord(rt, m.pairId)) return null;
  const row = LAUNCHES.find(
    (l) => l.chainId === rt.cfg.chain.chainId && l.curve.toLowerCase() === m.pairId.toLowerCase()
  );
  if (row && (row.status === "test" || row.status === "superseded")) return `${row.status} market`;
  return null;
}

export function servedMarkets(rt: Runtime): StoredMarket[] {
  return Object.values(rt.state.markets).filter((m) => exclusion(rt, m) === null);
}

export async function blockTime(rt: Runtime, blockNumber: number): Promise<number> {
  const hit = rt.blockTimes.get(blockNumber);
  if (hit !== undefined) return hit;
  const block = await rpc(rt, "eth_getBlockByNumber", () => rt.logs.getBlock(blockNumber));
  if (!block) throw new AdapterError(503, `Block ${blockNumber} is not available from the RPC yet. Retry shortly.`, 5);
  // Sepersepuluh tertua dibuang, bukan seluruh cache. `clear()` memberi siapa pun tombol untuk
  // mengosongkan cache: cukup minta 20.000 blok berbeda lewat `/block?timestamp=`, dan setiap
  // pembaca sesudahnya membayar ulang semua `eth_getBlockByNumber`-nya.
  if (rt.blockTimes.size >= BLOCK_TIME_CACHE_MAX) {
    let drop = Math.max(1, Math.floor(BLOCK_TIME_CACHE_MAX / 10));
    for (const k of rt.blockTimes.keys()) {
      rt.blockTimes.delete(k);
      if (--drop <= 0) break;
    }
  }
  rt.blockTimes.set(blockNumber, Number(block.timestamp));
  return Number(block.timestamp);
}

// ─── Penemuan pasar ──────────────────────────────────────────────────────────

async function describe(
  rt: Runtime,
  factory: FactoryRef,
  index: number,
  row: { token: string; curve: string; creator: string; deployedAt: bigint }
): Promise<StoredMarket> {
  const tokenId = ethers.getAddress(row.token);
  const pairId = ethers.getAddress(row.curve);
  const token = new ethers.Contract(tokenId, TOKEN_ABI, rt.call);
  const curve = new ethers.Contract(pairId, ADEXTO_CURVE_ABI, rt.call);
  // Berurutan, bukan Promise.all: sekali per pasar, dan Base menghukum ledakan panggilan.
  const name = String(await rpc(rt, "name", () => token.name()));
  const symbol = String(await rpc(rt, "symbol", () => token.symbol()));
  const decimals = Number(await rpc(rt, "decimals", () => token.decimals()));
  const curveVersion = String(await rpc(rt, "VERSION", () => curve.VERSION()));
  const virtualNative = BigInt(await rpc(rt, "virtualNative", () => curve.virtualNative()));
  const feeBps = Number(await rpc(rt, "totalFeeBps", () => curve.totalFeeBps()));
  return {
    pairId,
    tokenId,
    factory: ethers.getAddress(factory.address),
    factoryIndex: index,
    creator: ethers.getAddress(row.creator),
    name,
    symbol,
    decimals,
    curveVersion,
    virtualNative: virtualNative.toString(),
    feeBps,
    deployedAt: Number(row.deployedAt),
  };
}

/**
 * Baca `totalProjectsCount()` setiap factory PADA blok `safe`, muat entri baru, lalu tandai
 * daftar pasar lengkap sampai `safe`. Membaca pada blok bernomor (bukan "latest") membuat
 * node yang tertinggal menolak alih-alih diam-diam menjawab daftar yang lebih pendek.
 */
async function runDiscovery(rt: Runtime): Promise<void> {
  const head = await rpc(rt, "eth_blockNumber", () => rt.logs.getBlockNumber());
  const safe = head - confirmationsFor(rt.cfg.chain.chainId);
  let changed = false;
  try {
    for (const f of rt.cfg.factories) {
      const factory = new ethers.Contract(f.address, FACTORY_ABI, rt.call);
      const count = Number(await rpc(rt, "totalProjectsCount", () => factory.totalProjectsCount({ blockTag: safe })));
      const key = f.address.toLowerCase();
      for (let i = rt.state.counts[key] ?? 0; i < count; i++) {
        const row = await rpc(rt, "projectAt", () => factory.projectAt(i, { blockTag: safe }));
        const market = await describe(rt, f, i, row);
        rt.state.markets[market.pairId.toLowerCase()] = market;
        rt.state.counts[key] = i + 1;
        changed = true;
      }
    }
  } finally {
    if (changed) persist(rt);
  }
  rt.knownThrough = Math.max(rt.knownThrough, safe);
  rt.discoveredAt = Date.now();
}

function discoverNow(rt: Runtime): Promise<void> {
  if (!rt.discovering) rt.discovering = runDiscovery(rt).finally(() => (rt.discovering = null));
  return rt.discovering;
}

/** Pastikan daftar pasar lengkap sampai `block`; kalau blok itu belum final, 400. */
async function discoverThrough(rt: Runtime, block: number): Promise<void> {
  for (let attempt = 0; attempt < 2 && rt.knownThrough < block; attempt++) await discoverNow(rt);
  if (rt.knownThrough < block) {
    throw new AdapterError(
      400,
      `Block ${block} is not final on ${rt.cfg.chain.name} yet. Ask /latest-block for the newest block with data.`
    );
  }
}

// ─── Endpoint ────────────────────────────────────────────────────────────────

/**
 * Blok terbaru yang datanya tersedia di `/events`: kepala chain dikurangi konfirmasi, dan
 * tidak pernah melewati blok tempat daftar pasar terakhir dibaca. Tidak pernah mundur.
 */
export async function latestBlock(rt: Runtime): Promise<AdapterBlock> {
  if (rt.latest && Date.now() - rt.latest.at < LATEST_TTL_MS) return rt.latest.block;
  if (!rt.latestInflight) {
    rt.latestInflight = (async () => {
      await discoverNow(rt);
      const blockNumber = Math.max(rt.knownThrough, rt.latest?.block.blockNumber ?? -1);
      const block = { blockNumber, blockTimestamp: await blockTime(rt, blockNumber) };
      rt.latest = { block, at: Date.now() };
      return block;
    })().finally(() => (rt.latestInflight = null));
  }
  return rt.latestInflight;
}

/**
 * Antrean sederhana: paling banyak `MAX_PARALLEL` pembacaan log per chain sekaligus. Slot
 * diserahkan langsung ke penunggu berikutnya, jadi tidak ada celah tempat permintaan baru
 * menyalip dan melampaui batas.
 */
async function gate<T>(rt: Runtime, fn: () => Promise<T>): Promise<T> {
  if (rt.active >= MAX_PARALLEL) {
    if (rt.queue.length >= MAX_QUEUE) throw new AdapterError(503, "Adapter is busy. Retry shortly.", 2);
    await new Promise<void>((resolve) => rt.queue.push(resolve));
  } else {
    rt.active += 1;
  }
  try {
    return await fn();
  } finally {
    const next = rt.queue.shift();
    if (next) next();
    else rt.active -= 1;
  }
}

function parseBlockParam(url: URL, name: string): number {
  const raw = url.searchParams.get(name);
  if (raw === null || !/^\d{1,12}$/.test(raw.trim())) {
    throw new AdapterError(400, `Query parameter \`${name}\` must be a non-negative block number.`);
  }
  return Number(raw.trim());
}

export function blockRange(url: URL, chainId: number): { fromBlock: number; toBlock: number } {
  const fromBlock = parseBlockParam(url, "fromBlock");
  const toBlock = parseBlockParam(url, "toBlock");
  if (fromBlock > toBlock) throw new AdapterError(400, "`fromBlock` must not be greater than `toBlock`.");
  const max = maxBlocksPerRequest(chainId);
  if (toBlock - fromBlock + 1 > max) {
    throw new AdapterError(400, `At most ${max} blocks per request on this chain. Split the range.`);
  }
  return { fromBlock, toBlock };
}

export function toEvent(m: StoredMarket, log: ethers.Log, blockTimestamp: number): AdapterSwapEvent {
  const parsed = CURVE_IFACE.parseLog({ topics: [...log.topics], data: log.data });
  if (!parsed) throw new AdapterError(500, `Undecodable curve log ${log.transactionHash}:${log.index}.`);
  const nativeAfter = BigInt(parsed.args.nativeReserveAfter);
  const tokenAfter = BigInt(parsed.args.tokenReserveAfter);
  const realNative = nativeAfter - BigInt(m.virtualNative);
  if (realNative < 0n || tokenAfter <= 0n) {
    throw new AdapterError(500, `Unexpected reserves in ${log.transactionHash}:${log.index}.`);
  }
  // Harga spot sesudah event, native per token, dari reserve penentu harga (virtual ikut).
  const priceNative = ratioString(nativeAfter * 10n ** BigInt(m.decimals), tokenAfter * 10n ** BigInt(NATIVE_DECIMALS), 50);
  if (!/[1-9]/.test(priceNative)) throw new AdapterError(500, `Price rounds to zero in ${log.transactionHash}.`);

  const base = {
    block: { blockNumber: log.blockNumber, blockTimestamp },
    eventType: "swap" as const,
    txnId: log.transactionHash,
    txnIndex: log.transactionIndex,
    eventIndex: log.index,
    pairId: m.pairId,
    priceNative,
    // Reserve RIIL: token yang tersisa di kurva, dan native yang benar-benar dipegang kurva.
    reserves: { asset0: decimalString(tokenAfter, m.decimals), asset1: decimalString(realNative, NATIVE_DECIMALS) },
  };

  if (parsed.name === "AutoBuybackExecuted") {
    // Buyback-and-burn: native dari ember buyback kurva membeli token lalu membakarnya.
    // Tidak ada dompet penerima, jadi maker-nya kurva itu sendiri.
    return {
      ...base,
      maker: m.pairId,
      asset1In: decimalString(BigInt(parsed.args.amountIn), NATIVE_DECIMALS),
      asset0Out: decimalString(BigInt(parsed.args.tokensBurned), m.decimals),
      metadata: { kind: "buyback-burn" },
    };
  }

  const isBuy = Boolean(parsed.args.isBuy);
  const amountIn = BigInt(parsed.args.amountIn);
  const amountOut = BigInt(parsed.args.amountOut);
  // Beli: penerima token adalah pemilik sebenarnya (pembelian x402 dikirim relayer atas nama
  // pembayar). Jual: `trader` adalah dompet yang tokennya ditarik kurva.
  const maker = ethers.getAddress(isBuy ? String(parsed.args.recipient) : String(parsed.args.trader));
  return isBuy
    ? {
        ...base,
        maker,
        asset1In: decimalString(amountIn, NATIVE_DECIMALS),
        asset0Out: decimalString(amountOut, m.decimals),
      }
    : {
        ...base,
        maker,
        asset0In: decimalString(amountIn, m.decimals),
        asset1Out: decimalString(amountOut, NATIVE_DECIMALS),
      };
}

/** Satu log dalam rentang, dengan pasarnya dan timestamp bloknya. */
export interface RangeEntry {
  log: ethers.Log;
  market: StoredMarket;
  /** `TrinityProjectDeployed` dari factory (hanya bila diminta), selain itu log kurva. */
  creation: boolean;
  blockTimestamp: number;
}

const topicAddress = (topic: string | undefined) =>
  topic && topic.length === 66 ? ethers.getAddress(`0x${topic.slice(26)}`) : null;

/**
 * Semua log kurva (`Swap`, `AutoBuybackExecuted`) pasar yang dilayani dalam rentang inklusif,
 * berurutan (blok, transaksi, log), dan — bila `withCreations` — log `TrinityProjectDeployed`
 * pasar-pasar itu dari factory-nya. Rentang di atas `/latest-block` ditolak, jadi setiap
 * jawaban final. Satu galat RPC menggagalkan seluruh jawaban: tidak pernah setengah.
 */
export async function rangeEntries(
  rt: Runtime,
  fromBlock: number,
  toBlock: number,
  withCreations: boolean
): Promise<RangeEntry[]> {
  const latest = await latestBlock(rt);
  if (toBlock > latest.blockNumber) await discoverThrough(rt, toBlock);

  return gate(rt, async () => {
    const markets = servedMarkets(rt);
    if (markets.length === 0) return [];
    const byCurve = new Map(markets.map((m) => [m.pairId.toLowerCase(), m]));
    const curves = markets.map((m) => m.pairId);
    const factories = withCreations ? [...new Set(markets.map((m) => m.factory))] : [];
    const span = logSpanFor(rt.cfg.chain.chainId);

    const logs: ethers.Log[] = [];
    for (let start = fromBlock; start <= toBlock; start += span) {
      const end = Math.min(toBlock, start + span - 1);
      for (let i = 0; i < curves.length; i += ADDRESS_CHUNK) {
        const address = curves.slice(i, i + ADDRESS_CHUNK);
        const part = await rpc(rt, "eth_getLogs", () =>
          rt.logs.getLogs({ address, topics: [[SWAP_TOPIC, BUYBACK_TOPIC]], fromBlock: start, toBlock: end })
        );
        logs.push(...part);
      }
      if (factories.length > 0) {
        const part = await rpc(rt, "eth_getLogs", () =>
          rt.logs.getLogs({ address: factories, topics: [DEPLOYED_TOPIC], fromBlock: start, toBlock: end })
        );
        logs.push(...part);
      }
    }

    const seen = new Set<string>();
    const entries: Array<Omit<RangeEntry, "blockTimestamp">> = [];
    for (const log of logs) {
      if (log.removed) continue;
      const id = `${log.blockNumber}:${log.index}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (log.topics[0] === DEPLOYED_TOPIC) {
        const curve = topicAddress(log.topics[2]);
        const market = curve ? byCurve.get(curve.toLowerCase()) : undefined;
        // Hanya peluncuran yang memang dilayani, dan hanya dari factory yang melahirkannya.
        if (market && market.factory.toLowerCase() === log.address.toLowerCase()) entries.push({ log, market, creation: true });
        continue;
      }
      const market = byCurve.get(log.address.toLowerCase());
      if (market) entries.push({ log, market, creation: false });
    }
    entries.sort(
      (a, b) =>
        a.log.blockNumber - b.log.blockNumber || a.log.transactionIndex - b.log.transactionIndex || a.log.index - b.log.index
    );

    const blocks = [...new Set(entries.map((e) => e.log.blockNumber))];
    for (let i = 0; i < blocks.length; i += 4) {
      await Promise.all(blocks.slice(i, i + 4).map((n) => blockTime(rt, n)));
    }
    return entries.map((e) => ({ ...e, blockTimestamp: rt.blockTimes.get(e.log.blockNumber)! }));
  });
}

/** Cache jawaban per rentang. Rentang yang sudah final tidak berubah, jadi aman diulang. */
export async function cachedRange<T>(rt: Runtime, key: string, build: () => Promise<T[]>): Promise<T[]> {
  const hit = rt.events.get(key);
  if (hit && Date.now() - hit.at < EVENTS_TTL_MS) return hit.events as T[];

  // Permintaan identik yang datang bersamaan berbagi SATU pembacaan. Tanpa ini, N permintaan
  // untuk rentang yang sama berarti N kali seluruh `eth_getLogs`-nya, masing-masing memakan
  // slot `gate()` yang dipakai bersama semua pemanggil chain ini.
  const flightKey = `${rt.cfg.chain.chainId}:${key}`;
  const pending = rangeInflight.get(flightKey);
  if (pending) return (await pending) as T[];

  const job = build()
    .then((events) => {
      if (rt.events.size >= EVENTS_CACHE_MAX) rt.events.delete(rt.events.keys().next().value!);
      rt.events.set(key, { at: Date.now(), events });
      return events;
    })
    .finally(() => rangeInflight.delete(flightKey));
  rangeInflight.set(flightKey, job);
  return job;
}

const rangeInflight = new Map<string, Promise<unknown[]>>();

export async function eventsBetween(rt: Runtime, fromBlock: number, toBlock: number): Promise<AdapterSwapEvent[]> {
  return cachedRange(rt, `dexscreener:${fromBlock}:${toBlock}`, async () =>
    (await rangeEntries(rt, fromBlock, toBlock, false)).map((e) => toEvent(e.market, e.log, e.blockTimestamp))
  );
}

export async function marketFor(rt: Runtime, address: string, by: "pair" | "token"): Promise<StoredMarket | null> {
  const find = () =>
    by === "pair"
      ? rt.state.markets[address.toLowerCase()] ?? null
      : Object.values(rt.state.markets).find((m) => m.tokenId.toLowerCase() === address.toLowerCase()) ?? null;
  let m = find();
  // Id yang belum dikenal bisa pasar yang baru lahir, jadi daftar dibaca ulang — tetapi paling
  // sering sekali per `LATEST_TTL_MS`, supaya id acak tidak bisa memaksa RPC di setiap permintaan.
  if (!m && Date.now() - rt.discoveredAt >= LATEST_TTL_MS) {
    await discoverNow(rt);
    m = find();
  }
  return m && exclusion(rt, m) === null ? m : null;
}

/** Blok pertama dengan timestamp >= `t`, lewat pencarian biner. Null kalau belum ada. */
export async function firstBlockAtOrAfter(rt: Runtime, t: number, low: number, high: number): Promise<number | null> {
  if ((await blockTime(rt, high)) < t) return null;
  let lo = Math.max(1, low);
  let hi = high;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((await blockTime(rt, mid)) >= t) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

async function deployLog(rt: Runtime, m: StoredMarket, fromBlock: number, toBlock: number): Promise<ethers.Log | null> {
  const logs = await rpc(rt, "eth_getLogs", () =>
    rt.logs.getLogs({
      address: m.factory,
      topics: [DEPLOYED_TOPIC, ethers.zeroPadValue(m.tokenId.toLowerCase(), 32)],
      fromBlock,
      toBlock,
    })
  );
  return logs.find((l) => l.topics[2]?.toLowerCase() === ethers.zeroPadValue(m.pairId.toLowerCase(), 32)) ?? null;
}

/**
 * Blok dan transaksi peluncuran, dari log `TrinityProjectDeployed` factory itu sendiri.
 *
 * Bukan dari `AdextoToken.launchBlock()`: di chain Arbitrum Nitro (Arbitrum One, Robinhood)
 * `block.number` di dalam kontrak adalah perkiraan nomor blok L1, bukan blok L2.
 * Petunjuk pertama blok peluncuran di registry; kalau tidak ada atau tidak cocok, pencarian
 * biner atas `deployedAt` lalu satu `getLogs` sempit.
 */
export async function creation(rt: Runtime, m: StoredMarket): Promise<CreatedAt | null> {
  if (m.created) return m.created;
  let log: ethers.Log | null = null;
  const hint = Number(registryRecord(rt, m.pairId)?.blockNumber ?? 0);
  if (hint > 0) log = await deployLog(rt, m, hint, hint);
  if (!log) {
    const latest = await latestBlock(rt);
    const v1 = (v1Deployments as { chains: Record<string, { factory: string; block: number }> }).chains[
      String(rt.cfg.chain.chainId)
    ];
    const low = v1 && v1.factory.toLowerCase() === m.factory.toLowerCase() ? v1.block : 1;
    const start = await firstBlockAtOrAfter(rt, m.deployedAt, low, latest.blockNumber);
    if (start !== null) log = await deployLog(rt, m, start, Math.min(start + 600, latest.blockNumber));
  }
  if (!log) return null;
  m.created = { blockNumber: log.blockNumber, blockTimestamp: await blockTime(rt, log.blockNumber), txnId: log.transactionHash };
  persist(rt);
  return m.created;
}

export async function pairInfo(rt: Runtime, id: string | null): Promise<AdapterPair> {
  const address = normalizeAddress(id);
  const m = await marketFor(rt, address, "pair");
  if (!m) throw new AdapterError(404, `No ADEXTO market with curve ${address} on ${rt.cfg.chain.name}.`);
  const created = await creation(rt, m);
  const native = rt.cfg.chain.nativeSymbol;
  const wrapped = await wrappedAsset(rt);
  // Tautan halaman pasar hanya untuk pasar yang memang tampil di situs (ada di registry).
  const listed = registryRecord(rt, m.pairId);
  return {
    id: m.pairId,
    dexKey: DEX_KEY,
    asset0Id: m.tokenId,
    asset1Id: rt.cfg.wrappedNative,
    createdAtBlockNumber: created?.blockNumber,
    createdAtBlockTimestamp: created?.blockTimestamp,
    createdAtTxnId: created?.txnId,
    creator: m.creator,
    feeBps: m.feeBps,
    metadata: {
      venue: "ADEXTO bonding curve (AdextoCurve). The curve is the permanent market: it never graduates or migrates.",
      curveVersion: m.curveVersion,
      factory: m.factory,
      quoteAsset: `The curve trades native ${native}; asset1 is reported under the ${wrapped.symbol} address.`,
      reserves: "Real reserves only. The virtual native reserve, which only sets the opening price, is excluded.",
      virtualNativeReserve: decimalString(BigInt(m.virtualNative), NATIVE_DECIMALS),
      ...(listed ? { market: `${PUBLIC_ORIGIN}/token/${listed.slug}?chain=${rt.cfg.chain.chainId}` } : {}),
    },
  };
}

async function wrappedAsset(rt: Runtime): Promise<AdapterAsset> {
  if (rt.wrapped) return rt.wrapped;
  const token = new ethers.Contract(rt.cfg.wrappedNative, TOKEN_ABI, rt.call);
  const name = String(await rpc(rt, "name", () => token.name()));
  const symbol = String(await rpc(rt, "symbol", () => token.symbol()));
  rt.wrapped = { id: rt.cfg.wrappedNative, name, symbol };
  return rt.wrapped;
}

export async function assetInfo(rt: Runtime, id: string | null): Promise<AdapterAsset> {
  const address = normalizeAddress(id);
  if (address.toLowerCase() === rt.cfg.wrappedNative.toLowerCase()) return wrappedAsset(rt);
  const m = await marketFor(rt, address, "token");
  if (!m) throw new AdapterError(404, `No ADEXTO market token ${address} on ${rt.cfg.chain.name}.`);
  // totalSupply bisa turun (buyback membakar), jadi dibaca ulang, di-cache sebentar.
  const cached = rt.supply.get(m.tokenId);
  let totalSupply = cached && Date.now() - cached.at < SUPPLY_TTL_MS ? cached.value : null;
  if (!totalSupply) {
    const token = new ethers.Contract(m.tokenId, TOKEN_ABI, rt.call);
    totalSupply = decimalString(BigInt(await rpc(rt, "totalSupply", () => token.totalSupply())), m.decimals);
    rt.supply.set(m.tokenId, { at: Date.now(), value: totalSupply });
  }
  return { id: m.tokenId, name: m.name, symbol: m.symbol, totalSupply };
}

/** Ringkasan satu chain untuk manusia yang meninjau adapter (bukan bagian spesifikasi). */
export async function chainSummary(rt: Runtime): Promise<Record<string, unknown>> {
  const latest = await latestBlock(rt);
  const { chain } = rt.cfg;
  return {
    chain: { slug: rt.cfg.slug, chainId: chain.chainId, name: chain.name },
    dexKey: DEX_KEY,
    root: `${PUBLIC_ORIGIN}/api/dexscreener/${rt.cfg.slug}`,
    latestBlock: latest,
    confirmations: confirmationsFor(chain.chainId),
    maxBlocksPerRequest: maxBlocksPerRequest(chain.chainId),
    recommendedChunkBlocks: logSpanFor(chain.chainId),
    asset1: { id: rt.cfg.wrappedNative, note: `Native ${chain.nativeSymbol} is reported under this address.` },
    factories: rt.cfg.factories.map((f) => f.address),
    pairs: servedMarkets(rt)
      .sort((a, b) => a.deployedAt - b.deployedAt)
      .map((m) => ({ id: m.pairId, asset0Id: m.tokenId, symbol: m.symbol, curveVersion: m.curveVersion, feeBps: m.feeBps })),
  };
}
