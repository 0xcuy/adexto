"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { AlertTriangle, ArrowDownUp, CheckCircle2, ExternalLink, Loader2, RefreshCw, Settings2, X } from "lucide-react";

import { useWallet } from "@/context/WalletContext";
import { getActiveEip1193 } from "@/lib/wallet-provider";
import { describeTxError } from "@/lib/dex";
import { chainFromId, chainMark, explorerTxUrl, nativeAssetLogo } from "@/lib/chains";
import { formatUsd } from "@/lib/pricing";
import { SWAP_CHAIN_IDS, swapAssetsFor, type SwapAsset } from "@/config/swap-assets";
import {
  DEFAULT_SWAP_SETTINGS,
  SLIPPAGE_CHOICES,
  formatEta,
  formatUnitsShort,
  loadRecentTransfers,
  loadSwapSettings,
  parseAmount,
  requestBridges,
  requestRoutes,
  requestStatus,
  requestTransfer,
  saveRecentTransfers,
  saveSwapSettings,
  sendPreparedTransfer,
  type RecentTransfer,
  type SwapBridge,
  type SwapRouteSummary,
  type SwapSettings,
} from "@/lib/cross-chain-client";
import type { SwapBalances } from "@/components/swap/useSwapBalances";

/**
 * Cross-chain mode of /swap: move native or a stablecoin between ADEXTO's five chains.
 *
 * Routes come from LI.FI through /api/swap/*. The user signs in their own wallet; ADEXTO never
 * holds the funds. The recipient is always the sending wallet, on purpose: our own wallets have
 * been targeted with look-alike addresses, and a recipient field is where that attack lands.
 */

/** Native left behind by "Max", so the transfer itself can still pay for gas. */
const GAS_RESERVE: Record<string, string> = { ETH: "0.00008", MON: "1", "0G": "0.05" };

function assetLogo(asset: SwapAsset): string | null {
  if (asset.kind === "native") return nativeAssetLogo(asset.symbol);
  return null;
}

