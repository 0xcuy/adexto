"use client";

import { ethers } from "ethers";
import { ArrowDownUp, Flame } from "lucide-react";

import { nativeAssetLogo } from "@/lib/chains";
import { formatSmallNumber, formatTokenAmount, formatUsd, plainDecimal } from "@/lib/pricing";
import type { SovereignSwap } from "@/lib/use-sovereign-swap";

/**
 * Bagian-bagian panel trading yang dipakai BERSAMA oleh /swap dan /token/[token].
 *
 * Kenapa dipisah ke berkas sendiri, bukan disalin.
 *
 * Kedua halaman itu memperdagangkan hal yang sama lewat mesin yang sama
 * (`useSovereignSwap`), tapi tampilannya ditulis dua kali. Hasilnya bisa diukur
 * sebelum perubahan ini: /swap memakai `formatUsd` di baris nilai, /token memakai
 * `≈ formatUsd`; /swap menaruh saldo di baris bawah, /token menaruhnya di dalam
 * label; input /swap 24px, /token 20px; lencana simbol /swap berlatar cream, /token
 * berlatar putih bertulisan accent. Tidak ada satu pun dari beda itu yang diputuskan
 * — semuanya sisa dari dua kali menulis hal yang sama.
 *
 * Bentuk perawatannya lebih buruk lagi: memperbaiki tipografi di satu halaman
 * meninggalkan halaman lain, dan itu justru keluhan yang berulang. Jadi yang benar
 * bukan menyalin gaya barunya ke tempat kedua, melainkan menghapus tempat keduanya.
 *
 * Yang TIDAK dipindah ke sini, dengan sengaja:
 *
 *   - warna tombol eksekusi. Di /token, beli hijau dan jual merah karena di sana
 *     ARAH adalah keputusan yang salah-tekannya mahal. Di /swap tombolnya satu aksi
 *     accent. Itu dua keputusan berbeda yang keduanya beralasan, bukan
 *     ketidakkonsistenan.
 *   - pemilih market. Hanya /swap punya, karena /token sudah terikat satu token.
 */

/** Ambang slippage yang ditawarkan, dalam basis point. */
export const SLIPPAGE_OPTIONS = [50, 100, 300, 500];

/**
 * Lencana aset di sisi kanan panel jumlah.
 *
 * Dulu `<span>` berisi tiga huruf saja. Logonya ada karena aset adalah satu-satunya
 * hal di panel ini yang bisa salah tanpa TERASA salah: angka yang keliru terlihat
 * keliru, tetapi menukar "0G" dengan "ETH" tidak terlihat apa-apa sampai transaksi
 * terkirim. Gambar dikenali lebih dulu daripada teks dibaca.
 *
 * `logo` boleh null dan itu bukan kasus tepi yang jarang: `nativeAssetLogo()`
 * mengembalikan null untuk simbol yang tidak ada berkasnya, dan mengarang gambar
 * untuk aset asing justru membuatnya tampak sudah dikenal. Tanpa logo, lencananya
 * tetap utuh — hanya berisi simbol.
 */
export function AssetPill({ symbol, logo }: { symbol: string; logo: string | null }) {
  return (
    <span className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-cream-2 py-1.5 pl-1.5 pr-3.5">
      {logo ? (
        <img src={logo} alt="" aria-hidden="true" className="h-6 w-6 shrink-0 rounded-full object-contain" />
      ) : (
        <span aria-hidden="true" className="h-6 w-6 shrink-0 rounded-full border border-line bg-cream-3" />
      )}
      <span className="whitespace-nowrap text-sm font-semibold text-ink">{symbol}</span>
    </span>
  );
}

