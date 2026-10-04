"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chainFromId } from "@/lib/chains";
import {
  formatUnitsShort,
  loadRecentTransfers,
  requestHistory,
  requestStatus,
  saveRecentTransfers,
  type RecentTransfer,
  type TransferRecord,
  type TransferStatus,
} from "@/lib/cross-chain-client";

type State = TransferStatus["status"];

/** DONE and FAILED are final in LI.FI's model; everything else can still change. */
const isSettled = (s: State) => s === "DONE" || s === "FAILED";
const isOpen = (s: State) => s === "PENDING" || s === "NOT_FOUND";

/** How often the poller wakes up. Each transfer has its own pace, see `pollEvery`. */
const TICK_MS = 5_000;
/** After this a transfer is no longer polled on its own; the history refresh still updates it. */
const WATCH_MS = 2 * 3600_000;
/** Status requests per tick at most. The status route allows 150 per 5 min per IP. */
const MAX_POLLS = 3;
/** The wallet's history: on connect, then once a minute while the page is visible. */
const HISTORY_MS = 60_000;
const MAX_SHOWN = 10;

/** LI.FI's polling guidance: every 10 s in the first minute, then every 30 s, then every minute. */
function pollEvery(ageMs: number): number {
  if (ageMs < 60_000) return 10_000;
  if (ageMs < 10 * 60_000) return 30_000;
  return 60_000;
}

export interface RecentTransfersState {
  /** Newest first: what this browser sent from the wallet, merged with LI.FI's record of the wallet. */
  list: RecentTransfer[];
  /** The history could not be read, so the list holds only what this browser sent. */
  historyError: string | null;
  /** Read out by a polite live region when a transfer this browser is watching settles. */
  announcement: string;
  /** Record a transfer this browser just sent. */
  add: (entry: RecentTransfer) => void;
}

export const chainName = (id: number) => chainFromId(id)?.name ?? `chain ${id}`;

/** "3.41 0G on 0G" */
export function describeAmount(a: { amount: string; decimals: number; symbol: string }, chainId: number): string {
  return `${formatUnitsShort(a.amount, a.decimals)} ${a.symbol} on ${chainName(chainId)}`;
}

/** Short status words, shared by the list and the live region. */
export function statusLabel(t: Pick<RecentTransfer, "status" | "substatus">): string {
  if (t.substatus === "REFUNDED") return "Refunded";
  if (t.status === "DONE" && t.substatus === "PARTIAL") return "Delivered as a different token";
  if (t.status === "PENDING" && t.substatus === "REFUND_IN_PROGRESS") return "Refund in progress";
  switch (t.status) {
    case "DONE":
      return "Delivered";
    case "FAILED":
      return "Failed";
    case "PENDING":
      return "In transit";
    case "NOT_FOUND":
      return "Waiting for the bridge to see it";
    default:
      return "Not a bridge transfer";
  }
}

function fromRecord(r: TransferRecord, owner: string): RecentTransfer {
  return {
    txHash: r.txHash,
    from: owner,
    fromChainId: r.fromChainId,
    toChainId: r.toChainId,
    sent: describeAmount(r.sent, r.fromChainId),
    expected: "",
    ...(r.received ? { received: describeAmount(r.received, r.toChainId) } : {}),
    toolKey: r.toolKey,
    toolName: r.toolName,
    sentAt: r.sentAt,
    status: r.status,
    ...(r.substatus ? { substatus: r.substatus } : {}),
    receivingTxHash: r.receivingTxHash,
    explorerUrl: r.explorerUrl,
  };
}

/**
 * `t` updated with a newer answer, or null when that answer would reopen a settled transfer: the
 * server caches the history for 15 s, so it can trail a status poll that already saw the delivery.
 */
function advance(t: RecentTransfer, news: Partial<RecentTransfer> & { status: State }): RecentTransfer | null {
  if (isSettled(t.status) && !isSettled(news.status)) return null;
  const next: RecentTransfer = {
    ...t,
    status: news.status,
    receivingTxHash: news.receivingTxHash ?? t.receivingTxHash,
    explorerUrl: news.explorerUrl ?? t.explorerUrl,
  };
  if (news.substatus) next.substatus = news.substatus;
  else delete next.substatus;
  if (news.received) next.received = news.received;
  // An entry saved before `from` existed is adopted once the wallet's own history lists it.
  if (!next.from && news.from) next.from = news.from;
  return next;
}

function merge(local: RecentTransfer[], server: RecentTransfer[], owner: string): RecentTransfer[] {
  const byHash = new Map<string, RecentTransfer>();
  for (const t of local) if (t.from === owner) byHash.set(t.txHash.toLowerCase(), t);
  for (const s of server) {
    const key = s.txHash.toLowerCase();
    const mine = byHash.get(key);
    if (!mine) {
      byHash.set(key, s);
      continue;
    }
    // The server's amount and time are what the chain recorded; this browser keeps the quote's text.
    byHash.set(key, { ...(advance(mine, s) ?? mine), sent: s.sent || mine.sent, sentAt: s.sentAt || mine.sentAt });
  }
  return [...byHash.values()].sort((a, b) => b.sentAt - a.sentAt).slice(0, MAX_SHOWN);
}

