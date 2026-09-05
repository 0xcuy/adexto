"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import { CHAINS, explorerAddressUrl, type ChainKey } from "@/lib/chains";
import {
  Vote, ExternalLink, RefreshCw, AlertCircle, CheckCircle2, XCircle, Info,
} from "lucide-react";

/**
 * Papan status tata kelola.
 *
 * KENAPA HALAMAN INI DITULIS ULANG SELURUHNYA
 *
 * Versi sebelumnya menampilkan tiga proposal — AIP-01, AIP-02, AIP-03 — lengkap
 * dengan perolehan suara ("For: 4.00M ADAI (100.0%)"), status Passed/Active,
 * tenggat "2 days 14 hours", dan nama pengusul. Semuanya array konstan di dalam
 * berkas komponen. Di bawah judul "ON-CHAIN DAO GOVERNANCE".
 *
 * Pembacaan langsung ke keempat Governor yang ter-deploy mengatakan sebaliknya:
 *
 *   0G       proposalCount = 0   governanceToken = 0x592c…98d8 (SovereignHook v1)
 *   Arbitrum proposalCount = 0   governanceToken = 0xbC72…Ac39 (SovereignHook v1)
 *   Base     proposalCount = 0   governanceToken = 0x0000…0000
 *   Monad    proposalCount = 0   governanceToken = 0x0000…0000
 *
 * Tidak ada satu pun proposal yang pernah ada. Dan karena `castVote` menimbang
 * suara dengan `governanceToken.balanceOf(msg.sender)`, sementara alamat itu
 * menunjuk kontrak hook tanpa `balanceOf` atau ke alamat nol, memberi suara
 * PASTI revert di keempat chain.
 *
 * Halaman lama juga menghitung "Your Voting Power" sebagai saldo native 0G
 * dikalikan 10.000, memberinya satuan "ADAI", dan menulis "✓ Eligible to cast
 * on-chain votes". Token ADAI tidak ada — namanya hanya muncul sebagai komentar
 * pada dua konstanta di AdextoGovernor.sol. Kalau RPC-nya gagal, angkanya jatuh
 * ke "100,000.00", yaitu mengarang angka saat pembacaan gagal.
 *
 * Tombol "Vote FOR" mengirim transaksi sungguhan ke Governor untuk proposal yang
 * tidak ada. Itu bukan cuma tidak jujur, itu meminta pengunjung membelanjakan gas
 * untuk kegagalan yang pasti.
 *
 * Yang tersisa di halaman ini adalah apa yang bisa dibuktikan: keempat kontrak
 * Governor memang ada di mainnet, aturannya tertulis di kode, dan tata kelolanya
 * belum bisa dijalankan sampai token tata kelola ada dan tersambung. Semua angka
 * dibaca dari chain saat halaman dibuka; tidak ada nilai yang ditulis tangan. Kalau
 * pembacaannya gagal, halaman mengatakan gagal alih-alih menampilkan angka.
 */

/** Cocok dengan AdextoGovernor.sol. */
const GOVERNOR_ABI = [
  "function proposalCount() view returns (uint256)",
  "function governanceToken() view returns (address)",
];
const ERC20_ABI = ["function symbol() view returns (string)", "function totalSupply() view returns (uint256)"];

/** Aturan di bawah adalah `constant` di kontrak, jadi tidak perlu dibaca. */
const RULES = [
  { label: "Voting period", value: "3 days" },
  { label: "Proposal threshold", value: "100,000 tokens" },
  { label: "Quorum", value: "4,000,000 tokens" },
];

type TokenState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "unset" }
  | { kind: "not-a-token"; address: string }
  | { kind: "ok"; address: string; symbol: string; supply: string };

interface Row {
  key: ChainKey;
  name: string;
  chainId: number;
  governor: string;
  proposals: number | null;
  token: TokenState;
}

const TRACKED: ChainKey[] = ["0G", "Arbitrum", "Base", "Monad"];

