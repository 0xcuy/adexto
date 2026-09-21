#!/usr/bin/env node
/**
 * Susun draf prosa untuk docs.adexto.xyz lewat router pihak ketiga.
 *
 * TIGA KEPUTUSAN YANG MEMBUAT INI AMAN DIPAKAI
 *
 * 1. MODEL TIDAK MENGHASILKAN JSX. Ia mengembalikan JSON berstruktur — heading, paragraf,
 *    tabel, blok kode — dan satu komponen React yang merendernya. Kalau model boleh menulis
 *    JSX, satu tanda kutip salah mematikan build, dan yang lebih buruk: markup dari keluaran
 *    model masuk ke halaman tanpa ada yang meninjau bentuknya.
 *
 * 2. MODEL TIDAK PERNAH MENJADI SUMBER FAKTA. Satu-satunya bahan yang ia terima adalah
 *    `src/config/docs-facts.json`, yang seluruhnya dibaca dari repo dan dari chain oleh
 *    `scripts/docs-facts.mjs`. Prompt-nya melarang menciptakan alamat, angka, nama alat, atau
 *    endpoint. `scripts/docs-verify.mjs` lalu memeriksa setiap alamat dan setiap angka
 *    mencurigakan di keluarannya terhadap berkas fakta itu, dan menolak yang tidak ada.
 *
 * 3. LARANGAN KLAIM IKUT DIKIRIM. Daftar frasa terlarang di `audit_claims.mjs` ada di dalam
 *    prompt, jadi model tidak menulis "ERC-8004 compliant" atau "Hardware Attested" yang
 *    kemudian digagalkan penjaga setelah halaman dibangun. Lebih murah dilarang di hulu.
 *
 * KENAPA MEMAKAI MODEL LAIN SAMA SEKALI
 *
 * Isi dokumentasi ini luas dan berulang: sepuluh halaman dengan bentuk yang sama. Menulisnya
 * baris demi baris di sesi utama membakar konteks yang lebih berguna untuk memverifikasi.
 * Jadi pembagiannya: model murah menulis prosa dari fakta yang sudah dipastikan, sesi utama
 * memeriksanya. Yang tidak boleh terjadi adalah model ikut memutuskan apa yang benar.
 *
 * PEMAKAIAN
 *
 *   node scripts/docs-draft.mjs                 # semua halaman yang belum ada
 *   node scripts/docs-draft.mjs --only mcp      # satu halaman
 *   node scripts/docs-draft.mjs --force         # tulis ulang yang sudah ada
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const KEY = process.env.ZEXA_API_KEY;
const BASE = process.env.ZEXA_BASE_URL;
const MODEL = process.env.ZEXA_MODEL;
if (!KEY || !BASE || !MODEL) {
  console.error("docs-draft: ZEXA_API_KEY, ZEXA_BASE_URL and ZEXA_MODEL must be set in .env.local");
  process.exit(1);
}

const OUT = "src/config/docs-pages.json";
const facts = JSON.parse(readFileSync("src/config/docs-facts.json", "utf8"));

const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const force = process.argv.includes("--force");

/**
 * Halaman, judul, dan BRIEF-nya.
 *
 * Brief menyebutkan apa yang harus dijelaskan DAN apa yang tidak boleh diklaim, karena
 * kelalaian paling mahal di repo ini selalu berbentuk klaim yang terdengar wajar. Brief
 * ditulis tangan; hanya prosanya yang dihasilkan.
 */
