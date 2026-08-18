/**
 * ADEXTO — end-to-end verification of the audit fixes.
 *
 * Runs the real UI against a local devchain, so launches and swaps are genuinely
 * mined and balances genuinely move. No mainnet gas is involved.
 *
 * Prerequisites:
 *   1. cd devchain && npx hardhat node
 *   2. node scripts/compile-contracts.mjs --via-ir
 *   3. node scripts/deploy-sovereign-dex.mjs --chain devchain --broadcast
 *   4. next start with NEXT_PUBLIC_DEVCHAIN_RPC + NEXT_PUBLIC_FACTORY_V2_DEVCHAIN
 *
 * The injected wallet is a thin proxy onto the devchain's unlocked account #0, so
 * eth_sendTransaction and personal_sign are handled by the node itself.
 */
import { chromium } from "playwright";
import { ethers } from "ethers";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const RPC = process.env.DEVCHAIN_RPC || "http://127.0.0.1:8545";
const ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
/**
 * Kunci akun #0 Hardhat. Ini kunci uji yang DIPUBLIKASIKAN Hardhat dan hanya
 * berlaku di devchain lokal — bukan rahasia, jangan pernah dipakai di jaringan
 * nyata. Dibutuhkan hanya untuk menandatangani attestation launch di harness.
 */
const DEVCHAIN_TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const attSigner = new ethers.Wallet(DEVCHAIN_TEST_KEY);
const TICKER = process.env.TEST_TICKER || `E2E${Math.floor(Math.random() * 900 + 100)}`;

const provider = new ethers.JsonRpcProvider(RPC);

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};
const step = (s) => console.log(`\n${"=".repeat(78)}\n${s}\n${"=".repeat(78)}`);

const WALLET_SHIM = `
window.ethereum = {
  isMetaMask: true,
  _cbs: {},
  on(ev, cb) { (this._cbs[ev] = this._cbs[ev] || []).push(cb); },
  removeListener() {},
  async request({ method, params }) {
    if (method === "eth_requestAccounts" || method === "eth_accounts") return ["${ACCOUNT}"];
    if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
    return await window.__rpc(method, params || []);
  },
};
`;

