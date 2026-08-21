/**
 * Single source of truth for chain resolution.
 *
 * Replaces the `chain.includes("Arbitrum")` checks that were scattered across the
 * app. Those broke on omnichain labels such as
 * `"Omnichain (0G + Arbitrum + Base + Monad)"`, which matched "Arbitrum" and sent
 * every explorer link, balance RPC and default currency to Arbitrum even though
 * the launch transaction went to the 0G factory.
 *
 * Resolution order:
 *   1. explicit numeric chainId (from a `(16661)` suffix or a number input)
 *   2. the FIRST known chain name that appears in the label — the primary chain
 *   3. null (caller decides; never silently defaults to a wrong chain)
 */
import { ADEXTO_CONTRACTS } from "@/config/contracts";

export type ChainKey = "0G" | "Arbitrum" | "Base" | "Monad" | "Devchain";

/**
 * Disposable test-chain slot, enabled only when NEXT_PUBLIC_DEVCHAIN_RPC is set.
 *
 * It exists so the full launch → trade path can be exercised against a real EVM
 * without spending mainnet gas. Every field is configurable so the slot can point
 * at a local Hardhat node *or* at a public testnet (0G Testnet, Base Sepolia, …)
 * without pretending to be one of the four production chains. It is absent from
 * every list in production builds, where none of these variables are set.
 */
const DEVCHAIN_RPC = process.env.NEXT_PUBLIC_DEVCHAIN_RPC || "";
const DEVCHAIN_FACTORY = process.env.NEXT_PUBLIC_FACTORY_V2_DEVCHAIN || "";
const DEVCHAIN_CURVE_FACTORY = process.env.NEXT_PUBLIC_CURVE_FACTORY_DEVCHAIN || "";
export const DEVCHAIN_ENABLED = Boolean(DEVCHAIN_RPC);
export const DEVCHAIN_ID = Number(process.env.NEXT_PUBLIC_DEVCHAIN_CHAIN_ID || 31337);
const DEVCHAIN_NAME = process.env.NEXT_PUBLIC_DEVCHAIN_NAME || "Local Devchain";
const DEVCHAIN_SYMBOL = process.env.NEXT_PUBLIC_DEVCHAIN_SYMBOL || "ETH";
const DEVCHAIN_EXPLORER = process.env.NEXT_PUBLIC_DEVCHAIN_EXPLORER || DEVCHAIN_RPC || "http://127.0.0.1:8545";

export interface ChainInfo {
  key: ChainKey;
  chainId: number;
  name: string;
  label: string;
  rpcUrl: string;
  blockExplorer: string;
  nativeSymbol: string;
  nativeCurrencyName: string;
  /** Legacy v1 factory — deploys a token but no tradable pool. */
  factoryAddress: string;
  /** v2 factory — deploys token + executable SovereignHook AMM atomically. */
  factoryV2Address: string | null;
  /**
   * AdextoCurveFactory — deploys token + SovereignCurve. No native seed
   * required and 100% of supply enters the curve. Takes precedence over the
   * seeded generation when both are configured.
   */
  curveFactoryAddress: string | null;
  /**
   * Sifat peluncuran di chain ini: `curve` = bonding curve tanpa setoran,
   * `seeded` = pool v2 yang mewajibkan seed native. Dulu bernilai "v3"/"v2";
   * nomor generasi tidak memberi tahu pembaca apa pun tentang perilakunya.
   */
  launchGeneration: "curve" | "seeded" | null;
  /**
   * Virtual native reserve for a new curve, in whole native units.
   *
   * Because 100% of supply enters the curve, this number *is* the opening market
   * capitalisation denominated in the chain's native asset. It is therefore set
   * per chain so the opening valuation lands in the same USD range everywhere
   * (~$3k), rather than being 1500x apart between 0G and ETH.
   */
  defaultVirtualNative: number;
  /** Legacy v1 hook. Cannot settle trades (no receive/swap entrypoint). */
  legacyHookAddress: string;
  governorAddress: string;
  /** True once a v2 factory exists on this chain, i.e. launches produce real pools. */
  dexLive: boolean;
}

interface ChainSource {
  readonly chainId: number;
  readonly chainName: string;
  readonly nativeSymbol: string;
  readonly rpcUrl: string;
  readonly blockExplorer: string;
  readonly factoryAddress: string;
  readonly factoryV2Address: string | null;
  readonly curveFactoryAddress?: string | null;
  readonly sovereignHookAddress: string;
  readonly governorAddress: string;
}

/**
 * Per-chain overrides supplied as one JSON env var, applied on top of the static
 * config. This exists so the genuine four-chain launch path can be rehearsed
 * against public testnets without pretending a testnet is mainnet:
 *
 *   NEXT_PUBLIC_CHAIN_OVERRIDES='{"0G":{"chainId":16602,"rpcUrl":"https://evmrpc-testnet.0g.ai",
 *     "name":"0G Testnet","blockExplorer":"https://chainscan-newton.0g.ai",
 *     "factoryV2Address":"0x…"}}'
 *
 * Unset in production, where it has no effect whatsoever.
 */
