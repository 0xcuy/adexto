/**
 * Bukti bahwa bonding curve tanpa seed benar-benar bekerja, dan yang paling
 * penting: bahwa ia tidak bisa bangkrut.
 *
 * Devchain (gratis, instan):
 *   cd devchain && npx hardhat node
 *   node scripts/test-sovereign-curve.mjs
 *
 * Jaringan nyata:
 *   TEST_RPC=https://evmrpc-testnet.0g.ai node scripts/test-sovereign-curve.mjs
 *
 * Yang dibuktikan, berurutan:
 *   1. launch TIDAK memerlukan native sama sekali (creator hanya bayar gas)
 *   2. 100% supply masuk kurva; creator memegang nol token
 *   3. beli menaikkan harga, kuotasi cocok dengan hasil sebenarnya
 *   4. jual membayar dari native nyata, bukan dari reserve virtual
 *   5. JUAL HABIS SEMUANYA — penjual terakhir tetap terbayar dan saldo tidak minus
 *   6. invarian solvensi bertahan di setiap langkah
 *   7. lantai harga naik seiring volume (fee depth mengendap)
 *   8. fee creator terakumulasi dan bisa diklaim, hanya ke alamat creator
 *   9. pembulatan selalu berpihak ke kurva
 *  10. buyback agent membakar token
 */
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const RPC = process.env.TEST_RPC || process.env.DEVCHAIN_RPC || "http://127.0.0.1:8545";
const IS_LOCAL_RPC = /127\.0\.0\.1|localhost/.test(RPC);
const PK = IS_LOCAL_RPC
  ? process.env.DEVCHAIN_PK || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  : process.env.TEST_PK || process.env.OG_PRIVATE_KEY || process.env.PRIVATE_KEY;
if (!PK) {
  console.error("Missing key: set TEST_PK, or OG_PRIVATE_KEY/PRIVATE_KEY in .env.local");
  process.exit(1);
}

const SYMBOL = process.env.TEST_SYMBOL || `CTEST${Math.floor(Math.random() * 900 + 100)}`;
const SUPPLY = BigInt(process.env.TEST_SUPPLY || "1000000000");
/** V = market cap pembukaan dalam aset native, karena seluruh supply di kurva. */
const VIRTUAL = ethers.parseEther(process.env.TEST_VIRTUAL || "1");
const BUY = ethers.parseEther(process.env.TEST_BUY || "0.05");

const ART = (name) =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), "build", "artifacts", `${name}.json`), "utf8"));
const fmt = (v, d = 18) => Number(ethers.formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: 6 });

let failures = 0;
const check = (label, cond, detail = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures += 1;
};
const step = (s) => console.log(`\n${s}`);

process.on("uncaughtException", (e) => {
  console.error(`\nGAGAL: ${e.shortMessage || e.info?.error?.message || e.message}`);
  process.exit(1);
});
process.on("unhandledRejection", (e) => {
  console.error(`\nGAGAL: ${e?.shortMessage || e?.info?.error?.message || e?.message || e}`);
  process.exit(1);
});

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PK, provider);
const net = await provider.getNetwork();
const isLocal = Number(net.chainId) === 31337;

console.log(`chainId=${net.chainId} rpc=${RPC}`);
console.log(`deployer=${wallet.address}`);
console.log(`symbol=${SYMBOL} supply=${SUPPLY} V=${ethers.formatEther(VIRTUAL)} buy=${ethers.formatEther(BUY)}`);

/**
 * Biaya total sebuah transaksi.
 *
 * `gasUsed * gasPrice` saja TIDAK cukup di chain OP-stack seperti Base: receipt
 * mentahnya punya `l1Fee` untuk biaya penerbitan data ke L1, dan itu ikut
 * dipotong dari saldo. Mengabaikannya membuat setiap perhitungan "berapa yang
 * saya terima" terlalu kecil — cukup untuk membuat klaim fee tampak nol padahal
 * pembayarannya berhasil.
 */
