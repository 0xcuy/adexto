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

/**
 * Apakah WalletConnect terpasang di build ini, dideteksi SEKALI di awal.
 *
 * Nilainya ter-inline saat build, jadi skripnya tidak bisa membacanya dari env. Ia harus
 * ditanyakan ke halaman, dan hasilnya mengubah apa yang BENAR untuk kasus satu wallet: dengan
 * WalletConnect aktif, satu ekstensi berarti DUA pilihan, jadi pemilih harus terbuka. Tanpanya,
 * satu ekstensi memang tidak ada yang perlu dipilih dan sambungan langsung itu benar.
 *
 * Dideteksi di muka, bukan ditebak per kasus, supaya setiap pemeriksaan menuntut satu hal yang
 * pasti alih-alih menerima dua kemungkinan — penjaga yang menerima keduanya tidak menjaga apa pun.
 */
let wcEnabled = false;
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("dialog", async (d) => await d.dismiss());
  await page.addInitScript(() => {
    try {
      localStorage.setItem("adexto_cookie_choice", "essential");
    } catch {}
  });
  await page.goto(`${BASE}/agent-compute`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(4500);
  const btn = page.locator('button:visible:has-text("Connect wallet"), button:visible:has-text("Choose wallet")').first();
  if ((await btn.count()) > 0) {
    await btn.click();
    await page.waitForTimeout(1200);
    wcEnabled = (await page.locator('[role="menuitem"]:has-text("WalletConnect")').count()) > 0;
  }
  await page.close();
  console.log(`WalletConnect di build ini: ${wcEnabled ? "AKTIF" : "tidak aktif"}\n`);
}

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

      /**
       * SATU wallet: yang benar tergantung WalletConnect.
       *
       * WalletConnect aktif → satu ekstensi + WalletConnect = dua pilihan, jadi pemilih WAJIB
       * terbuka pada klik pertama. Kegagalan di sini adalah bug yang dilaporkan pengguna: di PC
       * dengan satu ekstensi, satu klik langsung menyambung dan WalletConnect tidak pernah
       * ditawarkan.
       *
       * WalletConnect mati → tidak ada yang perlu dipilih, sambungan langsung itu benar.
       */
      if (names.length === 1 && wcEnabled) {
        const menu = page.locator('[role="menu"]:visible').first();
        const opened = (await menu.count()) > 0;
        check(`${route} satu wallet + WalletConnect → pemilih terbuka`, opened);
        if (opened) {
          const txt = await menu.innerText();
          check(`${route} pemilih memuat ekstensi DAN WalletConnect`, /metamask/i.test(txt) && /walletconnect/i.test(txt), JSON.stringify(txt.replace(/\n/g, " · ").slice(0, 70)));
          await page.locator('[role="menuitem"]:has-text("MetaMask")').first().click();
          await page.waitForTimeout(1800);
          const connected = await page.evaluate(() => document.body.innerText.includes("0x8a3c"));
          check(`${route} memilih ekstensi menyambung`, connected);
        }
      } else if (names.length === 1) {
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
    /**
     * Satu wallet. Dengan WalletConnect aktif itu berarti DUA pilihan, jadi pemilih terbuka lebih
     * dulu dan wallet-nya dipilih — bukan kegagalan, melainkan perilaku yang diminta pengguna
     * ("langsung ngebuka pilihan"). Tanpa WalletConnect, sambungan langsung yang benar.
     */
    if ((await btn.count()) > 0) await btn.click();
    await page.waitForTimeout(2000);
    if (wcEnabled) {
      const menu = page.locator('[role="menu"]:visible').first();
      const opened = (await menu.count()) > 0;
      check(`${sc.label} → pemilih terbuka`, opened, `tombol: "${label}"`);
      if (opened) {
        const item = page.locator(`[role="menuitem"]:has-text("${sc.expectNames[0]}")`).first();
        if ((await item.count()) > 0) await item.click();
        await page.waitForTimeout(2000);
      }
    }
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
  const btn = page.locator('button:visible:has-text("Connect wallet"), button:visible:has-text("Choose wallet")').first();
  if ((await btn.count()) > 0) {
    await btn.click();
    await page.waitForTimeout(2000);
    // Dengan WalletConnect aktif, pemilih terbuka lebih dulu; wallet yang terlambat menyuntik
    // harus SUDAH ada di dalamnya, dan itu justru yang membuktikan pemindaian ulang bekerja.
    if (wcEnabled) {
      const item = page.locator('[role="menuitem"]:has-text("OKX")').first();
      if ((await item.count()) > 0) {
        await item.click();
        await page.waitForTimeout(2000);
      }
    }
  }
  const connected = await page.evaluate(() => document.body.innerText.includes("0x8a3c"));
  check("wallet yang menyuntik terlambat tetap bisa menyambung", connected);
  await page.close();
}

