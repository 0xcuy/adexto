/**
 * Menguji peluncuran multi-chain 1-klik (1–4 chain) lewat UI, di empat testnet nyata.
 *
 * Keempat slot chain produksi diarahkan ke testnet lewat NEXT_PUBLIC_CHAIN_OVERRIDES:
 *   0G -> 0G Testnet 16602 | Arbitrum -> Arb Sepolia 421614
 *   Base -> Base Sepolia 84532 | Monad -> Monad Testnet 10143
 *
 * Yang dibuktikan:
 *   A. pilih 4 chain -> 4 market terdaftar, masing-masing token+pool sendiri
 *   B. explorer & halaman token menampilkan relasi antar chain dengan benar
 *   C. beli/jual berjalan di lebih dari satu chain
 *   D. pilih 2 chain -> tepat 2 market
 *   E. pilih 1 chain -> tepat 1 market
 *   F. ticker yang sudah dipakai di suatu chain dilewati, bukan membatalkan semua
 */
import { chromium } from "playwright";
import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const PK = process.env.OG_PRIVATE_KEY || process.env.PRIVATE_KEY;
/**
 * Ukuran pembelian uji. Dulu ini diturunkan dari TEST_SEED, tapi kurva tidak
 * punya seed — jadi ukuran beli kini berdiri sendiri dan sengaja kecil supaya
 * dana testnet tidak terpakai banyak.
 */
const BUY_SIZE = process.env.TEST_BUY || "0.00005";
const RUN = Math.floor(Math.random() * 900 + 100);

const CHAINS = {
  16602: { key: "0G", name: "0G Testnet", rpc: "https://evmrpc-testnet.0g.ai", sym: "0G" },
  421614: { key: "Arbitrum", name: "Arbitrum Sepolia", rpc: "https://sepolia-rollup.arbitrum.io/rpc", sym: "ETH" },
  84532: { key: "Base", name: "Base Sepolia", rpc: "https://base-sepolia-rpc.publicnode.com", sym: "ETH" },
  10143: { key: "Monad", name: "Monad Testnet", rpc: "https://testnet-rpc.monad.xyz", sym: "MON" },
};

const providers = {};
const wallets = {};
for (const [id, c] of Object.entries(CHAINS)) {
  // RPC testnet publik kadang timeout. Beri tenggat lebih panjang supaya gangguan
  // jaringan tidak dilaporkan sebagai kegagalan produk.
  const req = new ethers.FetchRequest(c.rpc);
  req.timeout = 60000;
  providers[id] = new ethers.JsonRpcProvider(req, Number(id), { staticNetwork: true });
  wallets[id] = new ethers.Wallet(PK, providers[id]);
}

/**
 * Ulangi HANYA pembacaan (saldo, reserve). Tidak pernah dipakai untuk mengirim
 * transaksi — mengulang pengiriman berisiko dobel launch/dobel beli.
 */
async function read(fn, label = "read", tries = 4) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < tries) await new Promise((r) => setTimeout(r, 2500 * i));
    }
  }
  throw new Error(`${label} gagal setelah ${tries} percobaan: ${last?.message ?? last}`);
}
const ACCOUNT = new ethers.Wallet(PK).address;

/** ONLY=A,F menjalankan sebagian bagian saja, agar dana testnet tidak terbuang. */
const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const only = (name) => ONLY.length === 0 || ONLY.includes(name);

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "LULUS" : "GAGAL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};
const step = (s) => console.log(`\n${"═".repeat(78)}\n${s}\n${"═".repeat(78)}`);
const fmt = (v) => Number(ethers.formatUnits(v, 18)).toLocaleString("id-ID", { maximumFractionDigits: 2 });

const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
];
const POOL = [
  "function getReserves() view returns (uint256,uint256)",
  "function buy(uint256,address,uint256) payable returns (uint256)",
  // Khas kurva v3.
  "function virtualNative() view returns (uint256)",
  "function realNative() view returns (uint256)",
  "function creatorOwed() view returns (uint256)",
];

/** Shim wallet multi-chain: satu akun, chain aktif bisa ditukar seperti MetaMask. */
const SHIM = `
window.ethereum = {
  isMetaMask: true,
  _cbs: {},
  on(ev, cb) { (this._cbs[ev] = this._cbs[ev] || []).push(cb); },
  removeListener() {},
  async request({ method, params }) {
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [window.__ACCOUNT__];
    return await window.__rpc(method, params || []);
  },
};
`;

