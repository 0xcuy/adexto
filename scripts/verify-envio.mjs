#!/usr/bin/env node
/**
 * verify-envio.mjs — Envio against the chain, for every market its factories have launched.
 *
 *   node scripts/verify-envio.mjs                                         # public endpoint
 *   node scripts/verify-envio.mjs --url http://localhost:8080/v1/graphql  # local stack
 *
 * Read-only. Exit 0 = every figure matches, 1 = a mismatch or a missing market, 2 = a read failed.
 *
 * Metode METROPOLIS §7 sebagai skrip, supaya "Envio cocok dengan kontrak" adalah perintah yang bisa
 * diulang, bukan paragraf di runbook. Yang dibandingkan, per kurva:
 *
 *   curveVersion    vs  VERSION() factory yang meluncurkannya
 *   swapCount       vs  swapCount()            (kontrak juga menghitung buyback; Envio ikut)
 *   volumeNative    vs  totalVolumeNative()
 *   totalDepthFees  vs  totalDepthFeesRetained()
 *
 * Daftar kurva TIDAK diambil dari indexer, karena indexer yang kehilangan sebuah pasar akan
 * tampak sehat bila ditanya hanya tentang pasar yang ia punya. Daftarnya dibaca dari setiap
 * factory di `envio/config.yaml` lewat `totalProjectsCount()` dan `projectAt(i)`, jadi pasar uji
 * yang tidak terdaftar ikut diperiksa. Pasar live di `onchain-launches.json` pada chain yang
 * dilayani Envio juga harus lahir dari salah satu factory itu.
 *
 * Kontrak dibaca PADA BLOK yang sudah diproses indexer (`chain_metadata.latest_processed_block`),
 * bukan di kepala chain: indexer selalu tertinggal beberapa blok, dan swap di celah itu akan
 * tampil sebagai selisih palsu.
 *
 * Bilangan besar dikutip SEBELUM `JSON.parse`. Hasura menjawab kolom numeric sebagai angka JSON,
 * dan double hanya memuat ~16 digit, jadi volume 20 digit terbaca salah oleh pemeriksanya sendiri.
 */
import { readFileSync } from "node:fs";
import { ethers } from "ethers";

const args = process.argv.slice(2);
const ENDPOINT = (args.includes("--url") ? args[args.indexOf("--url") + 1] : "") || "https://adexto.xyz/api/indexer/graphql";

const contractsSrc = readFileSync("src/config/contracts.ts", "utf8");
const rpcFor = (id) => (contractsSrc.match(new RegExp(`chainId:\\s*${id}\\b[\\s\\S]*?rpcUrl:\\s*"([^"]+)"`)) || [])[1];

