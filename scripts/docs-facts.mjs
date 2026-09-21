#!/usr/bin/env node
/**
 * Kumpulkan SETIAP fakta yang boleh muncul di docs.adexto.xyz, dari repo dan dari chain.
 *
 * KENAPA BERKAS INI ADA SEBELUM SATU HALAMAN DITULIS
 *
 * Dokumentasi ini disusun dengan bantuan model bahasa untuk menghemat waktu. Model bahasa
 * mengarang alamat kontrak, nama alat, dan angka fee dengan sangat meyakinkan — dan seluruh
 * repo ini dibangun di atas aturan bahwa tidak ada klaim tanpa bukti. Dua hal itu tidak bisa
 * digabung tanpa pembatas.
 *
 * Pembatasnya ini: model TIDAK PERNAH menjadi sumber fakta. Ia menerima berkas ini sebagai
 * satu-satunya bahan dan ditugasi menulis prosa saja. Apa pun angka atau alamat di keluarannya
 * yang tidak ada di sini adalah halusinasi, dan `scripts/docs-verify.mjs` menolaknya.
 *
 * Semua yang di bawah dibaca dari sumbernya:
 *   - alamat kontrak: `src/config/contracts.ts` dan `eth_getCode` ke tiap chain
 *   - pasar: registry produksi lewat `/api/graphql`
 *   - nama alat MCP: `tools/list` ke server MCP yang hidup
 *   - kaki fee: konstanta di `contracts/AdextoCurve.sol`
 *   - biaya peluncuran: `src/lib/launch-cost.ts` lewat endpoint harga
 *   - temuan analyser: `src/config/security-report.json`
 *
 * Tidak ada satu pun yang ditulis tangan di sini kecuali label bagian.
 */
import { ethers } from "ethers";
import { readFileSync, writeFileSync } from "node:fs";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const SITE = process.env.BASE_URL || "https://adexto.xyz";
const OUT = "src/config/docs-facts.json";

const contractsSrc = readFileSync("src/config/contracts.ts", "utf8");
const curveSrc = readFileSync("contracts/AdextoCurve.sol", "utf8");
const tokenSrc = readFileSync("contracts/AdextoToken.sol", "utf8");
const factorySrc = readFileSync("contracts/AdextoFactory.sol", "utf8");

const pick = (src, re, label) => {
  const m = src.match(re);
  if (!m) throw new Error(`docs-facts: could not read ${label} — the pattern moved, fix this script rather than hardcoding`);
  return m[1];
};

// ── chain + factory ──────────────────────────────────────────────────────────
const CHAIN_IDS = [16661, 8453, 42161, 143];

/**
 * Alamat factory datang dari `public/abi/index.json`, BUKAN dari `src/config/contracts.ts`.
 *
 * Di sumber, `curveFactoryAddress: CURVE_FACTORY.og` — nilainya dari env, jadi tidak ada
 * literal yang bisa dibaca. `public/abi/index.json` adalah artefak yang memang diterbitkan,
 * dan `audit_consistency.mjs` sudah membandingkan setiap alamat di dalamnya dengan env yang
 * diperiksa ke chain. Jadi ia sumber yang lebih kuat untuk dokumentasi daripada sumber TS:
 * ia yang dilihat pembaca, dan ia sudah dijaga.
 */
const abiIndex = JSON.parse(readFileSync("public/abi/index.json", "utf8"));
const networks = abiIndex.networks ?? {};
const netByChain = new Map();
for (const [key, n] of Object.entries(networks)) {
  if (n && typeof n === "object" && n.chainId) netByChain.set(Number(n.chainId), { key, ...n });
}

