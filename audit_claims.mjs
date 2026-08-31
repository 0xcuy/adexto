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
  /**
   * "ERC-8004" TIDAK lagi terlarang seluruhnya, karena sejak factory 0.10.0 klaimnya
   * bisa dipertahankan: `AdextoCurveFactory` memanggil `ownerOf(agentId)` di registry
   * kanonik dan menolak launch kalau pemanggil bukan pemiliknya, lalu `AdextoToken`
   * menyimpan `agentBound`/`agentId`/`agentRegistry` permanen.
   *
   * Yang terlarang adalah dua cara MELEBIHKANNYA:
   *   - menyebut "compliant"/"compliance", padahal hanya Identity Registry yang
   *     dipakai — Reputation dan Validation tidak, dan standarnya masih Draft;
   *   - menyebutnya sifat tetap setiap token, padahal pengikatan itu OPSIONAL dan
   *     mati secara default. Frasa lama "ERC-8004 Token" persis kesalahan ini.
   */
  ["ERC-8004 compliant", "hanya Identity Registry yang dipakai; Reputation & Validation tidak, dan standarnya Draft"],
  ["ERC-8004 compliance", "sama: kepatuhan penuh belum bisa ditunjukkan"],
  ["ERC-8004 Token", "pengikatan agent bersifat opsional dan mati secara default, bukan sifat setiap token"],
  ["ERC-8004 Agent Tokens", "sama; menyiratkan setiap token terikat agent"],
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
  /**
   * Dua penjaga di bawah mengawal kegagalan BARU, yang arahnya berlawanan dengan
   * dua di atas.
   *
   * Factory 0.10.0 kini benar-benar hidup di keempat mainnet, jadi bahaya lamanya
   * ("mengaku live padahal terkunci") berganti jadi: mengaku factory belum dikirim
   * padahal sudah — copy basi yang meremehkan diri sendiri — dan, lebih merugikan,
   * membiarkan halaman yang menyatakan peluncuran hidup berdampingan dengan panel
   * yang masih menyatakan peluncuran mati karena env belum diwire.
   *
   * Keduanya pernah terjadi persis di repo ini, jadi bukan bahaya hipotetis.
   */
  {
    a: "curve factory is live",
    b: "Launching is disabled",
    why: "copy menyatakan factory hidup sementara studio masih melaporkan peluncuran mati (env belum diwire)",
  },
  {
    a: "not broadcast to mainnet yet",
    b: "live on all four mainnets",
    why: "sisa copy lama menyatakan factory belum dikirim di halaman yang menyatakan sudah",
  },
  /**
   * /pitch pernah memuat "Settlement is not implemented" di seksi arsitektur DAN
   * "paid agent API calls settled between machines" di tabel pendapatan, empat
   * seksi di bawahnya. Dua kalimat itu di satu halaman, dan yang kedua adalah
   * dasar target "$120k/mo".
   *
   * Ini kelas cacat yang paling mudah lolos: bukan satu klaim yang jelas salah,
   * melainkan dua yang masing-masing terlihat wajar sampai dibaca berurutan.
   */
  {
    a: "Settlement is not",
    b: "settled between machines",
    why: "satu halaman menyatakan penyelesaian belum dibangun DAN memproyeksikan pendapatan dari pembayaran yang sudah diselesaikan",
  },
];

/**
 * Frasa yang hanya boleh muncul kalau ditandai belum dibangun.
 *
 * Tabel pendapatan di /pitch mencetak target berupa uang. Selama tidak ada satu
 * pun aliran yang berjalan, setiap target WAJIB berdampingan dengan penanda —
 * "(planned)", "(not built)", atau kalimat yang menyatakannya. Tanpa itu, angka
 * bersatuan dolar terbaca sebagai penerimaan.
 */
const MUST_BE_QUALIFIED = [
  ["Target: $", ["planned", "not built", "not yet", "no billing", "does not exist", "none of these"]],
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

  /**
   * Setiap kemunculan frasa berpenanda-wajib diperiksa TERHADAP KARTUNYA SENDIRI,
   * bukan terhadap seluruh halaman. Satu kata "planned" di sudut lain halaman
   * tidak menjadikan target di kartu lain jujur — dan itulah bentuk lolosnya yang
   * sebelumnya terjadi.
   */
  const unqualified = [];
  for (const [needle, qualifiers] of MUST_BE_QUALIFIED) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(needle, from);
      if (at === -1) break;
      from = at + needle.length;
      // Jendela satu kartu: teks sebelum target adalah deskripsinya.
      const around = text.slice(Math.max(0, at - 420), at + 80).toLowerCase();
      if (!qualifiers.some((q) => around.includes(q))) {
        unqualified.push(`"${text.slice(at, at + 46).replace(/\n/g, " ")}" tanpa penanda belum-dibangun`);
      }
    }
  }

  if (hits.length === 0 && clashes.length === 0 && unqualified.length === 0) {
    console.log(`BERSIH   ${route}`);
  } else {
    fail += hits.length + clashes.length + unqualified.length;
    console.log(`MASALAH  ${route}`);
    for (const u of unqualified) console.log(`           - ${u}`);
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
