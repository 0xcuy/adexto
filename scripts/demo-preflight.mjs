/**
 * Pre-flight demo: verifikasi semua yang demo-nya bergantung padanya, dalam satu perintah.
 *
 *   node scripts/demo-preflight.mjs
 *
 * KENAPA INI ADA
 *
 * Demo langsung punya banyak titik gagal yang tidak terlihat sampai ia gagal di depan
 * orang: stok relayer habis, 0G Compute lambat, MCP tidak terdaftar, model agent tersetel
 * ke provider yang salah. Skrip ini mengubah "semoga jalan" menjadi "terbukti semenit lalu".
 *
 * Jalankan 60 detik sebelum tampil. Kalau ada satu FAIL, jangan mulai — cabang
 * penanganannya ada di §Demo Day 3 pada runbook.
 *
 * KUNCI AGENT TIDAK DICETAK. Skrip ini hanya melaporkan apakah gerbangnya menolak
 * pemanggil tanpa kunci, yang justru pemeriksaan yang berarti.
 */
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

const SITE = process.env.BASE_URL || "https://adexto.xyz";
const GATEWAY = "https://x402.adexto.xyz";
const DEPLOYER = "0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D";
const RELAYER = "0xDe1f5e5505c01aC6C847146fF76E0e067A49C627";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const OPENCLAW = process.env.OPENCLAW_URL || "http://127.0.0.1:18789";

let fails = 0;
let warns = 0;
const ok = (label, pass, detail = "", warnOnly = false) => {
  if (!pass && warnOnly) warns++;
  else if (!pass) fails++;
  console.log(`${pass ? "OK  " : warnOnly ? "WARN" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};
const head = (t) => console.log(`\n── ${t}`);

const RPC = {
  16661: "https://evmrpc.0g.ai",
  143: "https://rpc1.monad.xyz",
  8453: "https://base-rpc.publicnode.com",
  42161: "https://arb1.arbitrum.io/rpc",
};
const provider = (cid) => new ethers.JsonRpcProvider(RPC[cid], cid, { staticNetwork: true, batchMaxCount: 1 });

/** Buka bungkus SSE. Memberi seluruh badan ke JSON.parse akan gagal di `event:`. */
async function mcp(method, params, headers = {}) {
  const res = await fetch(`${SITE}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse(line ? line.slice(6) : text);
}
async function tool(name, args, headers = {}) {
  const env = await mcp("tools/call", { name, arguments: args }, headers);
  try {
    return JSON.parse(env.result.content[0].text);
  } catch {
    return { _error: env.error ?? env };
  }
}

// ── 1. situs dan halaman yang dipakai ────────────────────────────────────────
head("situs dan halaman");
for (const [label, url] of [
  ["halaman depan", `${SITE}/`],
  ["explorer", `${SITE}/explorer`],
  ["halaman MCP", `${SITE}/mcp`],
  ["dek Day 2", "https://day2.adexto.xyz/"],
]) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    ok(label, r.status === 200, `HTTP ${r.status}`);
  } catch (e) {
    ok(label, false, String(e.message).slice(0, 50));
  }
}

// ── 2. MCP ───────────────────────────────────────────────────────────────────
head("server MCP");
try {
  const list = await mcp("tools/list", {});
  const names = (list.result?.tools ?? []).map((t) => t.name);
  ok("tools/list menjawab", names.length === 7, `${names.length} alat`);
  for (const t of ["list_markets", "quote_buy", "pay_and_buy", "trade_history"])
    ok(`  alat ${t}`, names.includes(t));
} catch (e) {
  ok("tools/list menjawab", false, String(e.message).slice(0, 60));
}

const markets = await tool("list_markets", {});
/**
 * Jumlah pasar dibaca dari `onchain-launches.json`, bukan ditulis sebagai angka di sini.
 *
 * Syarat lamanya `markets.count === 5`, lalu `$ZEEBO` diluncurkan dan gerbang pra-demo ini
 * mulai GAGAL untuk sesuatu yang bukan masalah. Gerbang yang berbunyi salah akan dilatih
 * untuk diabaikan, dan gerbang yang diabaikan sama saja dengan tidak ada.
 *
 * `listedMarkets` di berkas itu sudah dijaga `audit_consistency.mjs` terhadap
 * `totalProjectsCount()` di keempat chain, jadi ia satu-satunya angka yang tidak bisa
 * basi tanpa ada yang menggagalkan build.
 */
const LISTED = JSON.parse(readFileSync("src/config/onchain-launches.json", "utf8")).listedMarkets;
ok(
  `list_markets memuat ${LISTED} pasar di 4 chain`,
  markets.count === LISTED && new Set(markets.markets?.map((m) => m.chainId)).size === 4,
  `count=${markets.count} vs listedMarkets=${LISTED}`,
);

// Pemeriksaan keamanan: alat berbayar HARUS menolak pemanggil tanpa kunci.
const anon = await tool("pay_and_buy", { symbol: markets.markets?.[0]?.symbol ?? "BLOOP" });
ok("pay_and_buy menolak pemanggil tanpa kunci", anon.error === "not_authorised", anon.error ?? "TIDAK DITOLAK — BAHAYA");

