/**
 * Membuktikan alur v3 lewat UI: launch TANPA setoran, lalu beli, lalu creator
 * mengklaim penghasilannya — semuanya dengan transaksi sungguhan.
 *
 *   cd devchain && npx hardhat node
 *   node scripts/deploy-sovereign-curve.mjs --chain devchain --broadcast
 *   NEXT_PUBLIC_CURVE_FACTORY_DEVCHAIN=<addr> ... npx next start -p 3101
 *   node audit_curve_ui_flow.mjs
 */
import { chromium } from "playwright";
import { ethers } from "ethers";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3101";
const RPC = process.env.DEVCHAIN_RPC || "http://127.0.0.1:8545";
/** Kunci akun #0 Hardhat: kunci uji publik, hanya berlaku di devchain lokal. */
const PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TICKER = `CUI${Math.floor(Math.random() * 900 + 100)}`;

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "LULUS" : "GAGAL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};
const step = (s) => console.log(`\n${s}`);

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PK, provider);
const ACCOUNT = wallet.address;

const SHIM = `
window.ethereum = {
  isMetaMask: true, _cbs: {},
  on(ev, cb) { (this._cbs[ev] = this._cbs[ev] || []).push(cb); },
  removeListener() {},
  async request({ method, params }) {
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [window.__ACCOUNT__];
    return await window.__rpc(method, params || []);
  },
};
`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

let queue = Promise.resolve();
const serial = (fn) => ((queue = queue.then(fn, fn)), queue);
await page.exposeFunction("__rpc", async (method, params) => {
  try {
    if (method === "personal_sign") return await wallet.signMessage(ethers.getBytes(params[0]));
    if (method === "eth_sign") return await wallet.signMessage(ethers.getBytes(params[1]));
    if (method === "eth_sendTransaction") {
      return await serial(async () => {
        const p = params[0] || {};
        const tx = await wallet.sendTransaction({
          to: p.to ?? undefined,
          data: p.data ?? undefined,
          value: p.value ? BigInt(p.value) : 0n,
          ...(p.gas ? { gasLimit: BigInt(p.gas) } : {}),
        });
        return tx.hash;
      });
    }
    return await provider.send(method, params);
  } catch (e) {
    throw new Error(e?.shortMessage || e?.info?.error?.message || e?.message || "rpc error");
  }
});
await page.addInitScript(`window.__ACCOUNT__ = "${ACCOUNT}";`);
await ctx.addInitScript(SHIM);

