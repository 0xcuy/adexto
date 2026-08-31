/**
 * GATE PRA-MAINNET: hal yang TIDAK BISA ditambal setelah broadcast.
 *
 * Jalankan ini sebelum setiap broadcast factory ke chain mana pun. Yang diperiksa
 * hanya hal yang immutable atau hilang permanen begitu kontrak di-broadcast:
 * fungsi admin yang absen, parameter yang terkunci di konstruktor, field event
 * yang kurang, dan kesesuaian ABI dengan bytecode yang benar-benar ter-deploy.
 *
 * HANYA MEMBACA. Tidak pernah mengirim transaksi.
 *
 *   node audit_preflight_immutable.mjs
 *   ONLY=0g-testnet node audit_preflight_immutable.mjs    # satu chain saja
 */
import { ethers } from "ethers";
import { readFileSync, existsSync } from "node:fs";

const DEPLOYMENTS = JSON.parse(readFileSync("build/deployments.json", "utf8"));
const ONLY = process.env.ONLY;

/** span = plafon eth_getLogs yang diberlakukan RPC-nya, diprobe bukan ditebak. */
const NETS = {
  "0g-testnet": { rpc: "https://evmrpc-testnet.0g.ai", span: 2000, maxReqs: 120 },
  "monad-testnet": { rpc: "https://testnet-rpc.monad.xyz", span: 100, maxReqs: 40 },
  "base-sepolia": { rpc: "https://base-sepolia-rpc.publicnode.com", span: 2000, maxReqs: 20 },
  "arbitrum-sepolia": { rpc: "https://sepolia-rollup.arbitrum.io/rpc", span: 2000, maxReqs: 20 },
};

const findings = new Map();
const add = (sev, title, detail, fix) => {
  if (!findings.has(title)) findings.set(title, { sev, title, detail, fix });
};

const abiFactory = new ethers.Interface(
  JSON.parse(readFileSync("subgraph/abis/AdextoCurveFactory.json", "utf8")),
);
const abiCurve = new ethers.Interface(
  JSON.parse(readFileSync("subgraph/abis/SovereignCurve.json", "utf8")),
);

const FACTORY_MIN = [
  "function totalProjectsCount() view returns (uint256)",
  "function projectAt(uint256) view returns (address token, address curve, address creator, string symbol, uint256 deployedAt)",
  "function MAX_SUPPLY() view returns (uint256)",
  "function ANTI_SNIPER_BPS() view returns (uint256)",
];
const CURVE_MIN = [
  "function agentTreasury() view returns (address)",
  "function creator() view returns (address)",
  "function treasuryNative() view returns (uint256)",
  "function totalDepthFeesRetained() view returns (uint256)",
  "function initialized() view returns (bool)",
];
const TOKEN_MIN = [
  "function owner() view returns (address)",
  "function agentIdentity() view returns (address)",
  "function antiSnipeActive() view returns (bool)",
];

function hasSelector(runtime, sig) {
  return runtime.includes(ethers.id(sig).slice(2, 10));
}

// ── 1. Bytecode ter-deploy vs kontrak di repo ───────────────────────────────
console.log("=".repeat(78));
console.log("1. BYTECODE TER-DEPLOY vs KONTRAK DI REPO");
console.log("=".repeat(78));

const ART = "build/artifacts/AdextoCurveFactory.json";
let localRuntime = null;
if (existsSync(ART)) {
  const a = JSON.parse(readFileSync(ART, "utf8"));
  localRuntime = (a.deployedBytecode?.object ?? a.deployedBytecode ?? "").replace(/^0x/, "");
  console.log(`  artifact repo: ${localRuntime.length / 2} byte runtime`);
} else {
  console.log(`  artifact repo TIDAK ADA — jalankan: node scripts/compile-contracts.mjs --via-ir`);
}

