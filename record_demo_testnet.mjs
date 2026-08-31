/**
 * Merekam demo UI ujung-ke-ujung di TESTNET dengan transaksi sungguhan.
 *
 * Alur: studio (buat token) -> explorer -> terminal token (chart + order book)
 *       -> beli -> DEX /swap -> jual. Semua on-chain, bukan mock UI.
 *
 * Dua hal yang salah pada rekaman lama dan diperbaiki di sini:
 *   1. Wallet tidak pernah tersambung, sehingga seluruh UI tertutup gate
 *      "Connect wallet" dan tidak ada satu pun aksi yang bisa dijalankan.
 *      Di sini `window.ethereum` disuntik sebelum navigasi pertama, memakai
 *      shim yang sama dengan skrip audit: pembacaan diteruskan ke RPC nyata dan
 *      transaksi ditandatangani kunci sungguhan.
 *   2. Tidak ada overlay/banner yang digambar di atas UI. Yang terekam adalah
 *      antarmuka apa adanya.
 *
 * Pakai:
 *   source scripts/testnet-multichain-env.sh && npx next start -p 3100
 *   unset OG_PRIVATE_KEY PRIVATE_KEY && node record_demo_testnet.mjs
 */
// CATATAN NAVIGASI: berkas ini memakai `waitUntil: "domcontentloaded"`, BUKAN
// "networkidle". Halaman token menjalankan polling (trade feed 10s, order book
// 15s), jadi jaringannya tidak pernah benar-benar "idle" dan `networkidle` bisa
// timeout 30s lalu MELEMPAR. Sebuah goto yang tidak dibungkus safely() (scene
// penutup) karena itu meng-crash perekam SEBELUM video di-encode — satu putaran
// penuh transaksi nyata terbuang tanpa menghasilkan berkas. Tiap goto sudah
// diikuti beat() yang memberi waktu render, jadi domcontentloaded sudah cukup.
import { chromium } from "playwright";
import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

dotenv.config({ path: ".env.local", quiet: true });

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const PK = process.env.OG_PRIVATE_KEY || process.env.PRIVATE_KEY;
if (!PK) {
  console.error("Butuh OG_PRIVATE_KEY / PRIVATE_KEY di .env.local");
  process.exit(1);
}

/** Chain demo. 0G Testnet: saldo lega, dan ini chain utama proyek. */
const CHAIN = {
  chainId: 16602,
  key: "0G",
  name: "0G Testnet",
  rpc: "https://evmrpc-testnet.0g.ai",
  sym: "0G",
};
/**
 * Tidak ada lagi DEMO_SEED. AdextoCurveFactory memakai bonding curve dengan reserve
 * virtual, jadi tidak ada setoran likuiditas — dan field seed-nya sudah tidak ada
 * di studio, sehingga mengisinya akan membuat perekaman macet.
 */
const BUY = process.env.DEMO_BUY || "0.01";
const RUN = Math.floor(Math.random() * 900 + 100);
const TICKER = process.env.DEMO_TICKER || `NOVA${RUN}`;
const NAME = process.env.DEMO_NAME || "Nova Sentinel AI";

const W = 1920;
const H = 1080;
const RAW_DIR = path.join(process.cwd(), "public", "demo-raw");
const OUT_MP4 = path.join(process.cwd(), "public", "adexto_testnet_demo.mp4");
const OUT_WEBM = path.join(process.cwd(), "public", "adexto_testnet_demo.webm");

const req = new ethers.FetchRequest(CHAIN.rpc);
req.timeout = 60000;
const provider = new ethers.JsonRpcProvider(req, CHAIN.chainId, { staticNetwork: true });
const wallet = new ethers.Wallet(PK, provider);
const ACCOUNT = wallet.address;

