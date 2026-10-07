/**
 * Gambar hero docs: satu per halaman, dibuat `scripts/docs-images.mjs` (z-image-turbo lewat router 0G),
 * dipotong 12:5 dan disimpan sebagai WebP di `public/docs/art/<slug>.webp` (1440 px) dan
 * `<slug>-720.webp` (720 px).
 *
 * Hiasan saja, jadi `alt` kosong: gambarnya tidak membawa informasi yang tidak ada di teks, dan pembaca
 * layar tidak perlu mendengar "robot memegang kartu" di atas setiap halaman.
 *
 * Daftar slug ditulis tangan, bukan dibaca dari direktori: halaman tanpa entri di sini tampil tanpa
 * gambar alih-alih memasang `<img>` yang 404. `home` adalah `/docs`.
 */
const SLUGS_WITH_ART = new Set([
  "home",
  "quickstart",
  "glossary",
  "launch",
  "studio-guide",
  "agent-launch",
  "fees",
  "agent-identity",
  "trading",
  "market-page",
  "finding-markets",
  "cross-chain",
  "wallets",
  "chains",
  "creator-earnings",
  "staking",
  "compute",
  "referrals",
  "mcp",
  "a2a",
  "x402",
  "public-api",
  "data",
  "security",
  "check-a-market",
  "risks",
  "reporting",
  "faq",
  "troubleshooting",
  "telegram",
]);

export interface DocArt {
  src: string;
  srcSet: string;
  width: number;
  height: number;
}

export function docArt(slug: string): DocArt | null {
  if (!SLUGS_WITH_ART.has(slug)) return null;
  const base = `/docs/art/${slug}`;
  return { src: `${base}.webp`, srcSet: `${base}-720.webp 720w, ${base}.webp 1440w`, width: 1440, height: 600 };
}
