"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { resolveChainOrDefault, type ChainInfo } from "@/lib/chains";
import {
  ERC20_ABI, applySlippage, describeTxError, executeBuy, executeSell,
  poolIsTradable, quoteBuyLocal, quoteSellLocal, readPoolState, type PoolState, type Quote,
} from "@/lib/dex";
import { getActiveEip1193 } from "@/lib/wallet-provider";

/**
 * Shared trading engine for /swap and /token/[slug].
 *
 * The two surfaces previously had independent, divergent implementations of the
 * same flow, which is how they ended up with different price maths and different
 * (equally broken) transaction builders. There is now one code path: one quoting
 * function, one chain guard, one approve+sell branch.
 */

export interface SwapMarket {
  symbol: string;
  name: string;
  tokenAddress: string;
  poolAddress: string | null;
  chainId: number;
  priceNative: number;
  lpFeeBps: number;
  treasuryBuybackBps: number;
}

export type SwapMode = "buy" | "sell";

export interface SovereignSwap {
  chain: ChainInfo;
  pool: PoolState | null;
  poolChecked: boolean;
  tradable: boolean;
  poolStatusMessage: string;

  mode: SwapMode;
  setMode: (mode: SwapMode) => void;
  amountInput: string;
  setAmountInput: (value: string) => void;
  slippageBps: number;
  setSlippageBps: (bps: number) => void;

  tokenDecimals: number;
  parsedAmount: bigint;
  quote: Quote | null;
  outputAmount: number;
  minReceived: bigint;
  spotPriceNative: number;

  nativeBalance: bigint;
  tokenBalance: bigint;
  nativeBalanceFormatted: string;
  tokenBalanceFormatted: string;
  /**
   * Isi jumlah dengan sebagian saldo yang BISA DIPAKAI, 1–100 persen.
   *
   * Ada di hook, bukan di komponen, karena "bisa dipakai" bukan sekadar saldo:
   * pada arah beli, gas harus disisakan atau transaksinya gagal setelah pemakai
   * menekan MAX. Kalau tombol 25/50/75 di panel menghitung sendiri, aturan
   * penyisihan gas itu akan hidup di dua tempat dan berpisah pada perubahan
   * pertama. `setMaxAmount` sekarang hanyalah kasus 100 persen dari fungsi ini.
   */
  setAmountFraction: (percent: number) => void;
  setMaxAmount: () => void;

  busy: boolean;
  statusLine: string | null;
  errorLine: string | null;
  txHash: string | null;
  setErrorLine: (message: string | null) => void;

  execute: (address: string | null) => Promise<void>;
  refresh: () => Promise<void>;
}

const GAS_HEADROOM = ethers.parseEther("0.002");

