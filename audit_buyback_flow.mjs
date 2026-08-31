/**
 * Harness buyback. Menguji jalur yang, sebelum ini, NOL KALI pernah dieksekusi di
 * chain mana pun — audit pra-mainnet menemukan nol event AutoBuybackExecuted di
 * seluruh kurva testnet, karena `onlyAgent` mengunci satu-satunya pemanggil ke
 * dompet creator yang tidak pernah memanggilnya.
 *
 * Yang harus dibuktikan di sini, dan tidak satu pun bisa dibuktikan `graph build`
 * atau `tsc`:
 *
 *   1. Buyback benar-benar berjalan, dipanggil oleh alamat ACAK yang tidak punya
 *      hubungan apa pun dengan kurva — inilah arti "tanpa izin".
 *   2. Token yang dibeli benar-benar DIBAKAR: totalSupply turun.
 *   3. Lima field event cocok dengan keadaan kontrak sesudahnya. Ini yang membuat
 *      subgraph boleh membaca reserve dari log alih-alih menghitungnya.
 *   4. Fee depth dari buyback mengangkat lantai harga. Sebelum perbaikan, angka
 *      ini tidak dipancarkan sehingga indexer tak mungkin tahu.
 *   5. Batas 1% menolak panggilan yang terlalu besar. Tanpa batas itu, buyback
 *      tanpa izin bisa disandwich dan daya beli treasury terbuang.
 *   6. Invarian solvensi tetap utuh sesudahnya.
 *
 *   cd devchain && npx hardhat node
 *   node scripts/deploy-sovereign-curve.mjs --chain devchain --broadcast
 *   node audit_buyback_flow.mjs
 */
import { ethers } from "ethers";
import { readFileSync } from "node:fs";

const RPC = process.env.DEVCHAIN_RPC || "http://127.0.0.1:8545";
/** Akun #0 dan #1 Hardhat: kunci uji publik, hanya berlaku di devchain lokal. */
const PK_DEPLOYER = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PK_STRANGER = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const provider = new ethers.JsonRpcProvider(RPC);

/**
 * NonceManager, bukan Wallet biasa.
 *
 * Harness ini mengirim banyak transaksi dari satu dompet lewat beberapa instance
 * kontrak berbeda, dan hardhat dengan automine tidak mengantre transaksi. Dengan
 * `Wallet` biasa, ethers sempat mengirim ulang nonce yang sudah terpakai dan
 * hardhat menolak dengan "Nonce too low" di tengah pengujian — kegagalan harness
 * yang terlihat seperti kegagalan kontrak. NonceManager mengurutkannya.
 */
const deployerKey = new ethers.Wallet(PK_DEPLOYER, provider);
const strangerKey = new ethers.Wallet(PK_STRANGER, provider);
const deployer = new ethers.NonceManager(deployerKey);
const stranger = new ethers.NonceManager(strangerKey);
/** Alamat asli: NonceManager tidak mengekspos `.address` secara sinkron. */
const DEPLOYER = deployerKey.address;
const STRANGER = strangerKey.address;

/** Naikkan blok. `evm_mine` tanpa argumen ternyata tidak selalu maju di sini. */
async function mine(count) {
  await provider.send("hardhat_mine", [ethers.toQuantity(count)]);
}

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

const art = (n) => JSON.parse(readFileSync(`build/artifacts/${n}.json`, "utf8"));
const deployments = JSON.parse(readFileSync("build/deployments.json", "utf8"));
const FACTORY = deployments.devchain?.curveFactory;
if (!FACTORY) throw new Error("devchain belum punya curveFactory di build/deployments.json");

const factoryArt = art("AdextoCurveFactory");
const curveArt = art("SovereignCurve");
const tokenArt = art("AdextoToken");

const factory = new ethers.Contract(FACTORY, factoryArt.abi, deployer);

console.log("HARNESS BUYBACK — jalur yang belum pernah dieksekusi");
console.log(`factory ${FACTORY}`);
console.log(`pemanggil buyback nanti: ${STRANGER} (bukan creator, bukan agent)`);

