/**
 * Transaksi tak bertanda tangan untuk agen: stake dan klaim fee creator.
 *
 * Sama dengan peluncuran di `agent-launch.ts`, server hanya MENYUSUN transaksi; agen
 * menandatangani dengan kuncinya sendiri. Bentuk panggilannya meniru panel di situs persis —
 * `MarketStakePanel` untuk stake (approve sejumlah tepat, lalu `stake`) dan `CreatorDashboard`
 * untuk klaim (`claimCreatorFees()` di kurva, atau satu batch Multicall3 per chain) — supaya
 * tidak ada cara kedua untuk melakukan hal yang sama.
 */
import { ethers } from "ethers";
import { readProvider, resolveChainOrDefault } from "@/lib/chains";
import { stakeForMarket, type MarketStake } from "@/config/market-stakes";
import { STAKE_HUB_ABI } from "@/config/stake-hubs";
import { readCreatorEarnings, MULTICALL3 } from "@/lib/creator-earnings";
import type { ProjectRecord } from "@/lib/registry";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];
const DEDICATED_STAKE_ABI = [
  "function stake(uint256 amount)",
  "function stakedOf(address) view returns (uint256)",
  "function minStake() view returns (uint256)",
];
const CLAIM_ABI = ["function claimCreatorFees() returns (uint256)"];
const MULTICALL3_ABI = [
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
];

export interface UnsignedTx {
  purpose: string;
  chainId: number;
  from: string;
  to: string;
  data: string;
  value: "0";
  gasEstimate: string | null;
}

async function estimate(provider: ethers.JsonRpcProvider, tx: { from: string; to: string; data: string }): Promise<string | null> {
  try {
    return (await provider.estimateGas(tx)).toString();
  } catch {
    return null;
  }
}

// ── prepare_stake ───────────────────────────────────────────────────────────

/**
 * Approve (hanya bila allowance kurang) lalu stake, untuk kontrak stake pasar itu sendiri atau
 * hub chain-nya. Ditolak di sini, sebelum agen membayar gas, untuk tiga hal yang membuat kontrak
 * me-revert: hub tidak menerima token, saldo kurang, dan posisi hasilnya di bawah minimum.
 */
export async function prepareStake(p: ProjectRecord, addressRaw: string, amountRaw: string): Promise<Record<string, unknown>> {
  let address: string;
  try {
    address = ethers.getAddress(String(addressRaw).trim());
  } catch {
    return { error: "invalid_address", detail: "address must be a 20-byte hex address." };
  }
  const amount = String(amountRaw ?? "").trim();
  if (!/^\d+(\.\d{1,18})?$/.test(amount) || Number(amount) <= 0) {
    return { error: "invalid_amount", detail: "amount is a positive number of whole tokens, for example \"10000\"." };
  }
  const stake: MarketStake | null = stakeForMarket(p);
  if (!stake) return { error: "no_stake_contract", detail: `$${p.symbol} on chain ${p.chainId} has no stake contract and its chain has no stake hub.` };

  const chain = resolveChainOrDefault(p.chainId);
  const provider = readProvider(chain);
  const hub = stake.kind === "hub";
  const want = ethers.parseUnits(amount, stake.decimals);
  const token = new ethers.Contract(stake.token, ERC20_ABI, provider);
  const contract = new ethers.Contract(stake.contract, hub ? STAKE_HUB_ABI : DEDICATED_STAKE_ABI, provider);

  try {
    if (hub && !(await contract.isEligible(stake.token))) {
      return { error: "hub_refuses_token", detail: `The ${chain.name} stake hub does not accept $${p.symbol}: it comes from a factory the hub was not deployed with.` };
    }
    const [balance, allowance, staked, min] = (await Promise.all([
      token.balanceOf(address),
      token.allowance(address, stake.contract),
      hub ? contract.stakedOf(stake.token, address) : contract.stakedOf(address),
      hub ? contract.minStakeOf(stake.token) : contract.minStake(),
    ])) as [bigint, bigint, bigint, bigint];

    const fmt = (v: bigint) => ethers.formatUnits(v, stake.decimals);
    if (balance < want) {
      return { error: "insufficient_balance", detail: `${address} holds ${fmt(balance)} ${p.symbol}, less than ${amount}.`, balance: fmt(balance) };
    }
    if (staked + want < min) {
      return {
        error: "below_minimum",
        detail: `The position after staking would be ${fmt(staked + want)} ${p.symbol}; the minimum is ${fmt(min)}.`,
        minimum: fmt(min),
        alreadyStaked: fmt(staked),
      };
    }

    const transactions: UnsignedTx[] = [];
    const needsApproval = allowance < want;
    if (needsApproval) {
      const data = new ethers.Interface(ERC20_ABI).encodeFunctionData("approve", [stake.contract, want]);
      transactions.push({
        purpose: `approve the ${hub ? "stake hub" : "stake contract"} to move exactly ${amount} ${p.symbol}`,
        chainId: chain.chainId,
        from: address,
        to: stake.token,
        data,
        value: "0",
        gasEstimate: await estimate(provider, { from: address, to: stake.token, data }),
      });
    }
    const stakeData = hub
      ? new ethers.Interface(STAKE_HUB_ABI).encodeFunctionData("stake", [stake.token, want])
      : new ethers.Interface(DEDICATED_STAKE_ABI).encodeFunctionData("stake", [want]);
    transactions.push({
      purpose: `stake ${amount} ${p.symbol}`,
      chainId: chain.chainId,
      from: address,
      to: stake.contract,
      data: stakeData,
      value: "0",
      // Tidak bisa diestimasi sebelum approve-nya mined: estimasinya akan me-revert.
      gasEstimate: needsApproval ? null : await estimate(provider, { from: address, to: stake.contract, data: stakeData }),
    });

    return {
      market: `$${p.symbol} on ${chain.name}`,
      chainId: chain.chainId,
      stakeContract: stake.contract,
      kind: stake.kind ?? "dedicated",
      token: stake.token,
      transactions,
      order: needsApproval ? "Send in order and wait for the approval to be mined before the stake." : "One transaction.",
      after: { staked: fmt(staked + want), minimum: fmt(min), active: true },
      lock: "none: unstake works at any time",
      next: "check_stake confirms the position; then access_message and ask_agent open this market's agent.",
    };
  } catch (error) {
    return { error: "read_failed", detail: String((error as Error)?.message ?? error).slice(0, 200) };
  }
}

