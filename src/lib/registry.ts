/**
 * Project registry — the single source of truth for /api/graphql, /explorer,
 * /swap and /token/[slug].
 *
 * Fixes carried by this module:
 *   - Symbol squatting: `POST /api/deploy` used to accept any symbol with no auth
 *     and the result was unshifted in front of the curated list, so a request with
 *     `symbol: "AEGIS"` replaced the official /token/aegis page (name, contract
 *     address and Buy button target). Curated symbols are now reserved and
 *     duplicates are rejected.
 *   - Random addresses: records without a verified on-chain token address are
 *     rejected outright.
 *   - Unit-mixed prices: records store `priceNative` + `nativeSymbol`; USD is
 *     derived at render time.
 */
import { CHAINS, DEFAULT_CHAIN, resolveChainOrDefault, type ChainKey } from "@/lib/chains";
import { readJson, writeJson } from "@/lib/server-store";

const STORE_FILE = "projects.json";

/**
 * Batas keras jumlah entri registry.
 *
 * Angkanya tidak berubah; PERILAKU di batas itulah yang berubah, dan perubahannya
 * memperbaiki bug yang serius.
 *
 * Dulu `registerProject` menulis `persist([record, ...custom].slice(0, MAX))`. Entri
 * baru masuk paling depan lalu daftarnya dipotong ke 500 — jadi begitu penuh, yang
 * hilang adalah entri TERTUA, tanpa suara. Artinya siapa pun yang mau membayar gas
 * untuk 500 peluncuran bisa mendorong setiap proyek nyata keluar dari /explorer,
 * /swap, /api/graphql, dan halaman /token-nya. Peluncuran on-chain-nya tetap ada dan
 * kurvanya tetap bisa ditradingkan, tapi pemilik market kehilangan seluruh
 * permukaannya di situs ini dan tidak pernah diberi tahu.
 *
 * Sekarang batasnya MENOLAK entri baru. Konsekuensinya dipilih dengan sadar: pada
 * keadaan penuh, pendaftaran baru gagal, dan itu jauh lebih baik daripada diam-diam
 * menghapus milik orang lain. Kegagalan yang terlihat bisa ditangani; penghapusan
 * senyap tidak.
 */
const MAX_CUSTOM_PROJECTS = 500;

/**
 * Batas jumlah TICKER BERBEDA per alamat kreator.
 *
 * Kenapa dihitung per ticker dan bukan per entri: satu peluncuran lintas-chain
 * menghasilkan satu token dan satu pool PER chain, jadi satu proyek di empat mainnet
 * adalah empat entri dengan kreator dan ticker yang sama. Menghitung entri akan
 * menghukum alur yang justru kami dukung — memperluas ticker sendiri ke chain lain
 * tidak menambah hitungan.
 *
 * BATAS KEJUJURAN, dan ini harus dinyatakan supaya tidak ada yang menganggapnya lebih
 * kuat daripada kenyataannya: alamat tidak berbiaya. Penyerang yang gigih bisa memutar
 * alamat baru dan melewati batas ini. Yang benar-benar dijamin oleh pasangan batas ini
 * hanyalah bahwa entri yang SUDAH ADA tidak bisa digusur. Sisanya soal menaikkan usaha,
 * bukan menutup jalan — dan biaya nyatanya tetap gas, bukan identitas.
 *
 * Gerbang identitas TIDAK dipakai untuk ini dengan sengaja: World ID sudah dicoba dan
 * dicabut karena menuntut verifikasi Orb, dan `deployTrinity` tanpa access control
 * membuat gerbang aplikasi apa pun hanya menjaga listing, bukan chain.
 */
const DEFAULT_MAX_TICKERS_PER_CREATOR = 10;

function maxTickersPerCreator(): number {
  const raw = Number(process.env.ADEXTO_MAX_TICKERS_PER_CREATOR);
  // Nol atau negatif TIDAK diartikan "tanpa batas": salah tulis di env tidak boleh
  // membuka pintu yang justru sedang ditutup.
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_MAX_TICKERS_PER_CREATOR;
}

