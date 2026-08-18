/**
 * Sovereign DEX client.
 *
 * What this replaces: both /swap and /token/[slug] used to "trade" by sending a
 * bare native transfer to a contract address with no calldata —
 * `signer.sendTransaction({ to: hookAddress, value: parseEther(amount) })`. That
 * had four defects, all fixed here:
 *
 *   1. No calldata, so no swap ever executed and no token was received. On top of
 *      that the legacy hook has no `receive()`, so an `estimateGas` against it
 *      reverts: the user paid gas for nothing. Every trade now goes through
 *      `buy()` / `sell()` and is simulated with `staticCall` first.
 *   2. SELL sent the same `value` as BUY, so entering 50000 in the sell box asked
 *      the wallet to send 50,000 native coins. Selling now pulls ERC-20 via
 *      `approve` + `transferFrom` and sends zero native.
 *   3. No slippage or deadline. Both are now enforced on-chain.
 *   4. No chain guard: a wallet on 0G would happily send native to an Arbitrum
 *      address. `ensureWalletChain` switches (or adds) the network first.
 */
import { ethers } from "ethers";
import type { ChainInfo } from "@/lib/chains";
import { toHexChainId } from "@/lib/chains";

export const SOVEREIGN_HOOK_ABI = [
  "function initialized() view returns (bool)",
  "function targetToken() view returns (address)",
  "function getReserves() view returns (uint256 reserveNative, uint256 reserveToken)",
  "function lpFeeBps() view returns (uint256)",
  "function treasuryBuybackBps() view returns (uint256)",
  "function treasuryNative() view returns (uint256)",
  "function totalTokensBurned() view returns (uint256)",
  "function totalVolumeNative() view returns (uint256)",
  "function swapCount() view returns (uint256)",
  "function spotPriceNativePerToken() view returns (uint256)",
  "function getBuyQuote(uint256 nativeIn) view returns (uint256 tokensOut, uint256 lpFee, uint256 treasuryFee)",
  "function getSellQuote(uint256 tokenIn) view returns (uint256 nativeOut, uint256 lpFee, uint256 treasuryFee)",
  "function buy(uint256 minTokensOut, address to, uint256 deadline) payable returns (uint256)",
  "function sell(uint256 tokenAmountIn, uint256 minNativeOut, address to, uint256 deadline) returns (uint256)",
  "event Swap(address indexed trader, address indexed recipient, bool isBuy, uint256 amountIn, uint256 amountOut, uint256 lpFee, uint256 treasuryFee, uint256 reserveNativeAfter, uint256 reserveTokenAfter)",
];

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
];

/**
 * SovereignCurve. Intentionally overlaps SovereignHook for the shared reads and
 * for `buy`/`sell`, so the trading surfaces did not need forking. The differences
 * that matter: quotes return a fourth value (the creator share), and the curve
 * exposes its virtual reserve, real balance and creator accounting.
 */
export const SOVEREIGN_CURVE_ABI = [
  "function initialized() view returns (bool)",
  "function targetToken() view returns (address)",
  "function getReserves() view returns (uint256 reserveNative, uint256 reserveToken)",
  "function lpFeeBps() view returns (uint256)",
  "function depthFeeBps() view returns (uint256)",
  "function creatorFeeBps() view returns (uint256)",
  "function treasuryBuybackBps() view returns (uint256)",
  "function virtualNative() view returns (uint256)",
  "function realNative() view returns (uint256)",
  "function tokensSold() view returns (uint256)",
  "function curveTokens() view returns (uint256)",
  "function creator() view returns (address)",
  "function creatorOwed() view returns (uint256)",
  "function totalCreatorFeesPaid() view returns (uint256)",
  "function treasuryNative() view returns (uint256)",
  "function totalTokensBurned() view returns (uint256)",
  "function totalVolumeNative() view returns (uint256)",
  "function swapCount() view returns (uint256)",
  "function spotPriceNativePerToken() view returns (uint256)",
  "function floorPriceNativePerToken() view returns (uint256)",
  "function getBuyQuote(uint256 nativeIn) view returns (uint256 tokensOut, uint256 depthFee, uint256 creatorFee, uint256 treasuryFee)",
  "function getSellQuote(uint256 tokenIn) view returns (uint256 nativeOut, uint256 depthFee, uint256 creatorFee, uint256 treasuryFee)",
  "function buy(uint256 minTokensOut, address to, uint256 deadline) payable returns (uint256)",
  "function sell(uint256 tokenAmountIn, uint256 minNativeOut, address to, uint256 deadline) returns (uint256)",
  "function claimCreatorFees() returns (uint256)",
  "event Swap(address indexed trader, address indexed recipient, bool isBuy, uint256 amountIn, uint256 amountOut, uint256 depthFee, uint256 creatorFee, uint256 treasuryFee, uint256 nativeReserveAfter, uint256 tokenReserveAfter)",
];

