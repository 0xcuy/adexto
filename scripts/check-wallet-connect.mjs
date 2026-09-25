#!/usr/bin/env node
/**
 * Setiap tombol Connect harus benar-benar bisa menyambungkan, TERMASUK saat beberapa wallet
 * terpasang.
 *
 * KENAPA SKRIP INI ADA
 *
 * `getActiveEip1193()` sengaja mengembalikan null ketika beberapa wallet terdeteksi dan belum
 * ada yang dipilih, supaya aplikasi tidak diam-diam memakai pemenang lomba injeksi. Yang
 * terlewat: hanya WalletMenu di navbar yang tahu cara MENANYAKAN. Lima tombol Connect lain
 * memanggil `connectWallet()` tanpa rdns, jatuh ke cabang "tidak ada provider", dan menampilkan
 *
 *     "No Web3 wallet detected. Install MetaMask, Rabby or Coinbase Wallet to continue."
 *
 * kepada orang yang memasang DUA wallet. Terukur sebelum perbaikan: di /swap, /studio,
 * /agent-compute dan halaman token, `eth_requestAccounts` tidak pernah dipanggil sekali pun.
 *
 * Ini lolos ke produksi karena setiap pemeriksaan wallet sebelumnya menyuntik SATU wallet, dan
 * dengan satu wallet jalur ini memang benar. Jadi yang diperiksa di sini adalah jumlah wallet
 * sebagai variabel, bukan sebagai asumsi.
 *
 *   BASE_URL=http://127.0.0.1:3199 node scripts/check-wallet-connect.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3199";
const ADDR = "0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D";

let fail = 0;
const check = (label, pass, detail = "") => {
  if (!pass) fail++;
  console.log(`${pass ? "OK   " : "GAGAL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

/**
 * Menyuntik N wallet EIP-6963.
 *
 * `eth_accounts` mengembalikan [] sampai `eth_requestAccounts` dipanggil, supaya halaman TIDAK
 * tampil tersambung sendiri. Shim yang selalu mengembalikan alamat membuat tombol Connect tidak
 * pernah dirender, dan pemeriksaan jadi lulus tanpa menguji apa pun.
 */
const stub = ({ addr, names }) => {
  window.__rpcCalls = [];
  window.__granted = false;
  const make = (name, rdns) => ({
    info: { uuid: rdns, name, rdns, icon: "" },
    provider: {
      isMetaMask: name === "MetaMask",
      request: async ({ method }) => {
        window.__rpcCalls.push(`${rdns}:${method}`);
        if (method === "eth_chainId") return "0x4115";
        if (method === "eth_requestAccounts") {
          window.__granted = true;
          return [addr];
        }
        if (method === "eth_accounts") return window.__granted ? [addr] : [];
        if (method === "wallet_requestPermissions") return [];
        return null;
      },
      on: () => {},
      removeListener: () => {},
    },
  });
  const list = names.map((n, i) => make(n, `probe.wallet${i}.${n.toLowerCase()}`));
  // window.ethereum = pemenang lomba injeksi, seperti di dunia nyata.
  if (list.length) window.ethereum = list[0].provider;
  const announce = () =>
    list.forEach((d) => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze(d) })));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
  try {
    localStorage.setItem("adexto_cookie_choice", "essential");
  } catch {}
};

/** Halaman yang punya tombol Connect sendiri, di luar navbar. */
const ROUTES = ["/agent-compute", "/swap", "/token/adexto?chain=16661", "/studio"];

const browser = await chromium.launch();

