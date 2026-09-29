import { ethers } from "ethers";
import type { ProjectRecord } from "@/lib/registry";
import { readProvider, resolveChainOrDefault } from "@/lib/chains";
import { ERC20_ABI, quoteSellLocal, readPoolState } from "@/lib/dex";
import { ensureMarketIndex, indexable, swapsWithTimes, type IndexStatus } from "@/lib/market-index";
import { computePosition, walletSwaps, type PositionResult } from "@/lib/position";
import { fxAt, fxSeries, lastObserved } from "@/lib/fx-history";
import { nativePrices } from "@/lib/native-price";

/**
 * Posisi sebuah dompet, disusun dari indeks pasar dan pembacaan chain saat ini. Dipakai
 * `/api/market/position` dan kartu posisi, supaya keduanya tidak bisa menyebut angka berbeda.
 */

export interface PositionTradeRow {
  txHash: string;
  isBuy: boolean;
  amountToken: number;
  amountNative: number;
  time: number;
}

export interface PositionReport {
  symbol: string;
  chainId: number;
  nativeSymbol: string;
  wallet: string;
  index: IndexStatus | null;
  /**
   * Riwayat sejak peluncuran sudah terpindai utuh. Tanpa ini harga masuk dan PnL TIDAK boleh
   * ditampilkan: satu pembelian yang belum terbaca membuat keduanya salah.
   */
  complete: boolean;
  spotNative: number;
  fxNow: number | null;
  /** Native yang diterima kalau seluruh saldo dijual sekarang, sesudah fee dan dampak harga. */
  exitNative: number | null;
  /** Saldo dibaca langsung dari token pada blok terbaru (bukan dari indeks). */
  balanceFromChain: boolean;
  position: PositionResult;
  trades: PositionTradeRow[];
}

const FX_NOW_MAX_AGE_SECONDS = 3_600;

async function currentFx(nativeSymbol: string): Promise<number | null> {
  const last = lastObserved(nativeSymbol);
  if (last && Date.now() / 1000 - last[0] <= FX_NOW_MAX_AGE_SECONDS) return last[1];
  try {
    const read = await nativePrices();
    const v = read.prices[nativeSymbol];
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function readPosition(
  project: ProjectRecord,
  walletRaw: string,
  opts: { waitMs?: number } = {}
): Promise<PositionReport | null> {
  if (!indexable(project) || !ethers.isAddress(walletRaw)) return null;
  const wallet = walletRaw.toLowerCase();
  const chain = resolveChainOrDefault(project.chainId);
  const { index, status } = await ensureMarketIndex(project, { waitMs: opts.waitMs ?? 8_000 });
  const decimals = index?.decimals ?? 18;

  // Saldo dari chain sekarang juga; indeks tertinggal beberapa konfirmasi dari kepala.
  let balanceTokens = 0;
  let balanceFromChain = false;
  let balanceWei = 0n;
  try {
    const token = new ethers.Contract(project.tokenAddress, ERC20_ABI, readProvider(chain));
    balanceWei = BigInt(await token.balanceOf(wallet));
    balanceTokens = Number(ethers.formatUnits(balanceWei, decimals));
    balanceFromChain = true;
  } catch {
    const fromIndex = index?.balances[wallet];
    balanceWei = fromIndex ? BigInt(fromIndex) : 0n;
    balanceTokens = Number(ethers.formatUnits(balanceWei, decimals));
  }

  // Harga spot dan nilai keluar dari kurva; kalau kurva tidak terbaca, harga dari swap terakhir.
  let spotNative = 0;
  let exitNative: number | null = null;
  const pool = await readPoolState(chain, project.poolAddress!);
  if (pool && pool.initialized) {
    spotNative = pool.spotPriceNative;
    if (balanceWei > 0n) exitNative = Number(ethers.formatEther(quoteSellLocal(pool, balanceWei).amountOut));
  } else {
    const last = index?.swaps[index.swaps.length - 1];
    spotNative = last?.priceNativeAfter ?? project.priceNative ?? 0;
  }

  const series = fxSeries(chain.nativeSymbol);
  const fxNow = await currentFx(chain.nativeSymbol);
  const swaps = index ? swapsWithTimes(index) : [];
  const position = computePosition({
    wallet,
    swaps,
    balanceTokens,
    spotNative,
    fxNow,
    fxAt: (s) => fxAt(series, s),
  });

  return {
    symbol: project.symbol,
    chainId: project.chainId,
    nativeSymbol: chain.nativeSymbol,
    wallet,
    index: status,
    complete: status.complete,
    spotNative,
    fxNow,
    exitNative,
    balanceFromChain,
    position,
    trades: walletSwaps(swaps, wallet)
      .slice(-50)
      .reverse()
      .map((s) => ({ txHash: s.txHash, isBuy: s.isBuy, amountToken: s.amountToken, amountNative: s.amountNative, time: s.time })),
  };
}