/**
 * Galat batas registry, dibedakan dari galat validasi biasa lewat `code`.
 *
 * Perlu kelas sendiri supaya /api/deploy bisa menjawab 409 alih-alih 500. Tanpa ini,
 * penolakan yang normal dan bisa dijelaskan akan terbaca sebagai kerusakan server —
 * dan pemanggil yang melihat 500 wajar menyimpulkan peluncurannya gagal, padahal
 * transaksinya SUDAH mined dan uangnya sudah keluar.
 */
export class RegistryLimitError extends Error {
  code: "REGISTRY_FULL" | "CREATOR_TICKER_LIMIT";
  constructor(code: "REGISTRY_FULL" | "CREATOR_TICKER_LIMIT", message: string) {
    super(message);
    this.name = "RegistryLimitError";
    this.code = code;
  }
}

export interface ProjectRecord {
  id: string;
  tokenAddress: string;
  poolAddress: string | null;
  creator: string;
  name: string;
  symbol: string;
  slug: string;
  chainId: number;
  chainKey: ChainKey;
  chainLabel: string;
  targetChainIds: number[];
  nativeSymbol: string;
  /** Price of one whole token denominated in the chain's native asset. */
  priceNative: number;
  /** Whole-token supply (decimals applied on-chain). */
  supply: number;
  lpFeeBps: number;
  treasuryBuybackBps: number;
  agentModel: string;
  agentPersona: string;
  agentStatus: string;
  edgeProvider: string;
  mcpTools: string[];
  category: string;
  image: string;
  txHash: string | null;
  blockNumber: number | null;
  teeRoot: string | null;
  daStorageTx: string | null;
  deployedAt: number;
  /** Token contract confirmed to exist on-chain at registration time. */
  verified: boolean;
  /** Curated showcase entry, protected from being overwritten. */
  curated: boolean;
  /** A SovereignHook AMM exists and can settle trades. */
  poolLive: boolean;
}

const ZERO_TOKENS: string[] = [];

function baseRecord(partial: Partial<ProjectRecord> & Pick<ProjectRecord, "tokenAddress" | "name" | "symbol" | "chainKey">): ProjectRecord {
  const chain = CHAINS[partial.chainKey];
  const symbol = partial.symbol.toUpperCase();
  return {
    id: partial.tokenAddress.toLowerCase(),
    tokenAddress: partial.tokenAddress,
    poolAddress: partial.poolAddress ?? null,
    creator: partial.creator ?? chain.factoryAddress,
    name: partial.name,
    symbol,
    slug: symbol.toLowerCase(),
    chainId: chain.chainId,
    chainKey: chain.key,
    chainLabel: partial.chainLabel ?? chain.label,
    targetChainIds: partial.targetChainIds ?? [chain.chainId],
    nativeSymbol: chain.nativeSymbol,
    priceNative: partial.priceNative ?? 0,
    supply: partial.supply ?? 1_000_000_000,
    lpFeeBps: partial.lpFeeBps ?? 20,
    treasuryBuybackBps: partial.treasuryBuybackBps ?? 10,
    agentModel: partial.agentModel ?? "0G Compute (glm-5.3)",
    agentPersona: partial.agentPersona ?? "Autonomous 24/7 quant market maker and liquidity rebalancer.",
    // Bukan SEV-SNP. Router 0G menyatakan tee_type=TDX dengan verifier dstack;
    // "AMD SEV-SNP" adalah sisa klaim lama yang sudah diralat di landing page dan
    // footer tetapi terlewat di sini. "router-reported" ditulis eksplisit karena
    // yang kita baca deklarasi router, bukan quote TDX mentah.
    agentStatus: partial.agentStatus ?? "Active (0G Router, Intel TDX attested · router-reported)",
    edgeProvider: partial.edgeProvider ?? "Cloudflare x402 Edge",
    mcpTools: partial.mcpTools ?? ["Signet", "Sentinel", "Helm", "x402"],
    category: partial.category ?? "defi",
    image: partial.image ?? "/logo.svg",
    txHash: partial.txHash ?? null,
    blockNumber: partial.blockNumber ?? null,
    teeRoot: partial.teeRoot ?? null,
    daStorageTx: partial.daStorageTx ?? null,
    deployedAt: partial.deployedAt ?? 0,
    verified: partial.verified ?? false,
    curated: partial.curated ?? false,
    poolLive: partial.poolLive ?? false,
  };
}