const ERC20 = ["function balanceOf(address) view returns (uint256)"];
const POOL = [
  "function getReserves() view returns (uint256,uint256)",
  "function buy(uint256,address,uint256) payable returns (uint256)",
  // Khas kurva v3: dipakai untuk membuktikan penghasilan creator terakumulasi
  // dari fee, bukan dari alokasi token.
  "function creatorOwed() view returns (uint256)",
  "function realNative() view returns (uint256)",
  "function virtualNative() view returns (uint256)",
];

const SHIM = `
window.ethereum = {
  isMetaMask: true,
  _cbs: {},
  on(ev, cb) { (this._cbs[ev] = this._cbs[ev] || []).push(cb); },
  removeListener() {},
  async request({ method, params }) {
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [window.__ACCOUNT__];
    return await window.__rpc(method, params || []);
  },
};
`;

const scene = (s) => console.log(`\n=== ${s}`);
/** PACE<1 mempercepat jeda. Dipakai supaya durasi bisa disetel tanpa mengubah alur. */
const PACE = Number(process.env.DEMO_PACE || 0.62);
const beat = (page, ms = 900) => page.waitForTimeout(Math.max(180, Math.round(ms * PACE)));
const fmt = (v) => Number(ethers.formatUnits(v, 18)).toLocaleString("id-ID", { maximumFractionDigits: 2 });

/** Mengetik seperti manusia supaya video tidak terasa seperti tempelan. */
async function typeInto(page, locator, text) {
  await locator.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(text, { delay: 55 });
}

/** Menggulir halus; gulir instan membuat video tersentak. */
async function glide(page, y, steps = 18) {
  for (let i = 0; i < steps; i++) {
    await page.evaluate((d) => window.scrollBy(0, d), y / steps);
    await page.waitForTimeout(28);
  }
}

/**
 * Menggulir PANEL DALAM, bukan jendela.
 *
 * Kolom form di /studio memakai `lg:overflow-y-auto`, jadi ia punya area gulir
 * sendiri. `window.scrollBy` tidak menyentuhnya sama sekali — itu sebabnya bagian
 * bawah form (pool, agent, attestation) tidak pernah terlihat di rekaman lama.
 * Helper ini mencari leluhur yang benar-benar bisa digulir dari elemen yang memuat
 * `anchorText`, lalu menggulir elemen itu.
 */
async function glidePanel(page, anchorText, y, steps = 18) {
  const found = await page.evaluate((text) => {
    // Dicocokkan tanpa peduli huruf besar/kecil. Judul seksi di studio ditulis
    // "2. Bonding curve" dan hanya ditampilkan huruf besar lewat CSS `uppercase`,
    // sementara `textContent` tetap huruf aslinya. Jangkar yang case-sensitive
    // karena itu tidak pernah cocok, dan glidePanel diam-diam jatuh ke gulir
    // jendela — yang tidak menggerakkan kolom form sama sekali.
    const needle = text.toLowerCase();
    const el = [...document.querySelectorAll("*")].find(
      (e) => e.children.length < 40 && (e.textContent || "").toLowerCase().includes(needle)
    );
    let n = el;
    while (n && n !== document.body) {
      const s = getComputedStyle(n);
      if ((s.overflowY === "auto" || s.overflowY === "scroll") && n.scrollHeight > n.clientHeight + 8) {
        n.dataset.adextoScroller = "1";
        return true;
      }
      n = n.parentElement;
    }
    return false;
  }, anchorText);

  if (!found) return glide(page, y, steps);

  for (let i = 0; i < steps; i++) {
    await page.evaluate((d) => {
      const n = document.querySelector('[data-adexto-scroller="1"]');
      if (n) n.scrollTop += d;
    }, y / steps);
    await page.waitForTimeout(28);
  }
  await page.evaluate(() => {
    const n = document.querySelector('[data-adexto-scroller="1"]');
    if (n) delete n.dataset.adextoScroller;
  });
}

if (fs.existsSync(RAW_DIR)) fs.rmSync(RAW_DIR, { recursive: true, force: true });
fs.mkdirSync(RAW_DIR, { recursive: true });