// ── 1. Studio: launch tanpa setoran ─────────────────────────────────────────
step(`1) STUDIO — launch $${TICKER} tanpa setoran native`);
// `networkidle` diganti `domcontentloaded` + tunggu elemen di seluruh berkas ini.
//
// Alasannya diukur, bukan ditebak: halaman token mengirim 45 request dalam 20
// detik dengan celah idle terpanjang 9,9 DETIK — jadi jaringan jelas pernah
// senggang, tapi `page.reload({waitUntil:"networkidle"})` tetap timeout 30s.
// `networkidle` memang sudah tidak dianjurkan Playwright karena tepat perilaku
// ini. Menunggu elemen yang memang dibutuhkan langkahnya lebih deterministik
// DAN lebih ketat: ia gagal kalau UI-nya tidak muncul, bukan cuma kalau
// jaringannya ramai.
await page.goto(`${BASE}/studio`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('button:has-text("Connect wallet"), button:has-text("Launch on")', {
  timeout: 30000,
});

const connect = page.locator('button:has-text("Connect wallet")').first();
if ((await connect.count()) > 0) {
  await connect.click();
  await page.waitForTimeout(1500);
}
check("wallet tersambung", (await page.locator(`text=/${ACCOUNT.slice(0, 6)}/i`).count()) > 0);

const body = await page.evaluate(() => document.body.innerText);
check("tidak ada lagi field seed liquidity", !/Seed liquidity/i.test(body));
check("tidak ada lagi slider supply split", !/Supply into pool/i.test(body));
check("menyatakan tanpa setoran likuiditas", /No liquidity deposit/i.test(body));
check("menampilkan alokasi token creator = 0", /Your token allocation/i.test(body));

await page.locator('input[value="AQUANT"]').first().fill(TICKER);
await page.locator('input[value="Aegis Quant AI"]').first().fill("Curve UI Agent");
await page.waitForTimeout(2200);

await page.getByRole("button", { name: "Sign attestation", exact: true }).click();
await page.waitForSelector("text=SIGNED", { timeout: 60000 });
await page.waitForTimeout(1200);

const btnLabel = ((await page.locator('button:has-text("Launch on")').first().textContent()) ?? "").replace(/\s+/g, " ").trim();
console.log(`  tombol: ${btnLabel}`);
check("tombol menyebut gas only, bukan seed", /gas only/i.test(btnLabel), btnLabel);

const nativeBefore = await provider.getBalance(ACCOUNT);
await page.locator('button:has-text("Launch on")').first().click();
await page.waitForSelector("text=/live on \\d+ of \\d+|Launch failed/", { timeout: 240000 });
await page.waitForTimeout(3000);
const headline = ((await page.locator("text=/live on \\d+ of \\d+/").first().textContent()) ?? "").trim();
console.log(`  hasil : ${headline}`);
check("launch sukses", /live on 1 of 1/.test(headline), headline);

// ── 2. Registry & distribusi supply ────────────────────────────────────────
step("2) REGISTRY & SUPPLY");
const rec = await page.evaluate(async (sym) => {
  const r = await fetch("/api/graphql", { method: "POST" });
  const j = await r.json();
  return (j.data.projects || []).find((p) => p.symbol === sym) ?? null;
}, TICKER);
check("market terdaftar", Boolean(rec), rec ? `${rec.tokenAddress}` : "tidak ada");
check("pool live", rec?.poolLive === true);

const ERC20 = ["function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)"];
const CURVE = [
  "function realNative() view returns (uint256)",
  "function virtualNative() view returns (uint256)",
  "function creatorOwed() view returns (uint256)",
  "function creator() view returns (address)",
  "function getReserves() view returns (uint256,uint256)",
];
const token = new ethers.Contract(rec.tokenAddress, ERC20, provider);
const curve = new ethers.Contract(rec.poolAddress, CURVE, provider);

const total = await token.totalSupply();
const inCurve = await token.balanceOf(rec.poolAddress);
const creatorHolds = await token.balanceOf(ACCOUNT);
check("100% supply di kurva", inCurve === total, `${ethers.formatUnits(inCurve, 18)}`);
check("creator memegang nol token", creatorHolds === 0n);
check("kurva mulai dengan nol native nyata", (await curve.realNative()) === 0n);
check("reserve virtual terpasang", (await curve.virtualNative()) > 0n, `${ethers.formatEther(await curve.virtualNative())}`);
check("creator tercatat di kurva", (await curve.creator()).toLowerCase() === ACCOUNT.toLowerCase());

const spent = nativeBefore - (await provider.getBalance(ACCOUNT));
console.log(`  biaya launch: ${ethers.formatEther(spent)} (gas saja)`);

// ── 3. Beli lewat terminal ─────────────────────────────────────────────────
step("3) BELI lewat terminal token");
for (let i = 0; i < 6; i++) await provider.send("evm_mine", []);
await page.goto(`${BASE}/token/${TICKER.toLowerCase()}?chain=31337`, {
  waitUntil: "domcontentloaded",
});
// Terminal beli adalah yang dibutuhkan langkah ini, jadi itu yang ditunggu.
await page.waitForSelector('input[type="number"]', { timeout: 30000 });
await page.waitForTimeout(1500);

const balBefore = await token.balanceOf(ACCOUNT);
await page.locator('input[type="number"]').first().fill("0.05");
await page.waitForTimeout(2200);

const panel = await page.evaluate(() => document.body.innerText);
check("panel fee menyebut irisan creator", /Creator \(/i.test(panel), "tiga irisan tampil");

const buyBtn = page.locator("button", { hasText: new RegExp(`^Buy \\$${TICKER}$`) }).first();
await buyBtn.waitFor({ state: "visible", timeout: 30000 });
check("tombol Buy aktif", !(await buyBtn.isDisabled()));
await buyBtn.click();
await page.waitForSelector("text=/Received |would fail on-chain|Rejected|Insufficient/", { timeout: 240000 });
await page.waitForTimeout(3000);

const bought = (await token.balanceOf(ACCOUNT)) - balBefore;
check("saldo token naik", bought > 0n, `+${Number(ethers.formatUnits(bought, 18)).toLocaleString("en-US")}`);
check("native nyata masuk kurva", (await curve.realNative()) > 0n, `${ethers.formatEther(await curve.realNative())}`);

// ── 4. Klaim penghasilan creator lewat UI ──────────────────────────────────
step("4) KLAIM PENGHASILAN CREATOR lewat UI");
const owed = await curve.creatorOwed();
check("fee creator terakumulasi", owed > 0n, `${ethers.formatEther(owed)}`);

await page.reload({ waitUntil: "domcontentloaded" });
// Tunggu panelnya secara eksplisit, bukan tidur 3 detik lalu berharap. Kalau
// panelnya tidak pernah muncul, ini gagal dengan sebab yang jelas alih-alih
// melaporkan "networkidle timeout" yang tidak menyebut apa pun soal produknya.
const hasPanel = await page
  .waitForSelector("text=Your creator revenue", { timeout: 30000 })
  .then(() => true)
  .catch(() => false);
check("panel penghasilan creator tampil", hasPanel);

if (hasPanel) {
  const claimBtn = page.locator('button:has-text("Claim")').first();
  await claimBtn.scrollIntoViewIfNeeded();
  check("tombol Claim aktif", !(await claimBtn.isDisabled()));
  await claimBtn.click();
  await page.waitForTimeout(6000);
  check("fee terbayar, utang jadi nol", (await curve.creatorOwed()) === 0n, `${ethers.formatEther(await curve.creatorOwed())}`);
}

check("tidak ada page error", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
console.log(`\n  ${pass} LULUS / ${fail} GAGAL`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