function AssetSelect({
  label,
  chainId,
  token,
  onChain,
  onToken,
  idPrefix,
}: {
  label: string;
  chainId: number;
  token: string;
  onChain: (id: number) => void;
  onToken: (address: string) => void;
  idPrefix: string;
}) {
  const assets = swapAssetsFor(chainId);
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1 text-[11px] font-medium text-ink-soft" htmlFor={`${idPrefix}-chain`}>
        {label} chain
        <select
          id={`${idPrefix}-chain`}
          value={chainId}
          onChange={(e) => onChain(Number(e.target.value))}
          className="h-[40px] rounded-xl border border-line bg-cream-2 px-2.5 text-[13px] font-semibold text-ink focus:border-accent focus:outline-none"
        >
          {SWAP_CHAIN_IDS.map((id) => (
            <option key={id} value={id}>
              {chainFromId(id)?.name ?? id}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[11px] font-medium text-ink-soft" htmlFor={`${idPrefix}-token`}>
        {label} asset
        <select
          id={`${idPrefix}-token`}
          value={token}
          onChange={(e) => onToken(e.target.value)}
          className="h-[40px] rounded-xl border border-line bg-cream-2 px-2.5 text-[13px] font-semibold text-ink focus:border-accent focus:outline-none"
        >
          {assets.map((a) => (
            <option key={a.address} value={a.address}>
              {a.symbol}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function ChainMark({ chainId }: { chainId: number }) {
  const c = chainFromId(chainId);
  const mark = c ? chainMark(c) : null;
  return mark ? <img src={mark} alt="" aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full object-contain" /> : null;
}

function SettingsDialog({
  open,
  onClose,
  settings,
  onChange,
  bridges,
  bridgesError,
  pair,
}: {
  open: boolean;
  onClose: () => void;
  settings: SwapSettings;
  onChange: (s: SwapSettings) => void;
  bridges: SwapBridge[];
  bridgesError: string | null;
  pair: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const relevant = bridges.filter((b) => b.pairs.includes(pair));
  const others = bridges.filter((b) => !b.pairs.includes(pair));
  const toggle = (key: string) => {
    const denied = new Set(settings.deniedBridges);
    if (denied.has(key)) denied.delete(key);
    else denied.add(key);
    onChange({ ...settings, deniedBridges: [...denied] });
  };
  const row = (b: SwapBridge) => {
    const on = !settings.deniedBridges.includes(b.key);
    return (
      <li key={b.key} className="flex items-center justify-between gap-3 py-1.5">
        <span className="text-[13px] text-ink">{b.name}</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={`Use ${b.name}`}
          onClick={() => toggle(b.key)}
          className={`relative h-[24px] w-[44px] shrink-0 rounded-full border transition-colors ${on ? "border-accent bg-accent" : "border-line-strong bg-cream-3"}`}
        >
          <span className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-[2px]"}`} />
        </button>
      </li>
    );
  };
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby="swap-settings-title"
      className="m-auto w-[min(92vw,420px)] rounded-card border border-line bg-surface p-0 text-ink backdrop:bg-black/50"
    >
      <div className="max-h-[80vh] overflow-y-auto p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="swap-settings-title" className="text-base font-semibold">
            Cross-chain settings
          </h2>
          <button type="button" onClick={onClose} aria-label="Close settings" className="rounded-lg p-2 text-ink-soft hover:bg-cream-2 hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <section className="mb-5">
          <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">Route preference</h3>
          <div className="flex rounded-xl border border-line bg-cream-2 p-1 text-xs" role="radiogroup" aria-label="Route preference">
            {(["CHEAPEST", "FASTEST"] as const).map((o) => (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={settings.order === o}
                onClick={() => onChange({ ...settings, order: o })}
                className={`h-[34px] flex-1 rounded-lg font-semibold ${settings.order === o ? "bg-surface text-ink shadow-sm" : "text-ink-soft"}`}
              >
                {o === "CHEAPEST" ? "Most received" : "Fastest delivery"}
              </button>
            ))}
          </div>
        </section>

        <section className="mb-5">
          <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">Max slippage</h3>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Max slippage">
            {SLIPPAGE_CHOICES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={settings.slippage === s}
                onClick={() => onChange({ ...settings, slippage: s })}
                className={`h-[34px] flex-1 rounded-lg border text-xs font-semibold ${settings.slippage === s ? "border-accent/40 bg-accent-soft text-accent" : "border-line bg-cream-2 text-ink-soft"}`}
                data-numeric
              >
                {(s * 100).toFixed(s * 100 < 1 ? 1 : 0)}%
              </button>
            ))}
          </div>
        </section>

        <section className="mb-5">
          <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">Value loss warning</h3>
          <p className="mb-2 text-[12px] text-ink-soft">Ask for confirmation when a route delivers this much less than you spend, fees and gas included.</p>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="number"
              min={1}
              max={50}
              step={1}
              value={settings.valueLossWarnPct}
              onChange={(e) => {
                const v = Math.round(Number(e.target.value));
                if (Number.isFinite(v) && v >= 1 && v <= 50) onChange({ ...settings, valueLossWarnPct: v });
              }}
              aria-label="Value loss warning threshold in percent"
              className="h-[36px] w-20 rounded-lg border border-line bg-cream-2 px-2 text-right font-semibold"
              data-numeric
            />
            %
          </label>
        </section>

        <section>
          <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">Bridges</h3>
          <p className="mb-2 text-[12px] text-ink-soft">Every enabled bridge is asked for a route. Switch one off to leave it out.</p>
          {bridgesError && <p className="text-[12px] text-warn">{bridgesError}</p>}
          {relevant.length > 0 && (
            <>
              <p className="mt-2 text-[11px] font-semibold text-ink-faint">Serve this pair</p>
              <ul className="divide-y divide-line">{relevant.map(row)}</ul>
            </>
          )}
          {others.length > 0 && (
            <>
              <p className="mt-3 text-[11px] font-semibold text-ink-faint">Other chain pairs only</p>
              <ul className="divide-y divide-line">{others.map(row)}</ul>
            </>
          )}
          <button
            type="button"
            onClick={() => onChange(DEFAULT_SWAP_SETTINGS)}
            className="mt-4 h-[36px] w-full rounded-xl border border-line text-xs font-semibold text-ink-soft hover:text-ink"
          >
            Reset to defaults
          </button>
        </section>
      </div>
    </dialog>
  );
}

function RouteCard({
  route,
  selected,
  onSelect,
  toAsset,
  warnPct,
}: {
  route: SwapRouteSummary;
  selected: boolean;
  onSelect: () => void;
  toAsset: SwapAsset;
  warnPct: number;
}) {
  const loss = route.valueLossPct;
  const high = loss != null && loss > warnPct;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`w-full rounded-2xl border p-3.5 text-left transition-colors ${selected ? "border-accent bg-accent-soft/40" : "border-line bg-surface hover:border-line-strong"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-semibold text-ink">{route.tool.name}</span>
          {route.tags.includes("CHEAPEST") && <span className="rounded-full bg-ok/10 px-2 py-0.5 text-[10px] font-semibold text-ok">Most received</span>}
          {route.tags.includes("FASTEST") && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">Fastest</span>}
        </span>
        <span className="shrink-0 text-[12px] text-ink-soft" data-numeric>
          {formatEta(route.etaSeconds)}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[15px] font-semibold text-ink" data-numeric>
          {formatUnitsShort(route.toAmount, toAsset.decimals)} {toAsset.symbol}
        </span>
        <span className="text-[12px] text-ink-soft" data-numeric>
          {formatUsd(route.toAmountUsd)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[11px] text-ink-faint">
        <span data-numeric>
          Fees {formatUsd(route.feeUsd)} · gas {formatUsd(route.gasUsd)}
          {route.needsApproval ? " · approval + transfer" : " · one signature"}
        </span>
        {loss != null && (
          <span className={high ? "font-semibold text-warn" : ""} data-numeric>
            {high && <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" />}
            {loss.toFixed(loss < 1 ? 2 : 1)}% value loss
          </span>
        )}
      </div>
    </button>
  );
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: "In transit",
  DONE: "Delivered",
  FAILED: "Failed",
  NOT_FOUND: "Waiting for the bridge to see it",
  INVALID: "Not a bridge transfer",
};

export default function CrossChainSwap({
  balances,
  preset,
}: {
  balances: SwapBalances;
  /** Set by the Balances panel's "Move" button; `nonce` makes repeated clicks on one chain count. */
  preset?: { fromChainId: number; nonce: number } | null;
}) {
  const { address, isConnected, isConnecting, connectWallet } = useWallet();

  const [fromChainId, setFromChainId] = useState<number>(8453);
  const [toChainId, setToChainId] = useState<number>(4663);
  const [fromToken, setFromToken] = useState<string>(swapAssetsFor(8453)[0].address);
  const [toToken, setToToken] = useState<string>(swapAssetsFor(4663)[0].address);
  const [amountInput, setAmountInput] = useState("");
  const [settings, setSettings] = useState<SwapSettings>(DEFAULT_SWAP_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bridges, setBridges] = useState<SwapBridge[]>([]);
  const [bridgesError, setBridgesError] = useState<string | null>(null);
  const [routes, setRoutes] = useState<SwapRouteSummary[]>([]);
  const [routeReason, setRouteReason] = useState<string | null>(null);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmLoss, setConfirmLoss] = useState(false);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentTransfer[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    setSettings(loadSwapSettings());
    setRecent(loadRecentTransfers());
    requestBridges()
      .then(setBridges)
      .catch((e) => setBridgesError(String(e?.message ?? e)));
  }, []);

  const updateSettings = (s: SwapSettings) => {
    setSettings(s);
    saveSwapSettings(s);
  };

  const fromAsset = useMemo(() => swapAssetsFor(fromChainId).find((a) => a.address === fromToken) ?? swapAssetsFor(fromChainId)[0], [fromChainId, fromToken]);
  const toAsset = useMemo(() => swapAssetsFor(toChainId).find((a) => a.address === toToken) ?? swapAssetsFor(toChainId)[0], [toChainId, toToken]);
  const fromChain = chainFromId(fromChainId)!;
  const toChain = chainFromId(toChainId)!;
  const amount = parseAmount(amountInput, fromAsset.decimals);
  const sameAsset = fromChainId === toChainId && fromAsset.address === toAsset.address;

  const heldRaw = useMemo(() => {
    const c = balances.report?.chains.find((x) => x.chainId === fromChainId);
    const a = c?.assets.find((x) => x.address.toLowerCase() === fromAsset.address.toLowerCase());
    return a ? BigInt(a.raw) : null;
  }, [balances.report, fromChainId, fromAsset.address]);

  const setChain = (side: "from" | "to", id: number) => {
    const first = swapAssetsFor(id)[0].address;
    if (side === "from") {
      setFromChainId(id);
      setFromToken(first);
    } else {
      setToChainId(id);
      setToToken(first);
    }
  };

  useEffect(() => {
    if (!preset) return;
    setChain("from", preset.fromChainId);
    if (preset.fromChainId === toChainId) setChain("to", preset.fromChainId === 8453 ? 4663 : 8453);
    setAmountInput("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset?.nonce]);

  const flip = () => {
    setFromChainId(toChainId);
    setToChainId(fromChainId);
    setFromToken(toAsset.address);
    setToToken(fromAsset.address);
    setAmountInput("");
  };

  const setMax = () => {
    if (heldRaw == null) return;
    let v = heldRaw;
    if (fromAsset.kind === "native") {
      const reserve = ethers.parseUnits(GAS_RESERVE[fromAsset.symbol] ?? "0", fromAsset.decimals);
      v = v > reserve ? v - reserve : 0n;
    }
    setAmountInput(v > 0n ? ethers.formatUnits(v, fromAsset.decimals) : "0");
  };

  // Routes, debounced, re-asked whenever the transfer or the settings change.
  const amountKey = amount?.toString() ?? "";
  const deniedKey = settings.deniedBridges.slice().sort().join(",");
  useEffect(() => {
    setRoutes([]);
    setRouteReason(null);
    setRouteError(null);
    setSelectedId(null);
    setConfirmLoss(false);
    if (!amount || sameAsset) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setRoutesLoading(true);
      try {
        const res = await requestRoutes(
          {
            fromChainId,
            toChainId,
            fromToken: fromAsset.address,
            toToken: toAsset.address,
            amount: amount.toString(),
            address,
            order: settings.order,
            slippage: settings.slippage,
            denyBridges: settings.deniedBridges,
          },
          ctrl.signal,
        );
        setRoutes(res.routes);
        setRouteReason(res.reason);
        setSelectedId(res.routes[0]?.id ?? null);
      } catch (e: any) {
        if (e?.name !== "AbortError") setRouteError(String(e?.message ?? e));
      } finally {
        if (!ctrl.signal.aborted) setRoutesLoading(false);
      }
    }, 450);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromChainId, toChainId, fromAsset.address, toAsset.address, amountKey, address, settings.order, settings.slippage, deniedKey, sameAsset, refreshTick]);

  const selected = routes.find((r) => r.id === selectedId) ?? null;
  const lossTooHigh = Boolean(selected && selected.valueLossPct != null && selected.valueLossPct > settings.valueLossWarnPct);
  const insufficient = Boolean(amount && heldRaw != null && amount > heldRaw);

  // Poll recent transfers that are still on their way.
  const recentRef = useRef(recent);
  recentRef.current = recent;
  const pollRecent = useCallback(async () => {
    const list = recentRef.current;
    const open = list.filter((t) => (t.status === "PENDING" || t.status === "NOT_FOUND") && Date.now() - t.sentAt < 2 * 3600_000);
    if (!open.length) return;
    let changed = false;
    const next = [...list];
    for (const t of open) {
      try {
        const s = await requestStatus(t);
        const i = next.findIndex((x) => x.txHash === t.txHash);
        if (i >= 0 && (next[i].status !== s.status || next[i].receivingTxHash !== (s.receiving?.txHash ?? null))) {
          next[i] = { ...next[i], status: s.status, receivingTxHash: s.receiving?.txHash ?? null, explorerUrl: s.explorerUrl ?? next[i].explorerUrl };
          changed = true;
          if (s.status === "DONE") balances.refreshSoon();
        }
      } catch {
        // try again on the next tick
      }
    }
    if (changed) {
      setRecent(next);
      saveRecentTransfers(next);
    }
  }, [balances]);

  useEffect(() => {
    void pollRecent();
    const timer = setInterval(() => void pollRecent(), 6_000);
    return () => clearInterval(timer);
  }, [pollRecent]);

  const execute = async () => {
    if (!isConnected || !address) {
      await connectWallet();
      return;
    }
    if (!selected || !amount) return;
    if (selected.quoteOnly) {
      setRefreshTick((t) => t + 1);
      return;
    }
    if (lossTooHigh && !confirmLoss) return;
    setBusy(true);
    setError(null);
    setLine("Checking the route…");
    try {
      const prepared = await requestTransfer(selected.id, address);
      const { txHash } = await sendPreparedTransfer({
        ethereum: getActiveEip1193(),
        chain: fromChain,
        prepared,
        expectedAddress: address,
        onLine: setLine,
      });
      const entry: RecentTransfer = {
        txHash,
        fromChainId,
        toChainId,
        sent: `${formatUnitsShort(selected.fromAmount, fromAsset.decimals)} ${fromAsset.symbol} on ${fromChain.name}`,
        expected: `${formatUnitsShort(selected.toAmount, toAsset.decimals)} ${toAsset.symbol} on ${toChain.name}`,
        toolKey: selected.tool.key,
        toolName: selected.tool.name,
        sentAt: Date.now(),
        status: "PENDING",
        receivingTxHash: null,
        explorerUrl: null,
      };
      const next = [entry, ...recentRef.current.filter((r) => r.txHash !== txHash)];
      setRecent(next);
      saveRecentTransfers(next);
      setLine(`Sent through ${selected.tool.name}. It shows as delivered below once ${toChain.name} receives it.`);
      setAmountInput("");
      balances.refreshSoon();
    } catch (e) {
      setError(describeTxError(e));
      setLine(null);
    } finally {
      setBusy(false);
    }
  };

  let cta = "Review route";
  let ctaDisabled = false;
  if (!isConnected) {
    cta = isConnecting ? "Connecting…" : "Connect wallet to move funds";
    ctaDisabled = isConnecting;
  } else if (sameAsset) {
    cta = "Pick a different asset or chain";
    ctaDisabled = true;
  } else if (!amount) {
    cta = "Enter an amount";
    ctaDisabled = true;
  } else if (insufficient) {
    cta = `Not enough ${fromAsset.symbol} on ${fromChain.name}`;
    ctaDisabled = true;
  } else if (routesLoading) {
    cta = "Finding routes…";
    ctaDisabled = true;
  } else if (!selected) {
    cta = "No route available";
    ctaDisabled = true;
  } else if (selected.quoteOnly) {
    cta = "Refresh routes for this wallet";
  } else if (lossTooHigh && !confirmLoss) {
    cta = "Confirm the value loss first";
    ctaDisabled = true;
  } else {
    cta = `Move to ${toChain.name}`;
  }

  return (
    <div className="glass-panel rounded-card p-5 sm:p-6" data-testid="cross-chain-swap">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[12px] text-ink-soft">Move native or stablecoins between ADEXTO&apos;s five chains.</p>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Cross-chain settings"
          className="flex h-[36px] shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs text-ink-soft hover:bg-cream-2 hover:text-ink"
        >
          <Settings2 className="h-4 w-4" aria-hidden="true" />
          <span data-numeric>{(settings.slippage * 100).toFixed(settings.slippage * 100 < 1 ? 1 : 0)}%</span>
        </button>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-4">
        <AssetSelect label="From" idPrefix="xc-from" chainId={fromChainId} token={fromAsset.address} onChain={(id) => setChain("from", id)} onToken={setFromToken} />
        <div className="mt-3 flex items-center gap-3">
          <input
            type="text"
            inputMode="decimal"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            placeholder="0"
            aria-label={`Amount of ${fromAsset.symbol} to send from ${fromChain.name}`}
            className="h-[48px] min-w-0 flex-1 bg-transparent text-3xl font-semibold tracking-tight text-ink placeholder:text-ink-faint/60 focus:outline-none"
            data-numeric
          />
          <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-ink">
            {assetLogo(fromAsset) ? (
              <img src={assetLogo(fromAsset)!} alt="" aria-hidden="true" className="h-5 w-5 rounded-full object-contain" />
            ) : null}
            {fromAsset.symbol}
            <ChainMark chainId={fromChainId} />
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-ink-faint">
          <span data-numeric>{selected ? formatUsd(selected.fromAmountUsd) : ""}</span>
          {isConnected && (
            <span className="flex items-center gap-2">
              <span data-numeric>{heldRaw == null ? (balances.loading ? "…" : "—") : `${formatUnitsShort(heldRaw, fromAsset.decimals)} ${fromAsset.symbol}`}</span>
              {heldRaw != null && heldRaw > 0n && (
                <button
                  type="button"
                  onClick={setMax}
                  className="inline-flex min-h-[32px] min-w-[40px] items-center justify-center rounded-md border border-accent/30 bg-accent-soft px-2 text-[11px] font-semibold text-accent lg:min-h-0 lg:min-w-0 lg:py-0.5"
                >
                  Max
                </button>
              )}
            </span>
          )}
        </div>
      </div>

      <div className="relative z-10 -my-3 flex justify-center">
        <button type="button" onClick={flip} aria-label="Swap direction" className="rounded-full border border-line bg-surface p-2.5 text-ink shadow-md hover:border-line-strong">
          <ArrowDownUp className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-4">
        <AssetSelect label="To" idPrefix="xc-to" chainId={toChainId} token={toAsset.address} onChain={(id) => setChain("to", id)} onToken={setToToken} />
        <p className="mt-2 text-[11px] text-ink-faint">Delivered to the same wallet that sends it.</p>
      </div>

      <div className="mt-4" role="radiogroup" aria-label="Routes" aria-busy={routesLoading}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12px] font-semibold text-ink-soft">Routes</span>
          {amount && !sameAsset && (
            <button type="button" onClick={() => setRefreshTick((t) => t + 1)} aria-label="Refresh routes" className="rounded-lg p-1.5 text-ink-faint hover:text-ink">
              <RefreshCw className={`h-3.5 w-3.5 ${routesLoading ? "animate-spin" : ""}`} aria-hidden="true" />
            </button>
          )}
        </div>
        {!amount && <p className="rounded-2xl border border-dashed border-line px-3.5 py-3 text-[12px] text-ink-faint">Enter an amount to see routes.</p>}
        {routesLoading && routes.length === 0 && (
          <p className="flex items-center gap-2 rounded-2xl border border-line px-3.5 py-3 text-[12px] text-ink-soft">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Asking the bridges…
          </p>
        )}
        {routeError && <p className="rounded-2xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-[12px] text-danger">{routeError}</p>}
        {!routesLoading && !routeError && amount && !sameAsset && routes.length === 0 && (
          <p className="rounded-2xl border border-warn/30 bg-warn/10 px-3.5 py-3 text-[12px] text-ink">
            {routeReason ?? "No route for this amount between these chains."} Try a larger amount, a different asset, or route through Base or Arbitrum.
          </p>
        )}
        <div className="space-y-2">
          {routes.map((r) => (
            <RouteCard key={r.id} route={r} selected={r.id === selectedId} onSelect={() => setSelectedId(r.id)} toAsset={toAsset} warnPct={settings.valueLossWarnPct} />
          ))}
        </div>
        {selected && (
          <p className="mt-2 text-[11px] text-ink-faint" data-numeric>
            At least {formatUnitsShort(selected.toAmountMin, toAsset.decimals)} {toAsset.symbol} arrives, or the bridge refunds you.
          </p>
        )}
      </div>

      {lossTooHigh && selected && (
        <label className="mt-3 flex items-start gap-2.5 rounded-2xl border border-warn/30 bg-warn/10 p-3.5 text-[12px] text-ink">
          <input type="checkbox" checked={confirmLoss} onChange={(e) => setConfirmLoss(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong className="font-semibold">This route loses {selected.valueLossPct!.toFixed(1)}% of the value.</strong> That is above your{" "}
            {settings.valueLossWarnPct}% warning. Tick to send anyway.
          </span>
        </label>
      )}

      <div aria-live="polite" className="mt-3 space-y-2">
        {error && (
          <p className="flex items-start gap-2 rounded-2xl border border-danger/30 bg-danger/10 p-3.5 text-[12px] text-danger">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
        {line && !error && <p className="rounded-2xl border border-line bg-cream-2 p-3.5 text-[12px] text-ink-soft">{line}</p>}
      </div>

      <button
        type="button"
        data-testid="xc-cta"
        onClick={() => void execute()}
        disabled={busy || ctaDisabled}
        className="mt-4 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-accent py-4 text-[15px] font-semibold text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-cream-3 disabled:text-ink-soft"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {busy ? "Working…" : cta}
      </button>

      <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
        Routes are found by LI.FI and carried by the bridge named on each route. You sign in your own wallet, and ADEXTO never holds the funds.
      </p>

      {recent.length > 0 && (
        <section className="mt-5 border-t border-line pt-4" aria-labelledby="xc-recent">
          <h3 id="xc-recent" className="mb-2 text-[12px] font-semibold text-ink-soft">
            Recent transfers
          </h3>
          <ul className="space-y-2">
            {recent.map((t) => (
              <li key={t.txHash} className="rounded-2xl border border-line bg-surface p-3 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-semibold text-ink">
                    <ChainMark chainId={t.fromChainId} />→<ChainMark chainId={t.toChainId} />
                    <span className="truncate">{t.toolName}</span>
                  </span>
                  <span
                    className={`flex shrink-0 items-center gap-1 font-semibold ${t.status === "DONE" ? "text-ok" : t.status === "FAILED" ? "text-danger" : "text-ink-soft"}`}
                  >
                    {t.status === "DONE" ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : t.status === "FAILED" ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                    {STATUS_LABEL[t.status] ?? t.status}
                  </span>
                </div>
                <p className="mt-1 text-ink-soft" data-numeric>
                  {t.sent} → {t.expected}
                </p>
                <p className="mt-1 flex flex-wrap gap-x-3 text-[11px]">
                  <a href={explorerTxUrl(t.fromChainId, t.txHash)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                    Sent <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                  {t.receivingTxHash && (
                    <a href={explorerTxUrl(t.toChainId, t.receivingTxHash)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                      Received <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  )}
                  {t.explorerUrl && (
                    <a href={t.explorerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                      Bridge status <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={updateSettings}
        bridges={bridges}
        bridgesError={bridgesError}
        pair={`${fromChainId}-${toChainId}`}
      />
    </div>
  );
}
