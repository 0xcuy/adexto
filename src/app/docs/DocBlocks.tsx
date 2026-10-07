/**
 * Perender isi docs dari `src/config/docs-pages.json` (dipindah dari `[slug]/page.tsx`, 4 Okt).
 *
 * KENAPA JSON DAN BUKAN MDX
 *
 * Prosanya disusun dengan bantuan model bahasa (`scripts/docs-draft.mjs`). Kalau model boleh menulis MDX
 * atau JSX, satu tanda kutip salah mematikan build, dan markup dari keluaran model masuk ke halaman tanpa
 * ada yang meninjau bentuknya. Jadi model mengembalikan struktur (heading, paragraf, daftar, blok kode) dan
 * berkas ini satu-satunya yang memutuskan bagaimana semua itu tampil.
 *
 * KENAPA TABEL TIDAK DATANG DARI JSON HALAMAN
 *
 * Draf pertama memancarkan tabel yang memberi `list_markets` deskripsi milik `trade_history`: setiap katanya
 * nyata, jadi pemeriksa fakta tidak menangkapnya. Tabel data dirender di sini DARI `docs-facts.json`, dan
 * halaman hanya boleh MEMINTA tabel dengan nama. `docs-draft.mjs` menolak blok tabel mentah, dan
 * `docs-verify.mjs` menolaknya lagi kalau lolos.
 *
 * Tipografi (4 Okt, permintaan owner "biar enak yang baca"): badan 16 px dengan jarak baris 1,75, judul
 * seksi 22 px dengan jangkar `#`, catatan sebagai kotak, blok kode dengan tombol Copy.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Info } from "lucide-react";
import factsJson from "@/config/docs-facts.json";
import CopyField from "@/components/ui/CopyField";
import { cn } from "@/components/ui/cn";

export type Block =
  | { type: "p"; text: string }
  | { type: "list"; items: string[] }
  | { type: "code"; lang?: string; code: string }
  | { type: "note"; text: string }
  | { type: "factsTable"; table: string }
  /** Langkah berurutan, bernomor. Sama seperti `list`, hanya urutannya yang bermakna. */
  | { type: "steps"; items: string[] }
  /**
   * Tautan "See also" ke halaman lain DI SITUS INI. `href` wajib diawali satu "/" (diperiksa di sini dan
   * di `docs-verify.mjs`), jadi JSON tidak pernah bisa memasang tautan keluar atau `javascript:`.
   */
  | { type: "see"; links: { href: string; label: string }[] };

