/**
 * Mengukur berapa lama studio "melamun" setiap kali chain diklik.
 *
 * KENAPA MENGUKUR DAN BUKAN MELIHAT
 *
 * Keluhannya "ngelamun di monad lama banget balik ke 0G nya". Dugaan pertama saya salah:
 * saya sangka latensi RPC Monad, padahal Monad justru RPC tercepat dari keempatnya
 * (0,068 s vs 0G 0,29 s). Jadi yang diukur di sini bukan jaringan, melainkan yang
 * sebenarnya dilihat pengguna: berapa lama panel jatuh ke status "checking" setelah
 * satu klik, dan berapa banyak permintaan jaringan yang dipicu klik itu.
 *
 * Yang dihitung:
 *   - waktu sampai indikator "checking" hilang setelah klik (nol berarti tidak pernah
 *     muncul, yaitu keadaan yang diinginkan);
 *   - jumlah permintaan ke /api/deploy yang dipicu KLIK itu sendiri.
 *
 * Pakai: BASE_URL=http://127.0.0.1:3100 node scripts/measure-chain-switch.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const ORDER = (process.env.CHAIN_ORDER || "Base,Arbitrum,Monad,0G").split(",").map((s) => s.trim());

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

/** Permintaan availability dihitung supaya "nol jaringan per klik" bisa dibuktikan. */
let deployCalls = [];
page.on("request", (r) => {
  const u = r.url();
  if (u.includes("/api/deploy")) deployCalls.push(u);
});

await page.goto(`${BASE}/studio`, { waitUntil: "networkidle", timeout: 120000 });

// Ticker harus terisi, kalau tidak pemeriksaan ketersediaan tidak pernah berjalan dan
// pengukurannya jadi tidak ada artinya. Selectornya disamakan dengan perekam yang sudah
// bekerja: field ini punya nilai bawaan "AQUANT", bukan placeholder.
const tickerField = page.locator('input[value="AQUANT"]').first();
await tickerField.fill("NOVA777");
await page.waitForTimeout(1800); // biarkan pengambilan karena KETIKAN selesai lebih dulu

const CHECKING = page.locator('text=/checking/i');

async function settleMs(label) {
  const t0 = Date.now();
  // Kalau indikator tidak pernah muncul, inilah hasil terbaiknya: nol.
  try {
    await CHECKING.first().waitFor({ state: "visible", timeout: 120 });
  } catch {
    return 0;
  }
  await CHECKING.first().waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
  return Date.now() - t0;
}

console.log(`\n  target: ${BASE}`);
console.log(`  urutan klik: ${ORDER.join(" -> ")}\n`);

const rows = [];
for (const name of ORDER) {
  // `button[title*=…]`, sama seperti perekam: label tombolnya bukan nama chain-nya.
  const btn = page.locator(`button[title*="${name}"]`).first();
  if ((await btn.count()) === 0) {
    console.log(`  LEWAT  ${name}: tombol tidak ditemukan`);
    continue;
  }
  deployCalls = [];
  await btn.click();
  const ms = await settleMs(name);
  rows.push({ name, ms, calls: deployCalls.length });
  console.log(`  ${String(name).padEnd(10)} melamun ${String(ms).padStart(5)} ms · ${deployCalls.length} permintaan /api/deploy`);
  await page.waitForTimeout(250);
}

const worst = rows.reduce((a, b) => (b.ms > a.ms ? b : a), { ms: -1, name: "-" });
const totalCalls = rows.reduce((n, r) => n + r.calls, 0);
console.log(`\n  terburuk: ${worst.name} ${worst.ms} ms`);
console.log(`  total permintaan availability akibat ${rows.length} klik: ${totalCalls}`);
console.log(`  chain terakhir: ${ORDER[ORDER.length - 1]}\n`);

await ctx.close();
await browser.close();
