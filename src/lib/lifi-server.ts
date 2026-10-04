/**
 * Server-side client for LI.FI (li.quest), the route finder behind the cross-chain swap.
 *
 * Only API routes import this file. The browser never talks to LI.FI directly, for three reasons:
 *   - one place to rate-limit, cache and swap the provider;
 *   - the transaction a user is asked to sign is checked HERE first (chain, sender, target,
 *     value), so a wrong or tampered answer from the route API never reaches a wallet;
 *   - an optional `LIFI_API_KEY` stays on the server.
 *
 * Routes are cached by id for ten minutes. The step a user executes is always the cached step
 * this server received from LI.FI, never a step object sent back by the client.
 */
import { ethers } from "ethers";
import { chainFromId, readProvider } from "@/lib/chains";
import {
  NATIVE_ASSET_ADDRESS,
  SWAP_CHAIN_IDS,
  findSwapAsset,
  isSwapChainId,
  type SwapAsset,
  type SwapChainId,
} from "@/config/swap-assets";

const LIFI_API = "https://li.quest/v1";
/** Shown in LI.FI's own analytics. No integrator fee is configured, so it moves no money. */
const INTEGRATOR = "adexto";
const TIMEOUT_MS = 15_000;
const ROUTE_TTL_MS = 10 * 60_000;
const MAX_CACHED_ROUTES = 500;
const TOOLS_TTL_MS = 60 * 60_000;
/** Answered when no wallet is connected yet. Routes priced for it can be shown, never executed. */
export const QUOTE_ONLY_ADDRESS = "0x000000000000000000000000000000000000dEaD";

export class SwapRouteError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "SwapRouteError";
  }
}

