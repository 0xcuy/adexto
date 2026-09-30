"use client";

import { useState } from "react";
import { Flame, Activity, ExternalLink, Info } from "lucide-react";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/chains";
import { X402_RELAYER } from "@/config/contracts";
import { formatSmallNumber } from "@/lib/pricing";
import { tradeWallet } from "@/lib/market-stats";
import { useMarketTelemetry } from "@/lib/use-market-telemetry";

/**
 * Trade feed backed by the same telemetry endpoint as the chart.
 *
 * Changes: fills are labelled by source, so genesis seeds are never presented as
 * live market activity; the explorer link is built from the trade's own chainId
 * instead of a `chain.includes("Arbitrum")` string test; and amounts are formatted
 * from numbers rather than pre-baked display strings.
 */

interface Trade {
  id: string;
  txHash: string;
  type: "BUY" | "SELL" | "AUTO_BUYBACK";
  symbol: string;
  amountToken: number;
  amountNative: number;
  nativeSymbol: string;
  priceNative: number;
  trader: string;
  /** Penerima di event `Swap`; untuk beli lewat relai, inilah pembelinya. */
  recipient?: string | null;
  timestamp: string;
  chainId: number;
  source: "onchain" | "agent" | "genesis";
}

const fmtToken = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toFixed(2);

/**
 * Umur relatif. Berlanjut melewati hari, karena sekarang riwayatnya bisa sampai sana.
 *
 * Satuan terbesarnya dulu `d` tanpa batas atas, jadi fill berumur enam minggu tampil
 * sebagai "42d". Itu tidak salah, hanya berhenti berguna — dan selama jendela bacanya
 * masih 13 jam, kasus itu tidak pernah muncul sehingga tidak pernah terasa. Setelah
 * jendelanya dibatasi blok peluncuran alih-alih hitungan blok tetap, ia muncul.
 */
function ago(timestamp: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(timestamp)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 2_592_000) return `${Math.floor(seconds / 86400)}d`;
  if (seconds < 31_536_000) return `${Math.floor(seconds / 2_592_000)}mo`;
  return `${Math.floor(seconds / 31_536_000)}y`;
}

interface Coverage {
  fromBlock: number | null;
  toBlock: number | null;
  reachedLaunch: boolean;
  truncated: boolean;
  blocksScanned: number;
  calls: number;
  error: string | null;
}

/**
 * Filter feed. "Large" berarti fill yang memindahkan setidaknya 1% suplai: ukuran yang
 * berarti relatif terhadap pasarnya sendiri, tanpa bergantung pada kurs, dan bisa dijelaskan
 * dalam satu kalimat. Ambang dolar tetap akan berarti "semua" di satu pasar dan "tidak ada"
 * di pasar lain.
 */
type FeedFilter = "all" | "mine" | "dev" | "large";
const LARGE_SHARE_OF_SUPPLY = 0.01;