// ── jalur WalletConnect (Reown) ──────────────────────────────────────────────
/**
 * Ini satu-satunya jalur yang tidak menuntut wallet menyuntik diri ke halaman, jadi ia satu-satunya
 * yang bekerja di peramban ponsel biasa. Diperiksa DENGAN NOL wallet tersuntik, karena itu keadaan
 * pengguna ponsel yang sesungguhnya.
 *
 * Skripnya tidak tahu apakah `NEXT_PUBLIC_REOWN_PROJECT_ID` terpasang — nilainya ter-inline saat
 * build. Jadi ia MEMBACA keadaan dari halaman lalu menuntut hal yang benar untuk keadaan itu,
 * alih-alih menuntut satu keadaan dan gagal di lingkungan yang sah.
 */
console.log("\n── jalur WalletConnect, tanpa wallet tersuntik ──");
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const alerts = [];
  page.on("dialog", async (d) => {
    alerts.push(d.message());
    await d.dismiss();
  });
  const lateChunks = [];
  await page.addInitScript(() => {
    try {
      localStorage.setItem("adexto_cookie_choice", "essential");
    } catch {}
  });
  await page.goto(`${BASE}/agent-compute`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(4500);

  // Dipasang SESUDAH halaman tenang, supaya hanya chunk yang dimuat oleh klik yang tercatat.
  page.on("request", (r) => {
    const u = r.url();
    if (/\/_next\/static\/chunks\/.*\.js/.test(u)) lateChunks.push(u.split("/").pop());
  });

  const btn = page.locator('button:has-text("Connect wallet"), button:has-text("Choose wallet")').first();
  await btn.click();
  await page.waitForTimeout(1500);

  const wcRow = page.locator('[role="menuitem"]:has-text("WalletConnect")');
  const configured = (await wcRow.count()) > 0;
  console.log(`  WalletConnect terpasang di build ini: ${configured ? "YA" : "tidak"}`);

  if (configured) {
    check("pemilih terbuka walau NOL wallet tersuntik", true, "keadaan pengguna ponsel");
    const menuText = await page.locator('[role="menu"]').first().innerText();
    check("pemilih menyatakan tidak ada wallet di peramban ini", /no wallet in this browser/i.test(menuText));
    check("barisnya menjelaskan caranya", /scan with your phone/i.test(menuText), JSON.stringify(menuText.replace(/\n/g, " · ").slice(0, 80)));

    /**
     * Sambungan relay diawasi SEBELUM diklik, supaya buktinya tertangkap.
     *
     * Project id yang ditolak membuat relay menutup sambungan (401) tanpa mengirim frame apa pun,
     * jadi "ada frame masuk" adalah pembeda paling langsung antara id yang sah dan yang tidak —
     * lebih dapat diandalkan daripada menebak isi modal, yang hidup di shadow DOM tertutup.
     */
    const sockets = [];
    page.on("websocket", (ws) => {
      if (!/relay|walletconnect|reown/i.test(ws.url())) return;
      const rec = { url: ws.url(), frames: 0, closed: false };
      sockets.push(rec);
      ws.on("framereceived", () => rec.frames++);
      ws.on("close", () => (rec.closed = true));
    });
    const relayErrors = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /project id|projectid|unauthorized|401|403|invalid key/i.test(m.text())) {
        relayErrors.push(m.text().slice(0, 160));
      }
    });

    await wcRow.first().click();
    // Pohon paketnya besar dan dimuat malas; yang diperiksa di sini adalah ia BENAR-BENAR dimuat
    // saat diklik, bukan sebelumnya.
    await page.waitForTimeout(6000);
    check("mengklik WalletConnect memuat chunk-nya saat itu juga", lateChunks.length > 0, `${lateChunks.length} chunk`);
    const crashed = await page.evaluate(() => !document.body || document.body.innerText.length < 50);
    check("halaman tidak rusak sesudahnya", !crashed);
    check("tidak ada alert yang mengklaim tidak ada wallet", !alerts.some((a) => /no wallet detected/i.test(a)));

    // Menunggu bukti, bukan menunggu sekadar lewat.
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(1000);
      if (sockets.some((s) => s.frames > 0)) break;
    }
    const live = sockets.filter((s) => s.frames > 0);
    check("relay Reown menerima sambungan (project id sah)", live.length > 0, live[0] ? `${live[0].url.slice(0, 44)}… frame ${live[0].frames}` : "tidak ada frame");
    check("tidak ada galat project id ditolak", relayErrors.length === 0, relayErrors[0] || "");

    const modalTag = await page.evaluate(() => document.querySelector("w3m-modal, wcm-modal, appkit-modal")?.tagName.toLowerCase() || "");
    check("modal Reown dirender", Boolean(modalTag), modalTag);
    /**
     * Isi modalnya TIDAK di-assert lewat DOM. Ia berada di shadow root tertutup — penelusuran
     * atribut mengembalikan nol di ponsel padahal potret memperlihatkan grid wallet yang penuh.
     * Jadi yang dijadikan bukti di sini hanya hal yang bisa diukur andal: node di dalam modal
     * memang terbentuk.
     */
    const modalNodes = await page.evaluate(() => {
      const m = document.querySelector("w3m-modal");
      if (!m?.shadowRoot) return 0;
      let n = 0;
      const walk = (r) => {
        for (const el of r.querySelectorAll("*")) {
          n++;
          if (el.shadowRoot) walk(el.shadowRoot);
        }
      };
      walk(m.shadowRoot);
      return n;
    });
    check("modal terisi, bukan kerangka kosong", modalNodes > 100, `${modalNodes} node`);

    // URI pairing hanya dicari di desktop: di ponsel modal membuka daftar wallet lebih dulu, jadi
    // belum ada elemen yang membawa URI pada saat itu. Itu perilaku benar, bukan kekurangan.
    const uri = await page.evaluate(() => {
      const found = new Set();
      const walk = (root) => {
        for (const el of root.querySelectorAll("*")) {
          for (const a of el.getAttributeNames?.() || []) {
            const v = el.getAttribute(a);
            if (typeof v === "string" && v.startsWith("wc:")) found.add(v);
          }
          if (el.shadowRoot) walk(el.shadowRoot);
        }
      };
      walk(document);
      return [...found];
    });
    if (uri.length) {
      check("URI pairing wc: sah (relay-protocol + symKey)", /relay-protocol=irn/.test(uri[0]) && /symKey=/.test(uri[0]), `${uri[0].slice(0, 44)}…`);
    } else {
      console.log("  catatan: URI tidak terbaca dari DOM di viewport ini — modal membuka daftar wallet, bukan QR");
    }

    /**
     * VIEWPORT PONSEL, karena inilah seluruh alasan fitur ini ada.
     *
     * `:visible` WAJIB di sini. Pada 390px ada DUA WalletMenu di DOM — versi grouped untuk desktop
     * yang disembunyikan CSS, dan versi ponsel — dan `.first()` mengambil yang tersembunyi, lalu
     * kliknya timeout dengan "element is not visible". Terlihat saat memotret, bukan saat membaca
     * kode.
     */
    const phone = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    await phone.addInitScript(() => {
      try {
        localStorage.setItem("adexto_cookie_choice", "essential");
      } catch {}
    });
    await phone.goto(`${BASE}/agent-compute`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await phone.waitForTimeout(5000);
    const phoneBtn = phone
      .locator('button:visible:has-text("Connect wallet"), button:visible:has-text("Choose wallet")')
      .first();
    const phoneHasBtn = (await phoneBtn.count()) > 0;
    check("ponsel 390px: tombol wallet terlihat", phoneHasBtn, phoneHasBtn ? (await phoneBtn.innerText()).trim() : "");
    if (phoneHasBtn) {
      await phoneBtn.click();
      await phone.waitForTimeout(1500);
      const phoneMenu = phone.locator('[role="menu"]:visible').first();
      const opened = (await phoneMenu.count()) > 0;
      check("ponsel 390px: pemilih terbuka", opened);
      if (opened) {
        const txt = await phoneMenu.innerText();
        check("ponsel 390px: WalletConnect ditawarkan", /walletconnect/i.test(txt), JSON.stringify(txt.replace(/\n/g, " · ").slice(0, 70)));
      }
    }
    await phone.close();
  } else {
    /**
     * Tanpa project id, fitur ini MATI TOTAL dan tidak boleh disebut di UI: relay Reown menolak
     * setiap sambungan tanpa id, jadi menampilkan tombolnya hanya menawarkan kegagalan.
     *
     * Dalam keadaan ini pesan teksnya yang harus menanggung beban, dan ia harus menyebut jalur
     * yang BENAR-BENAR bekerja di ponsel: membuka situs di dalam peramban aplikasi wallet.
     * Menyuruh memasang ekstensi tidak mungkin dijalankan di peramban ponsel.
     */
    const menu = await page.locator('[role="menu"]').count();
    check(
      "tidak menawarkan WalletConnect saat project id kosong",
      menu === 0 || !/walletconnect/i.test(await page.locator('[role="menu"]').first().innerText())
    );
    const msg = alerts[0] || "";
    check("memberi tahu bahwa tidak ada wallet", /no wallet detected/i.test(msg), JSON.stringify(msg.slice(0, 50)));
    check("menyebut jalur ponsel (peramban dalam aplikasi wallet)", /phone|wallet app/i.test(msg));
    check("menyatakan WalletConnect belum didukung", /walletconnect/i.test(msg));
  }
  await page.close();
}

await browser.close();
console.log(`\n${fail === 0 ? "semua lolos" : `${fail} GAGAL`}`);
process.exit(fail === 0 ? 0 : 1);