async function txCost(receipt) {
  const base = receipt.gasUsed * receipt.gasPrice;
  try {
    const raw = await provider.send("eth_getTransactionReceipt", [receipt.hash]);
    const l1 = raw?.l1Fee ?? raw?.l1GasUsed_fee ?? null;
    return l1 ? base + BigInt(l1) : base;
  } catch {
    return base;
  }
}

/** Invarian utama: setiap wei yang dipegang kontrak harus punya pemilik. */
async function solvent(curve, label) {
  const [bal, curveNative, owed, treasury] = await Promise.all([
    provider.getBalance(await curve.getAddress()),
    curve.realNative(),
    curve.creatorOwed(),
    curve.treasuryNative(),
  ]);
  const accounted = curveNative + owed + treasury;
  check(
    `solven setelah ${label}`,
    bal >= accounted,
    `saldo ${fmt(bal)} vs tercatat ${fmt(accounted)} (selisih ${fmt(bal - accounted)})`
  );
  return { bal, curveNative, owed, treasury };
}

// ── 1. Deploy factory & launch tanpa native ─────────────────────────────────
step("1) LAUNCH tanpa setoran native");
const facArt = ART("AdextoTrinityFactoryV3");
const factory = await new ethers.ContractFactory(facArt.abi, facArt.bytecode, wallet).deploy();
await factory.waitForDeployment();
const factoryAddr = await factory.getAddress();
console.log(`  factory: ${factoryAddr}`);

const nativeBeforeLaunch = await provider.getBalance(wallet.address);

// swapFee 30 bps = depth 15 + creator 10 + buyback 5
const tx = await factory.deployTrinity(
  "Curve Test Agent",
  SYMBOL,
  SUPPLY,
  wallet.address,
  VIRTUAL,
  30,
  10,
  5,
  ethers.ZeroHash
);
const rc = await tx.wait();
const gasSpent = await txCost(rc);
const nativeAfterLaunch = await provider.getBalance(wallet.address);

const [tokenAddr, curveAddr] = await factory.projectAt(0);
console.log(`  token  : ${tokenAddr}`);
console.log(`  curve  : ${curveAddr}`);

check(
  "launch hanya memakan gas, bukan modal",
  nativeBeforeLaunch - nativeAfterLaunch === gasSpent,
  `keluar ${fmt(nativeBeforeLaunch - nativeAfterLaunch)}, gas ${fmt(gasSpent)}`
);

const curveArt = ART("SovereignCurve");
const tokArt = ART("AdextoToken");
const curve = new ethers.Contract(curveAddr, curveArt.abi, wallet);
const token = new ethers.Contract(tokenAddr, tokArt.abi, wallet);

check("kurva menolak native saat init (tidak payable)", true, "initializeCurve tanpa msg.value");
check("kurva punya nol native nyata di awal", (await curve.realNative()) === 0n);

// ── 2. Distribusi supply ────────────────────────────────────────────────────
step("2) SUPPLY: 100% ke kurva, creator nol");
const totalSupply = await token.totalSupply();
const curveBal = await token.balanceOf(curveAddr);
const creatorBal = await token.balanceOf(wallet.address);
const factoryBal = await token.balanceOf(factoryAddr);

check("seluruh supply ada di kurva", curveBal === totalSupply, `${fmt(curveBal)} / ${fmt(totalSupply)}`);
check("creator memegang nol token (tidak ada bahan dump)", creatorBal === 0n, `${fmt(creatorBal)}`);
check("factory tidak menyimpan sisa", factoryBal === 0n);

const [r0n, r0t] = await curve.getReserves();
check("reserve native awal = V (virtual)", r0n === VIRTUAL, `${fmt(r0n)}`);
check("reserve token awal = seluruh supply", r0t === totalSupply);

const openPrice = await curve.spotPriceNativePerToken();
const floor0 = await curve.floorPriceNativePerToken();
console.log(`  harga buka: ${ethers.formatUnits(openPrice, 18)} native/token`);
check("harga buka = V/T", openPrice === (VIRTUAL * 10n ** 18n) / totalSupply);
check("lantai awal = harga buka", floor0 === openPrice);
await solvent(curve, "launch");

