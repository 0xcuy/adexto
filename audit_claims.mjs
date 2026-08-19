/**
 * Penjaga klaim.
 *
 * Audit satu putaran menemukan bahwa halaman-halaman di situs ini saling
 * membantah: hero menyatakan factory peluncuran belum di-broadcast sementara
 * ticker di bawahnya menandai tiga mainnet "launch + curve"; footer menandai empat
 * chain "Live"; /governance menampilkan tiga proposal yang `proposalCount`
 * on-chain-nya nol; /agent/demo menampilkan objek attestation yang ditulis tangan
 * di dalam komponen.
 *
 * Yang membuat semuanya lolos begitu lama adalah tidak ada satu pun pemeriksaan
 * yang membaca TEKS. Berkas ini menutup celah itu: ia mengambil teks yang benar-
 * benar terlihat di setiap rute lalu menolak frasa yang sudah kami putuskan tidak
 * bisa dipertahankan, dan memeriksa bahwa demo x402 benar-benar melakukan
 * permintaan jaringan.
 *
 * Pakai: BASE_URL=https://adexto.xyz node audit_claims.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const ROUTES = "/,/studio,/swap,/explorer,/docs,/pitch,/whitepaper,/governance,/agent/demo".split(",");

/**
 * Frasa terlarang, masing-masing dengan alasannya. Alasan ikut dicetak supaya
 * siapa pun yang memicunya tahu KENAPA, bukan hanya bahwa ada yang gagal.
 */
const BANNED = [
  ["Zero central points of failure", "satu VPS, satu berkas registry, satu kunci router, satu Worker"],
  ["one launch per human", "produksi menjalankan WORLD_ID_ONE_LAUNCH_PER_HUMAN=false"],
  ["ERC-8004", "token hanya menyimpan satu address immutable; tidak ada registry standar"],
  ["1-Click", "peluncuran butuh sambung dompet, attestation, World ID, lalu satu tx per chain"],
  ["physically impossible", "tidak ada jaminan sekuat itu yang bisa kami tunjukkan"],
  ["Hardware Attested", "lencana itu mengaku KAMI yang memverifikasi; kami hanya membaca deklarasi router"],
  // Hardware-nya salah, dan salah ini bertahan berbulan-bulan di enam halaman.
  // Router 0G menyatakan Intel TDX lewat dstack — bukan AMD SEV-SNP. Sekali sebuah
  // nama hardware ditulis salah, tidak ada pembaca teknis yang mempercayai sisanya.
  ["SEV-SNP", "router 0G melaporkan Intel TDX via dstack, bukan AMD SEV-SNP"],
  ["Intel SGX", "sama; menyebut dua teknologi sekaligus menandakan tak satu pun diperiksa"],
  ["enclave key", "alamat yang dimaksud adalah EOA deployer"],
  ["ADAI", "token tata kelola tidak ada di chain mana pun"],
  ["exponential curve", "kurvanya produk-konstan, x*y=k"],
  ["settled trustlessly", "penyelesaian x402 belum dibangun"],
  ["Uniswap", "nol integrasi Uniswap di repo ini"],
  ["receive 0% of ongoing", "tidak benar: pump.fun membayar creator bagian fee trading"],
  ["Platform takes all", "sama"],
  ["/mo ARR", "ARR itu tahunan; 'per bulan ARR' bukan satuan"],
  ["edge.adexto.xyz", "subdomain itu belum dipasang dan membalas HTTP 525"],
];

/**
 * Pasangan yang tidak boleh muncul BERSAMA di satu halaman. Inilah kelas cacat
 * yang paling merugikan dan yang paling mudah terlewat: dua pernyataan yang
 * masing-masing terlihat wajar, tetapi tidak mungkin keduanya benar.
 */
const CONTRADICTIONS = [
  {
    a: "launch factory pending broadcast",
    b: "launch + curve",
    why: "menyatakan peluncuran belum bisa DAN sudah jalan di tiga mainnet",
  },
  {
    a: "launching and trading stay disabled",
    b: ">LIVE<",
    why: "menandai fase 'LIVE' di halaman yang menyatakan peluncuran terkunci",
  },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
let fail = 0;

for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2200);
  const text = await page.evaluate(() => document.body.innerText);
  const html = await page.content();

  const hits = BANNED.filter(([phrase]) => text.includes(phrase));
  const clashes = CONTRADICTIONS.filter((c) => html.includes(c.a) && html.includes(c.b));

  if (hits.length === 0 && clashes.length === 0) {
    console.log(`BERSIH   ${route}`);
  } else {
    fail += hits.length + clashes.length;
    console.log(`MASALAH  ${route}`);
    for (const [phrase, why] of hits) console.log(`           - "${phrase}" — ${why}`);
    for (const c of clashes) console.log(`           - bertentangan: "${c.a}" + "${c.b}" — ${c.why}`);
  }
}

// Demo x402 harus benar-benar memanggil jaringan. Versi lamanya nol permintaan.
console.log("\ndemo x402 melakukan permintaan sungguhan?");
await page.goto(`${BASE}/agent/demo`, { waitUntil: "networkidle", timeout: 60000 });
const calls = [];
page.on("request", (r) => {
  if (r.url().includes("x402")) calls.push(r.url());
});
const btn = page.locator('button:has-text("GET the")').first();
if ((await btn.count()) === 0) {
  console.log("  GAGAL  tombol permintaan tidak ada");
  fail++;
} else {
  await btn.click();
  await page.waitForTimeout(6000);
  const body = await page.evaluate(() => document.body.innerText);
  if (calls.length === 0) {
    console.log("  GAGAL  nol permintaan ke gerbang x402 — halaman ini teater lagi");
    fail++;
  } else {
    console.log(`  LULUS  ${calls.length} permintaan: ${calls[0]}`);
  }
  // 402 adalah jawaban yang BENAR di sini, jadi itu yang dituntut.
  if (/HTTP 402/.test(body)) {
    console.log("  LULUS  menampilkan status HTTP sesungguhnya");
  } else {
    console.log("  GAGAL  tidak menampilkan status HTTP 402 dari gerbang");
    fail++;
  }
}

await browser.close();
console.log(`\n  total temuan: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