type ChainOverride = Partial<
  Pick<
    ChainInfo,
    "chainId" | "name" | "rpcUrl" | "blockExplorer" | "nativeSymbol" | "factoryV2Address" | "curveFactoryAddress"
  >
>;

const CHAIN_OVERRIDES: Partial<Record<ChainKey, ChainOverride>> = (() => {
  const raw = process.env.NEXT_PUBLIC_CHAIN_OVERRIDES;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    console.warn("[adexto] NEXT_PUBLIC_CHAIN_OVERRIDES is not valid JSON; ignoring.");
    return {};
  }
})();

export const CHAIN_OVERRIDES_ACTIVE = Object.keys(CHAIN_OVERRIDES).length > 0;

function build(key: ChainKey, source: ChainSource, nativeName: string): ChainInfo {
  const o = CHAIN_OVERRIDES[key] ?? {};
  const chainId = o.chainId ?? source.chainId;
  const name = o.name ?? source.chainName;
  const factoryV2Address = o.factoryV2Address ?? source.factoryV2Address ?? null;
  const curveFactoryAddress = o.curveFactoryAddress ?? source.curveFactoryAddress ?? null;
  // v3 wins when both exist: it is the zero-deposit generation, and offering a
  // seeded launch beside a free one would only confuse the creator.
  const launchGeneration: "curve" | "seeded" | null = curveFactoryAddress
    ? "curve"
    : factoryV2Address
    ? "seeded"
    : null;
  // Targets roughly $3k of opening market cap on each chain, in line with how
  // comparable launchpads open. Native prices differ by orders of magnitude, so a
  // single shared number would value a 0G launch at a few dollars and a Base
  // launch at thousands.
  const DEFAULT_VIRTUAL_NATIVE: Record<ChainKey, number> = {
    "0G": 1500,
    Arbitrum: 1,
    Base: 1,
    Monad: 60_000,
    Devchain: 1,
  };

  return {
    key,
    chainId,
    name,
    label: `${name} (${chainId})`,
    rpcUrl: o.rpcUrl ?? source.rpcUrl,
    blockExplorer: o.blockExplorer ?? source.blockExplorer,
    nativeSymbol: o.nativeSymbol ?? source.nativeSymbol,
    nativeCurrencyName: nativeName,
    factoryAddress: source.factoryAddress,
    factoryV2Address,
    curveFactoryAddress,
    launchGeneration,
    defaultVirtualNative: DEFAULT_VIRTUAL_NATIVE[key],
    legacyHookAddress: source.sovereignHookAddress,
    governorAddress: source.governorAddress,
    dexLive: Boolean(curveFactoryAddress || factoryV2Address),
  };
}

export const CHAINS: Record<ChainKey, ChainInfo> = {
  "0G": build("0G", ADEXTO_CONTRACTS.og, "0G"),
  Arbitrum: build("Arbitrum", ADEXTO_CONTRACTS.arbitrum, "Ether"),
  Base: build("Base", ADEXTO_CONTRACTS.base, "Ether"),
  Monad: build("Monad", ADEXTO_CONTRACTS.monad, "Monad"),
  Devchain: {
    key: "Devchain",
    chainId: DEVCHAIN_ID,
    name: DEVCHAIN_NAME,
    label: `${DEVCHAIN_NAME} (${DEVCHAIN_ID})`,
    rpcUrl: DEVCHAIN_RPC || "http://127.0.0.1:8545",
    blockExplorer: DEVCHAIN_EXPLORER,
    nativeSymbol: DEVCHAIN_SYMBOL,
    nativeCurrencyName: DEVCHAIN_SYMBOL,
    factoryAddress: DEVCHAIN_FACTORY,
    factoryV2Address: DEVCHAIN_ENABLED && DEVCHAIN_FACTORY ? DEVCHAIN_FACTORY : null,
    curveFactoryAddress: DEVCHAIN_ENABLED && DEVCHAIN_CURVE_FACTORY ? DEVCHAIN_CURVE_FACTORY : null,
    launchGeneration:
      DEVCHAIN_ENABLED && DEVCHAIN_CURVE_FACTORY
        ? "curve"
        : DEVCHAIN_ENABLED && DEVCHAIN_FACTORY
        ? "seeded"
        : null,
    defaultVirtualNative: 1,
    legacyHookAddress: "",
    governorAddress: "",
    dexLive: DEVCHAIN_ENABLED && Boolean(DEVCHAIN_CURVE_FACTORY || DEVCHAIN_FACTORY),
  },
};

export const CHAIN_LIST: ChainInfo[] = [
  CHAINS["0G"],
  CHAINS.Arbitrum,
  CHAINS.Base,
  CHAINS.Monad,
  ...(DEVCHAIN_ENABLED ? [CHAINS.Devchain] : []),
];

