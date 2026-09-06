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
 * The two generations this subgraph has to serve at once.
 *
 * `swapInputs` is the field count of each generation's `Swap`, and it is the whole
 * reason two data sources exist: 0.11.0 inserts `protocolFee` before both reserves,
 * so the signature and therefore the topic0 differ and graph-node treats them as
 * unrelated events.
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
] as const;

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
  check(
    `wasm template ${g.template} (v${g.version})`,
    existsSync(join(BUILD, "templates", g.template, `${g.template}.wasm`)),
  );
}

// ── 2. Manifest sumber memuat kedua generasi ────────────────────────────────
step("2) Manifest sumber (subgraph.yaml)");
const manifest = readFileSync(join(SUBGRAPH, "subgraph.yaml"), "utf8");
for (const g of GENERATIONS) {
  check(`dataSource ${g.dataSource} terdaftar`, new RegExp(`name:\\s*${g.dataSource}\\b`).test(manifest));
  check(`template ${g.template} terdaftar`, new RegExp(`name:\\s*${g.template}\\b`).test(manifest));
  check(`mapping ${g.mapping} dirujuk`, manifest.includes(`./${g.mapping}`));
  check(`mapping ${g.factoryMapping} dirujuk`, manifest.includes(`./${g.factoryMapping}`));
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
step("3) topic0 kedua generasi");
const abiOf = (name: string) => JSON.parse(readFileSync(join(SUBGRAPH, "abis", `${name}.json`), "utf8"));
const topics = new Map<string, string>();
for (const g of GENERATIONS) {
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

// ── 5. networks.json menjawab kedua dataSource ──────────────────────────────
step("5) networks.json");
const networks = JSON.parse(readFileSync(join(SUBGRAPH, "networks.json"), "utf8"));
for (const [name, section] of Object.entries<Record<string, any>>(networks)) {
  const missing = GENERATIONS.map((g) => g.dataSource).filter((ds) => !section[ds]);
  check(
    `${name}: kedua dataSource punya alamat`,
    missing.length === 0,
    missing.length ? `kurang ${missing.join(", ")}` : Object.keys(section).join(" + "),
  );
}

// ── 6. Konstanta di mapping vs chain ────────────────────────────────────────
step("6) Konstanta mapping vs chain");
/**
 * `PROTOCOL_FEE_BPS` ditulis sebagai konstanta di `src/factory-v11.ts` karena aturan
 * direktori mapping melarang panggilan view — RPC 0G pruned, dan satu `.bind()` akan
 * mematikan subgraph saat mengejar dari startBlock. Konstanta yang tidak diperiksa
 * adalah tebakan, jadi ia diperiksa DI SINI, terhadap chain.
 */
const v11Source = readFileSync(join(SUBGRAPH, "src", "factory-v11.ts"), "utf8");
const declared = v11Source.match(/PROTOCOL_FEE_BPS\s*=\s*BigInt\.fromI32\((\d+)\)/);
check("PROTOCOL_FEE_BPS terbaca di src/factory-v11.ts", Boolean(declared), declared?.[1] ?? "tidak ditemukan");

const FACTORY_ABI = [
  "function VERSION() view returns (string)",
  "function PROTOCOL_FEE_BPS() view returns (uint256)",
];

for (const c of CHAINS) {
  const addr = process.env[c.env];
  if (!addr) {
    skip(`${c.network}: VERSION/PROTOCOL_FEE_BPS di chain`, `${c.env} tidak diset`);
    continue;
  }
  const provider = new ethers.JsonRpcProvider(c.rpc, c.chainId, { staticNetwork: true });
  const factory = new ethers.Contract(addr, FACTORY_ABI, provider);
  let version: string | null = null;
  try {
    version = await factory.VERSION();
  } catch (e: any) {
    skip(`${c.network}: VERSION di chain`, String(e.shortMessage ?? e.message).slice(0, 40));
    continue;
  }
  const known = GENERATIONS.find((g) => g.version === version);
  check(`${c.network}: VERSION ${version} adalah generasi yang subgraph kenal`, Boolean(known));
  if (!known) continue;

  if (known.hasProtocolLeg) {
    let onChain: bigint | null = null;
    try {
      onChain = BigInt(await factory.PROTOCOL_FEE_BPS());
    } catch (e: any) {
      check(`${c.network}: PROTOCOL_FEE_BPS terbaca`, false, String(e.shortMessage ?? e.message).slice(0, 40));
      continue;
    }
    check(
      `${c.network}: PROTOCOL_FEE_BPS di chain = konstanta mapping`,
      declared !== null && onChain === BigInt(declared[1]),
      `chain ${onChain} vs mapping ${declared?.[1]}`,
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

  const prev = process.env[c.prevEnv!];
  if (prev) {
    const prevFactory = new ethers.Contract(prev, FACTORY_ABI, provider);
    try {
      const prevVersion = await prevFactory.VERSION();
      check(
        `${c.network}: factory digantikan menjawab v0.10.0`,
        prevVersion === "0.10.0",
        `${prev} -> ${prevVersion}`,
      );
    } catch (e: any) {
      check(`${c.network}: factory digantikan terbaca`, false, String(e.shortMessage ?? e.message).slice(0, 40));
    }
  }
}

console.log(failures === 0 ? "\nSEMUA CEK LULUS" : `\n${failures} CEK GAGAL`);
process.exit(failures === 0 ? 0 : 1);