/**
 * Curated showcase projects — deliberately EMPTY.
 *
 * Four entries used to live here (AEGIS on 0G, QNOVA and CSENT on Arbitrum,
 * MQUANT on Monad), and every one of them was rendered to visitors as a market
 * with a price. Three were never minted at all: an on-chain read of
 * `totalProjectsCount()` returns 1 on 0G and 0 on Arbitrum, so the QNOVA, CSENT
 * and MQUANT addresses point at nothing. AEGIS is a real deployed contract, but
 * no curve was ever attached to it, so the 0.0184 0G it advertised was not a
 * price at which anything could be bought or sold.
 *
 * That contradicted the rest of the site within a single visit: the hero says
 * "launch factory pending broadcast" and the footer says launching is disabled
 * everywhere, while /explorer listed four tradable-looking markets with market
 * caps. A reader had no way to tell which of the two statements was the lie.
 *
 * So before mainnet the registry starts empty and /explorer says so plainly.
 * Real markets arrive through `registerProject`, which only accepts a token
 * address read back from a confirmed `TrinityProjectDeployed` receipt — so the
 * first entry here will be the first launch that actually happened.
 *
 * Removing them from this list must NOT make their tickers claimable by someone
 * else, which is why they are now named explicitly in RESERVED_SYMBOLS below.
 */
export const CURATED_PROJECTS: ProjectRecord[] = [];

/**
 * Symbols that a launch may never claim on any chain.
 *
 * This set used to be derived from `CURATED_PROJECTS`, so emptying that array
 * would have silently un-reserved AEGIS, QNOVA, CSENT and MQUANT and handed them
 * to whoever asked first. They are listed literally instead, which also means the
 * reservation no longer depends on a showcase entry existing.
 */
/**
 * Ticker milik protokol. Boleh diklaim oleh `ADEXTO_OFFICIAL_DEPLOYER`.
 *
 * Ini yang dijaga supaya penyerobot tidak mengambil nama kita SEBELUM kita meluncurkannya
 * sendiri. Jadi pengecualian untuk deployer resmi memang tepat di sini: tanpa itu, kami
 * terkunci dari token kami sendiri.
 */
export const PROTOCOL_SYMBOLS = new Set(["ADEXTO", "ADX", "AEGIS", "QNOVA", "CSENT", "MQUANT"]);

/**
 * Nama aset besar. TIDAK BOLEH diklaim siapa pun — termasuk kami.
 *
 * Dipisah dari PROTOCOL_SYMBOLS, dan pemisahan ini penting. Dulu keduanya satu set dengan
 * satu pengecualian menyeluruh untuk deployer resmi, jadi begitu
 * `ADEXTO_OFFICIAL_DEPLOYER` diisi, alamat itu langsung bisa mengklaim "USDC", "ETH", dan
 * "BTC" di 0G mainnet. Diverifikasi lewat /api/deploy: ketiganya menjawab
 * `available:true` untuk deployer resmi.
 *
 * Itu bukan pintu yang kami inginkan. Alasan dua daftar ini terpesan sama sekali berbeda:
 * nama protokol dijaga agar tidak diserobot orang lain, sedangkan nama aset besar dijaga
 * agar tidak ada yang salah membaca token kurva sebagai aset sungguhan. Alasan kedua
 * berlaku sama kuat untuk token yang KAMI luncurkan — bahkan lebih, karena token dari
 * deployer resmi justru tampak paling sah.
 *
 * Dan klaim ticker on-chain bersifat permanen: `symbolRegistry` tidak punya fungsi untuk
 * melepas. Satu salah ketik di studio akan menempel selamanya.
 */
