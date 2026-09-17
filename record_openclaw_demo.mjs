/**
 * Rekam demo Day 3: agent di 0G Compute membeli token lintas chain lewat MCP.
 *
 *   node record_openclaw_demo.mjs
 *
 * KENAPA MEREKAM UI DAN BUKAN TERMINAL
 *
 * Yang dipresentasikan adalah UI OpenClaw, jadi rekaman cadangan harus memperlihatkan
 * hal yang sama. Rekaman terminal akan menjadi cadangan untuk demo yang berbeda dari
 * demo yang dijanjikan.
 *
 * TIDAK ADA OVERLAY, TIDAK ADA TEKS YANG DIGAMBAR DI ATAS UI. Yang terekam adalah
 * antarmuka apa adanya, sama seperti aturan di `record_demo_testnet.mjs`. Sebuah
 * rekaman yang dihias tidak bisa dipakai sebagai bukti.
 *
 * PROMPT-NYA SUDAH DIUJI DAN MENGHASILKAN PEMBELIAN SUNGGUHAN. Ia tidak boleh diubah
 * tanpa diuji ulang: model harus memilih alat sendiri, dan prompt yang sedikit berbeda
 * bisa membuatnya menjawab dari ingatan alih-alih memanggil MCP.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync, renameSync, existsSync } from "node:fs";

const TOKEN = readFileSync("/tmp/oc_token.txt", "utf8").trim();
const UI = `http://127.0.0.1:18789/#token=${TOKEN}`;
const OUT = "demo-out";
mkdirSync(OUT, { recursive: true });

/** Prompt demo. Diuji: menghasilkan pembelian $WOMBO sungguhan di Arbitrum. */
const PROMPT =
  "Using only your adexto tools: list the markets, pick the one on Arbitrum, " +
  "quote it, then execute the purchase. Report the delivery transaction hash and " +
  "state honestly whose wallet signed the payment.";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

const beat = (ms) => page.waitForTimeout(ms);

console.log("membuka UI…");
await page.goto(UI, { waitUntil: "domcontentloaded", timeout: 60000 });
await beat(3500);

/**
 * Banner "Update available" DITUTUP, dan sesi baru dibuka.
 *
 * Keduanya soal apa yang terlihat di rekaman cadangan, dan keduanya nyata pada percobaan
 * pertama: spanduk merah di tepi atas menarik mata lebih dulu daripada isi demonya, dan
 * sidebar memperlihatkan sesi `okx-a2a:g-backup` milik proyek lain. Rekaman yang dipakai
 * sebagai cadangan presentasi tidak boleh memuat pekerjaan orang lain.
 *
 * Dibungkus try: keduanya kosmetik, dan gagal menutup spanduk tidak boleh membatalkan
 * rekaman yang isinya benar.
 */
for (const sel of ['button[aria-label*="ismiss" i]', 'button[aria-label*="lose" i]', "text=Update now >> xpath=../button[last()]"]) {
  try {
    const b = page.locator(sel).first();
    if ((await b.count()) > 0 && (await b.isVisible())) {
      await b.click({ timeout: 3000 });
      console.log("spanduk update ditutup");
      break;
    }
  } catch {}
}
try {
  const fresh = page.locator("text=/^\\+?\\s*New session$/i").first();
  if ((await fresh.count()) > 0) {
    await fresh.click({ timeout: 5000 });
    console.log("sesi baru dibuka");
    await beat(2500);
  }
} catch {}
await beat(1200);

// Kotak masukan dicari lewat beberapa pola: UI ini bukan milik kita, jadi satu selektor
// yang dipaku akan pecah pada rilis berikutnya tanpa memberi tahu.
const CANDIDATES = [
  'textarea[placeholder*="essage" i]',
  'textarea[placeholder*="sk" i]',
  'div[contenteditable="true"]',
  "textarea",
  'input[type="text"]',
];
let box = null;
for (const sel of CANDIDATES) {
  const el = page.locator(sel).last();
  if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) {
    box = el;
    console.log(`kotak masukan: ${sel}`);
    break;
  }
}
if (!box) {
  console.error("kotak masukan tidak ditemukan — UI mungkin berubah. Menyimpan tangkapan.");
  await page.screenshot({ path: `${OUT}/ui-tidak-dikenali.png`, fullPage: true });
  await ctx.close();
  await browser.close();
  process.exit(1);
}

await box.click();
await beat(600);
// Diketik, bukan di-fill: yang ditonton harus terlihat seperti orang mengetik.
await box.type(PROMPT, { delay: 18 });
await beat(900);
await page.keyboard.press("Enter");
console.log("prompt dikirim, menunggu agent memanggil alat MCP…");

/**
 * Menunggu hash transaksi muncul, bukan menunggu waktu tetap.
 *
 * Panggilan alat berantai — list, quote, lalu bayar — dan durasinya bergantung pada
 * latensi 0G Compute serta gerbang. Tenggat tetap akan memotong rekaman di tengah
 * pembelian pada hari yang lambat.
 */
/**
 * Ditunggu sampai agent BERHENTI merespons, bukan sampai sebuah hash muncul.
 *
 * Percobaan pertama berhenti pada kemunculan hash pertama, dan hash itu berasal dari
 * panel hasil alat — jawaban akhirnya belum dirender, jadi rekaman berakhir di tengah
 * "Assistant is responding". Dua syarat sekarang: ada hash DAN indikator merespons sudah
 * hilang.
 */
const deadline = Date.now() + 300000;
let sawHash = false;
let done = false;
while (Date.now() < deadline) {
  const state = await page
    .evaluate(() => ({
      text: document.body.innerText,
      // UI memakai beberapa kata untuk keadaan yang sama — "responding", "working",
      // "thinking" — dan mencocokkan hanya satu di antaranya membuat rekaman berhenti di
      // tengah jalan. Terjadi dua kali: pertama pada "responding", lalu pada "working".
      busy: /Assistant is (responding|working|thinking|typing)/i.test(document.body.innerText),
    }))
    .catch(() => ({ text: "", busy: true }));
  if (/0x[a-fA-F0-9]{64}/.test(state.text)) sawHash = true;
  if (sawHash && !state.busy) {
    done = true;
    break;
  }
  await beat(2500);
}
console.log(
  done ? "agent selesai, hash ada di layar" : sawHash ? "PERINGATAN: hash ada tapi agent belum selesai" : "PERINGATAN: tidak ada hash sampai tenggat"
);
// Beat penutup supaya jawaban akhir terbaca sebelum rekaman berhenti.
await beat(7000);

await page.screenshot({ path: `${OUT}/hasil-akhir.png`, fullPage: true });
const video = page.video();
await ctx.close();
await browser.close();

if (video) {
  const src = await video.path();
  const dst = `${OUT}/adexto-agent-buys-via-mcp.webm`;
  if (existsSync(src)) {
    renameSync(src, dst);
    console.log(`video: ${dst}`);
  }
}
console.log(`tangkapan: ${OUT}/hasil-akhir.png`);
process.exit(sawHash ? 0 : 1);