// ── 1. Luncurkan satu pasar ─────────────────────────────────────────────────
step("1) LUNCURKAN pasar uji");
const TICKER = `BBK${Math.floor(Math.random() * 900 + 100)}`;
const tx = await factory.deployTrinity(
  "Buyback Harness",
  TICKER,
  1_000_000_000n,
  DEPLOYER, // agentIdentity — tidak lagi mengotorisasi apa pun
  ethers.parseEther("1"),
  30n, // total fee 0,3%
  10n, // creator
  5n, // treasury buyback
  ethers.id("buyback-harness"),
);
const rc = await tx.wait();
const deployed = rc.logs
  .map((l) => {
    try {
      return factory.interface.parseLog(l);
    } catch {
      return null;
    }
  })
  .find((p) => p && p.name === "TrinityProjectDeployed");
check("launch berhasil", Boolean(deployed));
const tokenAddr = deployed.args.token;
const curveAddr = deployed.args.curve;
console.log(`  token ${tokenAddr}\n  kurva ${curveAddr}`);

const token = new ethers.Contract(tokenAddr, tokenArt.abi, provider);
const curve = new ethers.Contract(curveAddr, curveArt.abi, provider);

// Konfirmasi Ownable benar-benar hilang.
const hasOwner = tokenArt.abi.some((x) => x.type === "function" && x.name === "owner");
check("token TIDAK punya owner() lagi", !hasOwner);
check(
  "token TIDAK punya disableAntiSnipe() lagi",
  !tokenArt.abi.some((x) => x.type === "function" && x.name === "disableAntiSnipe"),
);
// Ini sekaligus membuktikan pengecualian `_launcher` bekerja. Factory memindahkan
// 100% supply ke kurva dalam satu transfer, yang per definisi jauh di atas batas
// 1% per transaksi. Kalau penggantian `owner()` -> `_launcher` salah, launch di
// atas sudah gagal dan tidak akan sampai ke baris ini.
check("100% supply di kurva", (await token.balanceOf(curveAddr)) === (await token.totalSupply()));

// ── 2. Isi treasuryNative dengan perdagangan nyata ──────────────────────────
step("2) ISI treasury lewat pembelian nyata");

// Lewati jendela anti-sniper lebih dulu. Selama `block.number <= launchBlock + 5`
// setiap transfer non-launcher dibatasi 1% supply, dan pembelian 0.05 native pada
// kurva bervirtualNative 1 native mengambil ~4,8% supply — jadi ia SEHARUSNYA
// ditolak. Percobaan pertama harness ini memang ditolak, dan itu bukti proteksinya
// bekerja, bukan bug. Yang salah adalah harness-nya yang tidak menunggu.
const launchBlockNum = await token.launchBlock();
await mine(6);
console.log(
  `  launchBlock ${launchBlockNum}, sekarang ${await provider.getBlockNumber()} ` +
    `(jendela anti-sniper ${await token.ANTI_SNIPE_BLOCKS()} blok, sudah lewat)`,
);

for (let i = 0; i < 4; i += 1) {
  await (
    await curve.connect(deployer).buy(0n, DEPLOYER, 0n, { value: ethers.parseEther("0.05") })
  ).wait();
}
const treasuryNative = await curve.treasuryNative();
console.log(`  treasuryNative ${ethers.formatEther(treasuryNative)}`);
check("treasury terisi dari fee swap", treasuryNative > 0n, `${ethers.formatEther(treasuryNative)}`);

// ── 3. Batas 1% harus MENOLAK panggilan terlalu besar ───────────────────────
step("3) BATAS 1% — properti yang membuat tanpa izin aman");

