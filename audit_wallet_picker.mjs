/**
 * Menguji pemilih wallet: deteksi banyak wallet (EIP-6963), ganti wallet, ganti
 * akun, putuskan — dan yang paling penting, bahwa permintaan benar-benar dikirim
 * ke provider yang DIPILIH, bukan ke `window.ethereum` pemenang lomba injeksi.
 *
 * Dua wallet palsu disuntik dengan akun berbeda, lalu dicek akun mana yang muncul
 * dan provider mana yang menerima panggilan.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const A = "0x1111111111111111111111111111111111111111"; // MetaMask palsu
const B = "0x2222222222222222222222222222222222222222"; // Rabby palsu

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "LULUS" : "GAGAL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

/**
 * Dua provider EIP-6963 + satu `window.ethereum` legacy yang sengaja dibuat
 * BERBEDA dari keduanya. Kalau aplikasi diam-diam memakai yang legacy, akun yang
 * tampil akan salah dan uji ini menangkapnya.
 */
const SHIM = `
window.__calls = [];
function mk(name, rdns, account) {
  return {
    isMetaMask: rdns === "io.metamask",
    _cbs: {},
    on(ev, cb) { (this._cbs[ev] = this._cbs[ev] || []).push(cb); },
    removeListener() {},
    async request({ method, params }) {
      window.__calls.push(rdns + ":" + method);
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
      if (method === "eth_chainId") return "0x411a";
      if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts" }];
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
      return null;
    },
  };
}
const mm = mk("MetaMask", "io.metamask", "${A}");
const rb = mk("Rabby Wallet", "io.rabby", "${B}");
window.ethereum = mk("Legacy", "legacy.injected", "0x9999999999999999999999999999999999999999");

const announce = () => {
  for (const [info, provider] of [
    [{ uuid: "u-mm", name: "MetaMask", icon: "", rdns: "io.metamask" }, mm],
    [{ uuid: "u-rb", name: "Rabby Wallet", icon: "", rdns: "io.rabby" }, rb],
  ]) {
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
      detail: Object.freeze({ info, provider }),
    }));
  }
};
window.addEventListener("eip6963:requestProvider", announce);
`;

const readWalletUi = (page) =>
  page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const chooser = btns.find((b) => /Choose wallet|Connect wallet/.test(b.textContent || ""));
    const account = btns.find((b) => /0x[0-9a-fA-F]{4}…/.test(b.textContent || ""));
    return {
      chooserLabel: chooser ? chooser.textContent.trim() : null,
      accountLabel: account ? account.textContent.trim().replace(/\s+/g, " ") : null,
      menuItems: [...document.querySelectorAll('[role="menuitem"]')].map((m) => m.textContent.trim()),
      calls: window.__calls ?? [],
    };
  });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
await ctx.addInitScript(SHIM);
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 160)));

console.log("1) deteksi banyak wallet di halaman trading /swap");
await page.goto(`${BASE}/swap`, { waitUntil: "networkidle" });
await page.waitForTimeout(3500);

let ui = await readWalletUi(page);
check("panel trading menampilkan kontrol wallet", ui.chooserLabel !== null, String(ui.chooserLabel));
check("dua wallet terdeteksi -> menawarkan pilihan", /Choose wallet/.test(ui.chooserLabel ?? ""), String(ui.chooserLabel));

const walletControl = page.locator('button:has-text("Choose wallet")').first();
await walletControl.click();
await page.waitForTimeout(700);
ui = await readWalletUi(page);
check("daftar berisi kedua wallet", ui.menuItems.some((t) => /MetaMask/.test(t)) && ui.menuItems.some((t) => /Rabby/.test(t)), ui.menuItems.join(" | "));

console.log("\n2) pilih Rabby -> akun Rabby yang dipakai");
await page.locator('[role="menuitem"]:has-text("Rabby")').first().click();
await page.waitForTimeout(2500);
ui = await readWalletUi(page);
check("alamat yang tampil milik Rabby", (ui.accountLabel ?? "").includes(B.slice(0, 6)), String(ui.accountLabel));
check(
  "permintaan akun dikirim ke provider Rabby",
  ui.calls.some((c) => c === "io.rabby:eth_requestAccounts"),
  ui.calls.filter((c) => c.includes("eth_requestAccounts")).join(", ") || "(tidak ada)"
);
check(
  "provider legacy TIDAK dipakai untuk minta akun",
  !ui.calls.some((c) => c === "legacy.injected:eth_requestAccounts"),
  "window.ethereum harus dilewati saat user memilih wallet"
);

