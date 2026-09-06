/**
 * Uji kode FRONTEND yang sebenarnya terhadap kurva 0.11.0 yang hidup.
 *
 * Kenapa ini ada terpisah dari scripts/test-adexto-curve.mjs: harness itu memanggil
 * kontrak langsung, jadi ia membuktikan kontraknya benar tetapi tidak membuktikan
 * apa pun tentang `src/lib`. Justru di situ perubahan sesi ini berada — ABI baru,
 * iface `Swap` ketiga, dan mirror fee lokal yang menyuapi `minTokensOut`. Menyalin
 * logikanya ke dalam probe hanya akan menguji salinannya.
 *
 * Karena itu probe ini MENGIMPOR modul yang dipakai aplikasi, lalu membandingkannya
 * dengan jawaban kontrak:
 *   1. readPoolState membaca kaki protokol dan totalFeeBps
 *   2. quoteBuyLocal cocok PERSIS dengan getBuyQuote di chain (lima nilai)
 *   3. quoteSellLocal cocok PERSIS dengan getSellQuote di chain
 *   4. readOnChainSwaps mendekode Swap 0.11.0 — bug "candle tidak muncul" tidak terulang
 *   5. kuotasi 0.10.0 TIDAK rusak oleh iface baru
 *
 * Pakai:
 *   anvil --port 8545 --chain-id 31337 --silent
 *   npx tsx scripts/test-frontend-curve-wiring.mts
 */
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import type { ChainInfo } from "../src/lib/chains";
import { readPoolState, quoteBuyLocal, quoteSellLocal, ADEXTO_CURVE_ABI } from "../src/lib/dex";
import { readOnChainSwaps, buildCandles } from "../src/lib/onchain-trades";

const RPC = process.env.TEST_RPC || "http://127.0.0.1:8545";
const PK = process.env.DEVCHAIN_PK || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const ART = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), "build", "artifacts", `${name}.json`), "utf8"));

let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures += 1;
};
const step = (s: string) => console.log(`\n${s}`);

const provider = new ethers.JsonRpcProvider(RPC);
const signingKey = new ethers.Wallet(PK, provider);
const wallet = new ethers.NonceManager(signingKey);
const ME = signingKey.address;
const net = await provider.getNetwork();

const TREASURY = "0x00000000000000000000000000000000000000E2";

/** ChainInfo sintetis untuk devchain — cukup untuk yang dibaca kedua modul. */
const chain: ChainInfo = {
  key: "Devchain",
  chainId: Number(net.chainId),
  name: "Local Devchain",
  label: `Local Devchain (${net.chainId})`,
  rpcUrl: RPC,
  blockExplorer: "",
  nativeSymbol: "ETH",
  nativeCurrencyName: "ETH",
  factoryAddress: "",
  curveFactoryAddress: null,
  supersededCurveFactoryAddress: null,
  launchGeneration: "curve",
  defaultVirtualNative: 1,
  legacyHookAddress: "",
  governorAddress: "",
  dexLive: true,
  brandLogo: null,
};

console.log(`chainId=${net.chainId} rpc=${RPC}`);
console.log(`deployer=${ME}`);

// ── Siapkan pasar 0.11.0 dan satu 0.10.0 sebagai pembanding ─────────────────
step("0) SIAPKAN dua pasar: 0.11.0 dan 0.10.0");
const SUPPLY = 1_000_000_000n;
const VIRTUAL = ethers.parseEther("1");

const f11Art = ART("AdextoFactory");
const f11 = await new ethers.ContractFactory(f11Art.abi, f11Art.bytecode, wallet).deploy(TREASURY);
await f11.waitForDeployment();
const S11 = `PFE${Math.floor(Math.random() * 900 + 100)}`;
await (
  await (f11 as any).deployTrinity("Probe 11", S11, SUPPLY, ME, VIRTUAL, 30, 10, 5, ethers.ZeroHash, false, 0)
).wait();
const [tok11, curve11] = await (f11 as any).projectAt(0);
console.log(`  0.11.0 curve: ${curve11}`);

