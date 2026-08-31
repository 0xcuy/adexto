/**
 * Ulangi jalur launch + beli + buyback di EVM REMOTE, bukan hardhat.
 *
 * Alasannya spesifik. Audit pra-mainnet menemukan bahwa keempat factory testnet
 * menjalankan bytecode pra-rename, sehingga kontrak yang akan dikirim ke mainnet
 * belum pernah berjalan di chain publik mana pun — hanya di hardhat. Hardhat
 * berbeda dalam hal yang justru penting: satu transaksi per blok, gas gratis,
 * urutan deterministik, dan `hardhat_mine` untuk melompati jendela anti-sniper.
 * Di chain sungguhan jendela itu harus DITUNGGU.
 *
 * HANYA TESTNET. Skrip ini menolak berjalan di chain mainnet.
 *
 *   node audit_testnet_buyback.mjs                 # default 0g-testnet
 *   CHAIN=monad-testnet node audit_testnet_buyback.mjs
 */
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const CHAIN = process.env.CHAIN || "0g-testnet";
const RPCS = {
  "0g-testnet": "https://evmrpc-testnet.0g.ai",
  "monad-testnet": "https://testnet-rpc.monad.xyz",
  "base-sepolia": "https://base-sepolia-rpc.publicnode.com",
  "arbitrum-sepolia": "https://sepolia-rollup.arbitrum.io/rpc",
};
if (!RPCS[CHAIN]) throw new Error(`CHAIN harus salah satu dari: ${Object.keys(RPCS).join(", ")}`);
if (!/testnet|sepolia/.test(CHAIN)) throw new Error("Skrip ini hanya untuk testnet.");

const PK = process.env.OG_PRIVATE_KEY || process.env.PRIVATE_KEY;
if (!PK) throw new Error("Butuh OG_PRIVATE_KEY / PRIVATE_KEY di .env.local");

const deployments = JSON.parse(readFileSync("build/deployments.json", "utf8"));
const dep = deployments[CHAIN];
if (!dep?.curveFactory) throw new Error(`${CHAIN} belum punya curveFactory`);

const art = (n) => JSON.parse(readFileSync(`build/artifacts/${n}.json`, "utf8"));
const provider = new ethers.JsonRpcProvider(RPCS[CHAIN], undefined, { staticNetwork: true });
const wallet = new ethers.NonceManager(new ethers.Wallet(PK, provider));
const ME = new ethers.Wallet(PK).address;

let pass = 0;
let fail = 0;
const failures = [];
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "LULUS" : "GAGAL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass += 1;
  else {
    fail += 1;
    failures.push(label + (detail ? ` — ${detail}` : ""));
  }
};
const step = (s) => console.log(`\n${s}`);

const factory = new ethers.Contract(dep.curveFactory, art("AdextoCurveFactory").abi, wallet);
const curveAbi = art("SovereignCurve").abi;
const tokenAbi = art("AdextoToken").abi;

console.log(`ULANGI DI EVM REMOTE — ${CHAIN}`);
console.log(`factory  ${dep.curveFactory}`);
console.log(`dompet   ${ME}`);
console.log(`saldo    ${ethers.formatEther(await provider.getBalance(ME))}`);

// Konfirmasi factory-nya memang bytecode baru.
step("0) BYTECODE — harus versi yang sama dengan repo");
// Artifact di repo ini menyimpan `deployedBytecode` sebagai STRING, bukan objek
// bergaya hardhat `{ object }`. Membaca hanya `.object` menghasilkan 0 byte dan
// perbandingannya jadi selalu gagal — itu bug pembaca, bukan bytecode yang beda.
const artFactory = art("AdextoCurveFactory");
const localRuntime = String(artFactory.deployedBytecode?.object ?? artFactory.deployedBytecode ?? "")
  .replace(/^0x/, "");
const onChainRuntime = (await provider.getCode(dep.curveFactory)).replace(/^0x/, "");
check(
  "bytecode on-chain identik dengan artifact repo",
  localRuntime.length > 0 && onChainRuntime === localRuntime,
  `${onChainRuntime.length / 2} byte vs ${localRuntime.length / 2} byte`,
);
check("VERSION() terbaca", (await factory.VERSION()) === "0.9.0", await factory.VERSION());

