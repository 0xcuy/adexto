/**
 * Verify the subgraph build against the manifest, the schema, and the chain.
 *
 * WHAT THIS FILE USED TO DO, AND WHY THAT WAS WORSE THAN NOTHING
 *
 * It printed three green checkmarks after testing for
 * `build/AdextoTrinityFactory/AdextoTrinityFactory.wasm` — a mapping that has not
 * existed since the curve generation replaced the seeded one — and then printed a
 * factory address, a start block and a handler name (`handleTrinityProjectCreated`)
 * as facts. None of the three were read from anything. The handler does not exist.
 *
 * So the script could only fail by throwing on a missing file, and once that file
 * was missing for the ordinary reason that it had been renamed, the honest move was
 * to make the check real rather than update the path.
 *
 * Everything below is compared against a source. Nothing is asserted.
 *
 *   npx tsx scripts/verify-subgraph.mts
 *
 * Requires `graph build` to have run. On-chain comparisons are skipped, loudly, when
 * the matching NEXT_PUBLIC_CURVE_FACTORY_* is unset — skipped, not passed.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import * as dotenv from "dotenv";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SUBGRAPH = join(ROOT, "subgraph");
const BUILD = join(SUBGRAPH, "build");

dotenv.config({ path: join(ROOT, ".env.local"), quiet: true });

let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures += 1;
};
const skip = (label: string, why: string) => console.log(`  SKIP  ${label} — ${why}`);
const step = (s: string) => console.log(`\n${s}`);

/**
 * The three generations this subgraph has to serve at once.
 *
 * `swapInputs` is the field count of each generation's `Swap`, and it is the whole
 * reason two curve templates exist: 0.11.0 inserts `protocolFee` before both
 * reserves, so the signature and therefore the topic0 differ and graph-node treats
 * them as unrelated events. v1 emits exactly the 0.11.0 events (checked in step 3b
 * against the contract sources), so it has its own factory data source but shares
 * the 0.11.0 ABI and curve template.
 */
const GENERATIONS = [
  {
    version: "0.10.0",
    dataSource: "AdextoCurveFactory",
    template: "SovereignCurve",
    mapping: "src/curve.ts",
    factoryMapping: "src/factory.ts",
    swapInputs: 10,
    hasProtocolLeg: false,
  },
  {
    version: "0.11.0",
    dataSource: "AdextoFactory",
    template: "AdextoCurve",
    mapping: "src/curve-v11.ts",
    factoryMapping: "src/factory-v11.ts",
    swapInputs: 11,
    hasProtocolLeg: true,
  },
  {
    version: "1.0.0",
    dataSource: "AdextoFactoryV1",
    template: "AdextoCurve",
    mapping: "src/curve-v11.ts",
    factoryMapping: "src/factory-v1.ts",
    swapInputs: 11,
    hasProtocolLeg: true,
  },
] as const;
/** One entry per curve template; v1 and 0.11.0 share one. */
const TEMPLATES = [...new Map(GENERATIONS.map((g) => [g.template, g])).values()];

const CHAINS = [
  { network: "0g", chainId: 16661, rpc: process.env.OG_RPC_URL || "https://evmrpc.0g.ai", env: "NEXT_PUBLIC_CURVE_FACTORY_0G", prevEnv: "NEXT_PUBLIC_CURVE_FACTORY_PREV_0G" },
  { network: "base", chainId: 8453, rpc: "https://mainnet.base.org", env: "NEXT_PUBLIC_CURVE_FACTORY_BASE", prevEnv: "NEXT_PUBLIC_CURVE_FACTORY_PREV_BASE" },
  { network: "arbitrum-one", chainId: 42161, rpc: "https://arb1.arbitrum.io/rpc", env: "NEXT_PUBLIC_CURVE_FACTORY_ARBITRUM", prevEnv: "NEXT_PUBLIC_CURVE_FACTORY_PREV_ARBITRUM" },
  { network: "monad", chainId: 143, rpc: "https://rpc.monad.xyz", env: "NEXT_PUBLIC_CURVE_FACTORY_MONAD", prevEnv: "NEXT_PUBLIC_CURVE_FACTORY_PREV_MONAD" },
];

console.log("SUBGRAPH VERIFICATION — build, manifest, schema, chain");

