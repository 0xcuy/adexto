/**
 * Memeriksa bagian pembuka rekaman saja: landing termuat, gulirannya jalan, dan CTA
 * "Open Studio" benar-benar membawa ke /studio. Berhenti sebelum apa pun yang menyentuh
 * dompet, jadi tidak ada gas yang terbakar.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

const hero = ((await page.locator("h1").first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
console.log(`  hero        : ${hero.slice(0, 78)}`);

for (const y of [0, 420, 900, 1500]) {
  await page.evaluate((top) => window.scrollTo({ top, behavior: "smooth" }), y);
  await page.waitForTimeout(500);
}
const scrolled = await page.evaluate(() => Math.round(window.scrollY));
console.log(`  gulir capai : ${scrolled} px`);

await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
await page.waitForTimeout(600);

const cta = page.locator('a:has-text("Open Studio")').first();
console.log(`  CTA ditemukan: ${(await cta.count()) > 0 ? "YA" : "TIDAK"}`);
await cta.hover();
await cta.click();
await page.waitForURL(/\/studio/, { timeout: 30000 });
console.log(`  url sesudah  : ${page.url()}`);

const tickerField = page.locator('input[value="AQUANT"]').first();
console.log(`  studio siap  : field ticker ${(await tickerField.count()) > 0 ? "ADA" : "TIDAK ADA"}`);

const chains = [];
for (const n of ["0G", "Arbitrum", "Base", "Monad"]) {
  if ((await page.locator(`button[title*="${n}"]`).count()) > 0) chains.push(n);
}
console.log(`  tombol chain : ${chains.join(", ")}`);
console.log(`  galat halaman: ${errors.length === 0 ? "tidak ada" : errors.join(" | ")}`);

await browser.close();
process.exit(errors.length === 0 && /\/studio/.test(page.url()) ? 0 : 1);
