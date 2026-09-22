#!/usr/bin/env node
/**
 * Render satu dek HTML menjadi PDF lanskap, satu slide satu halaman.
 *
 * Dipisah dari skrip perakit supaya dek mana pun bisa dicetak dengan alat yang sama —
 * dek Founder House dicetak dengan jalur ini juga.
 *
 * `printBackground: true` wajib: seluruh dek memakai latar cream dan kartu berwarna, dan
 * tanpa itu PDF-nya keluar putih dengan teks tipis. `preferCSSPageSize` mengikuti
 * `@page { size: 1280px 720px }` di dek, jadi ukuran halaman datang dari satu tempat dan
 * bukan dari argumen di sini yang bisa menyimpang.
 *
 *   node scripts/render-deck.mjs build/campaign/index.html
 *   node scripts/render-deck.mjs public/founder-house/index.html
 */
import { chromium } from "playwright";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const input = process.argv[2];
if (!input || !existsSync(input)) {
  console.error("render-deck: pass a path to an existing deck HTML file");
  process.exit(1);
}

// Nama PDF diambil dari tautan unduh di dek itu sendiri, supaya tombol di dek dan berkas
// yang dihasilkan tidak bisa berbeda nama.
const html = (await import("node:fs")).readFileSync(input, "utf8");
const m = html.match(/id="dl"\s+href="([^"]+\.pdf)"/);
const pdfName = m ? path.basename(m[1]) : `${path.basename(input, ".html")}.pdf`;
const out = path.join(path.dirname(input), pdfName);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(`file://${path.resolve(input)}`, { waitUntil: "load" });
// Dek memasang skala lewat JS pada load; beri satu frame supaya cetakan tidak menangkap
// keadaan sebelum itu.
await page.waitForTimeout(600);
await page.emulateMedia({ media: "print" });
await page.pdf({ path: out, printBackground: true, preferCSSPageSize: true });
await browser.close();

const kb = (statSync(out).size / 1024).toFixed(0);
console.log(`wrote ${out}  (${kb} KB)`);
