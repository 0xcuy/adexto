"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  IChartApi,
  createSeriesMarkers,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import { ChartCandlestick, LineChart } from "lucide-react";
import { formatSmallNumber } from "@/lib/pricing";
import { tradeWallet } from "@/lib/market-stats";
import { flatSinceLaunch, toUsdCandles } from "@/lib/usd-series";
import { computeIndicators, toLineData, WARMUP, type Ohlc } from "@/lib/indicators";
import { readTheme, THEME_EVENT, type Theme } from "@/lib/theme";

/**
 * Palet chart per tema — HANYA warna kanvas, sumbu, grid, dan crosshair.
 *
 * lightweight-charts menggambar ke canvas, jadi token CSS tidak menjangkaunya; warnanya
 * harus diberikan sebagai nilai. Warna candle (hijau/merah) dan indikator tidak ikut
 * diganti: keduanya terbaca di kedua latar dan artinya tidak boleh berubah dengan tema.
 * Latar dibuat SAMA dengan --surface-2 masing-masing tema, supaya chart menyatu dengan
 * kartunya alih-alih menjadi balok hitam di tema terang.
 */
function chartPalette(theme: Theme) {
  return theme === "light"
    ? {
        background: "#ffffff",
        text: "#6b5c48",
        grid: "rgba(32, 24, 16, 0.05)",
        border: "rgba(32, 24, 16, 0.12)",
        crosshair: "#7c3aed",
        separator: "rgba(32, 24, 16, 0.12)",
        separatorHover: "rgba(124, 58, 237, 0.25)",
      }
    : {
        // Nilai ini TIDAK bisa dibaca dari token CSS: lightweight-charts menggambar ke
        // kanvas, jadi ia menerima warna sebagai string. Karena itu setiap perubahan
        // palet tema gelap harus menyentuh dua tempat, dan ini yang kedua.
        background: "#221b15",
        text: "#bdab95",
        grid: "rgba(247, 242, 233, 0.05)",
        border: "rgba(247, 242, 233, 0.12)",
        crosshair: "#b193ff",
        separator: "rgba(247, 242, 233, 0.12)",
        separatorHover: "rgba(177, 147, 255, 0.3)",
      };
}

function chartThemeOptions(theme: Theme) {
  const c = chartPalette(theme);
  return {
    layout: {
      background: { type: ColorType.Solid, color: c.background },
      textColor: c.text,
      fontSize: 11,
      fontFamily: "monospace",
      panes: { separatorColor: c.separator, separatorHoverColor: c.separatorHover },
    },
    grid: {
      vertLines: { color: c.grid },
      horzLines: { color: c.grid },
    },
    crosshair: {
      vertLine: { color: c.crosshair, width: 1 as const, style: 3 as const },
      horzLine: { color: c.crosshair, width: 1 as const, style: 3 as const },
    },
  };
}

function applyChartTheme(chart: IChartApi | null, theme: Theme) {
  if (!chart) return;
  const c = chartPalette(theme);
  chart.applyOptions({
    ...chartThemeOptions(theme),
    timeScale: { borderColor: c.border },
    rightPriceScale: { borderColor: c.border },
  });
}

/**
 * Candlestick chart with indicators, driven by real OHLC buckets from
 * /api/agent/telemetry.
 *
 * WHY THE INDICATORS ARE OURS AND NOT AN EMBED
 *
 * A TradingView or GeckoTerminal embed resolves a symbol or pool from that
 * provider's database. A token launched minutes ago on our own factory is not in
 * either, so an embed renders an empty frame — which is why the reference
 * screenshots show TIBBIR, a token that is listed on established venues, rather
 * than anything of ours. `lightweight-charts` is TradingView's renderer but ships
 * no indicators, so
 * they are computed in @/lib/indicators from the same candles the chart draws.
 *
 * WHAT THIS COMPONENT REFUSES TO DO
 *
 * It does not draw an indicator that does not have enough data yet. RSI(14) needs
 * 15 bars and MACD needs 34; below that the series is a gap and the footer says how
 * many bars are still missing. A half-warmed average rendered as a solid line is
 * the same class of lie as an invented candle.
 */

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Props {
  symbol: string;
  /** Which chain's market to chart — a ticker can exist on several chains. */
  chainId: number;
  /** Native-denominated fallback price used only when there is no trade history. */
  fallbackPriceNative: number;
  nativeSymbol: string;
  /** USD value of one native unit, for the header readout. */
  nativeUsd: number;
  poolLive: boolean;
  /**
   * Berubah setiap kali sebuah trade TERKONFIRMASI, dan itu memicu pengambilan ulang
   * segera alih-alih menunggu polling berikutnya.
   *
   * Kenapa perlu: polling di bawah berjalan tiap 15 detik. Tanpa pemicu ini, orang yang
   * baru saja menjual melihat chart TANPA fill-nya sampai 15 detik — dan itu tertangkap
   * di rekaman demo, di mana adegan jual tidak memperlihatkan candle baru sama sekali
   * karena adegannya berpindah lebih dulu.
   *
   * Nilainya txHash, bukan boolean atau pencacah waktu: ia berubah tepat sekali per
   * trade, dan `useSovereignSwap` menetapkannya SETELAH receipt diparse — jadi log
   * swap-nya sudah ada di blok ketika pengambilan ulang berjalan.
   */
  refreshKey?: string | null;
  /** Detik epoch transaksi peluncuran. Menentukan awal rentang "All". */
  launchedAt?: number;
  /**
   * Suplai token utuh, dipakai toggle MCAP untuk mengubah sumbu harga menjadi kapitalisasi.
   *
   * Di produk ini kapitalisasi = harga x suplai TANPA catatan kaki: 100% suplai masuk ke
   * kurva sejak peluncuran, tidak ada porsi terkunci dan tidak ada alokasi creator. Jadi
   * MCAP dan FDV bernilai sama, dan menyebutnya "market cap" tidak melebihkan apa pun.
   */
  supply: number;
  /** Dompet yang tersambung. Perdagangannya ditandai B/S di chart. */
  me?: string | null;
  /** Alamat peluncur pasar. Perdagangannya ditandai DEV, supaya penjualan dev terlihat. */
  creator?: string | null;
}

/**
 * Warna tanda perdagangan. Milik sendiri memakai hijau/merah candle; milik dev memakai
 * violet/jingga supaya tidak tertukar dengan milik sendiri di bar yang sama.
 */
const MARK_COLORS = {
  meBuy: "#10b981",
  meSell: "#f43f5e",
  devBuy: "#b193ff",
  devSell: "#f59e0b",
} as const;

/**
 * Interval sub-menit ada karena kurva yang baru lahir diperdagangkan per detik, bukan
 * per menit.
 *
 * Pada bucket 1 menit, sebuah pembelian, penjualan, lalu pembelian lagi yang terjadi
 * dalam rentang satu menit menyatu menjadi SATU candle — dan `close`-nya diambil dari
 * fill terakhir, sehingga arah tiap perdagangan di dalamnya hilang. Itu terjadi sungguhan
 * pada $NOVA991: 4 pembelian dan 1 penjualan menghasilkan nol candle merah.
 *
 * Pada 1 detik, tiap perdagangan hampir selalu mendapat bucket sendiri, jadi naik-turunnya
 * terlihat sebagaimana adanya. Endpoint telemetry melebarkan jumlah bucketnya untuk
 * interval sekecil ini supaya jangkauannya tetap setengah jam.
 */
const INTERVALS = [
  { label: "1s", seconds: 1, sub: true },
  { label: "5s", seconds: 5, sub: true },
  { label: "15s", seconds: 15, sub: true },
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
  { label: "15m", seconds: 900 },
  { label: "1h", seconds: 3600 },
  { label: "4h", seconds: 14400 },
  /**
   * 1d dan 1y adalah bar 86.400 dan 31.536.000 detik, bukan hari kalender dan bukan
   * tahun kalender. Bucket dihitung `floor(detik / lebar) * lebar` dari epoch, jadi
   * batasnya jatuh di kelipatan tetap, bukan di tengah malam zona waktu mana pun. Untuk
   * bar harian bedanya paling banyak beberapa jam; disebut di sini supaya tidak ada yang
   * menyimpulkan ini candle harian bursa.
   *
   * Keduanya hanya berarti kalau riwayatnya benar-benar sepanjang itu. Yang membuatnya
   * mungkin bukan tombol ini, melainkan penelusuran log yang dibatasi blok peluncuran di
   * `readOnChainSwaps` — sebelum itu jendelanya 13,2 jam di 0G, jadi "1d" akan
   * menghasilkan satu bar dan "1y" satu bar juga.
   *
   * Pada pasar yang lebih muda dari satu bar, hasilnya memang satu candle. Itu aritmetika
   * umur pasar, bukan kerusakan, dan `BAR_SPACING` sudah menangani tampilannya supaya
   * satu bar tidak diregangkan selebar pane.
   */
  { label: "1d", seconds: 86400 },
];

/**
 * "1y" dan "All" adalah RENTANG, bukan lebar bar.
 *
 * "1y" dulu berarti satu bar selebar 31.536.000 detik. Pasar tertua di situs ini berumur 23 hari,
 * jadi hasilnya selalu SATU bar — dan di sumbu USD bar itu datar, karena seluruh isinya dinilai
 * dengan satu kurs. Di layar itu terbaca "1y tidak ada candle". Trader tidak pernah meminta satu
 * candle setahun; yang diminta saat menekan 1Y adalah "tunjukkan tahun terakhir", dengan candle
 * selebar yang membuat tahun itu terbaca.
 *
 * Jadi keduanya sekarang memilih RENTANG, lalu lebar bar dipilih otomatis dari `AUTO_BUCKETS`:
 * yang terkecil yang memuat rentang itu dalam `RANGE_TARGET_BARS` bar. "All" = sejak peluncuran;
 * "1y" = 365 hari terakhir, atau sejak peluncuran kalau pasarnya lebih muda. Untuk semua pasar hari
 * ini keduanya sama, dan itu jujur: riwayat pasar-pasar itu memang lebih pendek dari setahun.
 */
const RANGES = [
  { label: "1y", seconds: 365 * 86400 },
  { label: "All", seconds: Number.POSITIVE_INFINITY },
] as const;
type RangeLabel = (typeof RANGES)[number]["label"];

/** Lebar bar yang boleh dipilih otomatis untuk sebuah rentang. */
const AUTO_BUCKETS = [300, 900, 1800, 3600, 7200, 14400, 21600, 43200, 86400, 259200, 604800];

/** Target jumlah bar untuk rentang: cukup rapat untuk dibaca, cukup sedikit untuk muat di pane. */
const RANGE_TARGET_BARS = 160;

/** Lebar bar untuk rentang `spanSeconds`. Yang terkecil yang tidak melebihi target jumlah bar. */
function autoBucket(spanSeconds: number): number {
  for (const b of AUTO_BUCKETS) if (spanSeconds / b <= RANGE_TARGET_BARS) return b;
  return AUTO_BUCKETS[AUTO_BUCKETS.length - 1];
}

/**
 * Di atas ambang ini, sumbu waktu menampilkan TANGGAL saja, tanpa jam.
 *
 * Sumbu dikonfigurasi sekali dengan `timeVisible: true`, yang mencetak jam untuk setiap
 * label. Pada bar harian atau tahunan itu menghasilkan label seperti "07:00" di bawah
 * candle yang mewakili satu hari penuh — jam yang tidak berarti apa pun karena barnya
 * tidak terjadi pada jam itu. Ambangnya di bawah 1 hari supaya 4 jam ke bawah tidak
 * berubah perilakunya.
 */
const DATE_ONLY_FROM_SECONDS = 86400;