async function launchViaStudio(page, { ticker, name, chainKeys }) {
  await page.goto(`${BASE}/studio`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  const connect = page.locator('button:has-text("Connect wallet")').first();
  if ((await connect.count()) > 0) {
    await connect.click();
    await page.waitForTimeout(1200);
  }

  // Pilih tepat chainKeys: klik untuk mematikan yang tidak diinginkan.
  for (const key of ["0G", "Arbitrum", "Base", "Monad"]) {
    const btn = page.locator(`button[title*="${CHAINS[Object.keys(CHAINS).find((id) => CHAINS[id].key === key)].name}"]`).first();
    if ((await btn.count()) === 0) continue;
    const active = (await btn.getAttribute("class"))?.includes("cyan-950");
    const want = chainKeys.includes(key);
    if (active !== want) {
      await btn.click();
      await page.waitForTimeout(250);
    }
  }
  await page.waitForTimeout(400);

  await page.locator('input[value="AQUANT"]').first().fill(ticker);
  await page.locator('input[value="Aegis Quant AI"]').first().fill(name);
  // Tidak ada field seed lagi: FactoryV3 memakai kurva dengan reserve virtual.
  await page.waitForTimeout(2200);

  const signBtn = page.getByRole("button", { name: "Sign attestation", exact: true });
  if ((await signBtn.count()) > 0) {
    await signBtn.click();
    await page.waitForTimeout(2200);
  }

  // Label dibaca SETELAH attestation, karena sebelum itu tombolnya masih
  // berbunyi "Sign attestation to unlock".
  const btnLabel = await page
    .locator("button", { hasText: /Launch on|Choose an available ticker/ })
    .first()
    .textContent()
    .catch(() => null);

  await page.locator('button:has-text("Launch on")').click();
  await page.waitForSelector("text=/live on \\d+ of \\d+|Launch failed/", { timeout: 600000 });
  await page.waitForTimeout(2000);

  const headline = await page.locator("text=/live on \\d+ of \\d+|Launch failed/").first().textContent();

  // Seluruh isi panel laporan, termasuk baris chain yang gagal beserta alasannya.
  const report = await page
    .evaluate(() => {
      const marker = [...document.querySelectorAll("div")].find((d) => /live on \d+ of \d+|Launch failed/.test(d.textContent || ""));
      let node = marker;
      for (let i = 0; i < 4 && node?.parentElement; i++) node = node.parentElement;
      return (node?.textContent || "").replace(/\s+/g, " ").trim();
    })
    .catch(() => "");

  const perChain = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("div")].filter((d) =>
      /^(0G|Arbitrum|Base|Monad)\b/.test((d.textContent || "").trim()) && /success|failed/.test(d.textContent || "")
    );
    return rows.slice(0, 8).map((d) => (d.textContent || "").replace(/\s+/g, " ").trim().slice(0, 220));
  });

  return { headline: headline.replace(/\s+/g, " ").trim(), btnLabel: btnLabel?.replace(/\s+/g, " ").trim(), report, perChain };
}

async function registryFor(page, ticker) {
  return page.evaluate(async (sym) => {
    const res = await fetch("/api/graphql", { method: "POST" });
    const j = await res.json();
    return j.data.projects.filter((p) => p.symbol === sym);
  }, ticker);
}