/** Factory per chain, dari `envio/config.yaml`: daftar yang benar-benar diindeks, bukan salinan. */
function indexedFactories() {
  const yaml = readFileSync("envio/config.yaml", "utf8");
  const chainsPart = yaml.slice(yaml.indexOf("\nchains:"));
  const out = [];
  for (const block of chainsPart.split(/\n  - id: /).slice(1)) {
    const chainId = Number(block.match(/^(\d+)/)?.[1]);
    const section = block.split(/- name: AdextoCurve\b/)[0].split(/- name: AdextoFactory\b/)[1] ?? "";
    const code = section
      .split("\n")
      .map((l) => l.replace(/#.*$/, ""))
      .join("\n");
    for (const a of code.match(/0x[0-9a-fA-F]{40}/g) ?? []) out.push({ chainId, factory: ethers.getAddress(a) });
  }
  return out;
}

async function gql(query, variables) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await res.text();
  let body = {};
  try {
    body = JSON.parse(raw.replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"'));
  } catch {
    body = {};
  }
  if (!res.ok || body.errors?.length || !body.data) {
    throw new Error(`HTTP ${res.status} ${JSON.stringify(body.errors ?? body).slice(0, 160)}`);
  }
  return body.data;
}

const FACTORY_ABI = [
  "function VERSION() view returns (string)",
  "function totalProjectsCount() view returns (uint256)",
  "function projectAt(uint256) view returns (address token, address curve, address creator, string symbol, uint256 deployedAt)",
];
const CURVE_ABI = [
  "function swapCount() view returns (uint256)",
  "function totalVolumeNative() view returns (uint256)",
  "function totalDepthFeesRetained() view returns (uint256)",
];

let mismatches = 0;
let readFailures = 0;
const say = (s) => console.log(s);

const factories = indexedFactories();
const chains = [...new Set(factories.map((f) => f.chainId))];
say(`verify-envio · ${ENDPOINT}`);
say(`factories in envio/config.yaml: ${factories.map((f) => `${f.chainId}:${f.factory.slice(0, 8)}…`).join(" ")}`);

let meta = [];
try {
  meta = (await gql("{ chain_metadata { chain_id latest_processed_block } }", {})).chain_metadata ?? [];
} catch (e) {
  say(`READ FAILED  chain_metadata: ${e.message}`);
  process.exit(2);
}

const launches = JSON.parse(readFileSync("src/config/onchain-launches.json", "utf8")).launches.filter((l) => l.status === "live");

for (const chainId of chains) {
  const rpc = rpcFor(chainId);
  const processed = Number(meta.find((m) => Number(m.chain_id) === chainId)?.latest_processed_block ?? 0);
  if (!rpc || !processed) {
    readFailures++;
    say(`READ FAILED  chain ${chainId}: ${!rpc ? "no rpcUrl in src/config/contracts.ts" : "indexer reports no processed block"}`);
    continue;
  }
  const provider = new ethers.JsonRpcProvider(rpc, chainId, { staticNetwork: true, batchMaxCount: 1 });
  const at = { blockTag: processed };
  say(`\nchain ${chainId} · contracts read at block ${processed}, the indexer's processed block`);

  // 1. Setiap kurva setiap factory, dari chain.
  const curves = [];
  for (const { factory } of factories.filter((f) => f.chainId === chainId)) {
    const f = new ethers.Contract(factory, FACTORY_ABI, provider);
    try {
      const [version, count] = await Promise.all([f.VERSION(at), f.totalProjectsCount(at)]);
      say(`  factory ${factory} ${version}: ${count} market(s)`);
      for (let i = 0; i < Number(count); i++) {
        const p = await f.projectAt(i, at);
        curves.push({ factory, version, symbol: p.symbol, token: p.token, curve: ethers.getAddress(p.curve) });
      }
    } catch (e) {
      readFailures++;
      say(`  READ FAILED  factory ${factory}: ${String(e.shortMessage ?? e.message).slice(0, 100)}`);
    }
  }

  // 2. Pasar live di chain ini harus lahir dari factory yang diindeks.
  for (const l of launches.filter((x) => x.chainId === chainId)) {
    if (!curves.some((c) => c.curve.toLowerCase() === l.curve.toLowerCase())) {
      mismatches++;
      say(`  ✗ live $${l.symbol} (${l.factoryVersion}, factory ${l.factory}) is not from any factory in envio/config.yaml`);
    }
  }
  if (curves.length === 0) continue;

  // 3. Angka Envio per kurva vs kontrak, pada blok yang sama.
  //
  // Id kurva di Envio `<chainId>_<alamat huruf kecil>` (`chainScopedId` di envio/src/shared.ts),
  // bukan alamat saja: factory Arc dan Robinhood beralamat sama, jadi kurva peluncuran ke-n di
  // keduanya juga. Bertanya dengan alamat saja akan mencocokkan baris chain lain, atau tidak ada.
  const idOf = (c) => `${chainId}_${c.curve.toLowerCase()}`;
  let rows = [];
  try {
    rows = (
      await gql(
        "query($ids: [String!]) { Curve(where: { id: { _in: $ids } }) { id chainId curveVersion swapCount volumeNative totalDepthFees } }",
        { ids: curves.map(idOf) }
      )
    ).Curve;
  } catch (e) {
    readFailures++;
    say(`  READ FAILED  Envio Curve rows: ${e.message}`);
    continue;
  }
  const byId = new Map(rows.map((r) => [String(r.id).toLowerCase(), r]));
  for (const c of curves) {
    const g = byId.get(idOf(c));
    const listed = launches.some((l) => l.chainId === chainId && l.curve.toLowerCase() === c.curve.toLowerCase());
    const label = `$${c.symbol}${listed ? "" : " (unlisted)"}`;
    if (!g) {
      mismatches++;
      say(`  ✗ ${label} ${c.curve}: MISSING from Envio`);
      continue;
    }
    let chain;
    try {
      const k = new ethers.Contract(c.curve, CURVE_ABI, provider);
      const [swaps, volume, depth] = await Promise.all([k.swapCount(at), k.totalVolumeNative(at), k.totalDepthFeesRetained(at)]);
      chain = { swaps: swaps.toString(), volume: volume.toString(), depth: depth.toString() };
    } catch (e) {
      readFailures++;
      say(`  READ FAILED  ${label}: ${String(e.shortMessage ?? e.message).slice(0, 100)}`);
      continue;
    }
    const diffs = [];
    if (Number(g.chainId) !== chainId) diffs.push(`chainId ${g.chainId} vs ${chainId}`);
    if (g.curveVersion !== c.version) diffs.push(`curveVersion ${g.curveVersion} vs ${c.version}`);
    if (String(g.swapCount) !== chain.swaps) diffs.push(`swapCount ${g.swapCount} vs ${chain.swaps}`);
    if (String(g.volumeNative) !== chain.volume) diffs.push(`volumeNative ${g.volumeNative} vs ${chain.volume}`);
    if (String(g.totalDepthFees) !== chain.depth) diffs.push(`totalDepthFees ${g.totalDepthFees} vs ${chain.depth}`);
    if (diffs.length) mismatches++;
    say(
      diffs.length
        ? `  ✗ ${label} ${c.version}: ${diffs.join(" · ")}`
        : `  ✓ ${label} ${c.version}: swapCount ${chain.swaps}, volumeNative, totalDepthFees equal`
    );
  }
}

say(`\n${mismatches} mismatch(es), ${readFailures} read failure(s)`);
process.exit(readFailures > 0 ? 2 : mismatches > 0 ? 1 : 0);