// ── 1. Build artifacts that actually exist ──────────────────────────────────
step("1) Artefak build");
if (!existsSync(BUILD)) {
  console.error("  build/ tidak ada. Jalankan dulu: cd subgraph && npx graph build --network 0g");
  process.exit(1);
}
check("build/subgraph.yaml ada", existsSync(join(BUILD, "subgraph.yaml")));
check("build/schema.graphql ada", existsSync(join(BUILD, "schema.graphql")));
for (const g of GENERATIONS) {
  check(
    `wasm dataSource ${g.dataSource} (v${g.version})`,
    existsSync(join(BUILD, g.dataSource, `${g.dataSource}.wasm`)),
  );
}
for (const t of TEMPLATES) {
  check(
    `wasm template ${t.template}`,
    existsSync(join(BUILD, "templates", t.template, `${t.template}.wasm`)),
  );
}

// ── 2. Manifest sumber memuat ketiga generasi ───────────────────────────────
step("2) Manifest sumber (subgraph.yaml)");
const manifest = readFileSync(join(SUBGRAPH, "subgraph.yaml"), "utf8");
for (const g of GENERATIONS) {
  check(`dataSource ${g.dataSource} terdaftar`, new RegExp(`name:\\s*${g.dataSource}\\b`).test(manifest));
  check(`mapping ${g.factoryMapping} dirujuk`, manifest.includes(`./${g.factoryMapping}`));
}
for (const t of TEMPLATES) {
  check(`template ${t.template} terdaftar`, new RegExp(`name:\\s*${t.template}\\b`).test(manifest));
  check(`mapping ${t.mapping} dirujuk`, manifest.includes(`./${t.mapping}`));
}
/**
 * Jumlah `uint256` di tanda tangan `Swap` tiap template dihitung dari manifest.
 *
 * Ini penjaga yang paling berharga di berkas ini. Kalau seseorang menyalin blok
 * template lalu lupa mengganti tanda tangannya, kedua template akan mendengarkan
 * `topic0` yang sama dan satu generasi berhenti terindeks — tanpa galat, tanpa
 * peringatan, cuma pasar yang tampak tidak pernah diperdagangkan.
 */
const swapSignatures = manifest.match(/event:\s*Swap\(([^)]*)\)/gs) ?? [];
check("ada dua tanda tangan Swap di manifest", swapSignatures.length === 2, `${swapSignatures.length} ditemukan`);
const inputCounts = swapSignatures
  .map((s) => s.replace(/\s+/g, "").match(/Swap\((.*)\)/)?.[1] ?? "")
  .map((args) => (args ? args.split(",").length : 0))
  .sort((a, b) => a - b);
check(
  "tanda tangan Swap berbeda: 10 field vs 11 field",
  inputCounts.length === 2 && inputCounts[0] === 10 && inputCounts[1] === 11,
  `[${inputCounts.join(", ")}]`,
);
check(
  "hanya template 0.11.0 yang menangani ProtocolFeesClaimed",
  (manifest.match(/handler:\s*handleProtocolFeesClaimed/g) ?? []).length === 1,
);

// ── 3. topic0 kedua Swap benar-benar berbeda ────────────────────────────────
step("3) topic0 kedua template");
const abiOf = (name: string) => JSON.parse(readFileSync(join(SUBGRAPH, "abis", `${name}.json`), "utf8"));
const topics = new Map<string, string>();
for (const g of TEMPLATES) {
  const abi = abiOf(g.template);
  const swap = abi.find((x: any) => x.type === "event" && x.name === "Swap");
  check(`ABI ${g.template} punya event Swap`, Boolean(swap));
  if (!swap) continue;
  check(
    `ABI ${g.template}: Swap ${g.swapInputs} field`,
    swap.inputs.length === g.swapInputs,
    `${swap.inputs.length}`,
  );
  const sig = `Swap(${swap.inputs.map((i: any) => i.type).join(",")})`;
  const topic = ethers.id(sig);
  console.log(`    ${g.template.padEnd(16)} ${topic}`);
  check(`topic0 ${g.template} belum dipakai generasi lain`, !topics.has(topic), topics.get(topic) ?? "");
  topics.set(topic, g.template);
  // Kedua reserve HARUS dibaca lewat nama, bukan indeks. Di 0.11.0 mereka bergeser
  // satu posisi karena `protocolFee` menyelip di depannya.
  const names = swap.inputs.map((i: any) => i.name);
  check(
    `${g.template}: nativeReserveAfter ada di indeks ${g.hasProtocolLeg ? 9 : 8}`,
    names.indexOf("nativeReserveAfter") === (g.hasProtocolLeg ? 9 : 8),
    `indeks ${names.indexOf("nativeReserveAfter")}`,
  );
  if (g.hasProtocolLeg) {
    check(`${g.template}: protocolFee ada di indeks 8`, names.indexOf("protocolFee") === 8);
  } else {
    check(`${g.template}: TIDAK punya protocolFee`, names.indexOf("protocolFee") === -1);
  }
}