/**
 * FactoryV3. Not payable: requiring native to launch is exactly the barrier this
 * generation removes. `virtualNative` equals the opening market cap in native
 * terms because 100% of supply enters the curve.
 */
export const FACTORY_V3_ABI = [
  "function deployTrinity(string name, string symbol, uint256 initialSupply, address agentIdentity, uint256 virtualNative, uint256 swapFeeBps, uint256 creatorShareBps, uint256 treasuryShareBps, bytes32 teeAttestationRoot) returns (address token, address curve)",
  "function isSymbolAvailable(string symbol) view returns (bool)",
  "function totalProjectsCount() view returns (uint256)",
  "function curveOf(address token) view returns (address)",
  "event TrinityProjectDeployed(address indexed token, address indexed curve, address indexed creator, string name, string symbol, uint256 initialSupply, uint256 curveTokens, uint256 virtualNative, uint256 depthFeeBps, uint256 creatorFeeBps, uint256 treasuryBuybackBps, bytes32 teeAttestationRoot)",
];

export const FACTORY_V2_ABI = [
  "function deployTrinityProject(string name, string symbol, uint256 initialSupply, address agentIdentity, uint256 swapFeeBps, uint256 treasuryShareBps, bytes32 teeAttestationRoot, uint256 poolTokenBps) payable returns (address token, address pool)",
  "function isSymbolAvailable(string symbol) view returns (bool)",
  "function totalProjectsCount() view returns (uint256)",
  "event TrinityProjectDeployed(address indexed token, address indexed pool, address indexed creator, string name, string symbol, uint256 initialSupply, uint256 poolTokenAmount, uint256 poolNativeAmount, uint256 swapFeeBps, uint256 treasuryShareBps, bytes32 teeAttestationRoot)",
];

export const BPS = 10_000n;
export const DEFAULT_SLIPPAGE_BPS = 100; // 1%
export const DEFAULT_DEADLINE_SECONDS = 600;

export interface PoolState {
  poolAddress: string;
  tokenAddress: string;
  initialized: boolean;
  reserveNative: bigint;
  reserveToken: bigint;
  /** Depth share of the fee. Named lpFeeBps for continuity; it is retained by the curve. */
  lpFeeBps: bigint;
  treasuryBuybackBps: bigint;
  tokenDecimals: number;
  spotPriceNative: number;

  // ── Bonding curve extras. Zero/false when the venue is a legacy seeded pool. ──
  /** True when the venue is a SovereignCurve rather than a seeded SovereignHook. */
  isCurve: boolean;
  /** Share of the fee streamed to the creator. */
  creatorFeeBps: bigint;
  /** Virtual native reserve; never real money. Sets the opening price. */
  virtualNative: bigint;
  /** Real native actually held for the curve. */
  realNative: bigint;
  /** Native accrued to the creator, claimable. */
  creatorOwed: bigint;
  /** Immutable fee recipient. */
  creator: string | null;
  /** Lowest price the curve can return to; rises as depth fees settle. */
  floorPriceNative: number;
}

export interface Quote {
  amountOut: bigint;
  /** Depth portion, retained by the curve. */
  lpFee: bigint;
  /** Streamed to the creator. */
  creatorFee: bigint;
  treasuryFee: bigint;
  priceImpactBps: number;
}