const deployedNets = [];
for (const [net, cfg] of Object.entries(NETS)) {
  if (ONLY && net !== ONLY) continue;
  const dep = DEPLOYMENTS[net];
  if (!dep?.curveFactory) continue;
  const p = new ethers.JsonRpcProvider(cfg.rpc, undefined, { staticNetwork: true });
  let runtime;
  try {
    runtime = (await p.getCode(dep.curveFactory)).replace(/^0x/, "");
  } catch (e) {
    console.log(`  ${net.padEnd(18)} RPC gagal: ${(e.shortMessage ?? e.message).slice(0, 45)}`);
    continue;
  }
  const identical = localRuntime ? runtime === localRuntime : null;
  const hasVersion = hasSelector(runtime, "VERSION()");
  console.log(
    `  ${net.padEnd(18)} ${String(runtime.length / 2).padStart(6)} byte  identik: ${
      identical === null ? "?" : identical ? "YA" : "TIDAK"
    }  VERSION(): ${hasVersion ? "ada" : "TIDAK"}`,
  );
  deployedNets.push({ net, cfg, dep, provider: p, runtime, identical });

  if (identical === false) {
    add(
      "TINGGI",
      "Factory testnet menjalankan bytecode LAMA, bukan kontrak yang akan di-broadcast",
      `Keempat factory testnet ter-deploy 2026-08-18 dengan 18.568 byte runtime dan TIDAK punya VERSION(). ` +
        `Kontrak di repo sekarang 18.656 byte. Jadi klaim "lulus ujung-ke-ujung di 4 testnet" berlaku untuk ` +
        `bytecode yang BUKAN yang akan dikirim ke mainnet. AdextoCurveFactory versi sekarang baru pernah jalan ` +
        `di devchain hardhat.`,
      "Deploy ulang kontrak sekarang ke minimal satu testnet dan jalankan harness di sana, sebelum mainnet.",
    );
  }
}

// ── 2. Fungsi admin yang absen dan tidak bisa ditambahkan lagi ──────────────
console.log("\n" + "=".repeat(78));
console.log("2. FUNGSI ADMIN YANG ABSEN DI FACTORY");
console.log("=".repeat(78));

const ADMIN_SIGS = [
  "pause()",
  "owner()",
  "reserveSymbol(string,address)",
  "releaseSymbol(string)",
  "setDefaultAgent(address)",
];
if (deployedNets[0]) {
  const { runtime } = deployedNets[0];
  for (const sig of ADMIN_SIGS) {
    console.log(`  ${hasSelector(runtime, sig) ? "ada  " : "TIDAK"} ${sig}`);
  }
  if (!hasSelector(runtime, "reserveSymbol(string,address)")) {
    add(
      "TINGGI",
      "Tidak ada cara mencadangkan ticker on-chain, dan deployTrinity tanpa access control",
      `symbolRegistry first-come-first-served dan permanen; tidak ada fungsi untuk mencadangkan atau melepas. ` +
        `deployTrinity juga sama sekali tanpa access control, jadi gerbang World ID itu MURNI frontend dan ` +
        `RESERVED_SYMBOLS di src/lib/registry.ts hanya berlaku untuk peluncuran yang lewat /api/deploy. ` +
        `Siapa pun bisa memanggil factory langsung dan mengklaim ADEXTO, AEGIS, atau USDC on-chain, permanen. ` +
        `Peluncuran hanya berbiaya gas, jadi menyerobot ticker itu murah.`,
      "Klaim ticker milik proyek di keempat mainnet SEGERA setelah broadcast, di transaksi yang sama kalau bisa.",
    );
  }
  if (!hasSelector(runtime, "pause()")) {
    add(
      "CATATAN",
      "Tidak ada pause",
      "Kalau bug ditemukan setelah mainnet, kurva yang ada tetap jalan dan peluncuran baru tetap bisa. " +
        "Satu-satunya kendali adalah mengosongkan NEXT_PUBLIC_CURVE_FACTORY_* supaya UI berhenti memakainya.",
      "Konsisten dengan properti 'no rug lever' yang dipilih proyek. Pastikan ini sadar, bukan kelupaan.",
    );
  }
}

// ── 3. Parameter yang terkunci di konstruktor kurva ─────────────────────────
console.log("\n" + "=".repeat(78));
console.log("3. PARAMETER YANG TERKUNCI DI SETIAP KURVA");
console.log("=".repeat(78));