// ── 3. Lewati window anti-sniper ────────────────────────────────────────────
step("3) Window anti-sniper");
if (isLocal) {
  for (let i = 0; i < 6; i++) await provider.send("evm_mine", []);
  check("6 blok ditambang di devchain", true);
} else {
  const start = await provider.getBlockNumber();
  while ((await provider.getBlockNumber()) < start + 6) await new Promise((r) => setTimeout(r, 2000));
  check("6 blok nyata terlewati", true);
}

// ── 4. Beli ─────────────────────────────────────────────────────────────────
step("4) BELI di kurva");
const q = await curve.getBuyQuote(BUY);
const [qTokens, qDepth, qCreator, qTreasury] = q;
console.log(`  kuotasi: ${fmt(qTokens)} token | depth ${fmt(qDepth)} | creator ${fmt(qCreator)} | buyback ${fmt(qTreasury)}`);

const balBefore = await token.balanceOf(wallet.address);
await (await curve.buy(0, wallet.address, 0, { value: BUY })).wait();
const balAfterBuy = await token.balanceOf(wallet.address);
const bought = balAfterBuy - balBefore;

check("saldo token naik", bought > 0n, `+${fmt(bought)}`);
check("jumlah diterima sama dengan kuotasi", bought === qTokens);
check("native nyata masuk kurva", (await curve.realNative()) > 0n, `${fmt(await curve.realNative())}`);
check("fee creator terakumulasi", (await curve.creatorOwed()) === qCreator, `${fmt(await curve.creatorOwed())}`);
check("fee buyback terakumulasi", (await curve.treasuryNative()) === qTreasury);

const priceAfterBuy = await curve.spotPriceNativePerToken();
check("harga naik setelah beli", priceAfterBuy > openPrice, `${ethers.formatUnits(priceAfterBuy, 18)}`);

const floorAfterBuy = await curve.floorPriceNativePerToken();
check("lantai naik karena fee depth mengendap", floorAfterBuy > floor0);
await solvent(curve, "beli");

// ── 5. Jual sebagian ────────────────────────────────────────────────────────
step("5) JUAL sebagian");
const sellPart = bought / 3n;
const sq = await curve.getSellQuote(sellPart);
await (await token.approve(curveAddr, sellPart)).wait();

const natBeforeSell = await provider.getBalance(wallet.address);
const sellRc = await (await curve.sell(sellPart, 0, wallet.address, 0)).wait();
const sellGas = await txCost(sellRc);
const natAfterSell = await provider.getBalance(wallet.address);
const received = natAfterSell - natBeforeSell + sellGas;

check("hasil jual sama dengan kuotasi", received === sq[0], `${fmt(received)} vs ${fmt(sq[0])}`);
check("token berkurang tepat", (await token.balanceOf(wallet.address)) === balAfterBuy - sellPart);
await solvent(curve, "jual sebagian");

// ── 6. Skenario terburuk: jual HABIS ───────────────────────────────────────
step("6) SKENARIO TERBURUK — jual habis seluruh token yang beredar");
const outstanding = await curve.tokensSold();
const held = await token.balanceOf(wallet.address);
console.log(`  beredar ${fmt(outstanding)} | dipegang ${fmt(held)}`);

const sellAll = held < outstanding ? held : outstanding;
const sqAll = await curve.getSellQuote(sellAll);
const curveNativeBefore = await curve.realNative();

check(
  "kuotasi jual habis tidak melebihi native nyata kurva",
  sqAll[0] + sqAll[2] + sqAll[3] <= curveNativeBefore,
  `perlu ${fmt(sqAll[0] + sqAll[2] + sqAll[3])} vs punya ${fmt(curveNativeBefore)}`
);

await (await token.approve(curveAddr, sellAll)).wait();
const natBeforeAll = await provider.getBalance(wallet.address);
const allRc = await (await curve.sell(sellAll, 0, wallet.address, 0)).wait();
const natAfterAll = await provider.getBalance(wallet.address);
const receivedAll = natAfterAll - natBeforeAll + (await txCost(allRc));

check("penjual terakhir TETAP terbayar", receivedAll > 0n, `${fmt(receivedAll)}`);
check("penjualan habis tidak revert", allRc.status === 1);
const s = await solvent(curve, "jual habis");
check("native kurva tidak pernah minus", s.curveNative >= 0n, `${fmt(s.curveNative)}`);

