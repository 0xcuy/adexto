"use client";

import { useEffect, useState } from "react";
import type { MarketStats } from "@/lib/market-stats";

/**
 * Satu pengambilan `/api/agent/telemetry` per pasar, dibagi ke semua komponen yang
 * membutuhkannya: feed perdagangan, strip statistik, dan filter.
 *
 * Sebelumnya feed mengambil sendiri tiap sepuluh detik. Menambah strip statistik dan filter
 * dengan pola yang sama berarti tiga permintaan identik per penonton per sepuluh detik — dan
 * lebih buruk, tiga salinan data yang bisa sedikit berbeda karena tiba pada saat berbeda,
 * sehingga strip bisa menyebut "5 beli" sementara feed di bawahnya menampilkan enam.
 * Satu sumber membuat keduanya selalu membaca himpunan yang sama.
 *
 * Chart tetap mengambil sendiri karena ia meminta `bucket` yang berbeda-beda.
 */

export interface TelemetryTrade {
  id: string;
  txHash: string;
  type: "BUY" | "SELL" | "AUTO_BUYBACK";
  symbol: string;
  amountToken: number;
  amountNative: number;
  nativeSymbol: string;
  priceNative: number;
  priceNativeAfter?: number | null;
  trader: string;
  recipient?: string | null;
  timestamp: string;
  blockNumber: number | null;
  chainId: number;
  source: "onchain" | "agent" | "genesis";
}

export interface TelemetryCoverage {
  fromBlock: number | null;
  toBlock: number | null;
  reachedLaunch: boolean;
  truncated: boolean;
  blocksScanned: number;
  calls: number;
  error: string | null;
}

export interface TelemetryIndexStatus {
  complete: boolean;
  progress: number;
  scannedTo: number;
  head: number;
  launchBlock: number;
  updating: boolean;
  error: string | null;
}

export interface TelemetrySnapshot {
  loaded: boolean;
  trades: TelemetryTrade[];
  source: string;
  coverage: TelemetryCoverage | null;
  stats: MarketStats | null;
  index: TelemetryIndexStatus | null;
}

const EMPTY: TelemetrySnapshot = { loaded: false, trades: [], source: "", coverage: null, stats: null, index: null };
const POLL_MS = 10_000;

interface Store {
  snapshot: TelemetrySnapshot;
  listeners: Set<(s: TelemetrySnapshot) => void>;
  timer: ReturnType<typeof setInterval> | null;
  inflight: Promise<void> | null;
}

const stores = new Map<string, Store>();
const keyOf = (symbol: string, chainId: number) => `${chainId}:${symbol.toUpperCase()}`;

function storeFor(symbol: string, chainId: number): Store {
  const key = keyOf(symbol, chainId);
  let store = stores.get(key);
  if (!store) {
    store = { snapshot: EMPTY, listeners: new Set(), timer: null, inflight: null };
    stores.set(key, store);
  }
  return store;
}

function fetchInto(symbol: string, chainId: number, store: Store): Promise<void> {
  if (store.inflight) return store.inflight;
  store.inflight = (async () => {
    try {
      const res = await fetch(`/api/agent/telemetry?symbol=${encodeURIComponent(symbol)}&chainId=${chainId}`);
      if (!res.ok) return;
      const json = await res.json();
      store.snapshot = {
        loaded: true,
        trades: Array.isArray(json.trades) ? json.trades : [],
        source: String(json.source || ""),
        coverage: json.coverage ?? null,
        stats: json.stats ?? null,
        index: json.index ?? null,
      };
    } catch {
      // Jawaban sebelumnya tetap dipakai; yang baru hanya menggantikannya bila berhasil.
    } finally {
      if (!store.snapshot.loaded) store.snapshot = { ...store.snapshot, loaded: true };
      store.inflight = null;
      for (const l of store.listeners) l(store.snapshot);
    }
  })();
  return store.inflight;
}

/** Ambil ulang sekarang juga, mis. sesudah perdagangan pengguna terkonfirmasi. */
export function refreshMarketTelemetry(symbol: string, chainId: number): Promise<void> {
  return fetchInto(symbol, chainId, storeFor(symbol, chainId));
}

export function useMarketTelemetry(symbol: string, chainId: number): TelemetrySnapshot {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot>(() => storeFor(symbol, chainId).snapshot);

  useEffect(() => {
    const store = storeFor(symbol, chainId);
    setSnapshot(store.snapshot);
    store.listeners.add(setSnapshot);
    if (!store.timer) {
      fetchInto(symbol, chainId, store);
      store.timer = setInterval(() => fetchInto(symbol, chainId, store), POLL_MS);
    }
    return () => {
      store.listeners.delete(setSnapshot);
      if (store.listeners.size === 0 && store.timer) {
        clearInterval(store.timer);
        store.timer = null;
      }
    };
  }, [symbol, chainId]);

  return snapshot;
}
