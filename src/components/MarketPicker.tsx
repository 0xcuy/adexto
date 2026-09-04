"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";

import { CHAIN_LIST } from "@/lib/chains";
import { formatSmallNumber } from "@/lib/pricing";
import { EMPTY_BODY, EMPTY_TITLE, LAUNCH_CLAUSE } from "@/lib/launch-state";

/**
 * Pemilih market untuk permukaan trading.
 *
 * KENAPA ADA, dan kenapa bukan `<select>` lagi.
 *
 * Dua kontrol di panel swap dulu berupa `<select>` bawaan: satu filter chain, satu
 * pemilih market. Keduanya bekerja, dan itu sebabnya bertahan lama. Tapi `<select>`
 * punya batas yang tidak bisa ditembus styling: daftarnya digambar oleh sistem
 * operasi, bukan oleh halaman. Akibatnya tiga hal yang justru paling dibutuhkan
 * pemilih market tidak mungkin ada di dalamnya —
 *
 *   1. logo. Baris teks "$CSENT · Base — Cognitive Sentinel" memaksa pembaca
 *      mengurai string; logo dikenali sebelum dibaca.
 *   2. dua tingkat informasi per baris. Nama di atas, simbol + alamat terpotong di
 *      bawah, harga di kanan. `<option>` hanya menerima satu baris teks datar.
 *   3. pencarian, termasuk tempel-alamat. Dengan sembilan market itu belum terasa;
 *      dengan sembilan puluh, `<select>` menjadi tidak terpakai.
 *
 * Dan satu hal yang tidak teknis tapi nyata: `<select>` memakai font sistem, jadi
 * satu-satunya kontrol di halaman yang tidak memakai tipografi situs ini justru
 * kontrol yang paling sering ditekan.
 *
 * Yang TIDAK berubah: filter chain tetap filter, bukan penentu tempat eksekusi.
 * Chain tempat transaksi dikirim selalu diambil dari market terpilih. Itu perbaikan
 * lama yang mahal — dulu dropdown chain dan daftar market saling tidak sepakat
 * sehingga harga satu token bisa melompat antara dua nilai — dan komponen ini tidak
 * boleh menghidupkannya kembali. Karena itu `onSelect` mengirim market, bukan chain.
 */
export interface PickerMarket {
  marketKey: string;
  symbol: string;
  name: string;
  chainId: number;
  chainKey: string;
  chainLabel: string;
  image: string;
  tokenAddress: string;
  poolAddress: string | null;
  priceNative: number;
  nativeSymbol: string;
  tradable: boolean;
}

interface Props {
  markets: PickerMarket[];
  selectedKey: string | null;
  onSelect: (marketKey: string) => void;
  /** `"all"` atau chainId sebagai string, mengikuti bentuk state di pemanggil. */
  chainFilter: string;
  onChainFilter: (value: string) => void;
  loading?: boolean;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Penyaringan chain dipakai DUA kali: di sini untuk menggambar daftar, dan di
 * pemanggil untuk memutuskan apakah market terpilih masih sah. Kalau kedua tempat
 * menulis syaratnya sendiri, keduanya akan berpisah pada perubahan pertama — dan
 * bentuk bug itu sudah pernah terjadi di panel ini: filter dan pemilih market tidak
 * sepakat, sehingga mengganti chain meninggalkan seluruh panel pada market chain
 * sebelumnya. Satu fungsi, dua pemakai.
 */
export function filterByChain<T extends { chainId: number }>(markets: T[], chainFilter: string): T[] {
  return chainFilter === "all" ? markets : markets.filter((m) => m.chainId === Number(chainFilter));
}

export default function MarketPicker({ markets, selectedKey, onSelect, chainFilter, onChainFilter, loading }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const selected = useMemo(() => markets.find((m) => m.marketKey === selectedKey) ?? null, [markets, selectedKey]);

  const visible = useMemo(() => {
    const byChain = filterByChain(markets, chainFilter);
    const q = query.trim().toLowerCase();
    if (!q) return byChain;
    // Alamat ikut dicari supaya menempel alamat kontrak langsung menemukan
    // marketnya — itu cara orang menemukan token yang belum mereka hafal namanya.
    return byChain.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.symbol.toLowerCase().includes(q) ||
        m.tokenAddress.toLowerCase().includes(q) ||
        (m.poolAddress ?? "").toLowerCase().includes(q)
    );
  }, [markets, chainFilter, query]);

