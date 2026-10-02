/**
 * Render logo chain di `public/brand/*.svg` menjadi PNG untuk chip chain di kartu bagikan.
 *
 * Satori (`next/og`) tidak menggambar SVG, jadi kartu memerlukan salinan raster, sama seperti
 * mark ADEXTO di `scripts/render-share-mark.mjs`. Bentuk dan warnanya TIDAK diubah: berkas SVG
 * yang sama, dirasterkan apa adanya ke kanvas transparan (lihat public/brand/SOURCES.txt — brand
 * kit melarang memotong atau mewarnai ulang). 0G tidak ada di sini karena mark-nya sudah PNG
 * (`public/brand/0g-token.png`), dan `chainMark()` di `src/lib/chains.ts` memilihnya.
 *
 * Pakai: node scripts/render-chain-marks.mjs
 */
import { readFileSync } from "node:fs";
import sharp from "sharp";

const SIZE = 96;
const MARKS = ["arbitrum", "base", "monad", "robinhood"];

for (const name of MARKS) {
  const svg = readFileSync(`public/brand/${name}.svg`);
  const out = `public/share/chain-${name}.png`;
  const info = await sharp(svg, { density: 768 })
    .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(out);
  console.log(`${out} ${info.width}x${info.height} ${info.size} bytes`);
}
