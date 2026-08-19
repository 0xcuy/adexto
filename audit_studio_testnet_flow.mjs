/**
 * Perjalanan pengguna nyata di 0G Testnet, lewat UI yang sebenarnya.
 *
 *   Studio (launch) -> Explorer -> DEX Swap (buy) -> Token Terminal (sell)
 *
 * Semua transaksi benar-benar di-mine di 0G Testnet (chainId 16602) dan
 * ditandatangani lokal dengan kunci deployer. Tidak ada dana mainnet terpakai:
 * server dijalankan dengan OG_PRIVATE_KEY/PRIVATE_KEY dikosongkan sehingga anchor
 * metadata 0G DA tersimulasi.
 *
 * Konfigurasi hanya lewat variabel lingkungan saat runtime — tidak ada file
 * produksi yang diubah.
 */
import { chromium } from "playwright";
import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const RPC = process.env.TEST_RPC || "https://evmrpc-testnet.0g.ai";
const EXPLORER = process.env.TEST_EXPLORER || "https://chainscan-newton.0g.ai";
const CHAIN_ID = Number(process.env.TEST_CHAIN_ID || 16602);
// TEST_SEED dihapus: kurva tidak menerima setoran native sama sekali.
const BUY_AMOUNT = process.env.TEST_BUY || "0.1";
const PK = process.env.TEST_PK || process.env.OG_PRIVATE_KEY || process.env.PRIVATE_KEY;
const TICKER = process.env.TEST_TICKER || `TRIAL${Math.floor(Math.random() * 900 + 100)}`;
const NAME = "Trial Sovereign Agent";

if (!PK) {
  console.error("Butuh OG_PRIVATE_KEY / PRIVATE_KEY di .env.local");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC);
const signer = new ethers.Wallet(PK, provider);

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "LULUS" : "GAGAL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};
const step = (s) => console.log(`\n${"═".repeat(78)}\n${s}\n${"═".repeat(78)}`);
const fmt = (v, d = 18) =>
  Number(ethers.formatUnits(v, d)).toLocaleString("id-ID", { maximumFractionDigits: 4 });

/** Wallet palsu untuk browser: baca diteruskan ke RPC, tulis ditandatangani lokal. */
const WALLET_SHIM = `
window.ethereum = {
  isMetaMask: true,
  _cbs: {},
  on(ev, cb) { (this._cbs[ev] = this._cbs[ev] || []).push(cb); },
  removeListener() {},
  async request({ method, params }) {
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [window.__ACCOUNT__];
    if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
    if (method === "eth_chainId") return "0x" + (${CHAIN_ID}).toString(16);
    return await window.__rpc(method, params || []);
  },
};
`;

