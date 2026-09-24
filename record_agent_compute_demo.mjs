/**
 * Merekam alur Agent Compute ujung-ke-ujung di 0G MAINNET dengan transaksi sungguhan.
 *
 * Alur: /agent-compute -> beli 5.000 $ADEXTO dengan mengisi SISI TERIMA -> stake 5.000
 *       -> agen aktif -> terbitkan kunci API -> panggil model dengan kunci itu
 *       -> pemakaian terukur muncul di halaman.
 *
 * Dua aturan dari rekaman sebelumnya yang dipertahankan, keduanya pernah dibayar mahal:
 *   1. Wallet DISUNTIK sebelum navigasi pertama, dan alamatnya DIPERIKSA muncul di UI.
 *      Rekaman lama tidak menyuntik apa pun, jadi seluruh halaman tertutup gerbang
 *      "Connect wallet" dan videonya hanya memperlihatkan antarmuka terkunci. Lebih baik
 *      membatalkan daripada menghasilkan video cacat.
 *   2. TIDAK ADA overlay. Tidak ada banner, caption, atau kursor palsu. Yang terekam
 *      adalah antarmukanya apa adanya.
 *
 * INI MEMBELANJAKAN UANG SUNGGUHAN, dan jumlahnya harus disadari sebelum dijalankan:
 * 5.000 $ADEXTO pada kurva hari ini sekitar 0,101 0G, ditambah gas untuk approve dan
 * stake. Tidak ada mode kering yang masih menghasilkan video jujur — kalau transaksinya
 * palsu, videonya iklan, bukan demo.
 *
 * KUNCI YANG TERLIHAT DI VIDEO HARUS DICABUT. Panel menampilkan rahasianya sekali, jadi
 * ia terekam. Skrip ini mencabutnya sendiri di akhir dan mencetak konfirmasinya; tanpa itu
 * siapa pun yang membekukan satu frame bisa membelanjakan jatah pool.
 *
 * Pakai:
 *   set -a && . ./.env.local && set +a && npx next start -p 3100     # terminal 1
 *   node record_agent_compute_demo.mjs                               # terminal 2
 *
 * Env opsional: DEMO_PACE (0,62 — kecilkan untuk video lebih cepat), DEMO_STAKE (5000),
 * DEMO_HEADED=1 untuk menonton jalannya.
 */
// CATATAN NAVIGASI: `waitUntil: "domcontentloaded"`, BUKAN "networkidle". Halaman token
// melakukan polling (trade feed 10s, order book 15s), jadi jaringannya tidak pernah idle
// dan networkidle bisa timeout lalu MELEMPAR — satu putaran transaksi nyata terbuang tanpa
// menghasilkan berkas. Setiap goto diikuti beat() yang memberi waktu render.
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

const CHAIN = {
  chainId: 16661,
  name: "0G Mainnet",
  rpc: process.env.OG_RPC_URL || "https://evmrpc.0g.ai",
  sym: "0G",
};
const TOKEN = "0xA1358C17004469C7CA5365AbafD294F9b2c11DF7";
const CURVE = "0xc80e0659D2Fc29e62605C9DF6182a85372652B60";
const STAKE = process.env.NEXT_PUBLIC_AGENT_STAKE_0G || "0x5b44AEA7AC49C7a6DA8f700D991852A2970b9231";
const POOL_ENDPOINT = "https://compute.adexto.xyz/v1";
const POOL_MODEL = "0g/deepseek-v4-flash";

const WANT = process.env.DEMO_STAKE || "5000";

const W = 1920;
const H = 1080;
const RAW_DIR = path.join(process.cwd(), "public", "demo-raw-agent");
const OUT_MP4 = path.join(process.cwd(), "public", "adexto_agent_compute_demo.mp4");
const OUT_WEBM = path.join(process.cwd(), "public", "adexto_agent_compute_demo.webm");

