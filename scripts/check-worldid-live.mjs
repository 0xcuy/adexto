/**
 * Bukti gerbang World ID benar-benar tampil dan aktif di deployment yang berjalan.
 *
 * Panel World ID dirender SETELAH hidrasi, karena statusnya diambil dari
 * `/api/worldid/verify` di klien. Jadi memeriksanya dengan `curl` selalu gagal
 * meski gerbangnya sehat — HTML awal memang belum memuatnya. Pemeriksaan ini
 * memakai peramban sungguhan supaya jawabannya sahih.
 *
 * Pakai: BASE_URL=https://adexto.xyz node scripts/check-worldid-live.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://adexto.xyz";

const gate = await fetch(`${BASE}/api/worldid/verify`).then((r) => r.json());
console.log(`  gate=${gate.gate}  protokol=${gate.protocol}  action=${gate.action ?? "-"}  ketat=${gate.oneLaunchPerHuman}`);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${BASE}/studio`, { waitUntil: "networkidle" });
await page.waitForTimeout(4000);
const text = await page.evaluate(() => document.body.innerText);

const checks = [
  ["panel World ID tampil", /World ID proof of personhood/i.test(text)],
  ["gerbang dinyatakan aktif", /verified server-side/i.test(text)],
  ["aturan satu peluncuran dinyatakan", /gets one launch/i.test(text)],
  ["tombol Verify tersedia", (await page.locator('button:has-text("Verify with World ID")').count()) > 0],
  ["tidak mengaku NOT CONFIGURED", !/NOT CONFIGURED/i.test(text)],
];

let fail = 0;
for (const [label, ok] of checks) {
  if (!ok) fail++;
  console.log(`  ${ok ? "LULUS" : "GAGAL"}  ${label}`);
}
await browser.close();
process.exit(fail === 0 ? 0 : 1);
