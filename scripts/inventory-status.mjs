#!/usr/bin/env node
/**
 * Keputusan rebalancing persediaan x402, diukur bukan dikira.
 *
 * MASALAH YANG NYATA, DAN BENTUKNYA BUKAN YANG DIDUGA
 *
 * Gerbang x402 membelanjakan native untuk MENGANTAR lalu menerima USDC di chain
 * PEMBAYARAN. Jadi dua sisi melenceng: stok native relayer terkuras di empat chain,
 * USDC menumpuk di satu treasury. Sampai sekarang itu diseimbangkan dengan tangan.
 *
 * Yang membuat ini layak dibangun bukan otomasinya, melainkan tidak adanya SINYAL.
 * `demo-preflight.mjs` memang memeriksa stok relayer, tetapi syaratnya `b > 0` — lolos
 * ketika stok tinggal satu fill. Itu spesies yang sama dengan penjaga `getLogs` yang
 * menguji jendela terbaru: pemeriksaan yang lulus tepat pada saat seharusnya berteriak.
 *
 * Angka yang ditemukan saat berkas ini ditulis, dan angka inilah yang menentukan
 * bentuknya:
 *
 *   0G        3,3075 0G   / 0,4181 per fill  -> ~7 fill
 *   Base      0,000211 ETH / 0,0000356       -> ~5 fill
 *   Arbitrum  0,000187 ETH / 0,0000356       -> ~5 fill
 *   Monad     36,529 MON  / 3,6819 per fill  -> ~9 fill
 *   treasury  1,04 USDC, nonce 0
 *
 * Seluruh gerbang hanya bisa melayani sekitar 26 pembelian lagi sebelum salah satu
 * chain kering, dan tidak ada apa pun yang memberitahu itu.
 *
 * KENAPA BERKAS INI TIDAK MEMINDAHKAN UANG, DAN ITU BUKAN KEMALASAN
 *
 * Dua alasan terpisah, dua-duanya mengikat.
 *
 * 1. `protocolTreasury` bernonce **0 di keempat chain** — kuncinya belum pernah dipakai
 *    dan memang disimpan offline. Itu properti keamanan yang tercatat dan dipublikasikan.
 *    Menukar USDC menjadi native secara otomatis menuntut kunci itu online, jadi
 *    "otomatis" di sini berarti menghapus jaminan yang sudah kami nyatakan ke publik.
 *    Tidak sebanding.
 *
 * 2. Pada skala sekarang itu juga merugi. 1,04 USDC yang terkumpul lebih kecil daripada
 *    biaya gas satu swap plus bridge. Jadi mengisi dengan tangan BUKAN utang teknis —
 *    ia keputusan yang benar untuk volume ini. Yang kurang cuma pengukurannya.
 *
 * Jadi alat ini menghitung keputusannya dan menolak mengeksekusinya. Tidak ada kunci
 * privat yang dibaca di berkas ini sama sekali.
 *
 * SILANG-PERIKSA YANG MEMBUAT ANGKANYA BISA DIPERCAYA
 *
 * Runway dihitung dua kali dari dua sumber berbeda: saldo dibagi harga per fill yang
 * DIBACA DARI KUTIPAN 402 SUNGGUHAN, lalu dibandingkan dengan `remainingBuys` yang
 * dilaporkan gerbang itu sendiri. Kalau keduanya berbeda, salah satunya salah dan
 * itu dilaporkan sebagai temuan, bukan didiamkan. Saat ditulis keempatnya cocok persis.
 *
 * PEMAKAIAN
 *
 *   node scripts/inventory-status.mjs
 *   node scripts/inventory-status.mjs --target 40      # runway yang diinginkan
 *   node scripts/inventory-status.mjs --min 8          # ambang gagal
 *
 * Keluar dengan kode 1 kalau ada chain di bawah ambang, supaya bisa dipakai sebagai
 * gerbang cron atau pra-demo alih-alih dibaca dengan harapan.
 */
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const SITE = process.env.BASE_URL || "https://adexto.xyz";
const GATEWAY = process.env.X402_GATEWAY || "https://x402.adexto.xyz";
const RELAYER = "0xDe1f5e5505c01aC6C847146fF76E0e067A49C627";
const TREASURY = "0x24268Fffc119ec5550F68e80D94476fD64daE967";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_PER_FILL = 0.1;

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};
const TARGET_RUNWAY = arg("target", 25);
const MIN_RUNWAY = arg("min", 6);

/**
 * RPC dibaca dari `src/config/contracts.ts`, bukan disalin ke sini.
 *
 * Salinan konstanta RPC adalah cara `demo-preflight.mjs` dan aplikasi bisa menunjuk
 * endpoint berbeda tanpa ada yang tahu, dan endpoint Base sudah terbukti berbeda
 * menurut pemanggilnya. Alat yang melaporkan stok harus membaca stok dari tempat yang
 * sama dengan yang membelanjakannya.
 */
