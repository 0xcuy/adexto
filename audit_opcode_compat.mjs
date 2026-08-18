/**
 * READ-ONLY: cek kompatibilitas opcode bytecode v2 terhadap chain target.
 *
 * Tujuan: mencegah skenario "deploy lolos tapi swap revert" karena bytecode
 * memakai opcode yang belum didukung chain. solc 0.8.26 default ke EVM version
 * Cancun, sedangkan beberapa L1/L2 masih Shanghai atau Paris.
 *
 * Disassembly dilakukan linear dengan melewati immediate PUSH, jadi byte data
 * tidak salah dibaca sebagai opcode.
 */
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";

const HARDFORK_OPCODES = {
  0x5f: { name: "PUSH0", fork: "Shanghai" },
  0x5c: { name: "TLOAD", fork: "Cancun" },
  0x5d: { name: "TSTORE", fork: "Cancun" },
  0x5e: { name: "MCOPY", fork: "Cancun" },
  0x49: { name: "BLOBHASH", fork: "Cancun" },
  0x4a: { name: "BLOBBASEFEE", fork: "Cancun" },
  0x48: { name: "BASEFEE", fork: "London" },
  0x5b: { name: "JUMPDEST", fork: "Frontier" },
};

/** Linear disassembly that skips PUSH immediates. */
function scanOpcodes(hex) {
  const code = hex.startsWith("0x") ? hex.slice(2) : hex;
  const found = new Map();
  let i = 0;
  while (i < code.length / 2) {
    const op = parseInt(code.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(op)) break;

    if (HARDFORK_OPCODES[op] && HARDFORK_OPCODES[op].fork !== "Frontier") {
      const entry = HARDFORK_OPCODES[op];
      found.set(entry.name, { fork: entry.fork, count: (found.get(entry.name)?.count ?? 0) + 1 });
    }

    // PUSH1..PUSH32 carry immediate data that must be skipped.
    if (op >= 0x60 && op <= 0x7f) {
      i += 1 + (op - 0x5f);
    } else {
      i += 1;
    }
  }
  return found;
}

const artifact = (name) =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), "build", "artifacts", `${name}.json`), "utf8"));

console.log("1) OPCODE DALAM BYTECODE v2 YANG SUDAH DIKOMPILASI\n");

let needsShanghai = false;
let needsCancun = false;

for (const name of ["SovereignHook", "AdextoTrinityFactoryV2", "AdextoToken"]) {
  let a;
  try {
    a = artifact(name);
  } catch {
    console.log(`  ${name}: artefak belum ada\n`);
    continue;
  }
  const found = scanOpcodes(a.deployedBytecode ?? a.bytecode);
  console.log(`  ${name} (${((a.deployedBytecode ?? a.bytecode).length - 2) / 2} byte runtime)`);
  if (found.size === 0) {
    console.log("    tidak ada opcode pasca-London");
  }
  for (const [op, info] of found) {
    console.log(`    ${op.padEnd(12)} x${String(info.count).padEnd(5)} butuh ${info.fork}`);
    if (info.fork === "Shanghai") needsShanghai = true;
    if (info.fork === "Cancun") needsCancun = true;
  }
  console.log();
}

const required = needsCancun ? "Cancun" : needsShanghai ? "Shanghai" : "London atau lebih lama";
console.log(`  => bytecode saat ini menuntut minimal: ${required}\n`);

console.log("2) DUKUNGAN HARDFORK DI CHAIN TARGET\n");

const CHAINS = [
  { key: "0g", name: "0G Mainnet", chainId: 16661, rpc: "https://evmrpc.0g.ai" },
  { key: "arbitrum", name: "Arbitrum One", chainId: 42161, rpc: "https://arb1.arbitrum.io/rpc" },
  { key: "base", name: "Base Mainnet", chainId: 8453, rpc: "https://mainnet.base.org" },
  { key: "monad", name: "Monad Mainnet", chainId: 143, rpc: "https://rpc.monad.xyz" },
];

for (const c of CHAINS) {
  try {
    const provider = new ethers.JsonRpcProvider(c.rpc);
    const block = await provider.send("eth_getBlockByNumber", ["latest", false]);

    // Header field presence is the reliable on-chain signal for each fork.
    const hasBaseFee = block.baseFeePerGas !== undefined && block.baseFeePerGas !== null;
    const hasWithdrawals = block.withdrawalsRoot !== undefined || block.withdrawals !== undefined;
    const hasBlobFields = block.excessBlobGas !== undefined || block.blobGasUsed !== undefined;

    let blobBaseFee = null;
    try {
      blobBaseFee = await provider.send("eth_blobBaseFee", []);
    } catch {
      blobBaseFee = null;
    }

    const level = hasBlobFields || blobBaseFee ? "Cancun" : hasWithdrawals ? "Shanghai" : hasBaseFee ? "London" : "pra-London";

    console.log(`  ${c.name} (${c.chainId})`);
    console.log(`    baseFeePerGas    : ${hasBaseFee ? "ada" : "tidak"}   (London)`);
    console.log(`    withdrawals      : ${hasWithdrawals ? "ada" : "tidak"}   (Shanghai)`);
    console.log(`    excessBlobGas    : ${hasBlobFields ? "ada" : "tidak"}   (Cancun)`);
    console.log(`    eth_blobBaseFee  : ${blobBaseFee ? blobBaseFee : "tidak didukung"}`);
    console.log(`    => indikasi header: ${level}`);
    console.log();
  } catch (e) {
    console.log(`  ${c.name}: RPC gagal — ${(e.shortMessage || e.message).slice(0, 70)}\n`);
  }
}

console.log("3) UJI OPCODE LANGSUNG DI CHAIN (eth_call, tanpa transaksi)\n");

/**
 * Runtime kecil yang mengeksekusi satu opcode lalu mengembalikan 0x01.
 * Kalau chain tidak mengenal opcode itu, eth_call akan revert / invalid opcode.
 */
const PROBES = {
  PUSH0: "5f5060015f5260206000f3",
  MCOPY: "60016000600060005e60015f5260206000f3",
  TSTORE: "6001600160005d60015f5260206000f3",
};

// Fallback tanpa PUSH0 untuk chain pra-Shanghai (pakai PUSH1 0x00).
const PROBES_LEGACY = {
  BASELINE: "600160005260206000f3",
};

async function probe(provider, runtime) {
  try {
    const result = await provider.send("eth_call", [
      { to: null, data: "0x" + runtime },
      "latest",
    ]);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: (e.shortMessage || e.info?.error?.message || e.message || "").slice(0, 60) };
  }
}

for (const c of CHAINS) {
  try {
    const provider = new ethers.JsonRpcProvider(c.rpc);
    console.log(`  ${c.name}`);
    const baseline = await probe(provider, PROBES_LEGACY.BASELINE);
    console.log(`    baseline (pra-Shanghai) : ${baseline.ok ? "jalan" : `gagal — ${baseline.error}`}`);
    if (!baseline.ok) {
      console.log("    (chain tidak mengizinkan eth_call ke bytecode inline; lewati probe opcode)\n");
      continue;
    }
    for (const [name, runtime] of Object.entries(PROBES)) {
      const r = await probe(provider, runtime);
      console.log(`    ${name.padEnd(23)} : ${r.ok ? "DIDUKUNG" : `TIDAK — ${r.error}`}`);
    }
    console.log();
  } catch (e) {
    console.log(`  ${c.name}: ${(e.shortMessage || e.message).slice(0, 60)}\n`);
  }
}