export function SlippageRow({ value, onChange }: { value: number; onChange: (bps: number) => void }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-line bg-cream-2 p-3">
      <span className="text-xs font-medium text-ink-soft">Max slippage</span>
      <div className="flex gap-1">
        {SLIPPAGE_OPTIONS.map((bps) => (
          <button
            key={bps}
            type="button"
            onClick={() => onChange(bps)}
            aria-pressed={value === bps}
            className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
              value === bps
                ? "border-accent/30 bg-accent-soft text-accent"
                : "border-transparent bg-cream-3 text-ink-soft hover:text-ink"
            }`}
            data-numeric
          >
            {(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%
          </button>
        ))}
      </div>
    </div>
  );
}

/** Format ambang slippage sebagai persen, tanpa desimal yang tidak berguna. */
export const slippagePercent = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;

interface AmountsProps {
  swap: SovereignSwap;
  /** Simbol token proyek. Sisi native diambil dari `swap.chain`. */
  tokenSymbol: string;
  tokenLogo: string | null;
  /** Nilai USD dari jumlah masukan, dihitung pemanggil karena tabel harganya di sana. */
  inputUsd: number;
  isConnected: boolean;
}

/**
 * Dua panel jumlah plus tombol tukar arah dan rincian kuotasi.
 *
 * Susunannya diubah dari versi lama karena versi itu membagi lebar 50/50 antara
 * kolom input dan lencana simbol: angka — satu-satunya hal yang benar-benar diketik
 * dan dibaca ulang di panel ini — hanya mendapat setengah kartu, sementara badge
 * tiga huruf mendapat sisanya.
 *
 * Sekarang satu angka dominan (text-4xl) dan segala hal lain menurun tajam di
 * bawahnya. Nilai USD dan saldo pindah ke baris ketiga, kiri dan kanan, sehingga
 * baris pertama bebas untuk tombol porsi. Angkanya BUKAN monospace: `data-numeric`
 * sudah memberi tabular-nums lewat globals.css, jadi digitnya tetap tidak bergeser
 * saat harga berubah tanpa harus memakai huruf mesin tik.
 */
export function TradeAmounts({ swap, tokenSymbol, tokenLogo, inputUsd, isConnected }: AmountsProps) {
  const chain = swap.chain;
  const nativeLogo = nativeAssetLogo(chain.nativeSymbol);
  const paySymbol = swap.mode === "buy" ? chain.nativeSymbol : tokenSymbol;
  const payLogo = swap.mode === "buy" ? nativeLogo : tokenLogo;
  const getSymbol = swap.mode === "buy" ? tokenSymbol : chain.nativeSymbol;
  const getLogo = swap.mode === "buy" ? tokenLogo : nativeLogo;

  return (
    <>
      <div className="mb-1.5 rounded-2xl border border-line bg-white p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-ink-soft">You pay</span>
          {/* Tombol porsi hanya muncul saat tersambung: tanpa saldo, "50%" tidak
              punya rujukan dan menekannya hanya menulis nol. */}
          {isConnected && (
            <div className="flex items-center gap-1">
              {[25, 50, 75].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => swap.setAmountFraction(pct)}
                  className="rounded-lg border border-line bg-cream-2 px-2 py-1 text-[11px] font-semibold text-ink-soft transition-colors hover:text-ink"
                  data-numeric
                >
                  {pct}%
                </button>
              ))}
              <button
                type="button"
                onClick={swap.setMaxAmount}
                className="rounded-lg border border-accent/30 bg-accent-soft px-2 py-1 text-[11px] font-semibold text-accent"
              >
                Max
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <input
            type="number"
            min="0"
            step="any"
            value={swap.amountInput}
            onChange={(e) => swap.setAmountInput(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-4xl font-semibold tracking-tight text-ink placeholder:text-ink-faint/60 focus:outline-none"
            placeholder="0"
            aria-label={`Amount of ${paySymbol} to pay`}
            data-numeric
          />
          <AssetPill symbol={paySymbol} logo={payLogo} />
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-ink-faint">
          <span data-numeric>{formatUsd(inputUsd)}</span>
          <span data-numeric>
            {swap.mode === "buy"
              ? `${swap.nativeBalanceFormatted} ${chain.nativeSymbol}`
              : `${swap.tokenBalanceFormatted} ${tokenSymbol}`}
          </span>
        </div>
      </div>

      {/* Bundar, putih, berbayang, menindih celah antar panel. Yang lama kotak
          bersudut membulat berlatar accent-soft, jadi ia terbaca sebagai kotak
          KETIGA di antara dua kotak alih-alih satu kontrol yang menghubungkannya. */}
      <div className="relative z-10 -my-4 flex justify-center">
        <button
          type="button"
          onClick={() => swap.setMode(swap.mode === "buy" ? "sell" : "buy")}
          className="rounded-full border border-line bg-white p-2.5 text-ink shadow-md transition-colors hover:border-line-strong"
          title="Flip direction"
          aria-label="Flip direction"
        >
          <ArrowDownUp className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-1.5 rounded-2xl border border-line bg-white p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-ink-soft">You receive</span>
          <span className="text-[11px] text-ink-faint">estimated</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-4xl font-semibold tracking-tight text-accent" data-numeric>
            {swap.outputAmount > 0 ? formatTokenAmount(swap.outputAmount) : "0"}
          </span>
          <AssetPill symbol={getSymbol} logo={getLogo} />
        </div>

        <div
          className="mt-2 text-xs text-ink-faint"
          title={
            swap.spotPriceNative > 0
              ? `${plainDecimal(swap.spotPriceNative)} ${chain.nativeSymbol} per token`
              : undefined
          }
        >
          1 {tokenSymbol} ={" "}
          <span data-numeric>{swap.spotPriceNative > 0 ? formatSmallNumber(swap.spotPriceNative) : "—"}</span>{" "}
          {chain.nativeSymbol}
        </div>

        {swap.quote && swap.quote.amountOut > 0n && (
          <div className="mt-3 space-y-1.5 border-t border-line pt-3 text-xs">
            <div className="flex items-start justify-between gap-3">
              <span className="text-ink-faint">
                Minimum received{" "}
                <span className="text-ink-faint/80" data-numeric>
                  ({slippagePercent(swap.slippageBps)} slippage)
                </span>
              </span>
              <span className="shrink-0 font-medium text-ink-soft" data-numeric>
                {formatTokenAmount(
                  swap.mode === "buy"
                    ? Number(ethers.formatUnits(swap.minReceived, swap.tokenDecimals))
                    : Number(ethers.formatEther(swap.minReceived))
                )}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-faint">Price impact</span>
              <span
                className={`shrink-0 font-medium ${swap.quote.priceImpactBps > 500 ? "text-warn" : "text-ink-soft"}`}
                data-numeric
              >
                {(swap.quote.priceImpactBps / 100).toFixed(2)}%
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

interface FeeProps {
  lpFeeBps: number;
  treasuryBuybackBps: number;
  /** null kalau state pool belum terbaca; barisnya disembunyikan, tidak ditebak. */
  creatorFeeBps: number | null;
  feeUsd: { lp: number; creator: number; buyback: number };
}

/**
 * Tiga baris biaya, karena biayanya memang terbagi tiga. Menampilkan hanya depth
 * dan buyback akan menyembunyikan dari mana pendapatan pembuat token datang.
 */
export function FeeLines({ lpFeeBps, treasuryBuybackBps, creatorFeeBps, feeUsd }: FeeProps) {
  const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
  return (
    <div className="space-y-2 rounded-2xl border border-accent/30 bg-accent-soft p-4 text-xs">
      <div className="flex items-start justify-between gap-3">
        <span className="text-ink-soft">
          Curve depth <span data-numeric>({pct(lpFeeBps)})</span> — stays in curve
        </span>
        <span className="shrink-0 font-medium text-ink" data-numeric>
          {formatUsd(feeUsd.lp)}
        </span>
      </div>
      {creatorFeeBps ? (
        <div className="flex items-start justify-between gap-3 text-ok">
          <span>
            ↳ Creator <span data-numeric>({pct(creatorFeeBps)})</span>
          </span>
          <span className="shrink-0 font-medium" data-numeric>
            {formatUsd(feeUsd.creator)}
          </span>
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-3 font-semibold text-accent">
        <span className="flex items-center gap-1.5">
          <Flame className="h-3.5 w-3.5 shrink-0 text-accent" />
          Agent buyback <span data-numeric>({pct(treasuryBuybackBps)})</span>
        </span>
        <span className="shrink-0" data-numeric>
          {formatUsd(feeUsd.buyback)}
        </span>
      </div>
    </div>
  );
}
