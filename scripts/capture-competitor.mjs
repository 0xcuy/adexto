/**
 * Tangkap halaman pesaing untuk perbandingan desain.
 *
 * Mengambil teksnya lewat fetch tidak cukup: yang dinilai juri adalah pikselnya —
 * disiplin warna, kerapatan, hierarki. Jadi halamannya dirender di peramban nyata
 * pada viewport yang sama seperti tangkapan kita, supaya perbandingannya adil.
 *
 * Pakai: TARGET_URL=https://... OUT=/tmp/x.png node scripts/capture-competitor.mjs
 */
import { chromium } from "playwright";

const url = process.env.TARGET_URL;
const out = process.env.OUT || "/tmp/competitor.png";
if (!url) {
  console.log("  TARGET_URL wajib diisi");
  process.exit(1);
}

const browser = await chromium.launch();
// Viewport dan skala disamakan dengan scripts/capture-showcase.mjs agar sebanding.
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
});
const page = await ctx.newPage();
try {
  await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
} catch {
  // Banyak situs marketing menahan networkidle karena polling; lanjut apa adanya.
  console.log("  networkidle tidak tercapai, lanjut dengan keadaan sekarang");
}
await page.waitForTimeout(4000);
await page.screenshot({ path: out });

const title = await page.title();
const text = (await page.evaluate(() => document.body.innerText)).replace(/\n{2,}/g, "\n").slice(0, 1200);
console.log(`  judul : ${title}`);
console.log(`  gambar: ${out}`);
console.log(`  ---- teks awal ----\n${text}`);
await browser.close();