for (const names of [["MetaMask"], ["MetaMask", "Phantom"], ["MetaMask", "Phantom", "Rabby"]]) {
  console.log(`\n── ${names.length} wallet terpasang: ${names.join(", ")} ──`);
  for (const route of ROUTES) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const alerts = [];
    page.on("dialog", async (d) => {
      alerts.push(d.message());
      await d.dismiss();
    });
    await page.addInitScript(stub, { addr: ADDR, names });
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForTimeout(5000);

      // Tombol Connect DI DALAM halaman, bukan yang di navbar.
      const inPage = page.locator('main button:has-text("Connect wallet")').first();
      const target = (await inPage.count()) > 0 ? inPage : page.locator('button:has-text("Connect wallet")').first();
      if ((await target.count()) === 0) {
        check(`${route} punya tombol Connect`, false, "tidak ditemukan");
        await page.close();
        continue;
      }

      await target.click();
      await page.waitForTimeout(1200);

      // Dengan beberapa wallet, pemilih harus terbuka. Dengan satu, harus langsung tersambung.
      if (names.length === 1) {
        const connected = await page.evaluate(() => document.body.innerText.includes("0x8a3c"));
        const asked = await page.evaluate(() => window.__rpcCalls.some((c) => c.endsWith("eth_requestAccounts")));
        check(`${route} tersambung dengan satu wallet`, connected && asked, asked ? "" : "eth_requestAccounts tidak dipanggil");
      } else {
        const menu = await page.locator('[role="menu"]:has-text("wallets detected")').count();
        check(`${route} membuka pemilih wallet`, menu > 0, menu > 0 ? `${names.length} wallet` : "pemilih tidak terbuka");

        // Memilih satu wallet harus benar-benar menyambungkan.
        if (menu > 0) {
          await page.locator('[role="menuitem"]').first().click();
          await page.waitForTimeout(1500);
          const connected = await page.evaluate(() => document.body.innerText.includes("0x8a3c"));
          check(`${route} tersambung setelah wallet dipilih`, connected);
        }
      }

      // Tidak boleh ada alert yang mengklaim tidak ada wallet padahal ada.
      const falseClaim = alerts.find((a) => /no wallet detected|no web3 wallet/i.test(a));
      check(`${route} tidak mengklaim "tidak ada wallet"`, !falseClaim, falseClaim ? JSON.stringify(falseClaim.slice(0, 60)) : "");
    } catch (e) {
      check(`${route} dapat diperiksa`, false, String(e.message).split("\n")[0].slice(0, 90));
    }
    await page.close();
  }
}

// ── benar-benar tanpa wallet: pesannya harus menyebut jalur ponsel ───────────
console.log("\n── tanpa wallet sama sekali ──");
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const alerts = [];
  page.on("dialog", async (d) => {
    alerts.push(d.message());
    await d.dismiss();
  });
  await page.addInitScript(({ }) => {
    try {
      localStorage.setItem("adexto_cookie_choice", "essential");
    } catch {}
  }, {});
  await page.goto(`${BASE}/agent-compute`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(4500);
  const btn = page.locator('button:has-text("Connect wallet")').first();
  if ((await btn.count()) > 0) {
    await btn.click();
    await page.waitForTimeout(1200);
  }
  const msg = alerts[0] || "";
  check("memberi tahu bahwa tidak ada wallet", /no wallet detected/i.test(msg), JSON.stringify(msg.slice(0, 50)));
  /**
   * Jalur ponsel HARUS disebut. Situs ini tidak mendukung WalletConnect, jadi menyuruh pengguna
   * ponsel "memasang MetaMask" adalah saran yang tidak menyelesaikan apa pun: ekstensi tidak ada
   * di peramban ponsel dan tidak ada pemasangan QR untuk dipakai.
   */
  check("menyebut jalur ponsel (peramban dalam aplikasi wallet)", /phone|wallet app/i.test(msg));
  check("menyatakan WalletConnect belum didukung", /walletconnect/i.test(msg));
  await page.close();
}

// ── wallet yang TIDAK mengumumkan diri lewat EIP-6963 ────────────────────────
/**
 * Dilaporkan pengguna OKX, dan perilaku OKX memang tidak seragam antar versi: ada yang mengambil
 * alih `window.ethereum`, ada yang tidak, dan versi baru mengumumkan diri lewat EIP-6963. Jadi
 * yang diuji di sini bukan "OKX" sebagai merek, melainkan tiga bentuk suntikan yang mungkin.
 *
 * Skenario C yang paling berbahaya: wallet lain mengumumkan diri sementara OKX tidak. Daftar 6963
 * berisi tepat satu entri, jadi sebelum perbaikan aplikasi memakainya TANPA BERTANYA — pengguna
 * OKX disambungkan ke wallet yang tidak pernah ia pilih, dan tidak ada galat apa pun.
 */
const okxScenarios = [
  {
    label: "A. OKX mengumumkan diri (6963) + window.okxwallet, objek sama",
    expectNames: ["OKX Wallet"],
    setup: ({ addr }) => ({ announce: [["OKX Wallet", "com.okex.wallet"]], globals: { okxwallet: 0 }, windowEthereum: 0 }),
  },
  {
    label: "B. OKX TANPA 6963, hanya window.okxwallet + window.ethereum",
    expectNames: ["OKX Wallet"],
    setup: () => ({ announce: [], globals: { okxwallet: 0 }, windowEthereum: 0, flags: [{ isOkxWallet: true }] }),
  },
  {
    label: "C. MetaMask mengumumkan diri, OKX hanya menyuntik — harus TETAP terlihat",
    expectNames: ["MetaMask", "OKX Wallet"],
    setup: () => ({
      announce: [["MetaMask", "io.metamask"]],
      globals: { okxwallet: 1 },
      windowEthereum: 0,
      flags: [{ isMetaMask: true }, { isOkxWallet: true }],
    }),
  },
];

