#!/usr/bin/env node
/**
 * Tolak apa pun di draf dokumentasi yang tidak ada di berkas fakta.
 *
 * KENAPA INI ADA, DAN APA YANG IA TIDAK BISA TANGKAP
 *
 * `docs-draft.mjs` memakai model bahasa untuk menulis prosa. Model bahasa mengarang alamat
 * kontrak dan angka dengan sangat meyakinkan. Berkas ini adalah gerbangnya: setiap alamat
 * 0x, setiap hash keccak, setiap chain id, dan setiap URL di draf harus muncul di
 * `src/config/docs-facts.json`, yang seluruhnya dibaca dari repo dan dari chain.
 *
 * YANG TIDAK BISA DITANGKAP GERBANG INI, dan itu harus ditulis supaya tidak dipercaya
 * berlebihan: kesalahan SEMANTIK di mana semua katanya nyata. Draf pertama halaman MCP
 * memberi `list_markets` deskripsi milik `trade_history`, dan menulis bahwa setiap permintaan
 * butuh kunci header padahal hanya satu alat yang digerbang. Tidak satu pun dari itu memuat
 * angka palsu, jadi tidak satu pun bisa ditangkap di sini.
 *
 * Dua pertahanan untuk kelas itu, keduanya di luar berkas ini: tabel data TIDAK BOLEH datang
 * dari model sama sekali — `docs-draft.mjs` menolak blok `table` dan hanya menerima
 * `factsTable` yang dirender dari fakta — dan prosanya tetap harus dibaca manusia. Gerbang
 * ini menghapus satu kelas kesalahan, bukan semuanya.
 */
import { readFileSync } from "node:fs";

const facts = JSON.parse(readFileSync("src/config/docs-facts.json", "utf8"));
const pages = JSON.parse(readFileSync("src/config/docs-pages.json", "utf8"));

const factsBlob = JSON.stringify(facts).toLowerCase();
let fails = 0;
let notes = 0;
const fail = (s) => {
  fails += 1;
  console.log(`FAIL  ${s}`);
};
const note = (s) => {
  notes += 1;
  console.log(`NOTE  ${s}`);
};

/** Setiap string teks di satu halaman, apa pun bentuk bloknya. */
function strings(page) {
  const out = [String(page.lede ?? "")];
  for (const s of page.sections ?? []) {
    out.push(String(s.heading ?? ""));
    for (const b of s.blocks ?? []) {
      if (b.text) out.push(String(b.text));
      if (b.code) out.push(String(b.code));
      if (Array.isArray(b.items)) out.push(...b.items.map(String));
      if (Array.isArray(b.columns)) out.push(...b.columns.map(String));
      if (Array.isArray(b.rows)) for (const r of b.rows) out.push(...r.map(String));
    }
  }
  return out;
}

const BANNED = [
  "ERC-8004 compliant",
  "ERC-8004 compliance",
  "Hardware Attested",
  "Zero central points of failure",
  "settled trustlessly",
  "1-Click",
  "physically impossible",
  "Uniswap",
  "Chainlink",
  "CCIP",
  "quantitative signals",
  "revenue distribution",
];

const KNOWN_HOSTS = new Set([
  "adexto.xyz",
  "docs.adexto.xyz",
  "x402.adexto.xyz",
  "day2.adexto.xyz",
  "github.com",
  "eips.ethereum.org",
  "chainscan.0g.ai",
  "basescan.org",
  "arbiscan.io",
  "monadscan.com",
  "mcp.nansen.ai",
]);
for (const c of facts.chains) {
  try {
    KNOWN_HOSTS.add(new URL(c.explorer).host);
    KNOWN_HOSTS.add(new URL(c.rpcUrl).host);
  } catch {
    /* absent in facts */
  }
}

console.log(`verifying ${Object.keys(pages.pages ?? {}).length} drafted pages against docs-facts.json\n`);

