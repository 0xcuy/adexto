/**
 * Membandingkan HTML yang dikirim server dengan DOM setelah hidrasi, lalu
 * mencetak potongan teks pertama yang berbeda. Dipakai untuk memburu #418
 * yang hanya muncul di build produksi.
 */
import { chromium } from "playwright";

const URL_ = process.env.URL || "http://127.0.0.1:3100/swap";

const res = await fetch(URL_);
const serverHtml = await res.text();

const strip = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 160)));
await page.goto(URL_, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(1200);
const clientHtml = await page.content();

const a = strip(serverHtml);
const b = strip(clientHtml);

console.log(`server: ${a.length} potongan teks | klien: ${b.length} potongan teks`);
console.log(`pageerror: ${errs.length ? errs.join(" | ") : "(tidak ada)"}\n`);

// Cari potongan teks yang ada di server tapi hilang di klien, dan sebaliknya.
const setB = new Set(b);
const setA = new Set(a);
const hilang = a.filter((s) => !setB.has(s)).slice(0, 20);
const tambahan = b.filter((s) => !setA.has(s)).slice(0, 20);

console.log("ADA DI SERVER, TIDAK ADA DI KLIEN:");
hilang.forEach((s) => console.log(`  - ${s.slice(0, 120)}`));
console.log("\nADA DI KLIEN, TIDAK ADA DI SERVER:");
tambahan.forEach((s) => console.log(`  + ${s.slice(0, 120)}`));

await browser.close();
