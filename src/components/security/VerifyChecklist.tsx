import type { ReactNode } from "react";
import Link from "next/link";
import facts from "@/config/docs-facts.json";
import deployments from "@/config/factory-deployments.json";
import { ADEXTO_CONTRACTS, CURVE_FACTORY_GENERATION } from "@/config/contracts";
import CommandBlock from "./CommandBlock";

/**
 * Checklist "Verify it yourself": perintah `cast` yang bisa ditempel pembaca, plus hasil yang
 * seharusnya keluar.
 *
 * Setiap perintah di berkas ini SUDAH DIJALANKAN apa adanya (2026-09-30) ke keempat mainnet, dan
 * setiap "Expected" adalah jawaban chain waktu itu — bukan dari ingatan atau dari sumber kode.
 * Semuanya immutable, jadi jawabannya tidak boleh berubah; kalau berubah, env situs menunjuk
 * kontrak lain.
 *
 * Sumber data, sengaja tiga-tiganya dicocokkan sebelum dirender:
 *   - docs-facts.json            alamat factory, ukuran, keccak (dihasilkan scripts/docs-facts.mjs)
 *   - factory-deployments.json   blok, tx pembuat, RPC yang menjawab receipt lama, commit sumber
 *   - ADEXTO_CONTRACTS (env)     factory yang BENAR-BENAR dipakai Studio meluncurkan
 * Kalau ketiganya tidak sepakat, checklist-nya tidak dirender sama sekali. Checklist yang
 * menyuruh orang memverifikasi alamat yang bukan tempat peluncuran terjadi lebih buruk daripada
 * tidak ada checklist.
 *
 * Teks yang dirender WAJIB bahasa Inggris.
 */

const KEY_BY_CHAIN: Record<number, "og" | "base" | "arbitrum" | "monad"> = {
  16661: "og",
  8453: "base",
  42161: "arbitrum",
  143: "monad",
};

/**
 * Contoh kurva untuk langkah 6 dan 7: kurva $ADEXTO di 0G. Nilainya dibaca on-chain 2026-09-30
 * dengan perintah persis di bawah; semuanya immutable (VERSION konstanta, fee dan creator
 * immutable), jadi aman ditulis di sini.
 */
const EXAMPLE = {
  symbol: "ADEXTO",
  chainName: "0G Mainnet",
  chainId: 16661,
  curve: "0xc80e0659D2Fc29e62605C9DF6182a85372652B60",
  version: "0.11.0",
  totalFeeBps: 40,
  creatorFeeBps: 10,
  depthFeeBps: 15,
  treasuryBuybackBps: 5,
  protocolFeeBps: 10,
  creator: "0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D",
};

type Row = {
  chainId: number;
  name: string;
  explorer: string;
  factory: string;
  block: number;
  tx: string;
  rpc: string;
  bytes: number;
  keccak: string;
};

function buildRows(): { rows: Row[]; problem: string | null } {
  const rows: Row[] = [];
  for (const c of facts.chains) {
    const dep = (deployments.chains as Record<string, { block: number; tx: string; rpc: string }>)[String(c.chainId)];
    const key = KEY_BY_CHAIN[c.chainId];
    const live = key ? ADEXTO_CONTRACTS[key].curveFactoryAddress : null;
    if (!dep) return { rows: [], problem: `no deployment record for chain ${c.chainId}` };
    if (!live || live.toLowerCase() !== c.factory.toLowerCase()) {
      return { rows: [], problem: `chain ${c.chainId}: the launch factory is not the one in the facts file` };
    }
    if (c.factoryVersion !== deployments.version || c.factoryVersion !== CURVE_FACTORY_GENERATION.version) {
      return { rows: [], problem: `chain ${c.chainId}: factory version mismatch` };
    }
    rows.push({
      chainId: c.chainId,
      name: c.name,
      explorer: c.explorer,
      factory: c.factory,
      block: dep.block,
      tx: dep.tx,
      rpc: dep.rpc,
      bytes: c.factoryBytecodeBytes,
      keccak: c.factoryBytecodeKeccak,
    });
  }
  return { rows, problem: null };
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="rounded-xl border border-line bg-surface p-4" data-testid={`verify-step-${n}`}>
      <h4 className="mb-2 flex items-baseline gap-2 text-[13px] font-bold text-ink">
        <span className="font-mono text-[11px] text-accent">{n}.</span>
        {title}
      </h4>
      <div className="space-y-2">{children}</div>
    </li>
  );
}

