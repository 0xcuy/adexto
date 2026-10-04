/**
 * What one address holds on ADEXTO's five chains: the "Balances" panel on /swap.
 *
 * Read on the server, chain by chain, because Robinhood Chain's public RPC times out from some
 * networks (see the robinhood note in src/config/contracts.ts) and five chains read from a phone
 * would make the slowest one decide when the panel appears. Each chain has its own deadline, and
 * a chain that could not be read is reported as an error, never as zero.
 *
 * Values:
 *   - native and allowlisted stablecoins (src/config/swap-assets.ts), never tokens found by name;
 *   - every ADEXTO market on the chain: tokens in the wallet plus tokens staked (dedicated stake
 *     contract or the chain's stake hub), valued with the curve's own `getSellQuote`. Held and
 *     staked are summed BEFORE quoting, since the sell quote is not linear;
 *   - creator fees owed to the address on curves it created.
 *
 * Two Multicall3 batches per chain (see `multicall` below).
 */
import { ethers } from "ethers";
import { CHAIN_LIST, readProvider, type ChainInfo } from "@/lib/chains";
import { MULTICALL3_ADDRESS } from "@/lib/dex";
import { listProjects } from "@/lib/registry";
import { stakeForMarket } from "@/config/market-stakes";
import { SWAP_CHAIN_IDS, swapAssetsFor } from "@/config/swap-assets";
import { nativePrices } from "@/lib/native-price";

const CHAIN_DEADLINE_MS = 9_000;
const CACHE_TTL_MS = 20_000;
const MAX_CACHED = 1_000;

export interface AssetBalance {
  symbol: string;
  address: string;
  kind: "native" | "stable";
  decimals: number;
  raw: string;
  amount: number;
  usd: number | null;
}

export interface MarketPosition {
  symbol: string;
  slug: string;
  name: string;
  image: string;
  held: number;
  staked: number;
  stakeKind: "dedicated" | "hub" | null;
  /** Native received if held + staked were sold to the curve now, after fees and price impact. */
  valueNative: number | null;
  valueUsd: number | null;
}

export interface CreatorFee {
  symbol: string;
  amountNative: number;
  usd: number | null;
}

export interface ChainBalances {
  chainId: number;
  chainKey: string;
  name: string;
  nativeSymbol: string;
  assets: AssetBalance[];
  positions: MarketPosition[];
  creatorFees: CreatorFee[];
  totalUsd: number;
  error: string | null;
}

export interface BalancesReport {
  address: string;
  chains: ChainBalances[];
  totalUsd: number;
  /** True when at least one chain could not be read, so the total is a lower bound. */
  partial: boolean;
  pricesLive: boolean;
  fetchedAt: string;
}

declare global {
  var __ADEXTO_SWAP_BALANCES__: Map<string, { at: number; value: BalancesReport }> | undefined;
}

function cache() {
  if (!(globalThis.__ADEXTO_SWAP_BALANCES__ instanceof Map)) globalThis.__ADEXTO_SWAP_BALANCES__ = new Map();
  return globalThis.__ADEXTO_SWAP_BALANCES__;
}

