/**
 * End-to-end proof for AdextoFactory + AdextoCurve (VERSION 0.11.0).
 *
 * Devchain (free, instant):
 *   anvil --port 8545 --chain-id 31337     # or: cd devchain && npx hardhat node
 *   node scripts/test-adexto-curve.mjs
 *
 * Real network:
 *   TEST_RPC=https://evmrpc-testnet.0g.ai node scripts/test-adexto-curve.mjs
 *
 * SIBLING, NOT REPLACEMENT of scripts/test-sovereign-curve.mjs. That harness proves
 * `AdextoCurveFactory` + `SovereignCurve` 0.10.0, whose bytecode is already on four
 * chains and creates the six markets that exist today. Those contracts are frozen, so
 * their proof has to keep running unchanged. This file is the same argument made
 * against the generation that adds a fourth fee leg. The duplication is deliberate:
 * folding both into one conditional harness would mean a mistake in the branching
 * could quietly skip assertions in either generation, which is exactly how coverage
 * has been lost in this repo before.
 *
 * What is proved, in order:
 *   1. deploying the factory REQUIRES a protocol treasury, and rejects the zero address
 *   2. launch needs no native at all — the creator only pays gas
 *   3. 100% of supply enters the curve; the creator holds zero tokens
 *   4. the protocol leg is charged ON TOP of the creator's configured total
 *   5. buy raises the price, and the quote equals the amount actually received
 *   6. all four legs accrue exactly as quoted
 *   7. sell pays from real native, never from the virtual reserve
 *   8. selling EVERYTHING outstanding still pays the last seller, balance never negative
 *   9. solvency holds at every step WITH protocolOwed included
 *  10. the price floor rises with volume, and the protocol leg does not inflate it
 *  11. creator fees are claimable only to the creator
 *  12. claimProtocolFees() is permissionless and the treasury balance actually rises
 *  13. the 5% cap counts the protocol leg
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

/**
 * Treasury for the test factory.
 *
 * Deliberately NOT the deployer, and not read from PROTOCOL_TREASURY either: this
 * harness has to watch the treasury balance grow, and if the treasury were also the
 * account paying gas and receiving creator fees the assertion would pass for the
 * wrong reason. A fixed throwaway address makes the balance change attributable to
 * exactly one source.
 */
const TEST_TREASURY = process.env.TEST_TREASURY || "0x00000000000000000000000000000000000000E1";

const SYMBOL = process.env.TEST_SYMBOL || `ATEST${Math.floor(Math.random() * 900 + 100)}`;
const SUPPLY = BigInt(process.env.TEST_SUPPLY || "1000000000");
/** V = opening market cap in native terms, because the whole supply sits in the curve. */
const VIRTUAL = ethers.parseEther(process.env.TEST_VIRTUAL || "1");
const BUY = ethers.parseEther(process.env.TEST_BUY || "0.05");

// Configured total 30 bps = depth 15 + creator 10 + buyback 5. The protocol leg is
// added by the factory on top of this, so what a trader pays is 30 + PROTOCOL_FEE_BPS.
const SWAP_FEE_BPS = 30;
const CREATOR_SHARE_BPS = 10;
const TREASURY_SHARE_BPS = 5;

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
  if (process.env.TEST_TRACE) console.error(e?.stack ?? e);
  process.exit(1);
});
process.on("unhandledRejection", (e) => {
  console.error(`\nGAGAL: ${e?.shortMessage || e?.info?.error?.message || e?.message || e}`);
  if (process.env.TEST_TRACE) console.error(e?.stack ?? e);
  process.exit(1);
});

const provider = new ethers.JsonRpcProvider(RPC);
const signingKey = new ethers.Wallet(PK, provider);
/**
 * Nonce dikelola LOKAL, bukan ditanyakan ke node tiap transaksi.
 *
 * Tanpa ini harness gagal dengan "nonce too low" di transaksi `sell`, dan bukan karena
 * kontraknya: ethers menanyakan `eth_getTransactionCount(..., "pending")` untuk setiap
 * transaksi, dan pada node lokal yang menambang seketika jawaban itu bisa masih
 * memuat nonce transaksi sebelumnya yang baru saja masuk blok. Balapan itu tidak ada
 * hubungannya dengan yang sedang diuji, tapi ia mematikan proses di tengah rangkaian
 * sehingga sisa buktinya tidak pernah dijalankan — persis bentuk "coverage hilang
 * tanpa suara" yang paling mahal di repo ini.
 *
 * `NonceManager` menyimpan nonce sendiri dan menaikkannya per transaksi, jadi urutan
 * kirimnya deterministik. Alamatnya sama, kunci yang menandatangani sama.
 */