export const BLUE_CHIP_SYMBOLS = new Set([
  "ETH",
  "WETH",
  "USDC",
  "USDT",
  "BTC",
  "WBTC",
  "0G",
  "A0GI",
  "MON",
  "ARB",
]);

/** Gabungan keduanya. Dipertahankan karena dirujuk audit_preflight_immutable.mjs. */
export const RESERVED_SYMBOLS = new Set([...PROTOCOL_SYMBOLS, ...BLUE_CHIP_SYMBOLS]);

/**
 * Addresses permitted to launch a RESERVED ticker.
 *
 * Reserving "ADEXTO" stops a squatter from taking it, but it also locked the
 * protocol out of its own token: `checkSymbolAvailable` refused every reserved
 * ticker unconditionally, so the official mainnet launch would have been rejected
 * by our own studio with "Ticker ADEXTO is reserved and cannot be launched."
 *
 * The reservation now has exactly one door. It is opened by configuration rather
 * than by a hardcoded address, and it is CLOSED BY DEFAULT: with
 * `ADEXTO_OFFICIAL_DEPLOYER` unset, no address can claim a reserved ticker, so a
 * misconfigured deployment fails safe rather than opening the tickers to anyone.
 *
 * Comma-separated, so one allowance can cover a hardware wallet and a hot
 * deployer without a code change.
 */
