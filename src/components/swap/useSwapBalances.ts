"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { requestBalances, type BalancesReport } from "@/lib/cross-chain-client";

export interface SwapBalances {
  report: BalancesReport | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Re-read a little later, after a transfer, when the chains have had time to settle. */
  refreshSoon: () => void;
}

/**
 * Balances of the connected wallet on all five chains, read once per minute and on demand.
 * A report for a different address (the wallet switched accounts mid-request) is discarded.
 */
export function useSwapBalances(address: string | null): SwapBalances {
  const [report, setReport] = useState<BalancesReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(address);
  current.current = address;

  const refresh = useCallback(async () => {
    if (!address) {
      setReport(null);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const r = await requestBalances(address);
      if (current.current?.toLowerCase() !== r.address.toLowerCase()) return;
      setReport(r);
      setError(null);
    } catch (e: any) {
      if (current.current === address) setError(String(e?.message ?? e).slice(0, 160));
    } finally {
      if (current.current === address) setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    setReport((r) => (r && address && r.address.toLowerCase() === address.toLowerCase() ? r : null));
    void refresh();
    if (!address) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60_000);
    return () => clearInterval(timer);
  }, [address, refresh]);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const refreshSoon = useCallback(() => {
    timers.current.push(setTimeout(() => void refresh(), 8_000));
    timers.current.push(setTimeout(() => void refresh(), 25_000));
  }, [refresh]);

  return { report, loading, error, refresh, refreshSoon };
}
