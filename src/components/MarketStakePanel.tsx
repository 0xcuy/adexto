"use client";

import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import { Layers, Loader2, Undo2, ExternalLink } from "lucide-react";
import { useWallet } from "@/context/WalletContext";
import { getActiveEip1193 } from "@/lib/wallet-provider";
import { describeTxError, ensureWalletChain } from "@/lib/dex";
import { explorerAddressUrl, readProvider, type ChainInfo } from "@/lib/chains";
import type { MarketStake } from "@/config/market-stakes";
import { computeStakeForMarket, hubComputeStakeId } from "@/config/agent-compute";
import { STAKE_HUB_ABI } from "@/config/stake-hubs";
import Link from "next/link";

/**
 * Stake untuk SATU pasar, di chain pasar itu sendiri.
 *
 * Semua angka dibaca dari kontrak stake dan kontrak token lewat RPC chain itu, tidak lewat
 * dompet: dompet bisa sedang di chain lain, dan membaca saldo lewat dompet yang salah chain
 * melaporkan nol dengan yakin.
 *
 * Yang dikatakan panel ini sengaja sempit: stake membuka agent pasar ini lewat MCP
 * (`ask_agent`) dan kunci Agent Compute: bertingkat untuk pasar di `COMPUTE_STAKES`, dibiayai
 * trading pasar itu sendiri untuk pasar di hub. Tidak ada lock, dan tidak ada imbalan. Kontraknya
 * memang hanya itu — `AdextoAgentStake` dan `AdextoStakeHub` sama-sama tanpa owner, tanpa
 * cooldown, tanpa reward — jadi kalimat lain akan menjanjikan sesuatu yang tidak ada di kode.
 */