// Ini butuh pasar TERSENDIRI, dan alasannya aritmetika.
//
// Plafonnya 1% dari reserveNative. Dengan pembagian fee normal (treasury 5 bps),
// treasury bertambah 0,05% dari volume sementara reserve bertambah ~99,7% dari
// volume yang sama — jadi treasury TIDAK AKAN PERNAH mencapai 1% reserve, dan
// yang menolak selalu `bad buyback amount`, bukan plafonnya. Menguji plafon di
// pasar itu cuma menguji bahwa treasury-nya kosong.
//
// Jadi pasar kedua ini memakai treasuryShareBps = 500, yaitu SELURUH plafon fee
// 5% masuk treasury. Treasury lalu tumbuh 5% dari volume melawan reserve yang
// tumbuh ~95%, sehingga plafon terlampaui setelah volume ~0,25x virtualNative.
const capTx = await factory.deployTrinity(
  "Cap Harness",
  `CAP${Math.floor(Math.random() * 900 + 100)}`,
  1_000_000_000n,
  DEPLOYER,
  ethers.parseEther("1"),
  500n, // total fee 5% — plafon MAX_TOTAL_FEE_BPS
  0n, // creator 0
  500n, // treasury 500 bps: semuanya ke treasury
  ethers.id("cap-harness"),
);
const capRc = await capTx.wait();
const capDeployed = capRc.logs
  .map((l) => {
    try {
      return factory.interface.parseLog(l);
    } catch {
      return null;
    }
  })
  .find((p) => p && p.name === "TrinityProjectDeployed");
const capCurve = new ethers.Contract(capDeployed.args.curve, curveArt.abi, provider);
const capToken = new ethers.Contract(capDeployed.args.token, tokenArt.abi, provider);
await mine(6);
for (let i = 0; i < 6; i += 1) {
  await (
    await capCurve
      .connect(deployer)
      .buy(0n, DEPLOYER, 0n, { value: ethers.parseEther("0.05") })
  ).wait();
}

const [capResNative] = await capCurve.getReserves();
const capTreasury = await capCurve.treasuryNative();
const cap1pct = capResNative / 100n;
console.log(`  reserveNative ${ethers.formatEther(capResNative)}`);
console.log(`  treasuryNative ${ethers.formatEther(capTreasury)}`);
console.log(`  plafon 1%      ${ethers.formatEther(cap1pct)}`);
check(
  "treasury MELEBIHI plafon, jadi plafonnya yang mengikat",
  capTreasury > cap1pct,
  `${ethers.formatEther(capTreasury)} > ${ethers.formatEther(cap1pct)}`,
);

let capMsg = "";
try {
  await capCurve.connect(stranger).executeBuyback.staticCall(capTreasury, 0n);
} catch (e) {
  capMsg = e.shortMessage ?? e.message;
}
check(
  "membelanjakan SELURUH treasury ditolak plafon 1%",
  /1% of reserve/.test(capMsg),
  capMsg.slice(0, 60),
);

// Tepat di plafon harus lolos, satu wei di atasnya harus ditolak. Ini yang
// membuktikan batasnya persis di 1%, bukan kira-kira.
let atCapOk = true;
try {
  await capCurve.connect(stranger).executeBuyback.staticCall(cap1pct, 0n);
} catch (e) {
  atCapOk = false;
  console.log(`    tepat di plafon gagal: ${(e.shortMessage ?? e.message).slice(0, 60)}`);
}
check("tepat di plafon 1% DITERIMA", atCapOk);

let overCapRejected = false;
try {
  await capCurve.connect(stranger).executeBuyback.staticCall(cap1pct + 1n, 0n);
} catch (e) {
  overCapRejected = /1% of reserve/.test(e.shortMessage ?? e.message);
}
check("satu wei di atas plafon DITOLAK", overCapRejected);

// Dan buyback dalam batas tetap berhasil, jadi plafonnya membatasi bukan memblokir.
const capSupplyBefore = await capToken.totalSupply();
await (await capCurve.connect(stranger).executeBuyback(cap1pct, 0n)).wait();
check("buyback dalam batas tetap berhasil", (await capToken.totalSupply()) < capSupplyBefore);