console.log(`chain   : ${CHAIN.name} (${CHAIN.chainId})`);
console.log(`akun    : ${ACCOUNT}`);
console.log(`saldo   : ${ethers.formatEther(await provider.getBalance(ACCOUNT))} ${CHAIN.sym}`);
console.log(`token   : $${TICKER} — ${NAME}   beli=${BUY}  (tanpa setoran likuiditas)`);

const browser = await chromium.launch({
  args: ["--hide-scrollbars", "--disable-features=IsolateOrigins,site-per-process"],
});
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: RAW_DIR, size: { width: W, height: H } },
  deviceScaleFactor: 1,
  colorScheme: "dark",
});
const page = await ctx.newPage();

let queue = Promise.resolve();
const serial = (fn) => ((queue = queue.then(fn, fn)), queue);

// Wallet nyata: baca diteruskan ke RPC, tanda tangan & kirim pakai kunci asli.
await page.exposeFunction("__rpc", async (method, params) => {
  try {
    if (method === "eth_chainId") return "0x" + CHAIN.chainId.toString(16);
    if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
    if (method === "personal_sign") return await wallet.signMessage(ethers.getBytes(params[0]));
    if (method === "eth_sign") return await wallet.signMessage(ethers.getBytes(params[1]));
    if (method === "eth_sendTransaction") {
      return await serial(async () => {
        const p = params[0] || {};
        const tx = await wallet.sendTransaction({
          to: p.to ?? undefined,
          data: p.data ?? undefined,
          value: p.value ? BigInt(p.value) : 0n,
          ...(p.gas ? { gasLimit: BigInt(p.gas) } : {}),
        });
        return tx.hash;
      });
    }
    return await provider.send(method, params);
  } catch (e) {
    throw new Error(e?.shortMessage || e?.info?.error?.message || e?.message || "rpc error");
  }
});
await page.addInitScript(`window.__ACCOUNT__ = "${ACCOUNT}";`);
await ctx.addInitScript(SHIM);

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

// ── 1. STUDIO: wallet tersambung dulu, baru buat token ──────────────────────
scene("1) STUDIO — sambungkan wallet lalu buat token");
await page.goto(`${BASE}/studio`, { waitUntil: "domcontentloaded" });
await beat(page, 1800);

const connect = page.locator('button:has-text("Connect wallet")').first();
if ((await connect.count()) > 0) {
  await connect.hover();
  await beat(page, 500);
  await connect.click();
  await beat(page, 1600);
}
const connected = (await page.locator(`text=/${ACCOUNT.slice(0, 6)}/i`).count()) > 0;
console.log(`  wallet tersambung di UI: ${connected ? "YA" : "TIDAK"}`);
if (!connected) {
  console.error("  wallet tidak tersambung — rekaman dibatalkan agar tidak menghasilkan video cacat");
  await ctx.close();
  await browser.close();
  process.exit(1);
}
await beat(page, 1200);

await typeInto(page, page.locator('input[value="AQUANT"]').first(), TICKER);
await beat(page, 600);
await typeInto(page, page.locator('input[value="Aegis Quant AI"]').first(), NAME);
await beat(page, 1500);

// Tunjukkan dulu bahwa satu klik bisa menargetkan SEMUA chain: centang keempatnya
// dan biarkan label tombol berubah. Baru setelah itu dipersempit ke satu chain
// untuk peluncuran nyata, supaya dana testnet tidak terpakai di empat tempat.
const ALL_CHAINS = ["0G Testnet", "Arbitrum Sepolia", "Base Sepolia", "Monad Testnet"];