// ── 1. Launch ───────────────────────────────────────────────────────────────
step("1) LAUNCH di chain sungguhan");
const TICKER = `RBB${Math.floor(Math.random() * 900 + 100)}`;
// Pembagian fee di sini harus memenuhi DUA syarat yang saling menarik berlawanan,
// dan percobaan pertama gagal karena hanya memenuhi satu.
//
//   treasury besar  -> treasury cepat melampaui plafon 1%, jadi plafonnya bisa diuji
//   depth  > 0      -> lantai harga bisa naik, jadi kenaikannya bisa diuji
//
// depthFeeBps dihitung kontrak sebagai swapFee - creatorShare - treasuryShare.
// Percobaan pertama memakai total 500 dengan treasury 500, yang membuat depth = 0
// — lantai harga jadi TIDAK PERNAH naik, dan pemeriksaan "depthFee cocok delta"
// lolos secara hampa karena kedua sisinya nol. 450 menyisakan depth 50 bps.
const launchTx = await factory.deployTrinity(
  "Remote Buyback Harness",
  TICKER,
  1_000_000_000n,
  ME,
  ethers.parseEther("1"),
  500n, // total 5% — plafon MAX_TOTAL_FEE_BPS
  0n, // creator 0
  450n, // treasury 450 bps -> depth 50 bps
  ethers.id(`remote-buyback-${TICKER}`),
);
console.log(`  tx ${launchTx.hash}`);
const launchRc = await launchTx.wait();
const deployed = launchRc.logs
  .map((l) => {
    try {
      return factory.interface.parseLog(l);
    } catch {
      return null;
    }
  })
  .find((p) => p && p.name === "TrinityProjectDeployed");
check("launch berhasil di chain sungguhan", Boolean(deployed), `blok ${launchRc.blockNumber}`);
if (!deployed) process.exit(1);

const token = new ethers.Contract(deployed.args.token, tokenAbi, provider);
const curve = new ethers.Contract(deployed.args.curve, curveAbi, provider);
console.log(`  token ${deployed.args.token}`);
console.log(`  kurva ${deployed.args.curve}`);
check("100% supply di kurva", (await token.balanceOf(deployed.args.curve)) === (await token.totalSupply()));
check("creator memegang nol token", (await token.balanceOf(ME)) === 0n);

// ── 2. Tunggu jendela anti-sniper ───────────────────────────────────────────
step("2) TUNGGU jendela anti-sniper — di sini tidak bisa dilompati");
const launchBlock = Number(await token.launchBlock());
const windowBlocks = Number(await token.ANTI_SNIPE_BLOCKS());
const target = launchBlock + windowBlocks + 1;
console.log(`  launchBlock ${launchBlock}, jendela ${windowBlocks} blok, tunggu sampai ${target}`);
const waitStart = Date.now();
while ((await provider.getBlockNumber()) < target) {
  if (Date.now() - waitStart > 180000) throw new Error("timeout menunggu blok");
  await new Promise((r) => setTimeout(r, 2000));
}
console.log(`  sekarang blok ${await provider.getBlockNumber()} (${Math.round((Date.now() - waitStart) / 1000)}s)`);

// ── 3. Beli untuk mengisi treasury ──────────────────────────────────────────
step("3) BELI untuk mengisi treasury");
// Delapan pembelian, bukan tiga. Treasury tumbuh 4,5% dari volume sementara
// reserve tumbuh ~95%, jadi plafon 1% baru terlampaui setelah volume sekitar
// 0,33x virtualNative. Tiga pembelian 0,05 hanya menghasilkan 0,15 dan plafonnya
// tidak pernah jadi pengikat, sehingga uji plafon di langkah 6 jatuh ke cabang
// "treasury yang membatasi" dan tidak menguji apa pun.
const BUYS = 8;
for (let i = 0; i < BUYS; i += 1) {
  const t = await curve.connect(wallet).buy(0n, ME, 0n, { value: ethers.parseEther("0.05") });
  await t.wait();
  console.log(`  beli ${i + 1}/${BUYS} ${t.hash}`);
}
const treasuryNative = await curve.treasuryNative();
const [resNative] = await curve.getReserves();
const cap1pct = resNative / 100n;
console.log(`  treasuryNative ${ethers.formatEther(treasuryNative)}`);
console.log(`  reserveNative  ${ethers.formatEther(resNative)}  plafon 1% ${ethers.formatEther(cap1pct)}`);
check("treasury terisi", treasuryNative > 0n, ethers.formatEther(treasuryNative));