/**
 * Lebar satu bar dalam PIKSEL, sama untuk setiap token dan setiap timeframe.
 *
 * Dinyatakan sebagai piksel dan bukan sebagai jumlah slot, jadi lebar candle tidak lagi
 * bergantung pada lebar pane maupun pada banyaknya bar yang kebetulan dimiliki sebuah
 * pasar. Sebelumnya 96 slot per pane, yang terukur menjadi 6,9px per bar — di bawah lebar
 * bar terminal rujukan mana pun, dan itulah keluhan candle terlalu kecil.
 *
 * Sebelum ini ada DUA mode dan chart melompat di antaranya pada bar ke-12: di bawah
 * ambang jendela dipatok ke 12 slot, di atasnya `fitContent()` memeras seluruh riwayat
 * ke satu pane. Akibatnya ukuran candle berbeda antar-token untuk alasan yang tidak
 * ada hubungannya dengan setelan chart. Terukur berdampingan: $ADEXTO di 0G dengan 108
 * bar di-fit menjadi ~4px per bar, sementara $CURB di Monad dengan 4 bar mendapat 1/12
 * pane atau ~38px per bar — sepuluh kali lebih lebar, pada kode dan setelan yang persis
 * sama. Setiap token baru lahir di mode gemuk lalu mengerut mendadak begitu bar ke-12
 * terbentuk, tanpa ada yang mengubah apa pun.
 *
 * 96 dipilih untuk mereproduksi lebar bar yang sudah disetujui pada $ADEXTO di 1h,
 * yaitu ~4-5px pada lebar pane terminal saat ini. Ia juga membuat pasar yang baru
 * lahir tampil seperti listing baru di bursa mana pun: beberapa bar berukuran normal
 * menempel di tepi kiri, sisanya ruang yang belum terisi — bukan satu balok raksasa.
 *
 * `fitContent()` sengaja tidak dipakai lagi. Riwayat lama tidak hilang: bar di luar
 * jendela tetap ada di seri dan bisa digeser atau di-zoom seperti chart mana pun.
 */
const BAR_SPACING = 12;

/**
 * Lebar sumbu harga, dipatok sama untuk chart harga DAN kotak osilator.
 *
 * Satu konstanta dan bukan dua angka terpisah, karena begitu keduanya berbeda sumbu waktu
 * kedua kotak langsung tidak sejajar dan tidak ada yang akan menyadarinya sampai ada yang
 * mengukur lebar canvas-nya.
 */
const PRICE_AXIS_WIDTH = 96;

/** Notasi ringkas untuk sumbu kapitalisasi: 20509 -> "20.51K". */
const compactNumber = (v: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v);

/**
 * Overlay indicators share the price scale; RSI and MACD cannot, since one is
 * bounded 0..100 and the other oscillates around zero. Those get their own pane.
 */
type OverlayKey = "ema9" | "ema21" | "sma50" | "bollinger" | "vwap";
type PaneKey = "rsi14" | "macd";
type IndicatorKey = OverlayKey | PaneKey;

const OVERLAYS: Array<{ key: OverlayKey; label: string; color: string; warmupKey: string }> = [
  { key: "ema9", label: "EMA 9", color: "#38bdf8", warmupKey: "ema9" },
  { key: "ema21", label: "EMA 21", color: "#a78bfa", warmupKey: "ema21" },
  { key: "sma50", label: "SMA 50", color: "#fbbf24", warmupKey: "sma50" },
  { key: "bollinger", label: "Bollinger 20,2", color: "#94a3b8", warmupKey: "bollinger" },
  { key: "vwap", label: "VWAP", color: "#f472b6", warmupKey: "vwap" },
];

const PANES: Array<{ key: PaneKey; label: string; warmupKey: string }> = [
  { key: "rsi14", label: "RSI 14", warmupKey: "rsi14" },
  { key: "macd", label: "MACD 12,26,9", warmupKey: "macd" },
];