// ── 3. x402: kutipan dan stok tiap pasar ────────────────────────────────────
head("x402 per pasar");
for (const m of markets.markets ?? []) {
  try {
    const r = await fetch(`${GATEWAY}/v1/x402/buy/${m.symbol.toLowerCase()}`, { signal: AbortSignal.timeout(60000) });
    const j = await r.json();
    const inv = j.quote?.inventory ?? {};
    ok(`$${m.symbol} di ${m.chain}`, r.status === 402 && inv.inStock === true, `HTTP ${r.status} stok=${inv.inStock} sisa=${inv.remainingBuys}`);
  } catch (e) {
    ok(`$${m.symbol}`, false, String(e.message).slice(0, 50));
  }
}

// ── 4. amunisi ───────────────────────────────────────────────────────────────
head("amunisi");
const usdc = new ethers.Contract(USDC_BASE, ["function balanceOf(address) view returns (uint256)"], provider(8453));
const u = Number(ethers.formatUnits(await usdc.balanceOf(DEPLOYER), 6));
ok("USDC pembeli cukup (>= 5 pembelian)", u >= 0.5, `${u.toFixed(2)} USDC = ${Math.floor(u / 0.1)} pembelian`);

const launch = { 16661: 0.0126, 143: 0.6334, 8453: 0.0000347, 42161: 0.000127 };
for (const [cid, cost] of Object.entries(launch)) {
  const b = Number(ethers.formatEther(await provider(Number(cid)).getBalance(DEPLOYER)));
  const n = Math.floor(b / cost);
  ok(`  deployer chain ${cid}: >= 3 peluncuran`, n >= 3, `${n} peluncuran`, cid !== "16661");
}
/**
 * Stok relayai diukur dalam FILL, bukan `b > 0`.
 *
 * Syarat lamanya `b > 0` lolos dengan stok satu fill, yaitu tepat keadaan yang gerbang
 * ini ada untuk mencegah. Spesiesnya sama dengan penjaga `getLogs` yang menguji jendela
 * terbaru: pemeriksaan yang lulus justru pada saat seharusnya berteriak.
 *
 * Harga per fill diambil dari kutipan 402 yang baru saja dibaca di atas, jadi angkanya
 * angka gerbang sendiri dan bukan konstanta kedua yang bisa menyimpang. Rinciannya,
 * termasuk sisi USDC dan jumlah top-up yang dibutuhkan, ada di
 * `node scripts/inventory-status.mjs`.
 */
const MIN_FILLS = 3;
for (const cid of [16661, 143, 8453, 42161]) {
  const b = Number(ethers.formatEther(await provider(cid).getBalance(RELAYER)));
  const m = (markets.markets ?? []).find((x) => x.chainId === cid);
  let perFill = null;
  if (m) {
    try {
      const r = await fetch(`${GATEWAY}/buy?symbol=${m.symbol}&chainId=${cid}&usdc=0.10`, {
        signal: AbortSignal.timeout(60000),
      });
      perFill = Number((await r.json())?.quote?.deliver?.nativeSpent ?? 0) || null;
    } catch {
      /* dilaporkan di bawah sebagai stok yang tidak terukur */
    }
  }
  const fills = perFill ? Math.floor(b / perFill) : null;
  ok(
    `  relayer chain ${cid}: >= ${MIN_FILLS} fill`,
    fills != null && fills >= MIN_FILLS,
    fills != null ? `${fills} fill (${b.toFixed(6)})` : `stok ${b.toFixed(6)} tapi harga per fill tidak terbaca`,
  );
}

// ── 5. layanan 0G ────────────────────────────────────────────────────────────
head("layanan 0G");
for (const [label, url, init, budget] of [
  ["0G Compute chat", `${SITE}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "ok" }], chain: "0G" }) }, 15000],
  ["0G Compute logo", `${SITE}/api/generate-logo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tokenName: "Preflight", tokenSymbol: "PRE", subject: "a small robot" }) }, 30000],
  ["0G attestation", `${SITE}/api/tee`, {}, 10000],
]) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(90000) });
    const ms = Date.now() - t0;
    ok(label, r.status === 200 && ms < budget, `HTTP ${r.status} ${ms}ms (anggaran ${budget}ms)`);
  } catch (e) {
    ok(label, false, String(e.message).slice(0, 50));
  }
}

// ── 6. OpenClaw ──────────────────────────────────────────────────────────────
head("OpenClaw (butuh tunnel SSH aktif)");
try {
  const r = await fetch(`${OPENCLAW}/`, { signal: AbortSignal.timeout(10000) });
  const html = await r.text();
  ok("UI terjangkau lewat tunnel", r.status === 200 && html.includes("OpenClaw"), `HTTP ${r.status}`);
} catch {
  ok(
    "UI terjangkau lewat tunnel",
    false,
    "tunnel belum jalan → ssh -N -L 18789:127.0.0.1:18789 root@168.144.249.185",
    true
  );
}

// ── ringkasan ────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(58)}`);
console.log(fails === 0 ? `SIAP DEMO — 0 gagal, ${warns} peringatan` : `JANGAN MULAI — ${fails} gagal, ${warns} peringatan`);
process.exit(fails === 0 ? 0 : 1);