step("3b) kembali ke pasar utama untuk uji kebenaran buyback");
const [resNativeBefore] = await curve.getReserves();
const capWei = resNativeBefore / 100n;
console.log(`  reserveNative ${ethers.formatEther(resNativeBefore)}, plafon 1% = ${ethers.formatEther(capWei)}`);

// ── 4. Buyback dipanggil ALAMAT ACAK ───────────────────────────────────────
step("4) BUYBACK dipanggil alamat acak — arti sebenarnya dari tanpa izin");
const spend = treasuryNative < capWei ? treasuryNative : capWei;
const supplyBefore = await token.totalSupply();
const depthFeesBefore = await curve.totalDepthFeesRetained();
const floorBefore = await curve.floorPriceNativePerToken();
const strangerBalBefore = await provider.getBalance(STRANGER);

const bbTx = await curve.connect(stranger).executeBuyback(spend, 0n);
const bbRc = await bbTx.wait();
check("alamat acak BERHASIL memicu buyback", bbRc.status === 1);

const ev = bbRc.logs
  .map((l) => {
    try {
      return curve.interface.parseLog(l);
    } catch {
      return null;
    }
  })
  .find((p) => p && p.name === "AutoBuybackExecuted");
check("event AutoBuybackExecuted dipancarkan", Boolean(ev));

// ── 5. Lima field event harus cocok dengan keadaan kontrak ──────────────────
step("5) EVENT vs KEADAAN KONTRAK — dasar subgraph membaca dari log");
const [resNativeAfter, resTokenAfter] = await curve.getReserves();
check("amountIn cocok", ev.args.amountIn === spend, `${ethers.formatEther(ev.args.amountIn)}`);
check(
  "nativeReserveAfter cocok getReserves()",
  ev.args.nativeReserveAfter === resNativeAfter,
  `event ${ev.args.nativeReserveAfter} vs kontrak ${resNativeAfter}`,
);
check(
  "tokenReserveAfter cocok getReserves()",
  ev.args.tokenReserveAfter === resTokenAfter,
  `event ${ev.args.tokenReserveAfter} vs kontrak ${resTokenAfter}`,
);
const depthDelta = (await curve.totalDepthFeesRetained()) - depthFeesBefore;
check(
  "depthFee cocok kenaikan totalDepthFeesRetained",
  ev.args.depthFee === depthDelta,
  `event ${ev.args.depthFee} vs delta ${depthDelta}`,
);
check("depthFee bukan nol", ev.args.depthFee > 0n, `${ev.args.depthFee}`);

// ── 6. Token benar-benar dibakar ────────────────────────────────────────────
step("6) PEMBAKARAN — supply harus benar-benar turun");
const supplyAfter = await token.totalSupply();
const burned = supplyBefore - supplyAfter;
check("totalSupply turun", supplyAfter < supplyBefore, `-${ethers.formatUnits(burned, 18)}`);
check(
  "jumlah terbakar cocok tokensBurned di event",
  burned === ev.args.tokensBurned,
  `supply -${burned} vs event ${ev.args.tokensBurned}`,
);
check("totalTokensBurned kurva bertambah", (await curve.totalTokensBurned()) === burned);

// ── 7. Lantai harga naik ────────────────────────────────────────────────────
step("7) LANTAI HARGA — angka yang dulu tidak mungkin diketahui indexer");
const floorAfter = await curve.floorPriceNativePerToken();
check(
  "lantai harga naik setelah buyback",
  floorAfter > floorBefore,
  `${ethers.formatEther(floorBefore)} -> ${ethers.formatEther(floorAfter)}`,
);
// Inilah yang subgraph hitung ulang dari depthFee di event.
const virtualNative = await curve.virtualNative();
const curveTokens = await curve.curveTokens();
const floorExpected = ((virtualNative + (await curve.totalDepthFeesRetained())) * 10n ** 18n) / curveTokens;
check("rumus lantai subgraph cocok kontrak", floorExpected === floorAfter);

