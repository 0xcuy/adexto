/**
 * Render `public/logo.svg` menjadi PNG bertinta krem untuk kartu bagikan.
 *
 * Satori (`next/og`) tidak menggambar SVG, jadi kartu memerlukan salinan raster dari mark
 * ADEXTO. Tanpa ini kartunya memakai kotak "A" karangan sebagai pengganti logo.
 *
 * Tinta krem, bukan #141110: kartunya berlatar charcoal, dan di situs tinta gelap itu juga
 * dibalik di tema gelap (aturan `img[src="/logo.svg"]` di globals.css).
 *
 * Pakai: node scripts/render-share-mark.mjs
 */
import { readFileSync } from "node:fs";
import sharp from "sharp";

const INK = "#f7f2e9";
const SIZE = 256;

const source = readFileSync("public/logo.svg", "utf8");
if (!source.includes('fill="#141110"')) {
  throw new Error('public/logo.svg no longer has fill="#141110"; update this script to match it.');
}
const svg = source.replace('fill="#141110"', `fill="${INK}"`);

const info = await sharp(Buffer.from(svg), { density: 384 })
  .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile("public/share/adexto-mark.png");

console.log(`public/share/adexto-mark.png ${info.width}x${info.height} ${info.size} bytes`);