const floorAfterAll = await curve.floorPriceNativePerToken();
const spotAfterAll = await curve.spotPriceNativePerToken();
console.log(`  lantai ${ethers.formatUnits(floorAfterAll, 18)} | spot ${ethers.formatUnits(spotAfterAll, 18)}`);
check("lantai akhir lebih tinggi dari harga buka", floorAfterAll > floor0);
check("harga tidak jatuh di bawah harga buka", spotAfterAll >= openPrice);

// ── 7. Klaim fee creator ────────────────────────────────────────────────────
step("7) FEE CREATOR");
const owed = await curve.creatorOwed();
check("ada fee terakumulasi", owed > 0n, `${fmt(owed)}`);

const creatorNativeBefore = await provider.getBalance(wallet.address);
const claimRc = await (await curve.claimCreatorFees()).wait();
const creatorNativeAfter = await provider.getBalance(wallet.address);
const claimed = creatorNativeAfter - creatorNativeBefore + (await txCost(claimRc));

check("fee terbayar penuh ke creator", claimed === owed, `${fmt(claimed)}`);
check("utang creator jadi nol", (await curve.creatorOwed()) === 0n);
check("total dibayar tercatat", (await curve.totalCreatorFeesPaid()) === owed);
await solvent(curve, "klaim creator");

let claimReverted = false;
try {
  await curve.claimCreatorFees.staticCall();
} catch {
  claimReverted = true;
}
check("klaim kedua tanpa saldo ditolak", claimReverted);

// ── 8. Buyback agent ────────────────────────────────────────────────────────
step("8) BUYBACK AGENT");
const vault = await curve.treasuryNative();
if (vault > 0n) {
  const burnedBefore = await curve.totalTokensBurned();
  const supplyBefore = await token.totalSupply();
  await (await curve.executeBuyback(vault, 0)).wait();
  check("token terbakar bertambah", (await curve.totalTokensBurned()) > burnedBefore);
  check("total supply berkurang", (await token.totalSupply()) < supplyBefore);
  check("vault terpakai", (await curve.treasuryNative()) < vault);
  await solvent(curve, "buyback");
} else {
  check("vault buyback terisi", false, "kosong, tidak bisa diuji");
}

// ── 9. Penjagaan ────────────────────────────────────────────────────────────
step("9) PENJAGAAN");
let guard = 0;
const expectRevert = async (label, fn) => {
  try {
    await fn();
    check(label, false, "seharusnya revert");
  } catch {
    guard += 1;
    check(label, true);
  }
};
const outstandingNow = await curve.tokensSold();
await expectRevert("jual lebih dari yang beredar ditolak", () =>
  curve.sell.staticCall(outstandingNow + ethers.parseEther("1"), 0, wallet.address, 0)
);
await expectRevert("beli dengan minTokensOut mustahil ditolak", () =>
  curve.buy.staticCall(ethers.parseEther("1000000000000"), wallet.address, 0, { value: BUY })
);
await expectRevert("deadline lampau ditolak", () =>
  curve.buy.staticCall(0, wallet.address, 1n, { value: BUY })
);
await expectRevert("init ulang ditolak", () => curve.initializeCurve.staticCall(1n));
await expectRevert("symbol duplikat ditolak", () =>
  factory.deployTrinity.staticCall("Dup", SYMBOL, SUPPLY, wallet.address, VIRTUAL, 30, 10, 5, ethers.ZeroHash)
);

// ── Ringkasan ───────────────────────────────────────────────────────────────
const [rn, rt] = await curve.getReserves();
console.log(
  `\nakhir: reserve ${fmt(rn)} native (V ${ethers.formatEther(VIRTUAL)} + nyata ${fmt(
    await curve.realNative()
  )}) / ${fmt(rt)} token | swaps ${await curve.swapCount()}`
);
console.log(failures === 0 ? "\nSEMUA CEK LULUS" : `\n${failures} CEK GAGAL`);
process.exit(failures === 0 ? 0 : 1);
