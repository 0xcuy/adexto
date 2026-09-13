/**
 * Rekam pembelian lintas chain x402 yang SUNGGUHAN, dari penemuan sampai fill terlihat.
 *
 *   node record_x402_demo.mjs                 # rekam TANPA membeli (kering)
 *   X402_REC_BUY=1 node record_x402_demo.mjs  # rekam DAN lakukan pembelian berbayar
 *
 * KENAPA PEMBELIANNYA DI LUAR PERAMBAN, dan kenapa itu bukan kecurangan
 *
 * Pembayar x402 tidak memakai dompet peramban. Ia menandatangani otorisasi EIP-3009 —
 * sebuah tanda tangan, bukan transaksi — dan relayer yang mengirimkannya. Jadi tidak ada
 * dialog dompet untuk direkam, dan memalsukannya di UI justru akan menggambarkan alur yang
 * salah.
 *
 * Yang direkam karena itu adalah dua hal yang MEMANG hidup di peramban: halaman `/agent/demo`
 * melakukan permintaan HTTP 402 sungguhan ke gerbang dan menampilkan status aslinya, lalu
 * terminal token menampilkan fill yang baru mendarat. Pembeliannya sendiri dijalankan lewat
 * `scripts/x402-buy.mts` di antara adegan — skrip yang sama yang dipakai membuktikannya di
 * luar rekaman, bukan jalur khusus video.
 *
 * Konsekuensi yang diterima: bukti pembayarannya adalah FILL yang muncul, bukan animasi.
 * Itu memang bentuk buktinya di protokol ini.
 *
 * ATURAN YANG DIWARISI dari record_demo_testnet.mjs dan tidak dilanggar di sini: tidak ada
 * banner, caption, kursor palsu, atau overlay apa pun. Yang terekam adalah antarmuka apa
 * adanya.
 */
import { chromium } from "playwright";
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const BASE = process.env.BASE_URL || "https://adexto.xyz";
const SYMBOL = (process.env.X402_REC_SYMBOL || "parcel").toLowerCase();
/** Timeframe untuk adegan terminal. 900 dipilih dari pengukuran, lihat catatan di bawah. */
const TF = process.env.X402_REC_TF || "900";
const DO_BUY = process.env.X402_REC_BUY === "1";
const PACE = Number(process.env.X402_REC_PACE || 1);
const HEADED = process.env.X402_REC_HEADED === "1";

const W = 1920;
const H = 1080;
const RAW_DIR = path.join(process.cwd(), "public", "demo-raw-x402");
const OUT_MP4 = path.join(process.cwd(), "public", "adexto_x402_demo.mp4");
const OUT_WEBM = path.join(process.cwd(), "public", "adexto_x402_demo.webm");

const scene = (s) => console.log(`\n=== ${s}`);
const beat = (page, ms = 900) => page.waitForTimeout(Math.max(180, Math.round(ms * PACE)));

async function safely(label, fn) {
  try {
    await fn();
    return true;
  } catch (e) {
    console.log(`  ! ${label}: ${String(e.message).split("\n")[0].slice(0, 140)}`);
    return false;
  }
}

/** Gulir halus supaya rekaman tidak melompat, dan berhenti di elemen yang dituju. */
async function glideTo(page, selectorOrText) {
  await page.evaluate((needle) => {
    const el =
      document.querySelector(needle) ||
      [...document.querySelectorAll("h2, h3, section, div")].find((n) =>
        (n.textContent || "").includes(needle)
      );
    (el ?? document.body).scrollIntoView({ block: "center", behavior: "smooth" });
  }, selectorOrText);
}

// ── keadaan pasar SEBELUM, dibaca dari chain ────────────────────────────────
const market = await (await fetch(`${BASE}/api/pool?symbol=${SYMBOL.toUpperCase()}`)).json();
if (!market?.poolAddress) {
  console.error(`Tidak ada pasar untuk ${SYMBOL.toUpperCase()} di ${BASE}`);
  process.exit(1);
}
const RPC = market.chainId === 143 ? process.env.MONAD_RPC_URL || "https://rpc.monad.xyz" : process.env.OG_RPC_URL || "https://evmrpc.0g.ai";
const provider = new ethers.JsonRpcProvider(RPC, market.chainId, { staticNetwork: true });
const curve = new ethers.Contract(market.poolAddress, ["function swapCount() view returns (uint256)"], provider);
const swapsBefore = await curve.swapCount();