(async () => {
  const net = await provider.getNetwork();
  console.log(`devchain chainId=${net.chainId}  account=${ACCOUNT}  ticker=${TICKER}\n`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
  const page = await ctx.newPage();

  await page.exposeFunction("__rpc", async (method, params) => {
    try {
      return await provider.send(method, params);
    } catch (error) {
      throw new Error(error?.shortMessage || error?.info?.error?.message || error?.message || "rpc error");
    }
  });
  await ctx.addInitScript(WALLET_SHIM);

  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  // Sertakan URL saat error terjadi: tanpa ini, error dari navigasi di dalam
  // aplikasi tidak bisa dilacak ke halaman mana pun.
  page.on("pageerror", (e) => pageErrors.push(`${e.message}  @ ${page.url()}`));

  // ── 1. unknown slug must 404 ──────────────────────────────────────────────
  step("1) Ghost market page — /token/tidakada harus 404");
  const ghost = await page.goto(`${BASE}/token/tidakada`, { waitUntil: "networkidle" });
  check("HTTP status 404", ghost.status() === 404, `got ${ghost.status()}`);
  const ghostHtml = await page.content();
  check("copy 'Market not found' tampil", ghostHtml.includes("Market not found"));
  check(
    "tidak ada tombol Buy",
    (await page.locator("button", { hasText: /^Buy \$/ }).count()) === 0
  );

  // ── 2. unauthenticated telemetry write ────────────────────────────────────
  step("2) POST /api/agent/telemetry tanpa kredensial");
  await page.goto(`${BASE}/explorer`, { waitUntil: "domcontentloaded" });
  const telemetryProbe = await page.evaluate(async () => {
    const res = await fetch("/api/agent/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        txHash: "0x" + "9".repeat(64),
        type: "BUY",
        symbol: "AEGIS",
        amountToken: 999999999,
        amountNative: 1,
        chainId: 16661,
      }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  });
  check(
    "ditolak (401/403/503)",
    [401, 403, 503].includes(telemetryProbe.status),
    `status ${telemetryProbe.status}: ${String(telemetryProbe.body.error).slice(0, 90)}`
  );
  const feedAfter = await page.evaluate(async () => {
    const res = await fetch("/api/agent/telemetry?symbol=AEGIS");
    const json = await res.json();
    return json.trades?.map((t) => t.amountToken) ?? [];
  });
  check("feed tidak terkontaminasi", !feedAfter.includes(999999999));

  const badToken = await page.evaluate(async () => {
    const res = await fetch("/api/agent/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer wrong-secret-value-1234567890" },
      body: JSON.stringify({ txHash: "0x" + "8".repeat(64), type: "BUY", symbol: "AEGIS", amountToken: 1, amountNative: 1 }),
    });
    return res.status;
  });
  check("bearer token salah ditolak", [401, 403, 503].includes(badToken), `status ${badToken}`);

  // ── 3. symbol squatting ───────────────────────────────────────────────────
  step("3) Symbol squatting — klaim ticker AEGIS lewat /api/deploy");
  // Attestation diverifikasi SEBELUM pemeriksaan symbol, jadi tanpa tanda tangan
  // sah permintaan ini berhenti di 401 dan proteksi ticker cadangan tidak pernah
  // benar-benar teruji. Di sini attestation dibuat sah lebih dulu supaya 409 yang
  // muncul memang berasal dari aturan symbol.
  const attMessage = `ADEXTO launch attestation\nDeployer: ${attSigner.address}\nTimestamp: ${Date.now()}`;
  const attSignature = await attSigner.signMessage(attMessage);
  const squat = await page.evaluate(
    async ({ msg, sig, addr }) => {
      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "prepare",
          name: "FAKE Aegis",
          symbol: "AEGIS",
          supply: "1000000000",
          deployer: addr,
          attestationMessage: msg,
          attestationSignature: sig,
        }),
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    },
    { msg: attMessage, sig: attSignature, addr: attSigner.address }
  );
  check(
    "ticker cadangan ditolak (409)",
    squat.status === 409,
    `status ${squat.status}: ${String(squat.body.error).slice(0, 80)}`
  );

  const noAttestation = await page.evaluate(async () => {
    const res = await fetch("/api/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: "prepare", name: "Nice Try", symbol: "NOSIG", supply: "1000000000" }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  });
  check(
    "prepare tanpa attestation ditolak (401)",
    noAttestation.status === 401,
    `status ${noAttestation.status}: ${String(noAttestation.body.error).slice(0, 80)}`
  );

  const fakeConfirm = await page.evaluate(async () => {
    const res = await fetch("/api/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stage: "confirm",
        chainId: 16661,
        txHash: "0x" + "1".repeat(64),
        symbol: "GHOSTX",
        name: "Ghost",
        supply: "1000000000",
      }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  });
  check(
    "confirm dengan txHash palsu ditolak",
    fakeConfirm.status >= 400,
    `status ${fakeConfirm.status}: ${String(fakeConfirm.body.error).slice(0, 80)}`
  );

  // ── 4. launch via studio on the devchain ─────────────────────────────────
  step(`4) Studio — luncurkan $${TICKER} di devchain (transaksi nyata)`);
  await page.goto(`${BASE}/studio`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  const connectBtn = page.locator('button:has-text("Connect wallet")').first();
  if ((await connectBtn.count()) > 0) {
    await connectBtn.click();
    await page.waitForTimeout(900);
  }
  check("wallet tersambung", (await page.locator(`text=/${ACCOUNT.slice(0, 6)}/i`).count()) > 0);

  const devchainToggle = page.locator('button[title*="Local Devchain"]');
  check("Devchain tersedia sebagai target", (await devchainToggle.count()) > 0);

  // Select only the devchain.
  for (const key of ["0G", "Arbitrum", "Base", "Monad"]) {
    const btn = page.locator(`button[title*="${key}"]`).first();
    if ((await btn.count()) > 0 && !(await btn.isDisabled())) await btn.click().catch(() => {});
  }
  await page.waitForTimeout(300);

  const tickerInput = page.locator('input[value="AQUANT"]').first();
  await tickerInput.fill(TICKER);
  await page.waitForTimeout(1200);
  const tickerHint = await page.locator("text=available").first().count();
  check("ticker baru dinyatakan available", tickerHint > 0);

  await page.locator('input[value="Aegis Quant AI"]').first().fill("E2E Verified Agent");
  const seedInput = page.locator('input[type="number"]').first();
  await seedInput.fill("5");

  const deployBtnBefore = page.locator("button", { hasText: /Sign attestation to unlock|Launch on/ }).first();
  check("deploy terkunci sebelum attestation", /Sign attestation/.test(await deployBtnBefore.textContent()));

  await page.getByRole("button", { name: "Sign attestation", exact: true }).click();
  await page.waitForTimeout(1500);
  check("attestation ditandatangani", (await page.locator("text=SIGNED").count()) > 0);

  await page.locator('button:has-text("Launch on")').click();
  await page.waitForSelector("text=/live on 1 of 1|Launch failed/", { timeout: 120000 });

  const launched = (await page.locator(`text=/${TICKER} live on/`).count()) > 0;
  check("laporan deploy menyatakan sukses", launched);

  const reportText = await page.locator("text=Token:").first().locator("..").locator("..").textContent();
  const tokenMatch = reportText.match(/Token:\s*(0x[a-fA-F0-9]{40})/);
  const poolMatch = reportText.match(/Pool:\s*(0x[a-fA-F0-9]{40})/);
  const tokenAddress = tokenMatch?.[1];
  const poolAddress = poolMatch?.[1];
  console.log(`    token=${tokenAddress}\n    pool =${poolAddress}`);

  check("alamat token 20-byte diambil dari receipt", Boolean(tokenAddress));
  check("alamat pool diambil dari receipt", Boolean(poolAddress));

  if (tokenAddress) {
    const code = await provider.getCode(tokenAddress);
    check("kontrak token BENAR ADA di chain", code !== "0x", `${(code.length - 2) / 2} bytes`);
  }
  if (poolAddress) {
    const poolCode = await provider.getCode(poolAddress);
    check("kontrak pool BENAR ADA di chain", poolCode !== "0x", `${(poolCode.length - 2) / 2} bytes`);
  }

  // ── 5. explorer + registry ────────────────────────────────────────────────
  step("5) Explorer & registry");
  await page.goto(`${BASE}/explorer`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  check(`$${TICKER} tampil di explorer`, (await page.locator(`text=$${TICKER}`).count()) > 0);
  check("badge pool live tampil", (await page.locator("text=live").count()) > 0);

  const registry = await page.evaluate(async () => {
    const res = await fetch("/api/graphql", { method: "POST" });
    const json = await res.json();
    return json.data;
  });
  const record = registry.projects.find((p) => p.symbol === TICKER);
  check("registry punya record", Boolean(record));
  check("priceNative numerik > 0", typeof record?.priceNative === "number" && record.priceNative > 0, String(record?.priceNative));
  check("nativeSymbol tersimpan", Boolean(record?.nativeSymbol), record?.nativeSymbol);
  check("verified = true", record?.verified === true);
  check("tradable = true", record?.tradable === true);
  check("registry durable", registry.registry?.durable === true);

  const dupSymbols = registry.projects.map((p) => p.symbol);
  check("tidak ada symbol duplikat", new Set(dupSymbols).size === dupSymbols.length);

  // Curated markets must report honestly.
  const qnova = registry.projects.find((p) => p.symbol === "QNOVA");
  check("QNOVA priceNative dalam satuan native (0.00018)", Math.abs((qnova?.priceNative ?? 0) - 0.00018) < 1e-9);
  check("QNOVA tidak diklaim tradable", qnova?.tradable === false);

  // ── 6. token terminal + BUY ───────────────────────────────────────────────
  step(`6) Terminal /token/${TICKER.toLowerCase()} — BUY nyata`);
  await page.goto(`${BASE}/token/${TICKER.toLowerCase()}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  check("judul benar", (await page.locator("h1").first().textContent()).includes("E2E Verified Agent"));
  check("chart canvas ter-render", (await page.locator("canvas").count()) > 0);
  check("order book memakai reserve nyata", (await page.locator("text=Reserves").count()) > 0);
  check(
    "tidak ada banner 'no executable pool'",
    (await page.locator("text=No executable pool").count()) === 0
  );

  const priceUsdText = await page.locator("text=Price USD").locator("..").textContent();
  const priceNativeText = await page.locator("text=/^Price \\(ETH\\)$/").locator("..").textContent();
  console.log(`    ${priceNativeText?.replace(/\s+/g, " ")} | ${priceUsdText?.replace(/\s+/g, " ")}`);
  const mcapText = await page.locator("text=Market cap").locator("..").textContent();
  check("Market cap dalam USD (bukan jumlah supply)", /\$/.test(mcapText) && !new RegExp(TICKER).test(mcapText), mcapText?.replace(/\s+/g, " "));

  const tradeConnect = page.locator('button:has-text("Connect wallet to trade")');
  if ((await tradeConnect.count()) > 0) {
    await tradeConnect.first().click().catch(() => {});
    await page.waitForTimeout(1500);
  }

  const erc20 = new ethers.Contract(
    tokenAddress,
    ["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"],
    provider
  );
  const balanceBeforeBuy = await erc20.balanceOf(ACCOUNT);

  const payInput = page.locator('input[type="number"]').first();
  await payInput.fill("1");
  await page.waitForTimeout(1200);

  const receivePanel = await page.locator("text=You receive").locator("..").locator("..").textContent();
  console.log(`    panel: ${receivePanel.replace(/\s+/g, " ").slice(0, 190)}`);
  check("estimasi output > 0", !/^You receive[^0-9]*0\s*\$/.test(receivePanel.replace(/\s+/g, " ")));
  check("menampilkan minimum received", /Minimum received/.test(receivePanel));
  check("menampilkan price impact", /Price impact/.test(receivePanel));

  const buyBtn = page.locator("button", { hasText: new RegExp(`^Buy \\$${TICKER}$`) });
  check("tombol Buy aktif", (await buyBtn.count()) > 0 && !(await buyBtn.first().isDisabled()));

  // First attempt lands inside the token's anti-sniper window (>1% of supply within
  // 5 blocks of launch). The preflight staticCall must refuse it with a readable
  // reason and no transaction must be sent.
  const nativeBeforeBlocked = await provider.getBalance(ACCOUNT);
  await buyBtn.first().click();
  await page.waitForTimeout(6000);
  const blockedError = await page
    .locator("text=/Anti-sniper|would fail on-chain/")
    .first()
    .textContent()
    .catch(() => "");
  const balanceAfterBlocked = await erc20.balanceOf(ACCOUNT);
  const nativeAfterBlocked = await provider.getBalance(ACCOUNT);
  if (blockedError) {
    check("anti-sniper ditolak dengan alasan jelas", blockedError.length > 0, blockedError.slice(0, 110));
    check("tidak ada token berpindah saat ditolak", balanceAfterBlocked === balanceBeforeBuy);
    check(
      "tidak ada gas terbakar saat ditolak (preflight)",
      nativeAfterBlocked === nativeBeforeBlocked,
      "saldo native tidak berubah"
    );
    // Skip past the anti-sniper window the way wall-clock blocks would.
    for (let i = 0; i < 6; i++) await provider.send("evm_mine", []);
    console.log("    6 blok di-mine, window anti-sniper selesai");
    await page.waitForTimeout(1500);
    await payInput.fill("1");
    await page.waitForTimeout(1200);
    await buyBtn.first().click();
    await page.waitForTimeout(9000);
  }

  const balanceAfterBuy = await erc20.balanceOf(ACCOUNT);
  const bought = balanceAfterBuy - balanceBeforeBuy;
  check(
    "SALDO TOKEN NAIK setelah BUY",
    bought > 0n,
    `+${Number(ethers.formatUnits(bought, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${TICKER}`
  );
  const buyStatus = await page.locator("text=/^Received /").first().textContent().catch(() => "");
  console.log(`    status: ${buyStatus.replace(/\s+/g, " ").slice(0, 130)}`);

  // ── 7. SELL ───────────────────────────────────────────────────────────────
  step("7) SELL nyata — approve + transferFrom, tanpa native keluar");
  await page.locator('button:has-text("SELL")').first().click();
  await page.waitForTimeout(800);

  const sellAmountTokens = bought / 3n;
  const sellAmountText = ethers.formatUnits(sellAmountTokens, 18);
  await payInput.fill(sellAmountText);
  await page.waitForTimeout(1200);

  const payPanelSell = await page.locator("text=You pay").locator("..").locator("..").textContent();
  check("mode SELL memakai token sebagai input", new RegExp(TICKER).test(payPanelSell), payPanelSell.replace(/\s+/g, " ").slice(0, 120));

  const nativeBeforeSell = await provider.getBalance(ACCOUNT);
  const tokenBeforeSell = await erc20.balanceOf(ACCOUNT);

  const sellBtn = page.locator("button", { hasText: new RegExp(`^Approve & sell \\$${TICKER}$`) });
  check("tombol sell memakai jalur approve", (await sellBtn.count()) > 0);
  await sellBtn.first().click();
  await page.waitForTimeout(14000);

  const nativeAfterSell = await provider.getBalance(ACCOUNT);
  const tokenAfterSell = await erc20.balanceOf(ACCOUNT);
  const tokenDelta = tokenBeforeSell - tokenAfterSell;
  const nativeDelta = nativeAfterSell - nativeBeforeSell;

  check(
    "SALDO TOKEN TURUN sesuai jumlah jual",
    tokenDelta > 0n && tokenDelta <= sellAmountTokens + 1n,
    `-${Number(ethers.formatUnits(tokenDelta, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${TICKER}`
  );
  check(
    "SALDO NATIVE NAIK (bukan turun 50.000 seperti bug lama)",
    nativeDelta > 0n,
    `${nativeDelta > 0n ? "+" : ""}${Number(ethers.formatEther(nativeDelta)).toFixed(6)} ETH (sudah dikurangi gas)`
  );
  check("allowance terpakai habis", (await erc20.allowance(ACCOUNT, poolAddress)) === 0n);

  // ── 8. swap page ──────────────────────────────────────────────────────────
  step("8) /swap — daftar market, ?token=, dan swap nyata");
  await page.goto(`${BASE}/swap?token=${TICKER}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const marketOptions = await page.evaluate(() => {
    const sels = [...document.querySelectorAll("select")];
    const s = sels.find((x) => [...x.options].some((o) => (o.textContent || "").trim().startsWith("$")));
    return s ? { selected: s.value, options: [...s.options].map((o) => o.value) } : null;
  });
  console.log(`    market terpilih=${marketOptions?.selected} opsi=${JSON.stringify(marketOptions?.options)}`);
  // Identitas market sekarang "<chainId>:<SYMBOL>" karena satu ticker bisa hidup
  // di beberapa chain sebagai market terpisah.
  check(
    "?token= menghormati pilihan",
    Boolean(marketOptions?.selected?.endsWith(`:${TICKER}`)),
    String(marketOptions?.selected)
  );
  check(
    "token bawaan tetap ada di daftar",
    ["AEGIS", "QNOVA", "CSENT"].every((s) => marketOptions?.options.some((o) => o.endsWith(`:${s}`))),
    JSON.stringify(marketOptions?.options)
  );
  check("tidak ada opsi duplikat", new Set(marketOptions?.options).size === marketOptions?.options.length);

  const swapConnect = page.locator('button:has-text("Connect wallet to swap")');
  if ((await swapConnect.count()) > 0) {
    await swapConnect.first().click().catch(() => {});
    await page.waitForTimeout(1500);
  }

  const swapBalanceBefore = await erc20.balanceOf(ACCOUNT);
  await page.locator('input[type="number"]').first().fill("0.5");
  await page.waitForTimeout(1200);
  const swapBtn = page.locator("button", { hasText: new RegExp(`^Buy \\$${TICKER}$`) });
  check("tombol swap aktif untuk market tradable", (await swapBtn.count()) > 0);
  await swapBtn.first().click();
  await page.waitForTimeout(9000);
  const swapBalanceAfter = await erc20.balanceOf(ACCOUNT);
  check(
    "swap dari /swap menambah saldo token",
    swapBalanceAfter > swapBalanceBefore,
    `+${Number(ethers.formatUnits(swapBalanceAfter - swapBalanceBefore, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  );
  check("konfirmasi 'Swap settled' tampil", (await page.locator("text=Swap settled").count()) > 0);

  // ── 9. market tanpa pool harus terkunci ───────────────────────────────────
  step("9) Market tanpa pool (/token/qnova) harus terkunci, bukan kirim tx");
  await page.goto(`${BASE}/token/qnova`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const lockedMsg = await page.locator("text=/Trading is disabled|no SovereignHook pool|does not expose/").first().textContent().catch(() => "");
  check("alasan pool tidak tradable dijelaskan", lockedMsg.length > 0, lockedMsg.slice(0, 120));
  const tradingUnavailable = await page.locator('button:has-text("Trading unavailable")').count();
  check("tombol trading dinonaktifkan", tradingUnavailable > 0);
  check("showcase entry ditandai", (await page.locator("text=Showcase entry").count()) > 0);

  // ── 10. chart data source ─────────────────────────────────────────────────
  step("10) Chart memakai data on-chain nyata");
  const telemetry = await page.evaluate(async (sym) => {
    const res = await fetch(`/api/agent/telemetry?symbol=${sym}`);
    return res.json();
  }, TICKER);
  check("source = onchain", telemetry.source === "onchain", `source=${telemetry.source}`);
  check("trade tercatat dari event Swap", telemetry.totalTrades >= 3, `${telemetry.totalTrades} fills`);
  check("candle terbentuk", Array.isArray(telemetry.candles) && telemetry.candles.length > 0, `${telemetry.candles?.length} candles`);
  const times = (telemetry.candles ?? []).map((c) => c.time);
  check("candle terurut naik (aman untuk lightweight-charts)", times.every((t, i) => i === 0 || t > times[i - 1]));
  const varied = new Set((telemetry.candles ?? []).map((c) => c.close)).size;
  check("harga candle bervariasi (bukan garis datar)", varied > 1, `${varied} harga close unik`);
  check("changePct dihitung dari data", typeof telemetry.changePct === "number", `${telemetry.changePct?.toFixed(2)}%`);

  await page.goto(`${BASE}/token/${TICKER.toLowerCase()}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  check("badge % bukan +14.8% hardcoded", (await page.locator("text=+14.8%").count()) === 0);
  check("label sumber 'on-chain Swap events'", (await page.locator("text=on-chain Swap events").count()) > 0);

  // ── summary ───────────────────────────────────────────────────────────────
  step("RINGKASAN");
  const realErrors = [...new Set(consoleErrors)].filter(
    (e) => !/favicon|Failed to load resource|net::ERR/i.test(e)
  );
  console.log(`  console errors: ${realErrors.length}`);
  realErrors.slice(0, 8).forEach((e) => console.log(`    - ${e.slice(0, 200)}`));
  console.log(`  page errors: ${pageErrors.length}`);
  [...new Set(pageErrors)].slice(0, 8).forEach((e) => console.log(`    - ${e.slice(0, 200)}`));
  check("tidak ada page error", pageErrors.length === 0);

  console.log(`\n  ${pass} PASS / ${fail} FAIL`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