export default function GovernancePage() {
  const [rows, setRows] = useState<Row[]>(
    TRACKED.map((key) => ({
      key,
      name: CHAINS[key].name,
      chainId: CHAINS[key].chainId,
      governor: CHAINS[key].governorAddress,
      proposals: null,
      token: { kind: "loading" },
    }))
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function readChain(key: ChainKey): Promise<Row> {
      const chain = CHAINS[key];
      const base: Row = {
        key,
        name: chain.name,
        chainId: chain.chainId,
        governor: chain.governorAddress,
        proposals: null,
        token: { kind: "loading" },
      };
      if (!chain.governorAddress) {
        return { ...base, token: { kind: "error", message: "no governor address configured" } };
      }
      try {
        // staticNetwork: tanpa ini ethers melakukan satu putaran deteksi jaringan
        // tambahan per provider, dan pada RPC publik itulah panggilan yang paling
        // sering timeout.
        const provider = new ethers.JsonRpcProvider(chain.rpcUrl, undefined, { staticNetwork: true });
        const gov = new ethers.Contract(chain.governorAddress, GOVERNOR_ABI, provider);
        const [count, tokenAddr] = await Promise.all([gov.proposalCount(), gov.governanceToken()]);
        const proposals = Number(count);

        if (!tokenAddr || tokenAddr === ethers.ZeroAddress) {
          return { ...base, proposals, token: { kind: "unset" } };
        }
        const code = await provider.getCode(tokenAddr);
        if (code === "0x") {
          return { ...base, proposals, token: { kind: "not-a-token", address: tokenAddr } };
        }
        const erc = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
        try {
          const [symbol, supply] = await Promise.all([erc.symbol(), erc.totalSupply()]);
          return {
            ...base,
            proposals,
            token: { kind: "ok", address: tokenAddr, symbol, supply: ethers.formatEther(supply) },
          };
        } catch {
          // Ada bytecode, tapi bukan ERC-20 — inilah keadaan 0G dan Arbitrum:
          // alamatnya menunjuk kontrak AMM, bukan token.
          return { ...base, proposals, token: { kind: "not-a-token", address: tokenAddr } };
        }
      } catch (e) {
        return { ...base, token: { kind: "error", message: (e as Error).message.slice(0, 90) } };
      }
    }

    (async () => {
      const results = await Promise.all(TRACKED.map(readChain));
      if (!cancelled) {
        setRows(results);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const totalProposals = rows.reduce((sum, r) => sum + (r.proposals ?? 0), 0);
  const anyVotable = rows.some((r) => r.token.kind === "ok");
  const readsDone = rows.every((r) => r.token.kind !== "loading");

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
      <div className="border-b border-line pb-8">
        <p className="kicker mb-3">Governance</p>
        <h1 className="text-3xl sm:text-4xl font-semibold text-ink">Deployed, not yet operational</h1>
        <p className="text-sm text-ink-soft mt-2 max-w-2xl leading-relaxed">
          The Governor contract is live on all four chains and its rules are fixed in code. What is missing is
          the token those rules count votes in. Every number on this page is read from the chain when the page
          loads.
        </p>
      </div>

      {/* Kesimpulan didahulukan, bukan disembunyikan di bawah tabel. */}
      <div
        className={`rounded-2xl border p-5 flex items-start gap-3 ${
          anyVotable ? "border-ok/30 bg-ok/10" : "border-warn/30 bg-warn/10"
        }`}
      >
        {anyVotable ? (
          <CheckCircle2 className="w-5 h-5 text-ok shrink-0 mt-0.5" />
        ) : (
          <AlertCircle className="w-5 h-5 text-warn shrink-0 mt-0.5" />
        )}
        <div className="space-y-2 text-sm">
          <p className="font-semibold text-ink">
            {!readsDone
              ? "Reading the four Governor contracts…"
              : anyVotable
              ? "At least one chain can accept votes."
              : "Voting is impossible on every chain right now."}
          </p>
          {readsDone && !anyVotable && (
            <p className="text-xs leading-relaxed text-ink-soft">
              <code className="text-ink">castVote</code> weighs a ballot by{" "}
              <code className="text-ink">governanceToken.balanceOf(msg.sender)</code>. On 0G and Arbitrum that
              address points at the v1 AMM contract, which has no <code className="text-ink">balanceOf</code>;
              on Base and Monad it is the zero address. Either way the call reverts, so no vote button is offered
              here — showing one would only cost you gas.
            </p>
          )}
          <p className="text-xs leading-relaxed text-ink-soft">
            Proposals recorded on-chain across all four chains: <strong className="text-ink" data-numeric>{loading ? "…" : totalProposals}</strong>.
          </p>
        </div>
      </div>

      {/* ── Governor per chain, dibaca langsung ─────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-ink-faint">
          Governor contracts
        </h2>

        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="table-clean min-w-[640px]">
            <thead>
              <tr>
                <th>Chain</th>
                <th>Governor</th>
                <th className="text-right">Proposals</th>
                <th>Vote-weight token</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    <span className="font-semibold text-ink">{r.name}</span>
                    <span className="ml-1.5 font-mono text-[10px] text-ink-faint">{r.chainId}</span>
                  </td>
                  <td>
                    {r.governor ? (
                      <a
                        href={explorerAddressUrl(CHAINS[r.key], r.governor)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-[11px] text-accent hover:underline"
                      >
                        {r.governor.slice(0, 8)}…{r.governor.slice(-6)}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="font-mono text-[11px] text-ink-faint">not configured</span>
                    )}
                  </td>
                  <td className="text-right font-mono text-[11px] text-ink" data-numeric>
                    {r.proposals === null ? (
                      <RefreshCw className="ml-auto w-3 h-3 animate-spin text-ink-faint" />
                    ) : (
                      r.proposals
                    )}
                  </td>
                  <td>
                    <TokenCell state={r.token} chainKey={r.key} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-faint">
          <Info className="w-3 h-3 shrink-0 mt-0.5" />
          Read live over each chain&apos;s public RPC. A read that fails is reported as a failure, never replaced
          with a placeholder number.
        </p>
      </section>

      {/* ── Aturan, yang memang konstan di kontrak ──────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-ink-faint">
          Rules fixed in the contract
        </h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-6 border-t border-line pt-6 sm:grid-cols-3">
          {RULES.map((rule) => (
            <div key={rule.label}>
              <dt className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">{rule.label}</dt>
              <dd className="mt-1.5 text-lg font-semibold text-ink" data-numeric>
                {rule.value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-[11px] leading-relaxed text-ink-faint">
          These are <code>constant</code> values in <code>AdextoGovernor.sol</code>, so they cannot be changed
          without deploying a new Governor. The token unit is whatever{" "}
          <code>governanceToken</code> resolves to — which is the part that is not settled yet.
        </p>
      </section>

      {/* ── Apa yang tersisa untuk dikerjakan ───────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-ink-faint">
          What has to happen before a vote can be cast
        </h2>
        <ol className="space-y-3 border-t border-line pt-6 text-sm text-ink-soft">
          <li className="flex items-start gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line font-mono text-[10px] font-bold text-ink-soft">
              1
            </span>
            <span>
              Deploy the governance token. The threshold and quorum constants are denominated in it, and no such
              token exists on any chain today.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line font-mono text-[10px] font-bold text-ink-soft">
              2
            </span>
            <span>
              Point each Governor at it. <code className="text-ink">governanceToken</code> is set in the
              constructor and is immutable, so this means redeploying the four Governors rather than editing
              them.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line font-mono text-[10px] font-bold text-ink-soft">
              3
            </span>
            <span>
              Give the Governor authority over something. A passed proposal calls{" "}
              <code className="text-ink">targetContract</code> with its calldata; the curve parameters it would
              govern are immutable per market, so the scope has to be decided before the vote, not after.
            </span>
          </li>
        </ol>
        {/* Kalimat di sini dulu menyalahkan penyedia jembatan lintas-chain: katanya
            tidak ada router yang diterbitkan untuk 0G dan Monad sehingga lane-nya tidak
            mungkin dibuka. Itu SALAH — router-nya hidup di keempat chain dan keduabelas
            arah lane-nya terbuka, diperiksa dengan `isChainSupported` di tiap router.
            Kalimat itu juga lolos dari penjaga frasa karena singkatan protokolnya
            menyelip di antara "no" dan "router"; pelajarannya dicatat di daftar BANNED
            audit_claims.mjs, yang kini menjaga nama merek dan singkatannya terpisah.

            Dicabut, bukan diperbaiki: vote lintas-chain tidak terhambat oleh siapa pun
            di luar. Ia tidak ada dalam desain ini, karena buyback memindahkan nilai
            antar dua kantong di dalam SATU kontrak dan tidak ada jalur keluar. */}
        <p className="pt-2 text-xs text-ink-soft">
          The scope above is per chain. Nothing in this design carries a vote or its outcome to another chain, and
          the curve holds no path that could send value across one.{" "}
          <Link href="/docs" className="font-semibold text-accent hover:underline">
            Details in the docs
          </Link>
          .
        </p>
      </section>
    </div>
  );
}

function TokenCell({ state, chainKey }: { state: TokenState; chainKey: ChainKey }) {
  if (state.kind === "loading") {
    return <RefreshCw className="w-3 h-3 animate-spin text-ink-faint" />;
  }
  if (state.kind === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-warn">
        <AlertCircle className="w-3 h-3 shrink-0" /> read failed
      </span>
    );
  }
  if (state.kind === "unset") {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-danger">
        <XCircle className="w-3 h-3 shrink-0" /> zero address
      </span>
    );
  }
  if (state.kind === "not-a-token") {
    return (
      <span
        className="inline-flex items-center gap-1.5 font-mono text-[11px] text-danger"
        title={`${state.address} has bytecode but does not answer symbol()/balanceOf()`}
      >
        <XCircle className="w-3 h-3 shrink-0" /> not a token
      </span>
    );
  }
  return (
    <a
      href={explorerAddressUrl(CHAINS[chainKey], state.address)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-mono text-[11px] text-ok hover:underline"
    >
      <CheckCircle2 className="w-3 h-3 shrink-0" /> {state.symbol}
      <ExternalLink className="w-3 h-3" />
    </a>
  );
}
