"use client";

/**
 * Launch console di `/agents`: isi detail pasar sekali, dapatkan (1) konfigurasi MCP untuk klien agen,
 * (2) instruksi siap tempel untuk agennya, dan (3) preflight live dari langkah 1 `prepare_launch`.
 *
 * Tidak ada tanda tangan dan tidak ada transaksi di sini: halaman ini menyiapkan agen, peluncurannya
 * tetap dikerjakan agen lewat MCP dengan kuncinya sendiri. Teks English (aturan bahasa repo).
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, Loader2, Radio, XCircle } from "lucide-react";
import { CHAIN_LIST } from "@/lib/chains";
import Tabs from "@/components/ui/Tabs";
import Button from "@/components/ui/Button";
import CopyBlock from "@/components/agents/CopyBlock";
import { A2A_CARD_URL, A2A_URL, MCP_URL } from "@/components/agents/format";

const LAUNCHABLE = CHAIN_LIST.filter((c) => c.dexLive && c.curveFactoryAddress);
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

type Row = { state: "ok" | "warn" | "fail"; text: string };
type Preflight =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; ok: boolean; rows: Row[]; message: string | null }
  | { status: "error"; text: string };

const fieldClass =
  "mt-1 block w-full min-h-[40px] rounded-lg border border-line bg-surface px-3 text-[14px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none";

export default function LaunchConsole() {
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [chainId, setChainId] = useState<number>(LAUNCHABLE[0]?.chainId ?? 143);
  const [deployer, setDeployer] = useState("");
  const [agentId, setAgentId] = useState("");
  const [preflight, setPreflight] = useState<Preflight>({ status: "idle" });
  /**
   * Pelacak peluncuran: sesudah preflight lulus, halaman menanyakan registry tiap 5 detik apakah pasar
   * ini sudah terdaftar dari wallet itu (`register_launch`). Berhenti sesudah 30 menit, saat ditemukan,
   * atau saat isian berubah.
   */
  const [watch, setWatch] = useState<{ deployer: string; symbol: string; chainId: number } | null>(null);
  const [live, setLive] = useState<{ page: string; symbol: string; chainName: string } | null>(null);
  const [watchExpired, setWatchExpired] = useState(false);

  const chain = LAUNCHABLE.find((c) => c.chainId === chainId) ?? LAUNCHABLE[0];
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const deployerOk = ADDRESS_RE.test(deployer.trim());
  const ready = name.trim().length > 0 && sym.length >= 2 && deployerOk && Boolean(chain);

  // Isian berubah → pelacak untuk isian lama tidak berlaku lagi.
  useEffect(() => {
    setWatch(null);
    setLive(null);
    setWatchExpired(false);
  }, [sym, chainId, deployer]);

  useEffect(() => {
    if (!watch) return;
    let stopped = false;
    const startedAt = Date.now();
    const check = async () => {
      if (stopped) return;
      if (Date.now() - startedAt > 30 * 60_000) {
        setWatchExpired(true);
        return;
      }
      try {
        const q = new URLSearchParams({ deployer: watch.deployer, symbol: watch.symbol, chainId: String(watch.chainId) });
        const res = await fetch(`/api/agents/launches?${q}`);
        const j = res.ok ? await res.json() : null;
        const hit = Array.isArray(j?.launches) ? j.launches[0] : null;
        if (hit && !stopped) {
          setLive({ page: hit.page, symbol: hit.symbol, chainName: LAUNCHABLE.find((c) => c.chainId === hit.chainId)?.name ?? "" });
          return;
        }
      } catch {
        // Jaringan sesaat: coba lagi di putaran berikutnya.
      }
      if (!stopped) timer = setTimeout(check, 5000);
    };
    let timer: ReturnType<typeof setTimeout> = setTimeout(check, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [watch]);

  const prompt = useMemo(() => {
    const n = name.trim() || "<market name>";
    const t = sym || "<TICKER>";
    const d = deployerOk ? deployer.trim() : "<your wallet address>";
    const agent = /^\d+$/.test(agentId.trim()) ? `, bound to my ERC-8004 agent #${agentId.trim()}` : "";
    return (
      `Use the adexto MCP server to launch a market called "${n}", ticker ${t}, on ${chain?.name ?? "<chain>"} ` +
      `(chainId ${chain?.chainId ?? "<id>"}), from my wallet ${d}${agent}. ` +
      `Call prepare_launch, sign the attestationMessage it returns with personal_sign from that wallet, call ` +
      `prepare_launch again with the signature, send the unsigned transaction it returns from the same wallet ` +
      `(value 0, gas only), then call register_launch with the transaction hash.`
    );
  }, [name, sym, deployer, deployerOk, agentId, chain]);

  const clients = [
    { id: "claude", label: "Claude Code", content: <CopyBlock label="Terminal" code={`claude mcp add --transport http adexto ${MCP_URL}`} /> },
    {
      id: "json",
      label: "Cursor / JSON",
      content: <CopyBlock label="mcp.json" code={JSON.stringify({ mcpServers: { adexto: { url: MCP_URL } } }, null, 2)} />,
    },
    {
      id: "a2a",
      label: "A2A",
      content: (
        <div className="space-y-3">
          <CopyBlock label="Agent card" code={A2A_CARD_URL} />
          <CopyBlock
            label="SendMessage (A2A 1.0, JSON-RPC)"
            code={`curl -s ${A2A_URL} -H 'content-type: application/json' -H 'A2A-Version: 1.0' -d '${JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "SendMessage",
              params: {
                message: {
                  messageId: "launch-1",
                  role: "ROLE_USER",
                  parts: [
                    {
                      data: {
                        skill: "launch_market",
                        chainId: chain?.chainId ?? 143,
                        name: name.trim() || "Signal Desk",
                        symbol: sym || "SIGDSK",
                        deployer: deployerOk ? deployer.trim() : "0xYourAddress",
                        ...(/^\d+$/.test(agentId.trim()) ? { agentId: agentId.trim() } : {}),
                      },
                      mediaType: "application/json",
                    },
                  ],
                },
              },
            })}'`}
          />
          <p className="text-[12px] text-ink-faint">
            The task asks for the attestation signature, then returns the unsigned transaction, then takes the txHash. Same
            steps as MCP; the server never holds a key.
          </p>
        </div>
      ),
    },
    {
      id: "openai",
      label: "OpenAI Agents",
      content: (
        <CopyBlock
          label="Python"
          code={`from agents import Agent, Runner
from agents.mcp import MCPServerStreamableHttp

async with MCPServerStreamableHttp(params={"url": "${MCP_URL}"}) as adexto:
    agent = Agent(name="launcher", mcp_servers=[adexto])
    await Runner.run(agent, ${JSON.stringify(prompt)})`}
        />
      ),
    },
  ];

  async function runPreflight() {
    if (!ready || !chain) return;
    setPreflight({ status: "running" });
    try {
      const res = await fetch("/api/agents/launch/preflight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chainId: chain.chainId, name: name.trim(), symbol: sym, deployer: deployer.trim(), agentId: agentId.trim() || undefined }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j) {
        setPreflight({ status: "error", text: j?.detail ?? `The check did not answer (HTTP ${res.status}). Try again in a moment.` });
        return;
      }
      if (j.error) {
        setPreflight({ status: "done", ok: false, rows: [{ state: "fail", text: String(j.detail ?? j.error) }], message: null });
        return;
      }
      const rows: Row[] = [
        { state: "ok", text: `${j.chain} has the ADEXTO launch factory.` },
        { state: "ok", text: `Ticker ${j.symbol} is free on ADEXTO and within this wallet's ticker limit.` },
        j.checks?.tickerFreeOnChain === false
          ? { state: "fail", text: `Ticker ${j.symbol} is already taken on the ${j.chain} factory.` }
          : j.checks?.tickerFreeOnChain === true
            ? { state: "ok", text: `Ticker ${j.symbol} is free on the ${j.chain} factory.` }
            : { state: "warn", text: "The factory could not be read right now; your agent's prepare_launch checks it again." },
      ];
      if (j.checks?.agentId) rows.push({ state: "ok", text: `ERC-8004 agent #${j.checks.agentId} is owned by this wallet.` });
      rows.push({ state: "warn", text: `The wallet needs ${chain.nativeSymbol} on ${chain.name} for gas. The launch sends no value.` });
      const passed = rows.every((r) => r.state !== "fail");
      setPreflight({ status: "done", ok: passed, rows, message: String(j.attestationMessage ?? "") || null });
      if (passed) setWatch({ deployer: deployer.trim(), symbol: sym, chainId: chain.chainId });
    } catch {
      setPreflight({ status: "error", text: "The check could not be reached. Try again in a moment." });
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <form
        className="glass-panel rounded-card p-5 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void runPreflight();
        }}
        aria-label="Market details"
      >
        <div>
          <label htmlFor="lc-name" className="text-[13px] font-semibold text-ink">Market name</label>
          <input id="lc-name" className={fieldClass} value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder="Signal Desk" autoComplete="off" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="lc-symbol" className="text-[13px] font-semibold text-ink">Ticker</label>
            <input id="lc-symbol" className={`${fieldClass} font-mono uppercase`} value={sym} onChange={(e) => setSymbol(e.target.value)} placeholder="SIGDSK" autoComplete="off" />
          </div>
          <div>
            <label htmlFor="lc-chain" className="text-[13px] font-semibold text-ink">Chain</label>
            <select id="lc-chain" className={fieldClass} value={chainId} onChange={(e) => setChainId(Number(e.target.value))}>
              {LAUNCHABLE.map((c) => (
                <option key={c.chainId} value={c.chainId}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="lc-deployer" className="text-[13px] font-semibold text-ink">Your agent&apos;s wallet</label>
          <input id="lc-deployer" className={`${fieldClass} font-mono`} value={deployer} onChange={(e) => setDeployer(e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} />
          <p className="mt-1 text-[12px] text-ink-faint">The address that signs and sends the launch. It becomes the creator and earns the fee.</p>
        </div>
        <div>
          <label htmlFor="lc-agent" className="text-[13px] font-semibold text-ink">
            ERC-8004 agent id <span className="font-normal text-ink-faint">(optional)</span>
          </label>
          <input id="lc-agent" className={`${fieldClass} font-mono`} value={agentId} inputMode="numeric" onChange={(e) => setAgentId(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 1578" autoComplete="off" />
        </div>
        <Button type="submit" variant="primary" fullWidth disabled={!ready || preflight.status === "running"}>
          {preflight.status === "running" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Check before launch
        </Button>

        <div aria-live="polite" data-testid="launch-preflight">
          {preflight.status === "error" && <p className="text-[13px] text-danger">{preflight.text}</p>}
          {preflight.status === "done" && (
            <div className="space-y-3">
              <ul className="space-y-2">
                {preflight.rows.map((r) => (
                  <li key={r.text} className="flex gap-2 text-[13px] leading-snug text-ink-soft">
                    {r.state === "ok" ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-ok" aria-label="Passed" />
                    ) : r.state === "fail" ? (
                      <XCircle className="mt-0.5 h-4 w-4 text-danger" aria-label="Failed" />
                    ) : (
                      <CircleAlert className="mt-0.5 h-4 w-4 text-warn" aria-label="Note" />
                    )}
                    <span>{r.text}</span>
                  </li>
                ))}
              </ul>
              {preflight.ok && preflight.message && (
                <CopyBlock label="Your agent will sign this (valid 30 minutes)" code={preflight.message} />
              )}
            </div>
          )}
        </div>
      </form>

      <div className="space-y-5 min-w-0">
        <div>
          <h3 className="text-[16px] font-semibold text-ink">1. Connect your agent</h3>
          <p className="mt-1 mb-3 text-[13px] text-ink-soft">
            Add one URL to any MCP client, or talk to the ADEXTO agent over A2A. No account and no API key.
          </p>
          <Tabs label="MCP client" items={clients} variant="underline" />
        </div>
        <div>
          <h3 className="text-[16px] font-semibold text-ink">2. Tell it to launch</h3>
          <p className="mt-1 mb-3 text-[13px] text-ink-soft">
            Paste this into your agent. It fills in as you type. Your agent needs a wallet it controls, to sign and send.
          </p>
          <CopyBlock label="Instruction for your agent" code={prompt} />
        </div>
        <div data-testid="launch-tracker">
          <h3 className="text-[16px] font-semibold text-ink">3. Watch it go live</h3>
          {live ? (
            <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-ok/40 bg-ok/10 p-3 text-[14px] text-ink">
              <CheckCircle2 className="h-5 w-5 text-ok" aria-hidden="true" />
              <span>
                <span className="font-semibold">${live.symbol}</span> is live on {live.chainName}.
              </span>
              <Link href={live.page} className="font-semibold text-accent hover:underline">
                Open the market
              </Link>
            </div>
          ) : watch && !watchExpired ? (
            <div className="mt-2 flex items-center gap-2 rounded-xl border border-line bg-cream-2 p-3 text-[13px] text-ink-soft">
              <Radio className="h-4 w-4 animate-pulse text-accent" aria-hidden="true" />
              <span>
                Waiting for your agent to launch ${watch.symbol} and call <code className="text-accent">register_launch</code>.
                Keep this page open; it checks every 5 seconds.
              </span>
            </div>
          ) : watchExpired ? (
            <p className="mt-2 text-[13px] text-ink-soft">Stopped watching after 30 minutes. Run the check again to resume.</p>
          ) : null}
          <p className="mt-2 text-[13px] text-ink-soft">
            When the transaction is mined and your agent calls <code className="text-accent">register_launch</code>, the
            market opens at <span className="font-mono text-ink">adexto.xyz/token/{(sym || "ticker").toLowerCase()}?chain={chain?.chainId}</span>,
            appears in <code className="text-accent">list_markets</code>, and other agents can buy it over x402.
          </p>
        </div>
      </div>
    </div>
  );
}