/** Hanya path internal: "/x", bukan "//host" atau skema apa pun. */
export function isInternalHref(href: string): boolean {
  return /^\/(?!\/)[A-Za-z0-9\-._~/?#=&%]*$/.test(href);
}

export interface DocSectionData {
  heading: string;
  blocks: Block[];
}

const facts = factsJson as unknown as {
  chains: {
    chainId: number;
    name: string;
    nativeSymbol: string | null;
    explorer: string | null;
    factory: string;
    factoryVersion: string | null;
  }[];
  fees: { maxTotalBps: number; protocolBps: number; antiSnipeWindowSeconds: number; antiSnipeMaxWalletBps: number };
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

export const docsFacts = facts;

/** Id jangkar dari judul seksi: huruf kecil, selain huruf/angka jadi "-". */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`'’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Backtick -> <code>. Tidak ada HTML dari JSON yang pernah dirender mentah. */
export function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") && p.length > 2 ? (
          <code key={i} className="rounded-md bg-cream-3 px-1.5 py-0.5 font-mono text-[0.88em] text-ink [overflow-wrap:anywhere]">
            {p.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

const TH = "border-b border-line bg-cream-2 px-3 py-2.5 text-left text-[12px] font-semibold text-ink-faint";
/** Kelas sel tabel docs. Diekspor untuk tabel di luar berkas ini (attestation router di `TechnicalStatus.tsx`). */
export const TD = "border-b border-line px-3 py-2.5 align-top text-[14px] leading-snug text-ink-soft";
export const TD_MONO = `${TD} font-mono text-[12px] [overflow-wrap:anywhere]`;
const ADDR_LINK = "inline-flex min-h-[32px] items-center text-accent hover:underline";

/**
 * Satu tabel, dua bentuk.
 *
 * Mulai `sm`: tabel biasa. Di ponsel: setiap baris menjadi satu blok, kolom pertama sebagai judul dan sisanya
 * pasangan label–nilai. Dulu tabel yang sama dipaksa `min-width` 480–560 px di layar 358 px, jadi kolom
 * ketiga keluar layar dan harus digeser ke samping (tangkapan Playwright 4 Okt).
 *
 * Kedua bentuk ada di DOM; yang tidak terpakai `display: none`, jadi tidak dibaca pembaca layar dan tidak
 * ikut `innerText` (yang dibaca `audit_claims.mjs`).
 */
interface Col {
  label: string;
  /** Label di bentuk ponsel, bila `label` terlalu panjang untuk kolom label 72 px. */
  short?: string;
  /** Kelas sel di bentuk tabel. */
  td?: string;
  /** Kelas nilai di bentuk ponsel. */
  m?: string;
}

export function DataTable({ cols, rows }: { cols: readonly Col[]; rows: ReadonlyArray<{ key: string; cells: ReactNode[] }> }) {
  return (
    <>
      <div className="mt-5 hidden overflow-x-auto rounded-panel border border-line sm:block" tabIndex={0} role="region" aria-label="Table">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.label} className={TH}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                {r.cells.map((cell, i) => (
                  <td key={cols[i].label} className={cols[i].td ?? TD}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-5 divide-y divide-line rounded-panel border border-line sm:hidden">
        {rows.map((r) => (
          <li key={r.key} className="px-4 py-3">
            <div className="text-[15px] font-semibold leading-snug text-ink">{r.cells[0]}</div>
            <dl className="mt-1 space-y-0.5">
              {cols.slice(1).map((c, i) => (
                <div key={c.label} className="flex gap-3 text-[14px] leading-snug">
                  <dt className="w-[72px] shrink-0 py-[3px] text-ink-faint">{c.short ?? c.label}</dt>
                  <dd className={cn("min-w-0 py-[3px] text-ink-soft [overflow-wrap:anywhere]", c.m)}>{r.cells[i + 1]}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * `scripts/docs-facts.mjs` menyimpan deskripsi alat MCP paling banyak 400 karakter, jadi deskripsi yang lebih
 * panjang terpotong di tengah kata ("…refuses any quote whose asset, ne"). Yang ditampilkan berhenti di
 * kalimat utuh terakhir. Deskripsi lengkapnya tetap yang dikirim server MCP ke klien.
 */
const FACTS_DESCRIPTION_CAP = 400;
export function wholeSentences(text: string): string {
  const t = text.trim();
  // Panjang SEBELUM trim: potongan 400 karakter bisa berakhir dengan spasi ("…and an "), dan sesudah trim
  // ia tinggal 399 sehingga lolos dari pemeriksaan ini (check_stake, 4 Okt).
  if (text.length < FACTS_DESCRIPTION_CAP || /[.!?]['")\]]?$/.test(t)) return t;
  const ends = [...t.matchAll(/[.!?]['")\]]?(?=\s)/g)];
  const last = ends[ends.length - 1];
  return last?.index !== undefined ? t.slice(0, last.index + last[0].length) : t;
}

/** Tabel data, dirender dari fakta. Halaman hanya menyebut namanya. */
export function FactsTable({ table }: { table: string }) {
  if (table === "chains") {
    return (
      <DataTable
        cols={[
          { label: "Chain", td: `${TD} font-medium text-ink` },
          { label: "ID", td: TD_MONO, m: "font-mono text-[13px]" },
          { label: "Native" },
          { label: "Factory", td: TD_MONO, m: "font-mono text-[12px]" },
        ]}
        rows={facts.chains.map((c) => ({
          key: String(c.chainId),
          cells: [
            c.name,
            c.chainId,
            c.nativeSymbol ?? "—",
            c.explorer ? (
              // 32 px tinggi: tautan alamat di baris berurutan dulu rapat (tap<24 di t768).
              <a href={`${c.explorer}/address/${c.factory}`} target="_blank" rel="noopener noreferrer" className={ADDR_LINK}>
                {c.factory}
              </a>
            ) : (
              c.factory
            ),
          ],
        }))}
      />
    );
  }

  if (table === "mcpTools") {
    /**
     * Daftar, bukan tabel, di semua lebar. Tiga kolom (nama, argumen, deskripsi) di kolom baca 720 px membuat
     * deskripsi tinggal ±200 px dan setiap baris setinggi 10–20 baris; di ponsel deskripsinya malah keluar
     * layar. Nama dan argumen di satu baris, deskripsi selebar penuh di bawahnya.
     */
    return (
      <ul className="mt-5 divide-y divide-line rounded-panel border border-line">
        {facts.mcp.tools.map((t) => (
          <li key={t.name} className="px-4 py-3.5 sm:px-5">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              {/* Nama alat tidak pernah dipatahkan: "list_markets" sempat pecah 4–5 baris. */}
              <code className="whitespace-nowrap font-mono text-[14px] font-semibold text-ink">{t.name}</code>
              <span className="min-w-0 font-mono text-[12px] text-ink-faint [overflow-wrap:anywhere]">
                {t.args.length ? `(${t.args.join(", ")})` : "no arguments"}
              </span>
            </div>
            <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">
              <Inline text={wholeSentences(t.description)} />
            </p>
          </li>
        ))}
      </ul>
    );
  }

  if (table === "markets") {
    return (
      <DataTable
        cols={[{ label: "Market" }, { label: "Chain" }, { label: "Curve", td: TD_MONO, m: "font-mono text-[12px]" }]}
        rows={facts.markets.map((m) => ({
          key: `${m.chainId}:${m.symbol}`,
          cells: [
            <Link
              key="market"
              href={`/token/${m.slug}?chain=${m.chainId}`}
              className="inline-flex min-h-[32px] min-w-[44px] items-center font-semibold text-accent hover:underline"
            >
              ${m.symbol}
            </Link>,
            `${m.chainKey} · ${m.nativeSymbol}`,
            m.curve,
          ],
        }))}
      />
    );
  }

  if (table === "feeLegs") {
    /**
     * DUA KOLOM GENERASI, karena satu kolom pasti salah untuk salah satunya. Aturannya dibaca dari sumber
     * kedua generasi: 1.0.0 `swapFeeBps <= 500` dan `creator + buyback + PROTOCOL_FEE_BPS <= swapFeeBps`;
     * 0.11.0 (commit 98ffb1c) `swapFeeBps + PROTOCOL_FEE_BPS <= 500`. Angka per pasar sengaja TIDAK ada:
     * docs-facts tidak mencatat generasi tiap pasar.
     */
    const p = facts.fees.protocolBps;
    const max = facts.fees.maxTotalBps;
    const rows: Array<[string, string, string]> = [
      ["Creator", "chosen at launch", "chosen at launch"],
      ["Buyback", "chosen at launch", "chosen at launch"],
      ["Depth", "the rest: total − creator − buyback − protocol", "the rest: total − creator − buyback"],
      ["Protocol", `${p} bps, inside the configured total`, `${p} bps, added on top of the configured total`],
      ["Trader pays", "the configured total", `the configured total + ${p} bps`],
      ["Ceiling", `total ≤ ${max} bps`, `total + ${p} bps ≤ ${max} bps`],
    ];
    const generations = ["ADEXTO v1 (1.0.0) · every new launch", "0.11.0 factory · the six earlier markets"] as const;
    return (
      <>
        <div className="mt-5 hidden overflow-x-auto rounded-panel border border-line sm:block" tabIndex={0} role="region" aria-label="Table">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={TH}>Leg</th>
                <th className={TH}>{generations[0]}</th>
                <th className={TH}>{generations[1]}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([leg, current, previous]) => (
                <tr key={leg}>
                  <td className={`${TD} font-semibold text-ink`}>{leg}</td>
                  <td className={TD}>{current}</td>
                  <td className={TD}>{previous}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Ponsel: satu blok per generasi, karena yang dibandingkan pembaca adalah "pasar saya ikut aturan yang mana". */}
        <ul className="mt-5 divide-y divide-line rounded-panel border border-line sm:hidden">
          {generations.map((g, gi) => (
            <li key={g} className="px-4 py-3">
              <div className="text-[15px] font-semibold leading-snug text-ink">{g}</div>
              <dl className="mt-1 space-y-0.5">
                {rows.map(([leg, current, previous]) => (
                  <div key={leg} className="flex gap-3 text-[14px] leading-snug">
                    <dt className="w-[84px] shrink-0 py-[3px] text-ink-faint">{leg}</dt>
                    <dd className="min-w-0 py-[3px] text-ink-soft">{gi === 0 ? current : previous}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </>
    );
  }

  if (table === "analysers") {
    return (
      <DataTable
        cols={[
          { label: "Engine", td: `${TD} text-ink` },
          { label: "Result", td: TD_MONO, m: "font-mono text-[13px]" },
          { label: "Counts, as reported", short: "Counts", td: TD_MONO, m: "font-mono text-[12px]" },
        ]}
        rows={facts.analysers.map((a) => ({
          key: a.id,
          cells: [
            a.tool,
            a.status,
            a.counts
              ? Object.entries(a.counts)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(" · ")
              : "—",
          ],
        }))}
      />
    );
  }

  return null;
}

function codeLabel(b: { lang?: string; code: string }): string {
  if (b.lang) return b.lang;
  const c = b.code.trim();
  if (c.startsWith("{") || c.startsWith("[")) return "JSON";
  return "Command";
}

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "p") {
          return (
            // break-words: hash 66 karakter di dalam kalimat (halaman security) dulu keluar layar 313 px.
            <p key={i} className="mt-4 break-words text-[16px] leading-[1.75] text-ink-soft">
              <Inline text={b.text} />
            </p>
          );
        }
        if (b.type === "list") {
          return (
            <ul key={i} className="mt-4 space-y-2.5">
              {b.items.map((it, j) => (
                <li key={j} className="flex gap-3 text-[16px] leading-[1.7] text-ink-soft">
                  <span aria-hidden="true" className="mt-[0.72em] h-[5px] w-[5px] shrink-0 rounded-full bg-ink-faint" />
                  <span className="min-w-0 break-words">
                    <Inline text={it} />
                  </span>
                </li>
              ))}
            </ul>
          );
        }
        if (b.type === "code") {
          return <CopyField key={i} className="mt-5" multiline label={codeLabel(b)} copyLabel="code" value={b.code} />;
        }
        if (b.type === "note") {
          return (
            <div key={i} className="mt-5 flex items-start gap-3 rounded-panel border border-accent/25 bg-accent-soft p-4">
              <Info className="mt-[3px] h-[16px] w-[16px] shrink-0 text-accent" aria-hidden="true" />
              <p className="text-[15px] leading-relaxed text-ink">
                <Inline text={b.text} />
              </p>
            </div>
          );
        }
        if (b.type === "factsTable") return <FactsTable key={i} table={b.table} />;
        if (b.type === "steps") {
          return (
            <ol key={i} className="mt-4 space-y-3">
              {b.items.map((it, j) => (
                <li key={j} className="flex gap-3 text-[16px] leading-[1.7] text-ink-soft">
                  <span
                    aria-hidden="true"
                    className="mt-[0.18em] flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent"
                  >
                    {j + 1}
                  </span>
                  <span className="min-w-0 break-words">
                    <Inline text={it} />
                  </span>
                </li>
              ))}
            </ol>
          );
        }
        if (b.type === "see") {
          const links = b.links.filter((l) => isInternalHref(l.href));
          if (!links.length) return null;
          return (
            <div key={i} className="mt-6">
              <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">See also</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="group inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[14px] font-medium text-ink transition-colors hover:border-accent/40 hover:text-accent"
                    >
                      {l.label}
                      <ArrowRight className="h-[13px] w-[13px] text-ink-faint transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        }
        return null;
      })}
    </>
  );
}

/** Satu seksi dengan judul berjangkar. `id` dari `slugify(heading)`. */
export function DocSection({ id, heading, children }: { id: string; heading: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-12 first:mt-0">
      <h2 id={`${id}-title`} className="group flex items-baseline gap-2 text-[22px] font-semibold leading-snug tracking-tight text-ink">
        <span>{heading}</span>
        <a
          href={`#${id}`}
          aria-label={`Link to ${heading}`}
          className="text-[18px] font-normal text-ink-faint no-underline opacity-0 transition-opacity hover:text-accent focus-visible:opacity-100 group-hover:opacity-100"
        >
          #
        </a>
      </h2>
      {children}
    </section>
  );
}