export function useSovereignSwap(market: SwapMarket | null, address: string | null): SovereignSwap {
  const chain = useMemo(() => resolveChainOrDefault(market?.chainId ?? null), [market?.chainId]);

  const [pool, setPool] = useState<PoolState | null>(null);
  const [poolChecked, setPoolChecked] = useState(false);
  const [tokenDecimals, setTokenDecimals] = useState(18);

  const [mode, setModeState] = useState<SwapMode>("buy");
  const [amountInput, setAmountInput] = useState("");
  const [slippageBps, setSlippageBps] = useState(100);

  const [nativeBalance, setNativeBalance] = useState<bigint>(0n);
  const [tokenBalance, setTokenBalance] = useState<bigint>(0n);

  const [busy, setBusy] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [errorLine, setErrorLine] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  // ── pool state ───────────────────────────────────────────────────────────
  const loadPool = useCallback(async () => {
    if (!market?.poolAddress) {
      setPool(null);
      setPoolChecked(true);
      return;
    }
    const state = await readPoolState(chain, market.poolAddress);
    setPool(state);
    if (state) setTokenDecimals(state.tokenDecimals);
    setPoolChecked(true);
  }, [chain, market?.poolAddress]);

  useEffect(() => {
    setPoolChecked(false);
    setPool(null);
    loadPool();
    const timer = setInterval(loadPool, 20000);
    return () => clearInterval(timer);
  }, [loadPool]);

  // ── balances ─────────────────────────────────────────────────────────────
  const loadBalances = useCallback(async () => {
    if (!address || !market) {
      setNativeBalance(0n);
      setTokenBalance(0n);
      return;
    }
    try {
      const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
      const native = await provider.getBalance(address);
      setNativeBalance(BigInt(native));
      try {
        const erc20 = new ethers.Contract(market.tokenAddress, ERC20_ABI, provider);
        const [balance, decimals] = await Promise.all([erc20.balanceOf(address), erc20.decimals()]);
        setTokenBalance(BigInt(balance));
        setTokenDecimals(Number(decimals));
      } catch {
        setTokenBalance(0n);
      }
    } catch {
      setNativeBalance(0n);
      setTokenBalance(0n);
    }
  }, [address, chain.rpcUrl, market]);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  // ── quoting ──────────────────────────────────────────────────────────────
  const parsedAmount = useMemo(() => {
    const raw = amountInput.trim();
    if (!raw || Number(raw) <= 0 || !Number.isFinite(Number(raw))) return 0n;
    try {
      return mode === "buy" ? ethers.parseEther(raw) : ethers.parseUnits(raw, tokenDecimals);
    } catch {
      return 0n;
    }
  }, [amountInput, mode, tokenDecimals]);

  const quote = useMemo(() => {
    if (!pool || parsedAmount <= 0n) return null;
    return mode === "buy" ? quoteBuyLocal(pool, parsedAmount) : quoteSellLocal(pool, parsedAmount);
  }, [pool, parsedAmount, mode]);

  const outputAmount = useMemo(() => {
    if (!quote || quote.amountOut <= 0n) return 0;
    return mode === "buy"
      ? Number(ethers.formatUnits(quote.amountOut, tokenDecimals))
      : Number(ethers.formatEther(quote.amountOut));
  }, [quote, mode, tokenDecimals]);

  const minReceived = useMemo(
    () => (quote && quote.amountOut > 0n ? applySlippage(quote.amountOut, slippageBps) : 0n),
    [quote, slippageBps]
  );

  const tradable = poolIsTradable(pool);
  const spotPriceNative = pool?.spotPriceNative ?? market?.priceNative ?? 0;

  const poolStatusMessage = useMemo(() => {
    if (!market) return "Select a market.";
    if (!market.poolAddress) {
      return chain.dexLive
        ? `${market.symbol} has no executable market recorded, so there is nothing to trade against.`
        : `Trading is disabled: no launch factory is deployed on ${chain.name} yet, so ${market.symbol} has no executable market. The legacy showcase entry has no swap entrypoint and would revert.`;
    }
    if (!poolChecked) return "Reading market state…";
    if (!pool) return `The address recorded for ${market.symbol} does not expose a tradable swap interface.`;
    // Kurva sudah bisa diperdagangkan sejak blok pertama tanpa setoran apa pun, jadi
    // "belum di-seed" bukan lagi penjelasan yang benar untuk keadaan ini.
    if (!pool.initialized) return "The market exists but has not been initialised yet.";
    return "Pool is live.";
  }, [market, chain, pool, poolChecked]);

  // ── actions ──────────────────────────────────────────────────────────────
  const setMode = useCallback((next: SwapMode) => {
    setModeState(next);
    setAmountInput("");
    setErrorLine(null);
    setStatusLine(null);
    setTxHash(null);
  }, []);

  const setAmountFraction = useCallback(
    (percent: number) => {
      // Dijepit ke 1..100. Nilai di luar itu hanya bisa datang dari bug pemanggil,
      // dan menuliskan jumlah negatif ke kolom input akan lolos ke parser.
      const pct = BigInt(Math.max(1, Math.min(100, Math.round(percent))));
      if (mode === "buy") {
        const usable = nativeBalance > GAS_HEADROOM ? nativeBalance - GAS_HEADROOM : 0n;
        // Dihitung dalam bigint, bukan lewat float. Mengalikan saldo wei sebagai
        // Number kehilangan presisi di atas 2^53 dan menghasilkan jumlah yang
        // sedikit berbeda dari yang ditampilkan.
        const part = (usable * pct) / 100n;
        setAmountInput(part > 0n ? ethers.formatEther(part) : "0");
      } else {
        const part = (tokenBalance * pct) / 100n;
        setAmountInput(part > 0n ? ethers.formatUnits(part, tokenDecimals) : "0");
      }
    },
    [mode, nativeBalance, tokenBalance, tokenDecimals]
  );

  const setMaxAmount = useCallback(() => setAmountFraction(100), [setAmountFraction]);

  const execute = useCallback(
    async (walletAddress: string | null) => {
      setErrorLine(null);
      setStatusLine(null);
      setTxHash(null);

      if (!market || !market.poolAddress) {
        setErrorLine(poolStatusMessage);
        return;
      }
      if (!walletAddress) {
        setErrorLine("Connect a wallet first.");
        return;
      }
      if (!tradable) {
        setErrorLine(poolStatusMessage);
        return;
      }
      if (parsedAmount <= 0n) {
        setErrorLine("Enter an amount greater than zero.");
        return;
      }
      if (!quote || quote.amountOut <= 0n) {
        setErrorLine("The pool cannot quote this size. Try a smaller amount.");
        return;
      }

      setBusy(true);
      try {
        // Wajib provider TERPILIH, bukan `window.ethereum`. Kalau user punya
        // beberapa wallet, `window.ethereum` adalah pemenang lomba injeksi dan
        // transaksi bisa dikirim dari wallet yang bukan pilihannya.
        const ethereum = getActiveEip1193();
        if (!ethereum) throw new Error("No wallet available. Connect a wallet first.");
        if (mode === "buy") {
          /**
           * Kalimatnya dulu "Simulating buy on 0G Mainnet…", dan itu salah bukan
           * karena tidak akurat — melainkan karena dibaca sebagai hal lain.
           *
           * Yang terjadi memang `staticCall` sebelum menandatangani, supaya trade yang
           * akan revert tidak membuang gas. Perilakunya benar dan dipertahankan. Tapi
           * di UI trading mainnet, kata "Simulating" terbaca "ini bukan transaksi
           * nyata" — pembaca pertama yang melihatnya langsung menyimpulkan pasarnya
           * palsu. Jadi yang ditulis sekarang TUJUANNYA, bukan nama tekniknya.
           */
          setStatusLine(`Checking this trade would succeed on ${chain.name}…`);
          const result = await executeBuy({
            ethereum,
            chain,
            poolAddress: market.poolAddress,
            amountInWei: parsedAmount,
            minTokensOut: minReceived,
          });
          setTxHash(result.txHash);
          setStatusLine(
            `Received ${Number(ethers.formatUnits(result.amountOut, tokenDecimals)).toLocaleString(undefined, {
              maximumFractionDigits: 4,
            })} ${market.symbol}.`
          );
        } else {
          setStatusLine("Checking allowance…");
          const result = await executeSell({
            ethereum,
            chain,
            poolAddress: market.poolAddress,
            tokenAddress: market.tokenAddress,
            amountInTokens: parsedAmount,
            minNativeOut: minReceived,
            onApproval: () => setStatusLine("Approval sent, waiting for confirmation…"),
          });
          setTxHash(result.txHash);
          setStatusLine(`Received ${Number(ethers.formatEther(result.amountOut)).toFixed(6)} ${chain.nativeSymbol}.`);
        }

        setAmountInput("");
        await Promise.all([loadBalances(), loadPool()]);
      } catch (error) {
        setStatusLine(null);
        setErrorLine(describeTxError(error));
      } finally {
        setBusy(false);
      }
    },
    [market, mode, chain, parsedAmount, quote, minReceived, tradable, poolStatusMessage, tokenDecimals, loadBalances, loadPool]
  );

  const refresh = useCallback(async () => {
    await Promise.all([loadBalances(), loadPool()]);
  }, [loadBalances, loadPool]);

  return {
    chain,
    pool,
    poolChecked,
    tradable,
    poolStatusMessage,

    mode,
    setMode,
    amountInput,
    setAmountInput,
    slippageBps,
    setSlippageBps,

    tokenDecimals,
    parsedAmount,
    quote,
    outputAmount,
    minReceived,
    spotPriceNative,

    nativeBalance,
    tokenBalance,
    nativeBalanceFormatted: Number(ethers.formatEther(nativeBalance)).toFixed(4),
    tokenBalanceFormatted: Number(ethers.formatUnits(tokenBalance, tokenDecimals)).toLocaleString(undefined, {
      maximumFractionDigits: 4,
    }),
    setAmountFraction,
    setMaxAmount,

    busy,
    statusLine,
    errorLine,
    txHash,
    setErrorLine,

    execute,
    refresh,
  };
}