/**
 * Read pool state. Returns null when the address is not a v2 SovereignHook
 * (e.g. the legacy hook), which the UI must surface as "DEX not live".
 */
export async function readPoolState(chain: ChainInfo, poolAddress: string): Promise<PoolState | null> {
  if (!poolAddress || !/^0x[a-fA-F0-9]{40}$/.test(poolAddress)) return null;
  try {
    const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
    const pool = new ethers.Contract(poolAddress, SOVEREIGN_CURVE_ABI, provider);

    const [initialized, tokenAddress, reserves, lpFeeBps, treasuryBuybackBps] = await Promise.all([
      pool.initialized(),
      pool.targetToken(),
      pool.getReserves(),
      pool.lpFeeBps(),
      pool.treasuryBuybackBps(),
    ]);

    if (!tokenAddress || tokenAddress === ethers.ZeroAddress) return null;

    /**
     * Curve-only reads. A seeded SovereignHook does not have these, so the calls
     * revert and the venue is treated as a legacy pool with zeroed extras. This
     * is how one code path serves both generations without a flag from the caller.
     */
    let isCurve = false;
    let creatorFeeBps = 0n;
    let virtualNative = 0n;
    let realNative = 0n;
    let creatorOwed = 0n;
    let creator: string | null = null;
    let floorPriceRaw = 0n;
    try {
      const [cf, vn, rn, owed, who, floor] = await Promise.all([
        pool.creatorFeeBps(),
        pool.virtualNative(),
        pool.realNative(),
        pool.creatorOwed(),
        pool.creator(),
        pool.floorPriceNativePerToken(),
      ]);
      isCurve = true;
      creatorFeeBps = BigInt(cf);
      virtualNative = BigInt(vn);
      realNative = BigInt(rn);
      creatorOwed = BigInt(owed);
      creator = who;
      floorPriceRaw = BigInt(floor);
    } catch {
      isCurve = false;
    }

    let tokenDecimals = 18;
    try {
      tokenDecimals = Number(await new ethers.Contract(tokenAddress, ERC20_ABI, provider).decimals());
    } catch {
      tokenDecimals = 18;
    }

    const reserveNative = BigInt(reserves[0]);
    const reserveToken = BigInt(reserves[1]);
    const spotPriceNative =
      reserveToken > 0n ? Number(ethers.formatEther(reserveNative)) / Number(ethers.formatUnits(reserveToken, tokenDecimals)) : 0;

    return {
      poolAddress,
      tokenAddress,
      initialized: Boolean(initialized),
      reserveNative,
      reserveToken,
      lpFeeBps: BigInt(lpFeeBps),
      treasuryBuybackBps: BigInt(treasuryBuybackBps),
      tokenDecimals,
      spotPriceNative,
      isCurve,
      creatorFeeBps,
      virtualNative,
      realNative,
      creatorOwed,
      creator,
      floorPriceNative: Number(ethers.formatEther(floorPriceRaw)),
    };
  } catch {
    return null;
  }
}

/**
 * Mirrors `getBuyQuote` exactly so the UI can quote without an RPC hop.
 *
 * The creator share is part of the same total, so it must be deducted from the
 * amount that moves along the curve. Leaving it out would over-quote every trade
 * by the creator fee and the on-chain result would not match what the user saw.
 */
export function quoteBuyLocal(state: PoolState, nativeIn: bigint): Quote {
  if (!state.initialized || nativeIn <= 0n) {
    return { amountOut: 0n, lpFee: 0n, creatorFee: 0n, treasuryFee: 0n, priceImpactBps: 0 };
  }
  const lpFee = (nativeIn * state.lpFeeBps) / BPS;
  const creatorFee = (nativeIn * state.creatorFeeBps) / BPS;
  const treasuryFee = (nativeIn * state.treasuryBuybackBps) / BPS;
  const inAfterFee = nativeIn - lpFee - creatorFee - treasuryFee;
  const amountOut = (state.reserveToken * inAfterFee) / (state.reserveNative + inAfterFee);
  return {
    amountOut,
    lpFee,
    creatorFee,
    treasuryFee,
    priceImpactBps: impactBps(inAfterFee, state.reserveNative),
  };
}

