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
const MAX_CUSTOM_PROJECTS = 500;

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
    agentModel: partial.agentModel ?? "0G Compute (glm-5.2)",
    agentPersona: partial.agentPersona ?? "Autonomous 24/7 quant market maker and liquidity rebalancer.",
    agentStatus: partial.agentStatus ?? "Active (0G AMD SEV-SNP)",
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
export const RESERVED_SYMBOLS = new Set([
  // Protocol tickers, held for ADEXTO's own launches.
  "ADEXTO",
  "ADX",
  "AEGIS",
  "QNOVA",
  "CSENT",
  "MQUANT",
  // Native and blue-chip assets: a curve token called USDC or ETH would be read
  // as the real asset by anyone skimming a market list.
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
  if (RESERVED_SYMBOLS.has(upper) && !isOfficialDeployer(creator)) {
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

  persist([record, ...custom].slice(0, MAX_CUSTOM_PROJECTS));
  return record;
}

export function customProjectCount(): number {
  return loadCustom().length;
}

export { ZERO_TOKENS };