const wallet = new ethers.NonceManager(signingKey);
const net = await provider.getNetwork();
const isLocal = Number(net.chainId) === 31337;
// `NonceManager` tidak meneruskan `.address`, jadi alamatnya diambil dari kuncinya.
const ME = signingKey.address;

console.log(`chainId=${net.chainId} rpc=${RPC}`);
console.log(`deployer=${ME}`);
console.log(`treasury=${TEST_TREASURY}`);
console.log(`symbol=${SYMBOL} supply=${SUPPLY} V=${ethers.formatEther(VIRTUAL)} buy=${ethers.formatEther(BUY)}`);

/** Total cost of a transaction, including the L1 data fee on OP-stack chains. */
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

/**
 * The core invariant, with `protocolOwed` as a term.
 *
 * Omitting it is the exact mistake the contract's own `_assertSolvent` guards
 * against: a fourth leg that accrues native the accounting does not know about makes
 * the curve believe it owns money it owes to someone else.
 */
async function solvent(curve, label) {
  const [bal, curveNative, owed, treasury, protocolOwed] = await Promise.all([
    provider.getBalance(await curve.getAddress()),
    curve.realNative(),
    curve.creatorOwed(),
    curve.treasuryNative(),
    curve.protocolOwed(),
  ]);
  const accounted = curveNative + owed + treasury + protocolOwed;
  check(
    `solven setelah ${label}`,
    bal >= accounted,
    `saldo ${fmt(bal)} vs tercatat ${fmt(accounted)} (selisih ${fmt(bal - accounted)})`
  );
  return { bal, curveNative, owed, treasury, protocolOwed };
}

// ── 1. Factory constructor demands a treasury ───────────────────────────────
step("1) FACTORY menuntut protocol treasury");
const facArt = ART("AdextoFactory");
const FactoryCF = new ethers.ContractFactory(facArt.abi, facArt.bytecode, wallet);

let zeroRejected = false;
try {
  const badTx = await FactoryCF.getDeployTransaction(ethers.ZeroAddress);
  await provider.estimateGas({ from: ME, data: badTx.data });
} catch {
  zeroRejected = true;
}
check("deploy dengan treasury nol ditolak", zeroRejected, "constructor require");

const factory = await FactoryCF.deploy(TEST_TREASURY);
await factory.waitForDeployment();
const factoryAddr = await factory.getAddress();
console.log(`  factory: ${factoryAddr}`);

check("VERSION factory = 0.11.0", (await factory.VERSION()) === "0.11.0", await factory.VERSION());
check(
  "treasury tersimpan sesuai yang dikirim",
  (await factory.protocolTreasury()).toLowerCase() === TEST_TREASURY.toLowerCase(),
  await factory.protocolTreasury()
);
const PROTOCOL_FEE_BPS = await factory.PROTOCOL_FEE_BPS();
check("PROTOCOL_FEE_BPS bukan nol", PROTOCOL_FEE_BPS > 0n, `${PROTOCOL_FEE_BPS} bps`);

// ── 2. Launch without native ────────────────────────────────────────────────
step("2) LAUNCH tanpa setoran native");
const nativeBeforeLaunch = await provider.getBalance(ME);
const tx = await factory.deployTrinity(
  "Adexto Curve Test Agent",
  SYMBOL,
  SUPPLY,
  ME,
  VIRTUAL,
  SWAP_FEE_BPS,
  CREATOR_SHARE_BPS,
  TREASURY_SHARE_BPS,
  ethers.ZeroHash,
  false,
  0
);
const rc = await tx.wait();
const gasSpent = await txCost(rc);
const nativeAfterLaunch = await provider.getBalance(ME);

const [tokenAddr, curveAddr] = await factory.projectAt(0);
console.log(`  token  : ${tokenAddr}`);
console.log(`  curve  : ${curveAddr}`);

