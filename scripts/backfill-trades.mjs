/**
 * Isi store telemetry dengan perdagangan SUNGGUHAN sebuah pasar, dibaca dari chain.
 *
 *   node scripts/backfill-trades.mjs --symbol CURB --chain monad             # dry run
 *   node scripts/backfill-trades.mjs --symbol CURB --chain monad --broadcast
 *
 * KENAPA INI PERLU ADA, DAN KENAPA BUKAN SEKADAR MENAIKKAN ANGGARAN PEMINDAIAN
 *
 * Chart dan trade feed membaca `/api/agent/telemetry`. Kalau store-nya kosong, endpoint
 * itu jatuh ke pemindaian `getLogs` on-chain — dan lebar rentang yang diterima tiap RPC
 * berbeda jauh. Terukur di `src/lib/onchain-trades.ts`: 0G menerima 500.000 blok per
 * panggilan, Monad hanya 100. Dengan anggaran 16 panggilan, jendela yang terjangkau di
 * Monad adalah 1.600 blok — sekitar DELAPAN MENIT pada ~0,3 s/blok.
 *
 * Akibatnya pasar Monad tampil kosong beberapa menit setelah diperdagangkan, dan
 * pesannya menyesatkan: karena tidak ada log yang ditemukan, tidak ada blok yang perlu
 * di-timestamp, lalu endpoint melaporkan "Node returned no block timestamps" — masalah
 * yang terdengar seperti node bermasalah padahal jendelanya yang terlalu sempit.
 *
 * Menaikkan anggaran panggilan tidak menyelesaikannya: menjangkau riwayat berjam-jam di
 * petak 100 blok menuntut ratusan panggilan RPC untuk SATU kali muat halaman. Indexer
 * adalah jawaban sebenarnya, dan sampai itu ada, perdagangan yang sudah terjadi disimpan
 * sekali supaya tidak perlu ditemukan ulang setiap kali halaman dibuka.
 *
 * YANG TIDAK DILAKUKAN BERKAS INI
 *
 * Tidak mengarang satu angka pun. Setiap nilai berasal dari event `Swap` di chain:
 * arah dari `isBuy`, jumlah dari `amountIn`/`amountOut`, harga eksekusi dari rasio
 * keduanya, dan harga spot sesudahnya dari `nativeReserveAfter`/`tokenReserveAfter`.
 * Waktunya dari timestamp blok, tidak pernah dari jam sekarang. Semuanya ditandai
 * `source: "onchain"` supaya UI tidak pernah menyajikannya sebagai sesuatu yang lain.
 */
import { ethers } from "ethers";
import * as dotenv from "dotenv";
import fs from "fs";

dotenv.config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const argOf = (f) => {
  const i = args.indexOf(f);
  return i === -1 ? "" : (args[i + 1] || "").trim();
};
const BROADCAST = args.includes("--broadcast");
const SYMBOL = argOf("--symbol").toUpperCase();
const CHAIN_KEY = argOf("--chain").toLowerCase();
const TARGET = argOf("--target") || "https://adexto.xyz";

const CHAINS = {
  monad: { chainId: 143, rpc: "https://rpc.monad.xyz", native: "MON", span: 100 },
  "0g": { chainId: 16661, rpc: process.env.OG_RPC_URL || "https://evmrpc.0g.ai", native: "0G", span: 500_000 },
};
const chain = CHAINS[CHAIN_KEY];
if (!SYMBOL || !chain) {
  console.error(`Usage: --symbol <TICKER> --chain <${Object.keys(CHAINS).join("|")}> [--target URL] [--broadcast]`);
  process.exit(1);
}

const SECRET = process.env.ADEXTO_TELEMETRY_SECRET;
if (!SECRET || SECRET.length < 16) {
  console.error("ADEXTO_TELEMETRY_SECRET belum diset (minimal 16 karakter).");
  process.exit(1);
}

const abis = JSON.parse(fs.readFileSync("public/abi/index.json", "utf8")).contracts;
const provider = new ethers.JsonRpcProvider(chain.rpc, chain.chainId, { staticNetwork: true });

// Pasar diselesaikan lewat registry TARGET, bukan alamat dari argumen: yang diisi harus
// pasar yang benar-benar dilayani situs itu.
const projects = await fetch(`${TARGET}/api/graphql`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "{ projects { symbol chainId poolAddress blockNumber } }" }),
})
  .then((r) => r.json())
  .then((j) => j?.data?.projects ?? []);

