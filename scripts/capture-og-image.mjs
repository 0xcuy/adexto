/**
 * Kartu OpenGraph — gambar yang muncul saat tautan adexto.xyz dibagikan.
 *
 * KENAPA DIBUAT
 *
 * Aplikasi ini sama sekali tidak punya metadata `openGraph`, jadi setiap tautan
 * yang dibagikan ke X, Discord, atau Telegram muncul sebagai pratinjau kosong.
 * Developer Portal World ID juga meminta "Meta tag image" untuk keperluan yang
 * sama persis, jadi satu desain melayani keduanya.
 *
 * KENAPA DUA UKURAN
 *
 * Portal menuntut tepat 1113x557 (rasio 2:1). Pratinjau tautan di web memakai
 * 1200x630 (1,91:1). Keduanya dibuat dari desain yang sama, dan ukuran huruf
 * diskalakan dari lebar supaya proporsinya tetap — bukan dipotong, karena
 * memotong akan memakan barisan fakta di bawah.
 *
 * Font Geist DISEMATKAN dari node_modules, bukan diambil dari jaringan, supaya
 * kartunya identik dengan tipografi situs dan tetap bisa dibuat tanpa internet.
 *
 * Pakai: node scripts/capture-og-image.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const SHOWCASE_DIR = path.join(ROOT, "public", "showcase");
/** Batas unggah portal. Diperiksa di sini, bukan diserahkan ke penolakan unggahan. */
const MAX_KB = 500;

const TARGETS = [
  // Ukuran yang diminta Developer Portal, harus persis.
  { width: 1113, height: 557, out: path.join(SHOWCASE_DIR, "meta-og-1113x557.png"), label: "portal World ID" },
  // Standar pratinjau tautan web, dipakai metadata situs.
  { width: 1200, height: 630, out: path.join(ROOT, "public", "og.png"), label: "metadata situs" },
];

const b64 = (p) => fs.readFileSync(p).toString("base64");
const sans = b64(path.join(ROOT, "node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2"));
const mono = b64(path.join(ROOT, "node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2"));
const logo = b64(path.join(ROOT, "public/logo.svg"));

/**
 * Semua ukuran diturunkan dari lebar, dengan 1200 sebagai acuan. Jadi satu desain
 * menghasilkan dua berkas yang proporsinya sama, tanpa angka yang di-hardcode dua
 * kali dan bisa lupa disamakan.
 */