const PAGES = [
  {
    slug: "launch",
    title: "Launch a market",
    brief:
      "How one transaction opens a bonding-curve market. Cover: no liquidity deposit because the native side starts virtual and deployTrinity is not payable; 100% of supply enters the curve so the creator holds no allocation; the factory asserts its own balance is zero afterwards; the anti-sniper window applies a per-transaction cap only for ANTI_SNIPE_BLOCKS blocks and the launcher is exempt because it moves the whole supply in that same transaction; symbol is claimed permanently per chain because symbolRegistry has no release function. Say plainly that ERC-8004 binding is optional and off by default. Do NOT say the launch registers an agent — the factory only checks ownerOf.",
  },
  {
    slug: "trading",
    title: "Trading a market",
    brief:
      "How the curve works as a venue. Cover: constant product against a virtual native reserve; there is no graduation step and no migration to an external pool, so the curve is the permanent venue; selling goes approve then sell against the same curve, so the exit path is the same contract as the entry; slippage via minTokensOut and a deadline; reading totalFeeBps from the curve rather than adding legs up. Be explicit that the token is a plain ERC-20 with no blacklist, no pause and no owner, so anyone may list it on an external AMM without permission and a second market can exist alongside the curve. State that the guarantee is narrower than 'one market': we never migrate, and nobody can withdraw the curve's reserves.",
  },
  {
    slug: "fees",
    title: "Fees",
    brief:
      "The four legs and which of them is additive. Cover: the creator configures a total; depth, creator and buyback come out of that total; the protocol leg is charged ON TOP, which is why a trader on the default preset pays more than the configured total; every rate is immutable per curve with no setter; claimProtocolFees and claimCreatorFees are permissionless because their destinations are fixed at construction; the buyback is permissionless and capped per call, and it burns what it buys so supply falls without paying anyone. Use only the bps numbers present in the facts. Say that markets created by the superseded factory generation pay no protocol fee and never will, because their rates are immutable too.",
  },
  {
    slug: "chains",
    title: "Chains and deployments",
    brief:
      "Where the factory is and why the addresses can be trusted. Cover: the four mainnets; the runtime bytecode is byte-identical across all of them and the keccak is in the facts; explain that byte-identical is not automatic because immutables live inside runtime bytecode, so the hashes only match because the same protocol treasury was used everywhere; explain that the COMPILED artefact hashes differently and that this is expected rather than a discrepancy, because immutables are still zero in it, so on-chain code must be compared against on-chain code. Mention that some addresses repeat across chains because CREATE derives an address from deployer and nonce, so always check the chain before trusting an address.",
  },
  {
    slug: "x402",
    title: "Buying from another chain with x402",
    brief:
      "The paid HTTP flow. Cover: an unpaid GET returns 402 with a WWW-Authenticate header and an x402 accepts block naming asset, amount, payee and timeout, plus a quote carrying the curve and minTokensOut; the caller signs an EIP-3009 TransferWithAuthorization, which is typed data so there is no gas and no allowance; the signature is verified and the EIP-712 domain is read from the USDC contract rather than from the request; delivery runs BEFORE the charge so a failed fill costs the operator and never the buyer; both transaction hashes come back in the body. State clearly that the two legs are not atomic and that the buyer relies on the operator submitting the buy, and that inventory is finite so the endpoint answers 503 before touching any authorization. Note that when the market itself lives on the payment chain nothing crosses, and it is the same code path.",
  },
  {
    slug: "mcp",
    title: "MCP server for AI agents",
    brief:
      "How an agent uses the markets. Refer to the tools table rather than restating it. CRITICAL and do not generalise this: only ONE tool, pay_and_buy, is gated and spends money. Every other tool is free, public and needs no key or account at all — do not write that requests in general require a key. The other essential point: pay_and_buy signs with the operator's key on the server, NOT with a wallet the agent controls, so the honest description is that the agent decided what to buy and executed the purchase rather than that it paid from its own funds. Explain pay_and_buy's guard rails: an x-agent-key header, a cap per purchase, every term read from the gateway's own 402 challenge and compared against hard-coded limits, the delivery address never exposed because tokens always go to the signer, and a per-hour call cap because the per-purchase cap bounds size and not count. Include a client configuration snippet using the endpoint from the facts.",
  },
  {
    slug: "agent-identity",
    title: "Agent identity (ERC-8004)",
    brief:
      "What is integrated and what is not. Cover: passing an agent id at launch makes the factory call ownerOf on the Identity Registry and revert unless the caller owns that agent; this integrates ONE of the standard's three registries — Reputation and Validation are not touched and supportsInterface is not implemented; an agent id means nothing without its chain because each registry keeps its own state; agentBound is the flag to read and not agentId, because id zero is a real agent with a real owner; registration is its own transaction that happens before the launch. Say that the registry is an upgradeable proxy owned by a third party so its behaviour can change without our involvement, and that the EIP is still a Draft. Never write the phrase 'ERC-8004 compliant'.",
  },
  {
    slug: "data",
    title: "Reading market data",
    brief:
      "The read paths and why they differ per chain. Cover: the registry answers first and alone decides which markets exist, with indexers additive on top, because an indexer is always behind the chain and a launch that just succeeded must not read as 'does not exist'; Monad is served by an Envio HyperIndex that is publicly queryable with no account and no key, read-only enforced by the database role so the public schema has no mutation root; Base and Arbitrum are served by a subgraph; 0G is read straight from RPC logs because The Graph does not serve it. Explain that per-chain eth_getLogs limits are the reason these differ, and that those limits are measured rather than assumed because providers tighten them without notice.",
  },
  {
    slug: "security",
    title: "Security and guarantees",
    brief:
      "What the contracts guarantee and what has not been done. Cover: every fee rate is immutable, nothing on the launch path has an owner or a setter, and there is no withdraw, sweep, rescue or drain function anywhere in the curve, so native leaves only through a seller's payout or a fee claim to an address fixed at construction; there is no proxy and no upgrade path, so deployed bytecode is frozen and a fix cannot reach a market that already exists. Then state plainly that no security firm has reviewed the contracts, that the published analyser output is not a substitute, and that findings are reported through GitHub private vulnerability reporting. Mention the analyser engines from the facts by count, not by inventing numbers.",
  },
];

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

