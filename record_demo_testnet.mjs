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

/**
 * Chain demo, sekarang bisa dipilih: testnet atau MAINNET.
 *
 * `DEMO_NET=mainnet` mengarahkan perekam ke 0G mainnet. Nama berkas ini tetap
 * `record_demo_testnet.mjs` supaya runbook dan riwayat commit tidak berpisah dari
 * berkasnya, tapi isinya tidak lagi khusus testnet.
 *
 * YANG BERBEDA DI MAINNET, DAN HARUS DISADARI SEBELUM DIJALANKAN:
 *   - Token dan kurvanya PERMANEN. Ticker-nya terklaim di `symbolRegistry` tanpa
 *     setter dan tanpa owner, jadi tidak ada cara mencabutnya.
 *   - `totalProjectsCount()` naik permanen, dan itu membuat kalimat "belum ada
 *     peluncuran" di delapan halaman langsung salah. Siapkan teks penggantinya
 *     SEBELUM menjalankan ini.
 *   - Nominal beli/jual adalah uang sungguhan. Bawaan DEMO_BUY diperkecil di mainnet.
 */
/**
 * PILIHAN CHAIN DIPISAH DARI TINGKAT JARINGAN, dan pemisahan itu memperbaiki bug laten.
 *
 * Sebelumnya satu variabel `DEMO_NET` menjawab DUA pertanyaan berbeda: chain mana, dan
 * apakah ini mainnet. Selama hanya ada 0G, keduanya kebetulan sejalan. Menambahkan Monad
 * sebagai kunci ketiga akan membuat `IS_MAINNET` bernilai false untuk chain yang jelas
 * mainnet, dan empat hal rusak DIAM-DIAM:
 *
 *   - `BUY` memakai nominal testnet, yaitu uang sungguhan 2,5x lebih besar
 *   - `OUT_BASE` jadi "adexto_testnet_demo" dan MENIMPA rekaman testnet yang sudah bagus
 *   - `ALL_CHAINS` memakai nama-nama testnet, jadi tombol chain di studio tidak cocok
 *     dan perekaman DIBATALKAN di pemeriksaan target
 *   - peringatan permanensi ticker tidak tercetak, di chain yang klaimnya juga permanen
 *
 * Jadi `mainnet` sekarang PROPERTI CHAIN, bukan kesimpulan dari nama kunci.
 */
const CHAIN_KEY = (process.env.DEMO_CHAIN || process.env.DEMO_NET || "testnet").toLowerCase();
const CHAINS = {
  testnet: {
    chainId: 16602,
    key: "0G",
    name: "0G Testnet",
    rpc: "https://evmrpc-testnet.0g.ai",
    explorer: "https://chainscan-galileo.0g.ai",
    sym: "0G",
    mainnet: false,
    out: "adexto_testnet_demo",
    /**
     * Nominal beli bawaan, disetarakan dalam DOLAR antar chain.
     *
     * Menyalin angka native dari satu chain ke chain lain akan mengubah ukuran
     * perdagangan sebesar rasio harganya. 0G ~$0,19 dan MON ~$0,023, jadi "0.004" yang
     * berarti $0,0008 di 0G akan berarti $0,0001 di Monad — dan sebaliknya angka Monad
     * di 0G akan delapan kali lebih besar dari yang dimaksud.
     */
    buy: "0.01",
  },
  "0g": {
    chainId: 16661,
    key: "0G",
    name: "0G Mainnet",
    rpc: process.env.OG_RPC_URL || "https://evmrpc.0g.ai",
    explorer: "https://chainscan.0g.ai",
    sym: "0G",
    mainnet: true,
    out: "adexto_mainnet_demo",
    buy: "0.004",
  },
  monad: {
    chainId: 143,
    key: "Monad",
    name: "Monad Mainnet",
    rpc: process.env.MONAD_RPC_URL || "https://rpc.monad.xyz",
    explorer: "https://monadscan.com",
    sym: "MON",
    mainnet: true,
    // Nama keluaran sendiri: rekaman Monad tidak boleh menimpa rekaman 0G.
    out: "adexto_monad_demo",
    // 0,035 MON ~= $0,0008 pada MON $0,023, yaitu setara dolar dengan 0,004 0G.
    buy: "0.035",
  },
};
// `mainnet` dipertahankan sebagai alias ke 0G supaya perintah lama di runbook tetap jalan.
CHAINS.mainnet = CHAINS["0g"];

const CHAIN = CHAINS[CHAIN_KEY];
if (!CHAIN) {
  console.error(
    `DEMO_CHAIN tidak dikenal: "${CHAIN_KEY}". Pilihan: ${Object.keys(CHAINS).join(", ")}`
  );
  process.exit(1);
}
const IS_MAINNET = CHAIN.mainnet;
/**
 * Tidak ada lagi DEMO_SEED. AdextoCurveFactory memakai bonding curve dengan reserve
 * virtual, jadi tidak ada setoran likuiditas — dan field seed-nya sudah tidak ada
 * di studio, sehingga mengisinya akan membuat perekaman macet.
 */
