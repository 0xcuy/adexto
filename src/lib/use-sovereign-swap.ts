"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { readProvider, resolveChainOrDefault, type ChainInfo } from "@/lib/chains";
import {
  ERC20_ABI, applySlippage, describeTxError, executeBuy, executeSell,
  poolIsTradable, quoteBuyLocal, quoteSellLocal, readPoolStateStrict,
  solveBuyForTokensOut, solveSellForNativeOut, type PoolState, type Quote,
} from "@/lib/dex";
import { getActiveEip1193 } from "@/lib/wallet-provider";
import { referrerFor, reportReferredTrade } from "@/lib/referral-client";

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
  /**
   * Sisi keluaran, bisa diisi langsung.
   *
   * Yang diperdagangkan orang seringkali jumlah yang mereka INGINKAN, bukan jumlah yang mereka
   * belanjakan: "saya butuh 5.000 ADEXTO untuk stake" adalah niat yang utuh, sementara "berapa 0G
   * untuk 5.000 ADEXTO" adalah pertanyaan yang seharusnya dijawab aplikasi, bukan pengguna.
   * Sebelum ini kolom bawah hanya teks, jadi satu-satunya cara mencapai angka tertentu adalah
   * menebak-nebak kolom atas.
   *
   * Yang TIDAK berubah: eksekusi tetap memakai `amountInput`. Mengisi kolom bawah menyelesaikan
   * masukannya lalu MENULISNYA ke `amountInput`, jadi kutipan, slippage, dan transaksinya berjalan
   * di jalur yang sama persis seperti kalau angkanya diketik di atas. Tidak ada jalur eksekusi
   * kedua yang bisa menyimpang.
   */
  outputInput: string;
  setOutputInput: (value: string) => void;
  /** Sisi mana yang terakhir disunting. Menentukan angka mana yang ditampilkan apa adanya. */
  lastEdited: "in" | "out";
  /** Diisi saat permintaan di kolom bawah melebihi yang bisa diberikan kurva. */
  outputUnreachable: boolean;
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
  /** Persen tombol porsi yang menghasilkan jumlah sekarang (100 = Max), null bila diketik/diubah. */
  activeFraction: number | null;
  /**
   * Alasan jumlah ini TIDAK BISA dikirim, atau null. Dipakai tombol utama untuk menolak lebih
   * dulu, sebelum dompet dibuka: `label` jadi teks tombol, `detail` kalimat di bawah kolom.
   *
   * - `balance`: lebih dari saldo dompet di chain pasar. Arah beli menyisakan sisa gas yang SAMA
   *   dengan tombol Max (`gasHeadroomFor`), jadi Max selalu lolos. Dulu kolom bayar menerima
   *   9.000.000.000.000.000.000 MON dengan saldo 24,9 MON, dan galatnya baru muncul sesudah Buy
   *   ditekan (owner, 5 Okt).
   * - `stock`: kolom terima meminta lebih banyak dari yang bisa diberikan kurva dalam satu trade.
   *
   * Saldo hanya dibandingkan sesudah terbaca untuk alamat ini, jadi tidak ada "Not enough" palsu
   * selama saldo masih dimuat.
   */
  limit: { kind: "balance" | "stock"; label: string; detail: string } | null;

  busy: boolean;
  statusLine: string | null;
  errorLine: string | null;
  txHash: string | null;
  setErrorLine: (message: string | null) => void;

  execute: (address: string | null) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Native yang DISISAKAN untuk gas saat menekan 25/50/75/Max, dihitung dari harga gas chain itu.
 *
 * Dulu satu konstanta 0,002 untuk semua chain, dan itu salah ke dua arah (terukur 5 Okt 2026):
 *   - chain ETH (Robinhood, Arbitrum, Base) gas-nya ~0,02 gwei; satu beli di Robinhood memakan
 *     271.024 gas = 0,0000056 ETH. Sisa 0,002 ETH lebih besar dari saldo dompet biasa di sana
 *     (0,0004–0,0017 ETH), jadi setiap tombol porsi menulis 0 dan pasar tidak bisa dibeli;
 *   - Monad 102 gwei: 400k gas = 0,04 MON, jauh di atas 0,002, jadi Max menyisakan terlalu sedikit.
 *
 * Sekarang: harga gas × 600.000 gas × 3 (ruang untuk lonjakan dan biaya data L1), dengan lantai
 * kecil. Bila harga gas tidak terbaca, dipakai cadangan per aset native.
 */
