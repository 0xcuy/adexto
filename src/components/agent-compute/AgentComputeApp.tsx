"use client";
/**
 * Bagian interaktif `/agent-compute`: "Your compute", pilihan token (kartu bertingkat + direktori),
 * dan laci stake. Menggantikan `AgentComputePanel.tsx` (7 Okt).
 *
 * ARSITEKTUR UNTUK 1.000–10.000 PASAR
 *
 *   daftar   → `/api/agent-compute/sources`, berhalaman di server (MarketDirectory)
 *   milikku  → `/api/agent/keys?address=`, hanya baris dompet ini (+ `ids=` laci yang terbuka)
 *   aksi     → satu laci untuk satu token; `?stake=<id>` membukanya langsung, jadi tautan dari panel
 *              stake halaman token (`/agent-compute?stake=hub-143-loop`) tetap jalan
 *
 * Tidak ada lagi bagian yang tumbuh bersama jumlah pasar.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@/context/WalletContext";
import ChainChip from "@/components/ui/ChainChip";
import YourCompute from "@/components/agent-compute/YourCompute";
import TieredTokens from "@/components/agent-compute/TieredTokens";
import MarketDirectory from "@/components/agent-compute/MarketDirectory";
import StakeDrawer from "@/components/agent-compute/StakeDrawer";
import StakePanel from "@/components/agent-compute/StakePanel";
import type { SourceView, WalletStatus } from "@/components/agent-compute/types";

const ID_RE = /^[a-z0-9-]{3,40}$/;

function setStakeParam(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("stake", id);
  else url.searchParams.delete("stake");
  window.history.replaceState(window.history.state, "", url.toString());
}

export default function AgentComputeApp({ tiered, configured }: { tiered: SourceView[]; configured: boolean }) {
  const { address, isConnected, connectWallet, isConnecting } = useWallet();
  const [status, setStatus] = useState<WalletStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<SourceView | null>(null);
  /** Id laci yang terbuka, untuk pembacaan status yang dipicu dari mana pun (tanpa closure basi). */
  const openId = useRef<string | null>(null);
  /** Tombol yang membuka laci; fokus kembali ke sana saat laci ditutup. */
  const opener = useRef<HTMLElement | null>(null);
  /**
   * Nomor permintaan status. Hanya jawaban permintaan TERBARU yang dipasang: dompet yang tersambung
   * sesudah laci terbuka memicu dua bacaan (tanpa dan dengan `ids=`), dan kalau yang tanpa `ids=`
   * datang belakangan, baris laci hilang dan "Your stake" macet di "…" (tertangkap tangkapan layar 7 Okt).
   */
  const seq = useRef(0);
  /** `${address}:${id}` yang barisnya sudah diminta untuk laci, supaya permintaannya tidak berulang. */
  const askedFor = useRef<string | null>(null);

  const readStatus = useCallback(async () => {
    const my = ++seq.current;
    if (!address) {
      setStatus(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ids = openId.current ? `&ids=${encodeURIComponent(openId.current)}` : "";
      const res = await fetch(`/api/agent/keys?address=${address}${ids}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 429 ? "too many requests, wait a moment and refresh" : `status ${res.status}`);
      const json = (await res.json()) as WalletStatus;
      if (my === seq.current) setStatus(json);
    } catch (e) {
      if (my === seq.current) setError(`Your stakes could not be read: ${String((e as Error).message || e).slice(0, 90)}.`);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void readStatus();
  }, [readStatus]);

  const openSource = useCallback((s: SourceView, el: HTMLElement | null) => {
    opener.current = el;
    openId.current = s.id;
    setOpen(s);
    setStakeParam(s.id);
  }, []);

  // Baris token yang dibuka belum ada kalau dompet ini tidak stake di sana: minta sekali, khusus laci.
  useEffect(() => {
    if (!open || !address) return;
    const k = `${address.toLowerCase()}:${open.id}`;
    if (askedFor.current === k) return;
    askedFor.current = k;
    if (!status?.stakes.some((r) => r.id === open.id)) void readStatus();
  }, [open, address, status, readStatus]);

  const close = useCallback(() => {
    setOpen(null);
    openId.current = null;
    askedFor.current = null;
    setStakeParam(null);
    const el = opener.current;
    opener.current = null;
    if (el && document.contains(el)) setTimeout(() => el.focus(), 0);
  }, []);

  // Tautan masuk `?stake=<id>`: buka lacinya, dari kartu bertingkat atau dari katalog.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("stake");
    if (!id || !ID_RE.test(id)) return;
    const local = tiered.find((s) => s.id === id);
    if (local) {
      openSource(local, null);
      return;
    }
    let alive = true;
    fetch(`/api/agent-compute/sources?ids=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { items?: SourceView[] } | null) => {
        const s = j?.items?.[0];
        if (alive && s) openSource(s, null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // Sekali saat halaman dibuka: `tiered` datang dari server dan tidak berubah, `openSource` stabil.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rowFor = (id: string) => status?.stakes.find((r) => r.id === id) ?? null;
  // "Your compute" hanya untuk yang benar-benar dipegang: baris `ids=` milik laci bisa saja stake nol.
  const mine: WalletStatus | null = status ? { ...status, stakes: status.stakes.filter((r) => (r.staked ?? 0) > 0 || r.key) } : null;
  const drawerSource = open ? (rowFor(open.id)?.source ?? open) : null;

  return (
    <>
      <YourCompute
        isConnected={isConnected}
        isConnecting={isConnecting}
        connect={() => void connectWallet()}
        status={mine}
        loading={loading}
        error={error}
        refresh={() => void readStatus()}
        onOpen={openSource}
      />

      {/* `id="stake"`: jangkar lama (`/agent-compute#stake`) tetap mendarat di pilihan token. */}
      <section id="stake" aria-labelledby="choose" className="mt-14 scroll-mt-24">
        <h2 id="choose" className="scroll-mt-24 font-display text-[22px] font-semibold tracking-tight text-ink sm:text-[26px]">
          Choose a token to stake
        </h2>
        <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-ink-soft sm:text-[15px]">
          Two kinds of token open compute. $ADEXTO and $SAI have fixed tiers. Every other ADEXTO market stakes in its
          chain&apos;s hub, and its keys share the compute its own trading pays for.
        </p>

        <h3 className="mt-7 text-[16px] font-semibold text-ink">Fixed tiers</h3>
        <p className="mt-1 text-[13px] text-ink-soft">The size of your stake sets your allowance.</p>
        <TieredTokens initial={tiered} onOpen={openSource} />

        <h3 className="mt-10 text-[16px] font-semibold text-ink">Every token you can stake</h3>
        <p className="mt-1 text-[13px] text-ink-soft">Search by ticker, name or address, then open one to stake it and create its key.</p>
        <div className="mt-4">
          <MarketDirectory onOpen={openSource} />
        </div>
      </section>

      <StakeDrawer
        open={Boolean(drawerSource)}
        onClose={close}
        title={
          drawerSource ? (
            <>
              ${drawerSource.symbol} <span className="font-sans text-[15px] font-normal text-ink-faint">{drawerSource.name}</span>
            </>
          ) : null
        }
        subtitle={
          drawerSource ? (
            <span className="flex items-center gap-2">
              <ChainChip chain={drawerSource.chainId} size="sm" />
              <span className="text-[12px] text-ink-faint">{drawerSource.kind === "tiered" ? "Fixed tiers" : "Fee-funded"}</span>
            </span>
          ) : null
        }
      >
        {drawerSource && (
          <StakePanel
            src={drawerSource}
            row={rowFor(drawerSource.id)}
            configured={configured}
            refresh={readStatus}
            onShowExamples={() => {
              close();
              setTimeout(() => document.getElementById("endpoint")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
            }}
          />
        )}
      </StakeDrawer>
    </>
  );
}