const contractsSrc = readFileSync("src/config/contracts.ts", "utf8");
function rpcFor(chainId, fallback) {
  const m = contractsSrc.match(new RegExp(`chainId:\\s*${chainId}\\b[\\s\\S]*?rpcUrl:\\s*"([^"]+)"`));
  return m ? m[1] : fallback;
}

const CHAINS = [
  { id: 16661, name: "0G", sym: "0G", rpc: rpcFor(16661, "https://evmrpc.0g.ai") },
  { id: 8453, name: "Base", sym: "ETH", rpc: rpcFor(8453, "https://mainnet.base.org") },
  { id: 42161, name: "Arbitrum", sym: "ETH", rpc: rpcFor(42161, "https://arb1.arbitrum.io/rpc") },
  { id: 143, name: "Monad", sym: "MON", rpc: rpcFor(143, "https://rpc1.monad.xyz") },
];

const provider = (c) => new ethers.JsonRpcProvider(c.rpc, c.id, { staticNetwork: true, batchMaxCount: 1 });

let fails = 0;
let notes = 0;
const line = (s) => console.log(s);
const fail = (s) => {
  fails += 1;
  console.log(`FAIL  ${s}`);
};
const note = (s) => {
  notes += 1;
  console.log(`NOTE  ${s}`);
};