const PACE = Number(process.env.DEMO_PACE || 0.62);
const scene = (s) => console.log(`\n=== ${s}`);
const beat = (page, ms = 900) => page.waitForTimeout(Math.max(180, Math.round(ms * PACE)));
const fmt = (v, d = 18) => Number(ethers.formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Menggulir halus; gulir instan membuat video tersentak. */
async function glide(page, y, steps = 18) {
  for (let i = 0; i < steps; i++) {
    await page.evaluate((d) => window.scrollBy(0, d), y / steps);
    await page.waitForTimeout(28);
  }
}

/** Mengetik seperti manusia supaya video tidak terasa seperti tempelan. */
async function typeInto(page, locator, text) {
  await locator.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(text, { delay: 60 });
}

/**
 * Langkah dijalankan tahan-gagal: kalau satu adegan bermasalah, video TETAP diproduksi
 * supaya bisa diperiksa, bukan hilang bersama exception di tengah jalan.
 */
async function safely(label, fn) {
  try {
    await fn();
    return true;
  } catch (e) {
    console.log(`  ! ${label} gagal: ${(e.message || String(e)).split("\n")[0].slice(0, 170)}`);
    return false;
  }
}

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

const provider = new ethers.JsonRpcProvider(CHAIN.rpc, CHAIN.chainId, { staticNetwork: true });
const wallet = new ethers.Wallet(PK, provider);
const ACCOUNT = wallet.address;

const erc20 = new ethers.Contract(
  TOKEN,
  [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function symbol() view returns (string)",
  ],
  provider
);
const stakeC = new ethers.Contract(
  STAKE,
  ["function stakedOf(address) view returns (uint256)", "function totalStaked() view returns (uint256)"],
  provider
);

// ── prasyarat, diperiksa SEBELUM kamera menyala ──────────────────────────────
const native = await provider.getBalance(ACCOUNT);
const tokenBal = await erc20.balanceOf(ACCOUNT);
const stakedNow = await stakeC.stakedOf(ACCOUNT);

console.log(`chain    : ${CHAIN.name} (${CHAIN.chainId})`);
console.log(`akun     : ${ACCOUNT}`);
console.log(`saldo    : ${ethers.formatEther(native)} ${CHAIN.sym} · ${fmt(tokenBal)} ADEXTO`);
console.log(`stake    : ${fmt(stakedNow)} ADEXTO di ${STAKE}`);
console.log(`target   : beli ${WANT} ADEXTO lalu stake ${WANT}`);

if (native < ethers.parseEther("0.3")) {
  console.error(`\nSaldo ${CHAIN.sym} terlalu kecil untuk membeli ${WANT} ADEXTO plus gas. Batal.`);
  process.exit(1);
}
/**
 * Stake yang sudah ada DIBATALKAN dari awal, bukan ditambahi.
 *
 * Videonya memperlihatkan perjalanan dari nol: agen tidak aktif, lalu aktif. Kalau posisi
 * lama masih terbuka, adegan pertama sudah memperlihatkan agen aktif dan seluruh premisnya
 * hilang. Lebih baik berhenti dan meminta keputusan daripada merekam alur yang tidak
 * cocok dengan yang dikatakan videonya.
 */
if (stakedNow > 0n) {
  console.error(
    `\nAlamat ini sudah punya stake ${fmt(stakedNow)} ADEXTO, jadi halaman akan membuka adegan\n` +
      "pertama dengan agen SUDAH aktif dan premis videonya hilang. Tarik dulu:\n" +
      "  unstakeAll() di " + STAKE
  );
  process.exit(1);
}

// Kunci yang tertinggal dari percobaan sebelumnya akan membuat POST membalas 409.
const pre = await fetch(`${BASE}/api/agent/keys?address=${ACCOUNT}`).then((r) => r.json()).catch(() => null);
if (!pre) {
  console.error(`\n${BASE} tidak menjawab. Jalankan: set -a && . ./.env.local && set +a && npx next start -p 3100`);
  process.exit(1);
}
if (!pre.configured) {
  console.error("\nPool tidak terkonfigurasi di server ini (AGENT_COMPUTE_ROUTER_PASSWORD kosong?). Batal.");
  process.exit(1);
}
if (pre.key) {
  console.error("\nAlamat ini sudah punya kunci; penerbitan akan membalas 409. Cabut dulu lewat UI. Batal.");
  process.exit(1);
}
if (pre.stakeContract?.toLowerCase() !== STAKE.toLowerCase()) {
  console.error(`\nServer menunjuk kontrak stake ${pre.stakeContract}, skrip ini ${STAKE}. Batal.`);
  process.exit(1);
}

if (fs.existsSync(RAW_DIR)) fs.rmSync(RAW_DIR, { recursive: true, force: true });
fs.mkdirSync(RAW_DIR, { recursive: true });

const HEADED = process.env.DEMO_HEADED === "1";
const browser = await chromium.launch({
  headless: !HEADED,
  args: ["--hide-scrollbars", "--disable-features=IsolateOrigins,site-per-process"],
});
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: RAW_DIR, size: { width: W, height: H } },
  deviceScaleFactor: 1,
  // Paletnya krem terang. `dark` akan membuat komponen yang menghormati preferensi
  // sistem merender warna yang tidak pernah dilihat pengunjung sungguhan.
  colorScheme: "light",
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
        console.log(`    tx ${tx.hash}`);
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