async function withDeadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not answer within ${Math.round(ms / 1000)} s.`)), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}


const toNum = (raw: bigint, decimals: number) => Number(ethers.formatUnits(raw, decimals));

/**
 * Multicall3 `aggregate3` with `allowFailure: true`, one eth_call for a whole batch.
 *
 * Why batched: reading call by call, a chain with a few markets costs ~40 eth_calls, and one slow
 * answer from the provider (Monad's Alchemy endpoint was measured at 4.4 s for a single call on
 * 2026-10-04 while the median was ~100 ms) pushed the whole chain past its deadline. Two batches
 * per chain remove that tail. Multicall3's runtime code hashes to 0xd5c15df6… on all five chains
 * (checked 2026-10-04), the same check `claimCreatorFeesBatch` relies on.
 */
const MULTICALL = new ethers.Interface([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[] returnData)",
  "function getEthBalance(address addr) view returns (uint256 balance)",
]);
const READS = new ethers.Interface([
  "function balanceOf(address) view returns (uint256)",
  "function stakedOf(address) view returns (uint256)",
  "function stakedOf(address token, address account) view returns (uint256)",
  "function creator() view returns (address)",
  "function creatorOwed() view returns (uint256)",
  "function getSellQuote(uint256) view returns (uint256)",
]);

interface Call {
  target: string;
  data: string;
}

async function multicall(chain: ChainInfo, calls: Call[]): Promise<Array<string | null>> {
  if (!calls.length) return [];
  const data = MULTICALL.encodeFunctionData("aggregate3", [calls.map((c) => ({ target: c.target, allowFailure: true, callData: c.data }))]);
  const out = await readProvider(chain).call({ to: MULTICALL3_ADDRESS, data });
  const [results] = MULTICALL.decodeFunctionResult("aggregate3", out);
  return Array.from(results as any[], (r: any) => (r.success && r.returnData && r.returnData.length >= 66 ? (r.returnData as string) : null));
}

/** First 32-byte word as uint. Every getter used here, in every curve generation, puts its answer there. */
const word = (ret: string | null): bigint | null => (ret ? BigInt(ret.slice(0, 66)) : null);
const wordAddress = (ret: string | null): string | null => (ret ? ethers.getAddress(`0x${ret.slice(26, 66)}`) : null);

async function readChain(chain: ChainInfo, address: string, prices: Record<string, number>): Promise<ChainBalances> {
  const nativeUsd = Number.isFinite(prices[chain.nativeSymbol]) ? prices[chain.nativeSymbol] : null;
  const base: ChainBalances = {
    chainId: chain.chainId,
    chainKey: chain.key,
    name: chain.name,
    nativeSymbol: chain.nativeSymbol,
    assets: [],
    positions: [],
    creatorFees: [],
    totalUsd: 0,
    error: null,
  };
  try {
    const markets = listProjects().filter((p) => p.chainId === chain.chainId && p.tokenAddress && p.poolAddress);
    const assetsList = swapAssetsFor(chain.chainId);
    const work = async () => {
      // Batch 1: every balance, stake and creator figure on the chain.
      const calls: Call[] = assetsList.map((a) =>
        a.kind === "native"
          ? { target: MULTICALL3_ADDRESS, data: MULTICALL.encodeFunctionData("getEthBalance", [address]) }
          : { target: a.address, data: READS.encodeFunctionData("balanceOf", [address]) },
      );
      const stakes = markets.map((m) => stakeForMarket({ chainId: m.chainId, symbol: m.symbol, tokenAddress: m.tokenAddress, supply: m.supply }));
      markets.forEach((m, i) => {
        const s = stakes[i];
        calls.push({ target: m.tokenAddress, data: READS.encodeFunctionData("balanceOf", [address]) });
        calls.push(
          s
            ? s.kind === "hub"
              ? { target: s.contract, data: READS.encodeFunctionData("stakedOf(address,address)", [s.token, address]) }
              : { target: s.contract, data: READS.encodeFunctionData("stakedOf(address)", [address]) }
            : { target: m.tokenAddress, data: READS.encodeFunctionData("balanceOf", [ethers.ZeroAddress]) },
        );
        calls.push({ target: m.poolAddress!, data: READS.encodeFunctionData("creator") });
        calls.push({ target: m.poolAddress!, data: READS.encodeFunctionData("creatorOwed") });
      });
      const r1 = await multicall(chain, calls);

      const assets: AssetBalance[] = assetsList.map((a, i) => {
        const raw = word(r1[i]);
        if (raw == null) throw new Error(`${a.symbol} balance unreadable on ${chain.name}.`);
        const amount = toNum(raw, a.decimals);
        return {
          symbol: a.symbol,
          address: a.address,
          kind: a.kind,
          decimals: a.decimals,
          raw: raw.toString(),
          amount,
          usd: a.kind === "stable" ? amount : nativeUsd == null ? null : amount * nativeUsd,
        };
      });

      const off = assetsList.length;
      const rows = markets.map((m, i) => {
        const held = word(r1[off + i * 4]) ?? 0n;
        const staked = stakes[i] ? word(r1[off + i * 4 + 1]) ?? 0n : 0n;
        const creator = wordAddress(r1[off + i * 4 + 2]);
        const owed = word(r1[off + i * 4 + 3]) ?? 0n;
        return { m, stake: stakes[i], held, staked, creator, owed };
      });

      // Batch 2: the curve's own sell quote for each position, held and staked together.
      const holding = rows.filter((r) => r.held + r.staked > 0n);
      const r2 = await multicall(
        chain,
        holding.map((r) => ({ target: r.m.poolAddress!, data: READS.encodeFunctionData("getSellQuote", [r.held + r.staked]) })),
      );
      const positions: MarketPosition[] = holding.map((r, i) => {
        const out = word(r2[i]);
        const valueNative = out == null ? null : Number(ethers.formatEther(out));
        return {
          symbol: r.m.symbol,
          slug: r.m.slug,
          name: r.m.name,
          image: r.m.image,
          held: toNum(r.held, 18),
          staked: toNum(r.staked, 18),
          stakeKind: r.staked > 0n && r.stake ? (r.stake.kind === "hub" ? "hub" : "dedicated") : null,
          valueNative,
          valueUsd: valueNative == null || nativeUsd == null ? null : valueNative * nativeUsd,
        };
      });
      const fees: CreatorFee[] = rows
        .filter((r) => r.creator && r.creator.toLowerCase() === address.toLowerCase() && r.owed > 0n)
        .map((r) => {
          const amountNative = Number(ethers.formatEther(r.owed));
          return { symbol: r.m.symbol, amountNative, usd: nativeUsd == null ? null : amountNative * nativeUsd };
        });
      return { assets, positions, fees };
    };
    const { assets, positions, fees } = await withDeadline(work(), CHAIN_DEADLINE_MS, chain.name);
    base.assets = assets;
    base.positions = positions;
    base.creatorFees = fees;
    base.totalUsd =
      assets.reduce((a, x) => a + (x.usd ?? 0), 0) +
      base.positions.reduce((a, x) => a + (x.valueUsd ?? 0), 0) +
      base.creatorFees.reduce((a, x) => a + (x.usd ?? 0), 0);
  } catch (error: any) {
    base.error = String(error?.shortMessage ?? error?.message ?? error).slice(0, 160);
  }
  return base;
}

export async function readSwapBalances(addressRaw: string): Promise<BalancesReport> {
  const address = ethers.getAddress(addressRaw);
  const key = address.toLowerCase();
  const hit = cache().get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const priceRead = await nativePrices().catch(() => null);
  const prices = priceRead?.prices ?? {};
  const chains = CHAIN_LIST.filter((c) => (SWAP_CHAIN_IDS as readonly number[]).includes(c.chainId));
  const read = await Promise.all(chains.map((c) => readChain(c, address, prices)));
  const report: BalancesReport = {
    address,
    chains: read,
    totalUsd: read.reduce((a, c) => a + c.totalUsd, 0),
    partial: read.some((c) => c.error !== null),
    pricesLive: Boolean(priceRead && chains.every((c) => priceRead.live?.[c.nativeSymbol])),
    fetchedAt: new Date().toISOString(),
  };
  const store = cache();
  if (store.size >= MAX_CACHED) store.clear();
  store.set(key, { at: Date.now(), value: report });
  return report;
}