const buildHtml = (width, height) => {
  const s = width / 1200;
  const px = (n) => `${(n * s).toFixed(1)}px`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: "GeistSans"; src: url(data:font/woff2;base64,${sans}) format("woff2"); font-weight: 100 900; }
  @font-face { font-family: "GeistMono"; src: url(data:font/woff2;base64,${mono}) format("woff2"); font-weight: 100 900; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${width}px; height: ${height}px; background: #04060a; color: #f1f5f9;
    font-family: "GeistSans", sans-serif; position: relative; overflow: hidden;
  }
  /* Cahaya latar mengikuti palet situs: cyan dan ungu di atas hitam kebiruan. */
  .glow-a { position: absolute; width: ${px(700)}; height: ${px(700)}; left: ${px(-180)}; top: ${px(-260)};
    background: radial-gradient(circle, rgba(0,245,255,0.16), transparent 62%); }
  .glow-b { position: absolute; width: ${px(760)}; height: ${px(760)}; right: ${px(-220)}; bottom: ${px(-320)};
    background: radial-gradient(circle, rgba(124,58,237,0.20), transparent 62%); }
  .grid { position: absolute; inset: 0; opacity: 0.35;
    background-image: linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
                      linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px);
    background-size: ${px(48)} ${px(48)}; }
  .wrap { position: relative; height: 100%; padding: ${px(56)} ${px(68)};
    display: flex; flex-direction: column; justify-content: space-between; }
  .top { display: flex; align-items: center; gap: ${px(20)}; }
  .top img { width: ${px(78)}; height: ${px(78)}; }
  .name { font-size: ${px(54)}; font-weight: 800; letter-spacing: -0.03em; }
  .badge { font-family: "GeistMono", monospace; font-size: ${px(14)}; font-weight: 700; letter-spacing: 0.14em;
    color: #67e8f9; border: 1px solid rgba(103,232,249,0.42); border-radius: 999px; padding: ${px(7)} ${px(15)}; }
  h1 { font-size: ${px(50)}; line-height: 1.09; font-weight: 750; letter-spacing: -0.032em; max-width: ${px(1010)}; }
  /* white-space nowrap menjaga "no liquidity deposit" tetap satu potongan. Tanpa
     itu frasa inti terpecah jadi "with no" lalu "liquidity deposit", dan
     kalimatnya kehilangan tekanan justru di bagian yang paling ingin dibaca.
     Catatan: JANGAN pakai backtick di komentar ini — isi berkas ini adalah
     template literal, dan backtick akan mengakhirinya di tengah CSS. */
  h1 em { font-style: normal; color: #67e8f9; white-space: nowrap; }
  .facts { display: flex; gap: ${px(13)}; font-family: "GeistMono", monospace; font-size: ${px(16)}; font-weight: 600; }
  .fact { border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.035);
    border-radius: ${px(14)}; padding: ${px(13)} ${px(18)}; color: #cbd5e1; white-space: nowrap; }
  .fact b { color: #ffffff; font-weight: 750; }
  .foot { display: flex; align-items: center; justify-content: space-between;
    font-family: "GeistMono", monospace; font-size: ${px(17)}; color: #94a3b8; }
  .chains { color: #a5b4fc; }
</style></head><body>
  <div class="glow-a"></div><div class="glow-b"></div><div class="grid"></div>
  <div class="wrap">
    <div class="top">
      <img src="data:image/svg+xml;base64,${logo}" />
      <div class="name">ADEXTO</div>
      <div class="badge">SOVEREIGN BONDING CURVE</div>
    </div>

    <h1>Launch an AI agent token<br/>with <em>no liquidity deposit</em>. Gas only.</h1>

    <div class="facts">
      <div class="fact"><b>100%</b> of supply in the curve</div>
      <div class="fact"><b>0.10%</b> of every swap to the creator</div>
      <div class="fact"><b>World ID</b> verified humans</div>
    </div>

    <div class="foot">
      <span>adexto.xyz</span>
      <span class="chains">0G · Base · Arbitrum · Monad</span>
    </div>
  </div>
</body></html>`;
};

fs.mkdirSync(SHOWCASE_DIR, { recursive: true });
const browser = await chromium.launch();
/** Dipisah supaya pesan galatnya menunjuk sebab yang benar. */
let over = 0; // melewati batas ukuran berkas
let broken = 0; // cacat tata letak

for (const t of TARGETS) {
  const page = await browser.newPage({ viewport: { width: t.width, height: t.height }, deviceScaleFactor: 1 });
  await page.setContent(buildHtml(t.width, t.height), { waitUntil: "load" });
  // Font tersemat butuh satu putaran render sebelum tangkapan, kalau tidak
  // hurufnya keluar dengan font pengganti.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);

  /**
   * Ukur pemenggalan barisnya, jangan dinilai dengan mata.
   *
   * Frasa inti "no liquidity deposit" pernah terpecah antar baris tanpa ada yang
   * sadar, karena satu-satunya cara memeriksanya adalah menatap gambar. Jumlah
   * kotak yang ditempati elemen <em> menjawabnya secara pasti: lebih dari satu
   * berarti frasanya terbelah.
   */
  const layout = await page.evaluate(() => {
    const em = document.querySelector("h1 em");
    const h1 = document.querySelector("h1");
    const foot = document.querySelector(".foot");
    const lineHeight = parseFloat(getComputedStyle(h1).lineHeight);
    return {
      emLines: em ? em.getClientRects().length : 0,
      h1Lines: Math.round(h1.getBoundingClientRect().height / lineHeight),
      // Diukur dari baris TERAKHIR isi, bukan dari scrollHeight body.
      // scrollHeight ikut menghitung .glow-a/.glow-b yang memang sengaja keluar
      // bidang sebagai hiasan, jadi memakainya melaporkan terpotong padahal tidak.
      footBottom: foot ? Math.round(foot.getBoundingClientRect().bottom) : 0,
      canvasHeight: window.innerHeight,
    };
  });

  await page.screenshot({ path: t.out });
  await page.close();

  if (layout.emLines !== 1) {
    console.log(`  CACAT frasa inti terbelah ${layout.emLines} baris pada ${t.width}x${t.height}`);
    broken++;
  }
  if (layout.footBottom > layout.canvasHeight) {
    console.log(
      `  CACAT isi terpotong pada ${t.width}x${t.height}: baris terakhir berakhir di ${layout.footBottom}px, kanvas ${layout.canvasHeight}px`
    );
    broken++;
  }
  console.log(`     judul ${layout.h1Lines} baris · frasa inti utuh · baris terakhir ${layout.footBottom}/${layout.canvasHeight}px`);

  const kb = fs.statSync(t.out).size / 1024;
  if (kb > MAX_KB) over++;
  console.log(
    `  ${path.relative(ROOT, t.out).padEnd(38)} ${String(t.width) + "x" + t.height} ${kb.toFixed(0).padStart(4)} KB  ` +
      `${kb > MAX_KB ? `MELEBIHI ${MAX_KB} KB` : "aman"}  (${t.label})`
  );
}

await browser.close();
if (over > 0) console.log(`\n${over} berkas melewati batas ${MAX_KB} KB`);
if (broken > 0) console.log(`${broken} cacat tata letak`);
process.exit(over + broken > 0 ? 1 : 0);
