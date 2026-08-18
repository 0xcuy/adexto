/**
 * Melacak halaman mana yang memicu error hidrasi React (#418/#423 dst).
 * Dijalankan per rute agar penyebabnya bisa dipersempit.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const ROUTES = (process.env.ROUTES || "/,/studio,/swap,/explorer,/docs,/pitch,/governance,/whitepaper").split(",");

const browser = await chromium.launch();
let bad = 0;

for (const route of ROUTES) {
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e.message).replace(/\s+/g, " ").slice(0, 200)));
  page.on("console", (m) => {
    const t = m.text();
    if (/hydrat|#418|#423|#425|did not match/i.test(t)) errs.push(`console: ${t.replace(/\s+/g, " ").slice(0, 200)}`);
  });
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(3500);
  } catch (e) {
    errs.push(`navigasi gagal: ${e.message.slice(0, 120)}`);
  }
  const hyd = errs.filter((e) => /hydrat|#418|#423|#425|did not match/i.test(e));
  console.log(`${hyd.length === 0 ? "BERSIH" : "HIDRASI"}  ${route}`);
  for (const e of errs) console.log(`         ${e}`);
  if (hyd.length > 0) bad++;
  await page.close();
}

console.log(`\n${bad} rute dengan masalah hidrasi`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