function officialDeployers(): Set<string> {
  return new Set(
    (process.env.ADEXTO_OFFICIAL_DEPLOYER || "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => /^0x[a-f0-9]{40}$/.test(entry))
  );
}

function isOfficialDeployer(address?: string | null): boolean {
  if (!address) return false;
  return officialDeployers().has(address.trim().toLowerCase());
}

declare global {
  var __ADEXTO_PROJECT_CACHE__: ProjectRecord[] | undefined;
}

function loadCustom(): ProjectRecord[] {
  if (globalThis.__ADEXTO_PROJECT_CACHE__) return globalThis.__ADEXTO_PROJECT_CACHE__;
  const stored = readJson<ProjectRecord[]>(STORE_FILE, []);
  const clean = Array.isArray(stored) ? stored.filter((r) => r && r.tokenAddress && r.symbol) : [];
  globalThis.__ADEXTO_PROJECT_CACHE__ = clean;
  return clean;
}

function persist(records: ProjectRecord[]): void {
  globalThis.__ADEXTO_PROJECT_CACHE__ = records;
  writeJson(STORE_FILE, records);
}

/**
 * A market is identified by (chainId, symbol), not by symbol alone.
 *
 * A one-click multi-chain launch produces one independent token and pool per
 * selected chain. When identity was keyed on the symbol only, the first chain
 * registered and every other chain was rejected with "ticker already registered"
 * — after its on-chain transaction had already succeeded and its seed liquidity
 * had already been locked. So the user paid for four markets and saw one.
 */
export function marketKey(chainId: number, symbol: string): string {
  return `${chainId}:${symbol.toUpperCase()}`;
}

/** Curated entries first so a custom launch can never shadow them. */
export function listProjects(): ProjectRecord[] {
  const seenMarket = new Set<string>();
  const seenAddress = new Set<string>();
  const out: ProjectRecord[] = [];

  for (const record of [...CURATED_PROJECTS, ...loadCustom()]) {
    const key = marketKey(record.chainId, record.symbol);
    const addressKey = record.tokenAddress.toLowerCase();
    if (seenMarket.has(key) || seenAddress.has(addressKey)) continue;
    seenMarket.add(key);
    seenAddress.add(addressKey);
    out.push(record);
  }

  return out;
}

/**
 * Ticker berbeda yang sudah didaftarkan sebuah alamat.
 *
 * Membaca `loadCustom()` dan bukan `listProjects()` dengan sengaja: yang dibatasi
 * adalah entri yang bisa ditulis lewat API, sementara `CURATED_PROJECTS` tidak berasal
 * dari peluncuran siapa pun dan tidak boleh membebani kuota orang.
 */
export function creatorTickers(creator?: string | null): Set<string> {
  const owner = (creator || "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(owner)) return new Set();
  const out = new Set<string>();
  for (const record of loadCustom()) {
    if ((record.creator || "").toLowerCase() === owner) out.add(record.symbol.toUpperCase());
  }
  return out;
}

/** Sisa kuota ticker sebuah alamat, dipakai UI untuk memberi tahu SEBELUM bayar gas. */
export function creatorQuota(creator?: string | null): { used: number; max: number; remaining: number } {
  const max = maxTickersPerCreator();
  const used = creatorTickers(creator).size;
  return { used, max, remaining: Math.max(0, max - used) };
}

/** Every chain a symbol is deployed on, ordered by deployment time. */
export function findProjectGroup(symbol: string): ProjectRecord[] {
  if (!symbol) return [];
  const needle = symbol.toLowerCase();
  return listProjects()
    .filter((p) => p.slug === needle || p.symbol.toLowerCase() === needle)
    .sort((a, b) => a.deployedAt - b.deployedAt);
}

/**
 * Resolve one market. A token address always identifies exactly one market. A
 * symbol may span chains, so `chainId` selects among them; without it the oldest
 * deployment is treated as the primary.
 */
export function findProject(slugOrAddress: string, chainId?: number | null): ProjectRecord | null {
  if (!slugOrAddress) return null;
  const needle = slugOrAddress.toLowerCase();

  const byAddress = listProjects().find((p) => p.tokenAddress.toLowerCase() === needle);
  if (byAddress) return byAddress;

  const group = findProjectGroup(needle);
  if (group.length === 0) return null;
  if (chainId !== undefined && chainId !== null) {
    return group.find((p) => p.chainId === Number(chainId)) ?? null;
  }
  return group.find((p) => p.poolLive) ?? group[0];
}

export type SymbolCheck = { available: true } | { available: false; reason: string };

/**
 * Availability is per chain.
 *
 * - reserved tickers are blocked everywhere, except for the protocol's own
 *   deployer address (see officialDeployers);
 * - a ticker already live on the *same* chain is blocked;
 * - a ticker held by a *different* creator on another chain is blocked, so a
 *   multi-chain launch cannot be used to impersonate an existing project;
 * - the original creator may extend their own ticker onto further chains, which
 *   is exactly what the one-click multi-chain flow needs.
 */
export function checkSymbolAvailable(symbol: string, chainId?: number | null, creator?: string | null): SymbolCheck {
  const upper = (symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(upper)) {
    return { available: false, reason: "Ticker must be 2–12 characters, letters and digits only." };
  }
  // The official deployer is exempt: the protocol has to be able to launch its
  // own reserved tickers. Everyone else is refused, including when
  // ADEXTO_OFFICIAL_DEPLOYER is unset.
  // Nama aset besar diperiksa LEBIH DULU dan tanpa pengecualian, jadi deployer resmi pun
  // tidak bisa melewatinya. Urutannya bukan gaya: kalau blok ini di bawah, pengecualian
  // deployer akan sudah mengembalikan `available` sebelum sampai ke sini.
  if (BLUE_CHIP_SYMBOLS.has(upper)) {
    return {
      available: false,
      reason: `Ticker ${upper} is the name of a major asset and can never be launched here.`,
    };
  }
  if (PROTOCOL_SYMBOLS.has(upper) && !isOfficialDeployer(creator)) {
    return { available: false, reason: `Ticker ${upper} is reserved and cannot be launched.` };
  }

  const existing = listProjects().filter((p) => p.symbol.toUpperCase() === upper);
  if (existing.length === 0) return { available: true };

  if (chainId === undefined || chainId === null) {
    return {
      available: false,
      reason: `Ticker ${upper} is already registered on ${existing.map((p) => p.chainKey).join(", ")}.`,
    };
  }

  const sameChain = existing.find((p) => p.chainId === Number(chainId));
  if (sameChain) {
    return { available: false, reason: `Ticker ${upper} already has a market on ${sameChain.chainKey}.` };
  }

  const owner = existing[0].creator?.toLowerCase();
  if (!creator || !owner || owner !== creator.toLowerCase()) {
    return {
      available: false,
      reason: `Ticker ${upper} belongs to another creator (${existing[0].chainKey}). Choose a different ticker.`,
    };
  }

  return { available: true };
}

export interface RegisterInput {
  tokenAddress: string;
  poolAddress?: string | null;
  creator: string;
  name: string;
  symbol: string;
  chainId: number;
  chainLabel?: string;
  targetChainIds?: number[];
  priceNative: number;
  supply: number;
  lpFeeBps: number;
  treasuryBuybackBps: number;
  agentModel?: string;
  agentPersona?: string;
  category?: string;
  image?: string;
  txHash: string;
  blockNumber?: number | null;
  teeRoot?: string | null;
  daStorageTx?: string | null;
  poolLive: boolean;
}

export function registerProject(input: RegisterInput): ProjectRecord {
  const symbolCheck = checkSymbolAvailable(input.symbol, input.chainId, input.creator);
  if (!symbolCheck.available) throw new Error(symbolCheck.reason);

  if (!/^0x[a-fA-F0-9]{40}$/.test(input.tokenAddress)) {
    throw new Error("tokenAddress must be a 20-byte hex address returned by the factory.");
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(input.txHash)) {
    throw new Error("txHash of the confirmed launch transaction is required.");
  }

  const address = input.tokenAddress.toLowerCase();
  const custom = loadCustom();
  if (custom.some((p) => p.tokenAddress.toLowerCase() === address)) {
    throw new Error("This token address is already registered.");
  }

  // Kedua batas ditegakkan SEBELUM apa pun ditulis, dan keduanya melempar
  // RegistryLimitError supaya route bisa menjawab 409, bukan 500.
  if (custom.length >= MAX_CUSTOM_PROJECTS) {
    throw new RegistryLimitError(
      "REGISTRY_FULL",
      `The registry is at its ${MAX_CUSTOM_PROJECTS}-market limit, so no new market can be listed right now. ` +
        `Your launch transaction is already on-chain and your curve is tradable; only the listing on this site is affected.`
    );
  }

  // Ticker yang sudah dimiliki kreator ini tidak menambah hitungan: itu perluasan
  // lintas-chain dari proyek yang sama, bukan proyek baru.
  const upperSymbol = input.symbol.trim().toUpperCase();
  const owned = creatorTickers(input.creator);
  const max = maxTickersPerCreator();
  if (!owned.has(upperSymbol) && owned.size >= max) {
    throw new RegistryLimitError(
      "CREATOR_TICKER_LIMIT",
      `This address has already listed ${owned.size} tickers, which is the limit of ${max} per address. ` +
        `Your launch transaction is already on-chain and your curve is tradable; only the listing on this site is affected.`
    );
  }

  const chain = resolveChainOrDefault(input.chainId);
  const record = baseRecord({
    tokenAddress: input.tokenAddress,
    poolAddress: input.poolAddress ?? null,
    creator: input.creator,
    name: input.name,
    symbol: input.symbol,
    chainKey: chain.key,
    chainLabel: input.chainLabel ?? chain.label,
    targetChainIds: input.targetChainIds ?? [chain.chainId],
    priceNative: input.priceNative,
    supply: input.supply,
    lpFeeBps: input.lpFeeBps,
    treasuryBuybackBps: input.treasuryBuybackBps,
    agentModel: input.agentModel,
    agentPersona: input.agentPersona,
    category: input.category,
    image: input.image,
    txHash: input.txHash,
    blockNumber: input.blockNumber ?? null,
    teeRoot: input.teeRoot ?? null,
    daStorageTx: input.daStorageTx ?? null,
    deployedAt: Math.floor(Date.now() / 1000),
    verified: true,
    curated: false,
    poolLive: input.poolLive,
  });

  // TANPA `.slice()`. Pemotongan di sinilah yang dulu menggusur entri tertua secara
  // senyap; batasnya sekarang ditegakkan di atas dengan menolak, bukan dengan membuang
  // milik orang lain.
  persist([record, ...custom]);
  return record;
}

export function customProjectCount(): number {
  return loadCustom().length;
}

export { ZERO_TOKENS };
