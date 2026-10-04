"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CHAIN_LIST, chainMark, explorerAddressUrl, resolveChainOrDefault } from "@/lib/chains";
import { STABLE_PRICES, assetPriceUsd, formatSmallNumber, formatTokenAmount, formatUsd, type AssetPrices } from "@/lib/pricing";
import {
  Search, ExternalLink, ShieldCheck, ArrowUpRight, CheckCircle2,
  CloudLightning, Sparkles, AlertTriangle, Lock, RefreshCw, Star,
} from "lucide-react";
import { EMPTY_BODY, EMPTY_TITLE } from "@/lib/launch-state";
import WatchStar from "@/components/WatchStar";
import { useWatchlist } from "@/lib/watchlist";
import ChainChip from "./ChainChip";

/**
 * Live market index.
 *
 * Fixes: prices are numeric with an explicit native unit and converted through the
 * live feed instead of being string-stripped and shown as USD; the Swap button
 * carries the market (`/swap?token=SYMBOL`) instead of dropping the user on the
 * default market; explorer links are built from each project's chainId; and every
 * card states plainly whether the contract is verified and whether a tradable pool
 * exists.
 */

interface Project {
  id: string;
  /** `chainId:SYMBOL` — a ticker can have an independent market on several chains. */
  marketKey: string;
  deployedChainCount: number;
  alsoOn: Array<{ chainId: number; chainKey: string }>;
  name: string;
  symbol: string;
  slug: string;
  chain: string;
  chainId: number;
  chainKey: string;
  nativeSymbol: string;
  tokenAddress: string;
  poolAddress: string | null;
  priceNative: number;
  supply: number;
  lpFeeBps: number;
  treasuryBuybackBps: number;
  agentStatus: string;
  agentModel: string;
  edgeProvider: string;
  category: string;
  image: string;
  /**
   * Root penyimpanan 0G DA dari metadata launch: sebuah hash konten, BUKAN
   * laporan attestation hardware. Nama lamanya `teeAttestationRoot` itulah yang
   * membuat situs ini pernah mengklaim attestation yang tidak pernah diperiksa
   * siapa pun; kontraknya sudah dinamai ulang `metadataRoot`.
   */
  metadataRoot: string | null;
  verified: boolean;
  curated: boolean;
  poolLive: boolean;
  tradable: boolean;
  /** Detik epoch. Payload mengirimnya sebagai string, jadi dinormalkan saat dibaca. */
  deployedAt: number;
}

/**
 * Chip filter. Ukuran dalam px, bukan rem (rem situs ini 14 px): 36 px di ponsel supaya jempol tidak meleset di
 * rel yang rapat, 30 px di desktop.
 */
const CHIP =
  "inline-flex h-[36px] shrink-0 snap-start items-center whitespace-nowrap rounded-full border px-3.5 text-[12px] font-medium transition-colors lg:h-[30px] lg:px-3";
const CHIP_ON = "border-accent/40 bg-accent-soft text-accent";
const CHIP_OFF = "border-line bg-cream-2 text-ink-soft hover:text-ink";

/** Jumlah baris kerangka saat memuat: setinggi baris asli, supaya daftar tidak melompat begitu data datang. */
const SKELETON_ROWS = 6;

/**
 * Satu grid untuk baris asli dan kerangkanya.
 * - Ponsel: [pasar (logo, nama, chain)] [harga + mcap] [bintang 40 px].
 * - Desktop: tabel Market · Chain · Price · Market cap · Supply · aksi.
 * Sel desktop memakai `hidden lg:*`, jadi di ponsel tidak mengambil kolom.
 */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto_40px] items-center gap-x-[10px] px-4 py-3 lg:grid-cols-[minmax(0,2.4fr)_1fr_1.1fr_1.1fr_0.9fr_auto] lg:gap-3";
/**
 * Kartu daftar. Di bawah 640 px ia selebar layar (tanpa tepi samping dan sudut): 28 px yang dulu habis untuk dua
 * lapis padding kembali ke nama pasar. `!` karena `.glass-panel` di globals.css ditulis sesudah utilities.
 */