console.log("\n── wallet yang menyuntik tanpa mengumumkan diri ──");
for (const sc of okxScenarios) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(
    ({ addr, plan }) => {
      window.__granted = false;
      const mk = (flags) => ({
        ...flags,
        request: async ({ method }) => {
          if (method === "eth_chainId") return "0x4115";
          if (method === "eth_requestAccounts") {
            window.__granted = true;
            return [addr];
          }
          if (method === "eth_accounts") return window.__granted ? [addr] : [];
          return null;
        },
        on: () => {},
        removeListener: () => {},
      });
      // Satu kolam objek provider; indeks di `plan` menunjuk ke kolam ini supaya dua sumber bisa
      // berbagi objek yang SAMA (itu yang membuat dedupe bisa diuji).
      const pool = (plan.flags || [{}]).map(mk);
      if (plan.windowEthereum !== undefined) window.ethereum = pool[plan.windowEthereum];
      for (const [key, idx] of Object.entries(plan.globals || {})) window[key] = pool[idx];
      const details = (plan.announce || []).map(([name, rdns], i) => ({
        info: { uuid: rdns, name, rdns, icon: "" },
        provider: pool[i],
      }));
      const fire = () =>
        details.forEach((d) => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze(d) })));
      window.addEventListener("eip6963:requestProvider", fire);
      fire();
      try {
        localStorage.setItem("adexto_cookie_choice", "essential");
      } catch {}
    },
    { addr: ADDR, plan: sc.setup({ addr: ADDR }) }
  );

  await page.goto(`${BASE}/agent-compute`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(5000);

  const btn = page.locator('button:has-text("Connect wallet"), button:has-text("Choose wallet")').first();
  const label = (await btn.count()) > 0 ? (await btn.innerText()).trim() : "(tidak ada tombol)";

  if (sc.expectNames.length === 1) {
    // Satu wallet: harus langsung menyambung tanpa memaksa memilih.
    if ((await btn.count()) > 0) await btn.click();
    await page.waitForTimeout(2000);
    const connected = await page.evaluate(() => document.body.innerText.includes("0x8a3c"));
    check(`${sc.label} → tersambung`, connected, `tombol: "${label}"`);
  } else {
    await btn.click();
    await page.waitForTimeout(1500);
    const items = await page.locator('[role="menuitem"]').allInnerTexts();
    const found = items.map((t) => t.trim()).filter(Boolean);
    const ok = sc.expectNames.every((n) => found.some((f) => f.includes(n)));
    check(`${sc.label} → pemilih memuat ${sc.expectNames.join(" + ")}`, ok, `terlihat: ${found.join(", ") || "kosong"}`);
    // Dan memilih OKX harus benar-benar memakai OKX.
    const okxItem = page.locator('[role="menuitem"]:has-text("OKX")').first();
    if ((await okxItem.count()) > 0) {
      await okxItem.click();
      await page.waitForTimeout(2000);
      const connected = await page.evaluate(() => document.body.innerText.includes("0x8a3c"));
      check(`${sc.label} → memilih OKX menyambung`, connected);
    }
  }
  await page.close();
}

// ── wallet yang menyuntik TERLAMBAT ─────────────────────────────────────────
/**
 * Ekstensi menyuntik dirinya pada waktu yang tidak dikendalikan halaman, dan sebagian tiba setelah
 * React mount. EIP-6963 aman karena pengumumannya sebuah event; wallet yang hanya menyuntik tidak
 * punya event apa pun, jadi satu pembacaan saat mount bisa melewatkannya selamanya.
 */
console.log("\n── wallet menyuntik terlambat (1,2s setelah muat) ──");
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(({ addr }) => {
    window.__granted = false;
    const p = {
      isOkxWallet: true,
      request: async ({ method }) => {
        if (method === "eth_chainId") return "0x4115";
        if (method === "eth_requestAccounts") {
          window.__granted = true;
          return [addr];
        }
        if (method === "eth_accounts") return window.__granted ? [addr] : [];
        return null;
      },
      on: () => {},
      removeListener: () => {},
    };
    setTimeout(() => {
      window.okxwallet = p;
      window.ethereum = p;
    }, 1200);
    try {
      localStorage.setItem("adexto_cookie_choice", "essential");
    } catch {}
  }, { addr: ADDR });
  await page.goto(`${BASE}/agent-compute`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(6000);
  const btn = page.locator('button:has-text("Connect wallet")').first();
  if ((await btn.count()) > 0) {
    await btn.click();
    await page.waitForTimeout(2000);
  }
  const connected = await page.evaluate(() => document.body.innerText.includes("0x8a3c"));
  check("wallet yang menyuntik terlambat tetap bisa menyambung", connected);
  await page.close();
}

await browser.close();
console.log(`\n${fail === 0 ? "semua lolos" : `${fail} GAGAL`}`);
process.exit(fail === 0 ? 0 : 1);
