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
/**
 * 1600x1000 memberi rasio lebar yang lazim untuk galeri, dan teks tetap terbaca.
 *
 * deviceScaleFactor DIBIARKAN 1. Dengan 2x, dua dari tiga gambar keluar di 682 KB
 * dan 562 KB — melewati batas 500 KB portal, jadi akan ditolak. Skala 1 pada
 * lebar 1600 masih tajam untuk ditinjau, dan berkasnya jauh di bawah batas.
 */
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
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

/**
 * Meta tag image (OpenGraph) — WAJIB kotak.
 *
 * Portal memakainya saat tautan app dibagikan, dan jatuh ke logo bila tidak diisi.
 * Dibuat dari public/logo.svg yang memang sudah 512x512, dirender di peramban agar
 * gradiennya ikut — ImageMagick sering kehilangan gradien SVG karena butuh
 * delegate terpisah.
 *
 * Dua ukuran dibuat: 512 untuk pemakaian umum, dan 200 kalau portal menuntut
 * ukuran kecil yang persis.
 */
const logoSvg = fs.readFileSync(path.join(process.cwd(), "public", "logo.svg"), "utf8");
const logoData = `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString("base64")}`;

for (const size of [512, 200]) {
  const square = await ctx.newPage();
  await square.setViewportSize({ width: size, height: size });
  await square.setContent(`
    <html><body style="margin:0;width:${size}px;height:${size}px;background:#04060A;display:flex;align-items:center;justify-content:center">
      <img src="${logoData}" style="width:100%;height:100%;display:block" />
    </body></html>
  `);
  await square.waitForTimeout(600);
  const out = path.join(OUT, `meta-${size}x${size}.png`);
  await square.screenshot({ path: out });
  await square.close();
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`  ${`meta-${size}x${size}.png`.padEnd(24)} ${"(logo)".padEnd(11)} ${kb} KB`);
}

await browser.close();

// Batas 500 KB portal diperiksa di sini, bukan diserahkan ke penolakan unggahan.
console.log("");
let over = 0;
for (const f of fs.readdirSync(OUT).sort()) {
  const kb = fs.statSync(path.join(OUT, f)).size / 1024;
  const flag = kb > 500 ? "MELEBIHI 500 KB" : "aman";
  if (kb > 500) over++;
  console.log(`  ${f.padEnd(24)} ${kb.toFixed(0).padStart(4)} KB  ${flag}`);
}
console.log(`\nselesai -> ${OUT}`);
if (over > 0) {
  console.log(`${over} berkas melewati batas portal — turunkan viewport atau deviceScaleFactor`);
  process.exit(1);
}