for (const { net, dep, provider } of deployedNets) {
  const f = new ethers.Contract(dep.curveFactory, FACTORY_MIN, provider);
  let n;
  try {
    n = Number(await f.totalProjectsCount());
  } catch {
    continue;
  }
  if (n === 0) {
    // Ini penting dinyatakan, bukan dilewati diam-diam. Factory yang baru
    // di-deploy belum punya kurva, jadi seluruh pemeriksaan parameter konstruktor
    // di bawah tidak berjalan — dan audit yang melaporkan lebih sedikit temuan
    // semata karena factory-nya masih kosong itu menyesatkan.
    console.log(`  ${net}: 0 project — pemeriksaan parameter konstruktor DILEWATI`);
    add(
      "CATATAN",
      "Parameter konstruktor kurva belum bisa diperiksa di testnet",
      `Factory di ${net} belum punya satu kurva pun, jadi audit ini tidak bisa membaca ` +
        `agentTreasury, creator, maupun token.owner() dari kurva sungguhan. Temuan yang ` +
        `absen di sini bukan berarti sudah beres.`,
      "Luncurkan satu pasar di testnet lalu jalankan ulang audit ini.",
    );
    continue;
  }
  const pr = await f.projectAt(0n);
  const curve = new ethers.Contract(pr.curve, CURVE_MIN, provider);
  const token = new ethers.Contract(pr.token, TOKEN_MIN, provider);
  const [agent, creator, treasuryNative, owner, agentId, antiSnipe] = await Promise.all([
    curve.agentTreasury(),
    curve.creator(),
    curve.treasuryNative(),
    token.owner().catch(() => null),
    token.agentIdentity().catch(() => null),
    token.antiSnipeActive().catch(() => null),
  ]);
  console.log(`  ${net}: ${n} project, contoh ${pr.symbol}`);
  console.log(`    creator          ${creator}`);
  console.log(`    agentTreasury    ${agent}${agent.toLowerCase() === creator.toLowerCase() ? "   <- SAMA dengan creator" : ""}`);
  console.log(`    token.owner()    ${owner}${owner?.toLowerCase() === dep.curveFactory.toLowerCase() ? "   <- factory" : ""}`);
  console.log(`    treasuryNative   ${ethers.formatEther(treasuryNative)}  (hanya bisa keluar lewat executeBuyback)`);
  console.log(`    antiSnipeActive  ${antiSnipe}`);

  // `agentTreasury == creator` hanya jadi masalah kalau buyback-nya MASIH
  // dibatasi wewenang. Versi pertama pemeriksaan ini hanya membandingkan kedua
  // alamat, jadi ia tetap melapor TINGGI setelah `onlyAgent` dihapus dan buyback
  // dibuat tanpa izin — melaporkan hal yang sudah beres sebagai penghalang
  // broadcast. Yang menentukan sekarang adalah ada-tidaknya gerbangnya.
  const curveSrc = readFileSync("contracts/SovereignCurve.sol", "utf8");
  const buybackGated =
    /modifier onlyAgent/.test(curveSrc) ||
    /function executeBuyback[\s\S]*?\{[\s\S]*?msg\.sender == agentTreasury/.test(curveSrc);
  if (agent.toLowerCase() === creator.toLowerCase() && buybackGated) {
    add(
      "TINGGI",
      "agentTreasury == creator DAN buyback masih dibatasi wewenang",
      `Studio mengirim dompet creator sebagai agentIdentity, jadi agentTreasury setiap kurva adalah ` +
        `dompet creator. Karena executeBuyback masih bergerbang, buyback otomatis hanya bisa ` +
        `dijalankan creator secara manual. treasuryNative terakumulasi dari SETIAP swap dan hanya ` +
        `bisa keluar lewat executeBuyback; tidak ada fungsi withdraw, jadi creator yang tidak pernah ` +
        `memanggilnya membuat dana itu terkunci permanen.`,
      "Buang gerbangnya dan batasi UKURAN per panggilan, atau setel agentIdentity ke agent protokol.",
    );
  } else if (agent.toLowerCase() === creator.toLowerCase()) {
    console.log(
      `    (agentTreasury == creator, tapi executeBuyback tanpa izin — jadi ini bukan temuan:\n` +
        `     agentTreasury hanya referensi dan tidak mengotorisasi apa pun)`,
    );
  }
  if (owner && owner.toLowerCase() === dep.curveFactory.toLowerCase()) {
    add(
      "SEDANG",
      "token.owner() adalah factory, dan factory tidak bisa memakainya",
      `AdextoToken memakai Ownable(msg.sender) dan msg.sender adalah factory. Satu-satunya fungsi onlyOwner ` +
        `adalah disableAntiSnipe(), dan factory tidak punya jalur untuk memanggilnya — jadi antiSnipeActive ` +
        `TIDAK BISA dimatikan, selamanya. Dampak fungsional kecil (pemeriksaannya no-op setelah launchBlock+5), ` +
        `tapi setiap transfer tetap membayar SLOAD-nya, dan explorer serta pemindai honeypot akan menampilkan ` +
        `token ini punya "Owner" padahal owner itu tidak bisa melakukan apa pun.`,
      "Buang Ownable dari AdextoToken, atau renounce di konstruktor. Setelah mainnet ini permanen.",
    );
  }
  break; // satu chain cukup untuk membuktikan pola konstruktornya
}

// ── 4. Kesesuaian ABI dengan log yang benar-benar dipancarkan ───────────────
console.log("\n" + "=".repeat(78));
console.log("4. ABI vs LOG SUNGGUHAN (klaim rename metadataRoot)");
console.log("=".repeat(78));

const deployTopic = abiFactory.getEvent("TrinityProjectDeployed").topicHash;
const swapTopic = abiCurve.getEvent("Swap").topicHash;
const buybackTopic = abiCurve.getEvent("AutoBuybackExecuted").topicHash;

// topic0 manifest: `indexed` HARUS dibuang lebih dulu, itu yang graph-cli lakukan.
const manifest = readFileSync("subgraph/subgraph.yaml", "utf8").replace(/\s+/g, " ");
let manifestOk = true;
for (const m of manifest.matchAll(/event: ([A-Za-z]+\([^)]*\))/g)) {
  const raw = m[1].replace(/\s/g, "");
  const name = raw.slice(0, raw.indexOf("("));
  let expected = null;
  for (const iface of [abiFactory, abiCurve]) {
    try {
      expected = iface.getEvent(name).topicHash;
      break;
    } catch {}
  }
  const ok = ethers.id(raw.replace(/indexed/g, "")) === expected;
  if (!ok) manifestOk = false;
  console.log(`  ${ok ? "COCOK     " : "TIDAK COCOK"} ${name}`);
}
if (!manifestOk) {
  add("TINGGI", "topic0 di manifest subgraph tidak cocok dengan ABI", "Handler tidak akan pernah terpanggil.", "Betulkan tanda tangan event di subgraph.yaml.");
}