const market = projects.find(
  (p) => String(p.symbol).toUpperCase() === SYMBOL && Number(p.chainId) === chain.chainId
);
if (!market) {
  console.error(`$${SYMBOL} tidak ada di registry ${TARGET} untuk chain ${chain.chainId}.`);
  process.exit(1);
}

const curve = new ethers.Contract(market.poolAddress, abis.AdextoCurve.abi, provider);
const swapCount = Number(await curve.swapCount());
const latest = await provider.getBlockNumber();

console.log(`pasar     : $${SYMBOL} · ${market.poolAddress} · chain ${chain.chainId}`);
console.log(`swapCount : ${swapCount}  (jumlah yang harus ditemukan)`);
console.log(`target    : ${TARGET}`);

// Titik mulai: blok peluncuran kalau registry tahu, kalau tidak mundur dari kepala.
let from = Number(market.blockNumber) > 0 ? Number(market.blockNumber) : latest - chain.span * 40;
console.log(`memindai  : ${from} -> ${latest} dalam petak ${chain.span} blok\n`);

const found = [];
for (let lo = from; lo <= latest && found.length < swapCount; lo += chain.span) {
  const hi = Math.min(lo + chain.span - 1, latest);
  try {
    const logs = await curve.queryFilter(curve.filters.Swap(), lo, hi);
    for (const l of logs) found.push(l);
  } catch (e) {
    console.log(`  ${lo}-${hi} gagal: ${String(e.shortMessage ?? e.message).slice(0, 70)}`);
  }
}
console.log(`ditemukan : ${found.length} event Swap`);
if (found.length === 0) process.exit(1);

// Timestamp blok dibaca, tidak pernah diperkirakan dari jam sekarang.
const times = new Map();
for (const l of found) {
  if (times.has(l.blockNumber)) continue;
  const b = await provider.getBlock(l.blockNumber);
  if (b) times.set(l.blockNumber, Number(b.timestamp));
}

const trades = found.map((l) => {
  const a = l.args;
  const isBuy = Boolean(a.isBuy);
  const amountNative = Number(ethers.formatEther(isBuy ? a.amountIn : a.amountOut));
  const amountToken = Number(ethers.formatEther(isBuy ? a.amountOut : a.amountIn));
  const reserveNative = Number(ethers.formatEther(a.nativeReserveAfter));
  const reserveToken = Number(ethers.formatEther(a.tokenReserveAfter));
  const ts = times.get(l.blockNumber);
  return {
    txHash: l.transactionHash,
    symbol: SYMBOL,
    type: isBuy ? "BUY" : "SELL",
    amountToken,
    amountNative,
    nativeSymbol: chain.native,
    // Harga eksekusi: yang benar-benar dibayar/diterima, fee termasuk.
    priceNative: amountToken > 0 ? amountNative / amountToken : 0,
    // Harga pasar sesudah trade, dari snapshot reserve event itu sendiri.
    priceNativeAfter: reserveToken > 0 ? reserveNative / reserveToken : null,
    trader: a.trader,
    timestamp: ts ? new Date(ts * 1000).toISOString() : undefined,
    blockNumber: l.blockNumber,
    chainId: chain.chainId,
    source: "onchain",
  };
});

console.log();
for (const t of trades) {
  console.log(
    `  ${t.type.padEnd(4)} blok ${t.blockNumber}  ${t.amountNative.toFixed(6)} ${chain.native} <-> ${t.amountToken.toFixed(4)} ${SYMBOL}` +
      `  spot ${t.priceNativeAfter?.toExponential(4)}  ${t.timestamp ?? "TANPA WAKTU"}`
  );
}

if (!BROADCAST) {
  console.log(`\nDRY RUN — tidak ada yang dikirim. Ulangi dengan --broadcast.`);
  process.exit(0);
}

console.log(`\nmengirim ke ${TARGET}/api/agent/telemetry …`);
let ok = 0;
for (const t of trades) {
  const r = await fetch(`${TARGET}/api/agent/telemetry`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
    body: JSON.stringify(t),
  });
  const body = await r.text();
  if (r.ok) {
    ok++;
    console.log(`  ${t.type} ${t.txHash.slice(0, 12)}…  HTTP ${r.status}`);
  } else {
    console.log(`  ${t.type} ${t.txHash.slice(0, 12)}…  HTTP ${r.status}  ${body.slice(0, 120)}`);
  }
}
console.log(`\nterkirim ${ok}/${trades.length}`);