// ── 0. AGENT COMPUTE: apa yang ditawarkan, sebelum menyentuh apa pun ─────────
scene("0) /agent-compute — halaman pembuka, digulir sampai batas jujurnya");
await page.goto(`${BASE}/agent-compute`, { waitUntil: "domcontentloaded" });
await beat(page, 3000);

/**
 * Alamat wallet DIPERIKSA muncul di navbar sebelum apa pun direkam lebih jauh.
 * Ini penjaga yang ketiadaannya menghasilkan rekaman lama yang seluruhnya terkunci.
 */
const shortAddr = `${ACCOUNT.slice(0, 6)}`;
const navbarText = await page.locator("header, nav").first().innerText().catch(() => "");
if (!navbarText.toLowerCase().includes(shortAddr.toLowerCase())) {
  console.error(`\nWallet tidak tersambung di UI (navbar tidak memuat ${shortAddr}). Membatalkan sebelum merekam alur cacat.`);
  await ctx.close();
  await browser.close();
  process.exit(1);
}
console.log(`  wallet tersambung di UI: ${shortAddr}…`);

/**
 * Banner persetujuan cookie DITUTUP di kamera, di detik-detik pertama.
 *
 * Ia melekat di bawah viewport sampai dijawab, jadi tanpa ini ia menutupi sekitar 90px
 * dari setiap frame 1080p selama 74 detik — dan di beberapa adegan ia menindih justru
 * isinya. Terlihat dari sampel frame rekaman pertama, bukan dari kode.
 *
 * Ditutup dengan MENGKLIK, bukan dengan menyuntik localStorage sebelum navigasi. Bedanya
 * bukan gaya: mengkliknya adalah yang dilakukan pengunjung sungguhan, dan pilihan
 * "Essential only" adalah yang paling sedikit mengklaim. Menyembunyikannya lewat suntikan
 * akan membuat video memperlihatkan halaman yang tidak pernah dilihat siapa pun.
 */
await safely("tutup banner persetujuan", async () => {
  const essential = page.locator('button:has-text("Essential only")').first();
  if ((await essential.count()) > 0) {
    await beat(page, 900);
    await essential.hover();
    await beat(page, 500);
    await essential.click();
    await beat(page, 900);
    console.log("  banner persetujuan ditutup (Essential only)");
  }
});

// Turun melewati endpoint, tingkatan, cara kerja, sampai kotak batas yang jujur.
for (const y of [420, 520, 620, 640]) {
  await glide(page, y);
  await beat(page, 1500);
}
await beat(page, 1600);
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
await beat(page, 1600);