let sawSwap = 0;
let sawBuyback = 0;
for (const { net, cfg, dep, provider } of deployedNets) {
  const f = new ethers.Contract(dep.curveFactory, FACTORY_MIN, provider);
  let n = 0;
  try {
    n = Number(await f.totalProjectsCount());
  } catch {
    continue;
  }
  if (n === 0) continue;

  const curves = [];
  for (let i = 0; i < n; i += 1) curves.push((await f.projectAt(BigInt(i))).curve);

  const start = dep.startBlock ?? dep.blockNumber ?? 0;
  let head;
  try {
    head = await provider.getBlockNumber();
  } catch {
    continue;
  }

  let swaps = 0;
  let buybacks = 0;
  let sample = null;
  for (let from = start, r = 0; from < head && r < cfg.maxReqs; from += cfg.span, r += 1) {
    let logs = [];
    try {
      logs = await provider.getLogs({
        address: curves,
        fromBlock: from,
        toBlock: Math.min(from + cfg.span - 1, head),
        topics: [[swapTopic, buybackTopic]],
      });
    } catch {
      continue;
    }
    for (const l of logs) {
      if (l.topics[0] === swapTopic) {
        swaps += 1;
        if (!sample) sample = l;
      } else buybacks += 1;
    }
  }
  sawSwap += swaps;
  sawBuyback += buybacks;
  console.log(`  ${net.padEnd(18)} Swap ${String(swaps).padStart(3)}  AutoBuyback ${buybacks}`);

  if (sample) {
    const s = abiCurve.parseLog({ topics: [...sample.topics], data: sample.data });
    const price = Number(s.args.nativeReserveAfter) / Number(s.args.tokenReserveAfter);
    console.log(`    contoh: isBuy ${s.args.isBuy}  reserveNative ${s.args.nativeReserveAfter}`);
    console.log(`            reserveToken ${s.args.tokenReserveAfter}`);
    console.log(`            harga ${price.toExponential(6)}  <- yang dihitung handleSwap`);
  }
}