  /**
   * Escape menutup, dan fokus dikembalikan ke tombol pemicunya.
   *
   * Tanpa pengembalian fokus, menutup dialog membuang fokus ke <body> dan pemakai
   * keyboard harus menelusuri halaman dari awal — kerugian yang tidak dialami
   * `<select>` yang digantikan komponen ini, jadi menghilangkannya akan membuat
   * penggantian ini justru menurunkan aksesibilitas.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => searchRef.current?.focus(), 20);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [open]);

  /**
   * Fokus dikembalikan HANYA kalau dialognya pernah terbuka.
   *
   * Versi pertama hanya menguji `!open`, dan `open` bernilai false saat komponen
   * pertama kali dipasang — sehingga membuka /swap langsung memindahkan fokus ke
   * tombol ini dan menggulir halaman ke arahnya. Terlihat di potret uji sebagai
   * cincin fokus ungu pada kontrol yang belum disentuh siapa pun. Penanda `wasOpen`
   * memisahkan "menutup" dari "baru dipasang", dua keadaan yang sama-sama bukan
   * terbuka tetapi menuntut perlakuan berbeda.
   */
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (wasOpen.current) triggerRef.current?.focus({ preventScroll: true });
  }, [open]);

  const choose = (key: string) => {
    onSelect(key);
    setQuery("");
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-2xl border border-line bg-white px-3 py-2.5 text-left transition-colors hover:border-line-strong"
      >
        {selected ? (
          <>
            <span className="h-8 w-8 shrink-0 overflow-hidden rounded-xl border border-line bg-cream-2">
              <img src={selected.image} alt="" className="h-full w-full object-cover" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{selected.name}</span>
              <span className="block truncate text-xs text-ink-soft">
                {selected.symbol} · {selected.chainLabel}
              </span>
            </span>
          </>
        ) : (
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">
              {loading ? "Loading markets…" : markets.length === 0 ? EMPTY_TITLE : "Select a market"}
            </span>
            <span className="block text-xs text-ink-soft">
              {markets.length === 0 ? LAUNCH_CLAUSE : `${markets.length} available`}
            </span>
          </span>
        )}
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-faint" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:items-center">
          {/* Latar gelap adalah tombol tutup, tetapi TIDAK boleh masuk urutan tab —
              pemakai keyboard sudah punya Escape, dan sebuah tombol tanpa nama di
              antara pemicu dan kolom pencarian hanya menambah perhentian buta. */}
          <div aria-hidden="true" className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            /* max-w-md, bukan max-w-sm. Diukur dari potret uji: pada 384px kelima chip
               chain membungkus ke baris kedua karena "Arbitrum" tidak bisa dipendekkan
               tanpa mengarang singkatan, dan baris alamat pada baris market ikut
               terpotong. 448px memuat keduanya utuh. */
            className="relative flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-line bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between px-5 pb-3 pt-4">
              <h2 id={titleId} className="text-base font-semibold text-ink">
                Select a market
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-ink-faint transition-colors hover:bg-cream-2 hover:text-ink"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Baris chain. Chip, bukan dropdown: empat pilihan sekaligus terlihat,
                dan yang aktif ditandai cincin alih-alih harus dibuka dulu. */}
            <div className="px-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">Network</span>
                <span className="text-[11px] text-ink-faint" data-numeric>
                  {CHAIN_LIST.length} chains
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onChainFilter("all")}
                  aria-pressed={chainFilter === "all"}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    chainFilter === "all"
                      ? "border-accent/40 bg-accent-soft text-accent"
                      : "border-line bg-cream-2 text-ink-soft hover:text-ink"
                  }`}
                >
                  All
                </button>
                {CHAIN_LIST.map((c) => {
                  const active = chainFilter === String(c.chainId);
                  return (
                    <button
                      key={c.chainId}
                      type="button"
                      onClick={() => onChainFilter(String(c.chainId))}
                      aria-pressed={active}
                      title={c.label}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                        active
                          ? "border-accent/40 bg-accent-soft text-accent"
                          : "border-line bg-cream-2 text-ink-soft hover:text-ink"
                      }`}
                    >
                      {/* Devchain tidak punya logo dan memang tidak boleh dikarang;
                          chip-nya jalan tanpa gambar. */}
                      {c.brandLogo && <img src={c.brandLogo} alt="" className="h-3.5 w-3.5 object-contain" />}
                      {c.key}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="px-5 pb-3 pt-3">
              <div className="flex items-center gap-2 rounded-xl border border-line bg-cream-2 px-3 py-2 focus-within:border-accent/40">
                <Search className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name or paste address"
                  className="w-full bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto border-t border-line">
              {visible.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <p className="text-sm font-semibold text-ink">
                    {markets.length === 0
                      ? EMPTY_TITLE
                      : query.trim()
                      ? "Nothing matches that"
                      : "No market on this chain"}
                  </p>
                  <p className="mx-auto mt-1 max-w-[15rem] text-xs text-ink-soft">
                    {markets.length === 0
                      ? EMPTY_BODY
                      : query.trim()
                      ? "Try a symbol, a project name, or paste the token address."
                      : "Markets are created per chain, so a token launched elsewhere does not appear here."}
                  </p>
                  {markets.length > 0 && chainFilter !== "all" && !query.trim() && (
                    <button
                      type="button"
                      onClick={() => onChainFilter("all")}
                      className="mt-3 rounded-lg border border-accent/30 bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent"
                    >
                      Show all chains ({markets.length})
                    </button>
                  )}
                </div>
              ) : (
                <ul>
                  {visible.map((m) => {
                    const active = m.marketKey === selectedKey;
                    const addr = m.poolAddress ?? m.tokenAddress;
                    return (
                      <li key={m.marketKey}>
                        <button
                          type="button"
                          onClick={() => choose(m.marketKey)}
                          aria-current={active ? "true" : undefined}
                          className={`flex w-full items-center gap-3 px-5 py-3 text-left transition-colors ${
                            active ? "bg-accent-soft" : "hover:bg-cream-2"
                          }`}
                        >
                          <span className="h-9 w-9 shrink-0 overflow-hidden rounded-xl border border-line bg-cream-2">
                            <img src={m.image} alt="" className="h-full w-full object-cover" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-ink">{m.name}</span>
                            <span className="block truncate text-xs text-ink-soft">
                              {m.symbol}
                              {" · "}
                              {/* Alamat hex adalah string mesin, jadi di sinilah mono
                                  memang tempatnya — bukan di label. */}
                              <span className="font-mono">{short(addr)}</span>
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-sm font-semibold text-ink" data-numeric>
                              {m.priceNative > 0 ? formatSmallNumber(m.priceNative) : "—"}
                            </span>
                            <span className={`block text-[11px] ${m.tradable ? "text-ink-faint" : "text-warn"}`}>
                              {m.tradable ? m.nativeSymbol : "no pool"}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