(async () => {
  const net = await provider.getNetwork();
  const startBalance = await provider.getBalance(signer.address);
  console.log(`chainId   : ${net.chainId} (${RPC})`);
  console.log(`akun      : ${signer.address}`);
  console.log(`saldo     : ${ethers.formatEther(startBalance)} 0G`);
  console.log(`ticker    : ${TICKER}   beli: ${BUY_AMOUNT}   (tanpa setoran likuiditas)\n`);

  if (Number(net.chainId) !== CHAIN_ID) {
    console.error(`RPC chainId ${net.chainId} != ${CHAIN_ID}`);
    process.exit(1);
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
  const page = await ctx.newPage();

  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  // Serialise writes so nonces cannot race.
  let queue = Promise.resolve();
  const serial = (fn) => {
    queue = queue.then(fn, fn);
    return queue;
  };

  await page.exposeFunction("__rpc", async (method, params) => {
    try {
      if (method === "eth_sendTransaction") {
        return await serial(async () => {
          const p = params[0] || {};
          const tx = await signer.sendTransaction({
            to: p.to ?? undefined,
            data: p.data ?? undefined,
            value: p.value ? BigInt(p.value) : 0n,
            ...(p.gas ? { gasLimit: BigInt(p.gas) } : {}),
          });
          return tx.hash;
        });
      }
      if (method === "personal_sign") {
        return await signer.signMessage(ethers.getBytes(params[0]));
      }
      if (method === "eth_sign") {
        return await signer.signMessage(ethers.getBytes(params[1]));
      }
      return await provider.send(method, params);
    } catch (error) {
      throw new Error(
        error?.shortMessage || error?.info?.error?.message || error?.message || "rpc error"
      );
    }
  });
  await page.addInitScript(`window.__ACCOUNT__ = "${signer.address}";`);
  await ctx.addInitScript(WALLET_SHIM);

  // ── 1. STUDIO ────────────────────────────────────────────────────────────
  step(`1) STUDIO — buat token $${TICKER} di 0G Testnet`);
  await page.goto(`${BASE}/studio`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  const connect = page.locator('button:has-text("Connect wallet")').first();
  if ((await connect.count()) > 0) {
    await connect.click();
    await page.waitForTimeout(1200);
  }
  check("wallet tersambung di UI", (await page.locator(`text=/${signer.address.slice(0, 6)}/i`).count()) > 0);

  const testChainBtn = page.locator('button[title*="0G Testnet"]');
  check("0G Testnet muncul sebagai target yang bisa dipilih", (await testChainBtn.count()) > 0);

  // Chain tanpa factory HARUS terkunci. Jumlah chain terkunci bergantung pada
  // seberapa banyak slot yang dioverride ke testnet, jadi asersinya dibuat
  // sadar-lingkungan: yang wajib benar adalah "tidak ada chain tanpa factory
  // yang bisa dipilih", bukan angka tetap.
  const lockedCount = await page.locator('button[title*="not deployed"]').count();
  const selectableWithoutFactory = await page
    .locator('button[title*="not deployed"]:not([disabled])')
    .count();
  check(
    "tidak ada chain tanpa factory yang bisa dipilih",
    selectableWithoutFactory === 0,
    `${lockedCount} chain terkunci, ${selectableWithoutFactory} bisa diklik`
  );

  // Suite ini menguji alur SATU chain (0G Testnet). Server uji bisa punya
  // beberapa slot yang diarahkan ke testnet, jadi chain lain dimatikan eksplisit
  // agar headline benar-benar "1 of 1" dan tidak ada gas terbuang di chain lain.
  for (const other of ["Arbitrum Sepolia", "Base Sepolia", "Monad Testnet", "Arbitrum One", "Base Mainnet", "Monad"]) {
    const btn = page.locator(`button[title*="${other}"]`).first();
    if ((await btn.count()) === 0) continue;
    if (await btn.isDisabled().catch(() => false)) continue;
    if ((await btn.getAttribute("class"))?.includes("cyan-950")) {
      await btn.click();
      await page.waitForTimeout(250);
    }
  }
  if ((await testChainBtn.count()) > 0 && !(await testChainBtn.first().getAttribute("class"))?.includes("cyan-950")) {
    await testChainBtn.first().click();
    await page.waitForTimeout(250);
  }


  await page.locator('input[value="AQUANT"]').first().fill(TICKER);
  await page.locator('input[value="Aegis Quant AI"]').first().fill(NAME);
  await page.waitForTimeout(1600);
  check("ticker dinyatakan tersedia", (await page.locator("text=available").first().count()) > 0);

  // Tidak ada lagi field seed untuk diisi: FactoryV3 memakai kurva dengan reserve
  // virtual. Yang harus dibuktikan justru sebaliknya — bahwa UI menyatakan nol
  // setoran dan nol alokasi token untuk creator.
  const studioBody = await page.evaluate(() => document.body.innerText);
  check("field seed liquidity sudah tidak ada", !/Seed liquidity/i.test(studioBody));
  check("slider supply split sudah tidak ada", !/Supply into pool/i.test(studioBody));
  check("UI menyatakan tanpa setoran likuiditas", /No liquidity deposit/i.test(studioBody));
  check("UI menyatakan alokasi token creator nol", /Your token allocation/i.test(studioBody));
  check("UI menyatakan porsi pendapatan creator", /Your revenue/i.test(studioBody));

  await page.getByRole("button", { name: "Sign attestation", exact: true }).click();
  await page.waitForTimeout(2500);
  check("attestation ditandatangani & diverifikasi", (await page.locator("text=SIGNED").count()) > 0);

  // Label tombol baru terbentuk setelah ticker dan attestation siap, jadi target
  // launch diverifikasi di sini — tepat sebelum dikirim.
  const launchBtn = page.locator('button:has-text("Launch on")').first();
  const btnLabel = ((await launchBtn.textContent()) ?? "").replace(/\s+/g, " ").trim();
  check("hanya 0G yang jadi target launch", /Launch on 0G\b/.test(btnLabel) && !btnLabel.includes("+"), btnLabel);
  check("tombol menyebut gas only, bukan seed", /gas only/i.test(btnLabel), btnLabel);

  // Biaya launch harus benar-benar hanya gas. Diukur dari saldo native, bukan
  // dipercaya dari label tombol.
  const nativeBeforeLaunch = await provider.getBalance(signer.address);

  console.log("  mengirim transaksi launch ke 0G Testnet…");
  await launchBtn.click();
  // Cocokkan pola umum "live on N of M" supaya timeout tidak menyembunyikan hasil
  // sebenarnya; jumlahnya diperiksa terpisah di bawah.
  await page.waitForSelector("text=/live on \\d+ of \\d+|Launch failed/", { timeout: 240000 });
  const headline =
    (await page.locator("text=/live on \\d+ of \\d+/").first().textContent().catch(() => "")) ?? "";
  check("launch tepat 1 dari 1 chain", /live on 1 of 1/.test(headline), headline.replace(/\s+/g, " ").trim());

  const launched = (await page.locator(`text=/${TICKER} live on/`).count()) > 0;
  check("laporan studio menyatakan launch sukses", launched);
  if (!launched) {
    const err = await page.locator("text=/Launch failed/").locator("..").textContent().catch(() => "");
    console.log(`  detail: ${err.replace(/\s+/g, " ").slice(0, 300)}`);
    await browser.close();
    process.exit(1);
  }

  const report = await page.locator("text=Token:").first().locator("..").locator("..").textContent();
  const tokenAddress = report.match(/Token:\s*(0x[a-fA-F0-9]{40})/)?.[1];
  const poolAddress = report.match(/Pool:\s*(0x[a-fA-F0-9]{40})/)?.[1];
  console.log(`  token : ${tokenAddress}`);
  console.log(`  pool  : ${poolAddress}`);

  check("alamat token diambil dari receipt", Boolean(tokenAddress));
  check("alamat pool diambil dari receipt", Boolean(poolAddress));
  check("kontrak token ada di 0G Testnet", (await provider.getCode(tokenAddress)) !== "0x");
  check("kontrak pool ada di 0G Testnet", (await provider.getCode(poolAddress)) !== "0x");

  // Dulu ini membaca NEXT_PUBLIC_FACTORY_V2_DEVCHAIN — nama env yang salah sama
  // sekali untuk uji 0G, dengan fallback ke alamat FactoryV2 lama. Sekarang
  // menunjuk FactoryV3 0G, dan bisa ditimpa lewat TEST_FACTORY untuk chain lain.
  // FactoryV3 menamai pemetaannya `curveOf`, bukan `poolOf` seperti V2. Memanggil
  // poolOf pada V3 revert tanpa data, yang tampak seperti kegagalan jaringan.
  const factory = new ethers.Contract(
    process.env.TEST_FACTORY || "0xeaC93b76101da1f5F0471fd311Dd7A8d9Ef93632",
    ["function curveOf(address) view returns (address)"],
    provider
  );
  check("factory.curveOf(token) cocok (resolusi on-chain)", (await factory.curveOf(tokenAddress)) === poolAddress);

  const erc20 = new ethers.Contract(
    tokenAddress,
    [
      "function balanceOf(address) view returns (uint256)",
      "function allowance(address,address) view returns (uint256)",
      "function totalSupply() view returns (uint256)",
    ],
    provider
  );
  const pool = new ethers.Contract(
    poolAddress,
    [
      "function getReserves() view returns (uint256,uint256)",
      "function buy(uint256,address,uint256) payable returns (uint256)",
      // Kuotasi kurva mengembalikan EMPAT nilai: depth, creator, buyback.
      "function getBuyQuote(uint256) view returns (uint256,uint256,uint256,uint256)",
      "function virtualNative() view returns (uint256)",
      "function realNative() view returns (uint256)",
      "function creatorOwed() view returns (uint256)",
      "function creator() view returns (address)",
      "function creatorFeeBps() view returns (uint256)",
    ],
    provider
  );

  const [rN, rT] = await pool.getReserves();
  const creatorTokens = await erc20.balanceOf(signer.address);
  const virtualNative = await pool.virtualNative();
  const realNative = await pool.realNative();
  const totalSupply = await erc20.totalSupply();
  console.log(`  reserve kurva : ${fmt(rN)} 0G (virtual ${fmt(virtualNative)} + nyata ${fmt(realNative)}) / ${fmt(rT)} ${TICKER}`);
  console.log(`  token creator : ${fmt(creatorTokens)} ${TICKER}`);

  // Inti model v3, dibalik dari asersi lama:
  check("kurva TIDAK menerima setoran native", realNative === 0n, `${fmt(realNative)}`);
  check("reserve native awal = reserve virtual", rN === virtualNative, `${fmt(rN)}`);
  check("creator memegang NOL token (tidak ada bahan dump)", creatorTokens === 0n, `${fmt(creatorTokens)}`);
  check("100% supply masuk kurva", rT === totalSupply, `${fmt(rT)} / ${fmt(totalSupply)}`);
  check("alamat creator terkunci di kurva", (await pool.creator()).toLowerCase() === signer.address.toLowerCase());
  check("porsi fee creator terpasang", (await pool.creatorFeeBps()) > 0n, `${await pool.creatorFeeBps()} bps`);

  const launchCost = nativeBeforeLaunch - (await provider.getBalance(signer.address));
  console.log(`  biaya launch  : ${fmt(launchCost)} 0G`);
  check("biaya launch hanya gas, bukan modal", launchCost < ethers.parseEther("0.05"), `${fmt(launchCost)} 0G`);

  // ── 2. EXPLORER ──────────────────────────────────────────────────────────
  step("2) EXPLORER — apakah token langsung muncul?");
  await page.goto(`${BASE}/explorer`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);
  check(`$${TICKER} tampil di explorer`, (await page.locator(`text=$${TICKER}`).count()) > 0);

  const card = await page.evaluate(async (sym) => {
    const res = await fetch("/api/graphql", { method: "POST" });
    const json = await res.json();
    return json.data.projects.find((p) => p.symbol === sym) ?? null;
  }, TICKER);
  check("record registry terbentuk", Boolean(card));
  check("verified = true (diverifikasi on-chain)", card?.verified === true);
  check("tradable = true", card?.tradable === true);
  check("harga tersimpan numerik dengan satuan", typeof card?.priceNative === "number" && card.priceNative > 0,
    `${card?.priceNative} ${card?.nativeSymbol}`);
  check("poolAddress tersimpan", card?.poolAddress === poolAddress);
  check(
    "tombol Swap membawa token + chain (?token=&chain=)",
    (await page.locator(`a[href="/swap?token=${TICKER}&chain=${CHAIN_ID}"]`).count()) > 0,
    `/swap?token=${TICKER}&chain=${CHAIN_ID}`
  );

  // ── 3. tunggu window anti-sniper ─────────────────────────────────────────
  step("3) Menunggu window anti-sniper berakhir (batas 1% supply, 5 blok)");
  const buyWei = ethers.parseEther(BUY_AMOUNT);
  const deadline = Date.now() + 180000;
  let allowed = false;
  process.stdout.write("  ");
  while (Date.now() < deadline) {
    try {
      await pool.buy.staticCall(0, signer.address, 0, { value: buyWei, from: signer.address });
      allowed = true;
      break;
    } catch {
      process.stdout.write(".");
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  console.log("");
  check("beli ukuran normal sudah diizinkan", allowed);

  // ── 4. DEX SWAP — BELI ───────────────────────────────────────────────────
  step(`4) DEX SWAP — beli $${TICKER} lewat /swap?token=${TICKER}`);
  await page.goto(`${BASE}/swap?token=${TICKER}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);

  const selected = await page.evaluate(() => {
    const sels = [...document.querySelectorAll("select")];
    const s = sels.find((x) => [...x.options].some((o) => (o.textContent || "").trim().startsWith("$")));
    return s ? s.value : null;
  });
  // Identitas market sekarang (chainId, symbol), jadi nilai select = "16602:TICKER".
  check("market terpilih otomatis dari ?token=", selected === `${CHAIN_ID}:${TICKER}`, String(selected));
  check(
    "tidak ada banner pool tidak tradable",
    (await page.locator("text=No executable pool").count()) === 0
  );

  const swapConnect = page.locator('button:has-text("Connect wallet to swap")');
  if ((await swapConnect.count()) > 0) {
    await swapConnect.first().click();
    await page.waitForTimeout(2000);
  }

  await page.locator('input[type="number"]').first().fill(BUY_AMOUNT);
  await page.waitForTimeout(2000);
  const receivePanel = await page.locator("text=You receive").locator("..").locator("..").textContent();
  console.log(`  panel: ${receivePanel.replace(/\s+/g, " ").slice(0, 200)}`);
  check("estimasi output, minimum received & price impact tampil",
    /Minimum received/.test(receivePanel) && /Price impact/.test(receivePanel));

  const balBeforeBuy = await erc20.balanceOf(signer.address);
  const buyBtn = page.locator("button", { hasText: new RegExp(`^Buy \\$${TICKER}$`) });
  check("tombol Buy aktif", (await buyBtn.count()) > 0 && !(await buyBtn.first().isDisabled()));

  console.log("  mengirim transaksi beli…");
  await buyBtn.first().click();
  await page.waitForSelector("text=/Swap settled|would fail on-chain|Rejected/", { timeout: 180000 });
  await page.waitForTimeout(4000);

  const balAfterBuy = await erc20.balanceOf(signer.address);
  const bought = balAfterBuy - balBeforeBuy;
  check("konfirmasi 'Swap settled' tampil", (await page.locator("text=Swap settled").count()) > 0);
  check("SALDO TOKEN NAIK setelah beli", bought > 0n, `+${fmt(bought)} ${TICKER}`);

  const buyTxLink = await page
    .locator('a[href*="/tx/"]')
    .first()
    .getAttribute("href")
    .catch(() => null);
  if (buyTxLink) console.log(`  tx beli: ${buyTxLink}`);

  // ── 5. TERMINAL — chart, depth, lalu JUAL ────────────────────────────────
  step(`5) TERMINAL /token/${TICKER.toLowerCase()} — chart, depth, lalu jual`);
  await page.goto(`${BASE}/token/${TICKER.toLowerCase()}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(6000);

  check("judul token benar", (await page.locator("h1").first().textContent()).includes(NAME));
  check("chart ter-render", (await page.locator("canvas").count()) > 0);
  check("order book memakai reserve nyata", (await page.locator("text=Reserves").count()) > 0);
  check("sumber chart on-chain", (await page.locator("text=on-chain Swap events").count()) > 0);

  const priceRow = await page.locator("text=Price USD").locator("..").textContent();
  const mcapRow = await page.locator("text=Market cap").locator("..").textContent();
  console.log(`  ${priceRow?.replace(/\s+/g, " ")} | ${mcapRow?.replace(/\s+/g, " ")}`);

  const tradeConnect = page.locator('button:has-text("Connect wallet to trade")');
  if ((await tradeConnect.count()) > 0) {
    await tradeConnect.first().click();
    await page.waitForTimeout(2000);
  }

  await page.locator('button:has-text("SELL")').first().click();
  await page.waitForTimeout(1200);

  const sellAmount = bought / 3n;
  await page.locator('input[type="number"]').first().fill(ethers.formatUnits(sellAmount, 18));
  await page.waitForTimeout(2000);

  const payPanel = await page.locator("text=You pay").locator("..").locator("..").textContent();
  check("mode jual memakai token sebagai input", new RegExp(TICKER).test(payPanel));

  const nativeBeforeSell = await provider.getBalance(signer.address);
  const tokenBeforeSell = await erc20.balanceOf(signer.address);

  const sellBtn = page.locator("button", { hasText: new RegExp(`^Approve & sell \\$${TICKER}$`) });
  check("tombol jual memakai jalur approve", (await sellBtn.count()) > 0);
  console.log("  mengirim approve lalu jual…");
  await sellBtn.first().click();
  await page.waitForSelector("text=/Received .* 0G|would fail on-chain|Rejected|Insufficient/", { timeout: 240000 });
  await page.waitForTimeout(5000);

  const nativeAfterSell = await provider.getBalance(signer.address);
  const tokenAfterSell = await erc20.balanceOf(signer.address);
  const tokenDelta = tokenBeforeSell - tokenAfterSell;
  const nativeDelta = nativeAfterSell - nativeBeforeSell;

  check("SALDO TOKEN TURUN sesuai jumlah jual", tokenDelta > 0n, `-${fmt(tokenDelta)} ${TICKER}`);
  check("SALDO NATIVE NAIK (bukan turun)", nativeDelta > 0n,
    `${nativeDelta > 0n ? "+" : ""}${ethers.formatEther(nativeDelta).slice(0, 12)} 0G setelah gas`);
  check("allowance habis terpakai", (await erc20.allowance(signer.address, poolAddress)) === 0n);

  // ── 6. PENGHASILAN CREATOR ───────────────────────────────────────────────
  // Ini pengganti alokasi token gratis, jadi harus dibuktikan benar-benar
  // terakumulasi dan benar-benar bisa ditarik — bukan hanya angka di layar.
  step("6) PENGHASILAN CREATOR — akumulasi dari fee lalu diklaim lewat UI");
  const owed = await pool.creatorOwed();
  check("fee creator terakumulasi dari perdagangan", owed > 0n, `${ethers.formatEther(owed)} 0G`);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(4000);
  const hasRevenuePanel = (await page.locator("text=Your creator revenue").count()) > 0;
  check("panel penghasilan creator tampil bagi creator", hasRevenuePanel);

  if (hasRevenuePanel && owed > 0n) {
    const claimBtn = page.locator('button:has-text("Claim")').first();
    await claimBtn.scrollIntoViewIfNeeded();
    check("tombol Claim aktif", !(await claimBtn.isDisabled()));
    await claimBtn.click();
    await page.waitForTimeout(8000);
    check("utang creator jadi nol setelah klaim", (await pool.creatorOwed()) === 0n, `${ethers.formatEther(await pool.creatorOwed())} 0G`);
  }

  const [finalN, finalT] = await pool.getReserves();
  console.log(`  reserve akhir: ${fmt(finalN)} 0G / ${fmt(finalT)} ${TICKER}`);

  // ── ringkasan ────────────────────────────────────────────────────────────
  step("RINGKASAN");
  console.log(`  page errors: ${pageErrors.length}`);
  [...new Set(pageErrors)].slice(0, 5).forEach((e) => console.log(`    - ${e.slice(0, 160)}`));
  check("tidak ada page error", pageErrors.length === 0);

  const spent = startBalance - (await provider.getBalance(signer.address));
  console.log(`\n  Terpakai di 0G Testnet : ${ethers.formatEther(spent)} 0G (dana uji)`);
  console.log(`\n  Verifikasi manual:`);
  console.log(`    token : ${EXPLORER}/address/${tokenAddress}`);
  console.log(`    pool  : ${EXPLORER}/address/${poolAddress}`);

  console.log(`\n  ${pass} LULUS / ${fail} GAGAL`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error(`\nFATAL: ${e?.shortMessage || e?.message || e}`);
  process.exit(1);
});
