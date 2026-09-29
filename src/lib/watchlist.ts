"use client";

import { useCallback, useEffect, useState } from "react";
import { consentAllowsPreferences } from "@/components/CookieConsent";

/**
 * Watchlist: pasar yang ditandai bintang, disimpan HANYA di peramban ini.
 *
 * Kuncinya `chainId:SYMBOL`, bentuk yang sama dengan `marketKey` registry, karena satu ticker
 * bisa punya pasar terpisah di beberapa chain dan menandai $ADEXTO di 0G tidak berarti menandai
 * $ADEXTO di Base.
 *
 * Tunduk pada pilihan penyimpanan di `CookieConsent`: dengan "essential only" daftarnya tetap
 * bekerja selama kunjungan ini (di memori) tetapi tidak ditulis ke `localStorage`, dan kuncinya
 * ikut dihapus bersama preferensi lain.
 */

export const WATCHLIST_KEY = "adexto_watchlist";
const EVENT = "adexto:watchlist";
const MAX_ENTRIES = 200;
const VALID = /^\d{1,12}:[A-Z0-9]{1,16}$/;

let memory: string[] | null = null;

export const watchKey = (chainId: number, symbol: string) => `${chainId}:${symbol.toUpperCase()}`;

function readKeys(): string[] {
  if (typeof window === "undefined") return [];
  if (consentAllowsPreferences()) {
    try {
      const raw = window.localStorage.getItem(WATCHLIST_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter((k): k is string => typeof k === "string" && VALID.test(k)).slice(0, MAX_ENTRIES);
        }
      }
    } catch {
      // isi rusak: diperlakukan kosong, ditimpa pada penulisan berikutnya
    }
  }
  return memory ?? [];
}

function writeKeys(keys: string[]): void {
  const clean = [...new Set(keys.filter((k) => VALID.test(k)))].slice(0, MAX_ENTRIES);
  memory = clean;
  if (consentAllowsPreferences()) {
    try {
      window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(clean));
    } catch {
      // mode privat bisa menolak; daftar di memori tetap berlaku untuk kunjungan ini
    }
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function useWatchlist() {
  const [keys, setKeys] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => setKeys(readKeys());
    const onStorage = (e: StorageEvent) => {
      if (e.key === WATCHLIST_KEY) sync();
    };
    sync();
    setReady(true);
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const toggle = useCallback((key: string) => {
    const current = readKeys();
    writeKeys(current.includes(key) ? current.filter((k) => k !== key) : [...current, key]);
  }, []);

  return {
    keys,
    /** False sampai dibaca dari peramban; sebelum itu jangan menggambar keadaan bintang. */
    ready,
    has: (key: string) => keys.includes(key),
    toggle,
  };
}