// Deteksi state terpilih dari class tombolnya SENDIRI.
//
// Perekaman sebelumnya memeriksa `class.includes("cyan-950")`, dan itu tidak
// pernah cocok lagi: palet studio berpindah ke `accent`, jadi tombol terpilih
// kini ber-class `bg-accent-soft border-accent/30 text-accent`. Akibatnya loop
// "persempit ke satu" tidak pernah men-deselect apa pun, launch menargetkan
// "0G + Monad", dan hasil "1 of 2" menggagalkan cek "1 of 1". `text-accent`
// menempel di elemen tombol itu sendiri (bukan cuma anak-anaknya), jadi ia
// sinyal terpilih yang andal.
const isSelected = async (btn) => ((await btn.getAttribute("class")) ?? "").includes("text-accent");

scene("1a) Pilih target chain — semua dulu, lalu dipersempit ke satu");
for (const name of ALL_CHAINS) {
  const btn = page.locator(`button[title*="${name}"]`).first();
  if ((await btn.count()) === 0) continue;
  if (await btn.isDisabled().catch(() => false)) continue;
  if (!(await isSelected(btn))) {
    await btn.hover();
    await page.waitForTimeout(180);
    await btn.click();
    await page.waitForTimeout(320);
  }
}
await beat(page, 1600);
const allLabel = ((await page.locator('button:has-text("Launch on")').first().textContent().catch(() => "")) ?? "")
  .replace(/\s+/g, " ")
  .trim();
console.log(`  semua chain dicentang -> tombol: ${allLabel || "(belum aktif)"}`);
await beat(page, 1400);

// Persempit ke satu chain: deselect semua kecuali CHAIN.name.
for (const name of ALL_CHAINS.filter((n) => n !== CHAIN.name)) {
  const btn = page.locator(`button[title*="${name}"]`).first();
  if ((await btn.count()) === 0) continue;
  if (await btn.isDisabled().catch(() => false)) continue;
  if (await isSelected(btn)) {
    await btn.click();
    await page.waitForTimeout(280);
  }
}
const chainBtn = page.locator(`button[title*="${CHAIN.name}"]`).first();
if (!(await isSelected(chainBtn))) {
  await chainBtn.click();
  await page.waitForTimeout(280);
}
await beat(page, 1400);

// Konfirmasi keras: label tombol launch HARUS tepat satu chain sebelum lanjut.
// Kalau tidak, video akan meluncurkan ke chain yang salah — lebih baik gagal di
// sini daripada menghasilkan rekaman "1 of 2" yang harus dibuang di akhir.
const narrowLabel = ((await page.locator('button:has-text("Launch on")').first().textContent().catch(() => "")) ?? "")
  .replace(/\s+/g, " ")
  .trim();
console.log(`  dipersempit -> tombol: ${narrowLabel || "(belum aktif)"}`);
if (narrowLabel && /\+/.test(narrowLabel)) {
  console.error(`  masih lebih dari satu chain terpilih (${narrowLabel}) — rekaman dibatalkan`);
  await ctx.close();
  await browser.close();
  process.exit(1);
}

// Tidak ada field seed untuk diisi. Cukup tahan sebentar supaya penonton melihat
// panel "No liquidity deposit" dan alokasi token creator yang nol.
await beat(page, 2400);

// Chat dengan 0G TEE co-pilot di studio, sebelum token dibuat.
scene("1b) Chat dengan 0G TEE co-pilot di studio");
await safely("chat co-pilot studio", async () => {
  const box = page.getByPlaceholder("Ask the 0G co-pilot…");
  await box.waitFor({ state: "visible", timeout: 20000 });
  await box.click();
  await page.keyboard.type(
    `Review the tokenomics for $${TICKER}: 1B supply, 100% into a virtual bonding curve, no liquidity deposit, creator paid 0.10% of every swap instead of a token allocation. Is that sound?`,
    { delay: 22 }
  );
  await beat(page, 700);
  // Hitung balasan yang sudah ada dulu; menunggu angka tetap akan rapuh kalau
  // panel sudah berisi sapaan pembuka.
  const before = await page.evaluate(
    () => (document.body.innerText.match(/0G TEE \(GLM-5\.2\)/gi) || []).length
  );
  await page.keyboard.press("Enter");
  // Balasan mengalir (streaming), jadi tunggu jumlahnya BERTAMBAH, bukan sekadar jeda.
  await page.waitForFunction(
    (n) => (document.body.innerText.match(/0G TEE \(GLM-5\.2\)/gi) || []).length > n,
    before,
    { timeout: 120000 }
  );
  // Panel chat menggulir sendiri ke bawah saat balasan masuk, jadi cukup ditahan
  // supaya jawabannya terbaca; menggulirnya manual justru berkelahi dengan autoscroll.
  await beat(page, 5200);
});