const chains = [];
for (const id of CHAIN_IDS) {
  const n = netByChain.get(id);
  if (!n) throw new Error(`docs-facts: chain ${id} missing from public/abi/index.json networks`);
  const block = contractsSrc.match(new RegExp(`chainId:\\s*${id}\\b[\\s\\S]{0,4000}?\\n  \\},`));
  const b = block ? block[0] : "";
  chains.push({
    chainId: id,
    name: n.name ?? (b ? pick(b, /chainName:\s*"([^"]+)"/, `chainName ${id}`) : null),
    nativeSymbol: b ? pick(b, /nativeSymbol:\s*"([^"]+)"/, `nativeSymbol ${id}`) : null,
    explorer: n.explorer ?? (b ? pick(b, /blockExplorer:\s*"([^"]+)"/, `blockExplorer ${id}`) : null),
    rpcUrl: b ? pick(b, /rpcUrl:\s*"([^"]+)"/, `rpcUrl ${id}`) : null,
    factory: n.factory ?? n.address ?? null,
    factoryVersion: n.factoryVersion ?? null,
  });
  if (!chains[chains.length - 1].factory) {
    throw new Error(`docs-facts: no factory address for chain ${id} in public/abi/index.json`);
  }
}

/**
 * Bytecode dibaca dari CHAIN, bukan dari artifact — artifact masih bernilai nol pada setiap
 * immutable, jadi hash-nya berbeda dan itu wajar. Bandingkan on-chain dengan on-chain.
 *
 * Endpoint cadangan per chain, karena satu timeout sudah cukup membuat klaim
 * "byte-identical di empat chain" gagal dan tampil sebagai `false` — yaitu dokumentasi yang
 * menyangkal fakta yang benar. Terjadi pada Base: `rpcUrl`-nya publicnode, yang terukur
 * 3,6 detik dan menolak permintaan arsip.
 */
const CODE_FALLBACKS = {
  8453: ["https://base.drpc.org", "https://mainnet.base.org"],
  42161: ["https://arbitrum.drpc.org"],
  16661: [],
  143: ["https://rpc2.monad.xyz"],
};
for (const c of chains) {
  const urls = [c.rpcUrl, ...(CODE_FALLBACKS[c.chainId] ?? [])].filter(Boolean);
  c.factoryBytecodeBytes = null;
  c.factoryBytecodeKeccak = null;
  for (const url of urls) {
    try {
      const p = new ethers.JsonRpcProvider(url, c.chainId, { staticNetwork: true, batchMaxCount: 1 });
      const code = await p.getCode(c.factory);
      if (!code || code === "0x") throw new Error("no bytecode at address");
      c.factoryBytecodeBytes = (code.length - 2) / 2;
      c.factoryBytecodeKeccak = ethers.keccak256(code);
      delete c.readError;
      break;
    } catch (e) {
      c.readError = `${url}: ${String(e.shortMessage ?? e.message).slice(0, 60)}`;
    }
  }
  if (!c.factoryBytecodeKeccak) {
    throw new Error(
      `docs-facts: could not read factory bytecode on chain ${c.chainId} from any endpoint — ` +
        `${c.readError}. Refusing to write facts that would understate a verified property.`,
    );
  }
}
const hashes = new Set(chains.map((c) => c.factoryBytecodeKeccak).filter(Boolean));
const bytecodeIdentical = hashes.size === 1 && chains.every((c) => c.factoryBytecodeKeccak);

// ── kaki fee, dari kontrak ───────────────────────────────────────────────────
const fees = {
  maxTotalBps: Number(pick(curveSrc, /MAX_TOTAL_FEE_BPS\s*=\s*(\d+)/, "MAX_TOTAL_FEE_BPS")),
  protocolBps: Number(pick(factorySrc, /PROTOCOL_FEE_BPS\s*=\s*(\d+)/, "PROTOCOL_FEE_BPS")),
  antiSnipeBlocks: Number(pick(tokenSrc, /ANTI_SNIPE_BLOCKS\s*=\s*(\d+)/, "ANTI_SNIPE_BLOCKS")),
};

// ── pasar hidup, dari registry produksi ──────────────────────────────────────
async function markets() {
  const r = await fetch(`${SITE}/api/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "{ projects { symbol name slug chainId chainKey nativeSymbol tokenAddress poolAddress lpFeeBps treasuryBuybackBps blockNumber } }" }),
    signal: AbortSignal.timeout(60000),
  });
  const j = await r.json();
  if (!j?.data?.projects) throw new Error("docs-facts: registry returned no projects");
  return j.data.projects;
}

// ── alat MCP, dari server yang hidup ─────────────────────────────────────────
async function mcpTools() {
  const r = await fetch(`${SITE}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    signal: AbortSignal.timeout(60000),
  });
  const body = await r.text();
  const data = body.split("\n").find((l) => l.startsWith("data: "));
  const payload = JSON.parse(data ? data.slice(6) : body);
  const tools = payload?.result?.tools ?? [];
  if (tools.length === 0) throw new Error("docs-facts: MCP returned no tools");
  return tools.map((t) => ({
    name: t.name,
    title: t.title ?? null,
    description: String(t.description ?? "").slice(0, 400),
    args: Object.keys(t.inputSchema?.properties ?? {}),
  }));
}