// Bawaan diambil dari entri chain, yang menyetarakannya dalam dolar. Ditulis di satu
// tempat bersama chain-nya, bukan sebagai ternary yang harus ikut tumbuh tiap chain baru.
const BUY = process.env.DEMO_BUY || CHAIN.buy;
const RUN = Math.floor(Math.random() * 900 + 100);
const TICKER = process.env.DEMO_TICKER || `NOVA${RUN}`;
const NAME = process.env.DEMO_NAME || "Nova Sentinel AI";

/**
 * Ticker protokol TIDAK BOLEH dipakai perekam.
 *
 * Ticker terklaim permanen di `symbolRegistry` begitu peluncuran berhasil. Kalau
 * perekaman demonstrasi mengambil ADEXTO atau ADX, token protokolnya sendiri kehilangan
 * namanya selamanya — kesalahan yang tidak bisa diperbaiki dengan cara apa pun. Jadi
 * dilarang di sini, bukan cuma dihindari lewat kebiasaan.
 */
/**
 * Ticker protokol tetap DIBLOKIR secara bawaan, dan hanya bisa dibuka dengan menyebut
 * tickernya sendiri di `DEMO_ALLOW_PROTOCOL_TICKER`.
 *
 * Blok ini ada karena klaim ticker bersifat PERMANEN: `symbolRegistry` tidak punya fungsi
 * untuk melepas. Dan itu bukan kekhawatiran teoretis — ADEXTO sudah terklaim selamanya di
 * 0G mainnet, sehingga peluncurannya tidak akan pernah bisa direkam lagi di chain itu.
 *
 * Karena itu pintunya tidak dibuka dengan flag umum seperti `=1`, yang mudah tertinggal di
 * shell lalu berlaku untuk ticker apa pun. Nilainya harus SAMA dengan ticker yang dituju,
 * jadi membuka ADX tidak sekaligus membuka ADEXTO.
 */
const PROTOCOL_TICKERS = new Set(["ADEXTO", "ADX"]);
const ALLOWED_PROTOCOL_TICKER = (process.env.DEMO_ALLOW_PROTOCOL_TICKER || "").trim().toUpperCase();
if (PROTOCOL_TICKERS.has(TICKER.toUpperCase()) && ALLOWED_PROTOCOL_TICKER !== TICKER.toUpperCase()) {
  console.error(
    `DEMO_TICKER "${TICKER}" adalah ticker protokol dan klaimnya PERMANEN.\n` +
      `Untuk sengaja meluncurkannya, jalankan dengan DEMO_ALLOW_PROTOCOL_TICKER=${TICKER.toUpperCase()}`
  );
  process.exit(1);
}

const W = 1920;
const H = 1080;
const RAW_DIR = path.join(process.cwd(), "public", "demo-raw");
/**
 * Nama keluaran mengikuti jaringan, supaya rekaman mainnet tidak menimpa rekaman
 * testnet yang sudah bagus. Keduanya sudah ada di .gitignore lewat pola yang sama.
 */
const OUT_BASE = CHAIN.out;
const OUT_MP4 = path.join(process.cwd(), "public", `${OUT_BASE}.mp4`);
const OUT_WEBM = path.join(process.cwd(), "public", `${OUT_BASE}.webm`);

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

/*
 * Dulu di sini ada `awaitChainBucketBoundary`, yang menunggu waktu rantai menyeberang
 * batas bucket 60 detik supaya penjualan tidak menyatu dengan pembelian di sekitarnya.
 * DICABUT: pendekatannya benar tapi mahal — dua penantian menambah sampai dua menit video
 * mati. Penyebabnya diselesaikan di sumbernya dengan memindahkan chart ke interval 15
 * detik (adegan 4), yang membuat perdagangan berjarak 24-26 detik otomatis mendarat di
 * bucket masing-masing.
 */

/**
 * Tombol launch, dicocokkan dari AWAL teksnya.
 *
 * `button:has-text("Launch on")` mencocokkan SUBSTRING dan mengabaikan huruf besar,
 * sementara panel co-pilot memuat chip saran berbunyi "Which chain should I launch on
 * first, and why?" yang lebih dulu dalam urutan DOM selama chat belum dipakai. Jadi
 * `.first()` mengembalikan chip itu, dan penjaga "apakah masih lebih dari satu chain
 * terpilih" di bawah sebenarnya memeriksa teks chat — penjaga yang tidak menjaga apa
 * pun. Terlihat dari log rekaman yang mencetak
 * `tombol: Which chain should I launch on first, and why?`.
 *
 * Teks tombol sesungguhnya "Launch on <chain> · gas only", jadi jangkarnya ^ cukup
 * untuk memisahkannya dari kalimat mana pun yang kebetulan memuat frasa itu.
 */