export default function LiveTradeFeed({
  symbol,
  chainId,
  nativeUsd,
  me,
  creator,
  supply,
}: {
  symbol: string;
  /** Which chain's fills to show — each chain has its own pool and history. */
  chainId: number;
  nativeUsd: number;
  /** Dompet yang tersambung, untuk filter "Mine" dan tanda YOU. */
  me?: string | null;
  /** Alamat peluncur, untuk filter "Dev" dan tanda DEV. */
  creator?: string | null;
  /** Suplai utuh, untuk ambang "Large". */
  supply: number;
}) {
  // Satu pengambilan bersama dengan strip statistik; lihat `use-market-telemetry.ts`.
  const telemetry = useMarketTelemetry(symbol, chainId);
  const trades = telemetry.trades as Trade[];
  const source = telemetry.source;
  const coverage = telemetry.coverage as Coverage | null;
  const loaded = telemetry.loaded;

  const [filter, setFilter] = useState<FeedFilter>("all");
  const meL = (me || "").toLowerCase();
  const devL = (creator || "").toLowerCase();
  const largeMin = supply > 0 ? supply * LARGE_SHARE_OF_SUPPLY : Number.POSITIVE_INFINITY;
  const isMine = (t: Trade) => Boolean(meL) && tradeWallet(t) === meL;
  const isDev = (t: Trade) => Boolean(devL) && tradeWallet(t) === devL;
  const isLarge = (t: Trade) => t.amountToken >= largeMin;
  const shown = trades.filter((t) =>
    filter === "mine" ? isMine(t) : filter === "dev" ? isDev(t) : filter === "large" ? isLarge(t) : true
  );
  const FILTERS: Array<{ key: FeedFilter; label: string; title: string; disabled?: boolean }> = [
    { key: "all", label: "All", title: "Every fill" },
    {
      key: "mine",
      label: "Mine",
      title: meL ? "Fills where the connected wallet bought or sold" : "Connect a wallet to see your fills",
      disabled: !meL,
    },
    { key: "dev", label: "Dev", title: "Fills by the wallet that launched this market" },
    { key: "large", label: "Large", title: "Fills of at least 1% of the supply" },
  ];

  const isLive = source === "onchain";

  return (
    <div className="flex h-full min-h-0 w-full flex-col text-[11px]" data-numeric>
      <div className="flex items-center justify-between border-b border-line pb-2 mb-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <Activity className={`w-3.5 h-3.5 ${isLive ? "text-ok animate-pulse" : "text-warn"}`} />
          <span className="text-ink font-bold text-[10px] uppercase">Trade Feed</span>
        </div>
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
            isLive
              ? "text-ok bg-ok/10 border-ok/30"
              : "text-warn bg-warn/10 border-warn/30"
          }`}
        >
          {isLive ? "● on-chain" : source === "agent" ? "agent log" : source === "genesis" ? "genesis reference" : "no fills"}
        </span>
      </div>

      <div className="mb-2 flex shrink-0 items-center gap-1" role="group" aria-label="Filter trades">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            disabled={f.disabled}
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            title={f.title}
            data-feed-filter={f.key}
            className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              filter === f.key
                ? "border-accent/30 bg-accent-soft text-accent"
                : "border-transparent bg-cream-3 text-ink-soft hover:text-ink"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-[9px] text-ink-faint" data-feed-count={shown.length}>
          {loaded ? `${shown.length} fill${shown.length === 1 ? "" : "s"}` : ""}
        </span>
      </div>

      {/* Tabel, bukan tumpukan kartu.
          Versi sebelumnya menggambar tiap fill sebagai kartu berbingkai berwarna dengan
          isinya tersusun bebas, jadi tidak ada satu pun kolom yang bisa dibandingkan antar
          baris: ukuran satu fill ada di kiri, harganya tidak ada sama sekali, dan alamat
          trader tidak pernah ditampilkan. Untuk feed yang gunanya justru MEMBANDINGKAN
          fill berurutan, itu bentuk yang salah.
          Sekarang lima kolom tetap — umur, arah, ukuran, harga, trader — dengan kepala
          kolom yang menempel saat digulir. */}
      {/* Di desktop daftar ini mengisi sisa tinggi kolomnya — kolom kanan (posisi, swap, holder,
          chat) lebih tinggi dari chart, dan ruang itu lebih berguna sebagai baris fill tambahan
          daripada sebagai celah kosong. Di ponsel tingginya tetap dibatasi. */}
      {/* `basis-0` di desktop: jumlah baris TIDAK ikut menentukan tinggi kolom. Tanpa itu daftar
          50 fill membuat kolom kiri memanjang dan kotak chat di kanan ikut meregang kosong. */}
      <div className="max-h-[260px] min-h-0 flex-1 overflow-y-auto pr-1 lg:max-h-none lg:grow lg:basis-0">
        {!loaded ? (
          <div className="flex h-full items-center justify-center text-[11px] text-ink-faint">Loading…</div>
        ) : trades.length > 0 && shown.length === 0 ? (
          <div className="flex h-full items-center justify-center px-3 text-center text-[10px] text-ink-soft">
            {filter === "mine"
              ? "The connected wallet has no fills in this market."
              : filter === "dev"
              ? "The creator has not traded in this market."
              : "No fill has reached 1% of the supply."}
          </div>
        ) : trades.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-3 text-center">
            <Info className="h-4 w-4 text-ink-faint" />
            {/* Penolakan RPC dipisahkan dari pasar yang benar-benar kosong. Keduanya dulu
                menampilkan kalimat yang sama, sehingga kegagalan baca terbaca sebagai fakta
                tentang pasarnya. */}
            {coverage?.error ? (
              <>
                <span className="text-[10px] text-warn">Could not read trade history from the node.</span>
                <span className="break-all text-[9px] text-ink-faint">{coverage.error}</span>
              </>
            ) : (
              <span className="text-[10px] text-ink-soft">No trades recorded for ${symbol} yet.</span>
            )}
          </div>
        ) : (
          <table className="w-full table-fixed border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="text-[9px] uppercase tracking-[0.08em] text-ink-faint">
                <th scope="col" className="w-[9%] pb-1.5 font-semibold">age</th>
                <th scope="col" className="w-[11%] pb-1.5 font-semibold">side</th>
                <th scope="col" className="w-[27%] pb-1.5 text-right font-semibold">size</th>
                <th scope="col" className="w-[22%] pb-1.5 text-right font-semibold">price</th>
                <th scope="col" className="w-[31%] pb-1.5 text-right font-semibold">trader</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 50).map((t) => {
                const buy = t.type === "BUY";
                // Alamat yang ditampilkan adalah pemegang hasilnya; untuk beli lewat relai itu
                // penerimanya, dan relainya disebut di tooltip.
                const wallet = tradeWallet(t);
                const relayed = Boolean(t.recipient) && t.type === "BUY" && t.recipient!.toLowerCase() !== t.trader.toLowerCase();
                // Dikirim relai gateway x402: di explorer pengirim transaksinya relai, sedangkan
                // tokennya mendarat di pembayar. Tanpa label ini dua alamat itu terbaca
                // bertentangan saat baris diklik.
                const viaX402 = relayed && t.trader.toLowerCase() === X402_RELAYER.toLowerCase();
                const senderNote = relayed
                  ? viaX402
                    ? `Paid with USDC on Base through the x402 gateway. The ADEXTO relayer ${t.trader} sent this transaction and the tokens went to ${wallet}, so the explorer shows the relayer as the sender.`
                    : `Bought by ${t.trader} for ${wallet}. The explorer shows ${t.trader} as the sender.`
                  : "";
                const mine = isMine(t);
                const dev = isDev(t);
                const burn = t.type === "AUTO_BUYBACK";
                const tone = burn ? "text-accent" : buy ? "text-ok" : "text-danger";
                /* Harga per token, bukan nilai fill: itu yang membuat baris berurutan bisa
                   dibandingkan. Dihitung dari harga native fill itu sendiri x kurs saat ini,
                   jadi kalau kurs belum terbaca yang tampil satuan native — bukan angka USD
                   yang dikarang dari kurs nol. */
                const priceUsd = t.priceNative * (nativeUsd || 0);
                return (
                  <tr
                    key={t.id}
                    className={`border-t border-line/60 align-baseline ${mine ? "bg-accent-soft/40" : ""}`}
                    data-trade-row
                    data-mine={mine ? "1" : "0"}
                    data-dev={dev ? "1" : "0"}
                  >
                    <td className="py-1.5 text-[10px] text-ink-faint">{ago(t.timestamp)}</td>
                    <td className={`py-1.5 text-[10px] font-semibold ${tone}`}>
                      {burn ? (
                        <span className="inline-flex items-center gap-1">
                          <Flame className="h-2.5 w-2.5" /> burn
                        </span>
                      ) : (
                        t.type.toLowerCase()
                      )}
                    </td>
                    <td className={`py-1.5 text-right text-[10px] font-medium ${tone}`}>
                      {burn ? "" : buy ? "+" : "−"}
                      {fmtToken(t.amountToken)} <span className="text-ink-faint">${t.symbol}</span>
                    </td>
                    <td className="py-1.5 text-right text-[10px] text-ink">
                      {priceUsd > 0 ? `$${formatSmallNumber(priceUsd)}` : `${formatSmallNumber(t.priceNative)} ${t.nativeSymbol}`}
                    </td>
                    <td className="py-1.5 text-right text-[10px]">
                      {t.source === "genesis" ? (
                        <span className="text-ink-faint">reference</span>
                      ) : (
                        <span className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
                          {mine && (
                            <span className="rounded bg-accent-soft px-1 text-[8px] font-bold text-accent" title="Your wallet">
                              YOU
                            </span>
                          )}
                          {dev && (
                            <span className="rounded bg-warn/15 px-1 text-[8px] font-bold text-warn" title="The wallet that launched this market">
                              DEV
                            </span>
                          )}
                          {relayed && (
                            <span
                              className="rounded bg-cream-3 px-1 text-[8px] font-bold text-ink-soft"
                              title={senderNote}
                              data-relayed={viaX402 ? "x402" : "via"}
                            >
                              {viaX402 ? "x402" : "via"}
                            </span>
                          )}
                          {/* Alamat membuka ALAMAT yang sama di explorer; transaksinya punya
                              ikonnya sendiri. Dulu alamatnya membuka transaksi, yang untuk beli
                              lewat relai memperlihatkan pengirim yang berbeda dari alamat ini. */}
                          <a
                            href={explorerAddressUrl(t.chainId, wallet)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`${wallet} · ${t.amountNative.toFixed(6)} ${t.nativeSymbol}${
                              nativeUsd > 0 ? ` (${(t.amountNative * nativeUsd).toFixed(2)} USD)` : ""
                            }`}
                            aria-label={`Open ${wallet} on the explorer`}
                            className="font-mono text-accent hover:underline"
                          >
                            {wallet.slice(0, 6)}…{wallet.slice(-4)}
                          </a>
                          <a
                            href={explorerTxUrl(t.chainId, t.txHash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={relayed ? `Transaction · ${senderNote}` : "Open this transaction on the explorer"}
                            aria-label="Open this transaction on the explorer"
                            className="inline-flex items-center text-ink-faint hover:text-accent"
                          >
                            <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                          </a>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Jangkauan pembacaan, dinyatakan alih-alih disiratkan.
          Pertanyaan yang memicu baris ini: "kenapa feed hari kemarin hilang?" Jawabannya
          waktu itu adalah jendela 45.000 blok — sekitar 13 jam di 0G — tetapi tidak ada
          apa pun di layar yang bisa mengatakannya, jadi feed yang terpotong tampak
          identik dengan feed yang lengkap. Sekarang kalau riwayatnya utuh sampai
          peluncuran, itu dinyatakan; kalau terpotong, itu juga dinyatakan. */}
      {loaded && isLive && trades.length > 0 && coverage && (
        <div className="mt-2 shrink-0 border-t border-line pt-1.5 text-[9px] text-ink-faint">
          {coverage.reachedLaunch ? (
            <span>
              {trades.length} fill{trades.length === 1 ? "" : "s"} · full history since launch
            </span>
          ) : (
            <span>
              {trades.length} fill{trades.length === 1 ? "" : "s"} · newest {coverage.blocksScanned.toLocaleString("en-US")} blocks
              only, older fills not read
            </span>
          )}
          {shown.length > 50 && <span> · showing the latest 50</span>}
        </div>
      )}
    </div>
  );
}
