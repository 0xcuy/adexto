/**
 * Bagian statis `/agent-compute`: cara kerja, contoh kode, tingkat jatah, dan batas yang jujur.
 *
 * Server component, dirender dari config, jadi semua angkanya ada di HTML pertama. Itu juga yang
 * dibaca `audit_consistency.mjs`: endpoint, id dan label model, setiap jatah tingkat, dan stake
 * minimum harus muncul di halaman, dan harus berasal dari `src/config/agent-compute.ts`.
 */
import { Cpu, KeyRound, Layers, Lock } from "lucide-react";
import CopyField from "@/components/ui/CopyField";
import Disclosure from "@/components/ui/Disclosure";
import Tabs from "@/components/ui/Tabs";
import {
  AGENT_COMPUTE_ENDPOINT,
  AGENT_COMPUTE_MODEL,
  CLIENT_USAGE_BUFFER,
  COMPUTE_STAKES,
  HUB_COMPUTE_SHARE_BPS,
  MEASURED_INPUT_FLOOR,
  approxRequests,
  hubVolumePerRequestUsd,
} from "@/config/agent-compute";

const fmt = (n: number) => n.toLocaleString("en-US");

function SectionHead({ id, title, children }: { id?: string; title: string; children?: React.ReactNode }) {
  return (
    <div>
      <h2 id={id} className="scroll-mt-24 font-display text-[22px] font-semibold tracking-tight text-ink sm:text-[26px]">
        {title}
      </h2>
      {children && <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-ink-soft sm:text-[15px]">{children}</p>}
    </div>
  );
}

/** Tiga langkah, langsung di bawah hero: pengunjung harus tahu caranya sebelum diminta memilih. */
export function ComputeSteps() {
  const steps = [
    {
      icon: Layers,
      title: "Stake a token",
      body: "At least its minimum, on the token's own chain. Nothing is locked, and there is no reward.",
    },
    {
      icon: KeyRound,
      title: "Sign for a key",
      body: "One free signature, no gas. The key belongs to your address and to that token only.",
    },
    {
      icon: Cpu,
      title: "Call the endpoint",
      body: "From your own code, with any OpenAI client. Usage counts input plus output tokens.",
    },
  ];
  return (
    <section aria-labelledby="how-title" className="mt-10">
      <h2 id="how-title" className="sr-only">
        How it works
      </h2>
      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-card border border-line bg-surface p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <s.icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-[12px] font-semibold text-ink-faint">{i + 1}</span>
                <span className="text-[15px] font-semibold text-ink">{s.title}</span>
              </span>
              <span className="mt-1 block text-[13px] leading-relaxed text-ink-soft">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

const CURL = [
  `curl ${AGENT_COMPUTE_ENDPOINT}/chat/completions \\`,
  `  -H "Authorization: Bearer $ADEXTO_KEY" \\`,
  `  -H "Content-Type: application/json" \\`,
  `  -d '{"model":"${AGENT_COMPUTE_MODEL}",`,
  `       "messages":[{"role":"user","content":"hello"}],`,
  `       "stream":false}'`,
].join("\n");

const PYTHON = [
  "import os",
  "from openai import OpenAI",
  "",
  `client = OpenAI(base_url="${AGENT_COMPUTE_ENDPOINT}", api_key=os.environ["ADEXTO_KEY"])`,
  "reply = client.chat.completions.create(",
  `    model="${AGENT_COMPUTE_MODEL}",`,
  '    messages=[{"role": "user", "content": "hello"}],',
  "    stream=False,",
  ")",
  "print(reply.choices[0].message.content)",
].join("\n");

const TYPESCRIPT = [
  'import OpenAI from "openai";',
  "",
  `const client = new OpenAI({ baseURL: "${AGENT_COMPUTE_ENDPOINT}", apiKey: process.env.ADEXTO_KEY });`,
  "const reply = await client.chat.completions.create({",
  `  model: "${AGENT_COMPUTE_MODEL}",`,
  '  messages: [{ role: "user", content: "hello" }],',
  "  stream: false,",
  "});",
  "console.log(reply.choices[0].message.content);",
].join("\n");

/**
 * Contoh kode. `"stream": false` DITULIS di ketiganya, termasuk SDK: diukur, tanpa field `stream`
 * router membalas `text/event-stream` dan menempelkan `data: [DONE]` di belakang objek JSON-nya,
 * jadi `JSON.parse` pada body itu gagal.
 */
export function ComputeGuide() {
  return (
    <section aria-labelledby="endpoint" className="mt-14">
      <SectionHead id="endpoint" title="Call it from your code">
        Send the key of the token you stake as a bearer token. The endpoint speaks the OpenAI{" "}
        <code className="rounded bg-cream-3 px-1 py-0.5 font-mono text-[12px]">/chat/completions</code> API.
      </SectionHead>
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Tabs
          label="Code example"
          items={[
            { id: "curl", label: "cURL", content: <CopyField value={CURL} label="Request" copyLabel="the example request" multiline /> },
            { id: "python", label: "Python", content: <CopyField value={PYTHON} label="Python · openai" copyLabel="the Python example" multiline /> },
            { id: "typescript", label: "TypeScript", content: <CopyField value={TYPESCRIPT} label="TypeScript · openai" copyLabel="the TypeScript example" multiline /> },
          ]}
          panelClassName="mt-3"
        />
        <div className="space-y-3">
          <CopyField value={AGENT_COMPUTE_ENDPOINT} label="Base URL" />
          <CopyField value={AGENT_COMPUTE_MODEL} label="Model" />
          <p className="text-[12px] leading-relaxed text-ink-faint">
            Replace <code className="font-mono">$ADEXTO_KEY</code> with the key you create below. It is shown once.
          </p>
        </div>
      </div>
      <Disclosure className="mt-4" summary="Streaming and thinking" hint="optional">
        <div className="space-y-2.5 text-[13px]">
          <p>
            <strong className="text-ink">Streaming works.</strong> Set{" "}
            <code className="rounded bg-cream-3 px-1 py-0.5 font-mono">&quot;stream&quot;: true</code>, and add{" "}
            <code className="rounded bg-cream-3 px-1 py-0.5 font-mono">
              &quot;stream_options&quot;: {"{"}&quot;include_usage&quot;: true{"}"}
            </code>{" "}
            if you want the usage totals in the last frame.
          </p>
          <p>
            Read only <code className="rounded bg-cream-3 px-1 py-0.5 font-mono">delta.content</code>. Thinking is on by
            default, so the model sends a long run of{" "}
            <code className="rounded bg-cream-3 px-1 py-0.5 font-mono">delta.reasoning_content</code> first, measured at
            140 reasoning frames before the first answer token, 2.8s in. Sending{" "}
            <code className="rounded bg-cream-3 px-1 py-0.5 font-mono">&quot;enable_thinking&quot;: false</code> removed
            them entirely and brought the first token forward to 1.7s.
          </p>
          <p>
            Keep <code className="rounded bg-cream-3 px-1 py-0.5 font-mono">&quot;stream&quot;</code> in the body either
            way. Omit it and the reply arrives as JSON with an SSE terminator glued to the end, which no JSON parser
            accepts.
          </p>
        </div>
      </Disclosure>
    </section>
  );
}

/**
 * Stake yang membuka tingkat ke-i, digabung per jumlah dan simbol:
 * "5,000 ADEXTO on 0G, or 10,000 SAI on Arbitrum One, Robinhood Chain or Monad".
 */
function stakeOptions(i: number): string {
  const groups = new Map<string, { amount: number; symbol: string; chains: string[] }>();
  for (const s of COMPUTE_STAKES) {
    const t = s.tiers[i];
    if (!t) continue;
    const k = `${t.stake}:${s.symbol}`;
    const g = groups.get(k) ?? { amount: t.stake, symbol: s.symbol, chains: [] };
    g.chains.push(s.chainName);
    groups.set(k, g);
  }
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);
  return [...groups.values()].map((g) => `${fmt(g.amount)} ${g.symbol} on ${list(g.chains)}`).join(", or ");
}

/** Tangga jatah empat sumber bertingkat, dan cara kerja pasar hub. */
export function ComputeAllowances() {
  return (
    <section aria-labelledby="tiers" className="mt-14">
      <SectionHead id="tiers" title="How much compute a stake opens">
        Allowances count input plus output tokens, added up from the day a key is created. The stake is held on chain;
        the allowance is protocol policy, kept off chain.
      </SectionHead>
      {/* Ponsel: satu kartu per tingkat, tanpa geser ke samping. Stake yang sama untuk beberapa token
          digabung ("10,000 SAI on Arbitrum One, Robinhood Chain or Monad"). */}
      <ul className="mt-5 space-y-2 md:hidden">
        {COMPUTE_STAKES[0].tiers.map((t, i) => (
          <li key={t.label} className="rounded-card border border-line bg-surface p-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[15px] font-semibold text-ink">{t.label}</span>
              <span className="font-mono text-[13px] text-ink">
                {fmt(t.allowance / 1000)}k tokens <span className="text-ink-faint">≈{fmt(approxRequests(t.allowance))} requests</span>
              </span>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">Stake {stakeOptions(i)}.</p>
          </li>
        ))}
      </ul>
      <div className="mt-5 hidden overflow-x-auto rounded-card border border-line bg-surface md:block" tabIndex={0} role="region" aria-label="Stake tiers">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-line bg-cream-2 text-[11px] uppercase tracking-wider text-ink-faint">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-semibold">
                Tier
              </th>
              <th scope="col" className="px-4 py-2.5 font-semibold">
                Allowance
              </th>
              {COMPUTE_STAKES.map((s) => (
                // Dua baris yang disengaja: ticker, lalu chain. Satu baris "$SAI · Robinhood Chain" pecah tiga di 768 px.
                <th key={s.id} scope="col" className="px-4 py-2.5 font-semibold">
                  <span className="block whitespace-nowrap">${s.symbol}</span>
                  <span className="block whitespace-nowrap font-normal normal-case tracking-normal">{s.chainName}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPUTE_STAKES[0].tiers.map((t, i) => (
              <tr key={t.label} className="border-b border-line last:border-0">
                <th scope="row" className="px-4 py-2.5 font-semibold text-ink">
                  {t.label}
                </th>
                <td className="px-4 py-2.5 font-mono text-ink">
                  {fmt(t.allowance / 1000)}k tokens
                  <span className="ml-1.5 text-ink-faint">≈{fmt(approxRequests(t.allowance))} requests</span>
                </td>
                {COMPUTE_STAKES.map((s) => (
                  <td key={s.id} className="px-4 py-2.5 font-mono text-ink-soft">
                    {s.tiers[i] ? `${fmt(s.tiers[i].stake)} ${s.symbol}` : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 rounded-card border border-line bg-cream-2 p-4 text-[13px] leading-relaxed text-ink-soft">
        <strong className="text-ink">Every other ADEXTO market has no tiers.</strong> It stakes in its chain&apos;s stake
        hub, from its first block, with a minimum of 0.001% of its supply. Its keys share compute funded by the
        market&apos;s own trading: {HUB_COMPUTE_SHARE_BPS / 100}% of the 0.10% protocol fee its trades pay, split by stake,
        and only fees that arrive after a key exists count toward that key. At today&apos;s model price, about $
        {hubVolumePerRequestUsd().toFixed(2)} of trading pays for one request, and a key switches on once one request&apos;s
        worth has accrued. A market nobody trades funds no compute.
      </div>
    </section>
  );
}

/** Batas yang jujur, dilipat (owner 2026-10-01: terlalu panjang untuk halaman ini). */
export function ComputeLimits() {
  return (
    <Disclosure className="mt-10" icon={Lock} summary="How metering and the stake contracts work" hint="limits">
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-card border border-warn/30 bg-warn/[0.07] p-4">
          <p className="text-[13px] font-semibold text-warn">How the meter really behaves</p>
          <ul className="mt-2 space-y-2 text-[13px] leading-relaxed">
            <li>
              <strong className="text-ink">About {fmt(MEASURED_INPUT_FLOOR)} input tokens go out with every request</strong>,
              measured: a two-token prompt was recorded at {fmt(MEASURED_INPUT_FLOOR)} input tokens. So a{" "}
              {fmt(COMPUTE_STAKES[0].tiers[0].allowance)} token allowance is roughly{" "}
              {fmt(approxRequests(COMPUTE_STAKES[0].tiers[0].allowance))} requests.
            </li>
            <li>
              <strong className="text-ink">
                Your own client will report {fmt(CLIENT_USAGE_BUFFER)} more input tokens per request than we count
              </strong>
              . That gap is not an estimate and it is not in our favour: the router adds a fixed{" "}
              {fmt(CLIENT_USAGE_BUFFER)} token buffer to the usage it returns so clients that manage their own context
              leave headroom. We meter the recorded figure, which is the lower one.
            </li>
            <li>
              <strong className="text-ink">Enforcement runs on a sweep, not mid-request.</strong> Usage is read from the
              router and a key is switched off once its allowance is spent, so a key can overshoot slightly before it
              stops.
            </li>
            <li>
              <strong className="text-ink">The allowance is policy, not a contract.</strong> Nothing on chain promises
              compute. When metered billing arrives, what you can do today may change.
            </li>
          </ul>
        </div>
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-[13px] font-semibold text-ink">What the stake contracts cannot do</p>
          <ul className="mt-2 space-y-2 text-[13px] leading-relaxed">
            <li>
              <strong className="text-ink">No owner.</strong> No pause, no upgrade, no emergency withdrawal, and no function
              that can move somebody else&apos;s stake.
            </li>
            <li>
              <strong className="text-ink">No lock period.</strong> Unstaking works immediately. The word &quot;stake&quot;
              here does not promise a lock, and the contracts do not implement one.
            </li>
            <li>
              <strong className="text-ink">Exit goes to you.</strong> The recipient is not a parameter: it is always the
              caller.
            </li>
            <li>
              <strong className="text-ink">Unstaking closes that token&apos;s key.</strong> Drop below the token&apos;s
              minimum and the next sweep disables its key. Stake again and it comes back.
            </li>
          </ul>
        </div>
      </div>
    </Disclosure>
  );
}