const f10Art = ART("AdextoCurveFactory");
const f10 = await new ethers.ContractFactory(f10Art.abi, f10Art.bytecode, wallet).deploy();
await f10.waitForDeployment();
const S10 = `PFO${Math.floor(Math.random() * 900 + 100)}`;
await (
  await (f10 as any).deployTrinity("Probe 10", S10, SUPPLY, ME, VIRTUAL, 30, 10, 5, ethers.ZeroHash, false, 0)
).wait();
const [, curve10] = await (f10 as any).projectAt(0);
console.log(`  0.10.0 curve: ${curve10}`);

// Lewati window anti-sniper, lalu perdagangkan keduanya supaya ada log Swap nyata.
for (let i = 0; i < 8; i++) await provider.send("evm_mine", []);

const c11 = new ethers.Contract(curve11, ADEXTO_CURVE_ABI, wallet);
const c10 = new ethers.Contract(curve10, ART("SovereignCurve").abi, wallet);
const BUY = ethers.parseEther("0.05");
await (await (c11 as any).buy(0, ME, 0, { value: BUY })).wait();
await (await (c10 as any).buy(0, ME, 0, { value: BUY })).wait();

// ── 1. readPoolState membaca kaki protokol ──────────────────────────────────
step("1) readPoolState — kaki protokol terbaca dari chain");
const st11 = await readPoolState(chain, curve11);
check("state 0.11.0 terbaca", Boolean(st11));
if (st11) {
  const [onDepth, onCreator, onBuyback, onProto, onTotal] = await Promise.all([
    (c11 as any).depthFeeBps(),
    (c11 as any).creatorFeeBps(),
    (c11 as any).treasuryBuybackBps(),
    (c11 as any).protocolFeeBps(),
    (c11 as any).totalFeeBps(),
  ]);
  check("protocolFeeBps cocok dengan kontrak", st11.protocolFeeBps === BigInt(onProto), `${st11.protocolFeeBps}`);
  check(
    "protocolTreasury cocok dengan kontrak",
    (st11.protocolTreasury ?? "").toLowerCase() === TREASURY.toLowerCase(),
    st11.protocolTreasury ?? "null"
  );
  check("protocolOwed bukan nol setelah beli", st11.protocolOwed > 0n, `${st11.protocolOwed}`);
  check(
    "totalFeeBps yang dihitung lib = totalFeeBps kontrak",
    st11.totalFeeBps === BigInt(onTotal),
    `lib ${st11.totalFeeBps} vs kontrak ${onTotal}`
  );
  check(
    "empat kaki menjumlah ke total",
    st11.lpFeeBps + st11.creatorFeeBps + st11.treasuryBuybackBps + st11.protocolFeeBps === BigInt(onTotal),
    `${onDepth}+${onCreator}+${onBuyback}+${onProto}`
  );
}

const st10 = await readPoolState(chain, curve10);
check("state 0.10.0 masih terbaca", Boolean(st10));
if (st10) {
  check("kaki protokol NOL di 0.10.0 (bukan ditebak)", st10.protocolFeeBps === 0n);
  check("protocolTreasury null di 0.10.0", st10.protocolTreasury === null);
  check(
    "totalFeeBps 0.10.0 = tiga kaki saja",
    st10.totalFeeBps === st10.lpFeeBps + st10.creatorFeeBps + st10.treasuryBuybackBps,
    `${st10.totalFeeBps}`
  );
}

// ── 2. quoteBuyLocal harus cocok PERSIS ─────────────────────────────────────
step("2) quoteBuyLocal vs getBuyQuote di chain");
if (st11) {
  for (const amount of [ethers.parseEther("0.001"), ethers.parseEther("0.05"), ethers.parseEther("0.5")]) {
    const local = quoteBuyLocal(st11, amount);
    const onchain = await (c11 as any).getBuyQuote(amount);
    check(
      `beli ${ethers.formatEther(amount)}: tokensOut sama`,
      local.amountOut === BigInt(onchain[0]),
      `lokal ${local.amountOut} vs chain ${onchain[0]}`
    );
    check(`beli ${ethers.formatEther(amount)}: protocolFee sama`, local.protocolFee === BigInt(onchain[4]));
    check(
      `beli ${ethers.formatEther(amount)}: keempat kaki sama`,
      local.lpFee === BigInt(onchain[1]) &&
        local.creatorFee === BigInt(onchain[2]) &&
        local.treasuryFee === BigInt(onchain[3])
    );
  }

  /**
   * Bukti bahwa kaki protokol memang MENGUBAH hasilnya.
   *
   * Kalau `protocolFeeBps` dilupakan, `dx` jadi terlalu besar dan kuotasinya lebih
   * banyak token daripada yang dibayar kurva — lalu `minTokensOut` dari layar itu
   * membuat transaksinya revert. Cek ini memastikan perbedaannya nyata, sehingga
   * "cocok" di atas bukan kebetulan karena kaki itu nol.
   */
  const naive = quoteBuyLocal({ ...st11, protocolFeeBps: 0n }, ethers.parseEther("0.05"));
  const correct = quoteBuyLocal(st11, ethers.parseEther("0.05"));
  check(
    "melupakan kaki protokol BENAR-BENAR mengubah kuotasi (over-quote)",
    naive.amountOut > correct.amountOut,
    `naif ${naive.amountOut} > benar ${correct.amountOut}`
  );
}