/** Mirrors `getSellQuote` exactly: fees come off the output. */
export function quoteSellLocal(state: PoolState, tokenIn: bigint): Quote {
  if (!state.initialized || tokenIn <= 0n) {
    return { amountOut: 0n, lpFee: 0n, creatorFee: 0n, treasuryFee: 0n, priceImpactBps: 0 };
  }
  const grossOut = (state.reserveNative * tokenIn) / (state.reserveToken + tokenIn);
  const lpFee = (grossOut * state.lpFeeBps) / BPS;
  const creatorFee = (grossOut * state.creatorFeeBps) / BPS;
  const treasuryFee = (grossOut * state.treasuryBuybackBps) / BPS;
  return {
    amountOut: grossOut - lpFee - creatorFee - treasuryFee,
    lpFee,
    creatorFee,
    treasuryFee,
    priceImpactBps: impactBps(tokenIn, state.reserveToken),
  };
}

/** Claim accrued creator fees. Funds can only go to the curve's immutable creator. */
export async function claimCreatorFees(params: {
  ethereum: any;
  chain: ChainInfo;
  curveAddress: string;
}): Promise<{ hash: string }> {
  const { ethereum, chain, curveAddress } = params;
  await ensureWalletChain(ethereum, chain);
  const provider = new ethers.BrowserProvider(ethereum);
  const signer = await provider.getSigner();
  const curve = new ethers.Contract(curveAddress, SOVEREIGN_CURVE_ABI, signer);
  const tx = await curve.claimCreatorFees();
  const receipt = await tx.wait();
  return { hash: receipt?.hash ?? tx.hash };
}

function impactBps(amountIn: bigint, reserveIn: bigint): number {
  if (reserveIn <= 0n) return 0;
  return Number((amountIn * BPS) / (reserveIn + amountIn));
}

export function applySlippage(amountOut: bigint, slippageBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(5000, Math.round(slippageBps))));
  return (amountOut * (BPS - bps)) / BPS;
}

export function deadlineFromNow(seconds = DEFAULT_DEADLINE_SECONDS): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + seconds);
}

// ─── Chain guard ───────────────────────────────────────────────────────────

export class ChainMismatchError extends Error {
  constructor(public readonly expected: ChainInfo, public readonly actual: number | null) {
    super(
      `Wallet is on chain ${actual ?? "unknown"} but this market lives on ${expected.name} (${expected.chainId}). ` +
        `Switch networks before trading.`
    );
    this.name = "ChainMismatchError";
  }
}

/**
 * Make sure the injected wallet is on `chain` before any transaction is built.
 * Requests a switch, and registers the network if the wallet does not know it.
 */
export async function ensureWalletChain(ethereum: any, chain: ChainInfo): Promise<void> {
  if (!ethereum) throw new Error("No Web3 wallet detected. Install MetaMask, Rabby or Coinbase Wallet.");

  const current = await ethereum.request({ method: "eth_chainId" });
  const currentId = typeof current === "string" ? parseInt(current, 16) : Number(current);
  if (currentId === chain.chainId) return;

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: toHexChainId(chain.chainId) }],
    });
  } catch (error: any) {
    if (error?.code === 4902 || /Unrecognized chain/i.test(error?.message || "")) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: toHexChainId(chain.chainId),
            chainName: chain.name,
            rpcUrls: [chain.rpcUrl],
            blockExplorerUrls: [chain.blockExplorer],
            nativeCurrency: { name: chain.nativeCurrencyName, symbol: chain.nativeSymbol, decimals: 18 },
          },
        ],
      });
    } else if (error?.code === 4001) {
      throw new Error(`Network switch to ${chain.name} was rejected. Trading is blocked until the wallet is on ${chain.name}.`);
    } else {
      throw error;
    }
  }

  const after = await ethereum.request({ method: "eth_chainId" });
  const afterId = typeof after === "string" ? parseInt(after, 16) : Number(after);
  if (afterId !== chain.chainId) throw new ChainMismatchError(chain, afterId);
}