const LIST_CARD = "glass-panel overflow-hidden rounded-card max-sm:-mx-4 max-sm:!rounded-none max-sm:!border-x-0";
const TABLE_HEAD =
  "grid-cols-[minmax(0,2.4fr)_1fr_1.1fr_1.1fr_0.9fr_auto] gap-3 border-b border-line px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint";

export default function ExplorerPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [prices, setPrices] = useState<AssetPrices>(STABLE_PRICES);
  const [loading, setLoading] = useState(true);
  /**
   * Bacaan kurs pertama sudah selesai (berhasil atau tidak). Daftar diurutkan menurut market cap USD, jadi tanpa
   * penanda ini baris-baris pertama digambar dengan kurs bawaan lalu berpindah tempat begitu kurs datang: itu
   * pergeseran tata letak yang terukur (CLS 0,29–0,35 di desktop, baseline 4 Okt).
   */
  const [pricesReady, setPricesReady] = useState(false);
  const [category, setCategory] = useState("all");
  const [chainFilter, setChainFilter] = useState("all");
  /** Urutan daftar. Lihat catatan di atas `sorted`. */
  const [sort, setSort] = useState<"largest" | "newest">("largest");
  const [search, setSearch] = useState("");
  /** Hanya pasar berbintang. Watchlist disimpan di peramban ini saja (`src/lib/watchlist.ts`). */
  const [watchOnly, setWatchOnly] = useState(false);
  const watchlist = useWatchlist();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/graphql", { method: "POST" });
        const json = await res.json();
        if (cancelled) return;
        setProjects(
          (json?.data?.projects ?? []).map((p: any) => ({
            id: p.id,
            marketKey: String(p.marketKey ?? `${p.chainId}:${String(p.symbol).toUpperCase()}`),
            deployedChainCount: Number(p.deployedChainCount) || 1,
            alsoOn: Array.isArray(p.alsoOn)
              ? p.alsoOn.map((s: any) => ({ chainId: Number(s.chainId), chainKey: String(s.chainKey) }))
              : [],
            name: p.name,
            symbol: String(p.symbol).toUpperCase(),
            slug: String(p.slug ?? p.symbol).toLowerCase(),
            chain: p.chain,
            chainId: Number(p.chainId),
            chainKey: String(p.chainKey ?? ""),
            nativeSymbol: p.nativeSymbol,
            tokenAddress: p.tokenAddress,
            poolAddress: p.poolAddress ?? null,
            priceNative: Number(p.priceNative) || 0,
            supply: Number(p.supply) || 0,
            lpFeeBps: Number(p.lpFeeBps) || 20,
            treasuryBuybackBps: Number(p.treasuryBuybackBps) || 10,
            agentStatus: p.agentStatus,
            agentModel: p.agentModel,
            edgeProvider: p.edgeProvider,
            category: p.category ?? "defi",
            image: p.image ?? "/logo.svg",
            // `metadataRoot` lebih dulu; /api/graphql masih mengembalikan alias
            // lamanya untuk klien yang belum diperbarui.
            metadataRoot: p.metadataRoot ?? p.teeAttestationRoot ?? null,
            verified: Boolean(p.verified),
            curated: Boolean(p.curated),
            poolLive: Boolean(p.poolLive),
            tradable: Boolean(p.tradable),
            // Dikirim sebagai string oleh payload; dinormalkan di sini supaya pengurutan
            // membandingkan angka, bukan teks.
            deployedAt: Number(p.deployedAt) || 0,
          }))
        );
      } catch (error) {
        console.warn("[adexto] explorer fetch failed:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const timer = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/prices");
        const data = await res.json();
        if (!cancelled && data?.prices) setPrices({ ...STABLE_PRICES, ...data.prices });
      } catch {
        // fallback table already set
      } finally {
        if (!cancelled) setPricesReady(true);
      }
    }
    load();
    const timer = setInterval(load, 30000);
    // Kurs yang lambat tidak boleh menahan daftar: sesudah 3 detik daftar tampil dengan kurs bawaan.
    const fallback = setTimeout(() => {
      if (!cancelled) setPricesReady(true);
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      clearTimeout(fallback);
    };
  }, []);

  const filtered = useMemo(
    () =>
      projects.filter((p) => {
        const matchesCategory = category === "all" || p.category.toLowerCase() === category;
        const matchesChain = chainFilter === "all" || p.chainId === Number(chainFilter);
        const needle = search.trim().toLowerCase();
        const matchesSearch =
          !needle ||
          p.name.toLowerCase().includes(needle) ||
          p.symbol.toLowerCase().includes(needle) ||
          p.tokenAddress.toLowerCase().includes(needle);
        const matchesWatch = !watchOnly || watchlist.keys.includes(p.marketKey);
        return matchesCategory && matchesChain && matchesSearch && matchesWatch;
      }),
    [projects, category, chainFilter, search, watchOnly, watchlist.keys]
  );

  /**
   * Tab kategori DITURUNKAN dari pasar yang benar-benar ada, tidak dipaku.
   *
   * Daftarnya dulu literal `["all", "defi", "trading", "security"]`, dan itu bukan cuma
   * kaku — ia bisa MENYEMBUNYIKAN pasar. `/api/deploy` menerima `category` apa pun dan
   * hanya jatuh ke `"defi"` bila kosong, jadi sebuah pasar berkategori `meme` tidak akan
   * cocok dengan satu tab pun dan hanya muncul di "all". Pemiliknya tidak punya cara
   * mengetahui kenapa, sebab tidak ada galat di mana pun — pasarnya cuma tidak ada di
   * tempat orang mencarinya.
   *
   * Sebaliknya, dua dari tiga tab lama juga tidak dipakai pasar mana pun, jadi pembaca
   * mengklik `security` lalu menemukan daftar kosong dan menyimpulkan indexnya rusak.
   *
   * Diturunkan dari data, keduanya selesai sekaligus: tab yang ada persis tab yang punya
   * isi, dan kategori baru muncul sendiri tanpa berkas ini disentuh.
   */
  const categories = useMemo(() => {
    const seen = new Map<string, number>();
    for (const p of projects) {
      const key = (p.category || "").toLowerCase().trim();
      if (key) seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    // Terbanyak lebih dulu, lalu alfabetis, supaya urutannya stabil antar-render.
    const sorted = [...seen.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k]) => k);
    return ["all", ...sorted];
  }, [projects]);

  const tradableCount = projects.filter((p) => p.tradable).length;

  /**
   * Urutan daftar. Dua pilihan saja, dan keduanya bisa dihitung dari data yang ada:
   * kapitalisasi (butuh kurs) dan umur (butuh `deployedAt`). Tidak ada "trending" atau
   * "top movers" — keduanya butuh riwayat volume per pasar yang tidak kami simpan, jadi
   * tombolnya akan mengurutkan angka yang dikarang.
   */
  const sorted = useMemo(() => {
    const withUsd = filtered.map((p) => {
      const chain = resolveChainOrDefault(p.chainId);
      const priceUsd = p.priceNative * assetPriceUsd(chain.nativeSymbol, prices);
      return { ...p, priceUsd, mcapUsd: priceUsd * p.supply };
    });
    withUsd.sort((a, b) => (sort === "newest" ? b.deployedAt - a.deployedAt : b.mcapUsd - a.mcapUsd));
    return withUsd;
  }, [filtered, prices, sort]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* ── kepala halaman ─────────────────────────────────────────────────── */}
      <div className="mb-6">
        <p className="kicker mb-2">Market index</p>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="font-display text-3xl font-light tracking-tight text-ink sm:text-4xl">Markets</h1>
            <p className="mt-2 text-[14px] text-ink-soft">
              {loading
                ? "Reading the registry…"
                : `${projects.length} listed · ${tradableCount} with an executable bonding curve`}
            </p>
          </div>
          <div className="flex w-full items-center gap-2 md:w-auto">
            <div className="relative flex-1 md:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <input
                type="text"
                placeholder="Search ticker, name or address"
                aria-label="Search markets"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-11 w-full rounded-2xl border border-line bg-surface pl-9 pr-4 text-[14px] text-ink placeholder:text-ink-faint focus:border-accent/40 focus:outline-none"
              />
            </div>
            <Link
              href="/studio"
              className="btn-glow flex h-11 shrink-0 items-center gap-1.5 rounded-2xl bg-accent px-5 text-[14px] font-semibold text-white hover:bg-accent-strong"
            >
              <Sparkles className="h-4 w-4" /> Launch
            </Link>
          </div>
        </div>
      </div>

      {/* ── filter ──────────────────────────────────────────────────────────────
          SATU rel chip yang bisa digeser, bukan tiga kelompok yang membungkus. Di ponsel kelompok kategori,
          Watchlist, chain dan urutan dulu membungkus jadi 3–4 baris dan mendorong daftar keluar layar pertama.
          Kelompok ARIA-nya tetap bernama (pembaca layar menyebut filter apa), urutan tetap terlihat di luar rel,
          dan tepi kanan rel memudar di ponsel supaya terlihat bisa digeser. */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div
          className="-mx-4 flex min-w-0 snap-x items-center gap-1.5 overflow-x-auto px-4 py-0.5 [scrollbar-width:none] sm:mx-0 sm:flex-1 sm:px-0 max-lg:[mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)] [&::-webkit-scrollbar]:hidden"
          data-filter-rail
        >
          {/* Kelompok yang BERNAMA, alasan yang sama seperti di MarketPicker: deretan chip
              tanpa induk diumumkan pembaca layar sebagai tombol lepas tanpa pernah menyebut
              itu filter apa. */}
          <div role="group" aria-label="Filter markets by category" className="flex shrink-0 items-center gap-1.5">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                aria-pressed={category === cat}
                className={`${CHIP} ${category === cat ? CHIP_ON : CHIP_OFF}`}
              >
                {cat === "all" ? "All" : cat}
              </button>
            ))}
          </div>
          <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-line" />
          <button
            type="button"
            onClick={() => setWatchOnly((v) => !v)}
            aria-pressed={watchOnly}
            title="Show only the markets you starred in this browser"
            data-watch-filter
            className={`${CHIP} gap-1.5 ${
              watchOnly ? "border-warn/40 bg-warn/10 text-warn" : CHIP_OFF
            }`}
          >
            <Star className="h-3.5 w-3.5" fill={watchOnly ? "currentColor" : "none"} />
            Watchlist{watchlist.ready ? ` (${watchlist.keys.length})` : ""}
          </button>
          <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-line" />
          <div role="group" aria-label="Filter markets by chain" className="flex shrink-0 items-center gap-1.5 pr-6 lg:pr-0">
            <button
              type="button"
              onClick={() => setChainFilter("all")}
              aria-pressed={chainFilter === "all"}
              className={`${CHIP} ${chainFilter === "all" ? CHIP_ON : CHIP_OFF}`}
            >
              All chains
            </button>
            {CHAIN_LIST.map((c) => (
              <button
                key={c.chainId}
                type="button"
                onClick={() => setChainFilter(String(c.chainId))}
                aria-pressed={chainFilter === String(c.chainId)}
                className={`${CHIP} gap-1.5 ${chainFilter === String(c.chainId) ? CHIP_ON : CHIP_OFF}`}
              >
                {/* Logo + `chain.key` seperti ChainChip, ditulis langsung karena warna chip aktif harus ikut
                    tombolnya (ChainChip memaku warnanya sendiri). */}
                {chainMark(c) ? (
                  // eslint-disable-next-line @next/next/no-img-element -- logo chain statis kecil dari /public
                  <img src={chainMark(c) as string} alt="" aria-hidden="true" className="h-[14px] w-[14px] shrink-0 rounded-sm object-contain" />
                ) : null}
                {c.key}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 sm:shrink-0">
          {/* Jumlah hasil hanya di ponsel: di sana rel menyembunyikan filter yang sedang aktif di luar layar. */}
          <p className="text-[12px] text-ink-faint sm:hidden" aria-live="polite">
            {loading
              ? ""
              : sorted.length === projects.length
              ? `${projects.length} markets`
              : `${sorted.length} of ${projects.length} markets`}
          </p>
          <div role="group" aria-label="Sort markets" className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-cream-2 p-1">
            {(
              [
                ["largest", "Largest"],
                ["newest", "Newest"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSort(value)}
                aria-pressed={sort === value}
                className={`inline-flex h-[32px] items-center rounded-full px-3 text-[12px] font-medium transition-colors lg:h-[26px] ${
                  sort === value ? "bg-cream-3 text-ink" : "text-ink-soft hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── daftar ──────────────────────────────────────────────────────────── */}
      {loading || (projects.length > 0 && !pricesReady) ? (
        /* Kerangka setinggi baris asli, bukan spinner 160 px: daftar yang datang menggantikan kerangka di
           tempat yang sama, jadi isi di bawahnya tidak melompat (CLS baseline 0,29–0,35 di desktop). */
        <div className={LIST_CARD} aria-busy="true" aria-label="Loading markets">
          <div className={`${TABLE_HEAD} hidden lg:grid`} aria-hidden="true">
            <span>Market</span>
            <span>Chain</span>
            <span className="text-right">Price</span>
            <span className="text-right">Market cap</span>
            <span className="text-right">Supply</span>
            <span className="w-[132px]" />
          </div>
          <ul aria-hidden="true">
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <li key={i} className="border-b border-line/60 last:border-0">
                <div className={ROW_GRID}>
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="skeleton h-[40px] w-[40px] shrink-0 !rounded-xl" />
                    <span className="flex min-w-0 flex-1 flex-col gap-2">
                      <span className="skeleton h-[12px] w-[70%] max-w-[180px]" />
                      <span className="skeleton h-[10px] w-[45%] max-w-[120px]" />
                    </span>
                  </span>
                  <span className="hidden lg:block"><span className="skeleton block h-[12px] w-[72px]" /></span>
                  <span className="hidden flex-col items-end gap-2 lg:flex">
                    <span className="skeleton h-[12px] w-[64px]" />
                    <span className="skeleton h-[9px] w-[48px]" />
                  </span>
                  <span className="hidden justify-end lg:flex"><span className="skeleton h-[12px] w-[56px]" /></span>
                  <span className="hidden justify-end lg:flex"><span className="skeleton h-[12px] w-[48px]" /></span>
                  <span className="flex flex-col items-end gap-2 lg:hidden">
                    <span className="skeleton h-[12px] w-[60px]" />
                    <span className="skeleton h-[9px] w-[44px]" />
                  </span>
                  <span className="flex justify-end lg:w-[132px]">
                    <span className="skeleton h-[40px] w-[40px] !rounded-xl lg:h-[30px] lg:w-[30px]" />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : projects.length === 0 ? (
        /* Registry kosong dan filter terlalu sempit adalah dua keadaan berbeda, dan dulu
           mencetak kalimat yang sama — sehingga pengunjung baru menyimpulkan filternya
           yang salah padahal belum ada peluncuran sama sekali. */
        <div className="mx-auto max-w-md py-20 text-center">
          <Lock className="mx-auto mb-3 h-5 w-5 text-ink-faint" />
          <p className="text-sm font-semibold text-ink">{EMPTY_TITLE}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{EMPTY_BODY}</p>
          <Link
            href="/docs"
            className="mt-4 inline-block text-xs font-semibold text-accent underline-offset-4 hover:underline"
          >
            See which contracts are deployed
          </Link>
        </div>
      ) : sorted.length === 0 ? (
        <div className="py-20 text-center text-sm text-ink-soft">
          {watchOnly && watchlist.keys.length === 0
            ? "Your watchlist is empty. Star a market to keep it here."
            : "No markets match this filter."}
        </div>
      ) : (
        <div className={LIST_CARD}>
          {/* Kepala kolom hanya di desktop; di ponsel tiap baris jadi kartu ringkas.
              Bentuk TABEL dipilih menggantikan kartu besar dua kolom: halaman ini dipakai
              untuk MEMBANDINGKAN pasar, dan kartu lama menyusun angka yang sama di tempat
              yang berbeda-beda sehingga tidak ada satu kolom pun yang bisa dibandingkan
              antar-baris. Detail teknis per pasar (model compute, edge, root DA) pindah ke
              halaman pasarnya — di indeks ia hanya menambah baris yang tidak dipakai untuk
              memilih. */}
          <div className={`${TABLE_HEAD} hidden lg:grid`}>
            <span>Market</span>
            <span>Chain</span>
            <span className="text-right">Price</span>
            <span className="text-right">Market cap</span>
            <span className="text-right">Supply</span>
            <span className="w-[132px]" />
          </div>

          <ul aria-label="Markets">
            {sorted.map((p) => {
              const chain = resolveChainOrDefault(p.chainId);
              return (
                /* `relative` + tautan baris yang direntangkan (`after:inset-0`): seluruh baris adalah satu target
                   ke terminal pasar, tanpa <a> bersarang. Bintang dan tombol desktop duduk di atasnya (`z-10`),
                   jadi menekan bintang tidak membuka pasar. */
                <li key={p.marketKey} className="relative border-b border-line/60 transition-colors last:border-0 hover:bg-cream-3/40">
                  <div className={ROW_GRID}>
                    <Link
                      href={`/token/${p.slug}?chain=${p.chainId}`}
                      className="flex min-w-0 items-center gap-3 outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-accent/50"
                    >
                      <img
                        src={p.image}
                        alt=""
                        aria-hidden="true"
                        className="h-[40px] w-[40px] shrink-0 rounded-xl border border-line object-cover"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-baseline gap-1.5">
                          <span className="min-w-0 truncate text-[14px] font-semibold text-ink">{p.name}</span>
                          {/* `$SYMBOL` dipertahankan apa adanya: beberapa harness mencarinya
                              sebagai teks untuk membuktikan pasar barunya terdaftar. */}
                          <span className="shrink-0 text-[12px] text-ink-faint">${p.symbol}</span>
                        </span>
                        <span className="mt-1 flex min-w-0 items-center gap-x-2 whitespace-nowrap text-[11px] leading-none text-ink-faint">
                          {/* Ponsel: chain pendek di bawah nama. Desktop punya kolom Chain sendiri. */}
                          <ChainChip chain={p.chainId} size="sm" variant="plain" className="lg:hidden" />
                          {p.deployedChainCount > 1 && (
                            <span
                              className="hidden text-accent lg:inline"
                              /* Inggris, bukan Indonesia: `title` ini terbaca pengguna, dan
                                 seluruh permukaan publik repo ini berbahasa Inggris. */
                              title={`This ticker also has a market on ${p.alsoOn.map((s) => s.chainKey).join(", ")}`}
                            >
                              +{p.deployedChainCount - 1} chain
                            </span>
                          )}
                          {/* Di ponsel hanya ikonnya (kata "verified" tetap dibaca pembaca layar); di desktop
                              ikon + kata. "showcase" selalu ditulis: itu peringatan, bukan hiasan. */}
                          {p.verified ? (
                            <span className="inline-flex items-center gap-1 text-ok" title="Contract source verified">
                              <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
                              <span className="sr-only lg:not-sr-only">verified</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-warn">
                              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" /> showcase
                            </span>
                          )}
                          {/* Kata "live" DIPERTAHANKAN: harness memakainya untuk membuktikan
                              pasar yang baru diluncurkan punya kurva yang bisa dieksekusi. Di bawah 380 px
                              tinggal titiknya; katanya tetap ada untuk pembaca layar dan skrip. */}
                          {p.tradable ? (
                            <span className="inline-flex items-center gap-1 text-ok">
                              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" />
                              <span className="max-[379px]:sr-only">curve live</span>
                            </span>
                          ) : (
                            <span className="text-ink-faint">no curve</span>
                          )}
                        </span>
                      </span>
                    </Link>

                    <span className="hidden lg:block">
                      <ChainChip chain={p.chainId} size="md" variant="plain" />
                    </span>

                    <span className="hidden text-right lg:block" data-numeric>
                      <span className="block text-[13px] font-medium text-ink">
                        {p.priceUsd > 0 ? formatUsd(p.priceUsd) : "—"}
                      </span>
                      <span className="block text-[10px] text-ink-faint">
                        {p.priceNative > 0 ? `${formatSmallNumber(p.priceNative)} ${chain.nativeSymbol}` : "no price"}
                      </span>
                    </span>

                    <span className="hidden text-right text-[13px] text-ink lg:block" data-numeric>
                      {p.mcapUsd > 0 ? formatUsd(p.mcapUsd, { compact: true }) : "—"}
                    </span>

                    <span className="hidden text-right text-[13px] text-ink-soft lg:block" data-numeric>
                      {formatTokenAmount(p.supply)}
                    </span>

                    {/* Ponsel: harga dan mcap di kanan, rata kanan, angka tabular. */}
                    <span className="text-right tabular-nums lg:hidden" data-numeric>
                      <span className="block whitespace-nowrap text-[13px] font-semibold text-ink">
                        {p.priceUsd > 0 ? formatUsd(p.priceUsd) : "—"}
                      </span>
                      <span className="mt-1 block whitespace-nowrap text-[11px] leading-none text-ink-faint">
                        {p.mcapUsd > 0 ? `MC ${formatUsd(p.mcapUsd, { compact: true })}` : "no price"}
                      </span>
                    </span>

                    {/* `z-10`: di atas tautan baris yang direntangkan. Di ponsel hanya bintang (UI-POLISH §7 #3:
                        ketuk baris = terminal, swap ada di tab Trade); Terminal dan Swap tampil di desktop. */}
                    <span className="relative z-10 flex items-center justify-end gap-2">
                      <WatchStar chainId={p.chainId} symbol={p.symbol} size="lg" />
                      <Link
                        href={`/token/${p.slug}?chain=${p.chainId}`}
                        className="hidden rounded-full border border-line px-3 py-1 text-[11px] font-medium text-ink-soft transition-colors hover:border-accent/40 hover:text-accent lg:inline-flex"
                      >
                        Terminal
                      </Link>
                      {/* `/swap?token=SYMBOL&chain=ID` dipertahankan bentuknya: audit tautan
                          memeriksa bahwa setiap tombol swap memaku chain, karena tanpa itu
                          pengunjung bisa mendarat di pasar dengan ticker sama di chain lain. */}
                      {p.tradable ? (
                        <Link
                          href={`/swap?token=${p.symbol}&chain=${p.chainId}`}
                          className="hidden rounded-full border border-accent/40 bg-accent-soft px-3 py-1 text-[11px] font-semibold text-accent transition-colors hover:bg-accent hover:text-white lg:inline-flex"
                        >
                          Swap
                        </Link>
                      ) : (
                        <span
                          className="hidden cursor-not-allowed rounded-full border border-line px-3 py-1 text-[11px] text-ink-faint lg:inline-flex"
                          title="No executable curve for this market yet"
                        >
                          Swap
                        </span>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Tautan mesin dipindahkan ke bawah daftar, satu baris, bukan satu blok per pasar.
          Yang membaca ini agen dan pengembang, bukan orang yang sedang memilih pasar. */}
      {!loading && sorted.length > 0 && (
        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
          <CloudLightning className="h-3 w-3 text-accent" />
          <span>Every market is payable from another chain over HTTP:</span>
          {/* `min-h-[32px]`: target sentuh yang cukup di ponsel tanpa mengubah tampilan baris teks ini. */}
          <a
            href={`https://x402.adexto.xyz/v1/x402/buy/${sorted[0].slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[32px] items-center font-mono text-accent underline-offset-4 hover:underline"
          >
            x402/buy/{sorted[0].slug}
          </a>
          <Link href="/x402" className="inline-flex min-h-[32px] items-center text-accent underline-offset-4 hover:underline">
            how it works
          </Link>
        </p>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "ink",
}: {
  label: string;
  value: string;
  tone?: "ink" | "accent" | "ok" | "warn";
}) {
  const color =
    tone === "accent" ? "text-accent" : tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div>
      <span className="text-[10px] text-ink-soft block font-semibold">{label}</span>
      <span className={`text-xs font-bold truncate block ${color}`}>{value}</span>
    </div>
  );
}