// ── 3. quoteSellLocal harus cocok PERSIS ────────────────────────────────────
step("3) quoteSellLocal vs getSellQuote di chain");
if (st11) {
  const token11 = new ethers.Contract(tok11, ART("AdextoToken").abi, wallet);
  const held: bigint = await (token11 as any).balanceOf(ME);
  for (const part of [held / 10n, held / 3n, held]) {
    if (part === 0n) continue;
    const local = quoteSellLocal(st11, part);
    const onchain = await (c11 as any).getSellQuote(part);
    check(
      `jual ${ethers.formatUnits(part, 18)}: nativeOut sama`,
      local.amountOut === BigInt(onchain[0]),
      `lokal ${local.amountOut} vs chain ${onchain[0]}`
    );
    check(`jual ${ethers.formatUnits(part, 18)}: protocolFee sama`, local.protocolFee === BigInt(onchain[4]));
  }
}

// ── 4. readOnChainSwaps mendekode Swap 0.11.0 ───────────────────────────────
step("4) readOnChainSwaps — Swap 0.11.0 tidak lagi tak terlihat");
const trades11 = await readOnChainSwaps(chain, curve11, S11);
check("swap 0.11.0 terbaca", trades11.length > 0, `${trades11.length} trade`);
if (trades11.length > 0) {
  const t = trades11[0];
  check("tipe trade terdekode", t.type === "BUY", t.type);
  check("jumlah native terdekode", t.amountNative > 0, String(t.amountNative));
  check("jumlah token terdekode", t.amountToken > 0, String(t.amountToken));
  /**
   * `priceNativeAfter` adalah bukti kedua reserve terbaca lewat NAMA, bukan indeks.
   * Kalau dibaca positional gaya 0.10.0, indeks itu berisi `protocolFee` — angka
   * mikroskopis — dan harganya akan meleset beberapa orde besaran, bukan null.
   */
  check("priceNativeAfter terbaca dari kedua reserve", (t.priceNativeAfter ?? 0) > 0, String(t.priceNativeAfter));
  const spot = await (c11 as any).spotPriceNativePerToken();
  const spotNum = Number(ethers.formatEther(spot));
  const rel = Math.abs((t.priceNativeAfter ?? 0) - spotNum) / spotNum;
  check(
    "priceNativeAfter = spotPriceNativePerToken kontrak",
    rel < 1e-9,
    `event ${t.priceNativeAfter} vs kontrak ${spotNum}`
  );
  const candles = buildCandles(trades11, { bucketSeconds: 60, buckets: 48, fallbackPrice: spotNum });
  check("candle terbentuk dari swap nyata", candles.length > 0, `${candles.length} candle`);
}

// ── 5. Generasi 0.10.0 tidak rusak ──────────────────────────────────────────
step("5) 0.10.0 tetap terdekode setelah iface ketiga ditambahkan");
const trades10 = await readOnChainSwaps(chain, curve10, S10);
check("swap 0.10.0 masih terbaca", trades10.length > 0, `${trades10.length} trade`);
if (trades10.length > 0) {
  check("priceNativeAfter 0.10.0 masih terbaca", (trades10[0].priceNativeAfter ?? 0) > 0);
}

console.log(failures === 0 ? "\nSEMUA CEK LULUS" : `\n${failures} CEK GAGAL`);
process.exit(failures === 0 ? 0 : 1);