const GAS_UNITS_RESERVED = 600_000n;
const GAS_PRICE_SAFETY = 3n;
const GAS_HEADROOM_FLOOR = ethers.parseEther("0.00002");
const GAS_HEADROOM_FALLBACK: Record<string, bigint> = {
  ETH: ethers.parseEther("0.0001"),
  MON: ethers.parseEther("0.2"),
  "0G": ethers.parseEther("0.01"),
  // Arc: native USDC with 18 decimals at the native level. Base fee 20 gwei (6 Oct 2026), so
  // 600k × 20 gwei × 3 = 0.036 USDC; the fallback rounds that up.
  USDC: ethers.parseEther("0.05"),
};
/**
 * Jumlah untuk kalimat `limit`: 4 desimal di atas 1, tiga digit signifikan di bawahnya. Saldo ETH
 * di chain L2 biasanya 0,0004 dan sisa gasnya 0,00002; dengan 4 desimal tetap keduanya jadi
 * "0.0004" dan "0". en-US, seperti angka lain di formulir ini.
 */
function amountText(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return value >= 1
    ? value.toLocaleString("en-US", { maximumFractionDigits: 4 })
    : value.toLocaleString("en-US", { maximumSignificantDigits: 3 });
}
function gasHeadroomFor(nativeSymbol: string, gasPrice: bigint | null): bigint {
  if (gasPrice === null || gasPrice <= 0n) return GAS_HEADROOM_FALLBACK[nativeSymbol] ?? ethers.parseEther("0.002");
  const need = gasPrice * GAS_UNITS_RESERVED * GAS_PRICE_SAFETY;
  return need > GAS_HEADROOM_FLOOR ? need : GAS_HEADROOM_FLOOR;
}