/**
 * Recent cross-chain transfers of the connected wallet, on any device.
 *
 * Two sources: what this browser sent (localStorage, available the moment the transaction
 * confirms) and the wallet's history as LI.FI recorded it for ADEXTO (`/api/swap/history`, which
 * also knows transfers sent from a phone, another browser or a script). Transfers this browser
 * sent are polled one by one until they settle; `onSettled` runs when one does, so the balances
 * can be read again.
 */
export function useRecentTransfers(address: string | null, onSettled: () => void): RecentTransfersState {
  const owner = address ? address.toLowerCase() : null;
  const [local, setLocal] = useState<RecentTransfer[]>([]);
  const [server, setServer] = useState<{ owner: string; list: RecentTransfer[] } | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const localRef = useRef(local);
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;

  const keep = useCallback((list: RecentTransfer[]) => {
    const kept = saveRecentTransfers(list);
    localRef.current = kept;
    setLocal(kept);
  }, []);

  useEffect(() => {
    const loaded = loadRecentTransfers();
    localRef.current = loaded;
    setLocal(loaded);
  }, []);

  /** Apply newer answers to this browser's copies, save them, and report the ones that settled. */
  const patchLocal = useCallback(
    (news: Map<string, Partial<RecentTransfer> & { status: State }>) => {
      if (!news.size) return;
      const settled: RecentTransfer[] = [];
      let changed = false;
      const next = localRef.current.map((t) => {
        const n = news.get(t.txHash.toLowerCase());
        const moved = n ? advance(t, n) : null;
        if (!moved || JSON.stringify(moved) === JSON.stringify(t)) return t;
        changed = true;
        if (isSettled(moved.status) && !isSettled(t.status)) settled.push(moved);
        return moved;
      });
      if (!changed) return;
      keep(next);
      if (settled.length) {
        const s = settled[0];
        setAnnouncement(`Transfer to ${chainName(s.toChainId)}: ${statusLabel(s)}.`);
        settledRef.current();
      }
    },
    [keep],
  );

  const add = useCallback(
    (entry: RecentTransfer) => {
      const key = entry.txHash.toLowerCase();
      keep([entry, ...localRef.current.filter((t) => t.txHash.toLowerCase() !== key)]);
    },
    [keep],
  );

  // The wallet's history, from any device.
  const loadHistory = useCallback(async () => {
    const who = ownerRef.current;
    if (!who) return;
    try {
      const records = await requestHistory(who);
      if (ownerRef.current !== who) return;
      const list = records.map((r) => fromRecord(r, who));
      setServer({ owner: who, list });
      setHistoryError(null);
      patchLocal(new Map(list.map((s) => [s.txHash.toLowerCase(), s])));
    } catch (e: any) {
      if (ownerRef.current === who) setHistoryError(String(e?.message ?? e).slice(0, 160));
    }
  }, [patchLocal]);

  useEffect(() => {
    setHistoryError(null);
    if (!owner) return;
    void loadHistory();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void loadHistory();
    }, HISTORY_MS);
    return () => clearInterval(timer);
  }, [owner, loadHistory]);

  // Transfers this browser sent, one status request each, at LI.FI's recommended pace.
  const lastPoll = useRef(new Map<string, number>());
  useEffect(() => {
    if (!owner) return;
    let alive = true;
    let busy = false;
    const tick = async () => {
      if (busy || document.visibilityState !== "visible") return;
      const now = Date.now();
      const due = localRef.current
        .filter((t) => t.from === owner && isOpen(t.status) && now - t.sentAt < WATCH_MS)
        .filter((t) => now - (lastPoll.current.get(t.txHash) ?? 0) >= pollEvery(now - t.sentAt))
        .slice(0, MAX_POLLS);
      if (!due.length) return;
      busy = true;
      const news = new Map<string, Partial<RecentTransfer> & { status: State }>();
      try {
        for (const t of due) {
          lastPoll.current.set(t.txHash, Date.now());
          try {
            const s = await requestStatus(t);
            const got = s.receiving;
            news.set(t.txHash.toLowerCase(), {
              status: s.status,
              ...(s.substatus && /^[A-Z_]{1,40}$/.test(s.substatus) ? { substatus: s.substatus } : {}),
              receivingTxHash: got?.txHash ?? null,
              explorerUrl: s.explorerUrl,
              ...(s.status === "DONE" && got?.amount && got.symbol && got.decimals != null
                ? { received: describeAmount({ amount: got.amount, symbol: got.symbol, decimals: got.decimals }, got.chainId ?? t.toChainId) }
                : {}),
            });
          } catch {
            // Asked again at the next due time.
          }
        }
      } finally {
        busy = false;
      }
      if (alive) patchLocal(news);
    };
    void tick();
    const timer = setInterval(() => void tick(), TICK_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [owner, patchLocal]);

  const list = useMemo(() => (owner ? merge(local, server && server.owner === owner ? server.list : [], owner) : []), [local, server, owner]);

  return { list, historyError: owner ? historyError : null, announcement, add };
}
