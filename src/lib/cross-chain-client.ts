/**
 * Browser side of the cross-chain swap: talk to /api/swap/*, keep the user's settings and recent
 * transfers in localStorage, and send a prepared transfer from the connected wallet.
 *
 * The wallet path is the one the rest of the site uses (MarketStakePanel, executeBuy):
 * `ensureWalletChain` → `BrowserProvider(ethereum).getSigner()` → exact-amount approval when the
 * input is an ERC-20 → send → wait for the receipt. Nothing here builds calldata: the transaction
 * comes from /api/swap/step, which has already checked it against the quote.
 */
import { ethers } from "ethers";
import { ensureWalletChain, ERC20_ABI } from "@/lib/dex";
import type { ChainInfo } from "@/lib/chains";
import type { PreparedTransfer, SwapBridge, SwapRouteSummary, TransferStatus } from "@/lib/lifi-server";
import type { BalancesReport } from "@/lib/swap-balances";

export type { PreparedTransfer, SwapBridge, SwapRouteSummary, TransferStatus, BalancesReport };

// ── Settings ────────────────────────────────────────────────────────────────

export interface SwapSettings {
  order: "CHEAPEST" | "FASTEST";
  /** Fraction: 0.005 = 0.5%. */
  slippage: number;
  /** Ask for confirmation when a route loses more than this share of the value, in percent. */
  valueLossWarnPct: number;
  /** LI.FI bridge keys the user switched off. */
  deniedBridges: string[];
}

export const DEFAULT_SWAP_SETTINGS: SwapSettings = { order: "CHEAPEST", slippage: 0.005, valueLossWarnPct: 10, deniedBridges: [] };
export const SLIPPAGE_CHOICES = [0.003, 0.005, 0.01, 0.03];

const SETTINGS_KEY = "adexto_swap_settings";
const RECENT_KEY = "adexto_swap_recent";
const MAX_RECENT = 10;

export function loadSwapSettings(): SwapSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    if (!raw || typeof raw !== "object") return DEFAULT_SWAP_SETTINGS;
    return {
      order: raw.order === "FASTEST" ? "FASTEST" : "CHEAPEST",
      slippage: SLIPPAGE_CHOICES.includes(Number(raw.slippage)) ? Number(raw.slippage) : DEFAULT_SWAP_SETTINGS.slippage,
      valueLossWarnPct:
        Number.isFinite(Number(raw.valueLossWarnPct)) && Number(raw.valueLossWarnPct) >= 1 && Number(raw.valueLossWarnPct) <= 50
          ? Number(raw.valueLossWarnPct)
          : DEFAULT_SWAP_SETTINGS.valueLossWarnPct,
      deniedBridges: Array.isArray(raw.deniedBridges)
        ? raw.deniedBridges.filter((k: unknown) => typeof k === "string" && /^[A-Za-z0-9]{2,40}$/.test(k)).slice(0, 40)
        : [],
    };
  } catch {
    return DEFAULT_SWAP_SETTINGS;
  }
}

export function saveSwapSettings(s: SwapSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Private mode can refuse; the settings still apply to this tab.
  }
}

// ── Recent transfers ────────────────────────────────────────────────────────

export interface RecentTransfer {
  txHash: string;
  fromChainId: number;
  toChainId: number;
  /** Display amounts, already formatted, so the list never needs prices to render. */
  sent: string;
  expected: string;
  toolKey: string;
  toolName: string;
  sentAt: number;
  status: TransferStatus["status"];
  receivingTxHash: string | null;
  explorerUrl: string | null;
}

export function loadRecentTransfers(): RecentTransfer[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((r) => r && typeof r.txHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(r.txHash)).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function saveRecentTransfers(list: RecentTransfer[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch {
    // same as settings
  }
}

// ── API calls ───────────────────────────────────────────────────────────────

async function readJson(res: Response) {
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(typeof json?.error === "string" ? json.error : `Request failed (${res.status}).`);
  return json;
}

export async function requestRoutes(
  body: {
    fromChainId: number;
    toChainId: number;
    fromToken: string;
    toToken: string;
    amount: string;
    address: string | null;
    order: SwapSettings["order"];
    slippage: number;
    denyBridges: string[];
  },
  signal?: AbortSignal,
): Promise<{ routes: SwapRouteSummary[]; reason: string | null }> {
  const res = await fetch("/api/swap/routes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, address: body.address ?? undefined }),
    signal,
  });
  return readJson(res);
}

export async function requestTransfer(routeId: string, address: string): Promise<PreparedTransfer> {
  const res = await fetch("/api/swap/step", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ routeId, address }),
  });
  return readJson(res);
}

