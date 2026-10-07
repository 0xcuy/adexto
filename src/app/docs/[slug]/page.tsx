import { notFound } from "next/navigation";
import pagesJson from "@/config/docs-pages.json";
import DocsShell from "@/app/docs/DocsShell";
import { Blocks, DocSection, SourceNote, slugify, type DocSectionData } from "@/app/docs/DocBlocks";
import { DOC_HEADINGS, DOC_SUMMARIES, groupOf } from "@/app/docs/docs-nav";
import { docArt } from "@/app/docs/docs-art";

/**
 * Halaman anak docs (`/docs/<slug>`, juga `docs.adexto.xyz/<slug>` lewat middleware), dirender dari JSON.
 *
 * Bentuk (4 Okt, permintaan owner, meniru docs comfy.fun): sidebar berkelompok, judul, kotak "In short"
 * tiga kalimat biasa dari `docs-nav.ts`, lalu seksi lengkap dengan jangkar, "On this page" di layar lebar,
 * dan pager. Lede panjang dari JSON tidak lagi tampil: ia hanya mengulang seksi dalam kalimat yang lebih
 * berat, dan di halaman launch ia malah keliru ("per-transaction purchase cap", padahal batasnya saldo
 * dompet). Ringkasan yang ditulis tangan menggantikannya.
 *
 * Perender blok, tabel fakta, dan alasan "JSON, bukan MDX" ada di `../DocBlocks.tsx`.
 */

interface DocPage {
  title: string;
  lede: string;
  sections: DocSectionData[];
  /** `"hand-written"` untuk halaman yang tidak disusun `docs-draft.mjs` (lihat `SourceNote`). */
  origin?: string;
}

const pages = pagesJson as unknown as { pages: Record<string, DocPage>; order?: string[] };

export function generateStaticParams() {
  return Object.keys(pages.pages).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = pages.pages[slug];
  if (!page) return { title: "Not found — ADEXTO docs" };
  const summary = DOC_SUMMARIES[slug];
  return { title: `${page.title} — ADEXTO docs`, description: (summary?.[0] ?? page.lede).slice(0, 180) };
}

export default async function DocsChildPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = pages.pages[slug];
  if (!page) notFound();

  const href = `/docs/${slug}`;
  // Judul kalimat biasa dari docs-nav.ts, hanya bila jumlahnya cocok persis dengan seksi JSON.
  const plain = DOC_HEADINGS[slug];
  const usePlain = Boolean(plain && plain.length === page.sections.length);
  const seen = new Set<string>();
  const sections = page.sections.map((s, i) => {
    const heading = usePlain ? plain![i] : s.heading;
    let id = slugify(heading) || "section";
    while (seen.has(id)) id = `${id}-2`;
    seen.add(id);
    return { ...s, heading, id };
  });

  return (
    <DocsShell
      current={href}
      title={page.title}
      kicker={groupOf(href)}
      summary={DOC_SUMMARIES[slug]}
      art={docArt(slug)}
      toc={sections.map((s) => ({ id: s.id, label: s.heading }))}
    >
      {sections.map((s) => (
        <DocSection key={s.id} id={s.id} heading={s.heading}>
          <Blocks blocks={s.blocks} />
        </DocSection>
      ))}
      <SourceNote origin={page.origin} />
    </DocsShell>
  );
}