console.log(`pasar    : $${market.symbol} di ${market.chainName} (${market.chainId})`);
console.log(`kurva    : ${market.poolAddress}`);
console.log(`swapCount: ${swapsBefore}`);
console.log(`beli asli: ${DO_BUY ? "YA — uang sungguhan" : "tidak (kering)"}`);

fs.mkdirSync(RAW_DIR, { recursive: true });

const browser = await chromium.launch({
  headless: !HEADED,
  args: ["--hide-scrollbars", "--disable-features=IsolateOrigins,site-per-process"],
});
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: RAW_DIR, size: { width: W, height: H } },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message)));

// ── 1. Landing: klaimnya, di tempat pembaca pertama menemukannya ────────────
scene("1) LANDING — pembelian lintas chain sebagai klaim di halaman utama");
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await beat(page, 2600);
await safely("gulir ke seksi cross-chain", async () => {
  await glideTo(page, "Pay on Base");
  await beat(page, 3200);
});

// ── 2. Halaman referensi: syaratnya, bukan iklannya ─────────────────────────
scene("2) /x402 — syarat, aset, dan endpoint yang bisa dipanggil siapa pun");
await page.goto(`${BASE}/x402`, { waitUntil: "domcontentloaded" });
await beat(page, 2600);
await safely("gulir ke endpoint", async () => {
  await glideTo(page, "Try it without paying");
  await beat(page, 3400);
});
/**
 * Endpoint yang tercetak di halaman ini DITURUNKAN dari registry, jadi adegan ini juga
 * membuktikan hal kedua: ia menyebut pasar yang benar-benar hidup, bukan ticker yang dipaku.
 */
const shownEndpoint = await page
  .locator("text=/v1\\/x402\\/buy\\//")
  .first()
  .textContent()
  .catch(() => null);
console.log(`  endpoint di halaman: ${String(shownEndpoint).trim().slice(0, 90)}`);

// ── 3. Tantangan 402 sungguhan, dilakukan peramban di depan kamera ──────────
scene("3) /agent/demo — permintaan tanpa bayar, 402 asli dari gerbang");
await page.goto(`${BASE}/agent/demo`, { waitUntil: "domcontentloaded" });
await beat(page, 2400);
await safely("panggil gerbang", async () => {
  const btn = page.locator("button", { hasText: /Quote a \$[A-Z]+ buy/ }).first();
  await btn.waitFor({ state: "visible", timeout: 20000 });
  await btn.scrollIntoViewIfNeeded();
  await beat(page, 900);
  await btn.click();
  // Status HTTP yang ditampilkan halaman ini berasal dari permintaan yang baru terjadi.
  await page.waitForSelector("text=/402|HTTP/", { timeout: 60000 });
  await beat(page, 4200);
});