/**
 * Asal angka di halaman docs: fakta, bukan model.
 *
 * Halaman `origin: "hand-written"` (7 Okt) mendapat catatan sendiri, karena kalimat bawaan di bawah
 * ("every … fee value … is generated from docs-facts.json") tidak benar untuk halaman itu: tingkatan fee,
 * batas laju dan minimum stake di sana dibaca dari kode sumber, bukan dari berkas fakta. Yang tetap
 * dijaga `docs-verify.mjs` untuk keduanya: alamat, host, dan nama alat MCP.
 */
export function SourceNote({ origin }: { origin?: string } = {}) {
  if (origin === "hand-written") {
    return (
      <p className="mt-12 text-[13px] leading-relaxed text-ink-faint">
        This page was written from the ADEXTO source code. Every address, host and MCP tool name on it is checked by{" "}
        <code className="text-accent">scripts/docs-verify.mjs</code> against{" "}
        <code className="text-accent">src/config/docs-facts.json</code>, a file read from the repository and from chain.
      </p>
    );
  }
  return (
    <p className="mt-12 text-[13px] leading-relaxed text-ink-faint">
      Every address, chain id, fee value and tool name in these docs is generated from{" "}
      <code className="text-accent">src/config/docs-facts.json</code>, which is read from the repository and from chain by{" "}
      <code className="text-accent">scripts/docs-facts.mjs</code>. Analyser figures were scanned{" "}
      {new Date(facts.analysersScannedAt).toISOString().slice(0, 10)}. Prose was drafted with a language model and
      checked against those facts by <code className="text-accent">scripts/docs-verify.mjs</code>; the model is never
      the source of a number.
    </p>
  );
}