export const DEFAULT_CHAIN = CHAINS["0G"];

/** Testnet ids are mapped to their mainnet sibling for UI purposes. */
const CHAIN_ID_ALIASES: Record<number, ChainKey> = {
  16661: "0G",
  16602: "0G",
  8453: "Base",
  84532: "Base",
  42161: "Arbitrum",
  421614: "Arbitrum",
  143: "Monad",
  10143: "Monad",
};

// Make every configured chainId resolvable, including ids injected by
// NEXT_PUBLIC_CHAIN_OVERRIDES. Overrides win over the static aliases above.
for (const chain of [CHAINS["0G"], CHAINS.Arbitrum, CHAINS.Base, CHAINS.Monad]) {
  CHAIN_ID_ALIASES[chain.chainId] = chain.key;
}

if (DEVCHAIN_ENABLED) {
  CHAIN_ID_ALIASES[DEVCHAIN_ID] = "Devchain";
}

export function chainFromId(chainId: number | bigint | null | undefined): ChainInfo | null {
  if (chainId === null || chainId === undefined) return null;
  const id = Number(chainId);
  const key = CHAIN_ID_ALIASES[id];
  return key ? CHAINS[key] : null;
}

/**
 * Parse any chain descriptor the app produces or persists.
 * Accepts: "0G", 16661, "0G Mainnet (16661)", "Omnichain (0G + Arbitrum + Base)".
 */
export function resolveChain(input: string | number | null | undefined): ChainInfo | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return chainFromId(input);

  const raw = String(input).trim();
  if (!raw) return null;

  if (CHAINS[raw as ChainKey]) return CHAINS[raw as ChainKey];

  // 1. explicit chain id in the label, e.g. "0G Mainnet (16661)"
  const idMatch = raw.match(/\((\d{2,7})\)/);
  if (idMatch) {
    const byId = chainFromId(Number(idMatch[1]));
    if (byId) return byId;
  }
  if (/^\d+$/.test(raw)) return chainFromId(Number(raw));

  // 2. first known chain name mentioned — that is the primary chain
  const lower = raw.toLowerCase();
  const positions: Array<{ key: ChainKey; index: number }> = [];
  const needles: Array<[ChainKey, string[]]> = [
    ["0G", ["0g", "zero gravity"]],
    ["Arbitrum", ["arbitrum", "arb one"]],
    ["Base", ["base"]],
    ["Monad", ["monad"]],
    ...(DEVCHAIN_ENABLED ? ([["Devchain", ["devchain", "local devchain"]]] as Array<[ChainKey, string[]]>) : []),
  ];
  for (const [key, terms] of needles) {
    for (const term of terms) {
      const index = lower.indexOf(term);
      if (index >= 0) {
        positions.push({ key, index });
        break;
      }
    }
  }
  if (positions.length === 0) return null;
  positions.sort((a, b) => a.index - b.index);
  return CHAINS[positions[0].key];
}

export function resolveChainOrDefault(input: string | number | null | undefined): ChainInfo {
  return resolveChain(input) ?? DEFAULT_CHAIN;
}

/** All chains referenced by a label, in the order they appear. */
export function resolveChainSet(input: string | null | undefined): ChainInfo[] {
  if (!input) return [];
  const raw = String(input).toLowerCase();
  const found: Array<{ chain: ChainInfo; index: number }> = [];
  for (const chain of CHAIN_LIST) {
    const index = raw.indexOf(chain.key.toLowerCase());
    if (index >= 0) found.push({ chain, index });
  }
  if (found.length === 0) {
    const single = resolveChain(input);
    return single ? [single] : [];
  }
  found.sort((a, b) => a.index - b.index);
  return found.map((f) => f.chain);
}

export function isOmnichainLabel(input: string | null | undefined): boolean {
  return Boolean(input && /omnichain/i.test(input));
}

export function explorerAddressUrl(chain: string | number | ChainInfo | null | undefined, address: string): string {
  const info = typeof chain === "object" && chain !== null ? chain : resolveChainOrDefault(chain as string | number);
  return `${info.blockExplorer}/address/${address}`;
}

export function explorerTxUrl(chain: string | number | ChainInfo | null | undefined, txHash: string): string {
  const info = typeof chain === "object" && chain !== null ? chain : resolveChainOrDefault(chain as string | number);
  return `${info.blockExplorer}/tx/${txHash}`;
}

/** Input assets selectable per chain. The native asset is always first. */
export function inputAssetsFor(chain: ChainInfo): string[] {
  switch (chain.key) {
    case "Arbitrum":
      return ["ETH", "USDC", "ARB"];
    case "Base":
      return ["ETH", "USDC", "cbBTC"];
    case "Monad":
      return ["MON", "USDC", "USDT"];
    case "Devchain":
      return [DEVCHAIN_SYMBOL];
    default:
      return ["0G", "A0GI", "USDC", "USDT"];
  }
}

export function toHexChainId(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}
