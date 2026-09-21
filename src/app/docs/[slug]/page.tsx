import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Info } from "lucide-react";
import pagesJson from "@/config/docs-pages.json";
import factsJson from "@/config/docs-facts.json";

/**
 * Halaman anak docs.adexto.xyz, dirender dari JSON.
 *
 * KENAPA JSON DAN BUKAN MDX
 *
 * Prosanya disusun dengan bantuan model bahasa (`scripts/docs-draft.mjs`). Kalau model boleh
 * menulis MDX atau JSX, satu tanda kutip salah mematikan build, dan markup dari keluaran model
 * masuk ke halaman tanpa ada yang meninjau bentuknya. Jadi model mengembalikan struktur —
 * heading, paragraf, daftar, blok kode — dan berkas ini satu-satunya yang memutuskan
 * bagaimana semua itu tampil.
 *
 * KENAPA TABEL TIDAK DATANG DARI JSON HALAMAN
 *
 * Draf pertama memancarkan sebuah tabel yang memberi `list_markets` deskripsi milik
 * `trade_history`. Setiap katanya nyata, jadi pemeriksa fakta tidak menangkapnya — model yang
 * menyusun ulang baris memasangkan kata yang benar dengan subjek yang salah. Jadi tabel data
 * dirender di sini DARI `docs-facts.json`, dan halaman hanya boleh MEMINTA tabel dengan nama.
 * `scripts/docs-draft.mjs` menolak blok tabel mentah, dan `scripts/docs-verify.mjs`
 * menolaknya lagi kalau lolos.
 *
 * Konsekuensi yang disengaja: menambah kolom pada sebuah tabel adalah pekerjaan di berkas ini,
 * bukan pekerjaan prompt. Itu memang tempatnya.
 */

type Block =
  | { type: "p"; text: string }
  | { type: "list"; items: string[] }
  | { type: "code"; lang?: string; code: string }
  | { type: "note"; text: string }
  | { type: "factsTable"; table: string };

interface Section {
  heading: string;
  blocks: Block[];
}
interface DocPage {
  title: string;
  lede: string;
  sections: Section[];
}

const pages = pagesJson as unknown as { pages: Record<string, DocPage>; order?: string[] };
const facts = factsJson as unknown as {
  chains: {
    chainId: number;
    name: string;
    nativeSymbol: string | null;
    explorer: string | null;
    factory: string;
    factoryVersion: string | null;
  }[];
  bytecode: { identicalAcrossChains: boolean; bytes: number | null; keccak: string | null };
  fees: { maxTotalBps: number; protocolBps: number; antiSnipeBlocks: number };
  markets: {
    symbol: string;
    slug: string;
    chainId: number;
    chainKey: string;
    nativeSymbol: string;
    curve: string;
    depthFeeBps: number;
    buybackBps: number;
  }[];
  mcp: { endpoint: string; tools: { name: string; description: string; args: string[] }[] };
  analysers: { id: string; tool: string; status: string; counts: Record<string, number> | null }[];
  analysersScannedAt: string;
};

const ORDER = pages.order ?? Object.keys(pages.pages);

export function generateStaticParams() {
  return Object.keys(pages.pages).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = pages.pages[slug];
  if (!page) return { title: "Not found — ADEXTO docs" };
  return { title: `${page.title} — ADEXTO docs`, description: page.lede.slice(0, 180) };
}