check(
  "launch hanya memakan gas, bukan modal",
  nativeBeforeLaunch - nativeAfterLaunch === gasSpent,
  `keluar ${fmt(nativeBeforeLaunch - nativeAfterLaunch)}, gas ${fmt(gasSpent)}`
);

const curve = new ethers.Contract(curveAddr, ART("AdextoCurve").abi, wallet);
const token = new ethers.Contract(tokenAddr, ART("AdextoToken").abi, wallet);

check("VERSION kurva = 0.11.0", (await curve.VERSION()) === "0.11.0", await curve.VERSION());
check("kurva punya nol native nyata di awal", (await curve.realNative()) === 0n);
check("protocolOwed nol di awal", (await curve.protocolOwed()) === 0n);
check(
  "treasury kurva = treasury factory",
  (await curve.protocolTreasury()).toLowerCase() === TEST_TREASURY.toLowerCase()
);

// ── 3. Supply distribution ──────────────────────────────────────────────────
step("3) SUPPLY: 100% ke kurva, creator nol");
const totalSupply = await token.totalSupply();
check("seluruh supply ada di kurva", (await token.balanceOf(curveAddr)) === totalSupply);
check("creator memegang nol token (tidak ada bahan dump)", (await token.balanceOf(ME)) === 0n);
check("factory tidak menyimpan sisa", (await token.balanceOf(factoryAddr)) === 0n);

const [r0n, r0t] = await curve.getReserves();
check("reserve native awal = V (virtual)", r0n === VIRTUAL, `${fmt(r0n)}`);
check("reserve token awal = seluruh supply", r0t === totalSupply);

const openPrice = await curve.spotPriceNativePerToken();
const floor0 = await curve.floorPriceNativePerToken();
console.log(`  harga buka: ${ethers.formatUnits(openPrice, 18)} native/token`);
check("harga buka = V/T", openPrice === (VIRTUAL * 10n ** 18n) / totalSupply);
check("lantai awal = harga buka", floor0 === openPrice);
await solvent(curve, "launch");

// ── 4. The protocol leg is ADDITIVE ─────────────────────────────────────────
step("4) KAKI PROTOKOL dipungut DI ATAS total creator");
const [depthBps, creatorBps, buybackBps, protoBps, totalBps] = await Promise.all([
  curve.depthFeeBps(),
  curve.creatorFeeBps(),
  curve.treasuryBuybackBps(),
  curve.protocolFeeBps(),
  curve.totalFeeBps(),
]);
console.log(
  `  depth ${depthBps} | creator ${creatorBps} | buyback ${buybackBps} | protocol ${protoBps} | total ${totalBps} bps`
);
check(
  "tiga kaki pertama menjumlah ke total yang dikonfigurasi",
  depthBps + creatorBps + buybackBps === BigInt(SWAP_FEE_BPS),
  `${depthBps + creatorBps + buybackBps} vs ${SWAP_FEE_BPS}`
);
check("kaki protokol = konstanta factory", protoBps === PROTOCOL_FEE_BPS);
check(
  "totalFeeBps = total dikonfigurasi + kaki protokol",
  totalBps === BigInt(SWAP_FEE_BPS) + PROTOCOL_FEE_BPS,
  `${totalBps} bps = ${(Number(totalBps) / 100).toFixed(2)}% dibayar trader`
);
check(
  "kaki protokol TIDAK mengurangi depth maupun creator",
  depthBps === BigInt(SWAP_FEE_BPS - CREATOR_SHARE_BPS - TREASURY_SHARE_BPS) &&
    creatorBps === BigInt(CREATOR_SHARE_BPS),
  `depth ${depthBps}, creator ${creatorBps}`
);

// ── 5. Anti-sniper window ───────────────────────────────────────────────────
step("5) Window anti-sniper");
if (isLocal) {
  for (let i = 0; i < 6; i++) await provider.send("evm_mine", []);
  check("6 blok ditambang di devchain", true);
} else {
  const start = await provider.getBlockNumber();
  while ((await provider.getBlockNumber()) < start + 6) await new Promise((r) => setTimeout(r, 2000));
  check("6 blok nyata terlewati", true);
}