// ── 4. Terminal SEBELUM fill ────────────────────────────────────────────────
scene(`4) TERMINAL — pasar sebelum pembelian (tf=${TF})`);
await page.goto(`${BASE}/token/${SYMBOL}?chain=${market.chainId}&tf=${TF}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("canvas", { timeout: 60000 });
await beat(page, 4200);
await safely("gulir ke trade feed", async () => {
  await glideTo(page, "TRADE FEED");
  await beat(page, 3000);
});

// ── 5. Pembelian berbayar SUNGGUHAN, dijalankan di antara adegan ────────────
let bought = null;
if (DO_BUY) {
  scene("5) PEMBELIAN BERBAYAR — 0,10 USDC di Base, token di chain pasar");
  const r = spawnSync(
    "./node_modules/.bin/tsx",
    ["scripts/x402-buy.mts", "--symbol", SYMBOL, "--broadcast"],
    { encoding: "utf8", timeout: 300000 }
  );
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  out
    .split("\n")
    .filter((l) => /pengiriman|settlement|LULUS|GAGAL|USDC keluar|diterima/.test(l))
    .forEach((l) => console.log(`  ${l.trim()}`));
  bought = r.status === 0;
  if (!bought) console.log("  ! pembelian gagal; adegan sesudah ini akan memperlihatkan pasar yang tidak berubah");
} else {
  scene("5) PEMBELIAN DILEWATI — jalankan dengan X402_REC_BUY=1 untuk membeli sungguhan");
}

// ── 6. Terminal SESUDAH: fill mendarat, dibaca dari chain ───────────────────
scene("6) TERMINAL — fill yang baru mendarat, sumbernya on-chain");
/**
 * Menunggu `swapCount` NAIK, bukan menunggu jeda tetap.
 *
 * Jeda tetap adalah cara adegan penutup gagal tanpa suara: kalau chain lebih lambat dari
 * jedanya, video menampilkan pasar yang belum berubah dan seluruh rekaman kehilangan
 * pokoknya. Kalau lebih cepat, kamera menunggu tanpa alasan.
 */
if (DO_BUY && bought) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const now = await curve.swapCount();
    if (now > swapsBefore) {
      console.log(`  swapCount ${swapsBefore} -> ${now}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  /**
   * Riwayat DIISI ke store lebih dulu, karena jendela log Monad tidak menjangkau.
   *
   * Monad membatasi `eth_getLogs` 100 blok, jadi pemindaian langsung hanya melihat sekitar
   * delapan menit terakhir. Fill baru memang ada di dalamnya, tetapi fill peluncuran tidak —
   * dan tanpa langkah ini chart penutup akan memperlihatkan satu fill terpisah alih-alih
   * pasar yang utuh.
   */
  const bf = spawnSync(
    "node",
    [
      "scripts/backfill-trades.mjs",
      "--symbol",
      SYMBOL.toUpperCase(),
      "--chain",
      market.chainId === 143 ? "monad" : "0g",
      "--from-block",
      String(Number(await provider.getBlockNumber()) - 400),
      "--broadcast",
    ],
    { encoding: "utf8", timeout: 300000 }
  );
  const sent = (bf.stdout || "").split("\n").find((l) => /terkirim/.test(l));
  if (sent) console.log(`  ${sent.trim()}`);
}

await page.goto(`${BASE}/token/${SYMBOL}?chain=${market.chainId}&tf=${TF}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("canvas", { timeout: 60000 });
await beat(page, 4600);
await safely("tutup di trade feed", async () => {
  await glideTo(page, "TRADE FEED");
  await beat(page, 5200);
});

// ── Verifikasi, dari chain dan bukan dari rekaman ───────────────────────────
const swapsAfter = await curve.swapCount();
console.log(`\nswapCount : ${swapsBefore} -> ${swapsAfter}`);
console.log(`page errors: ${pageErrors.length}`);
if (pageErrors.length) pageErrors.slice(0, 3).forEach((e) => console.log(`  ! ${e.slice(0, 150)}`));

const video = page.video();
await ctx.close();
await browser.close();
const rawPath = video ? await video.path() : null;
if (!rawPath || !fs.existsSync(rawPath)) {
  console.error("video mentah tidak ditemukan");
  process.exit(1);
}
console.log("\nmeng-encode MP4 & WebM…");
execSync(
  `ffmpeg -y -loglevel error -i "${rawPath}" -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -r 30 -movflags +faststart "${OUT_MP4}"`
);
execSync(`ffmpeg -y -loglevel error -i "${rawPath}" -c:v libvpx-vp9 -b:v 2M -r 30 "${OUT_WEBM}"`);
const dur = execSync(
  `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${OUT_MP4}"`
)
  .toString()
  .trim();
console.log(`selesai: ${OUT_MP4} (${Number(dur).toFixed(0)}s) + ${OUT_WEBM}`);
