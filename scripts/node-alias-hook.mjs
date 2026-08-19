/**
 * Membuat alias `@/` milik TypeScript bisa dipakai Node langsung.
 *
 * Berguna untuk menguji lib SERVER tanpa melewati HTTP. Sebagian aturan hanya
 * bisa dibuktikan dengan memanggil fungsinya: kuota World ID, misalnya, baru
 * terisi di tahap confirm yang menuntut transaksi on-chain — jadi harness HTTP
 * memeriksanya pada keadaan kosong dan lolos secara palsu.
 *
 * Node tidak membaca `paths` dari tsconfig, jadi `@/lib/x` diterjemahkan di sini
 * ke `<root>/src/lib/x.ts`.
 *
 * Pakai: node --experimental-strip-types --import ./scripts/node-alias-hook.mjs <skrip>
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const rootHref = pathToFileURL(`${process.cwd()}/`).href;

// Hook dikirim sebagai data URL supaya tidak perlu berkas kedua.
const hook = `
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = ${JSON.stringify(rootHref)};

export function resolve(specifier, context, next) {
  if (!specifier.startsWith("@/")) return next(specifier, context);

  const base = new URL("src/" + specifier.slice(2), ROOT);
  // Specifier TypeScript ditulis tanpa ekstensi, jadi kandidatnya dicoba di sini.
  for (const candidate of [base.href, base.href + ".ts", base.href + ".tsx", base.href + "/index.ts"]) {
    try {
      if (fs.statSync(fileURLToPath(candidate)).isFile()) return next(candidate, context);
    } catch {}
  }
  return next(base.href, context);
}
`;

register(`data:text/javascript,${encodeURIComponent(hook)}`);