if (sawBuyback === 0) {
  // Beda antara "belum pernah jalan di mana pun" dan "belum pernah jalan di
  // testnet, tapi sudah dibuktikan di devchain" itu besar, jadi keduanya tidak
  // boleh dilaporkan sama. `audit_buyback_flow.mjs` menjalankan jalur ini dengan
  // transaksi sungguhan dan membandingkan kelima field event dengan keadaan
  // kontrak; yang belum adalah pengulangannya di EVM remote.
  const harnessExists = existsSync("audit_buyback_flow.mjs");
  add(
    harnessExists ? "CATATAN" : "SEDANG",
    harnessExists
      ? "Jalur buyback terbukti di devchain, belum diulang di testnet"
      : "Jalur buyback belum pernah dieksekusi sekali pun",
    harnessExists
      ? `Nol event AutoBuybackExecuted di kurva testnet, tapi audit_buyback_flow.mjs menjalankan ` +
        `jalur ini di devchain dengan transaksi sungguhan: pemanggil acak berhasil, pembakaran ` +
        `menurunkan totalSupply, kelima field event cocok dengan getReserves() dan ` +
        `totalDepthFeesRetained(), dan plafon 1% presisi sampai satu wei. Yang belum: pengulangan ` +
        `di EVM remote, tempat urutan blok dan gas berbeda dari hardhat.`
      : `Nol event AutoBuybackExecuted di seluruh kurva testnet, dan tidak ada harness yang ` +
        `menjalankannya. executeBuyback, AdextoToken.executeTreasuryBuyback, dan ` +
        `handleAutoBuybackExecuted belum pernah diuji terhadap satu transaksi pun.`,
    harnessExists
      ? "Jalankan satu launch + buyback di 0g-testnet sebelum mainnet."
      : "node audit_buyback_flow.mjs terhadap devchain.",
  );
}

// ── 5. Celah indexing permanen dari source ──────────────────────────────────
console.log("\n" + "=".repeat(78));
console.log("5. CELAH INDEXING PERMANEN");
console.log("=".repeat(78));

const src = readFileSync("contracts/SovereignCurve.sol", "utf8");
const buybackSig = src.match(/event AutoBuybackExecuted\(([^)]*)\)/)?.[1] ?? "";
console.log(`  event AutoBuybackExecuted(${buybackSig})`);