// Turuni SELURUH form: pool, penjelasan biaya per chain, mandate agent, sampai
// attestation. Kolom ini punya area gulir sendiri, jadi harus glidePanel.
// Jangkar diganti ke judul seksi kurva: "SOVEREIGN HOOK POOL" sudah tidak ada
// di studio, dan jangkar yang tidak ditemukan membuat glidePanel jatuh ke gulir
// jendela — yang tidak menggerakkan kolom form sama sekali.
scene("1c) Menelusuri form: kurva, biaya per chain, agent, attestation");
await glidePanel(page, "BONDING CURVE", 300);
await beat(page, 2600);
await glidePanel(page, "BONDING CURVE", 320);
await beat(page, 2800);
await glidePanel(page, "BONDING CURVE", 300);
await beat(page, 2400);
await glidePanel(page, "BONDING CURVE", -700);
await beat(page, 900);

scene("2) Attestation lalu launch (transaksi 0G Testnet nyata)");
const signBtn = page.getByRole("button", { name: "Sign attestation", exact: true });
await signBtn.hover();
await beat(page, 400);
await signBtn.click();
await page.waitForSelector("text=SIGNED", { timeout: 60000 });
await beat(page, 1400);

const launchBtn = page.locator('button:has-text("Launch on")').first();
console.log(`  tombol: ${((await launchBtn.textContent()) ?? "").replace(/\s+/g, " ").trim()}`);
await launchBtn.hover();
await beat(page, 600);
await launchBtn.click();
await page.waitForSelector("text=/live on \\d+ of \\d+|Launch failed/", { timeout: 300000 });
await beat(page, 2600);
const headline = ((await page.locator("text=/live on \\d+ of \\d+/").first().textContent()) ?? "").trim();
console.log(`  hasil : ${headline}`);
if (!/live on 1 of 1/.test(headline)) {
  console.error("  launch tidak sukses — rekaman dibatalkan");
  await ctx.close();
  await browser.close();
  process.exit(1);
}
await glidePanel(page, "live on 1 of 1", 300);
await beat(page, 2600);

// Ambil alamat dari registry untuk dipakai di adegan berikutnya.
const rec = await page.evaluate(async (sym) => {
  const r = await fetch("/api/graphql", { method: "POST" });
  const j = await r.json();
  return j.data.projects.find((p) => p.symbol === sym);
}, TICKER);
console.log(`  token : ${rec.tokenAddress}`);
console.log(`  pool  : ${rec.poolAddress}`);

const erc20 = new ethers.Contract(rec.tokenAddress, ERC20, provider);
const pool = new ethers.Contract(rec.poolAddress, POOL, provider);
/** Nama yang jujur untuk venue v3; `pool` dipertahankan agar adegan lama tetap jalan. */
const curve = pool;

/**
 * Window anti-sniper dijalankan di LATAR. Kalau ditunggu diam di satu halaman,
 * video berisi puluhan detik gambar statis. Jadi penantiannya ditumpuk dengan
 * adegan explorer & terminal yang memang perlu direkam.
 */