(async () => {
  console.log(`akun    : ${ACCOUNT}`);
 console.log(`beli : ${BUY_SIZE} per chain (tanpa setoran likuiditas)`);
  // Satu RPC publik yang sedang rewel tidak boleh membatalkan seluruh pengujian.
  for (const [id, c] of Object.entries(CHAINS)) {
    try {
      const b = await read(() => providers[id].getBalance(ACCOUNT), "saldo awal");
      console.log(`  ${c.name.padEnd(18)} ${String(id).padEnd(7)} saldo=${ethers.formatEther(b).slice(0, 12)} ${c.sym}`);
    } catch (e) {
      console.log(`  ${c.name.padEnd(18)} ${String(id).padEnd(7)} RPC rewel: ${(e.shortMessage || e.message || "").slice(0, 50)}`);
    }
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1080 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  const launchErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    const t = m.text();
    if (t.includes("[adexto] launch failed")) launchErrors.push(t);
  });

  let activeChain = 16602;
  let queue = Promise.resolve();
  const serial = (fn) => ((queue = queue.then(fn, fn)), queue);

  await page.exposeFunction("__rpc", async (method, params) => {
    try {
      if (method === "eth_chainId") return "0x" + activeChain.toString(16);
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") {
        const want = parseInt(params[0].chainId, 16);
        if (!CHAINS[want]) throw Object.assign(new Error("Unrecognized chain"), { code: 4902 });
        activeChain = want;
        return null;
      }
      if (method === "personal_sign") return await wallets[activeChain].signMessage(ethers.getBytes(params[0]));
      if (method === "eth_sign") return await wallets[activeChain].signMessage(ethers.getBytes(params[1]));
      if (method === "eth_sendTransaction") {
        return await serial(async () => {
          const p = params[0] || {};
          const tx = await wallets[activeChain].sendTransaction({
            to: p.to ?? undefined,
            data: p.data ?? undefined,
            value: p.value ? BigInt(p.value) : 0n,
            ...(p.gas ? { gasLimit: BigInt(p.gas) } : {}),
          });
          return tx.hash;
        });
      }
      return await providers[activeChain].send(method, params);
    } catch (e) {
      throw new Error(e?.shortMessage || e?.info?.error?.message || e?.message || "rpc error");
    }
  });
  await page.addInitScript(`window.__ACCOUNT__ = "${ACCOUNT}";`);
  await ctx.addInitScript(SHIM);

  // ── A. 4 chain sekaligus ──────────────────────────────────────────────────
  const T4 = `OMNI${RUN}`;
  step(`A) SATU KLIK, EMPAT CHAIN — $${T4}`);
  const r4 = await launchViaStudio(page, { ticker: T4, name: "Omni Four Chain", chainKeys: ["0G", "Arbitrum", "Base", "Monad"] });
  console.log(`  tombol  : ${r4.btnLabel}`);
  console.log(`  hasil   : ${r4.headline}`);
  if (r4.perChain?.length) {
    console.log("  rincian per chain:");
    r4.perChain.forEach((row) => console.log(`    · ${row}`));
  }
  if (launchErrors.length > 0) {
    console.log("  error mentah dari browser:");
    launchErrors.forEach((e) => console.log(`    ! ${e.slice(0, 600)}`));
  }
  check("laporan menyatakan 4 dari 4 chain live", /live on 4 of 4/.test(r4.headline), r4.headline);

  const reg4 = await registryFor(page, T4);
  check("4 market terdaftar di registry", reg4.length === 4, `${reg4.length} market`);
  for (const rec of reg4) {
    const c = CHAINS[rec.chainId];
    const code = await read(() => providers[rec.chainId].getCode(rec.tokenAddress), "getCode token");
    const poolCode = await read(() => providers[rec.chainId].getCode(rec.poolAddress), "getCode pool");
    console.log(`    ${String(c?.name ?? rec.chainId).padEnd(18)} token=${rec.tokenAddress.slice(0, 12)}… pool=${rec.poolAddress.slice(0, 12)}… harga=${rec.priceNative} ${rec.nativeSymbol}`);
    check(`  ${c?.key}: kontrak token & pool ada di chain`, code !== "0x" && poolCode !== "0x");
    check(`  ${c?.key}: tradable`, rec.tradable === true);
    check(`  ${c?.key}: label chain benar (bukan "Omnichain (...)")`, rec.chain === `${c.name} (${rec.chainId})`, rec.chain);
    check(`  ${c?.key}: deployedChainCount = 4`, rec.deployedChainCount === 4);

    // Properti kurva, diperiksa PER CHAIN. Satu chain yang diam-diam masih
    // memakai generasi berseed akan lolos kalau hanya diperiksa di satu tempat.
    const curve = new ethers.Contract(rec.poolAddress, POOL, providers[rec.chainId]);
    const token = new ethers.Contract(rec.tokenAddress, ERC20, providers[rec.chainId]);
    const realN = await read(() => curve.realNative(), "realNative");
    const virtN = await read(() => curve.virtualNative(), "virtualNative");
    const heldByCreator = await read(() => token.balanceOf(ACCOUNT), "saldo creator");
    check(`  ${c?.key}: kurva tanpa setoran native`, realN === 0n, `${ethers.formatEther(realN)}`);
    check(`  ${c?.key}: reserve virtual terpasang`, virtN > 0n, `${ethers.formatEther(virtN)} ${c?.sym}`);
    check(`  ${c?.key}: creator memegang nol token`, heldByCreator === 0n, `${fmt(heldByCreator)}`);
  }
  const uniqTokens = new Set(reg4.map((r) => r.tokenAddress.toLowerCase()));
  check("setiap chain punya alamat token berbeda", uniqTokens.size === 4, `${uniqTokens.size} alamat unik`);

  // ── B. explorer & halaman token ───────────────────────────────────────────
  step("B) EXPLORER & HALAMAN TOKEN");
  await page.goto(`${BASE}/explorer`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  const cards = await page.locator(`text=$${T4}`).count();
  check(`explorer menampilkan ${T4} untuk tiap chain`, cards >= 4, `${cards} kartu`);
  check("badge '+3 chain' tampil", (await page.locator("text=+3 chain").count()) > 0);

  const primary = reg4[0];
  await page.goto(`${BASE}/token/${T4.toLowerCase()}?chain=${primary.chainId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);
  check("badge '4 chains' di header token", (await page.locator("text=4 chains").count()) > 0);
  const switcherLinks = await page.evaluate(
    (slug) => [...document.querySelectorAll(`a[href^="/token/${slug}?chain="]`)].map((a) => a.getAttribute("href")),
    T4.toLowerCase()
  );
  check("switcher chain punya 4 tautan", new Set(switcherLinks).size === 4, JSON.stringify([...new Set(switcherLinks)]));
  check(
    "penjelasan harga terpisah per chain tampil",
    // Jangkarnya harus teks UI yang sebenarnya (bahasa Inggris). Sebelumnya di sini
    // tertulis /harga sendiri/ — pola bahasa Indonesia yang tidak pernah ada di UI,
    // jadi asersi ini mustahil lulus dan bukan menandakan cacat produk.
    (await page.locator("text=/Independent pool and price per chain/i").count()) > 0
  );

  // Pindah chain lewat switcher -> pool & harga ikut berubah
  const second = reg4[1];
  await page.goto(`${BASE}/token/${T4.toLowerCase()}?chain=${second.chainId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);
  const poolLink = await page.evaluate(() => {
    const a = [...document.querySelectorAll("a")].find((x) => x.textContent.trim() === "Pool");
    return a?.getAttribute("href") ?? null;
  });
  check(
    "berpindah chain memuat pool chain tersebut",
    Boolean(poolLink && poolLink.toLowerCase().includes(second.poolAddress.toLowerCase())),
    poolLink ?? "tidak ada"
  );

  // ── C. trading di dua chain berbeda ───────────────────────────────────────
  step("C) TRADING DI DUA CHAIN BERBEDA");
  for (const rec of only("C") ? [reg4[0], reg4[1]].filter(Boolean) : []) {
    const c = CHAINS[rec.chainId];
    console.log(`\n  --- ${c.name} ---`);
    const pool = new ethers.Contract(rec.poolAddress, POOL, providers[rec.chainId]);
    const erc20 = new ethers.Contract(rec.tokenAddress, ERC20, providers[rec.chainId]);
    const buyWei = ethers.parseEther(BUY_SIZE);

    // tunggu window anti-sniper
    const deadline = Date.now() + 240000;
    let ok = false;
    process.stdout.write("    menunggu window anti-sniper");
    while (Date.now() < deadline) {
      try {
        await pool.buy.staticCall(0, ACCOUNT, 0, { value: buyWei, from: ACCOUNT });
        ok = true;
        break;
      } catch {
        process.stdout.write(".");
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
    console.log("");
    check(`  ${c.key}: window anti-sniper berakhir`, ok);
    if (!ok) continue;

    activeChain = rec.chainId;
    await page.goto(`${BASE}/swap?token=${T4}&chain=${rec.chainId}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(4000);

    const selectedKey = await page.evaluate(() => {
      const s = [...document.querySelectorAll("select")].find((x) =>
        [...x.options].some((o) => (o.textContent || "").trim().startsWith("$"))
      );
      return s ? s.value : null;
    });
    check(`  ${c.key}: ?chain= memilih market chain yang tepat`, selectedKey === `${rec.chainId}:${T4}`, String(selectedKey));

    const before = await read(() => erc20.balanceOf(ACCOUNT), "saldo sebelum beli");
    await page.locator('input[type="number"]').first().fill(ethers.formatEther(buyWei));
    await page.waitForTimeout(2000);
    const buyBtn = page.locator("button", { hasText: new RegExp(`^Buy \\$${T4}$`) });
    if ((await buyBtn.count()) === 0 || (await buyBtn.first().isDisabled())) {
      check(`  ${c.key}: tombol Buy aktif`, false);
      continue;
    }
    await buyBtn.first().click();
    await page.waitForSelector("text=/Swap settled|would fail on-chain|Rejected|Insufficient/", { timeout: 300000 });
    await page.waitForTimeout(4000);
    const after = await read(() => erc20.balanceOf(ACCOUNT), "saldo sesudah beli");
    check(`  ${c.key}: BELI berhasil, saldo token naik`, after > before, `+${fmt(after - before)} ${T4}`);

    // jual sebagian lewat terminal
    if (after > before) {
      await page.goto(`${BASE}/token/${T4.toLowerCase()}?chain=${rec.chainId}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(5000);
      await page.locator('button:has-text("SELL")').first().click();
      await page.waitForTimeout(1200);
      const sellAmt = (after - before) / 3n;
      await page.locator('input[type="number"]').first().fill(ethers.formatUnits(sellAmt, 18));
      await page.waitForTimeout(2000);
      const nativeBefore = await read(() => providers[rec.chainId].getBalance(ACCOUNT), "nativeBefore");
      const tokBefore = await read(() => erc20.balanceOf(ACCOUNT), "tokBefore");
      // Saldo pool: inilah sumber pembayaran jual. Mengukur di sisi pool membuat
      // asersi tidak bergantung pada gas — di Monad (202 gwei) gas bisa MELEBIHI
      // hasil jual posisi kecil, jadi "saldo native penjual naik" itu asersi salah.
      const poolNativeBefore = await read(() => providers[rec.chainId].getBalance(rec.poolAddress), "poolNativeBefore");
      const poolTokBefore = await read(() => erc20.balanceOf(rec.poolAddress), "poolTokBefore");
      const sellBtn = page.locator("button", { hasText: new RegExp(`^Approve & sell \\$${T4}$`) });
      if ((await sellBtn.count()) > 0 && !(await sellBtn.first().isDisabled())) {
        await sellBtn.first().click();
        await page.waitForSelector("text=/Received |would fail on-chain|Rejected|Insufficient/", { timeout: 300000 });
        await page.waitForTimeout(5000);
        const nativeAfter = await read(() => providers[rec.chainId].getBalance(ACCOUNT), "nativeAfter");
        const tokAfter = await read(() => erc20.balanceOf(ACCOUNT), "tokAfter");
        const poolNativeAfter = await read(() => providers[rec.chainId].getBalance(rec.poolAddress), "poolNativeAfter");
        const poolTokAfter = await read(() => erc20.balanceOf(rec.poolAddress), "poolTokAfter");

        const sold = tokBefore - tokAfter;
        const proceeds = poolNativeBefore - poolNativeAfter; // native yang dibayarkan pool
        const netChange = nativeAfter - nativeBefore; // sesudah gas
        const gasSpent = proceeds - netChange; // akuntansi harus tertutup

        check(`  ${c.key}: JUAL menurunkan token penjual`, sold > 0n, `-${fmt(sold)}`);
        check(`  ${c.key}: token masuk ke pool`, poolTokAfter - poolTokBefore === sold, `+${fmt(poolTokAfter - poolTokBefore)}`);
        check(
          `  ${c.key}: pool membayar native ke penjual`,
          proceeds > 0n,
          `${ethers.formatEther(proceeds).slice(0, 12)} ${c.sym}`
        );
        // gasSpent harus positif (penjual selalu bayar gas) dan akuntansi tertutup persis.
        check(
          `  ${c.key}: akuntansi tertutup (hasil - gas = perubahan saldo)`,
          gasSpent > 0n && proceeds - gasSpent === netChange,
          `hasil ${ethers.formatEther(proceeds).slice(0, 10)} - gas ${ethers.formatEther(gasSpent).slice(0, 10)} = ${
            netChange >= 0n ? "+" : ""
          }${ethers.formatEther(netChange).slice(0, 11)} ${c.sym}${netChange < 0n ? "  (gas > hasil: wajar di chain gas mahal)" : ""}`
        );
      } else {
        check(`  ${c.key}: tombol jual tersedia`, false);
      }
    }
  }

  // ── D. dua chain saja ─────────────────────────────────────────────────────
  const T2 = `DUO${RUN}`;
  step(`D) PILIH DUA CHAIN SAJA — $${T2} (0G + Base)`);
  activeChain = 16602;
  const r2 = await launchViaStudio(page, { ticker: T2, name: "Duo Chain Test", chainKeys: ["0G", "Base"] });
  console.log(`  tombol : ${r2.btnLabel}`);
  console.log(`  hasil  : ${r2.headline}`);
  check("tombol menyebut tepat 2 chain", /0G \+ Base/.test(r2.btnLabel ?? ""), r2.btnLabel);
  check("laporan 2 dari 2 chain live", /live on 2 of 2/.test(r2.headline), r2.headline);
  const reg2 = await registryFor(page, T2);
  check("tepat 2 market terdaftar", reg2.length === 2, `${reg2.length}`);
  check(
    "keduanya di chain yang dipilih",
    reg2.every((r) => [16602, 84532].includes(r.chainId)),
    reg2.map((r) => CHAINS[r.chainId]?.key).join(", ")
  );

  // ── E. satu chain saja ────────────────────────────────────────────────────
  const T1 = `SOLO${RUN}`;
  step(`E) PILIH SATU CHAIN SAJA — $${T1} (Monad)`);
  activeChain = 10143;
  const r1 = await launchViaStudio(page, { ticker: T1, name: "Solo Chain Test", chainKeys: ["Monad"] });
  console.log(`  hasil  : ${r1.headline}`);
  check("laporan 1 dari 1 chain live", /live on 1 of 1/.test(r1.headline), r1.headline);
  const reg1 = await registryFor(page, T1);
  check("tepat 1 market terdaftar", reg1.length === 1, `${reg1.length}`);
  check("berada di Monad", reg1[0]?.chainId === 10143, String(reg1[0]?.chainId));
  check("deployedChainCount = 1", reg1[0]?.deployedChainCount === 1);

  // ── F. ticker yang sudah dipakai dilewati, bukan membatalkan semua ───────
  step(`F) TICKER SUDAH DIPAKAI — $${T1} coba lagi ke Monad + Arbitrum`);
  activeChain = 10143;
  await page.goto(`${BASE}/studio`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const conn = page.locator('button:has-text("Connect wallet")').first();
  if ((await conn.count()) > 0) {
    await conn.click();
    await page.waitForTimeout(1000);
  }
  for (const key of ["0G", "Arbitrum", "Base", "Monad"]) {
    const id = Object.keys(CHAINS).find((k) => CHAINS[k].key === key);
    const btn = page.locator(`button[title*="${CHAINS[id].name}"]`).first();
    if ((await btn.count()) === 0) continue;
    const active = (await btn.getAttribute("class"))?.includes("cyan-950");
    const want = ["Monad", "Arbitrum"].includes(key);
    if (active !== want) {
      await btn.click();
      await page.waitForTimeout(250);
    }
  }
  await page.locator('input[value="AQUANT"]').first().fill(T1);
  await page.waitForTimeout(2500);
  // Sama seperti di seksi B: jangkar harus teks Inggris yang benar-benar dirender
  // studio ("… it will be skipped"), bukan frasa Indonesia.
  const skipNotice = await page.locator("text=/will be skipped/i").count();

  // Tanda tangani attestation dulu, kalau tidak tombolnya masih "Sign attestation to unlock".
  const signF = page.getByRole("button", { name: "Sign attestation", exact: true });
  if ((await signF.count()) > 0) {
    await signF.click();
    await page.waitForTimeout(2200);
  }
  const btnText = await page
    .locator("button", { hasText: /Launch on|Choose an available/ })
    .first()
    .textContent()
    .catch(() => null);
  check("UI memberi tahu chain yang akan dilewati", skipNotice > 0);
  check("tombol hanya menawarkan chain yang tersisa", /Arbitrum/.test(btnText ?? "") && !/Monad/.test(btnText ?? ""), btnText?.replace(/\s+/g, " ").trim());

  // ── ringkasan ─────────────────────────────────────────────────────────────
  step("RINGKASAN");
  const stats = await page.evaluate(async () => {
    const r = await fetch("/api/graphql", { method: "POST" });
    return (await r.json()).data.globalStats;
  });
  console.log(`  registry: ${JSON.stringify(stats)}`);
  console.log(`  page errors: ${pageErrors.length}`);
  [...new Set(pageErrors)].slice(0, 5).forEach((e) => console.log(`    - ${e.slice(0, 150)}`));
  check("tidak ada page error", pageErrors.length === 0);

  console.log(`\n  ${pass} LULUS / ${fail} GAGAL`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error(`\nFATAL: ${e?.shortMessage || e?.message || e}`);
  process.exit(1);
});
