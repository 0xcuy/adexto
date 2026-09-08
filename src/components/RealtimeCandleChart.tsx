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
} from "lightweight-charts";
import { formatSmallNumber } from "@/lib/pricing";
import { computeIndicators, toLineData, WARMUP, type Ohlc } from "@/lib/indicators";

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
  /**
   * Suplai token utuh, dipakai toggle MCAP untuk mengubah sumbu harga menjadi kapitalisasi.
   *
   * Di produk ini kapitalisasi = harga x suplai TANPA catatan kaki: 100% suplai masuk ke
   * kurva sejak peluncuran, tidak ada porsi terkunci dan tidak ada alokasi creator. Jadi
   * MCAP dan FDV bernilai sama, dan menyebutnya "market cap" tidak melebihkan apa pun.
   */
  supply: number;
}

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
  { label: "1s", seconds: 1 },
  { label: "5s", seconds: 5 },
  { label: "15s", seconds: 15 },
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
   * umur pasar, bukan kerusakan, dan `YOUNG_MARKET_SLOTS` sudah menangani tampilannya
   * supaya satu bar tidak diregangkan selebar pane.
   */
  { label: "1d", seconds: 86400 },
  { label: "1y", seconds: 31536000 },
];

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
 * Di bawah jumlah bar ini, jendela waktu DIPATOK dan tidak di-fit.
 *
 * `fitContent()` meregangkan bar yang ada ke seluruh lebar pane. Itu benar untuk
 * riwayat yang panjang, tapi dengan satu bar hasilnya satu candle selebar ratusan
 * piksel — pasar yang baru dua kali diperdagangkan terlihat seperti chart rusak.
 * 24 slot dipilih supaya satu bar menempati sekitar 1/24 lebar pane, yaitu lebar
 * candle yang wajar, dengan ruang kosong di kanannya seperti pasangan yang baru
 * listing di bursa mana pun.
 */
const MIN_BARS_TO_FIT = 12;
/**
 * Jumlah slot saat jendela dipatok. HARUS sama dengan `MIN_BARS_TO_FIT`.
 *
 * Dulu 24 sementara ambangnya 12, dan selisih itu membuat lompatan yang terlihat: pada
 * 12 bar chart di-fit sehingga barnya mengisi seluruh pane, pada 11 bar chart dipatok ke
 * 24 slot sehingga bar yang jumlahnya hampir sama mendadak hanya mengisi 46% pane dengan
 * sisanya kosong. Satu bar hilang, setengah chart berubah.
 *
 * Dengan keduanya bernilai sama, kedua aturan bertemu tanpa patahan: tepat di 12 bar,
 * memaku ke 12 slot dan `fitContent()` menghasilkan tampilan yang identik. Di bawah itu
 * barnya menyusut secara wajar — 10 bar mengisi 83% pane, bukan 42%.
 *
 * Yang tetap dijaga adalah alasan patokan ini ada: `fitContent()` dengan satu bar
 * meregangkannya selebar pane. Pada 12 slot, satu bar mengambil 1/12 lebar, yaitu lebar
 * candle yang wajar.
 */