const SYSTEM = `You write developer documentation for ADEXTO, a protocol that opens bonding-curve markets on four EVM mainnets.

ABSOLUTE RULES, and the first one matters more than the rest:

1. FACTS ONLY FROM THE SUPPLIED JSON. You are given a facts object. Every contract address, chain id, bps value, tool name, endpoint URL, keccak hash and byte count you write MUST appear in it. If you need a fact that is not there, write the sentence without it or omit the sentence. Never invent, never round, never "for example 0x...". Invented addresses are the single worst failure mode here.

2. NO MARKETING. No "seamless", "revolutionary", "powerful", "cutting-edge", "unlock". Do not praise the protocol. Describe mechanisms. Where something is a limitation, say it in the same plain voice as everything else.

3. STATE LIMITS IN THE SAME BREATH AS CAPABILITIES. This project's documentation convention is that a capability and its boundary appear together, not in separate optimistic and pessimistic sections.

4. NEVER write any of these phrases: ${BANNED.join(", ")}.

5. Explain WHY a design is the way it is when the brief gives you the reason. A reader should be able to check a claim against the contracts in about a minute.

6. WRITE COMPLETE, GRAMMATICAL ENGLISH SENTENCES. Every sentence needs its articles ("the", "a") and correctly conjugated verbs. Do NOT write telegraphic or note-form text. Wrong: "Agent hold zero private keys." "MCP endpoint live at X." Right: "The agent holds no private keys." "The MCP endpoint is at X." This is prose for a documentation site, not bullet shorthand.

7. YOU MAY NOT EMIT TABLES OF DATA. Tables of tools, addresses, chains or fee legs are generated from the facts file directly, because a model that reorders rows pairs the right words with the wrong subject and no fact-checker catches it. That happened on the first draft: a tool was given another tool's description. Instead, request a table by name with {"type":"factsTable","table":"..."} and it will be rendered from the facts. Permitted values: "chains", "mcpTools", "markets", "feeLegs", "analysers". Refer to a table in prose; never restate its contents.

OUTPUT FORMAT. Return ONLY valid JSON, no markdown fence, matching:

{
  "lede": "one or two sentences, plain, no marketing, full sentences",
  "sections": [
    { "heading": "string",
      "blocks": [
        { "type": "p", "text": "string" },
        { "type": "list", "items": ["full sentences"] },
        { "type": "factsTable", "table": "chains|mcpTools|markets|feeLegs|analysers" },
        { "type": "code", "lang": "bash|json|solidity|ts", "code": "string" },
        { "type": "note", "text": "string" }
      ] }
  ]
}

Use "note" for a boundary or a warning the reader must not miss. 4 to 7 sections. Inline code goes in backticks inside text.`;

