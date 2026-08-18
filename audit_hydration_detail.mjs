/**
 * Menangkap SELURUH pesan konsol di satu rute, memakai React mode dev supaya
 * pesan hidrasi tidak terminifikasi dan bagian DOM yang berbeda ikut tercetak.
 */
import { chromium } from "playwright";

const URL_ = process.env.URL || "http://127.0.0.1:3101/swap";
const browser = await chromium.launch();
const page = await browser.newPage();

page.on("console", (m) => {
  const t = m.text();
  if (t.includes("Download the React DevTools")) return;
  console.log(`[${m.type()}] ${t.replace(/\s+/g, " ").slice(0, 900)}`);
});
page.on("pageerror", (e) => {
  console.log(`[pageerror] ${String(e.message).replace(/\s+/g, " ").slice(0, 900)}`);
  if (e.stack) console.log(`  stack: ${String(e.stack).replace(/\s+/g, " ").slice(0, 600)}`);
});

await page.goto(URL_, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(9000);
console.log("--- selesai ---");
await browser.close();