const YOUNG_MARKET_SLOTS = MIN_BARS_TO_FIT;

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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
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
   * made, so it happens once per symbol/chain/timeframe.
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
    const raw = new URLSearchParams(window.location.search).get("tf");
    if (raw) {
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
    if (url.searchParams.get("tf") === String(interval)) return;
    url.searchParams.set("tf", String(interval));
    window.history.replaceState(null, "", url.toString());
  }, [interval]);

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
  const [enabled, setEnabled] = useState<Record<IndicatorKey, boolean>>({
    ema9: true,
    ema21: true,
    sma50: false,
    bollinger: false,
    vwap: false,
    rsi14: true,
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

  // Chart instance is created once per container, not per data refresh.
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#030610" },
        textColor: "#94a3b8",
        fontSize: 11,
        fontFamily: "monospace",
        panes: { separatorColor: "rgba(255,255,255,0.12)", separatorHoverColor: "rgba(0,245,255,0.25)" },
      },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.04)" },
        horzLines: { color: "rgba(255, 255, 255, 0.04)" },
      },
      crosshair: {
        vertLine: { color: "#00F5FF", width: 1, style: 3 },
        horzLine: { color: "#00F5FF", width: 1, style: 3 },
      },
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
        borderColor: "rgba(255,255,255,0.1)",
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
        borderColor: "rgba(255,255,255,0.1)",
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
        if (maxBody > 0 && maxBody > span * MAX_BODY_SHARE) {
          const half = maxBody / MAX_BODY_SHARE / 2;
          return { ...res, priceRange: { minValue: mid - half, maxValue: mid + half } };
        }
        return res;
      },
    });

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
      layout: {
        background: { type: ColorType.Solid, color: "#030610" },
        textColor: "#94a3b8",
        fontSize: 11,
        fontFamily: "monospace",
        panes: { separatorColor: "rgba(255,255,255,0.12)", separatorHoverColor: "rgba(0,245,255,0.25)" },
      },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.04)" },
        horzLines: { color: "rgba(255, 255, 255, 0.04)" },
      },
      crosshair: {
        vertLine: { color: "#00F5FF", width: 1, style: 3 },
        horzLine: { color: "#00F5FF", width: 1, style: 3 },
      },
      // Sumbu waktu disembunyikan: label jamnya sudah ada di chart harga tepat di atas,
      // dan mengulanginya dua kali hanya menambah bising pada kotak setinggi 120 px.
      timeScale: { borderColor: "rgba(255,255,255,0.1)", timeVisible: true, secondsVisible: false, visible: false },
      // Lebar sumbu SAMA dengan chart harga, kalau tidak area gambarnya beda lebar dan
      // bar osilator tidak lurus di bawah candle-nya.
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.1)",
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
      linkFrom(price, osc);
      linkFrom(osc, price);
      const current = price.timeScale().getVisibleLogicalRange();
      if (current) osc.timeScale().setVisibleLogicalRange(current);
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

    const addOverlay = (color: string, data: Array<{ time: number; value: number }>, style = LineStyle.Solid) => {
      if (data.length === 0) return null;
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
          histData.map((d) => ({
            time: d.time as any,
            value: d.value,
            color: d.value >= 0 ? "rgba(16,185,129,0.55)" : "rgba(244,63,94,0.55)",
          })) as any
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

        const candles: Candle[] = Array.isArray(data.candles) ? data.candles : [];
        const totalTrades = Number(data.totalTrades || 0);
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
          volumeSeriesRef.current?.setData(
            sorted.map((c) => ({
              time: c.time as any,
              value: c.volume,
              color: c.close >= c.open ? "rgba(16,185,129,0.35)" : "rgba(244,63,94,0.35)",
            }))
          );
          drawIndicators(sorted);
          setLegend(sorted[sorted.length - 1]);

          const fitKey = `${symbol}:${chainId}:${interval}`;
          if (fittedFor.current !== fitKey) {
            /**
             * Dua keluhan berlawanan harus dijawab SEKALIGUS, bukan bergantian.
             *
             * Semula tidak ada fit sama sekali dan barnya mengumpul di tepi kanan;
             * itu diperbaiki dengan fitContent tanpa syarat, yang lalu melahirkan
             * keluhan kebalikannya — satu bar diregangkan jadi candle raksasa.
             * Ambangnya membuat keduanya benar: riwayat panjang tetap di-fit, pasar
             * muda mendapat jendela logis tetap sehingga lebar candle-nya wajar.
             */
            /**
             * `from: 0`, BUKAN `from: -3`.
             *
             * Nilai negatif menyisakan slot kosong sebelum bar pertama, dan untuk token yang
             * baru lahir itu salah secara faktual: tidak ada riwayat sebelum peluncuran, jadi
             * ruang kosong di kiri menyiratkan ada harga yang tidak pernah ada. Bar pertama
             * harus menempel di tepi kiri.
             */
            const ts = chartRef.current?.timeScale();
            if (sorted.length >= MIN_BARS_TO_FIT) ts?.fitContent();
            else ts?.setVisibleLogicalRange({ from: 0, to: YOUNG_MARKET_SLOTS });
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
  }, [tfResolved, symbol, chainId, interval, refreshKey, showMcap]);

  // Redraw on a toggle without waiting for the next poll.
  useEffect(() => {
    if (candlesRef.current.length > 0) drawIndicators(candlesRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledKey]);

  const priceUsd = priceNative * (nativeUsd || 0);
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
        </div>

        <div className="flex flex-wrap items-center gap-1 text-[11px]">
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
          {INTERVALS.map((i) => (
            <button
              key={i.label}
              type="button"
              onClick={() => setIntervalSeconds(i.seconds)}
              className={`px-2 py-0.5 rounded font-bold border transition-colors ${
                interval === i.seconds
                  ? "bg-accent-soft text-accent border-accent/30"
                  : "bg-cream-3 text-ink-soft border-transparent hover:text-ink"
              }`}
            >
              {i.label}
            </button>
          ))}

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
              <div className="absolute right-0 top-full mt-1 z-30 w-56 rounded-xl border border-line bg-white p-2 shadow-2xl space-y-0.5">
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
      <div ref={containerRef} className="w-full flex-1 min-h-[460px] overflow-hidden rounded-xl" />

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
        <div className="mt-2 shrink-0 rounded-xl border border-line bg-white py-2">
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