// ── 1. BELI: sisi TERIMA yang diisi, bukan sisi bayar ────────────────────────
scene(`1) beli ${WANT} ADEXTO dengan mengisi sisi terima`);
const buyCta = page.locator('a:has-text("Buy $ADEXTO")').first();
await buyCta.hover();
await beat(page, 700);
await buyCta.click();
await page.waitForURL(/\/token\/adexto/, { timeout: 45000 }).catch(() => {});
await beat(page, 4200);

// Panel swap ada di kolom kanan; digulir ke sana alih-alih menebak jarak.
await safely("gulir ke panel swap", async () => {
  await page.locator('text=Sovereign Curve Swap').first().scrollIntoViewIfNeeded();
  await beat(page, 1400);
});

const balBefore = await erc20.balanceOf(ACCOUNT);
const recvField = page.locator('input[aria-label*="to receive"]').first();
const payField = page.locator('input[aria-label*="to pay"]').first();

await safely("isi sisi terima", async () => {
  await typeInto(page, recvField, WANT);
  await beat(page, 2200);
  const solved = await payField.inputValue();
  console.log(`  sisi bayar terpecahkan: ${solved} ${CHAIN.sym} untuk ${WANT} ADEXTO`);
});
await beat(page, 1800);

let bought = false;
await safely("eksekusi beli", async () => {
  const go = page.locator('button:has-text("Buy $ADEXTO")').last();
  await go.hover();
  await beat(page, 600);
  await go.click();
  // Ditunggu di CHAIN, bukan di UI: saldo yang naik adalah bukti, spinner bukan.
  for (let i = 0; i < 60; i++) {
    await beat(page, 1000);
    const now = await erc20.balanceOf(ACCOUNT);
    if (now > balBefore) {
      bought = true;
      console.log(`  terbeli: +${fmt(now - balBefore)} ADEXTO (saldo ${fmt(now)})`);
      break;
    }
  }
  if (!bought) throw new Error("saldo token tidak naik dalam 60 detik");
});
await beat(page, 2600);

// ── 2. KEMBALI KE AGENT COMPUTE lewat tab, bukan lewat goto ──────────────────
scene("2) balik ke /agent-compute lewat tab navbar");
await safely("klik tab Agent Compute", async () => {
  const tab = page.locator('a:has-text("Agent Compute")').first();
  await tab.hover();
  await beat(page, 600);
  await tab.click();
  await page.waitForURL(/\/agent-compute/, { timeout: 45000 });
});
await beat(page, 3400);

// ── 3. STAKE ────────────────────────────────────────────────────────────────
scene(`3) stake ${WANT} ADEXTO — approve lalu stake`);
const stakeField = page.locator('input[aria-label="Amount of ADEXTO to stake"]');
await safely("isi jumlah stake", async () => {
  await stakeField.scrollIntoViewIfNeeded();
  await beat(page, 900);
  await typeInto(page, stakeField, WANT);
  await beat(page, 1800);
});

let staked = false;
await safely("eksekusi stake", async () => {
  const go = page.locator('button:has-text("Stake and activate")');
  await go.hover();
  await beat(page, 700);
  await go.click();
  for (let i = 0; i < 90; i++) {
    await beat(page, 1000);
    const pos = await stakeC.stakedOf(ACCOUNT);
    if (pos > 0n) {
      staked = true;
      console.log(`  ter-stake: ${fmt(pos)} ADEXTO`);
      break;
    }
  }
  if (!staked) throw new Error("stakedOf tetap nol setelah 90 detik");
});
// Panel membaca ulang sendiri sesudah stake; beri waktu supaya "AGENT ACTIVE" terekam.
await beat(page, 4200);