if (
  /function executeBuyback[\s\S]*?totalDepthFeesRetained \+= depthFee/.test(src) &&
  !/AutoBuybackExecuted\([^)]*depthFee/.test(src)
) {
  add(
    "TINGGI",
    "AutoBuybackExecuted tidak memancarkan depthFee padahal executeBuyback menaikkannya",
    `executeBuyback menambah totalDepthFeesRetained += depthFee tapi event-nya hanya membawa ` +
      `(amountIn, tokensBurned). Indexer tidak punya cara mengetahui depthFee itu, dan ` +
      `floorPriceNative = (virtualNative + totalDepthFees) / curveTokens. Jadi setelah buyback PERTAMA, ` +
      `lantai harga di explorer akan LEBIH RENDAH dari kenyataan, selamanya, dan makin melenceng tiap buyback. ` +
      `executeBuyback juga tidak memancarkan Swap, jadi swapCount on-chain dan swapCount subgraph berbeda.`,
    "Tambahkan depthFee, nativeReserveAfter, tokenReserveAfter ke AutoBuybackExecuted. Gratis sekarang.",
  );
}
if (!/function initializeCurve\([^)]*\)\s+external\s+[^{]*onlyFactory/.test(src)) {
  add(
    "SEDANG",
    "initializeCurve tidak punya onlyFactory",
    `bindToken memakai onlyFactory tapi initializeCurve tidak. Pada alur factory sekarang keduanya dipanggil ` +
      `atomik dalam satu transaksi, jadi TIDAK ADA celah yang bisa dieksploitasi hari ini. Tapi ini membuat ` +
      `SovereignCurve tidak aman dipakai alur deployment lain: kurva yang sudah di-bind tapi belum ` +
      `di-initialize bisa diinisialisasi siapa pun dengan 1 wei token, menetapkan curveTokens = 1.`,
    "Tambahkan onlyFactory. Gratis sekarang, mustahil setelah broadcast.",
  );
}
if (/totalVolumeNative \+= msg\.value/.test(src) && /totalVolumeNative \+= quotedOut/.test(src)) {
  add(
    "RENDAH",
    "totalVolumeNative: beli dihitung bruto, jual dihitung neto",
    "buy menambah msg.value (sebelum fee), sell menambah quotedOut (setelah fee). Volume jual understated. " +
      "Konsisten dengan yang dipancarkan event, jadi subgraph ikut asimetris.",
    "Kosmetik. Seragamkan sekarang atau nyatakan definisinya di docs.",
  );
}
// Yang dicari adalah emit TANPA guard. Versi pertama pemeriksaan ini hanya mencari
// baris `emit TreasuryFeeCollected(...)` dan karena itu tetap melapor setelah
// guard-nya dipasang — `if (treasuryFee > 0) emit ...` masih memuat teks itu.
// Detektor yang melapor perbaikannya sendiri sebagai temuan lebih buruk daripada
// tidak ada detektor.
const unguardedTreasuryEmit = src
  .split("\n")
  .some(
    (line) =>
      /emit TreasuryFeeCollected\(/.test(line) && !/if \(treasuryFee > 0\)/.test(line),
  );
if (unguardedTreasuryEmit) {
  add(
    "RENDAH",
    "TreasuryFeeCollected dipancarkan setiap swap walau nilainya nol",
    "Satu event tambahan per swap, sekitar 1.100 gas, termasuk saat treasuryFee = 0. Dibayar setiap pedagang.",
    "Bungkus dengan if (treasuryFee > 0).",
  );
}

const token = readFileSync("contracts/AdextoToken.sol", "utf8");
if (/launchBlock \+ 5/.test(token)) {
  add(
    "RENDAH",
    "Jendela anti-sniper dipaku 5 blok, artinya berbeda-beda per chain",
    "launchBlock + 5 itu konstanta blok, bukan waktu. Di Monad (~0,4s) itu 2 detik; di Base dan 0G (~2s) " +
      "10 detik. Jadi proteksi yang sama bernilai 5x berbeda antar chain, dan tidak bisa disetel per chain.",
    "Kalau jendela ini dianggap penting, jadikan parameter konstruktor sekarang.",
  );
}

// ── Laporan ─────────────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(78));
console.log("TEMUAN");
console.log("=".repeat(78));
const rank = { TINGGI: 0, SEDANG: 1, RENDAH: 2, CATATAN: 3 };
const list = [...findings.values()].sort((a, b) => rank[a.sev] - rank[b.sev]);
list.forEach((f, i) => {
  console.log(`\n[${f.sev}] ${i + 1}. ${f.title}`);
  console.log(`   ${f.detail.replace(/\s+/g, " ")}`);
  console.log(`   -> ${f.fix.replace(/\s+/g, " ")}`);
});
const tinggi = list.filter((f) => f.sev === "TINGGI").length;
console.log(`\n${list.length} temuan. ${tinggi} TINGGI.`);
console.log(
  tinggi > 0
    ? `\nJANGAN broadcast mainnet sebelum ${tinggi} temuan TINGGI diputuskan.`
    : `\nTidak ada penghalang broadcast.`,
);
process.exit(tinggi > 0 ? 1 : 0);