// ── 8. Solvensi & treasury ──────────────────────────────────────────────────
step("8) SOLVENSI");
const balance = await provider.getBalance(curveAddr);
const realNative = await curve.realNative();
const creatorOwed = await curve.creatorOwed();
const treasuryAfter = await curve.treasuryNative();
check(
  "saldo >= curve + creator + treasury",
  balance >= realNative + creatorOwed + treasuryAfter,
  `${ethers.formatEther(balance)} >= ${ethers.formatEther(realNative + creatorOwed + treasuryAfter)}`,
);
check("treasury berkurang tepat sebesar yang dibelanjakan", treasuryNative - treasuryAfter === spend);
check(
  "pemanggil TIDAK menerima native apa pun",
  (await provider.getBalance(STRANGER)) < strangerBalBefore,
  "hanya membayar gas, tidak ada aliran keluar ke pemanggil",
);

// ── 9. Perdagangan tetap normal sesudahnya ──────────────────────────────────
step("9) PERDAGANGAN sesudah buyback");
const balBefore = await token.balanceOf(DEPLOYER);
await (
  await curve.connect(deployer).buy(0n, DEPLOYER, 0n, { value: ethers.parseEther("0.01") })
).wait();
check("beli masih jalan sesudah buyback", (await token.balanceOf(DEPLOYER)) > balBefore);

// Nonce TIDAK dipasang manual. Percobaan sebelumnya melakukannya dan itulah yang
// MENYEBABKAN "Nonce too low": variabelnya dibaca sekali dengan "latest" lalu jadi
// basi begitu transaksi berikutnya terkirim. NonceManager di atas yang mengurut.
const sellAmount = (await token.balanceOf(DEPLOYER)) / 10n;
await (await token.connect(deployer).approve(curveAddr, sellAmount)).wait();
const tokenBalBeforeSell = await token.balanceOf(DEPLOYER);
await (await curve.connect(deployer).sell(sellAmount, 0n, DEPLOYER, 0n)).wait();
check(
  "jual masih jalan sesudah buyback",
  (await token.balanceOf(DEPLOYER)) === tokenBalBeforeSell - sellAmount,
  `-${ethers.formatUnits(sellAmount, 18)} token`,
);

// Volume harus dihitung bruto di kedua arah sekarang. Sebelum perbaikan, jual
// dihitung neto sehingga ukuran perdagangan yang sama tercatat sebagai dua volume
// berbeda tergantung arahnya.
step("10) VOLUME bruto di kedua arah");
const swapLogs = await provider.getLogs({
  address: curveAddr,
  topics: [curve.interface.getEvent("Swap").topicHash],
  fromBlock: 0,
  toBlock: "latest",
});
const parsedSwaps = swapLogs.map((l) => curve.interface.parseLog(l));
const lastSell = [...parsedSwaps].reverse().find((s) => !s.args.isBuy);
check("ada Swap jual yang tercatat", Boolean(lastSell));
if (lastSell) {
  const gross = lastSell.args.amountOut + lastSell.args.depthFee + lastSell.args.creatorFee + lastSell.args.treasuryFee;
  const onChainVolume = await curve.totalVolumeNative();
  const sumFromEvents = parsedSwaps.reduce(
    (acc, s) =>
      acc +
      (s.args.isBuy
        ? s.args.amountIn
        : s.args.amountOut + s.args.depthFee + s.args.creatorFee + s.args.treasuryFee),
    0n,
  );
  check(
    "totalVolumeNative kontrak = jumlah bruto dari event",
    onChainVolume === sumFromEvents,
    `kontrak ${onChainVolume} vs event ${sumFromEvents}`,
  );
  console.log(`    jual terakhir: neto ${lastSell.args.amountOut}, bruto ${gross}`);
}

console.log(`\n  ${pass} LULUS / ${fail} GAGAL`);
if (failures.length) {
  console.log("\ngagal:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(fail === 0 ? 0 : 1);