// ── 6. Buy ──────────────────────────────────────────────────────────────────
step("6) BELI di kurva");
const q = await curve.getBuyQuote(BUY);
check("kuotasi beli mengembalikan LIMA nilai", q.length === 5, `${q.length} nilai`);
const [qTokens, qDepth, qCreator, qTreasury, qProtocol] = q;
console.log(
  `  kuotasi: ${fmt(qTokens)} token | depth ${fmt(qDepth)} | creator ${fmt(qCreator)} | buyback ${fmt(
    qTreasury
  )} | protocol ${fmt(qProtocol)}`
);
check("fee protokol dikuotasi bukan nol", qProtocol > 0n, `${fmt(qProtocol)}`);
check(
  "fee protokol = nativeIn * protocolFeeBps / 10000",
  qProtocol === (BUY * protoBps) / 10_000n,
  `${fmt(qProtocol)}`
);

const balBefore = await token.balanceOf(ME);
await (await curve.buy(0, ME, 0, { value: BUY })).wait();
const balAfterBuy = await token.balanceOf(ME);
const bought = balAfterBuy - balBefore;

check("saldo token naik", bought > 0n, `+${fmt(bought)}`);
check("jumlah diterima sama dengan kuotasi", bought === qTokens);
check("native nyata masuk kurva", (await curve.realNative()) > 0n, `${fmt(await curve.realNative())}`);
check("fee creator terakumulasi", (await curve.creatorOwed()) === qCreator, `${fmt(await curve.creatorOwed())}`);
check("fee buyback terakumulasi", (await curve.treasuryNative()) === qTreasury);
check("fee protokol terakumulasi", (await curve.protocolOwed()) === qProtocol, `${fmt(await curve.protocolOwed())}`);

/**
 * Kaki protokol MENINGGALKAN kurva, jadi ia tidak boleh menaikkan lantai harga.
 *
 * Ini pembeda yang paling mudah salah: depth tetap di kurva dan karena itu menaikkan
 * lantai; protokol tidak. Kalau keduanya ikut dihitung, situs akan melaporkan lantai
 * yang naik lebih cepat daripada yang bisa dibayar kurva.
 */
const floorAfterBuy = await curve.floorPriceNativePerToken();
check("lantai naik karena fee depth mengendap", floorAfterBuy > floor0);
const priceAfterBuy = await curve.spotPriceNativePerToken();
check("harga naik setelah beli", priceAfterBuy > openPrice, `${ethers.formatUnits(priceAfterBuy, 18)}`);
await solvent(curve, "beli");

// Swap event must carry protocolFee as its own field, or no indexer can separate it.
const buyLogs = await provider.getLogs({
  address: curveAddr,
  fromBlock: rc.blockNumber,
  toBlock: "latest",
  topics: [curve.interface.getEvent("Swap").topicHash],
});
check("event Swap 0.11.0 terpancar dan cocok topic0-nya", buyLogs.length > 0, `${buyLogs.length} log`);
if (buyLogs.length > 0) {
  const parsed = curve.interface.parseLog(buyLogs[buyLogs.length - 1]);
  check("Swap membawa protocolFee sebagai field sendiri", parsed.args.protocolFee === qProtocol);
  check(
    "Swap masih membawa kedua reserve sesudah trade",
    parsed.args.nativeReserveAfter > 0n && parsed.args.tokenReserveAfter > 0n
  );
}

// ── 7. Sell part ────────────────────────────────────────────────────────────
step("7) JUAL sebagian");
const sellPart = bought / 3n;
const sq = await curve.getSellQuote(sellPart);
check("kuotasi jual mengembalikan LIMA nilai", sq.length === 5, `${sq.length} nilai`);
await (await token.approve(curveAddr, sellPart)).wait();

const protocolOwedBeforeSell = await curve.protocolOwed();
const natBeforeSell = await provider.getBalance(ME);
const sellRc = await (await curve.sell(sellPart, 0, ME, 0)).wait();
const sellGas = await txCost(sellRc);
const natAfterSell = await provider.getBalance(ME);
const received = natAfterSell - natBeforeSell + sellGas;

check("hasil jual sama dengan kuotasi", received === sq[0], `${fmt(received)} vs ${fmt(sq[0])}`);
check("token berkurang tepat", (await token.balanceOf(ME)) === balAfterBuy - sellPart);
check(
  "fee protokol juga dipungut saat jual",
  (await curve.protocolOwed()) === protocolOwedBeforeSell + sq[4],
  `+${fmt(sq[4])}`
);
await solvent(curve, "jual sebagian");

