/**
 * Sapuan visual: memotret setiap rute pada dua lebar layar, dan sekaligus
 * melaporkan cacat tampilan yang bisa dideteksi mesin —
 *   - overflow horizontal (halaman bisa digeser ke samping)
 *   - teks terpotong (scrollWidth > clientWidth pada elemen teks)
 *   - notasi eksponensial yang lolos ke layar ("1.2e-10")
 *   - sisa bahasa Indonesia di UI
 *   - kontras teks yang terlalu rendah untuk dibaca
 */
import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const OUT = process.env.SHOT_DIR || "/tmp/adexto-shots";
const ROUTES = (
  process.env.ROUTES || "/,/studio,/swap,/explorer,/docs,/pitch,/governance,/whitepaper,/agent/demo"
).split(",");
const WIDTHS = [
  { w: 1600, h: 1000, tag: "desktop" },
  { w: 390, h: 844, tag: "mobile" },
];

/** Frasa Indonesia yang tidak boleh ada di UI berbahasa Inggris. */
/**
 * Dicocokkan tanpa peduli huruf besar/kecil: teks berhuruf besar seperti
 * "MARKET TERPISAH PER CHAIN" pernah lolos dari daftar yang case-sensitive.
 */
const ID_WORDS = [
  "juga di", "belum ada", "dilewati", "terkunci permanen", "cara kerja", "yang perlu",
  "siapkan", "gagal sendiri", "harga sendiri", "diluncurkan di", "lihat semua",
  "sudah punya", "terpisah", "pilih 1", "tiap chain", "setiap chain yang",
  "bisa berbeda", "tanpa mengganggu", "akan gagal",
];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
let issues = 0;

for (const vp of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 120)));

  for (const route of ROUTES) {
    const name = route === "/" ? "home" : route.replace(/\//g, "_").replace(/^_/, "");
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(2600);
    } catch {
      console.log(`GAGAL MUAT  ${vp.tag} ${route}`);
      issues++;
      continue;
    }

    const report = await page.evaluate((idWords) => {
      const doc = document.documentElement;
      const overflowX = doc.scrollWidth - doc.clientWidth;

      const clipped = [];
      for (const el of document.querySelectorAll("h1,h2,h3,p,span,div,button,a,td,th,label,option")) {
        if (el.children.length > 0) continue;
        const t = (el.textContent || "").trim();
        if (!t) continue;
        if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
          const s = getComputedStyle(el);
          // `truncate` memang sengaja memotong dengan ellipsis; itu bukan cacat.
          if (s.textOverflow !== "ellipsis" && s.overflow !== "hidden") {
            clipped.push(t.slice(0, 60));
          }
        }
      }

      const body = document.body.innerText;
      const lower = body.toLowerCase();
      const expo = body.match(/\d\.\d+e[-+]\d+/g) || [];
      const indo = idWords.filter((w) => lower.includes(w));

      // Kontras rendah: teks abu di atas latar gelap.
      const faint = [];
      for (const el of document.querySelectorAll("p,span,div,li")) {
        if (el.children.length > 0) continue;
        const t = (el.textContent || "").trim();
        if (t.length < 8) continue;
        const s = getComputedStyle(el);
        const m = s.color.match(/\d+/g);
        if (!m) continue;
        const [r, g, b] = m.map(Number);
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (lum < 78) faint.push(`${t.slice(0, 40)} (lum ${Math.round(lum)})`);
      }

      return { overflowX, clipped: clipped.slice(0, 6), expo: [...new Set(expo)].slice(0, 6), indo, faint: faint.slice(0, 5) };
    }, ID_WORDS);

    await page.screenshot({ path: path.join(OUT, `${vp.tag}-${name}.png`), fullPage: vp.tag === "desktop" });

    const problems = [];
    if (report.overflowX > 2) problems.push(`overflow-x ${report.overflowX}px`);
    if (report.clipped.length) problems.push(`teks terpotong: ${report.clipped.join(" | ")}`);
    if (report.expo.length) problems.push(`notasi eksponensial: ${report.expo.join(", ")}`);
    if (report.indo.length) problems.push(`bahasa Indonesia: ${report.indo.join(", ")}`);
    if (report.faint.length) problems.push(`kontras rendah: ${report.faint.length} elemen`);
    if (errs.length) problems.push(`pageerror: ${errs.length}`);

    if (problems.length === 0) {
      console.log(`BERSIH   ${vp.tag.padEnd(7)} ${route}`);
    } else {
      issues += problems.length;
      console.log(`MASALAH  ${vp.tag.padEnd(7)} ${route}`);
      problems.forEach((p) => console.log(`           - ${p}`));
    }
    errs.length = 0;
  }
  await ctx.close();
}

console.log(`\n  total temuan: ${issues}`);
console.log(`  tangkapan layar: ${OUT}`);
await browser.close();
