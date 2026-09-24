#!/usr/bin/env node
/**
 * Menu navbar harus benar-benar TERBUKA, di desktop maupun ponsel.
 *
 * KENAPA SKRIP INI ADA
 *
 * Saya pernah menggabungkan switcher chain dan tombol dompet menjadi satu segmented control
 * dan memberi wadahnya `overflow-hidden` agar sudut segmennya terpotong rapi. Itu memotong
 * panel dropdown kedua anaknya juga — keduanya diposisikan absolut di dalam wrapper
 * masing-masing — sehingga menekan chain atau alamat dompet membuka panel yang terpangkas
 * menjadi sepotong setinggi 31px. Kedua kontrol praktis tidak bisa dipakai, dan itu lolos ke
 * produksi karena seluruh pemeriksaan saya hanya memotret keadaan TERTUTUP.
 *
 * Yang diperiksa di sini adalah tinggi panel setelah diklik, bukan keberadaannya: panel yang
 * terpangkas tetap ada di DOM dan tetap dilaporkan visible oleh Playwright, jadi
 * `isVisible()` tidak akan pernah menangkap kelas bug ini.
 *
 *   npx next start -p 3199   (atau server lain)
 *   BASE_URL=http://127.0.0.1:3199 node scripts/check-navbar-menus.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3199";
/**
 * Dompet TIRUAN, sebab tanpa alamat yang tersambung navbar hanya memperlihatkan tombol
 * Connect — jadi bagian yang rusak tidak akan pernah dirender. Provider ini diumumkan lewat
 * EIP-6963, jalur penemuan yang memang dipakai aplikasi.
 */
const ADDR = "0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D";
let fail = 0;
const check = (l, pass, d = "") => { if (!pass) fail++; console.log(`${pass ? "OK  " : "GAGAL"}  ${l}${d ? ` — ${d}` : ""}`); };

const stub = ({ addr }) => {
  const provider = {
    request: async ({ method }) => {
      if (method === "eth_chainId") return "0x4115";
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [addr];
      return null;
    },
    on: () => {}, removeListener: () => {},
  };
  window.ethereum = provider;
  const detail = Object.freeze({ info: { uuid: "u1", name: "Injected Wallet", rdns: "dev.probe", icon: "" }, provider });
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
  try { localStorage.setItem("adexto:wallet:rdns", "dev.probe"); localStorage.setItem("adexto:wallet:connected", "1"); } catch {}
};

for (const width of [1440, 420]) {
  console.log(`\n── viewport ${width} ──`);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  await p.addInitScript(stub, { addr: ADDR });
  await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1800);

  if (width === 420) {
    await p.locator('button[aria-label="Toggle Mobile Menu"]').click();
    await p.waitForTimeout(500);
  }

  // Panel chain.
  // `:visible` penting: di 1440 ada dua tombol dompet di DOM — satu grouped yang tampil dan
  // satu solo yang disembunyikan `sm:hidden`. `.last()` memilih yang tersembunyi lalu klik-nya
  // menggantung sampai timeout. Hal yang sama berlaku untuk switcher di drawer.
  const chainBtn = p.locator("button[aria-label^='Network:']:visible").first();
  await chainBtn.click();
  await p.waitForTimeout(500);
  const list = p.locator('[role="listbox"]').first();
  const lb = await list.boundingBox().catch(() => null);
  check("panel chain terbuka", Boolean(lb));
  check("panel chain tidak terpangkas", lb ? lb.height > 200 : false, lb ? `tinggi ${Math.round(lb.height)}px` : "tidak ada");
  check("isi panel chain terbaca", /Each chain is a separate market/.test(await list.innerText().catch(() => "")));
  await p.screenshot({ path: `/tmp/navbar-chain-${width}.png`, clip: { x: 0, y: 0, width, height: Math.min(560, 900) } });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);

  // Panel dompet.
  const walletBtn = p.locator('button[title="Wallet options"]:visible').first();
  await walletBtn.click();
  await p.waitForTimeout(500);
  const menu = p.locator('[role="menu"]').first();
  const mb = await menu.boundingBox().catch(() => null);
  check("panel dompet terbuka", Boolean(mb));
  check("panel dompet tidak terpangkas", mb ? mb.height > 120 : false, mb ? `tinggi ${Math.round(mb.height)}px` : "tidak ada");
  const mt = await menu.innerText().catch(() => "");
  check("isi panel dompet terbaca", /0x8a3c|Disconnect|Copy/i.test(mt), mt.replace(/\n/g, " ").slice(0, 60));
  await p.screenshot({ path: `/tmp/navbar-wallet-${width}.png`, clip: { x: 0, y: 0, width, height: Math.min(560, 900) } });

  await b.close();
}

console.log(fail ? `\n${fail} GAGAL` : "\nsemua lolos");
process.exit(fail ? 1 : 0);