async function lifi<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const key = process.env.LIFI_API_KEY;
  if (key) headers["x-lifi-api-key"] = key;
  let res: Response;
  try {
    res = await fetch(`${LIFI_API}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new SwapRouteError("The route service did not answer in time. Try again.", 504);
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new SwapRouteError("The route service sent an unreadable answer.", 502);
  }
  if (res.status === 429) throw new SwapRouteError("The route service is busy. Try again in a minute.", 503);
  if (!res.ok) {
    const reason = typeof json?.message === "string" ? json.message.slice(0, 160) : `HTTP ${res.status}`;
    throw new SwapRouteError(`The route service refused the request: ${reason}`, res.status >= 500 ? 502 : 400);
  }
  return json as T;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const lc = (v: unknown) => String(v ?? "").toLowerCase();

// ── Routes ───────────────────────────────────────────────────────────────────

export interface RouteRequest {
  fromChainId: SwapChainId;
  toChainId: SwapChainId;
  fromToken: string;
  toToken: string;
  /** Base units, decimal string. */
  amount: string;
  /** Sender and recipient. The recipient is always the sender: see the poisoning note in the UI. */
  address: string;
  order: "CHEAPEST" | "FASTEST";
  /** Fraction, e.g. 0.005 for 0.5%. */
  slippage: number;
  denyBridges: string[];
}

export interface RouteFee {
  name: string;
  usd: number;
  /** True when the fee is already taken out of the amount received; false when paid on top. */
  included: boolean;
}

export interface SwapRouteSummary {
  id: string;
  tool: { key: string; name: string };
  tags: string[];
  etaSeconds: number;
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  fromAmountUsd: number;
  toAmount: string;
  toAmountMin: string;
  toAmountUsd: number;
  feeUsd: number;
  gasUsd: number;
  fees: RouteFee[];
  /** Share of what the user spends (amount + gas + fees paid on top) that does not arrive. */
  valueLossPct: number | null;
  /** ERC-20 input: an exact-amount approval may be needed before the transfer. */
  needsApproval: boolean;
  /** Priced for `QUOTE_ONLY_ADDRESS`; the client has to re-quote with the real wallet to execute. */
  quoteOnly: boolean;
}

interface CachedRoute {
  at: number;
  request: RouteRequest;
  route: any;
  summary: SwapRouteSummary;
}

declare global {
  var __ADEXTO_SWAP_ROUTES__: Map<string, CachedRoute> | undefined;
  var __ADEXTO_SWAP_TOOLS__: { at: number; value: SwapBridge[] } | undefined;
}

function routeCache(): Map<string, CachedRoute> {
  if (!(globalThis.__ADEXTO_SWAP_ROUTES__ instanceof Map)) globalThis.__ADEXTO_SWAP_ROUTES__ = new Map();
  return globalThis.__ADEXTO_SWAP_ROUTES__;
}

function remember(entry: CachedRoute) {
  const cache = routeCache();
  const now = Date.now();
  for (const [id, e] of cache) if (now - e.at > ROUTE_TTL_MS) cache.delete(id);
  while (cache.size >= MAX_CACHED_ROUTES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  cache.set(entry.summary.id, entry);
}

function summarize(route: any, request: RouteRequest): SwapRouteSummary | null {
  // Single-step routes only. A multi-step route needs a second signature on another chain after
  // the first leg lands, which this version does not orchestrate; showing it would invite a
  // half-finished transfer.
  if (!route || typeof route.id !== "string" || !Array.isArray(route.steps) || route.steps.length !== 1) return null;
  const step = route.steps[0];
  const est = step?.estimate ?? {};
  if (!est.approvalAddress || !ethers.isAddress(est.approvalAddress)) return null;
  const fees: RouteFee[] = (Array.isArray(est.feeCosts) ? est.feeCosts : []).map((f: any) => ({
    name: String(f?.name ?? "Fee").slice(0, 60),
    usd: num(f?.amountUSD),
    included: Boolean(f?.included),
  }));
  const gasUsd = (Array.isArray(est.gasCosts) ? est.gasCosts : []).reduce((a: number, g: any) => a + num(g?.amountUSD), 0);
  const extraFeeUsd = fees.filter((f) => !f.included).reduce((a, f) => a + f.usd, 0);
  const fromAmountUsd = num(route.fromAmountUSD);
  const toAmountUsd = num(route.toAmountUSD);
  const spent = fromAmountUsd + gasUsd + extraFeeUsd;
  return {
    id: route.id,
    tool: { key: String(step.tool ?? ""), name: String(step.toolDetails?.name ?? step.tool ?? "Bridge").slice(0, 40) },
    tags: Array.isArray(route.tags) ? route.tags.filter((t: unknown) => typeof t === "string").slice(0, 4) : [],
    etaSeconds: num(est.executionDuration),
    fromChainId: Number(route.fromChainId),
    toChainId: Number(route.toChainId),
    fromToken: request.fromToken,
    toToken: request.toToken,
    fromAmount: String(route.fromAmount),
    fromAmountUsd,
    toAmount: String(route.toAmount),
    toAmountMin: String(route.toAmountMin),
    toAmountUsd,
    feeUsd: fees.reduce((a, f) => a + f.usd, 0),
    gasUsd,
    fees,
    valueLossPct: spent > 0 && toAmountUsd > 0 ? Math.max(0, ((spent - toAmountUsd) / spent) * 100) : null,
    needsApproval: lc(request.fromToken) !== lc(NATIVE_ASSET_ADDRESS),
    quoteOnly: lc(request.address) === lc(QUOTE_ONLY_ADDRESS),
  };
}

/** The answer LI.FI gives must describe the transfer that was asked for, or it is not shown. */
function matchesRequest(route: any, request: RouteRequest): boolean {
  const action = route?.steps?.[0]?.action;
  return (
    Number(route?.fromChainId) === request.fromChainId &&
    Number(route?.toChainId) === request.toChainId &&
    String(route?.fromAmount) === request.amount &&
    lc(action?.fromToken?.address) === lc(request.fromToken) &&
    lc(action?.toToken?.address) === lc(request.toToken) &&
    lc(action?.fromAddress) === lc(request.address) &&
    lc(action?.toAddress) === lc(request.address)
  );
}

export async function findRoutes(request: RouteRequest): Promise<{ routes: SwapRouteSummary[]; reason: string | null }> {
  const body = {
    fromChainId: request.fromChainId,
    toChainId: request.toChainId,
    fromTokenAddress: request.fromToken,
    toTokenAddress: request.toToken,
    fromAmount: request.amount,
    fromAddress: request.address,
    toAddress: request.address,
    options: {
      integrator: INTEGRATOR,
      slippage: request.slippage,
      order: request.order,
      // No route that needs a signature on the destination chain: the user signs once, here.
      allowSwitchChain: false,
      ...(request.denyBridges.length ? { bridges: { deny: request.denyBridges } } : {}),
    },
  };
  const json = await lifi<any>("/advanced/routes", { method: "POST", body });
  const raw: any[] = Array.isArray(json?.routes) ? json.routes : [];
  const routes: SwapRouteSummary[] = [];
  for (const r of raw) {
    if (!matchesRequest(r, request)) continue;
    const summary = summarize(r, request);
    if (!summary) continue;
    remember({ at: Date.now(), request, route: r, summary });
    routes.push(summary);
    if (routes.length >= 3) break;
  }
  let reason: string | null = null;
  if (!routes.length) {
    const filtered = json?.unavailableRoutes?.filteredOut;
    const failed = json?.unavailableRoutes?.failed;
    if (raw.length > 0) reason = "Only multi-step routes exist for this pair, and those are not offered here yet.";
    else if (Array.isArray(failed) && failed.length) reason = "No bridge can carry this amount between these chains right now.";
    else if (Array.isArray(filtered) && filtered.length) reason = "The available routes need a second signature on the destination chain.";
    else reason = "No route for this amount between these chains.";
  }
  return { routes, reason };
}

// ── The transaction for a chosen route ──────────────────────────────────────

export interface PreparedTransfer {
  routeId: string;
  tool: { key: string; name: string };
  fromChainId: number;
  toChainId: number;
  /** Exact-amount ERC-20 approval the wallet needs first, or null for native input. */
  approval: { token: string; spender: string; amount: string } | null;
  tx: { to: string; data: string; value: string; gasLimit: string | null; chainId: number };
}

/**
 * Ask LI.FI for the calldata of the cached route's step, then refuse it unless it is exactly the
 * transfer the user saw: same chain, sent from the user, sent to the contract the route named as
 * spender, carrying no more native value than the amount (plus any fee LI.FI said is paid on top).
 */
export async function prepareTransfer(routeId: string, address: string): Promise<PreparedTransfer> {
  const cached = routeCache().get(routeId);
  if (!cached || Date.now() - cached.at > ROUTE_TTL_MS) {
    throw new SwapRouteError("This quote has expired. Refresh the routes and try again.", 409);
  }
  if (cached.summary.quoteOnly) throw new SwapRouteError("Connect a wallet and refresh the routes before sending.", 409);
  if (lc(cached.request.address) !== lc(address)) {
    throw new SwapRouteError("This quote was made for a different wallet. Refresh the routes.", 409);
  }
  const step = cached.route.steps[0];
  const result = await lifi<any>("/advanced/stepTransaction", { method: "POST", body: step });
  const tx = result?.transactionRequest;
  const reject = (why: string) => {
    throw new SwapRouteError(`The route returned a transaction that does not match the quote (${why}). Nothing was sent.`, 502);
  };
  if (!tx || typeof tx !== "object") reject("no transaction");
  const action = result?.action ?? step.action;
  if (
    String(action?.fromAmount) !== cached.request.amount ||
    lc(action?.fromToken?.address) !== lc(cached.request.fromToken) ||
    lc(action?.toToken?.address) !== lc(cached.request.toToken) ||
    lc(action?.fromAddress) !== lc(address) ||
    lc(action?.toAddress) !== lc(address)
  ) {
    reject("amount, token or recipient changed");
  }
  const chainId = Number(tx.chainId);
  if (chainId !== cached.request.fromChainId) reject("wrong chain");
  if (tx.from && lc(tx.from) !== lc(address)) reject("wrong sender");
  const spender = String(result?.estimate?.approvalAddress ?? step.estimate?.approvalAddress ?? "");
  if (!ethers.isAddress(tx.to) || !ethers.isAddress(spender) || lc(tx.to) !== lc(spender)) reject("unexpected target");
  if (typeof tx.data !== "string" || !/^0x[0-9a-fA-F]{8,}$/.test(tx.data)) reject("no calldata");

  const chain = chainFromId(chainId);
  if (!chain) reject("unknown chain");
  const code = await readProvider(chain!)
    .getCode(tx.to)
    .catch(() => "0x");
  if (!code || code === "0x") reject("target is not a contract");

  // Native value bound: the amount for native input, plus fees LI.FI marked as paid on top.
  const native = lc(cached.request.fromToken) === lc(NATIVE_ASSET_ADDRESS);
  const amount = BigInt(cached.request.amount);
  const fees: any[] = Array.isArray(result?.estimate?.feeCosts) ? result.estimate.feeCosts : step.estimate?.feeCosts ?? [];
  const extraNative = fees
    .filter((f) => !f?.included && lc(f?.token?.address) === lc(NATIVE_ASSET_ADDRESS) && Number(f?.token?.chainId) === chainId)
    .reduce((a, f) => a + BigInt(String(f?.amount ?? "0")), 0n);
  let value = 0n;
  try {
    value = BigInt(tx.value ?? "0x0");
  } catch {
    reject("unreadable value");
  }
  const ceiling = (native ? amount + amount / 200n : 0n) + (extraNative * 3n) / 2n;
  if (native && value < amount) reject("value below the amount");
  if (value > ceiling) reject("value above the amount and fees");

  let gasLimit: string | null = null;
  try {
    gasLimit = tx.gasLimit ? BigInt(tx.gasLimit).toString() : null;
  } catch {
    gasLimit = null;
  }
  return {
    routeId,
    tool: cached.summary.tool,
    fromChainId: cached.request.fromChainId,
    toChainId: cached.request.toChainId,
    approval: native ? null : { token: ethers.getAddress(cached.request.fromToken), spender: ethers.getAddress(spender), amount: amount.toString() },
    tx: { to: ethers.getAddress(tx.to), data: tx.data, value: value.toString(), gasLimit, chainId },
  };
}

// ── Status of a sent transfer ───────────────────────────────────────────────

export interface TransferStatus {
  status: "PENDING" | "DONE" | "FAILED" | "NOT_FOUND" | "INVALID";
  substatus: string | null;
  message: string | null;
  receiving: { txHash: string | null; chainId: number | null; amount: string | null; symbol: string | null; decimals: number | null } | null;
  explorerUrl: string | null;
}

export async function readTransferStatus(params: { txHash: string; fromChainId: number; toChainId: number; bridge: string | null }): Promise<TransferStatus> {
  const q = new URLSearchParams({ txHash: params.txHash, fromChain: String(params.fromChainId), toChain: String(params.toChainId) });
  if (params.bridge) q.set("bridge", params.bridge);
  const json = await lifi<any>(`/status?${q.toString()}`);
  const allowed = ["PENDING", "DONE", "FAILED", "NOT_FOUND", "INVALID"];
  const status = allowed.includes(json?.status) ? json.status : "PENDING";
  const r = json?.receiving;
  return {
    status,
    substatus: typeof json?.substatus === "string" ? json.substatus : null,
    message: typeof json?.substatusMessage === "string" ? json.substatusMessage.slice(0, 200) : null,
    receiving: r
      ? {
          txHash: typeof r.txHash === "string" ? r.txHash : null,
          chainId: Number.isFinite(Number(r.chainId)) ? Number(r.chainId) : null,
          amount: r.amount != null ? String(r.amount) : null,
          symbol: typeof r.token?.symbol === "string" ? r.token.symbol.slice(0, 12) : null,
          decimals: Number.isFinite(Number(r.token?.decimals)) ? Number(r.token.decimals) : null,
        }
      : null,
    explorerUrl: typeof json?.lifiExplorerLink === "string" && json.lifiExplorerLink.startsWith("https://") ? json.lifiExplorerLink : null,
  };
}

// ── Bridges that serve our chains, for the provider toggles ─────────────────

export interface SwapBridge {
  key: string;
  name: string;
  /** "from-to" chain id pairs among our five chains. */
  pairs: string[];
}

export async function listBridges(): Promise<SwapBridge[]> {
  const hit = globalThis.__ADEXTO_SWAP_TOOLS__;
  if (hit && Date.now() - hit.at < TOOLS_TTL_MS && Array.isArray(hit.value)) return hit.value;
  const json = await lifi<any>(`/tools?chains=${SWAP_CHAIN_IDS.join(",")}`);
  const ours = new Set<number>(SWAP_CHAIN_IDS);
  const value: SwapBridge[] = [];
  for (const b of Array.isArray(json?.bridges) ? json.bridges : []) {
    if (typeof b?.key !== "string" || !/^[A-Za-z0-9]{2,40}$/.test(b.key)) continue;
    const pairs = (Array.isArray(b.supportedChains) ? b.supportedChains : [])
      .filter((p: any) => ours.has(Number(p?.fromChainId)) && ours.has(Number(p?.toChainId)))
      .map((p: any) => `${Number(p.fromChainId)}-${Number(p.toChainId)}`);
    if (pairs.length) value.push({ key: b.key, name: String(b.name ?? b.key).slice(0, 40), pairs: [...new Set<string>(pairs)] });
  }
  value.sort((a, b) => a.name.localeCompare(b.name));
  globalThis.__ADEXTO_SWAP_TOOLS__ = { at: Date.now(), value };
  return value;
}

// ── Request validation shared by the routes ─────────────────────────────────

const BRIDGE_KEY = /^[A-Za-z0-9]{2,40}$/;

/** Parse and check a route request body. Throws SwapRouteError(400) with an English sentence. */
export function parseRouteRequest(body: any): RouteRequest {
  const bad = (m: string) => {
    throw new SwapRouteError(m, 400);
  };
  const fromChainId = Number(body?.fromChainId);
  const toChainId = Number(body?.toChainId);
  if (!isSwapChainId(fromChainId) || !isSwapChainId(toChainId)) bad("Both chains must be one of ADEXTO's five chains.");
  const from: SwapAsset | null = findSwapAsset(fromChainId, body?.fromToken);
  const to: SwapAsset | null = findSwapAsset(toChainId, body?.toToken);
  if (!from || !to) bad("This asset is not on the list ADEXTO routes.");
  if (fromChainId === toChainId && lc(from!.address) === lc(to!.address)) bad("Pick a different asset or chain to receive.");
  const amount = String(body?.amount ?? "");
  if (!/^[0-9]{1,40}$/.test(amount) || BigInt(amount) === 0n) bad("Enter an amount greater than zero.");
  const address = body?.address ? String(body.address) : QUOTE_ONLY_ADDRESS;
  if (!ethers.isAddress(address)) bad("A valid wallet address is required.");
  const order = body?.order === "FASTEST" ? "FASTEST" : "CHEAPEST";
  const slippage = Number(body?.slippage ?? 0.005);
  if (!Number.isFinite(slippage) || slippage < 0.001 || slippage > 0.05) bad("Slippage must be between 0.1% and 5%.");
  const deny: string[] = Array.isArray(body?.denyBridges) ? body.denyBridges : [];
  if (deny.length > 40 || deny.some((k) => typeof k !== "string" || !BRIDGE_KEY.test(k))) bad("Unknown bridge in the provider settings.");
  return {
    fromChainId: fromChainId as SwapChainId,
    toChainId: toChainId as SwapChainId,
    fromToken: ethers.getAddress(from!.address),
    toToken: ethers.getAddress(to!.address),
    amount,
    address: ethers.getAddress(address),
    order,
    slippage,
    denyBridges: [...new Set(deny)],
  };
}