// ── biaya peluncuran terukur, per chain ──────────────────────────────────────
async function launchCosts() {
  try {
    const r = await fetch(`${SITE}/api/prices`, { signal: AbortSignal.timeout(20000) });
    return (await r.json())?.prices ?? {};
  } catch {
    return {};
  }
}

// ── tantangan x402 sungguhan, satu contoh ────────────────────────────────────
async function x402Example(symbol, chainId) {
  try {
    const r = await fetch(`https://x402.adexto.xyz/buy?symbol=${symbol}&chainId=${chainId}&usdc=0.10`, {
      signal: AbortSignal.timeout(70000),
    });
    const j = await r.json();
    return {
      httpStatus: r.status,
      wwwAuthenticate: r.headers.get("www-authenticate"),
      x402Version: j?.x402Version ?? null,
      accepts: j?.accepts ?? null,
      quoteShape: j?.quote ? Object.keys(j.quote) : null,
    };
  } catch (e) {
    return { error: String(e.message).slice(0, 80) };
  }
}

const [live, tools, prices] = await Promise.all([markets(), mcpTools(), launchCosts()]);
const example = await x402Example(live[0]?.symbol ?? "PARCEL", live[0]?.chainId ?? 143);

const report = JSON.parse(readFileSync("src/config/security-report.json", "utf8"));

const facts = {
  _README: [
    "DIHASILKAN oleh scripts/docs-facts.mjs. Jangan sunting tangan.",
    "Ini satu-satunya bahan yang boleh dipakai halaman docs. Angka atau alamat di halaman",
    "docs yang tidak ada di berkas ini adalah halusinasi; scripts/docs-verify.mjs menolaknya.",
  ],
  generatedAt: new Date().toISOString(),
  site: SITE,
  chains,
  bytecode: {
    identicalAcrossChains: bytecodeIdentical,
    bytes: chains[0]?.factoryBytecodeBytes ?? null,
    keccak: bytecodeIdentical ? [...hashes][0] : null,
  },
  fees,
  markets: live.map((m) => ({
    symbol: m.symbol,
    name: m.name,
    slug: m.slug,
    chainId: m.chainId,
    chainKey: m.chainKey,
    nativeSymbol: m.nativeSymbol,
    token: m.tokenAddress,
    curve: m.poolAddress,
    depthFeeBps: m.lpFeeBps,
    buybackBps: m.treasuryBuybackBps,
    launchBlock: m.blockNumber,
  })),
  mcp: { endpoint: `${SITE}/api/mcp`, tools },
  x402: { gateway: "https://x402.adexto.xyz", example },
  nativePrices: prices,
  analysers: report.engines.map((e) => ({
    id: e.id,
    tool: e.tool,
    status: e.status,
    counts: e.counts ?? null,
    launchPathCounts: e.launchPathCounts ?? null,
  })),
  analysersScannedAt: report.generatedAt,
  analysersCommit: report.commit,
};

writeFileSync(OUT, `${JSON.stringify(facts, null, 2)}\n`);
console.log(`wrote ${OUT}`);
console.log(`  chains            ${facts.chains.length}`);
console.log(`  bytecode identical ${facts.bytecode.identicalAcrossChains} (${facts.bytecode.bytes} bytes)`);
console.log(`  markets           ${facts.markets.length}`);
console.log(`  mcp tools         ${facts.mcp.tools.length}`);
console.log(`  fee legs          protocol ${facts.fees.protocolBps} bps, cap ${facts.fees.maxTotalBps} bps`);
console.log(`  x402 example      HTTP ${facts.x402.example.httpStatus ?? facts.x402.example.error}`);
console.log(`  analysers         ${facts.analysers.length}`);