// ─── Trade execution ───────────────────────────────────────────────────────

export interface TradeResult {
  txHash: string;
  amountIn: bigint;
  amountOut: bigint;
  blockNumber: number | null;
}

async function eip1559Overrides(provider: ethers.BrowserProvider) {
  const feeData = await provider.getFeeData();
  if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
    return {
      maxFeePerGas: (feeData.maxFeePerGas * 125n) / 100n,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
    };
  }
  if (feeData.gasPrice) return { gasPrice: (feeData.gasPrice * 120n) / 100n };
  return {};
}

export async function executeBuy(params: {
  ethereum: any;
  chain: ChainInfo;
  poolAddress: string;
  amountInWei: bigint;
  minTokensOut: bigint;
  recipient?: string;
  deadlineSeconds?: number;
}): Promise<TradeResult> {
  const { ethereum, chain, poolAddress, amountInWei, minTokensOut } = params;
  if (amountInWei <= 0n) throw new Error("Enter an amount greater than zero.");

  await ensureWalletChain(ethereum, chain);

  const provider = new ethers.BrowserProvider(ethereum);
  const signer = await provider.getSigner();
  const to = params.recipient ?? (await signer.getAddress());
  const pool = new ethers.Contract(poolAddress, SOVEREIGN_HOOK_ABI, signer);
  const deadline = deadlineFromNow(params.deadlineSeconds);

  const balance = await provider.getBalance(await signer.getAddress());
  if (balance <= amountInWei) {
    throw new Error(
      `Insufficient ${chain.nativeSymbol}: balance ${ethers.formatEther(balance)}, trade needs ${ethers.formatEther(amountInWei)} plus gas.`
    );
  }

  // Simulate before signing so a reverting trade never costs gas.
  let simulatedOut: bigint;
  try {
    simulatedOut = await pool.buy.staticCall(minTokensOut, to, deadline, { value: amountInWei });
  } catch (error) {
    throw new Error(`Trade would fail on-chain: ${describeTxError(error)}`);
  }

  const overrides = await eip1559Overrides(provider);
  let gasLimit: bigint | undefined;
  try {
    const estimate = await pool.buy.estimateGas(minTokensOut, to, deadline, { value: amountInWei });
    gasLimit = (estimate * 120n) / 100n;
  } catch {
    gasLimit = undefined;
  }

  const tx = await pool.buy(minTokensOut, to, deadline, { value: amountInWei, ...overrides, ...(gasLimit ? { gasLimit } : {}) });
  const receipt = await tx.wait();
  if (receipt?.status === 0) throw new Error("Transaction reverted on-chain.");

  return {
    txHash: receipt?.hash ?? tx.hash,
    amountIn: amountInWei,
    amountOut: parseSwapOut(receipt, pool.interface) ?? simulatedOut,
    blockNumber: receipt?.blockNumber ?? null,
  };
}