console.log("\n3) ganti wallet ke MetaMask dari menu");
await page.locator(`button:has-text("${B.slice(0, 6)}")`).first().click();
await page.waitForTimeout(700);
ui = await readWalletUi(page);
check("menu menawarkan Switch wallet ke MetaMask", ui.menuItems.some((t) => /MetaMask/.test(t)), ui.menuItems.join(" | "));
check("menu punya Change account", ui.menuItems.some((t) => /Change account/.test(t)), ui.menuItems.join(" | "));
check("menu punya Disconnect", ui.menuItems.some((t) => /Disconnect/.test(t)), ui.menuItems.join(" | "));

await page.locator('[role="menuitem"]:has-text("MetaMask")').first().click();
await page.waitForTimeout(2500);
ui = await readWalletUi(page);
check("alamat berganti ke akun MetaMask", (ui.accountLabel ?? "").includes(A.slice(0, 6)), String(ui.accountLabel));
check(
  "permintaan akun dikirim ke provider MetaMask",
  ui.calls.some((c) => c === "io.metamask:eth_requestAccounts"),
  "provider yang menerima panggilan harus mengikuti pilihan"
);

console.log("\n4) ganti akun memakai pemilih akun wallet");
await page.locator(`button:has-text("${A.slice(0, 6)}")`).first().click();
await page.waitForTimeout(600);
await page.locator('[role="menuitem"]:has-text("Change account")').first().click();
await page.waitForTimeout(1800);
ui = await readWalletUi(page);
check(
  "wallet_requestPermissions dipanggil (bukan eth_requestAccounts)",
  ui.calls.some((c) => c === "io.metamask:wallet_requestPermissions"),
  "eth_requestAccounts tidak memberi kesempatan berganti akun"
);

console.log("\n5) putuskan lalu pilih lagi");
await page.locator(`button:has-text("${A.slice(0, 6)}")`).first().click();
await page.waitForTimeout(600);
await page.locator('[role="menuitem"]:has-text("Disconnect")').first().click();
await page.waitForTimeout(1500);
ui = await readWalletUi(page);
check("kembali menawarkan pilihan wallet", /Choose wallet/.test(ui.chooserLabel ?? ""), String(ui.chooserLabel));
check("alamat tidak lagi ditampilkan", ui.accountLabel === null, String(ui.accountLabel));

console.log("\n6) kontrol wallet di terminal token");
const proj = await page.evaluate(async () => {
  const r = await fetch("/api/graphql", { method: "POST" });
  const j = await r.json();
  return (j.data.projects || [])[0] ?? null;
});
if (proj) {
  await page.goto(`${BASE}/token/${String(proj.symbol).toLowerCase()}?chain=${proj.chainId}`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(3000);

  // Saat BELUM tersambung, strip "Trading wallet" sengaja tidak ditampilkan:
  // tombol di navbar dan CTA utama sudah menjadi ajakan yang sama, dan tiga CTA
  // identik dalam satu layar hanya membingungkan.
  check(
    "belum tersambung: tidak ada strip wallet ganda",
    (await page.locator("text=Trading wallet").count()) === 0,
    "hanya kontrol di navbar yang tampil"
  );
  check(
    "belum tersambung: tetap ada cara memilih wallet",
    (await page.locator('button:has-text("Choose wallet")').count()) > 0
  );

  // Sesudah tersambung, strip HARUS muncul — inilah cara mengganti wallet tanpa
  // meninggalkan halaman trading.
  await page.locator('button:has-text("Choose wallet")').first().click();
  await page.waitForTimeout(700);
  await page.locator('[role="menuitem"]:has-text("Rabby")').first().click();
  await page.waitForTimeout(3000);
  check(
    "sudah tersambung: strip 'Trading wallet' muncul di terminal",
    (await page.locator("text=Trading wallet").count()) > 0
  );
  check(
    "sudah tersambung: alamat Rabby tampil di terminal",
    (await page.locator(`button:has-text("${B.slice(0, 6)}")`).count()) > 0
  );
}

check("tidak ada page error", errs.length === 0, errs.join(" | "));
console.log(`\n  ${pass} LULUS / ${fail} GAGAL`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