// ── 3b. Event v1 di sumber kontrak = ABI yang dipakai data source v1 ────────
step("3b) Event v1 (contracts/) vs ABI 0.11.0 yang dipakai AdextoFactoryV1");
/**
 * Data source v1 memakai ABI 0.11.0. Itu hanya benar selama setiap event yang
 * diindeks bertanda tangan sama persis di sumber v1: satu field yang berubah
 * membuat topic0 berbeda, dan pasar v1 berhenti terindeks tanpa satu galat pun.
 * Kalau `contracts/` suatu hari berisi generasi berikutnya, cek VERSION di bawah
 * gagal lebih dulu, dan itu tandanya generasi itu butuh data source sendiri.
 */
const solEvents = (path: string) => {
  const src = readFileSync(join(ROOT, path), "utf8")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const out = new Map<string, string>();
  for (const m of src.matchAll(/\bevent\s+(\w+)\s*\(([\s\S]*?)\)\s*;/g)) {
    const types = m[2]
      .split(",")
      .map((p) => p.trim().split(/\s+/)[0])
      .filter(Boolean);
    out.set(m[1], `${m[1]}(${types.join(",")})`);
  }
  return out;
};
const abiEvents = (name: string) => {
  const out = new Map<string, string>();
  for (const e of abiOf(name).filter((x: any) => x.type === "event")) {
    out.set(e.name, `${e.name}(${e.inputs.map((i: any) => i.type).join(",")})`);
  }
  return out;
};
const indexedEvents = new Set([...manifest.matchAll(/- event:\s*(\w+)\(/g)].map((m) => m[1]));
const factorySol = readFileSync(join(ROOT, "contracts", "AdextoFactory.sol"), "utf8");
check("contracts/AdextoFactory.sol adalah v1", /VERSION\s*=\s*"1\.0\.0"/.test(factorySol));
for (const [sol, abi] of [
  ["contracts/AdextoFactory.sol", "AdextoFactory"],
  ["contracts/AdextoCurve.sol", "AdextoCurve"],
] as const) {
  const fromSource = solEvents(sol);
  for (const [name, sig] of abiEvents(abi)) {
    if (!indexedEvents.has(name)) continue;
    const srcSig = fromSource.get(name);
    check(
      `${name}: ${sol} = abis/${abi}.json`,
      srcSig === sig,
      srcSig === sig ? ethers.id(sig).slice(0, 10) : `${srcSig ?? "tidak ada"} vs ${sig}`,
    );
  }
}

// ── 4. Schema memuat kaki protokol ──────────────────────────────────────────
step("4) Schema");
const schema = readFileSync(join(SUBGRAPH, "schema.graphql"), "utf8");
for (const field of [
  "curveVersion: String!",
  "protocolFeeBps: BigInt!",
  "totalProtocolFees: BigInt!",
  "totalProtocolFeesClaimed: BigInt!",
  "protocolFee: BigInt!",
  "protocolFees: BigInt!",
]) {
  check(`schema memuat \`${field}\``, schema.includes(field));
}
check("entity ProtocolFeeClaim ada", /type ProtocolFeeClaim @entity/.test(schema));
/**
 * `caller` di samping `to`. Justru karena `claimProtocolFees()` tanpa izin, keduanya
 * bisa berbeda — dan menyimpan keduanya adalah satu-satunya cara memperlihatkan
 * tujuannya tidak bisa dibajak pemanggilnya.
 */
check(
  "ProtocolFeeClaim menyimpan caller DAN to",
  /type ProtocolFeeClaim @entity[\s\S]*?caller: Bytes!/.test(schema) &&
    /type ProtocolFeeClaim @entity[\s\S]*?to: Bytes!/.test(schema),
);

// ── 5. networks.json menjawab ketiga dataSource ─────────────────────────────
step("5) networks.json");
const networks = JSON.parse(readFileSync(join(SUBGRAPH, "networks.json"), "utf8"));
for (const [name, section] of Object.entries<Record<string, any>>(networks)) {
  const missing = GENERATIONS.map((g) => g.dataSource).filter((ds) => !section[ds]);
  check(
    `${name}: ketiga dataSource punya entri`,
    missing.length === 0,
    missing.length ? `kurang ${missing.join(", ")}` : Object.keys(section).join(" + "),
  );
}

// ── 6. Konstanta mapping dan alamat networks.json vs chain ──────────────────
step("6) Konstanta mapping dan networks.json vs chain");
/**
 * `PROTOCOL_FEE_BPS` ditulis sebagai konstanta di setiap adaptor factory yang punya kaki
 * protokol, karena aturan direktori mapping melarang panggilan view: RPC 0G pruned, dan
 * satu `.bind()` akan mematikan subgraph saat mengejar dari startBlock. Konstanta yang
 * tidak diperiksa adalah tebakan, jadi ia diperiksa DI SINI, terhadap chain.
 *
 * Alamatnya juga. Factory yang dibaca situs (`NEXT_PUBLIC_CURVE_FACTORY_*`) dan yang
 * digantikannya (`*_PREV_*`) harus menjawab VERSION generasi yang dikenal, dan
 * networks.json harus menaruh alamat itu di data source generasi TERSEBUT. Ini penjaga
 * untuk kelas bug generator yang sudah dua kali hampir terjadi: alamat generasi baru
 * tertulis di data source generasi lama, dan subgraph tetap melaporkan diri sehat.
 */
const declaredBps = new Map<string, string | null>();
for (const g of GENERATIONS) {
  if (!g.hasProtocolLeg) continue;
  const src = readFileSync(join(SUBGRAPH, g.factoryMapping), "utf8");
  const m = src.match(/PROTOCOL_FEE_BPS\s*=\s*BigInt\.fromI32\((\d+)\)/);
  declaredBps.set(g.version, m?.[1] ?? null);
  check(`PROTOCOL_FEE_BPS terbaca di ${g.factoryMapping}`, Boolean(m), m?.[1] ?? "tidak ditemukan");
}

const FACTORY_ABI = [
  "function VERSION() view returns (string)",
  "function PROTOCOL_FEE_BPS() view returns (uint256)",
];

for (const c of CHAINS) {
  if (!process.env[c.env]) {
    skip(`${c.network}: factory di chain`, `${c.env} tidak diset`);
    continue;
  }
  const provider = new ethers.JsonRpcProvider(c.rpc, c.chainId, { staticNetwork: true });
  const seen: string[] = [];
  for (const [role, envName] of [
    ["dipakai situs", c.env],
    ["digantikan", c.prevEnv],
  ] as const) {
    const addr = process.env[envName];
    if (!addr) {
      skip(`${c.network}: factory ${role}`, `${envName} tidak diset`);
      continue;
    }
    const factory = new ethers.Contract(addr, FACTORY_ABI, provider);
    let version: string;
    try {
      version = await factory.VERSION();
    } catch (e: any) {
      check(`${c.network}: VERSION factory ${role} terbaca`, false, String(e.shortMessage ?? e.message).slice(0, 40));
      continue;
    }
    seen.push(version);
    const known = GENERATIONS.find((g) => g.version === version);
    check(`${c.network}: factory ${role} v${version} adalah generasi yang subgraph kenal`, Boolean(known), addr);
    if (!known) continue;

    const entry = networks[c.network]?.[known.dataSource];
    check(
      `${c.network}: networks.json ${known.dataSource} = factory ${role}`,
      String(entry?.address ?? "").toLowerCase() === addr.toLowerCase(),
      `${entry?.address ?? "tidak ada"} vs ${addr}`,
    );

    if (known.hasProtocolLeg) {
      let onChain: bigint | null = null;
      try {
        onChain = BigInt(await factory.PROTOCOL_FEE_BPS());
      } catch (e: any) {
        check(`${c.network}: PROTOCOL_FEE_BPS v${version} terbaca`, false, String(e.shortMessage ?? e.message).slice(0, 40));
        continue;
      }
      const declared = declaredBps.get(known.version) ?? null;
      check(
        `${c.network}: PROTOCOL_FEE_BPS v${version} di chain = konstanta ${known.factoryMapping}`,
        declared !== null && onChain === BigInt(declared),
        `chain ${onChain} vs mapping ${declared}`,
      );
    } else {
      // Factory 0.10.0 TIDAK punya konstanta ini, dan itu jawabannya — bukan nol yang
      // kebetulan sama. Kalau ia malah menjawab, asumsi mapping tentang generasi ini
      // salah dan harus gagal di sini.
      let answered = false;
      try {
        await factory.PROTOCOL_FEE_BPS();
        answered = true;
      } catch {
        answered = false;
      }
      check(`${c.network}: factory v${version} tidak punya PROTOCOL_FEE_BPS`, !answered);
    }
  }
  if (seen.length === 2) {
    check(`${c.network}: factory digantikan dari generasi lain`, seen[0] !== seen[1], seen.join(" vs "));
  }
}

console.log(failures === 0 ? "\nSEMUA CEK LULUS" : `\n${failures} CEK GAGAL`);
process.exit(failures === 0 ? 0 : 1);