const STAKE_ABI = [
  "function stake(uint256 amount)",
  "function unstakeAll()",
  "function stakedOf(address) view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function stakerCount() view returns (uint256)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function MarketStakePanel({ chain, stake, symbol }: { chain: ChainInfo; stake: MarketStake; symbol: string }) {
  const { address, isConnected, connectWallet } = useWallet();
  /**
   * Hub: satu kontrak untuk semua pasar di chain ini, jadi setiap panggilan menyebut tokennya, dan
   * stake di hub selalu membuka Agent Compute yang dibiayai trading pasar ini. Kontrak sendiri:
   * Agent Compute hanya kalau pasarnya terdaftar sebagai sumber bertingkat.
   */
  const hub = stake.kind === "hub";
  const abi = hub ? STAKE_HUB_ABI : STAKE_ABI;
  const tiered = computeStakeForMarket(stake.chainId, stake.symbol);
  const computeId = hub ? hubComputeStakeId(stake.chainId, stake.symbol) : tiered?.contract ? tiered.id : null;
  const [totals, setTotals] = useState<{ staked: number; stakers: number } | null>(null);
  const [mine, setMine] = useState<{ staked: number; balance: number } | null>(null);
  const [amount, setAmount] = useState(String(stake.minStake));
  const [busy, setBusy] = useState<"stake" | "unstake" | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Hub saja: apakah hub menerima token ini. Selalu benar untuk pasar dari factory yang dikenal
   * hub, salah untuk pasar dari factory yang lahir sesudahnya. Null sampai terbaca.
   */
  const [eligible, setEligible] = useState<boolean | null>(null);

  const read = useCallback(async () => {
    try {
      const provider = readProvider(chain);
      const c = new ethers.Contract(stake.contract, abi, provider);
      if (hub) setEligible(Boolean(await c.isEligible(stake.token)));
      const [total, count] = await Promise.all(
        hub ? [c.totalStaked(stake.token), c.stakerCount(stake.token)] : [c.totalStaked(), c.stakerCount()]
      );
      setTotals({ staked: Number(ethers.formatUnits(total, stake.decimals)), stakers: Number(count) });
      if (address) {
        const t = new ethers.Contract(stake.token, ERC20_ABI, provider);
        const [s, b] = await Promise.all([hub ? c.stakedOf(stake.token, address) : c.stakedOf(address), t.balanceOf(address)]);
        setMine({ staked: Number(ethers.formatUnits(s, stake.decimals)), balance: Number(ethers.formatUnits(b, stake.decimals)) });
      } else {
        setMine(null);
      }
    } catch {
      // Gagal baca tidak menghapus angka terakhir; panel hanya berhenti memperbarui.
    }
  }, [chain, stake, address, abi, hub]);

  useEffect(() => {
    void read();
    const timer = setInterval(read, 20_000);
    return () => clearInterval(timer);
  }, [read]);

  const doStake = async () => {
    setBusy("stake");
    setError(null);
    setLine(null);
    try {
      const whole = amount.trim();
      if (!/^\d+(\.\d+)?$/.test(whole) || Number(whole) <= 0) throw new Error("Enter an amount to stake.");
      const want = ethers.parseUnits(whole, stake.decimals);
      const ethereum = getActiveEip1193();
      await ensureWalletChain(ethereum, chain);
      const signer = await new ethers.BrowserProvider(ethereum).getSigner();
      const me = await signer.getAddress();
      const token = new ethers.Contract(stake.token, ERC20_ABI, signer);
      const allowance: bigint = await token.allowance(me, stake.contract);
      if (allowance < want) {
        setLine(`1 of 2 — approving the ${hub ? "stake hub" : "stake contract"} to move ${whole} ${symbol}…`);
        const ap = await token.approve(stake.contract, want);
        await ap.wait();
      }
      setLine(allowance < want ? "2 of 2 — staking…" : "Staking…");
      const c = new ethers.Contract(stake.contract, abi, signer);
      const tx = hub ? await c.stake(stake.token, want) : await c.stake(want);
      await tx.wait();
      setLine(`Staked ${whole} ${symbol}. Unstake works at any time.`);
      await read();
    } catch (e) {
      setError(describeTxError(e, chain));
      setLine(null);
    } finally {
      setBusy(null);
    }
  };

  const doUnstake = async () => {
    setBusy("unstake");
    setError(null);
    setLine(null);
    try {
      const ethereum = getActiveEip1193();
      await ensureWalletChain(ethereum, chain);
      const signer = await new ethers.BrowserProvider(ethereum).getSigner();
      setLine("Unstaking…");
      const c = new ethers.Contract(stake.contract, abi, signer);
      const tx = hub ? await c.unstakeAll(stake.token) : await c.unstakeAll();
      await tx.wait();
      setLine("Unstaked. The full position is back in your wallet.");
      await read();
    } catch (e) {
      setError(describeTxError(e, chain));
      setLine(null);
    } finally {
      setBusy(null);
    }
  };

  const active = mine !== null && mine.staked >= stake.minStake;

  if (hub && eligible === false) {
    return (
      <div id="stake" className="glass-panel scroll-mt-20 space-y-2 rounded-card p-4" data-testid="market-stake-panel">
        <span className="flex items-center gap-1.5 text-[13px]/snug font-semibold text-ink">
          <Layers className="h-3.5 w-3.5 text-accent" aria-hidden="true" /> Stake ${symbol}
        </span>
        <p className="text-[12px] text-ink-soft">
          The {chain.name} stake hub does not accept ${symbol}: the token comes from a factory the hub was not deployed
          with, so there is nothing to stake it in yet.
        </p>
      </div>
    );
  }

  return (
    <div id="stake" className="glass-panel scroll-mt-20 space-y-3 rounded-card p-4" data-testid="market-stake-panel">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="flex items-center gap-1.5 text-[13px]/snug font-semibold text-ink">
          <Layers className="h-3.5 w-3.5 text-accent" aria-hidden="true" /> Stake ${symbol}
        </span>
        <span className="text-[12px] text-ink-faint">no lock · unstake any time · no reward</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[12px]">
        <div className="rounded-xl border border-line bg-cream-2 p-2.5">
          <div className="text-[12px] uppercase tracking-wider text-ink-faint">Staked in total</div>
          <div className="mt-0.5 font-semibold text-ink" data-numeric>
            {totals ? `${fmt(totals.staked)} ${symbol}` : "…"}
          </div>
          <div className="text-ink-faint">{totals ? `${totals.stakers} staker${totals.stakers === 1 ? "" : "s"}` : ""}</div>
        </div>
        <div className="rounded-xl border border-line bg-cream-2 p-2.5">
          <div className="text-[12px] uppercase tracking-wider text-ink-faint">Minimum</div>
          <div className="mt-0.5 font-semibold text-ink" data-numeric>
            {fmt(stake.minStake)} {symbol}
          </div>
          <div className="text-ink-faint">
            opens this market&apos;s agent over MCP
            {computeId && (
              <>
                {" "}
                and an{" "}
                <Link href={`/agent-compute?stake=${computeId}`} className="whitespace-nowrap font-semibold text-accent hover:underline">
                  Agent Compute key
                </Link>
                {hub && <> funded by this market&apos;s own trading</>}
              </>
            )}
          </div>
        </div>
      </div>

      {isConnected && mine && (
        <div className="flex items-center justify-between gap-2 text-[12px]">
          <span className="text-ink-soft">
            You: <strong className="text-ink" data-numeric>{fmt(mine.staked)} {symbol}</strong> staked ·{" "}
            <span data-numeric>{fmt(mine.balance)}</span> in wallet
          </span>
          <span className={active ? "font-semibold text-ok" : "text-ink-faint"}>{active ? "agent open" : "not active"}</span>
        </div>
      )}

      {isConnected ? (
        <div className="flex items-center gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            aria-label={`Amount of ${symbol} to stake`}
            // 16 px di bawah lg: Safari iOS memperbesar halaman saat kolom berhuruf < 16 px disentuh.
            className="h-[44px] min-w-0 flex-1 rounded-xl border border-line bg-cream-2 px-3 font-mono text-[16px] text-ink focus:border-accent focus:outline-none lg:h-auto lg:py-2 lg:text-[13px]/snug"
          />
          {/* Di bawah lg 44 px, setinggi kolom isiannya (rem situs 14 px, jadi px). Desktop tetap. */}
          <button
            type="button"
            onClick={doStake}
            disabled={busy !== null}
            className="inline-flex h-[44px] shrink-0 items-center gap-1.5 rounded-xl bg-accent px-4 text-[12px]/snug font-bold text-white disabled:opacity-50 lg:h-auto lg:px-3.5 lg:py-2"
          >
            {busy === "stake" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />} Stake
          </button>
          {mine && mine.staked > 0 && (
            <button
              type="button"
              onClick={doUnstake}
              disabled={busy !== null}
              className="inline-flex h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-line bg-surface px-3 text-[12px]/snug font-bold text-ink-soft disabled:opacity-50 lg:h-auto lg:py-2"
            >
              {busy === "unstake" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Unstake all
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void connectWallet()}
          className="h-[44px] w-full rounded-xl border border-accent/40 bg-accent-soft text-[12px]/snug font-bold text-accent lg:h-auto lg:py-2"
        >
          Connect a wallet to stake
        </button>
      )}

      {line && <p className="text-[12px] text-ok">{line}</p>}
      {error && <p className="text-[12px] text-danger">{error}</p>}

      <a
        href={explorerAddressUrl(chain, stake.contract)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-[32px] items-center gap-1 text-[12px] text-ink-faint hover:text-accent lg:min-h-0"
      >
        {hub ? "AdextoStakeHub" : "AdextoAgentStake"} {stake.contract.slice(0, 6)}…{stake.contract.slice(-4)} · no owner, no admin
        <ExternalLink className="h-2.5 w-2.5" />
      </a>
    </div>
  );
}