// ── 4. KUNCI API ────────────────────────────────────────────────────────────
scene("4) terbitkan kunci API — ditandatangani alamat yang memegang stake");
let secret = null;
await safely("terbitkan kunci", async () => {
  const create = page.locator('button:has-text("Create API key")');
  await create.scrollIntoViewIfNeeded();
  await beat(page, 1200);
  await create.hover();
  await beat(page, 600);
  await create.click();
  // Blok "shown once" memuat rahasianya; itu penanda paling jujur bahwa kuncinya ada.
  await page.locator("text=Copy this now").waitFor({ timeout: 60000 });
  await beat(page, 2000);
  secret = await page
    .locator('code:below(:text("Copy this now"))')
    .first()
    .innerText()
    .catch(() => null);
  if (!secret || !secret.startsWith("sk-")) throw new Error("rahasia kunci tidak terbaca dari DOM");
  console.log(`  kunci terbit: ${secret.slice(0, 11)}…${secret.slice(-6)}`);
});
await beat(page, 2600);


// ── 5. PAKAI KUNCINYA — di LATAR, sambil adegan lain direkam ────────────────
/**
 * Panggilan model dan sapuannya dijalankan di latar, tidak ditunggu di depan kamera.
 *
 * Catatan pemakaian router masuk beberapa detik SESUDAH respons, dan jedanya tidak tetap:
 * take pertama tercatat dalam 20 detik, take kedua belum tercatat setelah 40 dan finalenya
 * memperlihatkan meteran nol. Menaikkan jedanya saja akan menukar satu masalah dengan
 * masalah lain — video berisi gambar statis selama menunggu.
 *
 * Jadi penantiannya diisi dengan adegan yang memang perlu direkam: endpoint, tangga
 * tingkatan, batas yang jujur. Pola yang sama dipakai perekam lama untuk window
 * anti-sniper. Hasilnya menunggu lebih lama DAN videonya lebih padat.
 */