/** Tabel data, dirender dari fakta. Halaman hanya menyebut namanya. */
function FactsTable({ table }: { table: string }) {
  const head = "border-b border-line bg-cream-3/[0.05] px-3 py-2 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-ink-faint";
  const cell = "border-b border-line/[0.08] px-3 py-2 align-top text-[12px] text-ink-soft";
  const mono = `${cell} font-mono text-[11px] break-all`;

  const wrap = (children: React.ReactNode) => (
    <div className="my-4 overflow-x-auto rounded-xl border border-line">
      <table className="w-full border-collapse">{children}</table>
    </div>
  );

  if (table === "chains") {
    return wrap(
      <>
        <thead>
          <tr>
            <th className={head}>Chain</th>
            <th className={head}>ID</th>
            <th className={head}>Native</th>
            <th className={head}>Factory</th>
          </tr>
        </thead>
        <tbody>
          {facts.chains.map((c) => (
            <tr key={c.chainId}>
              <td className={cell}>{c.name}</td>
              <td className={mono}>{c.chainId}</td>
              <td className={cell}>{c.nativeSymbol ?? "—"}</td>
              <td className={mono}>
                {c.explorer ? (
                  <a
                    href={`${c.explorer}/address/${c.factory}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    {c.factory}
                  </a>
                ) : (
                  c.factory
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </>,
    );
  }

  if (table === "mcpTools") {
    return wrap(
      <>
        <thead>
          <tr>
            <th className={head}>Tool</th>
            <th className={head}>Arguments</th>
            <th className={head}>What it does</th>
          </tr>
        </thead>
        <tbody>
          {facts.mcp.tools.map((t) => (
            <tr key={t.name}>
              <td className={mono}>{t.name}</td>
              <td className={mono}>{t.args.length ? t.args.join(", ") : "none"}</td>
              <td className={cell}>{t.description}</td>
            </tr>
          ))}
        </tbody>
      </>,
    );
  }

  if (table === "markets") {
    return wrap(
      <>
        <thead>
          <tr>
            <th className={head}>Market</th>
            <th className={head}>Chain</th>
            <th className={head}>Curve</th>
          </tr>
        </thead>
        <tbody>
          {facts.markets.map((m) => (
            <tr key={`${m.chainId}:${m.symbol}`}>
              <td className={cell}>
                <Link href={`/token/${m.slug}?chain=${m.chainId}`} className="font-bold text-accent hover:underline">
                  ${m.symbol}
                </Link>
              </td>
              <td className={cell}>
                {m.chainKey} · {m.nativeSymbol}
              </td>
              <td className={mono}>{m.curve}</td>
            </tr>
          ))}
        </tbody>
      </>,
    );
  }

  if (table === "feeLegs") {
    // Kaki depth/creator/buyback dibaca dari sebuah pasar hidup, bukan dituliskan di sini,
    // supaya angkanya selalu angka yang benar-benar berlaku pada sebuah kurva.
    const m = facts.markets[0];
    const creator = m ? m.depthFeeBps + m.buybackBps : null;
    return wrap(
      <>
        <thead>
          <tr>
            <th className={head}>Leg</th>
            <th className={head}>Bps</th>
            <th className={head}>Comes from</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={cell}>Depth</td>
            <td className={mono}>{m?.depthFeeBps ?? "—"}</td>
            <td className={cell}>inside the creator&apos;s configured total; stays in the curve</td>
          </tr>
          <tr>
            <td className={cell}>Buyback</td>
            <td className={mono}>{m?.buybackBps ?? "—"}</td>
            <td className={cell}>inside the configured total; accrues on the curve, then buys and burns</td>
          </tr>
          <tr>
            <td className={cell}>Protocol</td>
            <td className={mono}>{facts.fees.protocolBps}</td>
            <td className={cell}>
              <strong className="text-ink">added on top</strong> of the configured total
            </td>
          </tr>
          <tr>
            <td className={cell}>Hard ceiling</td>
            <td className={mono}>{facts.fees.maxTotalBps}</td>
            <td className={cell}>
              checked against what a trader pays, in the factory and again in the curve
            </td>
          </tr>
        </tbody>
      </>,
    );
    void creator;
  }

  if (table === "analysers") {
    return wrap(
      <>
        <thead>
          <tr>
            <th className={head}>Engine</th>
            <th className={head}>Result</th>
            <th className={head}>Counts, as reported</th>
          </tr>
        </thead>
        <tbody>
          {facts.analysers.map((a) => (
            <tr key={a.id}>
              <td className={cell}>{a.tool}</td>
              <td className={mono}>{a.status}</td>
              <td className={mono}>
                {a.counts
                  ? Object.entries(a.counts)
                      .map(([k, v]) => `${k} ${v}`)
                      .join(" · ")
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </>,
    );
  }

  return null;
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "p") {
          return (
            <p key={i} className="my-3 text-[13px] leading-relaxed text-ink-soft">
              <Inline text={b.text} />
            </p>
          );
        }
        if (b.type === "list") {
          return (
            <ul key={i} className="my-3 space-y-1.5 pl-4">
              {b.items.map((it, j) => (
                <li key={j} className="list-disc text-[13px] leading-relaxed text-ink-soft">
                  <Inline text={it} />
                </li>
              ))}
            </ul>
          );
        }
        if (b.type === "code") {
          return (
            <pre
              key={i}
              className="my-4 overflow-x-auto rounded-xl border border-line bg-cream-3/[0.06] p-4 font-mono text-[11px] leading-relaxed text-ink"
            >
              <code>{b.code}</code>
            </pre>
          );
        }
        if (b.type === "note") {
          return (
            <div key={i} className="my-4 flex items-start gap-2 rounded-xl border border-line bg-cream-3/[0.06] p-4">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
              <p className="text-[12px] leading-relaxed text-ink">
                <Inline text={b.text} />
              </p>
            </div>
          );
        }
        if (b.type === "factsTable") return <FactsTable key={i} table={b.table} />;
        return null;
      })}
    </>
  );
}

/** Backtick -> <code>. Tidak ada HTML dari JSON yang pernah di-render mentah. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") && p.length > 2 ? (
          <code key={i} className="rounded bg-cream-3 px-1 py-0.5 font-mono text-[11px] text-ink">
            {p.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export default async function DocsChildPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = pages.pages[slug];
  if (!page) notFound();

  const idx = ORDER.indexOf(slug);
  const prev = idx > 0 ? ORDER[idx - 1] : null;
  const next = idx >= 0 && idx < ORDER.length - 1 ? ORDER[idx + 1] : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Link href="/docs" className="mb-6 inline-flex items-center gap-1.5 text-[11px] font-bold text-accent hover:underline">
        <ArrowLeft className="h-3 w-3" /> Documentation
      </Link>

      <h1 className="mb-3 text-3xl font-semibold text-ink">{page.title}</h1>
      <p className="mb-8 text-sm leading-relaxed text-ink-soft">
        <Inline text={page.lede} />
      </p>

      {page.sections.map((s) => (
        <section key={s.heading} className="mb-8">
          <h2 className="mb-2 text-lg font-semibold text-ink">{s.heading}</h2>
          <Blocks blocks={s.blocks} />
        </section>
      ))}

      <div className="mt-12 flex items-center justify-between gap-3 border-t border-line pt-5">
        {prev ? (
          <Link
            href={`/docs/${prev}`}
            className="inline-flex items-center gap-1.5 text-[12px] font-bold text-accent hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {pages.pages[prev]?.title ?? prev}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={`/docs/${next}`}
            className="inline-flex items-center gap-1.5 text-[12px] font-bold text-accent hover:underline"
          >
            {pages.pages[next]?.title ?? next} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <span />
        )}
      </div>

      <p className="mt-8 text-[11px] leading-relaxed text-ink-faint">
        Every address, chain id, fee value and tool name on this page is generated from{" "}
        <code className="text-accent">src/config/docs-facts.json</code>, which is read from the repository and from
        chain by <code className="text-accent">scripts/docs-facts.mjs</code>. Analyser figures were scanned{" "}
        {new Date(facts.analysersScannedAt).toISOString().slice(0, 10)}. Prose was drafted with a language model and
        checked against those facts by <code className="text-accent">scripts/docs-verify.mjs</code>; the model is
        never the source of a number.
      </p>
    </main>
  );
}