// ── prepare_claim ───────────────────────────────────────────────────────────

/**
 * Klaim fee creator yang menumpuk, untuk satu alamat. `claimCreatorFees()` permissionless dan
 * selalu membayar `creator` immutable milik kurva, jadi siapa pun pengirimnya uangnya tetap ke
 * creator. Satu kurva → satu panggilan langsung; beberapa di satu chain → satu batch Multicall3,
 * persis seperti tombol "claim all" di /creator.
 */
export async function prepareClaim(addressRaw: string, chainId?: number): Promise<Record<string, unknown>> {
  let address: string;
  try {
    address = ethers.getAddress(String(addressRaw).trim());
  } catch {
    return { error: "invalid_address", detail: "address must be a 20-byte hex address." };
  }
  const earnings = await readCreatorEarnings(address);
  const claimable = earnings.markets.filter(
    (m) => m.owedWei && BigInt(m.owedWei) > 0n && (chainId === undefined || m.chainId === Number(chainId))
  );
  if (claimable.length === 0) {
    return {
      address,
      claimable: [],
      transactions: [],
      checkedMarkets: earnings.checked,
      unreadableMarkets: earnings.unreadable,
      detail: "Nothing is owed to this address on the markets checked.",
    };
  }

  const byChain = new Map<number, typeof claimable>();
  for (const m of claimable) {
    if (!byChain.has(m.chainId)) byChain.set(m.chainId, []);
    byChain.get(m.chainId)!.push(m);
  }
  const claim = new ethers.Interface(CLAIM_ABI).encodeFunctionData("claimCreatorFees");
  const transactions: Array<UnsignedTx & { markets: string[] }> = [];
  for (const [id, markets] of byChain) {
    const chain = resolveChainOrDefault(id);
    const provider = readProvider(chain);
    const multicall = earnings.chains.find((c) => c.chainId === id)?.multicall3 ?? false;
    if (markets.length > 1 && multicall) {
      const calls = markets.map((m) => ({ target: m.curve, allowFailure: false, callData: claim }));
      const data = new ethers.Interface(MULTICALL3_ABI).encodeFunctionData("aggregate3", [calls]);
      transactions.push({
        purpose: `claim creator fees from ${markets.length} markets on ${chain.name} in one batch`,
        chainId: id,
        from: address,
        to: MULTICALL3,
        data,
        value: "0",
        gasEstimate: await estimate(provider, { from: address, to: MULTICALL3, data }),
        markets: markets.map((m) => `$${m.symbol}`),
      });
      continue;
    }
    for (const m of markets) {
      transactions.push({
        purpose: `claim creator fees from $${m.symbol} on ${chain.name}`,
        chainId: id,
        from: address,
        to: m.curve,
        data: claim,
        value: "0",
        gasEstimate: await estimate(provider, { from: address, to: m.curve, data: claim }),
        markets: [`$${m.symbol}`],
      });
    }
  }

  return {
    address,
    claimable: claimable.map((m) => ({
      symbol: m.symbol,
      chainId: m.chainId,
      curve: m.curve,
      owed: m.owed,
      nativeSymbol: m.nativeSymbol,
      owedUsd: m.owedUsd,
    })),
    transactions,
    note: "claimCreatorFees is permissionless and always pays the curve's immutable creator, whoever sends it.",
  };
}