/** Harga native, untuk menyatakan kebutuhan top-up dalam uang dan bukan hanya token. */
async function prices() {
  try {
    const r = await fetch(`${SITE}/api/prices`, { signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    return j?.prices ?? {};
  } catch {
    return {};
  }
}

/** Satu pasar per chain, diambil dari registry supaya tidak ada ticker yang di-hardcode. */
async function marketsByChain() {
  const r = await fetch(`${SITE}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_markets", arguments: {} } }),
    signal: AbortSignal.timeout(60000),
  });
  const body = await r.text();
  const data = body.split("\n").find((l) => l.startsWith("data: "));
  const payload = JSON.parse(data ? data.slice(6) : body);
  const list = JSON.parse(payload.result.content[0].text).markets ?? [];
  const byChain = new Map();
  for (const m of list) if (!byChain.has(m.chainId)) byChain.set(m.chainId, m.symbol);
  return byChain;
}

console.log("x402 inventory — measured, and deliberately read-only\n");

const px = await prices();
/**
 * Kegagalan di sini DILAPORKAN, tidak dikembalikan sebagai Map kosong.
 *
 * Versi pertama memakai `.catch(() => new Map())`, dan akibatnya satu galat jaringan
 * tampil sebagai empat baris "no market in the registry" — yaitu alat ini menuduh
 * registry kosong padahal yang gagal adalah pembacaannya sendiri. Itu persis pola yang
 * berkali-kali sudah merugikan di repo ini: penyebab hilang, gejala menunjuk tempat lain.
 */
let market = new Map();
try {
  market = await marketsByChain();
  if (market.size === 0) fail("list_markets answered but carried no markets — registry read is wrong, not empty");
} catch (e) {
  fail(`list_markets unreachable, so no fill can be priced — ${String(e.message).slice(0, 80)}`);
}

const rows = [];
for (const c of CHAINS) {
  const symbol = market.get(c.id);
  let balance = null;
  try {
    balance = Number(ethers.formatEther(await provider(c).getBalance(RELAYER)));
  } catch (e) {
    fail(`${c.name}: relayer balance unreadable — ${String(e.shortMessage ?? e.message).slice(0, 60)}`);
    continue;
  }

  // Harga per fill DARI GERBANG, bukan dihitung ulang di sini. Yang dipakai untuk
  // memutuskan harus angka yang sama dengan yang dijanjikan ke pembeli.
  let perFill = null;
  let gatewayRemaining = null;
  let inStock = null;
  if (symbol) {
    /**
     * Dicoba dua kali. Satu timeout sudah cukup membuat satu chain tampil tanpa runway,
     * dan chain tanpa runway tidak bisa melanggar ambang — jadi kegagalan jaringan
     * tunggal akan MELEMAHKAN gerbang ini, bukan membuatnya berbunyi. Terjadi pada Base
     * saat berkas ini ditulis.
     */
    let lastErr = null;
    for (let attempt = 1; attempt <= 2 && perFill == null; attempt += 1) {
      try {
        const r = await fetch(`${GATEWAY}/buy?symbol=${symbol}&chainId=${c.id}&usdc=${USDC_PER_FILL}`, {
          signal: AbortSignal.timeout(60000),
        });
        const j = await r.json();
        perFill = Number(j?.quote?.deliver?.nativeSpent ?? 0) || null;
        gatewayRemaining = j?.quote?.inventory?.remainingBuys ?? null;
        inStock = j?.quote?.inventory?.inStock ?? null;
      } catch (e) {
        lastErr = e;
        if (attempt < 2) await new Promise((res) => setTimeout(res, 2000));
      }
    }
    if (perFill == null) {
      // FAIL, bukan NOTE. Tidak bisa mengukur stok adalah kegagalan gerbang ini,
      // bukan catatan pinggir — keputusannya menjadi tidak bisa diambil.
      fail(
        `${c.name}: gateway would not quote after 2 tries, so runway is unknown — ` +
          String(lastErr?.message ?? "no reason given").slice(0, 60),
      );
    }
  } else {
    note(`${c.name}: no market in the registry, so no quote to price a fill from`);
  }

  const runway = perFill ? Math.floor(balance / perFill) : null;
  rows.push({ ...c, symbol, balance, perFill, runway, gatewayRemaining, inStock });
}

line("chain      stock                per fill          runway   gateway  in stock");
for (const r of rows) {
  line(
    `${r.name.padEnd(10)} ${`${r.balance.toFixed(8)} ${r.sym}`.padEnd(20)} ` +
      `${String(r.perFill ?? "?").slice(0, 16).padEnd(17)} ` +
      `${String(r.runway ?? "?").padEnd(8)} ${String(r.gatewayRemaining ?? "?").padEnd(8)} ${r.inStock}`,
  );
}

console.log("");

/**
 * Perbandingan runway kami dengan `remainingBuys` gerbang.
 *
 * Kedua angka seharusnya memakai rumus yang sama, jadi perbedaan berarti alat ini
 * membaca saldo atau harga yang berbeda dari yang dipakai gerbang saat menolak atau
 * menerima pembayaran — dan itu lebih buruk daripada tidak punya alat ini.
 */
for (const r of rows) {
  if (r.runway == null || r.gatewayRemaining == null) continue;
  if (Math.abs(r.runway - r.gatewayRemaining) > 1) {
    fail(
      `${r.name}: runway disagrees with the gateway — ours ${r.runway}, gateway ${r.gatewayRemaining}. ` +
        `One of them is reading a different balance or price.`,
    );
  }
}

// ── Ambang ───────────────────────────────────────────────────────────────────
for (const r of rows) {
  if (r.runway == null) continue;
  if (r.runway < MIN_RUNWAY) {
    fail(`${r.name}: ${r.runway} fills left, below the ${MIN_RUNWAY} threshold — top up before it refuses a buyer`);
  }
  if (r.inStock === false) fail(`${r.name}: gateway reports out of stock`);
}

// ── Sisi yang menumpuk ───────────────────────────────────────────────────────
const base = CHAINS.find((c) => c.id === 8453);
let earned = null;
try {
  const usdc = new ethers.Contract(USDC_BASE, ["function balanceOf(address) view returns (uint256)"], provider(base));
  earned = Number(ethers.formatUnits(await usdc.balanceOf(TREASURY), 6));
  const nonce = await provider(base).getTransactionCount(TREASURY);
  line(`treasury   ${earned.toFixed(6)} USDC on Base, nonce ${nonce}${nonce === 0 ? " (never spent from)" : ""}`);
  if (nonce !== 0) {
    note("treasury nonce is no longer 0 — the offline-key property published on /security has changed");
  }
} catch (e) {
  note(`treasury USDC unreadable — ${String(e.shortMessage ?? e.message).slice(0, 60)}`);
}

// ── Keputusan, tanpa eksekusi ────────────────────────────────────────────────
console.log(`\ntop-up to reach ${TARGET_RUNWAY} fills per chain:`);
let totalUsd = 0;
for (const r of rows) {
  if (r.runway == null || r.perFill == null) {
    line(`  ${r.name.padEnd(10)} unknown, no quote to price a fill`);
    continue;
  }
  const missing = Math.max(0, TARGET_RUNWAY - r.runway);
  const need = missing * r.perFill;
  const usd = px[r.sym] ? need * px[r.sym] : null;
  if (usd != null) totalUsd += usd;
  line(
    `  ${r.name.padEnd(10)} ${missing === 0 ? "already there" : `+${need.toPrecision(4)} ${r.sym}` +
      (usd != null ? `  (~$${usd.toFixed(2)})` : "")}`,
  );
}
if (totalUsd > 0) line(`  ${"total".padEnd(10)} ~$${totalUsd.toFixed(2)}`);

if (earned != null) {
  const fillsEarned = earned / USDC_PER_FILL;
  console.log(
    `\ndrift: ${earned.toFixed(2)} USDC collected is ${fillsEarned.toFixed(0)} fills of revenue, ` +
      `against a top-up bill of ~$${totalUsd.toFixed(2)} to reach ${TARGET_RUNWAY} fills on every chain.`,
  );
  if (totalUsd > earned) {
    line(
      "       revenue does not yet cover the restock, which is why this is funded from the operator " +
        "balance rather than from takings, and why an automated swap would cost more gas than it moves.",
    );
  }
}

console.log(
  "\nThis tool moves nothing. No private key is read here. The protocol treasury key is held " +
    "offline, and automating a USDC-to-native swap would require bringing it online — which would " +
    "remove a property published on /security. Top-ups stay a human action; the measurement was " +
    "what was missing.",
);

console.log(`\n${fails} failing, ${notes} noted`);
process.exit(fails > 0 ? 1 : 0);
