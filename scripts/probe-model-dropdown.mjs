/**
 * Bukti dropdown model 0G benar-benar bisa DIFILMKAN dan tetap bisa dipakai keyboard.
 *
 * Kenapa perlu: kontrol ini dulu `<select>` native, dan popup select native digambar
 * browser/OS di luar permukaan halaman — mengkliknya menambah 0 node DOM dan `<option>`
 * -nya berkotak 0x0 bahkan saat terbuka, jadi ia tidak pernah ikut terekam screencast.
 * Penggantinya harus dibuktikan tidak mengulangi itu, DAN tidak kehilangan aksesibilitas
 * yang tadinya didapat gratis dari elemen native.
 *
 * Pakai: BASE_URL=http://127.0.0.1:3100 node scripts/probe-model-dropdown.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  LULUS  ${label}`);
  } else {
    fail++;
    console.log(`  GAGAL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${BASE}/studio`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);

const btn = page.locator('button[aria-label="0G model"]').first();
const list = page.locator('[role="listbox"][aria-label="0G model"]').first();

check("tidak ada <select> native lagi", (await page.locator("select").count()) === 0);
check("tombol dropdown ada", (await btn.count()) === 1);
check("aria-expanded mula-mula false", (await btn.getAttribute("aria-expanded")) === "false");

const labelBefore = ((await btn.textContent()) ?? "").replace(/\s+/g, " ").trim();
console.log(`  label awal: ${labelBefore}`);

console.log("\n1) TERFILMKAN — menu harus punya kotak layout di dalam halaman");
const nodesBefore = await page.evaluate(() => document.querySelectorAll("*").length);
await btn.click();
await list.waitFor({ state: "visible", timeout: 8000 });
const nodesAfter = await page.evaluate(() => document.querySelectorAll("*").length);
check("membuka menu MENAMBAH node DOM", nodesAfter > nodesBefore, `${nodesBefore} -> ${nodesAfter}`);
check("aria-expanded jadi true", (await btn.getAttribute("aria-expanded")) === "true");

const box = await list.boundingBox();
check("menu punya kotak layout bukan nol", Boolean(box && box.width > 0 && box.height > 0), JSON.stringify(box));

const optBoxes = [];
for (const o of await list.locator('[role="option"]').all()) optBoxes.push(await o.boundingBox());
check("ketiga option punya kotak layout", optBoxes.length === 3 && optBoxes.every((b) => b && b.width > 0 && b.height > 0), `${optBoxes.length} option`);
const texts = (await list.locator('[role="option"]').allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
console.log(`  option: ${texts.join(" · ")}`);
check("ketiganya model 0G", texts.length === 3 && texts.every((t) => /0G/.test(t)), texts.join(" | "));
check("tepat satu option aria-selected", (await list.locator('[role="option"][aria-selected="true"]').count()) === 1);

console.log("\n2) ESCAPE MENUTUP — jalur yang dipakai perekam");
await page.keyboard.press("Escape");
await list.waitFor({ state: "hidden", timeout: 8000 });
check("menu tertutup setelah Escape", (await list.count()) === 0 || !(await list.isVisible()));
check("aria-expanded kembali false", (await btn.getAttribute("aria-expanded")) === "false");
const labelAfterEsc = ((await btn.textContent()) ?? "").replace(/\s+/g, " ").trim();
check("Escape TIDAK mengubah model terpilih", labelAfterEsc === labelBefore, `${labelBefore} -> ${labelAfterEsc}`);

console.log("\n3) KLIK DI LUAR MENUTUP");
await btn.click();
await list.waitFor({ state: "visible", timeout: 8000 });
await page.mouse.click(20, 400);
await list.waitFor({ state: "hidden", timeout: 8000 }).catch(() => {});
check("menu tertutup setelah klik di luar", (await list.count()) === 0 || !(await list.isVisible()));

console.log("\n4) MEMILIH MODEL BENAR-BENAR BEKERJA");
await btn.click();
await list.waitFor({ state: "visible", timeout: 8000 });
await list.locator('[role="option"]').nth(2).locator("button").click();
await list.waitFor({ state: "hidden", timeout: 8000 }).catch(() => {});
const labelPicked = ((await btn.textContent()) ?? "").replace(/\s+/g, " ").trim();
check("label berubah ke model ketiga", labelPicked !== labelBefore, `${labelBefore} -> ${labelPicked}`);
check("memilih ikut menutup menu", (await list.count()) === 0 || !(await list.isVisible()));

console.log("\n5) KEYBOARD — panah membuka lalu memindah pilihan");
await btn.focus();
await page.keyboard.press("ArrowDown");
await list.waitFor({ state: "visible", timeout: 8000 });
check("ArrowDown pada tombol membuka menu", await list.isVisible());
await page.locator('[role="listbox"][aria-label="0G model"]').first().focus();
const beforeArrow = ((await btn.textContent()) ?? "").replace(/\s+/g, " ").trim();
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(220);
const afterArrow = ((await btn.textContent()) ?? "").replace(/\s+/g, " ").trim();
check("ArrowDown memindah pilihan", afterArrow !== beforeArrow, `${beforeArrow} -> ${afterArrow}`);
await page.keyboard.press("Escape");

check("tidak ada galat halaman", errors.length === 0, errors.join(" | "));

await browser.close();
console.log(`\n  ringkasan: ${pass} lulus · ${fail} gagal`);
process.exit(fail === 0 ? 0 : 1);
