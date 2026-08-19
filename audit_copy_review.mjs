/**
 * Tarik seluruh teks yang benar-benar TERLIHAT di setiap rute, untuk ditinjau
 * kalimat demi kalimat.
 *
 * Kenapa bukan `curl`: separuh permukaan situs ini dirender setelah hidrasi —
 * panel World ID, daftar market, status pool, harga. Memeriksa dengan curl
 * berulang kali membuat saya menyimpulkan copy belum terpasang padahal HTML
 * awalnya memang belum memuatnya.
 *
 * Kenapa bukan tangkapan layar saja: klaim yang salah paling sering berupa satu
 * kata di tengah paragraf ("live", "omnichain", "audited"), dan itu tidak
 * tertangkap mata saat memindai gambar sepanjang 3.000 px.
 *
 * Pakai: BASE_URL=https://adexto.xyz node audit_copy_review.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || "https://adexto.xyz";
const OUT = process.env.OUT_DIR || "/tmp/adexto-copy";
const ROUTES = (
  process.env.ROUTES ||
  "/,/studio,/swap,/explorer,/docs,/pitch,/whitepaper,/governance,/agent/demo"
).split(",");

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

/** Shim wallet: panel yang hanya muncul saat tersambung juga perlu ditinjau. */
await page.addInitScript(`
  window.__ACC__ = "0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D";
  window.ethereum = {
    isMetaMask: true, _cbs: {},
    on(ev, cb) { (this._cbs[ev] = this._cbs[ev] || []).push(cb); },
    removeListener() {},
    async request({ method }) {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [window.__ACC__];
      if (method === "eth_chainId") return "0x40da";
      return null;
    },
  };
`);

for (const route of ROUTES) {
  const name = route === "/" ? "home" : route.replace(/\//g, "_").replace(/^_/, "");
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);

  const text = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(path.join(OUT, `${name}.txt`), text);
  console.log(`  ${name.padEnd(12)} ${String(text.split("\n").filter(Boolean).length).padStart(4)} baris`);
}

await browser.close();
console.log(`\nselesai -> ${OUT}`);