function Expected({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] leading-relaxed text-ink-soft">
      <span className="font-bold text-ok">Expected: </span>
      {children}
    </p>
  );
}

export default function VerifyChecklist() {
  const { rows, problem } = buildRows();

  if (problem) {
    return (
      <div className="rounded-xl border border-warn/30 bg-warn/10 p-4 text-xs text-warn" data-testid="verify-checklist" data-state="stale">
        The published contract facts do not match the factories this site launches with ({problem}), so the checklist
        is hidden until they are regenerated. The addresses on{" "}
        <Link href="/docs" className="font-semibold underline">
          the technical status page
        </Link>{" "}
        are read from the same configuration as the launch flow.
      </div>
    );
  }

  const keccak = rows[0]?.keccak ?? "";
  const sameHash = rows.every((r) => r.keccak === keccak);
  const sourceShort = deployments.sourceCommit.slice(0, 12);
  const treasuryHex = deployments.protocolTreasury.slice(2).toLowerCase();
  const exampleRpc = rows.find((r) => r.chainId === EXAMPLE.chainId)?.rpc ?? "";

  return (
    <div data-testid="verify-checklist" data-state="ready">
      <h3 className="mb-1 mt-8 text-base font-semibold text-ink">Check the live contracts with cast</h3>
      <p className="mb-4 text-xs leading-relaxed text-ink-soft">
        Each check reads a chain directly with{" "}
        <a href="https://getfoundry.sh" target="_blank" rel="noopener noreferrer" className="font-semibold text-accent hover:underline">
          Foundry&apos;s cast
        </a>
        ; nothing passes through an ADEXTO server. The expected results are what the chains returned before this page
        was published. The contracts are immutable, so the answers should not change. If one does, trust the chain,
        not this page.
      </p>

      <div className="overflow-hidden rounded-xl border border-line">
        <div className="hidden grid-cols-[minmax(0,0.9fr)_minmax(0,1.7fr)_minmax(0,0.8fr)_auto] gap-3 border-b border-line bg-cream-3/[0.04] px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint sm:grid">
          <span>Chain</span>
          <span>
            {CURVE_FACTORY_GENERATION.contract} {CURVE_FACTORY_GENERATION.version}
          </span>
          <span>Deployed in block</span>
          <span>Runtime code</span>
        </div>
        <div className="divide-y divide-line/[0.08]">
          {rows.map((r) => (
            <div
              key={r.chainId}
              className="grid grid-cols-1 gap-1 px-3 py-2.5 text-[11px] sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.7fr)_minmax(0,0.8fr)_auto] sm:items-center sm:gap-3"
              data-testid="verify-row"
              data-chain={r.chainId}
              data-factory={r.factory}
              data-block={r.block}
            >
              <span className="whitespace-nowrap font-bold text-ink">
                {r.name} <span className="font-mono text-[10px] text-ink-faint">{r.chainId}</span>
              </span>
              <a
                href={`${r.explorer}/address/${r.factory}`}
                target="_blank"
                rel="noopener noreferrer"
                className="addr min-w-0 truncate text-accent hover:underline"
              >
                {r.factory}
              </a>
              <a
                href={`${r.explorer}/tx/${r.tx}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-accent hover:underline"
                title="The transaction that created the factory"
              >
                <span className="text-ink-faint sm:hidden">block </span>
                {r.block.toLocaleString("en-US")}
              </a>
              <span className="whitespace-nowrap font-mono text-ink-soft">{r.bytes.toLocaleString("en-US")} bytes</span>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
        keccak256 of the runtime code{sameHash ? ", the same on all four chains" : ""}:{" "}
        <code className="break-all text-accent" data-testid="verify-keccak">
          {keccak}
        </code>
        . That holds only because every chain got the same protocol treasury:{" "}
        <code className="text-accent">protocolTreasury</code> is immutable, and Solidity stores immutables inside the
        runtime code. The superseded 0.11.0 factories are listed on{" "}
        <Link href="/docs" className="font-semibold text-accent hover:underline">
          the technical status page
        </Link>
        .
      </p>

      <ol className="mt-5 space-y-3">
        <Step n={1} title="Pick a chain">
          <p className="text-[11px] leading-relaxed text-ink-soft">
            Paste one line. Every command after it uses these three variables. The RPC endpoints are public ones that
            also answer receipt lookups for old transactions.
          </p>
          {rows.map((r) => (
            <CommandBlock key={r.chainId} label={r.name} code={`FACTORY=${r.factory} TX=${r.tx} RPC=${r.rpc}`} />
          ))}
        </Step>

        <Step n={2} title="One program on every chain">
          <CommandBlock code={`cast code $FACTORY --rpc-url $RPC | cast keccak\ncast codesize $FACTORY --rpc-url $RPC`} />
          <Expected>
            the hash above and <code className="text-ink">{rows[0]?.bytes}</code>, on each of the four chains.
          </Expected>
        </Step>

        <Step n={3} title="Created by the transaction in the table">
          <CommandBlock
            code={`cast receipt $TX contractAddress --rpc-url $RPC\ncast receipt $TX blockNumber --rpc-url $RPC`}
          />
          <Expected>the factory address, then the block number from the table.</Expected>
        </Step>

        <Step n={4} title="Version, protocol fee, and no owner">
          <CommandBlock
            code={`cast call $FACTORY "VERSION()(string)" --rpc-url $RPC\ncast call $FACTORY "PROTOCOL_FEE_BPS()(uint256)" --rpc-url $RPC\ncast call $FACTORY "owner()(address)" --rpc-url $RPC`}
          />
          <Expected>
            <code className="text-ink">&quot;{deployments.version}&quot;</code>, then{" "}
            <code className="text-ink">{facts.fees.protocolBps}</code> (basis points: {(facts.fees.protocolBps / 100).toFixed(2)}% of
            every swap goes to the protocol treasury), then an <code className="text-ink">execution reverted</code> error.
            The factory has no owner function to call.
          </Expected>
        </Step>

        <Step n={5} title="The chain runs the published source">
          <p className="text-[11px] leading-relaxed text-ink-soft">
            Run these inside the clone from Reproduce above, at commit{" "}
            <code className="text-accent">{sourceShort}</code>.
          </p>
          <CommandBlock
            code={`node -p 'require("./build/artifacts/AdextoFactory.json").deployedBytecode' | cast keccak\ncast code $FACTORY --rpc-url $RPC | sed 's/${treasuryHex}/${"0".repeat(40)}/g' | cast keccak`}
          />
          <Expected>
            the same hash twice, <code className="break-all text-ink">{deployments.maskedKeccak}</code>. The compiler
            leaves two 20-byte slots at zero for the protocol treasury, an immutable the constructor writes into the code
            ({deployments.protocolTreasury.slice(0, 6)}…{deployments.protocolTreasury.slice(-4)}). The{" "}
            <code className="text-ink">sed</code> blanks those two slots in the chain&apos;s copy, so everything else is
            compared byte for byte.
          </Expected>
        </Step>

        <Step n={6} title="Read a market's fees from its own curve">
          <p className="text-[11px] leading-relaxed text-ink-soft">
            Every market page links its curve under <span className="font-semibold text-ink">Pool</span>. This uses{" "}
            {`$${EXAMPLE.symbol}`} on {EXAMPLE.chainName}:
          </p>
          <CommandBlock
            code={[
              `CURVE=${EXAMPLE.curve} RPC=${exampleRpc}`,
              `cast call $CURVE "VERSION()(string)" --rpc-url $RPC`,
              `cast call $CURVE "totalFeeBps()(uint256)" --rpc-url $RPC`,
              `cast call $CURVE "creatorFeeBps()(uint256)" --rpc-url $RPC`,
              `cast call $CURVE "depthFeeBps()(uint256)" --rpc-url $RPC`,
              `cast call $CURVE "treasuryBuybackBps()(uint256)" --rpc-url $RPC`,
              `cast call $CURVE "protocolFeeBps()(uint256)" --rpc-url $RPC`,
              `cast call $CURVE "creator()(address)" --rpc-url $RPC`,
            ].join("\n")}
          />
          <Expected>
            <code className="text-ink">&quot;{EXAMPLE.version}&quot;</code>, then{" "}
            <code className="text-ink">{EXAMPLE.totalFeeBps}</code> = {EXAMPLE.creatorFeeBps} creator +{" "}
            {EXAMPLE.depthFeeBps} depth + {EXAMPLE.treasuryBuybackBps} buyback + {EXAMPLE.protocolFeeBps} protocol, in
            basis points ({(EXAMPLE.totalFeeBps / 100).toFixed(2)}% of each swap), then the creator{" "}
            <code className="break-all text-ink">{EXAMPLE.creator}</code>. Rates are fixed when a market launches and
            differ between factory generations, so read them from the curve rather than from any web page, this one
            included.
          </Expected>
        </Step>

        <Step n={7} title="No withdrawal function">
          <CommandBlock code={`cast selectors $(cast code $CURVE --rpc-url $RPC) --resolve | grep -Ew 'payable|nonpayable'`} />
          <Expected>
            seven lines. <code className="text-ink">buy</code> is payable; <code className="text-ink">sell</code>,{" "}
            <code className="text-ink">claimCreatorFees</code>, <code className="text-ink">claimProtocolFees</code>,{" "}
            <code className="text-ink">executeBuyback</code>, <code className="text-ink">bindToken</code> and{" "}
            <code className="text-ink">initializeCurve</code> are not. The last two only the factory can call, once,
            during the launch. Nothing else in the curve can change state. A plain transfer to the curve runs a buy.
          </Expected>
        </Step>
      </ol>

      <h4 className="mb-2 mt-5 text-sm font-semibold text-ink">What these checks do not prove</h4>
      <ul className="space-y-1.5 text-[11px] leading-relaxed text-ink-soft">
        <li>
          <strong className="text-ink">A reverting owner() only rules out that one name.</strong> Step 7 is what rules
          out other names on the curve.
        </li>
        <li>
          <strong className="text-ink">Step 7 leans on two outside inputs.</strong> Function names come from a public
          signature database (openchain.xyz), and cast guesses from the bytecode which functions are read-only. The
          guess is a heuristic: on the factory it labels <code className="text-accent">deployTrinity</code> read-only,
          which it is not, so step 7 is not used on the factory. There the source is the reference.
        </li>
        {/* Diperiksa 2026-09-30 pada dua kurva 0.10.0 (bekas $ADEXTO 0xA65a…8841 dan tes NOVA784):
            VERSION() dan totalFeeBps() revert, 34 selector, enam fungsi pengubah state tanpa
            claimProtocolFees. Pasar yang terdaftar hari ini semuanya 0.11.0. */}
        <li>
          <strong className="text-ink">Step 5 covers the 0.12.0 factory, which every new launch goes through.</strong>{" "}
          The markets listed today were created by the 0.11.0 factories, and their curves report VERSION 0.11.0. Steps
          6 and 7 work on them unchanged; step 5 does not, because it compiles the 0.12.0 source.
        </li>
        <li>
          <strong className="text-ink">Curves from the 0.10.0 factory answer differently.</strong> They predate{" "}
          <code className="text-accent">VERSION()</code> and <code className="text-accent">totalFeeBps()</code> on the
          curve, so those two calls revert there, and step 7 prints six lines instead of seven because they have no
          protocol leg to claim.
        </li>
        <li>
          <strong className="text-ink">Matching bytecode shows which code runs, not that the code is correct.</strong>{" "}
          Finding bugs is what the analysers above attempt, and they are not an audit.
        </li>
      </ul>
    </div>
  );
}
