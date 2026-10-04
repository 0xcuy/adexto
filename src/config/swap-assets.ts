/**
 * Assets the cross-chain swap may route, per chain.
 *
 * This is an allowlist of ADDRESSES, never of symbols. Our own wallets have already been sent
 * look-alike tokens named "UṢDC", "EṬH" and "MỌN", and LI.FI's token list for Robinhood Chain
 * carries a 1,100-supply "Paxos USDG" copycat at 0x0A3B…954F next to the real USDG. Matching by
 * symbol would put either of those in front of a user.
 *
 * Every entry below was checked on 2026-10-04 in two ways:
 *   - on chain: contract code present, `symbol()`, `name()`, `decimals()` and `totalSupply()`;
 *   - against the issuer's own published list: Circle for USDC, Paxos for USDG
 *     (docs.paxos.com/guides/stablecoin/usdg/mainnet).
 *
 * Left out on purpose:
 *   - USDC.e on 0G (0x8a2B…DD0B, Stargate-bridged). Total supply was 173 USDC.e, which is too
 *     thin to route through; 0G stays native-only until that changes.
 *   - Everything else LI.FI lists. A larger list is a larger surface for the same mistake.
 */

/** The address LI.FI uses for a chain's native asset. */
export const NATIVE_ASSET_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Chain ids the cross-chain swap serves, in the site's chain order (see CHAIN_LIST). */
export const SWAP_CHAIN_IDS = [143, 42161, 4663, 8453, 16661] as const;
export type SwapChainId = (typeof SWAP_CHAIN_IDS)[number];

export interface SwapAsset {
  chainId: SwapChainId;
  /** `NATIVE_ASSET_ADDRESS` for the chain's gas token. */
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  kind: "native" | "stable";
  /** Where the address was confirmed, for anyone auditing this list. */
  source: string;
}

export const SWAP_ASSETS: readonly SwapAsset[] = [
  { chainId: 143, address: NATIVE_ASSET_ADDRESS, symbol: "MON", name: "Monad", decimals: 18, kind: "native", source: "native" },
  {
    chainId: 143,
    address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    kind: "stable",
    source: "Circle native USDC on Monad",
  },
  { chainId: 42161, address: NATIVE_ASSET_ADDRESS, symbol: "ETH", name: "Ether", decimals: 18, kind: "native", source: "native" },
  {
    chainId: 42161,
    address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    kind: "stable",
    source: "Circle native USDC on Arbitrum One",
  },
  {
    chainId: 42161,
    address: "0x004B506865409877C9fA29bfb1ebA929984B9bbC",
    symbol: "USDG",
    name: "Global Dollar",
    decimals: 6,
    kind: "stable",
    source: "Paxos USDG on Arbitrum Mainnet",
  },
  { chainId: 4663, address: NATIVE_ASSET_ADDRESS, symbol: "ETH", name: "Ether", decimals: 18, kind: "native", source: "native" },
  {
    chainId: 4663,
    address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    symbol: "USDG",
    name: "Global Dollar",
    decimals: 6,
    kind: "stable",
    source: "Paxos USDG on Robinhood Mainnet",
  },
  { chainId: 8453, address: NATIVE_ASSET_ADDRESS, symbol: "ETH", name: "Ether", decimals: 18, kind: "native", source: "native" },
  {
    chainId: 8453,
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    kind: "stable",
    source: "Circle native USDC on Base",
  },
  { chainId: 16661, address: NATIVE_ASSET_ADDRESS, symbol: "0G", name: "0G", decimals: 18, kind: "native", source: "native" },
];

export function isSwapChainId(value: unknown): value is SwapChainId {
  return typeof value === "number" && (SWAP_CHAIN_IDS as readonly number[]).includes(value);
}

export function swapAssetsFor(chainId: number): SwapAsset[] {
  return SWAP_ASSETS.filter((a) => a.chainId === chainId);
}

/** The allowlisted asset at `address` on `chainId`, or null. Case-insensitive on the address. */
export function findSwapAsset(chainId: number, address: string | null | undefined): SwapAsset | null {
  if (!address) return null;
  const want = address.toLowerCase();
  return SWAP_ASSETS.find((a) => a.chainId === chainId && a.address.toLowerCase() === want) ?? null;
}

export function nativeSwapAsset(chainId: number): SwapAsset | null {
  return SWAP_ASSETS.find((a) => a.chainId === chainId && a.kind === "native") ?? null;
}

/** Stablecoins are priced at one dollar for display; the route's own USD figures come from LI.FI. */
export const STABLE_USD = 1;