const launchButton = (page) => page.getByRole("button", { name: /^Launch on\b/i });

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

/**
 * `DEMO_HEADED=1` menjalankan browser yang TERLIHAT.
 *
 * Dulu WAJIB karena gerbang World ID menuntut manusia memindai QR dengan World App.
 * Gerbang itu sudah dicabut, jadi seluruh perekaman kini bisa headless dari awal
 * sampai akhir. Opsinya dipertahankan untuk menonton jalannya saat mendiagnosis
 * adegan yang gagal — bukan lagi sebagai syarat.
 */
const HEADED = process.env.DEMO_HEADED === "1";
const browser = await chromium.launch({
  headless: !HEADED,
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

// ── 0. LANDING: mulai dari tempat pengunjung sungguhan mulai ────────────────
/**
 * Perekaman dulu langsung `goto("/studio")`, dan itu melewatkan hal yang justru paling
 * dibutuhkan penonton: konteks. Pembuka yang bagus menjawab "ini apa" sebelum
 * memperlihatkan "ini caranya".
 *
 * Masuk ke studio lewat MENGKLIK CTA-nya, bukan lewat `goto`, dengan sengaja: itu
 * sekalian membuktikan tautannya benar-benar bekerja. Navigasi yang dipalsukan dengan
 * goto akan tetap terlihat mulus di video walau tombolnya rusak.
 */
scene("0) LANDING — apa itu ADEXTO, sebelum masuk studio");
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await beat(page, 2600);

// Digulir perlahan melewati hero, deret stack, lalu pilar — cukup untuk menangkap
// klaim utamanya, tanpa menggulir sampai footer.
for (const y of [0, 420, 900, 1500]) {
  await page.evaluate((top) => window.scrollTo({ top, behavior: "smooth" }), y);
  await beat(page, 1300);
}
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
await beat(page, 1200);

const openStudio = page.locator('a:has-text("Open Studio")').first();
if ((await openStudio.count()) > 0) {
  await openStudio.hover();
  await beat(page, 600);
  await openStudio.click();
  await page.waitForURL(/\/studio/, { timeout: 30000 }).catch(() => {});
  await beat(page, 1600);
} else {
  console.log("  CTA 'Open Studio' tidak ditemukan — masuk studio lewat URL");
  await page.goto(`${BASE}/studio`, { waitUntil: "domcontentloaded" });
  await beat(page, 1600);
}

// ── 1. STUDIO: wallet tersambung dulu, baru buat token ──────────────────────
scene("1) STUDIO — sambungkan wallet lalu buat token");
if (!/\/studio/.test(page.url())) {
  await page.goto(`${BASE}/studio`, { waitUntil: "domcontentloaded" });
}
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

/**
 * Adegan ini dulu diberi narasi yang salah, dan narasinya penting karena ia yang
 * membentuk apa yang penonton simpulkan.
 *
 * Komentar lamanya berbunyi "centang keempatnya, lalu dipersempit ke satu", seolah
 * studio bisa menargetkan beberapa chain sekaligus. Tidak bisa: `selectChain` di
 * src/app/studio/page.tsx berbunyi `setTargetChainIds([chainId])` — MENGGANTI, bukan
 * menambah. Studio single-select, jadi mengklik empat tombol hanya berpindah-pindah
 * dan berakhir di yang terakhir diklik.
 *
 * Jadi adegannya tetap berguna, tapi maknanya lain: ia memperlihatkan keempat chain
 * memang tersedia sebagai target, lalu berhenti di chain yang akan dipakai. Bukan
 * "satu klik ke empat chain".
 */
/**
 * Chain target diletakkan TERAKHIR, bukan pertama.
 *
 * Urutannya menentukan apa yang penonton ingat: yang terakhir disorot adalah yang
 * dipakai untuk meluncurkan. Karena studio single-select, klik terakhir sekaligus yang
 * menentukan target — jadi urutan ini bukan hiasan, ia juga yang membuat adegan
 * berakhir tepat di chain yang benar tanpa perlu loop pembetulan.
 */
const ALL_CHAINS = (
  IS_MAINNET
    ? ["Arbitrum One", "Base Mainnet", "Monad Mainnet", "0G Mainnet"]
    : ["Arbitrum Sepolia", "Base Sepolia", "Monad Testnet", "0G Testnet"]
)
  .filter((n) => n !== CHAIN.name)
  .concat(CHAIN.name);

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

/**
 * Menunggu chart benar-benar MENAMPILKAN fill, bukan menebak dengan jeda tetap.
 *
 * Kenapa ini ada, dan kenapa hanya pembelian PERTAMA yang dulu bermasalah: telemetri
 * membaca event Swap lewat node RPC yang tertinggal dari blok terbaru. Lag-nya diukur
 * langsung di 0G mainnet dan hasilnya 5.430 ms. Perekam lama melanjutkan sekitar 2,8 detik
 * setelah tombol Buy — jadi kamera sudah pindah sebelum candle-nya ada.
 *
 * Pada pembelian kedua dan seterusnya chart sudah punya candle, sehingga lag yang sama
 * tidak terlihat sebagai apa pun. Pada pembelian pertama ia terlihat sebagai terminal
 * KOSONG tepat sesudah pembelian berhasil — dan itulah yang terekam di video ADX.
 *
 * Baris sumber chart mencetak "N fills", jadi yang ditunggu adalah angka itu mencapai
 * jumlah yang diharapkan. Batas 25 detik: lebih dari itu berarti ada yang salah pada
 * node-nya, dan lebih baik dicatat lalu lanjut daripada menggantung perekaman.
 */
async function awaitChartFill(page, minFills, label) {
  const t0 = Date.now();
  try {
    await page.waitForFunction(
      (n) => {
        const m = document.body.innerText.match(/(\d+)\s+fills?\s+·/);
        return m ? Number(m[1]) >= n : false;
      },
      minFills,
      { timeout: 25000 }
    );
    console.log(`  chart menampilkan ${minFills} fill (${label}) setelah ${Date.now() - t0} ms`);
  } catch {
    const txt = await page.locator("text=/fills? ·/").first().textContent().catch(() => "");
    console.log(`  chart BELUM menampilkan ${minFills} fill (${label}) dalam 25 s — "${(txt ?? "").trim()}"`);
  }
  await beat(page, 1600);
}

/**
 * Emblem token dihasilkan DENGAN DIKLIK di UI, bukan dilewati.
 *
 * Adegan ini memperlihatkan satu-satunya bagian demo yang memanggil model gambar 0G
 * (z-image-turbo lewat /api/generate-logo). Yang penting untuk kejujuran video: route itu
 * bisa jatuh ke emblem SVG yang digambar lokal ketika router tidak mengembalikan gambar,
 * dan UI menyatakan bedanya — "0G z-image-turbo" versus "Placeholder emblem". Perekam
 * membaca label itu dan mencetaknya, jadi kalau yang tampil di video ternyata emblem
 * cadangan, hal itu tercatat di log alih-alih diklaim sebagai keluaran model.
 */
async function generateEmblem(page) {
  scene("1e) Emblem token dari model gambar 0G (z-image-turbo)");
  await safely("generate emblem", async () => {
    const btn = page.locator('button:has-text("Generate")').first();
    await btn.scrollIntoViewIfNeeded();
    await beat(page, 900);
    await btn.hover();
    await beat(page, 500);
    await btn.click();
    // Tombolnya berubah menjadi "Rendering…" selama permintaan berjalan.
    await page.waitForSelector('button:has-text("Rendering")', { timeout: 15000 }).catch(() => {});
    await page.waitForSelector('button:has-text("Generate")', { timeout: 180000 });
    await beat(page, 2200);
    const label = ((await page.locator("text=/0G z-image-turbo|Placeholder emblem/").first().textContent()) ?? "")
      .replace(/\s+/g, " ")
      .trim();
    console.log(`  sumber emblem: ${label || "(label tidak terbaca)"}`);
  });
}

/**
 * Timeframe chart untuk SELURUH rekaman, diteruskan lewat `?tf=` di tiap URL token.
 *
 * Bukan diklik sekali di adegan terminal, dan itu perbedaan yang penting: `interval` di
 * RealtimeCandleChart hanyalah state komponen, jadi setiap `page.goto` me-remount-nya dan
 * mengembalikannya ke 60 detik. Berkas ini menavigasi ke halaman token LIMA kali, jadi satu
 * klik di adegan awal tidak berpengaruh pada adegan jual — justru adegan yang candle
 * merahnya paling ingin diperlihatkan.
 *
 * 15 detik dulu dipilih dari data rekaman pertama. Jarak perdagangannya 0s, 24s, 50s, 76s,
 * 91s; pada 1s/5s/15s ketiganya sama-sama memberi tiap perdagangan bucket sendiri, tetapi
 * bar kosong di antaranya 87 / 14 / 2. Pada 60 detik tiga perdagangan menyatu dan
 * penjualannya tertelan sama sekali. Angka-angka itu masih benar; yang berubah adalah apa
 * yang harus dioptimalkan.
 *
 * Bawaannya sekarang 1, karena lebar candle tidak lagi ikut jumlah bar. Jendela chart
 * dipatok `VISIBLE_SLOTS = 96`, jadi yang menentukan chart terlihat hidup atau kosong bukan
 * lagi lebar barnya melainkan CACAH barnya. Terukur pada $CURB dengan lima fill: 130 bar di
 * 1s, 10 bar di 15s, 4 bar di 60s. Hanya yang pertama mengisi pane; 15 detik menyisakan
 * sekitar 90% pane kosong dan itulah tampilan yang dilaporkan sebagai chart kosong.
 *
 * Bar kosong di antara perdagangan bukan kerugian di sini: ia datar karena harga memang
 * tidak bergerak ketika tidak ada yang trading, dan pada 1 detik arah tiap fill tetap
 * terlihat sebagai candle-nya sendiri — yang justru gagal pada 60 detik.
 */
const DEMO_TF = process.env.DEMO_TF || "1";

/**
 * Menelusuri keempat chain, berakhir di chain target.
 *
 * Loop "persempit ke satu" yang dulu ada di bawah sini DIHAPUS. Ia mencoba men-deselect
 * chain dengan mengkliknya, padahal `selectChain` MENGGANTI isi daftar — jadi mengklik
 * chain yang sedang terpilih tetap membuatnya terpilih. Loop itu hanya berpindah-pindah
 * lalu dibetulkan oleh satu klik terakhir; ia bekerja secara kebetulan, bukan karena
 * benar. Dengan target diletakkan terakhir di ALL_CHAINS, hasilnya sama tanpa loop itu.
 *
 * Jeda per klik disengaja SINGKAT. Klik chain sekarang tidak menyentuh jaringan sama
 * sekali — ketersediaan ticker keempat chain sudah diambil sekali di muka, dan cek agent
 * dijawab dari cache — jadi diukur 0 ms dari 812 ms sebelumnya. Menahan 320 ms di sini
 * hanya akan menciptakan kembali lambat yang baru saja dihapus.
 */
scene("1a) Telusuri keempat chain dengan cepat, berhenti di chain target");
for (const name of ALL_CHAINS) {
  const btn = page.locator(`button[title*="${name}"]`).first();
  if ((await btn.count()) === 0) continue;
  if (await btn.isDisabled().catch(() => false)) continue;
  await btn.hover();
  await page.waitForTimeout(110);
  await btn.click();
  // Cukup untuk mata menangkap perpindahan sorot, tidak lebih.
  await page.waitForTimeout(150);
}
/**
 * TIDAK ADA jeda setelah mendarat di chain target.
 *
 * Dulu di sini ada `beat(1500)` + `beat(1400)`, dan satu `beat(2400)` lagi setelah
 * penjaga di bawah — total 3.286 ms pada PACE bawaan 0,62. Semuanya nongkrong di chain
 * yang baru saja dipilih tanpa apa pun terjadi di layar.
 *
 * Itu salah tempat. Chain target adalah TUJUAN adegan ini, bukan tempat menunggu: begitu
 * sampai, yang berikutnya harus langsung terjadi — chat dengan co-pilot lalu peluncuran.
 * Panel "No liquidity deposit" dan alokasi creator nol yang dulu dijadikan alasan menahan
 * di sini tetap terlihat, karena adegan 1c memang menelusuri form itu satu per satu.
 *
 * Pembacaan label dan penjaga di bawah tidak butuh jeda: keduanya membaca DOM, dan React
 * sudah selesai merender sebelum klik terakhir mengembalikan kendali — klik chain kini
 * nol jaringan, jadi tidak ada apa pun yang masih dalam perjalanan.
 */

/**
 * Konfirmasi keras sebelum uang sungguhan bergerak — dan penjaganya DIGANTI, karena
 * yang lama tidak mungkin berbunyi.
 *
 * Versi lama membaca label tombol launch dan membatalkan kalau memuat "+".
 * Label itu dirender `Launch on {launchTargets[0]?.key} · gas only` — hanya elemen
 * PERTAMA. Jadi ia tidak pernah bisa memuat "+", berapa pun chain yang terpilih, dan
 * penjaga itu sudah mati sejak ditulis. Kelas cacat yang sama dengan penjaga chain di
 * commit sebelumnya: terlihat melindungi, sebenarnya tidak memeriksa apa pun.
 *
 * Sekarang yang dihitung KEADAAN UI-nya: berapa tombol chain yang benar-benar
 * bertanda terpilih. Harus tepat satu, dan harus chain yang dituju. Kalau tidak,
 * rekaman dibatalkan sebelum satu transaksi pun dikirim.
 *
 * Catatan: studio memang single-select, jadi dalam keadaan sehat hitungannya selalu 1.
 * Penjaga ini justru untuk keadaan TIDAK sehat — misalnya kalau model pemilihan itu
 * diubah lagi nanti tanpa ada yang memperbarui perekam ini.
 */
const selectedChains = [];
for (const name of ALL_CHAINS) {
  const btn = page.locator(`button[title*="${name}"]`).first();
  if ((await btn.count()) === 0) continue;
  if (await isSelected(btn)) selectedChains.push(name);
}
// Satu pembacaan label, bukan dua. Sebelumnya ada `allLabel` dan `narrowLabel` yang
// membaca elemen yang sama; keduanya masuk akal saat dipisahkan oleh dua `beat`, tapi
// tanpa jeda di antaranya keduanya menghasilkan string identik.
const narrowLabel = ((await launchButton(page).first().textContent().catch(() => "")) ?? "")
  .replace(/\s+/g, " ")
  .trim();
console.log(`  chain terpilih: ${selectedChains.join(", ") || "(tidak ada)"}`);
console.log(`  tombol        : ${narrowLabel || "(belum aktif)"}`);
if (selectedChains.length !== 1 || selectedChains[0] !== CHAIN.name) {
  console.error(
    `  target salah: terpilih [${selectedChains.join(", ")}], seharusnya tepat "${CHAIN.name}" — rekaman dibatalkan`
  );
  await ctx.close();
  await browser.close();
  process.exit(1);
}
if (IS_MAINNET) {
  console.log(`  MAINNET: transaksi berikutnya PERMANEN. ticker "${TICKER}" akan terklaim selamanya.`);
}

// `beat(2400)` di sini DICABUT bersama dua beat di atas. Alasannya di catatan pada
// adegan 1a: begitu chain target terpilih, yang berikutnya harus langsung terjadi.
// Panel "No liquidity deposit" dan alokasi creator nol tetap tampil di adegan 1c.

/**
 * Memperlihatkan pilihan model 0G: buka, lihat, tutup. Tidak memilih apa pun.
 *
 * KENAPA ADEGAN INI DULU MUSTAHIL
 *
 * Kontrolnya `<select>` native, dan popup select native digambar browser/OS DI LUAR
 * permukaan halaman. Terukur: mengkliknya menambah 0 node DOM (494 -> 494) dan ketiga
 * `<option>`-nya berkotak 0x0 bahkan saat terbuka. Jadi apa pun yang diskrip di sini
 * akan menghasilkan video yang tidak memperlihatkan apa-apa — dan Playwright pun tidak
 * bisa diandalkan membuka popup itu; jalur resminya `selectOption`, yang mengganti nilai
 * tanpa pernah menampilkannya.
 *
 * Karena itu kontrolnya diganti button + listbox yang hidup di DOM (lihat catatan di
 * src/app/studio/page.tsx). Sekarang menunya benar-benar terekam.
 *
 * Ditutup dengan Escape, bukan klik kedua: itu sekalian membuktikan jalur keyboardnya
 * bekerja, yang pada `<select>` native didapat gratis dan pada penggantinya harus
 * dipasang sendiri. Tidak ada model yang dipilih — token tetap memakai bawaan.
 */
scene("1a-2) Pilihan model 0G — dibuka lalu ditutup lagi");
await safely("dropdown model 0G", async () => {
  const modelBtn = page.locator('button[aria-label="0G model"]').first();
  await modelBtn.waitFor({ state: "visible", timeout: 15000 });
  const before = ((await modelBtn.textContent()) ?? "").replace(/\s+/g, " ").trim();

  await modelBtn.hover();
  await page.waitForTimeout(180);
  await modelBtn.click();

  const list = page.locator('[role="listbox"][aria-label="0G model"]').first();
  await list.waitFor({ state: "visible", timeout: 8000 });
  const options = await list.locator('[role="option"]').allTextContents();
  console.log(`  model terpampang: ${options.map((o) => o.replace(/\s+/g, " ").trim()).join(" · ")}`);

  // Cukup untuk dibaca di video, tidak lebih.
  await beat(page, 1100);

  await page.keyboard.press("Escape");
  await list.waitFor({ state: "hidden", timeout: 8000 });

  const after = ((await modelBtn.textContent()) ?? "").replace(/\s+/g, " ").trim();
  console.log(
    `  model dipakai   : ${after}${after === before ? " (tidak berubah, sesuai maksud)" : " — BERUBAH, seharusnya tidak"}`
  );
});

await generateEmblem(page);

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
  await page.keyboard.press("Enter");
  /**
   * Penantian dipindah dari "gelembung balasan muncul" ke "indikator selesai".
   *
   * Menghitung label "0G TEE (GLM-5.3)" berhenti bisa dipakai begitu studio
   * memasang gelembung asisten SEBELUM permintaan dikirim (supaya jalur galat
   * mengisi gelembung yang sama, bukan menambah satu lagi). Labelnya ikut terpasang
   * seketika, jadi hitungannya naik sebelum ada satu token pun dan adegan ini
   * terpotong di tengah model berpikir.
   *
   * Sekarang urutannya mengikuti keadaan yang sebenarnya, dan sekalian memamerkan
   * indikator progres SSE: tunggu indikatornya MUNCUL, tahan supaya penghitung
   * karakternya terlihat bergerak, lalu tunggu indikatornya HILANG — itu penanda
   * jawabannya sudah utuh.
   */
  await page
    .waitForFunction(() => /Reasoning on 0G/i.test(document.body.innerText), null, { timeout: 60000 })
    .catch(() => {
      // Jawaban bisa datang begitu cepat sehingga indikatornya tidak pernah
      // tertangkap. Bukan kegagalan; lanjut ke penantian selesai di bawah.
    });
  await beat(page, 3000);
  await page.waitForFunction(() => !/Reasoning on 0G/i.test(document.body.innerText), null, { timeout: 180000 });
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

/**
 * Adegan "1d) Gerbang World ID" DIHAPUS bersama gerbangnya.
 *
 * Dulu perekam berhenti di sini sampai manusia memindai QR dengan World App, karena
 * proof-nya tidak bisa diotomasi dan memalsukan tokennya berarti video menampilkan
 * verifikasi yang tidak terjadi. Sekarang tidak ada yang perlu ditunggu: satu-satunya
 * gerbang adalah attestation wallet di adegan 2, dan itu ditandatangani oleh shim
 * dompet perekam sendiri.
 *
 * Konsekuensi yang disengaja: perekaman kini bisa berjalan tanpa pengawasan dari awal
 * sampai akhir, jadi tidak ada lagi jeda 5 menit yang bisa membatalkan rekaman.
 */

/**
 * Adegan 1d BARU: mencentang pengikatan identitas agent ERC-8004.
 *
 * KENAPA INI HARUS ADEGANNYA SENDIRI
 *
 * Pengikatan agent MATI secara bawaan di studio, dan itu keputusan yang benar untuk
 * produk — mendaftarkan agent adalah transaksi terpisah terhadap registry yang bukan
 * milik kami, jadi mewajibkannya akan membuat setiap peluncuran jadi dua transaksi.
 * Tapi akibatnya perekam sebelumnya HANYA MENGGULIR MELEWATI bagian ini: videonya
 * memperlihatkan formulirnya, lalu meluncurkan tanpa agent, sehingga fitur yang
 * disebut di seluruh dokumentasi tidak pernah terlihat bekerja.
 *
 * KENAPA GAGALNYA HARUS MEMBATALKAN REKAMAN
 *
 * `AdextoFactory` menuntut `AGENT_REGISTRY.ownerOf(agentId) == msg.sender`. Kalau id-nya
 * salah atau bukan milik penandatangan, `deployTrinity` REVERT — setelah gas terbakar,
 * dan setelah ticker sempat diperiksa. Studio sudah memeriksa kepemilikan itu di klien
 * dan menampilkan hasilnya sebagai petunjuk, jadi di sini kita menunggu petunjuk itu
 * berbunyi "you own this agent" dan berhenti kalau tidak. Lebih murah membatalkan
 * sebelum transaksi daripada menemukan revert setelah membayar.
 *
 * Id-nya per chain: agent yang sama punya id berbeda di setiap registry, jadi nilainya
 * masuk lewat env alih-alih dihardcode. Di Monad, `10251` dimiliki deployer.
 */
const AGENT_ID = (process.env.DEMO_AGENT_ID || "").trim();
if (AGENT_ID) {
  scene(`1d) Ikat identitas agent ERC-8004 (#${AGENT_ID} di ${CHAIN.name})`);
  await glidePanel(page, "BONDING CURVE", 620);
  await beat(page, 1200);

  const bindBox = page.locator('label:has-text("Bind an ERC-8004 agent identity") input[type="checkbox"]').first();
  await bindBox.scrollIntoViewIfNeeded();
  await beat(page, 900);
  await bindBox.check();
  await beat(page, 1400);

  const idField = page.getByPlaceholder(`id on ${CHAIN.name}`).first();
  await typeInto(page, idField, AGENT_ID);
  await beat(page, 1200);

  // Petunjuk kepemilikan dari studio, bukan asumsi kita. Timeout-nya longgar karena
  // pemeriksaannya memanggil registry lewat RPC.
  const owned = page.locator("text=/you own this agent/i").first();
  try {
    await owned.waitFor({ state: "visible", timeout: 45000 });
    console.log(`  kepemilikan agent #${AGENT_ID}: TERKONFIRMASI oleh studio`);
  } catch {
    console.error(
      `  kepemilikan agent #${AGENT_ID} TIDAK terkonfirmasi di ${CHAIN.name}.\n` +
        `  deployTrinity akan revert "Factory: agent not owned by caller" setelah gas terbakar.\n` +
        `  Rekaman dibatalkan sebelum transaksi apa pun dikirim.`
    );
    await ctx.close();
    await browser.close();
    process.exit(1);
  }
  await beat(page, 1600);
  await glidePanel(page, "BONDING CURVE", -620);
  await beat(page, 800);
}

scene(`2) Attestation lalu launch (transaksi ${CHAIN.name} nyata)`);
const signBtn = page.getByRole("button", { name: "Sign attestation", exact: true });
await signBtn.hover();
await beat(page, 400);
await signBtn.click();
await page.waitForSelector("text=SIGNED", { timeout: 60000 });
await beat(page, 1400);

const launchBtn = launchButton(page).first();
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
await page.goto(`${BASE}/token/${TICKER.toLowerCase()}?chain=${CHAIN.chainId}&tf=${DEMO_TF}`, { waitUntil: "domcontentloaded" });
await beat(page, 3200);

/**
 * Interval chart dipindah ke 15 detik untuk seluruh adegan perdagangan.
 *
 * Pada 1 menit — bawaannya — perdagangan yang berjarak beberapa puluh detik menyatu jadi
 * satu candle, dan `close` bucket itu diambil dari fill TERAKHIR. Rekaman pertama
 * membuktikannya: buy, sell, lalu buy lagi masuk satu bucket, sehingga 4 pembelian dan 1
 * penjualan menghasilkan NOL candle merah — penjualannya lenyap dari chart.
 *
 * Kenapa 15 detik dan bukan 1 detik: dihitung dari jarak perdagangan rekaman pertama
 * (0s, 24s, 50s, 76s, 91s), ketiga kandidat 1s/5s/15s sama-sama memberi tiap perdagangan
 * bucket sendiri. Yang membedakan adalah bar kosong di antaranya — 87 bar kosong pada 1
 * detik, 14 pada 5 detik, hanya 2 pada 15 detik. Pada 1 detik kelima candle nyata jadi
 * sekitar 5% lebar chart, yaitu masalah "terhimpit" yang justru sedang dihindari.
 */
/**
 * Intervalnya sudah datang dari `?tf=` pada URL, jadi tidak perlu diklik. Yang dilakukan di
 * sini hanya MEMASTIKAN tombolnya benar-benar tersorot — kalau tidak, berarti param-nya
 * tidak terbaca dan seluruh adegan perdagangan akan direkam pada timeframe yang salah.
 */
await safely(`pastikan interval chart ${DEMO_TF}s`, async () => {
  const label = `${DEMO_TF}s`;
  const btn = page.locator(`button:has-text("${label}")`).first();
  await btn.waitFor({ state: "visible", timeout: 15000 });
  const cls = (await btn.getAttribute("class")) ?? "";
  const aktif = cls.includes("text-accent");
  console.log(`  interval chart: ${label} ${aktif ? "AKTIF" : "TIDAK aktif — ?tf= tidak terbaca"}`);
  if (!aktif) {
    await btn.click();
    await beat(page, 1200);
  }
});
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

// Candle pembelian pertama HARUS masuk kamera sebelum adegan pindah.
await awaitChartFill(page, 1, "pembelian pertama");

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
await page.goto(`${BASE}/token/${TICKER.toLowerCase()}?chain=${CHAIN.chainId}&tf=${DEMO_TF}`, { waitUntil: "domcontentloaded" });
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

// Candle MERAH penjualan punya masalah waktu yang sama dengan pembelian pertama, dan ia
// justru adegan yang paling ingin diperlihatkan. Sampai di sini sudah ada 3 fill: dua
// pembelian lalu satu penjualan.
await awaitChartFill(page, 3, "penjualan");

/**
 * Menahan sebentar supaya candle merah penjualannya benar-benar masuk kamera.
 *
 * Tidak perlu menunggu batas bucket. Pada interval 15 detik yang dipilih di adegan 4,
 * perdagangan yang berjarak 24-26 detik — jarak alami antar-adegan di sini — sudah
 * mendarat di bucket masing-masing. Diverifikasi dari data rekaman pertama: pada 15s
 * kelima perdagangan mendapat bucket sendiri, sementara pada 60s tiga di antaranya
 * menyatu dan penjualannya tertelan.
 *
 * Chart mengambil data ulang seketika begitu trade terkonfirmasi (prop `refreshKey` di
 * RealtimeCandleChart), jadi bar barunya muncul tanpa menunggu polling 15 detik.
 */
await beat(page, 3200);

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
    await page.goto(`${BASE}/token/${TICKER.toLowerCase()}?chain=${CHAIN.chainId}&tf=${DEMO_TF}`, { waitUntil: "domcontentloaded" });
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
await page.goto(`${BASE}/token/${TICKER.toLowerCase()}?chain=${CHAIN.chainId}&tf=${DEMO_TF}`, { waitUntil: "domcontentloaded" });
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