for (const [slug, page] of Object.entries(pages.pages ?? {})) {
  const all = strings(page);
  const blob = all.join("\n");
  let pageFails = 0;

  // 1. Alamat: setiap 0x…40 hex harus ada di fakta.
  for (const addr of new Set(blob.match(/0x[0-9a-fA-F]{40}/g) ?? [])) {
    if (!factsBlob.includes(addr.toLowerCase())) {
      fail(`${slug}: address ${addr} is not in docs-facts.json — invented`);
      pageFails += 1;
    }
  }

  // 2. Hash 32-byte: sama.
  for (const h of new Set(blob.match(/0x[0-9a-fA-F]{64}/g) ?? [])) {
    if (!factsBlob.includes(h.toLowerCase())) {
      fail(`${slug}: hash ${h.slice(0, 20)}… is not in docs-facts.json — invented`);
      pageFails += 1;
    }
  }

  // 3. Host: tidak boleh menciptakan domain.
  for (const u of new Set(blob.match(/https?:\/\/[^\s`"'),]+/g) ?? [])) {
    try {
      const host = new URL(u).host;
      if (!KNOWN_HOSTS.has(host)) {
        fail(`${slug}: unknown host ${host} (${u.slice(0, 60)})`);
        pageFails += 1;
      }
    } catch {
      note(`${slug}: unparseable URL ${u.slice(0, 50)}`);
    }
  }

  // 4. Frasa terlarang.
  for (const b of BANNED) {
    if (blob.toLowerCase().includes(b.toLowerCase())) {
      fail(`${slug}: banned phrase "${b}"`);
      pageFails += 1;
    }
  }

  /**
   * 5. Nama alat MCP. Alat yang tidak ada adalah kelas halusinasi paling mahal di halaman ini,
   *    karena pembaca akan mencoba memanggilnya.
   */
  const realTools = new Set(facts.mcp.tools.map((t) => t.name));
  for (const m of new Set(blob.match(/\b[a-z]+_[a-z_]{2,}\b/g) ?? [])) {
    // Hanya periksa yang BERBENTUK nama alat kami dan bukan istilah umum.
    if (/^(list|get|quote|how|buy|pay|trade)_/.test(m) && !realTools.has(m)) {
      fail(`${slug}: "${m}" looks like an MCP tool name but no such tool exists`);
      pageFails += 1;
    }
  }

  /**
   * 6. Gaya telegrafik tanpa artikel, yang sudah pernah lolos sekali: "Agent hold zero private
   *    keys.", "MCP endpoint live at X."
   *
   *    Pola ini SENGAJA dijangkarkan di awal kalimat dan menuntut tidak ada artikel. Versi
   *    pertamanya hanya mencari "noun + verb" di mana saja, dan ia menandai
   *    "requests that the server sign the transaction" — subjunctive yang benar. Penjaga yang
   *    menuduh prosa yang benar akan dimatikan orang, jadi ia harus lebih sempit daripada
   *    dugaan awal.
   */
  const noArticle = /(^|[.!?]\s+)(Agent|Server|Endpoint|Curve|Factory|Buyer|Token|Market)\s+(hold|holds|sign|signs|connect|connects|expose|exposes|live|decide|decides|enforce|enforces|reject|rejects)\b/;
  const missingIs = /\b(endpoint|server|market|curve|token)\s+(live|available|reachable)\s+(at|on|from)\b/i;
  for (const t of all) {
    if (noArticle.test(t) || missingIs.test(t)) {
      fail(`${slug}: note-form sentence, needs articles and conjugation — "${t.slice(0, 80)}"`);
      pageFails += 1;
    }
  }

  // 7. Bentuk blok.
  const TABLES = new Set(["chains", "mcpTools", "markets", "feeLegs", "analysers"]);
  for (const s of page.sections ?? []) {
    for (const b of s.blocks ?? []) {
      if (b.type === "table") {
        fail(`${slug}: raw data table present; only factsTable is permitted`);
        pageFails += 1;
      }
      if (b.type === "factsTable" && !TABLES.has(b.table)) {
        fail(`${slug}: unknown factsTable "${b.table}"`);
        pageFails += 1;
      }
    }
  }

  const blocks = (page.sections ?? []).reduce((n, s) => n + (s.blocks?.length ?? 0), 0);
  console.log(
    `${pageFails === 0 ? "OK  " : "    "} ${slug.padEnd(16)} ${String(page.sections?.length ?? 0).padStart(2)} sections, ${String(blocks).padStart(2)} blocks`,
  );
}

console.log(`\n${fails} failing, ${notes} noted`);
if (fails === 0) {
  console.log("No invented address, hash, host, tool name or banned phrase.");
  console.log("This does NOT clear semantic errors where every word is real — read the prose.");
}
process.exit(fails > 0 ? 1 : 0);