// ── 3b. Plafon 1% diuji SEBELUM buyback ─────────────────────────────────────
//
// Urutannya penting dan percobaan pertama salah menaruhnya. Kalau plafon diuji
// SETELAH buyback, buyback itu sendiri sudah menghabiskan treasury sampai di bawah
// plafon, sehingga yang menolak adalah `bad buyback amount` dan plafonnya tidak
// pernah tersentuh. Di sini treasury masih melampaui plafon, jadi plafonlah yang
// mengikat.
step("3b) PLAFON 1% — diuji saat treasury MASIH melampauinya");
check(
  "treasury melampaui plafon, jadi plafon yang mengikat",
  treasuryNative > cap1pct,
  `${ethers.formatEther(treasuryNative)} > ${ethers.formatEther(cap1pct)}`,
);
if (treasuryNative > cap1pct) {
  let msgAll = "";
  try {
    await curve.connect(wallet).executeBuyback.staticCall(treasuryNative, 0n);
  } catch (e) {
    msgAll = e.shortMessage ?? e.message;
  }
  check("membelanjakan SELURUH treasury ditolak plafon", /1% of reserve/.test(msgAll), msgAll.slice(0, 55));

  let atCap = true;
  try {
    await curve.connect(wallet).executeBuyback.staticCall(cap1pct, 0n);
  } catch (e) {
    atCap = false;
  }
  check("tepat di plafon DITERIMA", atCap);

  let overCap = false;
  try {
    await curve.connect(wallet).executeBuyback.staticCall(cap1pct + 1n, 0n);
  } catch (e) {
    overCap = /1% of reserve/.test(e.shortMessage ?? e.message);
  }
  check("satu wei di atas plafon DITOLAK", overCap);
}

// ── 4. Buyback tanpa izin di chain sungguhan ────────────────────────────────
step("4) BUYBACK di chain sungguhan");
const spend = treasuryNative < cap1pct ? treasuryNative : cap1pct;
const supplyBefore = await token.totalSupply();
const depthBefore = await curve.totalDepthFeesRetained();
const floorBefore = await curve.floorPriceNativePerToken();

const bbTx = await curve.connect(wallet).executeBuyback(spend, 0n);
console.log(`  tx ${bbTx.hash}`);
const bbRc = await bbTx.wait();
check("buyback tereksekusi", bbRc.status === 1, `blok ${bbRc.blockNumber}`);

const ev = bbRc.logs
  .map((l) => {
    try {
      return curve.interface.parseLog(l);
    } catch {
      return null;
    }
  })
  .find((p) => p && p.name === "AutoBuybackExecuted");
check("AutoBuybackExecuted dipancarkan", Boolean(ev));

// ── 5. Event vs keadaan kontrak ─────────────────────────────────────────────
step("5) EVENT vs KONTRAK — dasar subgraph membaca dari log");
const [resNativeAfter, resTokenAfter] = await curve.getReserves();
check("nativeReserveAfter cocok", ev.args.nativeReserveAfter === resNativeAfter);
check("tokenReserveAfter cocok", ev.args.tokenReserveAfter === resTokenAfter);
const depthDelta = (await curve.totalDepthFeesRetained()) - depthBefore;
check("depthFee cocok delta totalDepthFeesRetained", ev.args.depthFee === depthDelta);
// Tanpa ini, pemeriksaan di atas lolos secara hampa ketika depthFeeBps = 0:
// nol === nol. Itu yang terjadi di percobaan pertama.
check("depthFee bukan nol, jadi perbandingannya berarti", ev.args.depthFee > 0n, `${ev.args.depthFee}`);
const burned = supplyBefore - (await token.totalSupply());
check("totalSupply turun sesuai tokensBurned", burned === ev.args.tokensBurned, `-${ethers.formatUnits(burned, 18)}`);
check("lantai harga naik", (await curve.floorPriceNativePerToken()) > floorBefore);

// ── 6. Treasury berkurang tepat, dan pemanggil tidak dapat apa pun ──────────
step("6) AKUNTANSI treasury");
check(
  "treasury berkurang tepat sebesar yang dibelanjakan",
  treasuryNative - (await curve.treasuryNative()) === spend,
  `-${ethers.formatEther(spend)}`,
);

// ── 7. Solvensi ─────────────────────────────────────────────────────────────
step("7) SOLVENSI di chain sungguhan");
const bal = await provider.getBalance(deployed.args.curve);
const owed = (await curve.realNative()) + (await curve.creatorOwed()) + (await curve.treasuryNative());
check("saldo >= curve + creator + treasury", bal >= owed, `${ethers.formatEther(bal)} >= ${ethers.formatEther(owed)}`);

console.log(`\n  ${pass} LULUS / ${fail} GAGAL`);
console.log(`\n  pasar uji: ${TICKER}`);
console.log(`  token ${deployed.args.token}`);
console.log(`  kurva ${deployed.args.curve}`);
console.log(`  buyback tx ${bbTx.hash}`);
if (failures.length) {
  console.log("\ngagal:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(fail === 0 ? 0 : 1);