export function useSovereignSwap(market: SwapMarket | null, address: string | null): SovereignSwap {
  const chain = useMemo(() => resolveChainOrDefault(market?.chainId ?? null), [market?.chainId]);

  const [pool, setPool] = useState<PoolState | null>(null);
  const [poolChecked, setPoolChecked] = useState(false);
  const [tokenDecimals, setTokenDecimals] = useState(18);

  const [mode, setModeState] = useState<SwapMode>("buy");
  const [amountInput, setAmountInputState] = useState("");
  const [outputDraft, setOutputDraft] = useState("");
  const [lastEdited, setLastEdited] = useState<"in" | "out">("in");
  const [outputUnreachable, setOutputUnreachable] = useState(false);
  const [slippageBps, setSlippageBps] = useState(100);

  /**
   * Menyunting sisi bayar membatalkan sisi terima, dan sebaliknya.
   *
   * Dibungkus alih-alih dipakai mentah supaya setiap tempat yang sudah menulis ke jumlah — tombol
   * porsi, Max, pembersihan sesudah transaksi sukses — otomatis mengembalikan kendali ke kolom
   * atas. Tanpa itu, menekan "Max" sesudah mengisi kolom bawah akan mengubah jumlah bayar
   * sementara kolom bawah tetap memamerkan angka lama yang sudah tidak berlaku.
   */
  const setAmountInput = useCallback((value: string) => {
    setAmountInputState(value);
    setLastEdited("in");
    setOutputDraft("");
    setOutputUnreachable(false);
    // Jumlah yang ditulis dari mana pun selain tombol porsi bukan lagi "25%"/"Max".
    setActiveFraction(null);
  }, []);
  /** Tombol porsi yang menulis jumlah sekarang (25/50/75/100), atau null. Untuk sorotan tombolnya. */
  const [activeFraction, setActiveFraction] = useState<number | null>(null);

  const [nativeBalance, setNativeBalance] = useState<bigint>(0n);
  const [tokenBalance, setTokenBalance] = useState<bigint>(0n);
  /** Harga gas chain pasar ini, untuk sisa gas tombol porsi. Null = belum/tidak terbaca. */
  const [gasPrice, setGasPrice] = useState<bigint | null>(null);

  const [busy, setBusy] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [errorLine, setErrorLine] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  // ── pool state ───────────────────────────────────────────────────────────
  /**
   * Baca pool yang GAGAL (jaringan, batas laju) dibedakan dari pool yang memang tidak ada.
   *
   * Dulu keduanya null: satu baca gagal membuat tombol "Trading unavailable" dan pesan "does not
   * expose a tradable swap interface" sampai polling 20 detik berikutnya, juga di tengah sesi
   * sesudah pool sudah terbaca (terukur 5 Okt di Monad, 8–18 dtk). Sekarang:
   * - pool terakhir yang terbaca TETAP dipakai; satu polling gagal tidak mengubah apa pun;
   * - sebelum pernah terbaca, dicoba ulang cepat (1,5 / 3 / 4,5 / 6 dtk) sambil menampilkan
   *   "Reading market…", dan baru sesudah itu dinyatakan gagal, dengan pesan yang benar.
   */
  const [poolReadFailed, setPoolReadFailed] = useState(false);
  const poolRetry = useRef<{ key: string | null; attempts: number; timer: ReturnType<typeof setTimeout> | null }>({
    key: null,
    attempts: 0,
    timer: null,
  });
  const loadPoolRef = useRef<() => void>(() => {});
  const loadPool = useCallback(async () => {
    const key = market?.poolAddress ? `${chain.chainId}:${market.poolAddress.toLowerCase()}` : null;
    if (poolRetry.current.key !== key) {
      if (poolRetry.current.timer) clearTimeout(poolRetry.current.timer);
      poolRetry.current = { key, attempts: 0, timer: null };
    }
    if (!market?.poolAddress) {
      setPool(null);
      setPoolChecked(true);
      return;
    }
    try {
      const state = await readPoolStateStrict(chain, market.poolAddress);
      if (poolRetry.current.key !== key) return;
      poolRetry.current.attempts = 0;
      setPool(state);
      if (state) setTokenDecimals(state.tokenDecimals);
      setPoolReadFailed(false);
      setPoolChecked(true);
    } catch {
      const retry = poolRetry.current;
      if (retry.key !== key) return;
      if (retry.attempts < 4) {
        if (!retry.timer) {
          retry.attempts += 1;
          retry.timer = setTimeout(() => {
            retry.timer = null;
            loadPoolRef.current();
          }, 1500 * retry.attempts);
        }
        return;
      }
      // Ulangan cepat habis. Pool yang pernah terbaca tetap berlaku; kalau belum pernah, katakan.
      setPoolReadFailed(true);
      setPoolChecked(true);
    }
  }, [chain, market?.poolAddress]);
  loadPoolRef.current = loadPool;

  useEffect(() => {
    setPoolChecked(false);
    setPool(null);
    setPoolReadFailed(false);
    loadPool();
    const timer = setInterval(loadPool, 20000);
    return () => {
      clearInterval(timer);
      if (poolRetry.current.timer) clearTimeout(poolRetry.current.timer);
      // Baca yang masih berjalan untuk pool ini tidak lagi menulis apa pun.
      poolRetry.current = { key: null, attempts: 0, timer: null };
    };
  }, [loadPool]);

  // ── balances ─────────────────────────────────────────────────────────────
  /**
   * Untuk alamat/pasar mana saldo native dan saldo token terakhir terbaca. Lihat `limit`.
   *
   * Terpisah, karena RPC publik bisa menjawab yang satu dan menolak yang lain: terukur 5 Okt di
   * halaman token Monad, `getBalance` dijawab dan `balanceOf` gagal (batas laju rpc1.monad.xyz).
   * Arah beli hanya butuh saldo native.
   */
  const balanceKey =
    address && market ? `${address.toLowerCase()}:${market.chainId}:${market.tokenAddress.toLowerCase()}` : null;
  const [nativeFor, setNativeFor] = useState<string | null>(null);
  const [tokenFor, setTokenFor] = useState<string | null>(null);
  const balanceRetry = useRef<{ key: string | null; attempts: number; timer: ReturnType<typeof setTimeout> | null }>({
    key: null,
    attempts: 0,
    timer: null,
  });
  const loadBalancesRef = useRef<() => void>(() => {});
  const loadBalances = useCallback(async () => {
    if (balanceRetry.current.key !== balanceKey) {
      // Alamat atau pasar lain: saldo yang tampil bukan miliknya lagi.
      if (balanceRetry.current.timer) clearTimeout(balanceRetry.current.timer);
      balanceRetry.current = { key: balanceKey, attempts: 0, timer: null };
      setNativeBalance(0n);
      setTokenBalance(0n);
      setNativeFor(null);
      setTokenFor(null);
      setGasPrice(null);
    }
    if (!address || !market || !balanceKey) return;
    const key = balanceKey;
    const provider = readProvider(chain);
    // Harga gas dibaca bersama saldo; gagal membacanya tidak menggagalkan saldo (sisa gas jatuh ke
    // cadangan per aset, lihat `gasHeadroomFor`).
    provider
      .send("eth_gasPrice", [])
      .then((hex: string) => {
        if (balanceRetry.current.key === key) setGasPrice(BigInt(hex));
      })
      .catch(() => {});
    const erc20 = new ethers.Contract(market.tokenAddress, ERC20_ABI, provider);
    const [native, token] = await Promise.allSettled([
      provider.getBalance(address),
      Promise.all([erc20.balanceOf(address), erc20.decimals()]),
    ]);
    const state = balanceRetry.current;
    if (state.key !== key) return;
    if (native.status === "fulfilled") {
      setNativeBalance(BigInt(native.value));
      setNativeFor(key);
    }
    if (token.status === "fulfilled") {
      setTokenBalance(BigInt(token.value[0]));
      setTokenDecimals(Number(token.value[1]));
      setTokenFor(key);
    }
    if (native.status === "fulfilled" && token.status === "fulfilled") {
      state.attempts = 0;
      return;
    }
    // Dulu bacaan yang gagal tidak diulang: saldo tetap 0 sampai halaman dimuat ulang, dan batas
    // saldo tidak pernah berlaku. Sekarang diulang dengan jeda 2, 4, 6 … detik, paling banyak 8 kali.
    if (state.attempts >= 8 || state.timer) return;
    state.attempts += 1;
    state.timer = setTimeout(() => {
      state.timer = null;
      loadBalancesRef.current();
    }, 2000 * state.attempts);
  }, [address, balanceKey, chain, market]);
  loadBalancesRef.current = loadBalances;

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);
  useEffect(
    () => () => {
      if (balanceRetry.current.timer) clearTimeout(balanceRetry.current.timer);
      // Bacaan yang masih berjalan tidak lagi menulis saldo atau menjadwalkan ulangan.
      balanceRetry.current = { key: null, attempts: 0, timer: null };
    },
    []
  );

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

  /**
   * Menyelesaikan sisi masukan dari keluaran yang diminta, lalu MENULISNYA ke `amountInput`.
   *
   * Hasilnya sengaja dibulatkan ke atas ke 6 desimal sebelum ditulis. Jawaban solver presisi wei,
   * dan menampilkan `0.000123456789012345` di kolom yang dibaca manusia tidak membantu siapa pun;
   * dibulatkan ke ATAS, bukan ke bawah, supaya jumlah yang ditampilkan tetap mencapai target
   * alih-alih kurang satu satuan terkecil darinya.
   */
  const solveFromOutput = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed || Number(trimmed) <= 0 || !Number.isFinite(Number(trimmed))) {
        setAmountInputState("");
        setOutputUnreachable(false);
        return;
      }
      if (!pool) return;

      let wanted: bigint;
      try {
        wanted = mode === "buy" ? ethers.parseUnits(trimmed, tokenDecimals) : ethers.parseEther(trimmed);
      } catch {
        return;
      }

      const solved =
        mode === "buy" ? solveBuyForTokensOut(pool, wanted) : solveSellForNativeOut(pool, wanted);
      if (solved === null || solved <= 0n) {
        setOutputUnreachable(true);
        setAmountInputState("");
        return;
      }
      setOutputUnreachable(false);

      // Dibulatkan ke atas pada 6 desimal: satu unit terakhir ditambahkan kalau ada sisa.
      const unitsPerDisplay = mode === "buy" ? 10n ** 12n : 10n ** BigInt(Math.max(0, tokenDecimals - 6));
      const rounded = solved % unitsPerDisplay === 0n ? solved : (solved / unitsPerDisplay + 1n) * unitsPerDisplay;
      setAmountInputState(
        mode === "buy" ? ethers.formatEther(rounded) : ethers.formatUnits(rounded, tokenDecimals)
      );
    },
    [pool, mode, tokenDecimals]
  );

  const setOutputInput = useCallback(
    (value: string) => {
      setOutputDraft(value);
      setLastEdited("out");
      setActiveFraction(null);
      solveFromOutput(value);
    },
    [solveFromOutput]
  );

  /**
   * Kolam bergerak, jadi jawaban yang diselesaikan lima detik lalu bisa sudah tidak cukup.
   *
   * Diselesaikan ulang setiap kali state kolam terbaca ulang, TAPI hanya selama sisi terima yang
   * dipegang pengguna. Kalau tidak, penyegaran kolam akan menimpa jumlah yang baru saja mereka
   * ketik di kolom atas.
   */
  useEffect(() => {
    if (lastEdited !== "out" || !outputDraft) return;
    solveFromOutput(outputDraft);
    // `solveFromOutput` sudah bergantung pada pool dan mode, jadi identitasnya berubah saat
    // keduanya berubah — itulah pemicu yang diinginkan di sini.
  }, [solveFromOutput, lastEdited, outputDraft]);

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
    if (!pool && poolReadFailed) {
      return `${chain.name} did not answer when this market was read. Trying again every 20 seconds.`;
    }
    if (!pool) return `The address recorded for ${market.symbol} does not expose a tradable swap interface.`;
    // Kurva sudah bisa diperdagangkan sejak blok pertama tanpa setoran apa pun, jadi
    // "belum di-seed" bukan lagi penjelasan yang benar untuk keadaan ini.
    if (!pool.initialized) return "The market exists but has not been initialised yet.";
    return "Pool is live.";
  }, [market, chain, pool, poolChecked, poolReadFailed]);

  // ── actions ──────────────────────────────────────────────────────────────
  const setMode = useCallback(
    (next: SwapMode) => {
      setModeState(next);
      setAmountInput("");
      setErrorLine(null);
      setStatusLine(null);
      setTxHash(null);
    },
    [setAmountInput]
  );

  const setAmountFraction = useCallback(
    (percent: number) => {
      // Dijepit ke 1..100. Nilai di luar itu hanya bisa datang dari bug pemanggil,
      // dan menuliskan jumlah negatif ke kolom input akan lolos ke parser.
      const pct = BigInt(Math.max(1, Math.min(100, Math.round(percent))));
      if (mode === "buy") {
        const headroom = gasHeadroomFor(chain.nativeSymbol, gasPrice);
        const usable = nativeBalance > headroom ? nativeBalance - headroom : 0n;
        // Dihitung dalam bigint, bukan lewat float. Mengalikan saldo wei sebagai
        // Number kehilangan presisi di atas 2^53 dan menghasilkan jumlah yang
        // sedikit berbeda dari yang ditampilkan.
        const part = (usable * pct) / 100n;
        setAmountInput(part > 0n ? ethers.formatEther(part) : "0");
      } else {
        const part = (tokenBalance * pct) / 100n;
        setAmountInput(part > 0n ? ethers.formatUnits(part, tokenDecimals) : "0");
      }
      // Sesudah `setAmountInput` (yang mengosongkannya), jadi sorotan jatuh ke tombol ini.
      setActiveFraction(Number(pct));
    },
    [mode, nativeBalance, tokenBalance, tokenDecimals, chain.nativeSymbol, gasPrice, setAmountInput]
  );

  const setMaxAmount = useCallback(() => setAmountFraction(100), [setAmountFraction]);

  const nativeReady = balanceKey !== null && nativeFor === balanceKey;
  const tokenReady = balanceKey !== null && tokenFor === balanceKey;
  const limit = useMemo((): SovereignSwap["limit"] => {
    if (!market) return null;
    const symbol = mode === "buy" ? chain.nativeSymbol : market.symbol;
    if (mode === "buy" && lastEdited === "out" && outputUnreachable && pool) {
      const left = Number(ethers.formatUnits(pool.reserveToken, tokenDecimals));
      return {
        kind: "stock",
        label: "More than the curve holds",
        detail: `The curve holds ${left.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${market.symbol}, and one trade cannot take all of it. Ask for less.`,
      };
    }
    if (parsedAmount <= 0n || !(mode === "buy" ? nativeReady : tokenReady)) return null;
    if (mode === "buy") {
      // Sisa gas yang sama dengan tombol Max, jadi jumlah dari Max tidak pernah ditolak di sini.
      const headroom = gasHeadroomFor(chain.nativeSymbol, gasPrice);
      const usable = nativeBalance > headroom ? nativeBalance - headroom : 0n;
      if (parsedAmount > usable) {
        const have = amountText(Number(ethers.formatEther(nativeBalance)));
        const keep = amountText(Number(ethers.formatEther(headroom)));
        return {
          kind: "balance",
          label: `Not enough ${symbol}`,
          detail: `This wallet holds ${have} ${symbol} on ${chain.name}. Keep about ${keep} ${symbol} for gas.`,
        };
      }
    } else if (parsedAmount > tokenBalance) {
      const have = amountText(Number(ethers.formatUnits(tokenBalance, tokenDecimals)));
      return { kind: "balance", label: `Not enough ${symbol}`, detail: `This wallet holds ${have} ${symbol}.` };
    }
    return null;
  }, [market, mode, chain, lastEdited, outputUnreachable, pool, tokenDecimals, nativeReady, tokenReady, parsedAmount, nativeBalance, tokenBalance, gasPrice]);

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
      // Tombol sudah menolak keadaan ini; penjaga ini untuk pemanggil lain.
      if (limit) {
        setErrorLine(limit.detail);
        return;
      }

      setBusy(true);
      try {
        // Wajib provider TERPILIH, bukan `window.ethereum`. Kalau user punya
        // beberapa wallet, `window.ethereum` adalah pemenang lomba injeksi dan
        // transaksi bisa dikirim dari wallet yang bukan pilihannya.
        const ethereum = getActiveEip1193();
        if (!ethereum) throw new Error("No wallet available. Connect a wallet first.");
        // Perujuk dari tautan `?ref=` yang pernah dibuka (P2.5). Null = trade tanpa atribusi.
        const referral = await referrerFor(walletAddress);
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
            referrer: referral?.address ?? null,
          });
          setTxHash(result.txHash);
          if (referral) reportReferredTrade({ txHash: result.txHash, chainId: chain.chainId, code: referral.code });
          setStatusLine(
            `Received ${Number(ethers.formatUnits(result.amountOut, tokenDecimals)).toLocaleString("en-US", {
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
            referrer: referral?.address ?? null,
          });
          setTxHash(result.txHash);
          if (referral) reportReferredTrade({ txHash: result.txHash, chainId: chain.chainId, code: referral.code });
          setStatusLine(`Received ${Number(ethers.formatEther(result.amountOut)).toFixed(6)} ${chain.nativeSymbol}.`);
        }

        setAmountInput("");
        await Promise.all([loadBalances(), loadPool()]);
      } catch (error) {
        setStatusLine(null);
        setErrorLine(describeTxError(error, chain));
      } finally {
        setBusy(false);
      }
    },
    [market, mode, chain, parsedAmount, quote, minReceived, tradable, poolStatusMessage, tokenDecimals, loadBalances, loadPool, limit]
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
    outputInput: outputDraft,
    setOutputInput,
    lastEdited,
    outputUnreachable,
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
    // "en-US" seperti `formatTokenAmount`: angka di formulir ini memakai titik desimal di semua locale.
    tokenBalanceFormatted: Number(ethers.formatUnits(tokenBalance, tokenDecimals)).toLocaleString("en-US", {
      maximumFractionDigits: 4,
    }),
    setAmountFraction,
    setMaxAmount,
    activeFraction,
    limit,

    busy,
    statusLine,
    errorLine,
    txHash,
    setErrorLine,

    execute,
    refresh,
  };
}