// ── 8. Worst case: sell everything ──────────────────────────────────────────
step("8) SKENARIO TERBURUK — jual habis seluruh token yang beredar");
const outstanding = await curve.tokensSold();
const held = await token.balanceOf(ME);
console.log(`  beredar ${fmt(outstanding)} | dipegang ${fmt(held)}`);

const sellAll = held < outstanding ? held : outstanding;
const sqAll = await curve.getSellQuote(sellAll);
const curveNativeBefore = await curve.realNative();

// nativeOut + creator + buyback + protocol must all fit inside real native. The
// protocol term is the one a 0.10.0-shaped check would forget.
const needed = sqAll[0] + sqAll[2] + sqAll[3] + sqAll[4];
check(
  "kuotasi jual habis (termasuk kaki protokol) tidak melebihi native nyata",
  needed <= curveNativeBefore,
  `perlu ${fmt(needed)} vs punya ${fmt(curveNativeBefore)}`
);

await (await token.approve(curveAddr, sellAll)).wait();
const natBeforeAll = await provider.getBalance(ME);
const allRc = await (await curve.sell(sellAll, 0, ME, 0)).wait();
const natAfterAll = await provider.getBalance(ME);
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

// ── 9. Creator fees ─────────────────────────────────────────────────────────
step("9) FEE CREATOR");
const owed = await curve.creatorOwed();
check("ada fee terakumulasi", owed > 0n, `${fmt(owed)}`);

const creatorNativeBefore = await provider.getBalance(ME);
const claimRc = await (await curve.claimCreatorFees()).wait();
const claimed = (await provider.getBalance(ME)) - creatorNativeBefore + (await txCost(claimRc));

check("fee terbayar penuh ke creator", claimed === owed, `${fmt(claimed)}`);
check("utang creator jadi nol", (await curve.creatorOwed()) === 0n);
check("total dibayar tercatat", (await curve.totalCreatorFeesPaid()) === owed);
await solvent(curve, "klaim creator");

// ── 10. Protocol fees: permissionless, fixed destination ────────────────────
step("10) FEE PROTOKOL — tanpa izin, tujuan tetap");
const protocolOwed = await curve.protocolOwed();
check("ada fee protokol terakumulasi", protocolOwed > 0n, `${fmt(protocolOwed)}`);

const treasuryBefore = await provider.getBalance(TEST_TREASURY);

/**
 * Dipanggil dari akun LAIN, bukan treasury dan bukan creator.
 *
 * Itu inti klaimnya: `claimProtocolFees()` tanpa izin, dan itu aman justru karena
 * tujuannya immutable. Kalau harness ini memanggilnya dari wallet deployer saja, ia
 * tidak akan pernah membedakan "tanpa izin" dari "kebetulan pemanggilnya berwenang".
 */
const strangerKey = isLocal
  ? new ethers.Wallet("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", provider)
  : signingKey;
const stranger = new ethers.NonceManager(strangerKey);
if (isLocal) {
  check("pemanggil BUKAN treasury dan BUKAN creator", strangerKey.address.toLowerCase() !== ME.toLowerCase());
}
const claimProtoRc = await (await curve.connect(stranger).claimProtocolFees()).wait();
const treasuryAfter = await provider.getBalance(TEST_TREASURY);

check("panggilan tanpa izin berhasil", claimProtoRc.status === 1);
check(
  "SALDO TREASURY BENAR-BENAR NAIK sebesar fee terakumulasi",
  treasuryAfter - treasuryBefore === protocolOwed,
  `+${fmt(treasuryAfter - treasuryBefore)} (diharapkan ${fmt(protocolOwed)})`
);
check("protocolOwed jadi nol", (await curve.protocolOwed()) === 0n);
check("total fee protokol dibayar tercatat", (await curve.totalProtocolFeesPaid()) === protocolOwed);
await solvent(curve, "klaim protokol");

const claimedEvent = claimProtoRc.logs
  .map((l) => {
    try {
      return curve.interface.parseLog(l);
    } catch {
      return null;
    }
  })
  .find((p) => p?.name === "ProtocolFeesClaimed");