export async function executeSell(params: {
  ethereum: any;
  chain: ChainInfo;
  poolAddress: string;
  tokenAddress: string;
  amountInTokens: bigint;
  minNativeOut: bigint;
  recipient?: string;
  deadlineSeconds?: number;
  onApproval?: (txHash: string) => void;
}): Promise<TradeResult> {
  const { ethereum, chain, poolAddress, tokenAddress, amountInTokens, minNativeOut } = params;
  if (amountInTokens <= 0n) throw new Error("Enter a token amount greater than zero.");

  await ensureWalletChain(ethereum, chain);

  const provider = new ethers.BrowserProvider(ethereum);
  const signer = await provider.getSigner();
  const owner = await signer.getAddress();
  const to = params.recipient ?? owner;

  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const pool = new ethers.Contract(poolAddress, SOVEREIGN_HOOK_ABI, signer);

  const balance: bigint = await token.balanceOf(owner);
  if (balance < amountInTokens) {
    const decimals = Number(await token.decimals().catch(() => 18));
    throw new Error(
      `Insufficient token balance: you hold ${ethers.formatUnits(balance, decimals)} but tried to sell ${ethers.formatUnits(amountInTokens, decimals)}.`
    );
  }

  // ERC-20 selling needs an allowance. This is the step the old code skipped.
  const allowance: bigint = await token.allowance(owner, poolAddress);
  if (allowance < amountInTokens) {
    const approveTx = await token.approve(poolAddress, amountInTokens);
    params.onApproval?.(approveTx.hash);
    const approveReceipt = await approveTx.wait();
    if (approveReceipt?.status === 0) throw new Error("Token approval reverted.");
  }

  const deadline = deadlineFromNow(params.deadlineSeconds);

  let simulatedOut: bigint;
  try {
    simulatedOut = await pool.sell.staticCall(amountInTokens, minNativeOut, to, deadline);
  } catch (error) {
    throw new Error(`Trade would fail on-chain: ${describeTxError(error)}`);
  }

  const overrides = await eip1559Overrides(provider);
  let gasLimit: bigint | undefined;
  try {
    const estimate = await pool.sell.estimateGas(amountInTokens, minNativeOut, to, deadline);
    gasLimit = (estimate * 120n) / 100n;
  } catch {
    gasLimit = undefined;
  }

  const tx = await pool.sell(amountInTokens, minNativeOut, to, deadline, { ...overrides, ...(gasLimit ? { gasLimit } : {}) });
  const receipt = await tx.wait();
  if (receipt?.status === 0) throw new Error("Transaction reverted on-chain.");

  return {
    txHash: receipt?.hash ?? tx.hash,
    amountIn: amountInTokens,
    amountOut: parseSwapOut(receipt, pool.interface) ?? simulatedOut,
    blockNumber: receipt?.blockNumber ?? null,
  };
}

function parseSwapOut(receipt: ethers.TransactionReceipt | null, iface: ethers.Interface): bigint | null {
  if (!receipt) return null;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === "Swap") return BigInt(parsed.args.amountOut);
    } catch {
      // not our event
    }
  }
  return null;
}

/** Turn provider/contract errors into something a trader can act on. */
export function describeTxError(error: any): string {
  if (!error) return "Unknown error";
  if (error.code === 4001 || /user rejected|user denied/i.test(error.message || "")) {
    return "Rejected in wallet.";
  }

  const raw =
    error.reason ||
    error.shortMessage ||
    error.info?.error?.message ||
    error.data?.message ||
    error.error?.message ||
    error.message ||
    String(error);

  const cleaned = String(raw).replace(/^execution reverted:?\s*/i, "").trim();

  if (/SovereignHook: pool not initialized/i.test(cleaned)) {
    return "This pool has no liquidity yet, so it cannot quote or settle a trade.";
  }
  if (/SovereignHook: slippage/i.test(cleaned)) {
    return "Price moved beyond your slippage tolerance. Retry or raise the tolerance.";
  }
  if (/SovereignHook: expired/i.test(cleaned)) {
    return "The quote expired before the transaction landed. Try again.";
  }
  if (/approve the pool before selling/i.test(cleaned)) {
    return "The pool is not approved to move your tokens yet. Approve, then sell.";
  }
  if (/Anti-sniper/i.test(cleaned)) {
    return "Anti-sniper limit: this trade exceeds 1% of supply during the launch window. Reduce the size or wait a few blocks.";
  }
  if (/insufficient (token|native) liquidity/i.test(cleaned)) {
    return "Trade is too large for the current pool depth.";
  }
  if (/missing revert data|no data present|CALL_EXCEPTION/i.test(cleaned)) {
    return (
      "The contract rejected the call without returning a reason. Common causes: this address exposes no swap " +
      "entrypoint, the trade exceeds the token's anti-sniper transfer limit during the launch window, or the size " +
      "is larger than the pool can fill."
    );
  }
  return cleaned.slice(0, 220) || "Transaction failed";
}

export function poolIsTradable(state: PoolState | null): boolean {
  return Boolean(state && state.initialized && state.reserveNative > 0n && state.reserveToken > 0n);
}
