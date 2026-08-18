/**
 * Memastikan tautan LAMA tetap berfungsi setelah identitas market berubah
 * menjadi (chainId, symbol). Tautan yang sudah tersebar hanya membawa
 * ?token=SYMBOL tanpa ?chain=, jadi fallback-nya wajib benar.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "LULUS" : "GAGAL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const readSelect = (page) =>
  page.evaluate(() => {
    const s = [...document.querySelectorAll("select")].find((x) =>
      [...x.options].some((o) => (o.textContent || "").trim().startsWith("$"))
    );
    if (!s) return null;
    const opt = [...s.options].find((o) => o.value === s.value);
    return { value: s.value, label: (opt?.textContent || "").trim() };
  });

const browser = await chromium.launch();
const page = await browser.newPage();

console.log("1) href yang dihasilkan explorer");
await page.goto(`${BASE}/explorer`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const hrefs = await page.evaluate(() =>
  [...document.querySelectorAll('a[href*="/swap?token="]')].map((a) => a.getAttribute("href")).slice(0, 5)
);
hrefs.forEach((h) => console.log(`    ${h}`));
check("tombol Swap membawa ?token=", hrefs.every((h) => h.includes("?token=")), `${hrefs.length} tautan`);
check("tombol Swap juga memaku chain (&chain=)", hrefs.every((h) => /[?&]chain=\d+/.test(h)), "mencegah salah chain");

const symbols = await page.evaluate(() =>
  [...document.querySelectorAll('a[href*="/swap?token="]')]
    .map((a) => new URL(a.href).searchParams.get("token"))
    .filter(Boolean)
);
const multi = symbols.find((s) => symbols.filter((x) => x === s).length > 1);
const single = symbols.find((s) => symbols.filter((x) => x === s).length === 1);

console.log("\n2) tautan LAMA tanpa ?chain= (kompatibilitas ke belakang)");
for (const [kind, sym] of [
  ["symbol satu chain", single],
  ["symbol banyak chain", multi],
]) {
  if (!sym) {
    console.log(`    (tidak ada contoh untuk ${kind})`);
    continue;
  }
  await page.goto(`${BASE}/swap?token=${sym}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);
  const sel = await readSelect(page);
  check(
    `${kind}: /swap?token=${sym} tetap memilih market $${sym}`,
    Boolean(sel && sel.value.endsWith(`:${sym}`)),
    sel ? `${sel.value} · ${sel.label}` : "tidak ada market terpilih"
  );
}

console.log("\n3) ?chain= yang tidak cocok tidak boleh memilih market chain lain diam-diam");
if (multi) {
  await page.goto(`${BASE}/swap?token=${multi}&chain=999999`, { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);
  const sel = await readSelect(page);
  check(
    `chain tak dikenal -> tetap jatuh ke market $${multi} yang valid`,
    Boolean(sel && sel.value.endsWith(`:${multi}`)),
    sel ? sel.value : "kosong"
  );
}

console.log(`\n  ${pass} LULUS / ${fail} GAGAL`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