async function draft(page) {
  const body = {
    model: MODEL,
    stream: false,
    temperature: 0.3,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `PAGE: ${page.title}\n\nBRIEF:\n${page.brief}\n\nFACTS (the only permitted source of addresses, numbers, tool names and endpoints):\n${JSON.stringify(facts)}`,
      },
    ],
  };
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    // Router bisa menjawab SSE walau stream:false diminta. Rakit ulang dari potongannya.
    const chunks = text
      .split("\n")
      .filter((l) => l.startsWith("data: ") && !l.includes("[DONE]"))
      .map((l) => {
        try {
          return JSON.parse(l.slice(6))?.choices?.[0]?.delta?.content ?? "";
        } catch {
          return "";
        }
      });
    payload = { choices: [{ message: { content: chunks.join("") } }] };
  }
  let content = payload?.choices?.[0]?.message?.content ?? "";
  content = content.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  const parsed = JSON.parse(content);
  if (!parsed.lede || !Array.isArray(parsed.sections) || parsed.sections.length === 0) {
    throw new Error("model returned JSON without a lede or sections");
  }
  /**
   * Tabel data ditolak di sini, bukan disaring saat render.
   *
   * Draf pertama memancarkan `table` dan salah satu barisnya memberi `list_markets`
   * deskripsi milik `trade_history` — kata-katanya semua nyata, jadi pemeriksa fakta tidak
   * menangkapnya. Menolaknya di gerbang ini berarti kesalahan itu tidak bisa masuk sama
   * sekali, alih-alih bergantung pada seseorang yang membaca ulang setiap baris.
   */
  const TABLES = new Set(["chains", "mcpTools", "markets", "feeLegs", "analysers"]);
  for (const s of parsed.sections) {
    for (const b of s.blocks ?? []) {
      if (b.type === "table") {
        throw new Error("model emitted a data table; only factsTable is allowed — re-run to redraft");
      }
      if (b.type === "factsTable" && !TABLES.has(b.table)) {
        throw new Error(`model asked for unknown factsTable "${b.table}"`);
      }
    }
  }
  return parsed;
}

const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { pages: {} };
existing.pages ??= {};

const todo = PAGES.filter((p) => (only ? p.slug === only : true)).filter((p) => force || !existing.pages[p.slug]);
if (todo.length === 0) {
  console.log("nothing to draft (use --force to rewrite)");
  process.exit(0);
}

for (const page of todo) {
  process.stdout.write(`drafting ${page.slug} ... `);
  try {
    const content = await draft(page);
    existing.pages[page.slug] = { title: page.title, ...content, draftedAt: new Date().toISOString() };
    const blocks = content.sections.reduce((n, s) => n + (s.blocks?.length ?? 0), 0);
    console.log(`ok (${content.sections.length} sections, ${blocks} blocks)`);
  } catch (e) {
    console.log(`FAILED — ${String(e.message).slice(0, 140)}`);
  }
  writeFileSync(OUT, `${JSON.stringify(existing, null, 2)}\n`);
}

existing.order = PAGES.map((p) => p.slug);
existing.generatedWith = { model: MODEL, factsGeneratedAt: facts.generatedAt };
writeFileSync(OUT, `${JSON.stringify(existing, null, 2)}\n`);
console.log(`\nwrote ${OUT} — ${Object.keys(existing.pages).length} of ${PAGES.length} pages`);
console.log("now run: node scripts/docs-verify.mjs");
