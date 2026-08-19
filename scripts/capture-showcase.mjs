/**
 * Tangkap gambar showcase untuk Developer Portal World ID.
 *
 * Diambil dari build yang chain-nya HIDUP, bukan dari produksi. Bukan untuk
 * memoles: di produksi factory peluncuran belum di-broadcast, jadi studio
 * menampilkan spanduk "Launching is disabled" yang membuat produk yang berjalan
 * penuh terlihat setengah jadi. Kodenya sama; yang berbeda hanya peta chain.
 *
 * Gambar 1 sengaja studio, karena di sanalah verifikasi World ID terjadi — itu
 * yang paling relevan bagi peninjau World.
 *
 * Pakai: node scripts/capture-showcase.mjs
 *   env: BASE_URL (bawaan http://127.0.0.1:3100), OUT_DIR (bawaan public/showcase)
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const OUT = process.env.OUT_DIR || path.join(process.cwd(), "public", "showcase");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
// 1600x1000 memberi rasio lebar yang lazim untuk galeri, dan teks tetap terbaca
// tanpa harus diperbesar oleh peninjau.
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

/** Wallet shim: studio hanya menampilkan panel World ID dan target launch bila tersambung. */
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

const shots = [
  {
    file: "1-studio-world-id.png",
    route: "/studio",
    connect: true,
    // Digulir ke seksi kurva + World ID: itu inti yang perlu dilihat peninjau.
    scrollTo: "World ID proof of personhood",
  },
  { file: "2-landing.png", route: "/", connect: false },
  // Gambar 3 memakai /docs, BUKAN /explorer. Di produksi factory peluncuran belum
  // di-broadcast, jadi explorer menampilkan "0 with an executable bonding curve" —
  // jujur, tapi memperlihatkan pasar kosong. Halaman docs justru mendokumentasikan
  // integrasi World ID, yang paling menolong peninjau.
  { file: "3-docs-world-id.png", route: "/docs", connect: false, scrollTo: "World ID proof of personhood" },
];

for (const shot of shots) {
  await page.goto(`${BASE}${shot.route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  if (shot.connect) {
    const btn = page.locator('button:has-text("Connect")').first();
    if ((await btn.count()) > 0) {
      await btn.click();
      await page.waitForTimeout(2000);
    }
  }
  if (shot.scrollTo) {
    const anchor = page.locator(`text=${shot.scrollTo}`).first();
    if ((await anchor.count()) > 0) {
      await anchor.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1200);
    }
  }

  const out = path.join(OUT, shot.file);
  await page.screenshot({ path: out });
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`  ${shot.file.padEnd(24)} ${shot.route.padEnd(11)} ${kb} KB`);
}

await browser.close();
console.log(`\nselesai -> ${OUT}`);