export async function requestStatus(t: { txHash: string; fromChainId: number; toChainId: number; toolKey: string }): Promise<TransferStatus> {
  const q = new URLSearchParams({ txHash: t.txHash, fromChainId: String(t.fromChainId), toChainId: String(t.toChainId) });
  if (/^[A-Za-z0-9]{2,40}$/.test(t.toolKey)) q.set("bridge", t.toolKey);
  return readJson(await fetch(`/api/swap/status?${q.toString()}`, { cache: "no-store" }));
}

export async function requestBridges(): Promise<SwapBridge[]> {
  const json = await readJson(await fetch("/api/swap/bridges"));
  return Array.isArray(json?.bridges) ? json.bridges : [];
}

export async function requestBalances(address: string): Promise<BalancesReport> {
  return readJson(await fetch(`/api/swap/balances?address=${address}`, { cache: "no-store" }));
}

// ── Sending ─────────────────────────────────────────────────────────────────

/**
 * Send a prepared transfer from the connected wallet. Returns the source-chain transaction hash
 * once it is mined. `onLine` receives short English progress lines for the status region.
 */
export async function sendPreparedTransfer(params: {
  ethereum: any;
  chain: ChainInfo;
  prepared: PreparedTransfer;
  expectedAddress: string;
  onLine: (line: string) => void;
}): Promise<{ txHash: string }> {
  const { ethereum, chain, prepared, expectedAddress, onLine } = params;
  if (prepared.tx.chainId !== chain.chainId) throw new Error("The transfer belongs to a different chain. Refresh the routes.");
  await ensureWalletChain(ethereum, chain);
  const provider = new ethers.BrowserProvider(ethereum);
  const signer = await provider.getSigner();
  const me = await signer.getAddress();
  if (me.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error("The wallet account changed since the quote. Refresh the routes.");
  }

  const value = BigInt(prepared.tx.value);
  const balance = await provider.getBalance(me);
  if (balance <= value) {
    throw new Error(`Not enough ${chain.nativeSymbol} on ${chain.name} for this amount plus gas.`);
  }

  if (prepared.approval) {
    const token = new ethers.Contract(prepared.approval.token, ERC20_ABI, signer);
    const want = BigInt(prepared.approval.amount);
    const held: bigint = await token.balanceOf(me);
    if (held < want) throw new Error("The wallet holds less than this amount.");
    const allowance: bigint = await token.allowance(me, prepared.approval.spender);
    if (allowance < want) {
      onLine("Step 1 of 2: approve exactly this amount in your wallet…");
      const ap = await token.approve(prepared.approval.spender, want);
      const apr = await ap.wait();
      if (!apr || apr.status !== 1) throw new Error("The approval transaction reverted.");
    }
  }

  onLine(prepared.approval ? `Step 2 of 2: confirm the transfer through ${prepared.tool.name}…` : `Confirm the transfer through ${prepared.tool.name} in your wallet…`);
  const tx = await signer.sendTransaction({
    to: prepared.tx.to,
    data: prepared.tx.data,
    value,
    ...(prepared.tx.gasLimit ? { gasLimit: BigInt(prepared.tx.gasLimit) } : {}),
  });
  onLine("Sent. Waiting for it to confirm on the source chain…");
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error("The transfer transaction reverted on the source chain.");
  return { txHash: receipt.hash ?? tx.hash };
}

// ── Formatting helpers ──────────────────────────────────────────────────────

/** Parse a typed amount into base units, or null when it is not a positive number. */
export function parseAmount(input: string, decimals: number): bigint | null {
  const s = input.trim().replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
  try {
    const v = ethers.parseUnits(s, decimals);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

export function formatUnitsShort(raw: string | bigint, decimals: number, maxFraction = 6): string {
  const s = ethers.formatUnits(raw, decimals);
  const [i, f = ""] = s.split(".");
  const fraction = f.slice(0, maxFraction).replace(/0+$/, "");
  const whole = Number(i).toLocaleString("en-US");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `~${Math.max(1, Math.round(seconds))} s`;
  return `~${Math.round(seconds / 60)} min`;
}