export default function RealtimeCandleChart({
  symbol,
  chainId,
  fallbackPriceNative,
  nativeSymbol,
  nativeUsd,
  poolLive,
  refreshKey,
  supply,
  launchedAt,
  me,
  creator,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  /** Plugin tanda perdagangan untuk seri candle dan seri garis (v5: `createSeriesMarkers`). */
  const candleMarksRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const lineMarksRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  /** Tanda perdagangan menyala secara bawaan; bisa dimatikan dari toolbar. */
  const [showMarks, setShowMarks] = useState(true);
  /** Ringkasan tanda yang sedang tergambar, dipasang sebagai atribut data untuk pemeriksaan. */
  const [markSummary, setMarkSummary] = useState({ me: 0, dev: 0, bars: 0 });
  /**
   * Kontainer dan chart TERPISAH untuk osilator (RSI, MACD).
   *
   * Sebelumnya keduanya dipasang sebagai pane tambahan di DALAM chart harga lewat
   * `chart.addPane()`. Akibatnya dua hal yang keduanya salah:
   *   - tiap pane memakan 90 px dari tinggi chart yang tetap 340 px, jadi menyalakan RSI
   *     dan MACD sekaligus memangkas area candle sampai lebih dari separuh — candle-nya
   *     terhimpit persis di saat pengguna ingin melihatnya lebih jelas;
   *   - garis RSI berskala 0..100 tergambar di kotak yang sama dengan harga, dan itu
   *     terbaca seolah harga yang bergerak. Kebingungan ini nyata, bukan hipotetis.
   *
   * Sekarang osilator hidup di kotaknya sendiri di bawah chart harga. Chart harga
   * mempertahankan seluruh tingginya untuk candle, dan tidak ada lagi garis berskala lain
   * yang menumpang di sana.
   */
  const oscContainerRef = useRef<HTMLDivElement>(null);
  const oscChartRef = useRef<IChartApi | null>(null);
  /** Penjaga agar sinkronisasi dua arah sumbu waktu tidak saling memantul tanpa henti. */
  const syncingRef = useRef(false);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  /** Seri garis. Hidup bersama seri candle dan yang tampil dipilih lewat `visible`,
   *  bukan dengan membuat ulang chart: membuat ulang akan mereset zoom dan posisi
   *  gulir setiap kali orang berganti bentuk tampilan. */
  const lineSeriesRef = useRef<any>(null);
  /**
   * Digit signifikan untuk sumbu harga, diturunkan dari rentang data.
   *
   * Ref dan bukan state: dibaca dari dalam formatter yang dipasang sekali saat seri
   * dibuat, jadi ia harus bisa berubah tanpa membuat seri dibangun ulang.
   */
  const sigDigitsRef = useRef(4);
  /** Indicator series are created and destroyed as they are toggled. */
  const overlayRefs = useRef<Partial<Record<string, any>>>({});
  const paneRefs = useRef<Partial<Record<string, any>>>({});
  const candlesRef = useRef<Candle[]>([]);
  /**
   * Whether the visible range has been fitted for the current symbol/timeframe.
   *
   * `setData` does not adjust the visible range, so a market with only a handful of
   * bars renders them squeezed against the right edge with an empty pane to the
   * left — which reads as a broken chart. Fitting solves that, but fitting on every
   * 15-second poll would yank the view back and undo any pan or zoom the user just
   * made, so it happens once per symbol/chain/timeframe/unit.
   */
  const fittedFor = useRef<string>("");

  /**
   * Default 1m, bukan 5m.
   *
   * Di produk ini setiap pasar berumur menit, bukan bulan, jadi default yang lazim
   * di bursa mapan justru salah di sini. Diukur pada pasar demo dengan 5 fill nyata:
   * 1m menghasilkan 13 bar, 5m hanya 3, dan 15m cuma 1. Bucket yang terlalu lebar
   * meruntuhkan seluruh riwayat menjadi satu candle — dan satu candle itulah yang
   * kemudian diregangkan memenuhi pane. Jadi timeframe default adalah bagian dari
   * penyebab, bukan cuma korbannya.
   */
  const [interval, setIntervalSeconds] = useState(60);
  /**
   * Rentang yang sedang aktif ("1y"/"All"), atau null bila yang dipilih lebar bar biasa.
   *
   * Saat rentang aktif, `interval` diisi lebar bar hasil `autoBucket`, jadi seluruh jalur data di
   * bawah — pengambilan, konversi USD, indikator — tidak perlu tahu bedanya. Yang berbeda hanya
   * cara jendelanya dipasang: rentang memperlihatkan SELURUH isinya.
   */
  const [range, setRange] = useState<RangeLabel | null>(null);
  /** Menu interval sub-menit. Tertutup secara bawaan; lihat catatan di barnya. */
  const [showSubMinute, setShowSubMinute] = useState(false);
  /**
   * Apakah `?tf=` di URL sudah dibaca. Pengambilan data tidak dimulai sebelum ini benar.
   *
   * `window` tidak ada saat render server, jadi `tf` tidak bisa dijadikan nilai awal
   * `useState` tanpa mengakibatkan ketidakcocokan hidrasi. Gerbang ini memberi hasil yang
   * sama tanpa risiko itu: tepat SATU permintaan awal, dan bucket-nya sudah benar.
   */
  const [tfResolved, setTfResolved] = useState(false);

  /**
   * Skala logaritmik, autoscale, dan sumbu harga-vs-kapitalisasi.
   *
   * `log` menjawab keterbatasan yang sudah dinyatakan di autoscaleInfoProvider: pada skala
   * linear yang autoscale, gerakan 0,0002% dan 2% tergambar mirip, jadi chart tidak
   * menyampaikan besaran. Pada skala logaritmik jarak vertikal menjadi perubahan
   * PERSENTASE, sehingga dua gerakan yang berbeda besaran akhirnya terlihat berbeda. Itu
   * bukan sekadar preferensi tampilan, itu yang membuat sumbunya berarti.
   *
   * `auto` dimatikan berarti rentang berhenti mengikuti data, sehingga pengguna bisa
   * menggeser dan zoom sumbu harga tanpa chart menariknya kembali setiap kali data masuk.
   */
  const [logScale, setLogScale] = useState(false);
  const [autoScale, setAutoScale] = useState(true);
  const [showMcap, setShowMcap] = useState(false);
  /**
   * Satuan sumbu: aset native chain, atau dolar.
   *
   * Bawaannya USD, karena itu satuan yang bisa dibandingkan orang dan karena dalam USD
   * pasar tanpa perdagangan baru TETAP bergerak (nilainya ikut kurs). Kalau rekaman kurs
   * belum cukup panjang, kode di bawah jatuh kembali ke native dan mengatakannya.
   */
  const [unit, setUnit] = useState<"native" | "usd">("usd");
  const [chartKind, setChartKind] = useState<"candles" | "line">("candles");

  /** Pengali sumbu: 1 untuk harga, suplai untuk kapitalisasi. */
  const priceMultiplier = showMcap && supply > 0 ? supply : 1;

  /**
   * Timeframe dibaca dari `?tf=` dan ditulis kembali ke URL saat diganti.
   *
   * Ini menutup bug yang tidak terlihat sampai perekaman dijalankan: `interval` hanyalah
   * state komponen, jadi setiap navigasi me-remount-nya dan mengembalikannya ke 60 detik.
   * Perekam menavigasi ke halaman token LIMA kali — adegan terminal, adegan jual, dua
   * adegan fill tambahan, dan chart penutup — sehingga memilih 15 detik sekali di adegan
   * awal tidak berpengaruh apa pun pada adegan jual, yaitu justru adegan yang candle
   * merahnya ingin diperlihatkan.
   *
   * Dibaca lewat useEffect dan bukan sebagai nilai awal useState supaya tidak ada
   * ketidakcocokan hidrasi: `window` tidak ada saat render server.
   *
   * `replaceState` dan bukan push: mengganti timeframe bukan navigasi, dan tidak boleh
   * menumpuk riwayat sehingga tombol Kembali harus ditekan berkali-kali.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("tf");
    const rawRange = params.get("range");
    const pickedRange = RANGES.find((r) => r.label.toLowerCase() === rawRange);
    if (pickedRange) {
      // Lebar bar rentang dihitung ulang dari umur sekarang, bukan dipercaya dari `tf` di URL:
      // pasar yang makin tua butuh bar yang makin lebar untuk tetap muat.
      const nowSec = Math.floor(Date.now() / 1000);
      const age = launchedAt ? Math.max(3600, nowSec - launchedAt) : 30 * 86400;
      setRange(pickedRange.label);
      setIntervalSeconds(autoBucket(Math.min(pickedRange.seconds, age)));
    } else if (raw) {
      const wanted = Number(raw);
      if (INTERVALS.some((i) => i.seconds === wanted)) setIntervalSeconds(wanted);
    }
    // Menandai `tf` sudah dibaca. Efek muat data MENUNGGU ini, kalau tidak ia sudah
    // menembak sekali dengan interval bawaan 60 sebelum `tf` diterapkan — permintaan
    // terbuang yang balasannya bisa datang SETELAH permintaan yang benar, dan urutannya
    // hanya ditentukan keberuntungan jaringan. Terukur pada satu kali muat: bucket=60
    // dijawab pada +396ms dan bucket=15 pada +447ms, dan pada muat berikutnya urutannya
    // berbalik.
    setTfResolved(true);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const wantedRange = range ? range.toLowerCase() : null;
    if (url.searchParams.get("tf") === String(interval) && url.searchParams.get("range") === wantedRange) return;
    url.searchParams.set("tf", String(interval));
    // Rentang ikut ditulis: tanpa ini tautan "All" dibuka ulang sebagai bar 4 jam biasa, dan
    // jendelanya tidak lagi memperlihatkan seluruh riwayat.
    if (wantedRange) url.searchParams.set("range", wantedRange);
    else url.searchParams.delete("range");
    window.history.replaceState(null, "", url.toString());
  }, [interval, range]);

  /**
   * Sumbu waktu ikut interval. Tanpa ini, bar harian berlabel jam.
   *
   * Opsi `timeScale` dipasang SEKALI saat chart dibuat, jadi `timeVisible: true` berlaku
   * untuk semua interval — termasuk 1d dan 1y, di mana label jam mengarang ketepatan yang
   * tidak dimiliki barnya: satu bar mewakili seluruh hari, jadi mencetak "07:00" di
   * bawahnya menyiratkan sesuatu terjadi pada jam itu.
   */
  useEffect(() => {
    chartRef.current?.timeScale().applyOptions({ timeVisible: interval < DATE_ONLY_FROM_SECONDS });
  }, [interval]);
  const [priceNative, setPriceNative] = useState(fallbackPriceNative);
  const [changePct, setChangePct] = useState(0);
  const [source, setSource] = useState<string>("");
  const [tradeCount, setTradeCount] = useState(0);
  /**
   * Cermin `tradeCount` di ref, dipakai pengejar pasca-trade sebagai garis dasar.
   *
   * Ref dan bukan state karena pengejarnya hidup di dalam efek muat data: kalau
   * `tradeCount` dimasukkan ke daftar dependensi efek itu, setiap pengambilan yang menaikkan
   * hitungan akan membangun ulang efeknya, dan pengejarnya memulai diri sendiri tanpa henti.
   */
  const tradeCountRef = useRef(0);
  const [candleCount, setCandleCount] = useState(0);
  const [showIndicatorMenu, setShowIndicatorMenu] = useState(false);
  /**
   * SEMUA indikator mati secara bawaan.
   *
   * Sebelumnya EMA9, EMA21 dan RSI menyala tanpa diminta, jadi chart pertama yang dilihat
   * orang sudah punya tiga garis dan satu pane tambahan di bawahnya — sebelum mereka tahu
   * harganya sendiri bergerak ke mana. Yang ingin dilihat lebih dulu adalah harga; indikator
   * adalah pilihan, dan tombol "Indicators" sudah menyatakan bahwa pilihan itu ada.
   */
  const [enabled, setEnabled] = useState<Record<IndicatorKey, boolean>>({
    ema9: false,
    ema21: false,
    sma50: false,
    bollinger: false,
    vwap: false,
    rsi14: false,
    macd: false,
  });
  /** OHLC values under the crosshair, like the legend GeckoTerminal shows. */
  const [legend, setLegend] = useState<Candle | null>(null);

  const enabledKey = JSON.stringify(enabled);
  /**
   * Osilator yang menyala DAN benar-benar bisa digambar.
   *
   * Syarat kedua itu yang penting, dan tanpanya ada bug: menyalakan RSI membuat kotak
   * bawah muncul di SEMUA timeframe, termasuk yang barnya tidak cukup. Yang terlihat
   * adalah kotak berbingkai lengkap dengan sumbu tapi tanpa satu garis pun — persis
   * "strip kosong yang memakan ruang" yang seharusnya dihindari.
   *
   * Kenapa barnya bisa tidak cukup: RSI 14 menuntut 15 bar dan MACD 34, sementara jumlah
   * bar yang bisa ada dibatasi UMUR PASAR. Pasar berumur 91 detik hanya menghasilkan 7
   * bucket pada 15 detik dan 1 bucket pada 4 jam. Ini aritmetika, bukan kerusakan.
   *
   * Yang TIDAK dilakukan: memadatkan jumlah bar dengan bar kosong supaya ambangnya
   * terlampaui. RSI di atas bantalan datar adalah angka yang terlihat seperti analisis
   * tetapi tidak mengukur apa pun — kelas kesalahan yang sama dengan mengarang riwayat
   * sebelum perdagangan pertama, yang sudah dilarang di `buildCandles`. Pesan
   * "warming up" di bawah chart menyatakan kekurangannya apa adanya.
   */
  const oscillators = PANES.filter((p) => enabled[p.key] && candleCount >= (WARMUP[p.warmupKey] ?? 1));
  const hasOscillator = oscillators.length > 0;

  /**
   * Rentang yang lebih panjang daripada umur pasar dinyatakan apa adanya: tidak ada data
   * sebelum peluncuran. Chart-nya sendiri dimulai di peluncuran (atau di perdagangan pertama),
   * dan catatan ini menyebut tanggalnya supaya "1Y" tidak terbaca sebagai setahun riwayat.
   * Tanggal memakai zona waktu pembaca; `range` baru terisi di browser, jadi tidak ada selisih
   * render server dan klien.
   */
  const noDataBefore = (() => {
    if (range !== "1y" || !launchedAt || !(launchedAt > 0)) return null;
    const span = RANGES.find((r) => r.label === range)?.seconds ?? Number.POSITIVE_INFINITY;
    if (Math.floor(Date.now() / 1000) - launchedAt >= span) return null;
    return new Date(launchedAt * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  })();

  // Ikut berganti saat tema diganti, tanpa membuat ulang chart (data dan zoom tetap).
  useEffect(() => {
    const onTheme = (e: Event) => {
      const theme = ((e as CustomEvent<Theme>).detail ?? readTheme()) as Theme;
      applyChartTheme(chartRef.current, theme);
      applyChartTheme(oscChartRef.current, theme);
    };
    window.addEventListener(THEME_EVENT, onTheme);
    return () => window.removeEventListener(THEME_EVENT, onTheme);
  }, []);

  // Chart instance is created once per container, not per data refresh.
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      ...chartThemeOptions(readTheme()),
      /**
       * `fixLeftEdge` MENGUNCI tepi kiri di bar pertama.
       *
       * Tanpa ini chart bisa digeser ke kiri melewati candle pertama, ke wilayah yang
       * tidak punya data — dan untuk token yang baru diluncurkan wilayah itu bukan
       * "data yang belum dimuat", melainkan waktu ketika tokennya belum ada. Membiarkan
       * orang menggeser ke sana menyiratkan ada riwayat yang sedang disembunyikan.
       *
       * `rightOffset: 0` melengkapinya: bar terbaru menempel di tepi kanan alih-alih
       * menyisakan bantalan kosong.
       */
      timeScale: {
        borderColor: chartPalette(readTheme()).border,
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        rightOffset: 0,
      },
      /**
       * `minimumWidth` DIPATOK, dan angkanya harus sama dengan chart osilator.
       *
       * Lebar sumbu harga menyesuaikan diri dengan label terpanjangnya. Chart harga
       * memakai notasi subscript seperti "0.0₄20509595" sementara kotak osilator hanya
       * "86.9", jadi sumbunya melebar berbeda — dan karena sumbu memakan lebar dari area
       * gambar, area gambar kedua kotak jadi tidak sama lebar. Terukur bedanya 30 px, dan
       * akibatnya bar RSI tidak lurus di bawah candle-nya: crosshair di satu kotak
       * menunjuk bar yang berbeda di kotak lain, yang membuat osilatornya lebih
       * menyesatkan daripada berguna.
       *
       * 96 px cukup untuk label subscript terpanjang pada presisi 12 digit.
       */
      rightPriceScale: {
        borderColor: chartPalette(readTheme()).border,
        /**
         * `bottom` dipangkas dari 0,28 ke 0,12.
         *
         * Margin bawah ini menyisakan ruang supaya candle tidak menabrak histogram volume.
         * 0,28 jauh lebih besar dari yang dibutuhkan: bersama margin atas 0,1, area candle
         * hanya kebagian 62% tinggi pane. Setelah strip volume dikecilkan ke 8% (lihat
         * priceScale("volume") di bawah), 0,12 sudah cukup memisahkan keduanya, dan area
         * candle naik ke 78% tinggi pane.
         */
        scaleMargins: { top: 0.1, bottom: 0.12 },
        minimumWidth: PRICE_AXIS_WIDTH,
      },
      width: containerRef.current.clientWidth,
      /**
       * Tinggi MENGIKUTI kontainer, tidak dipatok 340 px.
       *
       * Angka tetap membuat chart mengabaikan ruang yang tersedia: memperbesar kartunya
       * tidak memperbesar chart-nya, dan di layar lebar area candle tetap sempit. Dengan
       * membaca `clientHeight` lalu menjaganya lewat ResizeObserver, tinggi chart didorong
       * oleh CSS — jadi memperbesar terminal cukup dengan mengubah satu kelas tinggi.
       */
      height: containerRef.current.clientHeight || 420,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#f43f5e",
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#f43f5e",
      /**
       * A custom formatter, because a curve opens around 1e-9 of the native asset
       * and the built-in price format with 8 decimals rendered every axis label as
       * "0.00000000" — a price scale that showed nothing at all. `formatSmallNumber`
       * is the same subscript notation the rest of the app uses, so the axis, the
       * header and the trade panel read alike.
       *
       * Per-series on purpose: a chart-wide `localization.priceFormatter` would also
       * capture the RSI pane, where 0..100 values need no such treatment.
       */
      /**
       * Digit signifikannya MENGIKUTI rentang yang sedang tergambar, bukan tetap 4.
       *
       * `formatSmallNumber` bawaannya 4 digit signifikan. Untuk kurva muda itu membuat
       * seluruh sumbu terbaca angka yang sama: 2,05095600e-5 dan 2,05095926e-5 sama-sama
       * dibulatkan menjadi "0.0₄2051". Jadi begitu lantai autoscale dicabut dan candle-nya
       * mulai bergerak, sumbunya justru yang membuat chart tampak rusak — semua garis
       * berlabel identik sementara harga jelas berpindah.
       *
       * Presisinya dihitung dari lebar rentang relatif saat data dimuat, lalu dibatasi
       * 4..12 supaya harga normal tidak ikut berubah panjang labelnya.
       */
      priceFormat: {
        type: "custom",
        formatter: (p: number) => formatSmallNumber(p, sigDigitsRef.current),
        minMove: 1e-12,
      },
      /**
       * Autoscale mengikuti data. TIDAK ADA lantai rentang.
       *
       * Sebelumnya di sini ada lantai ±0,5%: rentang pane dipaksa minimal 1% lebar
       * kalau data lebih sempit dari itu. Maksudnya baik — mencegah gerakan mikroskopis
       * dibesarkan jadi blok hijau setinggi chart sementara header menulis +0.00% —
       * tapi obatnya salah sasaran dan menghasilkan kegagalan yang lebih buruk:
       * SETIAP pembelian menjadi garis datar.
       *
       * Terukur pada $NOVA991 di 0G mainnet: harga naik monoton di keempat pembelian,
       * dari 2,05095600e-5 ke 2,05095926e-5, dan chart menggambarnya sebagai satu garis
       * lurus. Grafik candle yang tidak naik ketika ada yang membeli bukan grafik candle.
       *
       * Kenapa tanpa lantai memang benar DI SINI, bukan cuma "lebih enak dilihat":
       * harga pada bonding curve adalah fungsi deterministik dari reserve. Tidak ada
       * noise mikro untuk diperbesar secara menyesatkan — setiap kenaikan ADALAH sebuah
       * pembelian dan setiap penurunan ADALAH sebuah penjualan. Memperbesar rentang
       * nyata di sini menampilkan informasi, bukan mengarang volatilitas.
       *
       * Dua hal lain harus benar bersama ini, kalau tidak perbaikannya setengah, dan
       * keduanya dibetulkan di commit yang sama:
       *   - presisi sumbu harga (lihat `sigDigitsRef`), kalau tidak semua label terbaca
       *     angka yang sama walau candle-nya bergerak;
       *   - persentase di header (lihat `formatPct`), kalau tidak header menulis +0.00%
       *     dan justru header itulah yang membantah chart.
       *
       * Yang tersisa hanya penjaga kasus degenerat: rentang nol lebar, yaitu ketika
       * seluruh seri satu harga — pasar yang belum pernah diperdagangkan, atau deretan
       * bucket kosong. Di situ pane diberi bantalan tipis supaya pustaka chart tidak
       * membagi dengan nol, dan garis datarnya memang jujur karena tidak ada yang trading.
       */
      autoscaleInfoProvider: (original: () => any) => {
        const res = original();
        const range = res?.priceRange;
        if (!range) return res;
        const mid = (range.minValue + range.maxValue) / 2;
        if (!Number.isFinite(mid) || mid <= 0) return res;
        const span = range.maxValue - range.minValue;

        // Kasus degenerat: seluruh seri satu harga, jadi rentangnya nol lebar. Diberi
        // bantalan tipis supaya pustaka chart tidak membagi dengan nol. Garis datarnya
        // memang jujur — tidak ada yang trading.
        if (span <= 0) {
          const half = mid * 0.0005;
          return { ...res, priceRange: { minValue: mid - half, maxValue: mid + half } };
        }

        /**
         * Badan candle TERBESAR dibatasi porsinya terhadap rentang yang tergambar.
         *
         * Ini menjawab dua keluhan berlawanan dengan SATU aturan, setelah dua percobaan
         * sebelumnya masing-masing hanya menjawab satu dan memecahkan yang lain:
         *   - lantai +-0,5% membuat kenaikan 0,00016% jadi garis datar sama sekali;
         *   - autoscale murni membuat SATU candle 4 jam mengisi seluruh terminal, karena
         *     badannya memang sama dengan seluruh rentang data.
         *
         * Aturannya relatif terhadap data, jadi ia tidak pernah menyembunyikan gerakan —
         * hanya menahan zoom agar satu badan tidak menghabiskan pane. Pada satu candle,
         * rentang dilebarkan ~2,9x sehingga badannya jadi 35% rentang, yang setelah
         * scaleMargins menjadi sekitar 22% tinggi pane: ukuran candle yang wajar. Pada
         * riwayat panjang, badan terbesar biasanya sudah di bawah ambang dan hasil
         * autoscale asli dipakai apa adanya.
         *
         * Konsekuensi yang disengaja: skalanya tetap TIDAK menyampaikan besaran absolut —
         * gerakan 0,00016% dan 2,5% terlihat mirip. Itu sifat semua chart yang autoscale,
         * dan yang menyampaikan besaran adalah persentase di header serta label sumbu,
         * yang keduanya kini punya presisi cukup untuk dibaca.
         */
        let maxBody = 0;
        for (const c of candlesRef.current) {
          const body = Math.abs(c.close - c.open);
          if (body > maxBody) maxBody = body;
        }
        // 0,22 dan bukan 0,35: area candle bertambah dari 62% ke 78% tinggi pane dan
        // pane-nya sendiri ikut lebih tinggi, jadi porsi yang sama menghasilkan badan yang
        // jauh lebih besar dalam piksel. 0,22 menjaga badan terbesar tetap sekitar 80 px,
        // proporsi yang sama dengan terminal rujukan.
        const MAX_BODY_SHARE = 0.22;
        /**
         * Pelebaran DIBATASI dua kali rentang data, dan itu perbaikan atas cacat yang
         * baru terlihat setelah sumbu USD ada.
         *
         * Aturan di atas mengasumsikan badan terbesar mewakili besaran seri. Pada seri USD
         * asumsi itu patah: satu bucket bisa memuat lompatan kurs satu jam sementara ratusan
         * bucket lain nyaris datar, jadi SATU outlier melebarkan rentang sekitar 4,5x dan
         * seluruh seri terhimpit ke dasar pane — persis kebalikan dari maksud aturannya.
         *
         * Batas 2x menjaga niat aslinya (satu candle tidak boleh menghabiskan pane) tanpa
         * membiarkan satu bar menentukan skala untuk semua bar lain.
         */
        const MAX_RANGE_GROWTH = 2;
        if (maxBody > 0 && maxBody > span * MAX_BODY_SHARE) {
          const wanted = maxBody / MAX_BODY_SHARE;
          const half = Math.min(wanted, span * MAX_RANGE_GROWTH) / 2;
          return { ...res, priceRange: { minValue: mid - half, maxValue: mid + half } };
        }
        return res;
      },
    });

    // Seri garis: penutupan saja. Dibuat sekarang, ditampilkan hanya saat diminta.
    const lineSeries = chart.addSeries(LineSeries, {
      color: "#b193ff",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      visible: false,
      priceFormat: {
        type: "custom",
        formatter: (p: number) => formatSmallNumber(p, sigDigitsRef.current),
        minMove: 1e-12,
      },
    });
    lineSeriesRef.current = lineSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: "rgba(56, 189, 248, 0.35)",
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    /**
     * Volume jadi strip TIPIS di dasar: 8% tinggi pane, dari sebelumnya 18%.
     *
     * 18% berarti hampir seperlima terminal dipakai batang volume, dan pada pasar muda
     * yang volumenya beberapa ribu 0G, batang itu tidak menyampaikan apa pun yang sepadan
     * dengan ruang sebesar itu. Yang orang datang untuk lihat adalah candle-nya.
     */
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.92, bottom: 0 } });

    // The legend follows the crosshair, and falls back to the newest bar when the
    // pointer leaves the chart so the row is never blank.
    chart.subscribeCrosshairMove((param) => {
      const list = candlesRef.current;
      if (!param.time) {
        setLegend(list.length ? list[list.length - 1] : null);
        return;
      }
      const hit = list.find((c) => c.time === (param.time as unknown as number));
      setLegend(hit ?? (list.length ? list[list.length - 1] : null));
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    // Satu plugin per seri: tanda di seri yang sedang disembunyikan ikut tersembunyi, jadi
    // keduanya diisi sama dan yang tampil mengikuti bentuk chart.
    candleMarksRef.current = createSeriesMarkers(candleSeries, []);
    lineMarksRef.current = createSeriesMarkers(lineSeries, []);

    /**
     * ResizeObserver, bukan hanya event `resize` window.
     *
     * Kontainernya berubah ukuran karena hal-hal yang tidak menimbulkan event window:
     * kotak osilator muncul atau hilang, panel di sebelahnya melipat, kolom grid berubah
     * di breakpoint. Mendengarkan window saja membuat chart memakai tinggi lama sampai ada
     * yang mengubah ukuran jendela — dan itu terlihat sebagai canvas yang terpotong.
     */
    const syncSize = () => {
      const el = containerRef.current;
      if (!el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) chart.applyOptions({ width: w, height: h });
    };
    const ro = new ResizeObserver(syncSize);
    ro.observe(containerRef.current);
    const handleResize = syncSize;
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      candleMarksRef.current = null;
      lineMarksRef.current = null;
      overlayRefs.current = {};
      paneRefs.current = {};
    };
  }, []);

  /**
   * Chart osilator: instance sendiri, di kotak sendiri, dibuat hanya saat dibutuhkan.
   *
   * Tingginya mengikuti jumlah osilator yang menyala, jadi menyalakan RSI saja tidak
   * menyisakan strip kosong untuk MACD.
   *
   * Sumbu waktunya DISINKRONKAN dua arah dengan chart harga. Tanpa itu kedua kotak akan
   * menggambar rentang waktu berbeda, dan membaca RSI di bawah candle yang tidak sejajar
   * lebih buruk daripada tidak punya RSI: crosshair di satu kotak akan menunjuk bar yang
   * berbeda di kotak lainnya. `syncingRef` mencegah dua langganan itu saling memantul.
   */
  useEffect(() => {
    if (!hasOscillator || !oscContainerRef.current) return;

    const osc = createChart(oscContainerRef.current, {
      ...chartThemeOptions(readTheme()),
      // Sumbu waktu disembunyikan: label jamnya sudah ada di chart harga tepat di atas,
      // dan mengulanginya dua kali hanya menambah bising pada kotak setinggi 120 px.
      timeScale: { borderColor: chartPalette(readTheme()).border, timeVisible: true, secondsVisible: false, visible: false },
      // Lebar sumbu SAMA dengan chart harga, kalau tidak area gambarnya beda lebar dan
      // bar osilator tidak lurus di bawah candle-nya.
      rightPriceScale: {
        borderColor: chartPalette(readTheme()).border,
        scaleMargins: { top: 0.12, bottom: 0.12 },
        minimumWidth: PRICE_AXIS_WIDTH,
      },
      width: oscContainerRef.current.clientWidth,
      height: oscillators.length * 120,
    });
    oscChartRef.current = osc;

    const price = chartRef.current;
    const linkFrom = (a: IChartApi, b: IChartApi) =>
      a.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (!range || syncingRef.current) return;
        syncingRef.current = true;
        try {
          b.timeScale().setVisibleLogicalRange(range);
        } finally {
          syncingRef.current = false;
        }
      });
    if (price) {
      /**
       * Penyelarasan awal dijalankan SEBELUM langganan dipasang, dan arahnya satu arah:
       * osilator mengikuti harga.
       *
       * Sebelumnya kedua langganan dipasang lebih dulu, lalu
       * `osc.setVisibleLogicalRange(current)` dipanggil di luar penjaga `syncingRef` —
       * sehingga panggilan itu memantul kembali ke chart harga lewat `linkFrom(osc, price)`
       * dan menimpa rentang yang baru saja diminta chart harga.
       */
      const current = price.timeScale().getVisibleLogicalRange();
      if (current) osc.timeScale().setVisibleLogicalRange(current);
      linkFrom(price, osc);
      linkFrom(osc, price);
    }

    const handleResize = () => {
      if (oscContainerRef.current) osc.applyOptions({ width: oscContainerRef.current.clientWidth });
    };
    window.addEventListener("resize", handleResize);

    // Digambar ulang segera supaya kotaknya tidak muncul kosong sampai polling berikutnya.
    if (candlesRef.current.length > 0) drawIndicators(candlesRef.current);

    return () => {
      window.removeEventListener("resize", handleResize);
      osc.remove();
      oscChartRef.current = null;
      paneRefs.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasOscillator, oscillators.length]);

  /**
   * Draw the indicators. Runs whenever the data or the toggles change.
   *
   * Series are torn down and rebuilt rather than hidden, so a disabled indicator
   * costs nothing and an enabled one cannot show a stale line from a previous
   * timeframe.
   */
  const drawIndicators = (candles: Candle[]) => {
    const chart = chartRef.current;
    if (!chart) return;

    const osc = oscChartRef.current;

    for (const s of Object.values(overlayRefs.current)) if (s) chart.removeSeries(s);
    // Seri osilator hidup di chart LAIN, jadi dilepas dari chart itu — bukan dari chart
    // harga. Memanggil `chart.removeSeries` untuk seri milik chart lain akan melempar.
    if (osc) for (const s of Object.values(paneRefs.current)) if (s) osc.removeSeries(s);
    overlayRefs.current = {};
    paneRefs.current = {};

    /**
     * Chart harga sekarang HANYA punya satu pane, selamanya.
     *
     * Pane tambahan dulu dibuat di sini untuk RSI dan MACD. Keduanya sudah pindah ke chart
     * osilator sendiri, jadi pembersihan ini tinggal sebagai penjaga: kalau ada pane yang
     * entah bagaimana tertinggal, ia akan memakan tinggi yang seharusnya milik candle.
     */
    while (chart.panes().length > 1) {
      const extra = chart.panes()[chart.panes().length - 1];
      try {
        chart.removePane(extra.paneIndex());
      } catch {
        break;
      }
    }
    if (candles.length === 0) return;

    const ohlc: Ohlc[] = candles;
    const ind = computeIndicators(ohlc);

    const addOverlay = (
      color: string,
      data: Array<{ time: number; value?: number }>,
      style = LineStyle.Solid
    ) => {
      // Dilewati kalau tidak ada SATU pun titik bernilai, bukan kalau arraynya kosong:
      // `toLineData` kini memancarkan whitespace untuk bar warmup, jadi panjangnya selalu
      // sama dengan jumlah candle dan `length === 0` tidak pernah benar lagi.
      if (!data.some((d) => d.value !== undefined)) return null;
      const s = chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        lineStyle: style,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      s.setData(data as any);
      return s;
    };

    if (enabled.ema9) overlayRefs.current.ema9 = addOverlay("#38bdf8", toLineData(ohlc, ind.ema9));
    if (enabled.ema21) overlayRefs.current.ema21 = addOverlay("#a78bfa", toLineData(ohlc, ind.ema21));
    if (enabled.sma50) overlayRefs.current.sma50 = addOverlay("#fbbf24", toLineData(ohlc, ind.sma50));
    if (enabled.vwap) overlayRefs.current.vwap = addOverlay("#f472b6", toLineData(ohlc, ind.vwap), LineStyle.Dashed);
    if (enabled.bollinger) {
      overlayRefs.current.bbU = addOverlay("rgba(148,163,184,0.9)", toLineData(ohlc, ind.bollinger.upper));
      overlayRefs.current.bbM = addOverlay("rgba(148,163,184,0.5)", toLineData(ohlc, ind.bollinger.middle), LineStyle.Dotted);
      overlayRefs.current.bbL = addOverlay("rgba(148,163,184,0.9)", toLineData(ohlc, ind.bollinger.lower));
    }

    /**
     * RSI dan MACD digambar ke `osc`, bukan ke `chart`.
     *
     * Masing-masing tetap mendapat pane sendiri DI DALAM kotak osilator, karena skalanya
     * memang tidak bisa disatukan: RSI terbatas 0..100 sementara MACD berayun di sekitar
     * nol. Yang berubah hanyalah keduanya tidak lagi menumpang di kotak harga.
     */
    const oscPaneIndex = (n: number) => {
      if (!osc) return 0;
      while (osc.panes().length <= n) osc.addPane();
      return osc.panes()[n].paneIndex();
    };
    let nextPane = 0;

    if (enabled.rsi14 && osc) {
      const data = toLineData(ohlc, ind.rsi14);
      if (data.length > 0) {
        const idx = oscPaneIndex(nextPane++);
        const s = osc.addSeries(
          LineSeries,
          { color: "#22d3ee", lineWidth: 1, priceLineVisible: false, priceFormat: { type: "price", precision: 1, minMove: 0.1 } },
          idx
        );
        s.setData(data as any);
        // 70/30 are the conventional bands; drawn as price lines so they scroll with
        // the series instead of being painted at a fixed pixel height.
        s.createPriceLine({ price: 70, color: "rgba(244,63,94,0.5)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "70" });
        s.createPriceLine({ price: 30, color: "rgba(16,185,129,0.5)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "30" });
        paneRefs.current.rsi14 = s;
      }
    }

    if (enabled.macd && osc) {
      const histData = toLineData(ohlc, ind.macd.histogram);
      if (histData.length > 0) {
        const idx = oscPaneIndex(nextPane++);
        const hist = osc.addSeries(
          HistogramSeries,
          // MACD of a 1e-9 price is itself around 1e-11, so the same reasoning as the
          // candle series applies to this axis.
          { priceFormat: { type: "custom", formatter: (p: number) => formatSmallNumber(p), minMove: 1e-14 } },
          idx
        );
        hist.setData(
          histData.map((d) =>
            // Titik whitespace (bar warmup) diteruskan tanpa `value` dan tanpa warna.
            // Memberinya 0 akan menggambar batang nol yang terbaca sebagai "MACD memang
            // nol di sini", padahal artinya belum bisa dihitung.
            d.value === undefined
              ? { time: d.time as any }
              : {
                  time: d.time as any,
                  value: d.value,
                  color: d.value >= 0 ? "rgba(16,185,129,0.55)" : "rgba(244,63,94,0.55)",
                }
          ) as any
        );
        const macdLine = osc.addSeries(
          LineSeries,
          { color: "#38bdf8", lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
          idx
        );
        macdLine.setData(toLineData(ohlc, ind.macd.macd) as any);
        const signalLine = osc.addSeries(
          LineSeries,
          { color: "#fbbf24", lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
          idx
        );
        signalLine.setData(toLineData(ohlc, ind.macd.signal) as any);
        paneRefs.current.macdHist = hist;
        paneRefs.current.macdLine = macdLine;
        paneRefs.current.macdSignal = signalLine;
      }
    }
  };

  // Data refresh. `setData` replaces the whole series, so ordering is always valid.
  useEffect(() => {
    // Tunggu `?tf=` selesai dibaca, kalau tidak permintaan pertama memakai bucket bawaan
    // 60 dan bukan yang diminta tautannya.
    if (!tfResolved) return;
    let cancelled = false;

    /**
     * Mengembalikan jumlah trade yang dilaporkan server, atau null kalau pengambilannya
     * gagal. Pengejar pasca-trade memakai nilai itu sebagai syarat berhenti — tanpa nilai
     * balik, satu-satunya cara berhenti adalah menebak dengan jeda tetap, dan menebak
     * itulah yang membuat pembelian pertama tidak pernah tampil.
     */
    async function load(): Promise<number | null> {
      try {
        const res = await fetch(
          `/api/agent/telemetry?symbol=${encodeURIComponent(symbol)}&chainId=${chainId}&bucket=${interval}`
        );
        if (!res.ok) return null;
        const data = await res.json();
        if (cancelled) return null;

        let candles: Candle[] = Array.isArray(data.candles) ? data.candles : [];
        /**
         * Rentang menyesuaikan lebar barnya dengan riwayat yang BENAR-BENAR ada.
         *
         * Lebar awal dipilih dari umur sejak peluncuran, karena itu satu-satunya yang diketahui
         * sebelum data datang. Tapi riwayat harga dimulai di perdagangan pertama, dan keduanya
         * bisa berjarak jauh: $ADEXTO berumur 23 hari, perdagangan pertamanya 5,5 hari lalu. Bar
         * 4 jam untuk 5,5 hari hanya 33 candle gemuk; bar 1 jam memberi 132 yang terbaca.
         *
         * Hanya BOLEH menyempit (`want < interval`), jadi ini selalu berhenti setelah satu
         * langkah: perdagangan pertama tidak bergeser karena lebar bar berubah.
         */
        if (range && candles.length > 0) {
          const spanDef = RANGES.find((r) => r.label === range)?.seconds ?? Number.POSITIVE_INFINITY;
          const firstT = Math.min(...candles.map((c) => c.time));
          const dataSpan = Math.max(3600, Math.floor(Date.now() / 1000) - firstT);
          const want = autoBucket(Math.min(spanDef, dataSpan));
          if (want < interval) {
            // Efek ini dibangun ulang dengan lebar baru dan memuat sendiri; hitungan trade
            // tetap dikembalikan supaya pengejar pasca-trade punya syarat berhenti.
            setIntervalSeconds(want);
            return Number(data.totalTrades || 0);
          }
        }
        // Rentang "1y" memotong apa pun yang lebih tua dari setahun.
        if (range) {
          const spanDef = RANGES.find((r) => r.label === range)?.seconds ?? Number.POSITIVE_INFINITY;
          if (Number.isFinite(spanDef)) {
            const from = Math.floor(Date.now() / 1000) - spanDef;
            candles = candles.filter((c) => c.time >= from);
          }
        }
        /**
         * Tidak ada bar sebelum peluncuran, dari sumber mana pun.
         *
         * Riwayat tersimpan dikunci per ticker, jadi catatan pasar LAMA dengan ticker yang sama
         * bisa ikut terbawa. Bar yang mendahului transaksi peluncuran pasti bukan milik pasar ini.
         */
        if (launchedAt && launchedAt > 0) {
          const launchBucket = Math.floor(launchedAt / interval) * interval;
          candles = candles.filter((c) => c.time >= launchBucket);
        }
        const totalTrades = Number(data.totalTrades || 0);

        /**
         * Konversi ke dolar memakai kurs yang DIREKAM, bukan kurs sekarang.
         *
         * Alasannya ada di `src/lib/usd-series.ts`. Yang penting di sini: kalau rekamannya
         * belum cukup untuk menutupi seri ini, tampilannya JATUH ke native dan mengatakan
         * kenapa — bukan menggambar dolar dari kurs yang salah zaman.
         */
        // Tidak lagi mensyaratkan `candles.length > 0`: syarat itulah yang membuat pasar tanpa
        // fill menampilkan pane kosong, dan itu berlaku untuk SEMUA pasar baru, bukan satu.
        if (unit === "usd") {
          try {
            const fxRes = await fetch(`/api/fx-history?symbol=${encodeURIComponent(nativeSymbol)}`);
            const fx = fxRes.ok ? await fxRes.json() : null;
            const points: Array<[number, number]> = Array.isArray(fx?.points) ? fx.points : [];
            const converted = toUsdCandles(candles, points, interval, undefined, 600, fallbackPriceNative, launchedAt ?? 0);
            if (converted.candles.length === 0) {
              // Tidak ada kurs terekam untuk rentang ini: sumbu tetap native. Tidak ada
              // kalimat di layar — satuan yang tampil sudah menyatakannya.
            } else {
              candles = converted.candles;
            }
          } catch {
            // Riwayat kurs tidak terbaca: sumbu tetap native, tanpa kalimat tambahan.
          }
        }

        /**
         * Pasar yang belum pernah ditradingkan tetap punya chart sejak ia lahir.
         *
         * Kurva memberi harga sejak transaksi peluncuran, jadi yang digambar adalah harga itu,
         * datar dan bervolume nol, dari peluncuran sampai sekarang. Sumbu USD sudah melakukannya
         * lewat `toUsdCandles`; ini menutup sumbu native dan kasus kurs tidak terbaca.
         */
        if (candles.length === 0 && launchedAt && launchedAt > 0) {
          candles = flatSinceLaunch(launchedAt, fallbackPriceNative, interval);
        }

        setSource(String(data.source || ""));
        setTradeCount(totalTrades);
        tradeCountRef.current = totalTrades;
        setCandleCount(candles.length);

        if (candles.length > 0 && candleSeriesRef.current) {
          /**
           * Nilai diskalakan SEKALI di sini, lalu yang terskala itulah yang disimpan.
           *
           * `candlesRef` dibaca oleh autoscaleInfoProvider (untuk membatasi porsi badan
           * candle), oleh drawIndicators, dan oleh legenda OHLC. Kalau yang disimpan nilai
           * mentah sementara sumbu memakai kapitalisasi, ketiganya bekerja pada satuan yang
           * berbeda dari yang tergambar: batas porsi badan membandingkan angka mentah
           * dengan rentang terskala, dan overlay EMA digambar di satuan yang salah. Jadi
           * satu titik konversi, bukan tiga.
           */
          const mul = priceMultiplier;
          const sorted = [...candles]
            .sort((a, b) => a.time - b.time)
            .map((c) =>
              mul === 1
                ? c
                : { ...c, open: c.open * mul, high: c.high * mul, low: c.low * mul, close: c.close * mul }
            );
          candlesRef.current = sorted;

          /**
           * Presisi sumbu dihitung dari rentang nyata seri ini.
           *
           * Dibutuhkan digit yang cukup untuk MEMBEDAKAN high dari low; kalau tidak,
           * setiap label sumbu mencetak angka yang sama dan chart tampak macet padahal
           * candle-nya bergerak. Ditambah dua digit sebagai kelonggaran, lalu dibatasi
           * 4..12: di bawah 4 tidak informatif, di atas 12 sudah melewati presisi ganda
           * dan hanya memanjangkan label.
           */
          const lo = Math.min(...sorted.map((c) => c.low));
          const hi = Math.max(...sorted.map((c) => c.high));
          const relSpan = hi > 0 ? (hi - lo) / hi : 0;
          sigDigitsRef.current =
            relSpan > 0 ? Math.min(12, Math.max(4, Math.ceil(-Math.log10(relSpan)) + 2)) : 4;
          /**
           * Format sumbu ikut mode. Kapitalisasi berada di orde puluhan ribu native,
           * jadi notasi subscript untuk angka sangat kecil justru tidak terbaca di sana —
           * dipakai notasi ringkas (20,5K) seperti terminal lain menampilkan mcap.
           */
          candleSeriesRef.current.applyOptions({
            priceFormat: {
              type: "custom",
              formatter: (p: number) =>
                showMcap ? compactNumber(p) : formatSmallNumber(p, sigDigitsRef.current),
              minMove: showMcap ? 0.01 : 1e-12,
            },
          });
          candleSeriesRef.current.setData(
            sorted.map((c) => ({ time: c.time as any, open: c.open, high: c.high, low: c.low, close: c.close }))
          );
          lineSeriesRef.current?.setData(
            sorted.map((c) => ({ time: c.time as any, value: c.close }))
          );
          lineSeriesRef.current?.applyOptions({
            visible: chartKind === "line",
            priceFormat: {
              type: "custom",
              formatter: (p: number) =>
                showMcap ? compactNumber(p) : formatSmallNumber(p, sigDigitsRef.current),
              minMove: showMcap ? 0.01 : 1e-12,
            },
          });
          candleSeriesRef.current.applyOptions({ visible: chartKind === "candles" });
          volumeSeriesRef.current?.setData(
            sorted.map((c) => ({
              time: c.time as any,
              value: c.volume,
              color: c.close >= c.open ? "rgba(16,185,129,0.35)" : "rgba(244,63,94,0.35)",
            }))
          );
          drawIndicators(sorted);
          setLegend(sorted[sorted.length - 1]);

          /**
           * Tanda perdagangan: milik dompet yang tersambung (B/S) dan milik peluncur (DEV).
           *
           * Satu tanda per bar per jenis per arah, dengan hitungan bila lebih dari satu —
           * sepuluh panah bertumpuk di satu bar tidak terbaca. Hanya bar yang ADA di seri yang
           * ditandai: tanda untuk waktu tanpa bar akan ditaruh pustaka di bar terdekat dan
           * menyatakan perdagangan terjadi pada waktu yang salah.
           *
           * Dompet sebuah perdagangan adalah penerima token untuk beli dan penjual untuk jual
           * (`tradeWallet`), jadi pembelian lewat relai x402 ditandai milik pembelinya.
           */
          const meL = (me || "").toLowerCase();
          const devL = (creator || "").toLowerCase();
          const barTimes = new Set(sorted.map((c) => c.time));
          const groups = new Map<string, { time: number; kind: "me" | "dev"; buy: boolean; n: number }>();
          if (showMarks && (meL || devL) && Array.isArray(data.trades)) {
            for (const t of data.trades as Array<{ type: string; timestamp: string; trader: string; recipient?: string | null }>) {
              if (t.type !== "BUY" && t.type !== "SELL") continue;
              const wallet = tradeWallet(t);
              const kind = meL && wallet === meL ? "me" : devL && wallet === devL ? "dev" : null;
              if (!kind) continue;
              const seconds = Math.floor(Date.parse(t.timestamp) / 1000);
              if (!Number.isFinite(seconds)) continue;
              const time = Math.floor(seconds / interval) * interval;
              if (!barTimes.has(time)) continue;
              const buy = t.type === "BUY";
              const key = `${time}:${kind}:${buy}`;
              const g = groups.get(key);
              if (g) g.n += 1;
              else groups.set(key, { time, kind, buy, n: 1 });
            }
          }
          const marks: SeriesMarker<Time>[] = [...groups.values()]
            .sort((a, b) => a.time - b.time)
            .map((g) => ({
              time: g.time as Time,
              position: g.buy ? "belowBar" : "aboveBar",
              shape: g.buy ? "arrowUp" : "arrowDown",
              color: g.kind === "me" ? (g.buy ? MARK_COLORS.meBuy : MARK_COLORS.meSell) : g.buy ? MARK_COLORS.devBuy : MARK_COLORS.devSell,
              // Label satu huruf: pada bar yang berdekatan label panjang ("DEV B ×4") saling
              // menimpa dan tidak terbaca. Arah panah dan warna sudah menyatakan beli/jual dan
              // milik siapa; "D" = peluncur.
              text: g.kind === "me" ? (g.buy ? "B" : "S") : "D",
            }));
          candleMarksRef.current?.setMarkers(marks);
          lineMarksRef.current?.setMarkers(marks);
          setMarkSummary({
            me: [...groups.values()].filter((g) => g.kind === "me").reduce((s, g) => s + g.n, 0),
            dev: [...groups.values()].filter((g) => g.kind === "dev").reduce((s, g) => s + g.n, 0),
            bars: marks.length,
          });

          /**
           * `unit` WAJIB ikut di kunci ini.
           *
           * Satuan mengubah JUMLAH bar, bukan hanya angkanya: seri USD diisi kurs sampai
           * sekarang (ratusan bar), seri native hanya bar di sekitar perdagangan (sering tiga).
           * Tanpa `unit` di sini, berganti USD -> native tidak memasang ulang jendela, jadi
           * jendela tetap di indeks logis seri USD (mis. 940..1000) sementara bar native ada di
           * 0..2 — pane kosong. Terukur di produksi 2026-10-01 dengan menghitung kolom kanvas
           * yang memuat candle: $ADT 606 kolom di USD, 3 sesudah pindah ke 0G, 16 sesudah balik
           * ke USD. Arah balik ikut rusak karena jendela native (0..16) terbawa ke seri USD.
           * `showMcap` dan `chartKind` sengaja tidak ikut: keduanya tidak mengubah jumlah bar.
           */
          const fitKey = `${symbol}:${chainId}:${interval}:${range ?? ""}:${unit}`;
          if (range && fittedFor.current !== fitKey) {
            /**
             * Rentang memperlihatkan SELURUH isinya — dan itu aman di sini, tidak di tempat lain.
             *
             * `fitContent()` dilarang untuk lebar bar biasa (lihat penjaga di audit_consistency):
             * riwayatnya tak terbatas, jadi memerasnya ke satu pane membuat candle mengecil setiap
             * hari. Rentang berbeda karena jumlah barnya DIBATASI oleh konstruksinya sendiri —
             * `autoBucket` melebarkan bar seiring pasar menua sehingga jumlahnya tidak pernah
             * melewati `RANGE_TARGET_BARS`. Lebar candle karena itu punya batas bawah yang tetap.
             */
            chartRef.current?.timeScale().setVisibleLogicalRange({ from: -0.5, to: sorted.length - 0.5 });
            fittedFor.current = fitKey;
          }
          if (fittedFor.current !== fitKey) {
            /**
             * SATU aturan, bukan dua mode. Jendela selalu selebar `slots`, yang dihitung
             * dari `BAR_SPACING`, jadi lebarnya identik di semua token dan timeframe.
             *
             * Yang berbeda hanya JANGKARNYA, dan itu bukan mode terpisah karena lebar
             * jendelanya tetap sama:
             *
             * - Pasar yang riwayatnya belum mengisi jendela dijangkarkan ke KIRI. Tidak
             *   ada harga sebelum peluncuran, jadi ruang kosong harus jatuh di kanan.
             *   `from: 0` dan bukan nilai negatif, karena slot kosong sebelum bar pertama
             *   menyiratkan riwayat yang tidak pernah ada.
             * - Pasar yang riwayatnya melebihi jendela dijangkarkan ke KANAN, supaya yang
             *   terlihat lebih dulu adalah perdagangan terbaru. Bar yang lebih tua tetap
             *   ada di seri dan bisa digeser ke kiri.
             *
             * Pada titik peralihan keduanya menghasilkan jendela yang sama persis, jadi
             * tidak ada lompatan ukuran saat sebuah pasar tumbuh melewatinya.
             */
            /**
             * Jumlah slot diturunkan dari LEBAR PIKSEL yang dipilih, dan tepi kanan
             * dijangkarkan ke bar terakhir yang PUNYA VOLUME.
             *
             * Dua hal yang keduanya terukur, bukan preferensi:
             *
             * - `timeScale.barSpacing` tidak bisa dipakai untuk ini. Terukur dari
             *   instrumen di browser: chart berakhir pada 6,0158 (bawaan pustaka)
             *   walaupun 12 yang disetel, karena rentang logis yang menang. Jadi lebar
             *   bar dikendalikan lewat jumlah slot: `lebar area gambar / BAR_SPACING`.
             *
             * - Menjangkar ke bar TERAKHIR salah pada pasar yang sedang sepi. Ekor bar
             *   datar sesudah perdagangan terakhir memang ada (dibatasi di
             *   `buildCandles`), jadi jendela yang berakhir di bar terakhir bisa berisi
             *   bar datar saja. Terukur: $ADEXTO di 1h menjadi chart kosong sama sekali,
             *   satu garis lurus tanpa satu pun candle terlihat.
             *
             * Karena itu tepi kanannya bar berisi terakhir ditambah sedikit ruang, jadi
             * jeda terbaru tetap kelihatan tanpa mengusir datanya keluar layar.
             */
            const drawable = Math.max(
              120,
              (containerRef.current?.clientWidth ?? 600) - PRICE_AXIS_WIDTH
            );
            const slots = Math.max(8, Math.round(drawable / BAR_SPACING));

            /**
             * Jangkarnya UJUNG SERI, bukan bar perdagangan terakhir.
             *
             * Aturan lama menjangkar ke bar bervolume terakhir, dan itu benar selama seri
             * berhenti di situ. Sejak sumbu USD membawa seri maju dengan kurs, perdagangan
             * terakhir bisa berada ratusan bar di belakang — dan menjangkar ke sana berarti
             * jendela memperlihatkan belasan bar pertama sementara seluruh bagian yang
             * bergerak ada di luar layar. Gejalanya persis yang dikeluhkan: pada 1s sampai
             * 15m zoom-nya kacau dan candle-nya raksasa.
             *
             * Ujung seri selalu "sekarang", jadi satu aturan ini benar di semua timeframe,
             * dengan atau tanpa perdagangan baru.
             */
            const anchor = sorted.length;

            /**
             * Jendela DIPERSEMPIT ke datanya kalau barnya lebih sedikit dari slot yang
             * tersedia, jadi lebar bar punya BATAS BAWAH, bukan nilai tetap.
             *
             * Memakai seluruh `slots` pada pasar yang barnya sedikit menyisakan pane
             * hampir kosong: terukur pada $PARCEL 15 menit, 12 bar di dalam 63 slot berarti
             * 81% pane kosong dengan candle menempel di tepi kiri. Itu terbaca sebagai
             * chart rusak, bukan sebagai pasar muda.
             *
             * `MIN_SLOTS` menjaga ujung sebaliknya: satu pasar dengan dua bar tidak boleh
             * menjadi dua balok selebar setengah pane. Jadi lebar bar bergerak di antara
             * `BAR_SPACING` (riwayat panjang) dan `lebar / MIN_SLOTS` (riwayat pendek), dan
             * tidak pernah lebih kecil dari yang pertama — yang justru keluhannya.
             */
            const MIN_SLOTS = 16;
            /**
             * Di satuan USD jendelanya DILEBARKAN sampai mencakup beberapa jam.
             *
             * Diukur: pada 1m, jendela selebar `slots` (~55 bar = 55 menit) menggambar seri
             * yang benar-benar rata — 305 piksel candle, 0% tinggi pane — sementara 5m ke atas
             * memakai 39%. Sebabnya bukan gambarnya: kurs native hanya bergerak berarti dalam
             * puluhan menit, jadi jendela 55 menit memang nyaris tanpa perubahan. Melebarkan
             * jendela memperlihatkan gerakan yang sudah ada di data, bukan menambah data.
             *
             * Hanya berlaku saat kurs yang menggerakkan seri. Di satuan native, lebar jendela
             * tetap seperti semula supaya perdagangan per detik tetap bisa dibaca.
             */
            const MIN_USD_SPAN_SECONDS = 4 * 3600;
            const wantBars =
              unit === "usd" ? Math.ceil(MIN_USD_SPAN_SECONDS / interval) : 0;
            const used = Math.max(
              MIN_SLOTS,
              Math.min(sorted.length, Math.max(Math.min(slots, Math.ceil(anchor * 1.25)), wantBars))
            );
            chartRef.current
              ?.timeScale()
              .setVisibleLogicalRange(
                anchor <= used ? { from: 0, to: used } : { from: anchor - used, to: anchor }
              );
            fittedFor.current = fitKey;
          }
        } else {
          candlesRef.current = [];
          setLegend(null);
        }

        /**
         * The header reads the API's numbers instead of recomputing them from the
         * candles.
         *
         * It used to derive the price from `last.close` and the change from
         * `first.open`, which made this component a third, independent definition of
         * "the price" alongside the API and the on-chain spot price in the trade
         * panel — and it inherited any candle bug directly into the headline figure.
         * The API now reports the curve's post-trade spot price and measures change
         * from the launch price, so there is one definition and the panel agrees
         * with it.
         */
        if (Number.isFinite(data.priceNative) && data.priceNative > 0) {
          setPriceNative(data.priceNative);
          setChangePct(Number(data.changePct) || 0);
        }
        return totalTrades;
      } catch {
        // leave the last rendered state in place
        return null;
      }
    }

    load();
    const timer = setInterval(load, 15000);

    /**
     * Setelah trade terkonfirmasi, chart MENGEJAR sampai fill barunya benar-benar terlihat.
     *
     * Versi sebelumnya hanya satu percobaan ulang di 2,5 detik, dan itu tidak cukup. `txHash`
     * ditetapkan setelah receipt diparse, jadi bloknya memang sudah ada — tetapi endpoint
     * ini membaca log lewat node RPC yang bisa tertinggal beberapa detik dari blok terbaru,
     * terutama di belakang load-balancer yang mengarahkan dua permintaan ke dua node
     * berbeda. Kalau percobaan pertama DAN percobaan 2,5 detik itu sama-sama mengenai node
     * yang belum menyusul, chart diam sampai polling 15 detik berikutnya.
     *
     * Itu bukan cacat teoretis: pada rekaman ADX, pembelian sudah selesai dan panel swap
     * sudah menulis "Received 195.2634 ADX" sementara chart masih menyatakan "no trade
     * history" dengan nol bar. Yang terekam justru terminal kosong tepat setelah pembelian.
     *
     * Jadi yang dipakai bukan jeda tetap melainkan SYARAT SELESAI: ulangi tiap 1,2 detik
     * sampai jumlah trade yang dilaporkan server melewati jumlah sebelum trade ini, maksimum
     * 10 percobaan (~12 detik) supaya tidak ada loop tak berujung kalau node benar-benar
     * bermasalah. Begitu fill-nya terlihat, pengejaran berhenti — jadi pada keadaan normal
     * hanya satu atau dua permintaan tambahan yang terjadi.
     */
    let chase: ReturnType<typeof setInterval> | null = null;
    if (refreshKey) {
      const baseline = tradeCountRef.current;
      let tries = 0;
      chase = setInterval(async () => {
        tries += 1;
        const seen = await load();
        if (cancelled || (seen ?? 0) > baseline || tries >= 10) {
          if (chase) clearInterval(chase);
          chase = null;
        }
      }, 1200);
    }

    return () => {
      cancelled = true;
      clearInterval(timer);
      if (chase) clearInterval(chase);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `showMcap` ikut di sini karena mengubahnya mengubah SATUAN data, jadi seri harus
    // dipasang ulang. Tanpa itu, sumbu berganti label sementara candle-nya masih memakai
    // satuan lama — kesalahan yang tidak akan terlihat sebagai error, hanya sebagai angka
    // yang salah.
  }, [tfResolved, symbol, chainId, interval, range, refreshKey, showMcap, unit, chartKind, nativeSymbol, me, creator, showMarks]);

  // Redraw on a toggle without waiting for the next poll.
  useEffect(() => {
    if (candlesRef.current.length > 0) drawIndicators(candlesRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledKey]);

  const priceUsd = priceNative * (nativeUsd || 0);
  /** Apakah interval terpilih berada di bawah satu menit, supaya tombolnya bisa menyebutnya. */
  const subMinuteActive = INTERVALS.some((i) => i.sub && i.seconds === interval);
  const changeIsUp = changePct >= 0;

  /**
   * Persentase yang tidak pernah membulatkan perubahan nyata menjadi nol.
   *
   * `changePct.toFixed(2)` menulis "+0.00%" untuk kenaikan +0,00016% — dan justru
   * ANGKA ITU yang dulu dipakai sebagai alasan membutakan chart: "chart menampilkan
   * gerakan sementara header menulis +0.00%, jadi chart-nya salah". Ternyata yang salah
   * headernya. Sekarang keduanya membaca data yang sama, jadi tidak ada lagi yang
   * membantah siapa.
   *
   * Di atas 0,01% dua desimal sudah cukup dan tetap dipakai supaya tampilan normal tidak
   * berubah. Di bawah itu, dipakai dua digit signifikan supaya angkanya tetap terbaca
   * alih-alih hilang jadi nol.
   */
  const formatPct = (p: number) => {
    if (!Number.isFinite(p) || p === 0) return "0.00";
    if (Math.abs(p) >= 0.01) return p.toFixed(2);
    return Number(p.toPrecision(2)).toString();
  };

  /**
   * Which enabled indicators cannot draw yet, and how many bars they still need.
   * Stated plainly rather than leaving the user to wonder why a line is missing.
   */
  const warmingUp = useMemo(() => {
    const all = [...OVERLAYS, ...PANES];
    return all
      .filter((i) => enabled[i.key as IndicatorKey] && candleCount < (WARMUP[i.warmupKey] ?? 1))
      .map((i) => `${i.label} needs ${(WARMUP[i.warmupKey] ?? 1) - candleCount} more`);
  }, [enabled, candleCount]);

  // Kata "seed" dihindari di label ini: di produk ini kata itu dulu berarti
  // setoran likuiditas yang sudah ditiadakan, jadi memakainya untuk sumber data
  // placeholder membuat pembaca menyangka kurvanya disetori.
  const sourceLabel =
    source === "onchain"
      ? "on-chain Swap events"
      : source === "agent"
      ? "agent-reported fills"
      : source === "genesis"
      ? "genesis reference price (no market fills yet)"
      : "no trade history";

  const toggle = (key: IndicatorKey) => setEnabled((p) => ({ ...p, [key]: !p[key] }));
  const activeCount = Object.values(enabled).filter(Boolean).length;

  return (
    <div className="w-full flex flex-col h-full justify-between">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-1 border-b border-line shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-base font-semibold tracking-tight text-ink sm:text-lg">
            <span>
              ${symbol}/{nativeSymbol}
            </span>
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded border ${
                changeIsUp
                  ? "text-ok bg-ok/10 border-ok/30"
                  : "text-danger bg-danger/10 border-danger/30"
              }`}
            >
              {changeIsUp ? "+" : ""}
              {formatPct(changePct)}%
            </span>
          </div>
          <span className="text-xs font-semibold text-accent sm:text-sm" data-numeric>
            {priceNative > 0 ? formatSmallNumber(priceNative) : "—"} {nativeSymbol}
          </span>
          {priceUsd > 0 && (
            <span className="text-[11px] text-ink-soft" data-numeric>
              ≈ ${priceUsd < 0.01 ? priceUsd.toFixed(6) : priceUsd.toFixed(4)}
            </span>
          )}
          {/* Kurs yang dipakai untuk angka USD di sebelahnya, dinyatakan.
              Candle-nya digambar dalam satuan native, jadi harga USD di atas bergerak dua
              sebab: fill baru, DAN {nativeSymbol} yang bergerak terhadap dolar. Tanpa kurs
              yang tertulis, sebab kedua terlihat seperti chart yang berselisih dengan
              headernya. Angkanya disegarkan tiap 15 detik oleh halaman ini. */}
          {nativeUsd > 0 && (
            <span
              className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-faint"
              title={`USD figures on this chart use 1 ${nativeSymbol} = $${nativeUsd}, refreshed every 15 seconds. The candles themselves are priced in ${nativeSymbol}.`}
              data-numeric
            >
              {nativeSymbol} ${nativeUsd < 1 ? nativeUsd.toFixed(4) : nativeUsd.toFixed(2)}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1 text-[11px]">
          {/* Satuan sumbu: dolar, atau aset native chain. */}
          <div className="mr-1 flex items-center overflow-hidden rounded border border-line">
            {(
              [
                ["USD", "usd"],
                [nativeSymbol, "native"],
              ] as const
            ).map(([label, value]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setUnit(value);
                  // Kalau sedang di bucket sub-menit, naikkan ke 1m: di USD bucket itu tidak
                  // bisa memuat perubahan, jadi membiarkannya berarti menampilkan pane rata.
                  if (value === "usd" && interval < 60) {
                    setIntervalSeconds(60);
                    setShowSubMinute(false);
                  }
                }}
                aria-pressed={unit === value}
                title={
                  value === "usd"
                    ? `Price in dollars, converted with recorded ${nativeSymbol}/USD rates. In this unit the market keeps moving when ${nativeSymbol} moves, even with no trades.`
                    : `Price in ${nativeSymbol}, exactly as the curve prices it`
                }
                className={`px-2 py-0.5 font-bold transition-colors ${
                  unit === value ? "bg-accent-soft text-accent" : "bg-cream-3 text-ink-soft hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Bentuk: candle, atau garis penutupan. */}
          <div className="mr-1 flex items-center overflow-hidden rounded border border-line">
            {(
              [
                ["Candles", "candles", ChartCandlestick],
                ["Line", "line", LineChart],
              ] as const
            ).map(([label, value, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => setChartKind(value)}
                aria-pressed={chartKind === value}
                aria-label={`${label} chart`}
                title={`${label} chart`}
                className={`px-2 py-1 transition-colors ${
                  chartKind === value ? "bg-accent-soft text-accent" : "bg-cream-3 text-ink-soft hover:text-ink"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>

          {/* Sumbu: harga per token, atau kapitalisasi. */}
          <div className="mr-1 flex items-center overflow-hidden rounded border border-line">
            {[
              { label: "Price", on: !showMcap, set: false },
              { label: "MCAP", on: showMcap, set: true },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                onClick={() => setShowMcap(o.set)}
                title={
                  o.set
                    ? "Chart the market cap: price x supply. 100% of supply is in the curve, so this equals FDV."
                    : "Chart the price of one token"
                }
                className={`px-2 py-0.5 font-bold transition-colors ${
                  o.on ? "bg-accent-soft text-accent" : "bg-cream-3 text-ink-soft hover:text-ink"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {/* Interval di bawah satu menit DILIPAT.
              Barnya dulu menggambar kesebelas interval sejajar, dan tiga di antaranya —
              1s, 5s, 15s — adalah yang paling jarang dipakai sekaligus yang paling
              menuntut ruang di baris paling padat di halaman ini. Menit ke atas tetap
              terlihat langsung, termasuk 1m yang merupakan bawaan; sub-menit pindah ke
              satu tombol "s" dengan tanda kalau salah satunya sedang aktif. */}
          {/* Sub-menit HANYA di satuan native.
              Kurs direkam paling rapat sekali per menit, jadi di satuan USD bucket 1s/5s/15s
              tidak mungkin memuat perubahan apa pun — yang tergambar selalu garis rata, dan itu
              terbaca sebagai chart rusak. Tombolnya disembunyikan alih-alih dibiarkan
              menghasilkan tampilan yang pasti kosong. */}
          <div className={`relative ${unit === "usd" ? "hidden" : ""}`}>
            <button
              type="button"
              onClick={() => setShowSubMinute((v) => !v)}
              aria-expanded={showSubMinute}
              aria-haspopup="true"
              aria-label="Sub-minute timeframes"
              title="Timeframes under one minute"
              className={`px-2 py-0.5 rounded font-bold border transition-colors ${
                subMinuteActive || showSubMinute
                  ? "bg-accent-soft text-accent border-accent/30"
                  : "bg-cream-3 text-ink-soft border-transparent hover:text-ink"
              }`}
            >
              {subMinuteActive ? INTERVALS.find((i) => i.seconds === interval)?.label : "s"}
            </button>
            {showSubMinute && (
              <div className="absolute left-0 top-full z-30 mt-1 flex gap-1 rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-panel)]">
                {INTERVALS.filter((i) => i.sub).map((i) => (
                  <button
                    key={i.label}
                    type="button"
                    onClick={() => {
                      setRange(null);
                      setIntervalSeconds(i.seconds);
                      setShowSubMinute(false);
                    }}
                    className={`rounded px-2 py-0.5 font-bold transition-colors ${
                      interval === i.seconds ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-cream-3 hover:text-ink"
                    }`}
                  >
                    {i.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {INTERVALS.filter((i) => !i.sub).map((i) => (
            <button
              key={i.label}
              type="button"
              onClick={() => {
                setRange(null);
                setIntervalSeconds(i.seconds);
              }}
              aria-pressed={!range && interval === i.seconds}
              className={`px-2 py-0.5 rounded font-bold border transition-colors ${
                !range && interval === i.seconds
                  ? "bg-accent-soft text-accent border-accent/30"
                  : "bg-cream-3 text-ink-soft border-transparent hover:text-ink"
              }`}
            >
              {i.label}
            </button>
          ))}
          {/* Rentang, dipisah garis tipis dari lebar bar: keduanya menjawab pertanyaan berbeda
              ("seberapa jauh ke belakang" vs "seberapa lebar tiap candle"), dan meletakkannya
              sejajar tanpa pemisah membuat 1y terbaca sebagai candle setahun. */}
          <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-line-strong" />
          {RANGES.map((r) => {
            const nowSec = Math.floor(Date.now() / 1000);
            /**
             * Umur sejak PELUNCURAN, dari registry — bukan dari bar yang kebetulan termuat.
             *
             * Versi pertama menebaknya dari bar pertama yang dikirim endpoint, dan itu salah
             * secara halus: pada bar 1 menit endpoint hanya menjangkau 240 menit, jadi "All"
             * akan menganggap pasar berumur 23 hari itu berumur 4 jam dan menampilkan 4 jam
             * terakhir saja. Kurva memberi harga sejak transaksi peluncuran, jadi tanggal itulah
             * awal riwayat harga yang sebenarnya.
             */
            const age = launchedAt ? Math.max(3600, nowSec - launchedAt) : 30 * 86400;
            const span = Math.min(r.seconds, age);
            const bucket = autoBucket(span);
            return (
              <button
                key={r.label}
                type="button"
                onClick={() => {
                  setRange(r.label);
                  setIntervalSeconds(bucket);
                }}
                aria-pressed={range === r.label}
                title={
                  r.label === "All"
                    ? "The whole history, from the first trade (or from launch before any trade), with the candle width picked to fit"
                    : "The last 365 days, or since launch for a younger market, with the candle width picked to fit"
                }
                className={`px-2 py-0.5 rounded font-bold border transition-colors ${
                  range === r.label
                    ? "bg-accent-soft text-accent border-accent/30"
                    : "bg-cream-3 text-ink-soft border-transparent hover:text-ink"
                }`}
              >
                {r.label}
              </button>
            );
          })}

          {/* Tanda perdagangan milik sendiri (B/S) dan milik peluncur (DEV). */}
          <button
            type="button"
            onClick={() => setShowMarks((v) => !v)}
            aria-pressed={showMarks}
            title={
              me
                ? "Mark your trades (B/S) and the creator's trades (D) on the chart"
                : "Mark the creator's trades (D) on the chart. Connect a wallet to mark yours too"
            }
            className={`ml-1 px-2 py-0.5 rounded font-bold border transition-colors ${
              showMarks
                ? "bg-accent-soft text-accent border-accent/30"
                : "bg-cream-3 text-ink-soft border-transparent hover:text-ink"
            }`}
          >
            Marks
          </button>

          <div className="relative ml-1">
            <button
              type="button"
              onClick={() => setShowIndicatorMenu((v) => !v)}
              aria-expanded={showIndicatorMenu}
              aria-haspopup="true"
              className={`px-2 py-0.5 rounded font-bold border transition-colors ${
                showIndicatorMenu
                  ? "bg-accent-soft text-accent border-accent/30"
                  : "bg-cream-3 text-ink-soft border-transparent hover:text-ink"
              }`}
            >
              Indicators{activeCount > 0 ? ` (${activeCount})` : ""}
            </button>
            {showIndicatorMenu && (
              <div className="absolute right-0 top-full mt-1 z-30 w-56 rounded-xl border border-line bg-surface p-2 shadow-2xl space-y-0.5">
                <p className="px-1 pb-1 text-[9px] uppercase tracking-wider text-ink-faint">On price</p>
                {OVERLAYS.map((o) => (
                  <label
                    key={o.key}
                    className="flex items-center gap-2 px-1 py-1 rounded hover:bg-cream-3 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={enabled[o.key]}
                      onChange={() => toggle(o.key)}
                      className="accent-accent"
                    />
                    <span className="h-0.5 w-3 rounded" style={{ backgroundColor: o.color }} />
                    <span className="text-[11px] text-ink">{o.label}</span>
                    {candleCount < (WARMUP[o.warmupKey] ?? 1) && (
                      <span className="ml-auto text-[9px] text-warn">needs {WARMUP[o.warmupKey]}</span>
                    )}
                  </label>
                ))}
                <p className="px-1 pt-1.5 pb-1 text-[9px] uppercase tracking-wider text-ink-faint">
                  Separate pane
                </p>
                {PANES.map((p) => (
                  <label
                    key={p.key}
                    className="flex items-center gap-2 px-1 py-1 rounded hover:bg-cream-3 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={enabled[p.key]}
                      onChange={() => toggle(p.key)}
                      className="accent-accent"
                    />
                    <span className="text-[11px] text-ink">{p.label}</span>
                    {candleCount < (WARMUP[p.warmupKey] ?? 1) && (
                      <span className="ml-auto text-[9px] text-warn">needs {WARMUP[p.warmupKey]}</span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* OHLC legend under the crosshair. */}
      {legend && (
        <div className="flex shrink-0 flex-wrap items-center gap-2.5 pb-1 text-[11px] text-ink-soft" data-numeric>
          {(["open", "high", "low", "close"] as const).map((k) => (
            <span key={k}>
              {k[0].toUpperCase()}
              <span className={legend.close >= legend.open ? "text-ok ml-0.5" : "text-danger ml-0.5"}>
                {formatSmallNumber(legend[k])}
              </span>
            </span>
          ))}
          <span>
            Vol<span className="text-accent ml-0.5">{legend.volume.toFixed(4)}</span>
          </span>
        </div>
      )}

      {/* min-h dinaikkan dari 300 ke 460: tinggi chart sekarang dibaca dari kontainer ini,
          jadi kelas inilah yang menentukan seberapa besar terminalnya. */}
      {/* Pembungkus `relative` supaya catatan "No data before …" bisa melayang di atas chart
          tanpa menjadi anak kontainer yang diisi lightweight-charts. Tinggi tetap dibaca dari
          kontainer di dalamnya, yang mengisi pembungkus. */}
      <div className="relative flex w-full flex-1 min-h-[460px] flex-col">
        <div
          ref={containerRef}
          className="w-full flex-1 min-h-[460px] overflow-hidden rounded-xl"
          data-testid="price-chart"
          data-marks-me={markSummary.me}
          data-marks-dev={markSummary.dev}
          data-marks-bars={markSummary.bars}
        />
        {noDataBefore !== null && (
          <div
            className="pointer-events-none absolute left-2 top-2 z-10 max-w-[70%] rounded-md border border-line bg-surface/90 px-2 py-1 text-[11px] leading-snug text-ink-soft"
            data-testid="chart-no-data"
            role="note"
          >
            <span className="font-semibold text-ink">No data before {noDataBefore}.</span> This market launched on
            that day, so {range === "1y" ? "1Y" : "this range"} shows its whole history.
          </div>
        )}
      </div>

      {/**
       * Kotak osilator: TERPISAH dari chart harga, bukan pane di dalamnya.
       *
       * Diberi border dan judul sendiri supaya jelas bahwa angka di dalamnya BUKAN harga.
       * Sumbu waktunya disinkronkan dengan chart di atas, jadi kolom yang sama di kedua
       * kotak selalu bar yang sama.
       *
       * Kotaknya sengaja TANPA padding horizontal: kontainer chart di dalamnya harus
       * selebar chart harga di atas, kalau tidak sumbu waktunya bergeser walau lebar sumbu
       * harganya sudah dipatok sama. Labelnya yang diberi padding sendiri.
       */}
      {hasOscillator && (
        <div className="mt-2 shrink-0 rounded-xl border border-line bg-surface py-2">
          <div className="flex items-center justify-between px-2 pb-1.5 text-[10px] uppercase tracking-wider text-ink-faint">
            <span>{oscillators.map((o) => o.label).join(" · ")}</span>
            {/* Teks TERENDER wajib bahasa Inggris. Versi pertama baris ini berbunyi
                "skala sendiri, bukan harga" — dan `bukan` memang sudah ada di ID_WORDS
                audit_claims, jadi penjaganya akan menangkapnya. Yang gagal prosesnya:
                penjaga itu tidak dijalankan lagi setelah kotak ini ditambahkan. */}
            <span className="normal-case tracking-normal text-ink-faint">own scale, not price</span>
          </div>
          <div ref={oscContainerRef} className="w-full overflow-hidden" />
        </div>
      )}

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 pt-1.5 text-[11px] text-ink-faint">
        <span>
          {/* log / auto di kanan bawah, posisi yang sama dengan terminal rujukan. */}
          <span className="mr-2 inline-flex items-center gap-1 align-middle">
            <button
              type="button"
              onClick={() => setLogScale((v) => !v)}
              aria-pressed={logScale}
              title="Logarithmic price axis: equal vertical distance means equal PERCENTAGE change, so a 0.0002% move and a 2% move finally look different"
              className={`rounded border px-1.5 py-0.5 font-bold transition-colors ${
                logScale ? "border-accent/30 bg-accent-soft text-accent" : "border-line bg-cream-3 text-ink-soft hover:text-ink"
              }`}
            >
              log
            </button>
            <button
              type="button"
              onClick={() => setAutoScale((v) => !v)}
              aria-pressed={autoScale}
              title="Auto-fit the price axis to the data. Turn it off to pan and zoom the axis yourself without it snapping back."
              className={`rounded border px-1.5 py-0.5 font-bold transition-colors ${
                autoScale ? "border-accent/30 bg-accent-soft text-accent" : "border-line bg-cream-3 text-ink-soft hover:text-ink"
              }`}
            >
              auto
            </button>
          </span>
          Source: <span className={source === "onchain" ? "text-ok" : "text-warn"}>{sourceLabel}</span>
          {tradeCount > 0 ? ` · ${tradeCount} fills · ${candleCount} bars` : ""}
          {/* TIDAK ada catatan "recorded rates / no trades" di sini.
              Ia pernah ada, dan itu keliru: kalimat seperti itu menjelaskan cara kerja mesin
              kepada orang yang sedang melihat harga, dan layar ini sudah mengatakan hal yang
              sama dengan angka — toggle satuan menyebut USD, dan `Vol 0.0000` beserta volume
              nol di feed sudah menyatakan tidak ada perdagangan. Menuliskannya lagi dengan
              kata-kata hanya memenuhi baris status.
              Keadaan yang benar-benar perlu diberitahukan adalah ketika sumbu USD TIDAK bisa
              digambar, dan itu ditangani dengan jatuh ke satuan native — yang terlihat dari
              toggle-nya sendiri. */}
        </span>
        {warmingUp.length > 0 ? (
          <span className="text-warn" title="An indicator is only drawn once it has a full window of data.">
            warming up: {warmingUp.join(", ")}
          </span>
        ) : (
          <span className={poolLive ? "text-ok" : "text-warn"}>
            {poolLive ? "pool live" : "pool not tradable"}
          </span>
        )}
      </div>
    </div>
  );
}