scene("5) panggil model dengan kunci itu (di latar) sambil adegan penutup direkam");
let metered = null;
const meterWork = (async () => {
  if (!secret) return null;
  /**
   * PROMPT-NYA HARUS UNIK PER REKAMAN, dan ini bukan kosmetik.
   *
   * Router punya exact-response cache dengan TTL 24 jam: permintaan yang identik diputar
   * ulang dari cache tanpa memanggil upstream, jadi TIDAK ADA pemakaian yang tercatat.
   * Take pertama memakai prompt tetap dan berhasil karena ia cache MISS yang mengisi
   * cache-nya; take kedua dan ketiga memakai prompt yang sama, dilayani dari cache, dan
   * finalenya memperlihatkan meteran nol selama dua menit penantian.
   *
   * Gejalanya menipu karena responsnya 200 dan `usage` tetap terisi — angka yang sama
   * persis, byte per byte, di ketiga take. Yang membuktikannya: `usageHistory` di router
   * hanya memuat SATU baris untuk tiga panggilan.
   *
   * Nonce-nya ditaruh di dalam kalimat, bukan sebagai field terpisah, supaya jawabannya
   * tetap kalimat yang wajar untuk ditonton.
   */
  const nonce = Date.now().toString(36).slice(-5);
  const res = await fetch(`${POOL_ENDPOINT}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: POOL_MODEL,
      messages: [
        {
          role: "user",
          content: `In one short sentence: what is a bonding curve? (request ${nonce})`,
        },
      ],
      max_tokens: 60,
      stream: false,
    }),
  });
  const j = await res.json().catch(() => ({}));
  console.log(`  model ${res.status}: ${JSON.stringify(j.choices?.[0]?.message?.content || "").slice(0, 110)}`);
  console.log(`  usage dilaporkan ke pemanggil: in ${j.usage?.prompt_tokens} out ${j.usage?.completion_tokens}`);

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    await fetch(`${BASE}/api/agent/keys/sweep`, {
      method: "POST",
      headers: { "x-sweep-secret": process.env.AGENT_COMPUTE_SWEEP_SECRET || "" },
    }).catch(() => {});
    const s = await fetch(`${BASE}/api/agent/keys?address=${ACCOUNT}`)
      .then((r) => r.json())
      .catch(() => ({}));
    if ((s.key?.usedInput || 0) > 0) {
      console.log(`  meteran bergerak setelah ~${(i + 1) * 3}s: in ${s.key.usedInput} out ${s.key.usedOutput} req ${s.key.requests}`);
      return s.key;
    }
  }
  console.log("  ! pemakaian belum tercatat setelah 120 detik");
  return null;
})();

// Endpoint dan model, dua baris yang memang harus ditempel orang ke kodenya.
await safely("perlihatkan endpoint dan model", async () => {
  await page.locator("text=Example request").first().scrollIntoViewIfNeeded();
  await beat(page, 3000);
});

// ── 6. TINGKATAN DAN BATAS YANG JUJUR, dalam keadaan aktif ─────────────────
scene("6) tangga tingkatan dan batas yang jujur");
await safely("tingkatan", async () => {
  await page.locator("text=Stake tiers").first().scrollIntoViewIfNeeded();
  await beat(page, 3000);
  await glide(page, 620);
  await beat(page, 3200);
  await glide(page, 620);
  await beat(page, 3600);
});

// ── 7. PENUTUP: meteran yang bergerak, dibaca dari halaman ─────────────────
scene("7) penutup — meteran yang bergerak");
metered = await meterWork;
await safely("Refresh di UI memperlihatkan pemakaian", async () => {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await beat(page, 1800);
  const refresh = page.locator('button:has-text("Refresh")');
  await refresh.scrollIntoViewIfNeeded();
  await beat(page, 900);
  await refresh.hover();
  await beat(page, 500);
  await refresh.click();
  await beat(page, 4200);
  // Kartu kunci memuat rincian input/output/requests; itu bukti terakhir di kamera.
  await page.locator("text=Your API key").first().scrollIntoViewIfNeeded();
  await beat(page, 3800);
});
if (!metered) {
  console.log("  ! finale memperlihatkan meteran nol — periksa video sebelum dipakai");
}

// ── encode ──────────────────────────────────────────────────────────────────
const finalStaked = await stakeC.stakedOf(ACCOUNT);
const finalBal = await erc20.balanceOf(ACCOUNT);
console.log(`\nakhir    : ${fmt(finalBal)} ADEXTO di dompet · ${fmt(finalStaked)} ter-stake`);
console.log(`page errors: ${pageErrors.length}`);
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
const dur = execSync(`ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${OUT_MP4}"`)
  .toString()
  .trim();
console.log(`selesai: ${OUT_MP4} (${Number(dur).toFixed(1)}s, ${W}x${H})`);
console.log(`         ${OUT_WEBM}`);

/**
 * Kunci yang terekam DICABUT, dan ini bukan kebersihan opsional.
 *
 * Videonya memperlihatkan rahasianya di layar karena memang begitu cara panel
 * menyerahkannya. Membiarkannya hidup berarti siapa pun yang membekukan satu frame bisa
 * membelanjakan jatah pool. Dicabut lewat rute yang sama yang dipakai pengguna, dengan
 * tanda tangan dari alamat pemiliknya.
 */
if (secret) {
  const msg = [
    "ADEXTO Agent Compute",
    "Revoke my agent compute API key",
    `Endpoint: ${POOL_ENDPOINT}`,
    `Address: ${ACCOUNT}`,
    `Timestamp: ${Date.now()}`,
  ].join("\n");
  const sig = await wallet.signMessage(msg);
  const res = await fetch(`${BASE}/api/agent/keys`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: ACCOUNT, message: msg, signature: sig }),
  });
  console.log(`\nkunci yang terekam dicabut: HTTP ${res.status} ${JSON.stringify(await res.json().catch(() => ({})))}`);
  console.log("Kunci di video sudah mati. Buat yang baru dari UI kalau butuh yang berfungsi.");
}
console.log(`\nstake ${fmt(finalStaked)} ADEXTO DIBIARKAN terbuka — tarik dengan "Unstake all" kalau tidak dipakai lagi.`);