check("event ProtocolFeesClaimed terpancar ke treasury", Boolean(claimedEvent), claimedEvent?.args?.to ?? "tidak ada");
if (claimedEvent) {
  check(
    "tujuan event = treasury immutable, bukan pemanggil",
    claimedEvent.args.to.toLowerCase() === TEST_TREASURY.toLowerCase(),
    claimedEvent.args.to
  );
}

let secondClaimReverted = false;
try {
  await curve.claimProtocolFees.staticCall();
} catch {
  secondClaimReverted = true;
}
check("klaim kedua tanpa saldo ditolak", secondClaimReverted);

// ── 11. Buyback ─────────────────────────────────────────────────────────────
step("11) BUYBACK AGENT");
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

// ── 12. Guards, including the cap that counts the protocol leg ──────────────
step("12) PENJAGAAN");
const expectRevert = async (label, fn) => {
  try {
    await fn();
    check(label, false, "seharusnya revert");
  } catch {
    check(label, true);
  }
};
const outstandingNow = await curve.tokensSold();
await expectRevert("jual lebih dari yang beredar ditolak", () =>
  curve.sell.staticCall(outstandingNow + ethers.parseEther("1"), 0, ME, 0)
);
await expectRevert("beli dengan minTokensOut mustahil ditolak", () =>
  curve.buy.staticCall(ethers.parseEther("1000000000000"), ME, 0, { value: BUY })
);
await expectRevert("deadline lampau ditolak", () => curve.buy.staticCall(0, ME, 1n, { value: BUY }));
await expectRevert("init ulang ditolak", () => curve.initializeCurve.staticCall(1n));
await expectRevert("symbol duplikat ditolak", () =>
  factory.deployTrinity.staticCall(
    "Dup",
    SYMBOL,
    SUPPLY,
    ME,
    VIRTUAL,
    SWAP_FEE_BPS,
    CREATOR_SHARE_BPS,
    TREASURY_SHARE_BPS,
    ethers.ZeroHash,
    false,
    0
  )
);

/**
 * Cap 5% harus MENGHITUNG kaki protokol.
 *
 * `swapFeeBps = 500` sendirian dulu sah. Sekarang tidak boleh: yang dibayar trader
 * jadi 5% + kaki protokol, di atas batas yang dijanjikan kurva. Kalau pemeriksaannya
 * hanya melihat `swapFeeBps`, factory akan menerima permintaannya lalu constructor
 * kurva yang revert — kegagalan yang benar dengan alasan yang membingungkan.
 */
await expectRevert("swapFeeBps 500 ditolak karena kaki protokol melewati cap 5%", () =>
  factory.deployTrinity.staticCall(
    "Cap",
    `${SYMBOL}CAP`,
    SUPPLY,
    ME,
    VIRTUAL,
    500,
    10,
    5,
    ethers.ZeroHash,
    false,
    0
  )
);
const capOk = 500 - Number(PROTOCOL_FEE_BPS);
let justUnderCapAccepted = true;
try {
  await factory.deployTrinity.staticCall(
    "CapOk",
    `${SYMBOL}OK`,
    SUPPLY,
    ME,
    VIRTUAL,
    capOk,
    10,
    5,
    ethers.ZeroHash,
    false,
    0
  );
} catch {
  justUnderCapAccepted = false;
}
check(`swapFeeBps ${capOk} (= 500 − kaki protokol) diterima`, justUnderCapAccepted);

// ── Summary ─────────────────────────────────────────────────────────────────
const [rn, rt] = await curve.getReserves();
console.log(
  `\nakhir: reserve ${fmt(rn)} native (V ${ethers.formatEther(VIRTUAL)} + nyata ${fmt(
    await curve.realNative()
  )}) / ${fmt(rt)} token | swaps ${await curve.swapCount()}`
);
console.log(
  `trader membayar ${(Number(totalBps) / 100).toFixed(2)}% total ` +
    `(dikonfigurasi ${(SWAP_FEE_BPS / 100).toFixed(2)}% + protokol ${(Number(PROTOCOL_FEE_BPS) / 100).toFixed(2)}%)`
);
console.log(failures === 0 ? "\nSEMUA CEK LULUS" : `\n${failures} CEK GAGAL`);
process.exit(failures === 0 ? 0 : 1);