const buyWei = ethers.parseEther(BUY);
const windowOpen = (async () => {
  const until = Date.now() + 300000;
  while (Date.now() < until) {
    try {
      await pool.buy.staticCall(0, ACCOUNT, 0, { value: buyWei, from: ACCOUNT });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  return false;
})();

// ── 3. EXPLORER ─────────────────────────────────────────────────────────────
scene("3) EXPLORER — token baru tampil terdaftar");
await page.goto(`${BASE}/explorer`, { waitUntil: "domcontentloaded" });
await beat(page, 2200);
const card = page.locator(`text=/\\$${TICKER}/`).first();
if ((await card.count()) > 0) {
  await card.scrollIntoViewIfNeeded();
  await beat(page, 700);
  await card.hover();
  await beat(page, 2000);
}
await glide(page, 260);
await beat(page, 1800);

// ── 4. TERMINAL TOKEN: chart + order book ───────────────────────────────────
scene("4) TERMINAL — chart & order book dari reserve on-chain");
await page.goto(`${BASE}/token/${TICKER.toLowerCase()}?chain=${CHAIN.chainId}`, { waitUntil: "domcontentloaded" });
await beat(page, 3200);
await glide(page, 420);
await beat(page, 2600);
await glide(page, 380);
await beat(page, 2400);
await glide(page, -800);
await beat(page, 1200);

scene("5) Window anti-sniper (ditunggu di latar selama adegan di atas)");
const allowed = await windowOpen;
console.log(`  window selesai: ${allowed ? "YA" : "TIDAK (lanjut saja)"}`);

/**
 * Langkah trading dijalankan tahan-gagal: kalau satu langkah bermasalah, video
 * tetap diproduksi supaya bisa diperiksa, bukan hilang bersama exception.
 */
async function safely(label, fn) {
  try {
    await fn();
    return true;
  } catch (e) {
    console.log(`  ! ${label} gagal: ${(e.message || String(e)).split("\n")[0].slice(0, 160)}`);
    return false;
  }
}

// ── 6. BELI dari terminal ───────────────────────────────────────────────────
scene("6) BELI dari terminal token");
await page.reload({ waitUntil: "domcontentloaded" });
await beat(page, 2600);
const balBefore = await erc20.balanceOf(ACCOUNT);
const amountInput = page.locator('input[type="number"]').first();
await amountInput.click();
await page.keyboard.type(BUY, { delay: 90 });
await beat(page, 2400);
await safely("beli di terminal", async () => {
  const buyBtn = page.locator("button", { hasText: new RegExp(`^Buy \\$${TICKER}$`) }).first();
  await buyBtn.waitFor({ state: "visible", timeout: 30000 });
  if (await buyBtn.isDisabled()) throw new Error("tombol Buy tidak aktif");
  await buyBtn.hover();
  await beat(page, 500);
  await buyBtn.click();
  // Terminal token memakai statusLine "Received …" dari use-sovereign-swap.
  // "Swap settled" hanya ada di SwapTerminal (/swap), bukan di sini.
  await page.waitForSelector("text=/Received |would fail on-chain|Rejected|Insufficient/", { timeout: 300000 });
  await beat(page, 2800);
});
const balAfterBuy = await erc20.balanceOf(ACCOUNT);
console.log(`  saldo token: +${fmt(balAfterBuy - balBefore)} ${TICKER}`);

// Chart setelah ada fill.
await glide(page, 400);
await beat(page, 3000);
await glide(page, -400);
await beat(page, 1000);

// ── 7. DEX /swap ────────────────────────────────────────────────────────────
scene("7) DEX /swap — market terpilih & beli lagi");
await page.goto(`${BASE}/swap?token=${TICKER}&chain=${CHAIN.chainId}`, { waitUntil: "domcontentloaded" });
await beat(page, 3000);
const swapAmount = page.locator('input[type="number"]').first();
await swapAmount.click();
await page.keyboard.type(BUY, { delay: 90 });
await beat(page, 2400);
await safely("beli di /swap", async () => {
  const swapBuy = page.locator("button", { hasText: new RegExp(`^Buy \\$${TICKER}$`) }).first();
  await swapBuy.waitFor({ state: "visible", timeout: 30000 });
  if (await swapBuy.isDisabled()) throw new Error("tombol Buy tidak aktif");
  await swapBuy.hover();
  await beat(page, 500);
  await swapBuy.click();
  await page.waitForSelector("text=/Swap settled|would fail on-chain|Rejected|Insufficient/", { timeout: 300000 });
  await beat(page, 3000);
});
const balAfterSwap = await erc20.balanceOf(ACCOUNT);
console.log(`  saldo token: ${fmt(balAfterSwap)} ${TICKER}`);

// ── 8. JUAL dari terminal ───────────────────────────────────────────────────
scene("8) JUAL dari terminal (approve + sell)");
await page.goto(`${BASE}/token/${TICKER.toLowerCase()}?chain=${CHAIN.chainId}`, { waitUntil: "domcontentloaded" });
await beat(page, 2800);
await page.locator('button:has-text("SELL")').first().click();
await beat(page, 1400);
const sellAmount = balAfterSwap / 3n;
await page.locator('input[type="number"]').first().fill(ethers.formatUnits(sellAmount, 18));
await beat(page, 2400);
await safely("jual di terminal", async () => {
  const sellBtn = page.locator("button", { hasText: new RegExp(`^Approve & sell \\$${TICKER}$`) }).first();
  await sellBtn.waitFor({ state: "visible", timeout: 30000 });
  if (await sellBtn.isDisabled()) throw new Error("tombol jual tidak aktif");
  await sellBtn.hover();
  await beat(page, 500);
  await sellBtn.click();
  await page.waitForSelector("text=/Received |would fail on-chain|Rejected|Insufficient/", { timeout: 300000 });
  await beat(page, 3000);
});
const balAfterSell = await erc20.balanceOf(ACCOUNT);
console.log(`  saldo token setelah jual: ${fmt(balAfterSell)} ${TICKER}`);

// ── 8a. Penghasilan creator ────────────────────────────────────────────────
// Inti model v3: creator tidak menerima satu token pun, penghasilannya datang
// dari irisan fee tiap swap. Setelah beberapa perdagangan di atas, ada yang bisa
// diklaim — jadi ini adegan yang paling penting ditunjukkan.
scene("8a) PENGHASILAN CREATOR — akumulasi dari fee, lalu diklaim");
await safely("klaim penghasilan creator", async () => {
  const owedBefore = await curve.creatorOwed();
  console.log(`  terakumulasi: ${ethers.formatEther(owedBefore)} ${CHAIN.sym}`);
  if (owedBefore === 0n) throw new Error("belum ada fee terakumulasi");

  const panel = page.locator("text=Your creator revenue").first();
  await panel.waitFor({ state: "visible", timeout: 20000 });
  await panel.scrollIntoViewIfNeeded();
  await beat(page, 2600);

  const claimBtn = page.locator('button:has-text("Claim")').first();
  await claimBtn.hover();
  await beat(page, 700);
  await claimBtn.click();
  await beat(page, 6000);
  console.log(`  setelah klaim : ${ethers.formatEther(await curve.creatorOwed())} ${CHAIN.sym}`);
  await beat(page, 2400);
});

// Beberapa fill tambahan supaya chart dan trade feed tidak terlihat kosong.
// Ini transaksi nyata lewat UI yang sama, bukan data tempelan.
scene("8b) Beberapa fill tambahan agar chart terisi");
for (const [i, amt] of ["0.004", "0.007"].entries()) {
  await safely(`fill tambahan ${i + 1}`, async () => {
    await page.goto(`${BASE}/token/${TICKER.toLowerCase()}?chain=${CHAIN.chainId}`, { waitUntil: "domcontentloaded" });
    await beat(page, 1800);
    const input = page.locator('input[type="number"]').first();
    await input.click();
    await page.keyboard.type(amt, { delay: 70 });
    await beat(page, 1500);
    const b = page.locator("button", { hasText: new RegExp(`^Buy \\$${TICKER}$`) }).first();
    await b.waitFor({ state: "visible", timeout: 20000 });
    if (await b.isDisabled()) throw new Error("tombol Buy tidak aktif");
    await b.click();
    await page.waitForSelector("text=/Received |would fail on-chain|Rejected|Insufficient/", { timeout: 240000 });
    await beat(page, 1600);
  });
}

// ── 9. Chart penutup, lalu chat agent sebagai finale ───────────────────────
// Urutannya penting: dulu chat direkam SEBELUM adegan penutup yang me-reload
// halaman, sehingga jawaban agent terhapus dan hanya tampil sekejap. Sekarang satu
// kali muat dipakai untuk chart, lalu turun ke panel chat dan berhenti di jawaban.
scene("9) Chart penutup dengan fill nyata");
await page.goto(`${BASE}/token/${TICKER.toLowerCase()}?chain=${CHAIN.chainId}`, { waitUntil: "domcontentloaded" });
await beat(page, 3000);
await page.evaluate(() => {
  const feed = [...document.querySelectorAll("*")].find(
    (el) => /TRADE FEED/i.test(el.textContent || "") && el.children.length < 12
  );
  (feed ?? document.body).scrollIntoView({ block: "center", behavior: "smooth" });
});
await beat(page, 3800);

scene("10) FINALE — chat dengan agent token yang membaca state on-chain");
await safely("chat agent token", async () => {
  const box = page.getByPlaceholder(`Ask ${TICKER} agent…`);
  await box.waitFor({ state: "visible", timeout: 20000 });
  await box.scrollIntoViewIfNeeded();
  await beat(page, 600);
  await box.click();
  // Pertanyaan yang jawabannya wajar pendek; pertanyaan bergaya "hitung ini"
  // memancing model menuliskan aritmetika panjang di layar.
  await page.keyboard.type("Summarise this pool: depth, current price, and the round-trip cost of a small buy.", {
    delay: 22,
  });
  await beat(page, 700);
  const before = await page.evaluate(
    () => (document.body.innerText.match(/\(0G TEE\)/gi) || []).length
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (n) => (document.body.innerText.match(/\(0G TEE\)/gi) || []).length > n,
    before,
    { timeout: 120000 }
  );
  // Balasan mengalir token demi token. Menunggu token PERTAMA saja membuat video
  // berakhir di tengah kalimat, jadi tunggu sampai panjang teks berhenti bertambah
  // (indikator "Reasoning on 0G…" juga harus sudah hilang).
  let stable = 0;
  let last = -1;
  for (let i = 0; i < 90; i++) {
    const state = await page.evaluate(() => ({
      len: document.body.innerText.length,
      busy: /Reasoning on 0G/i.test(document.body.innerText),
    }));
    if (state.len === last && !state.busy) {
      if (++stable >= 3) break;
    } else {
      stable = 0;
    }
    last = state.len;
    await page.waitForTimeout(1000);
  }
  // Tahan: ini bidikan penutup, jawabannya harus terbaca.
  await beat(page, 6500);
});

const [nat, tok] = await pool.getReserves();
console.log(`\nreserve akhir: ${ethers.formatEther(nat)} ${CHAIN.sym} / ${fmt(tok)} ${TICKER}`);
console.log(`page errors  : ${pageErrors.length}`);
if (pageErrors.length) pageErrors.slice(0, 3).forEach((e) => console.log(`  ! ${e.slice(0, 160)}`));

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
fs.rmSync(RAW_DIR, { recursive: true, force: true });

const dur = execSync(
  `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${OUT_MP4}"`
).toString().trim();
console.log(`selesai: ${OUT_MP4} (${Number(dur).toFixed(1)}s, ${W}x${H})`);
console.log(`         ${OUT_WEBM}`);
console.log(`token demo: $${TICKER} di ${CHAIN.name} — ${rec.tokenAddress}`);
