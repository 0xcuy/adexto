/**
 * Verifikasi fungsional endpoint LayerZero, bukan cuma "ada bytecode".
 *
 * V1 Endpoint  -> chainId() returns (uint16)
 * V2 EndpointV2 -> eid() returns (uint32)
 *
 * Kalau alamatnya berisi kontrak lain (proxy kosong, dsb), pemanggilan ini gagal.
 */
import { ethers } from "ethers";

const CHAINS = [
  { name: "0G Mainnet", id: 16661, rpc: "https://evmrpc.0g.ai" },
  { name: "Arbitrum One", id: 42161, rpc: "https://arb1.arbitrum.io/rpc" },
  { name: "Base Mainnet", id: 8453, rpc: "https://mainnet.base.org" },
  { name: "Monad Mainnet", id: 143, rpc: "https://rpc.monad.xyz" },
];

const V1 = "0x3c2269811836af69497E5F486A85D7316753cf62";
const V2 = "0x1a44076050125825900e736c501f859c50fE728c";

const V1_ABI = ["function chainId() view returns (uint16)"];
const V2_ABI = ["function eid() view returns (uint32)"];

const verdict = {};

for (const c of CHAINS) {
  console.log(`\n[${c.name} · ${c.id}]`);
  verdict[c.id] = { name: c.name, v1: false, v2: false };
  let provider;
  try {
    provider = new ethers.JsonRpcProvider(c.rpc);
    await provider.getBlockNumber();
  } catch (e) {
    console.log(`  RPC gagal: ${(e.shortMessage || e.message || "").slice(0, 50)}`);
    continue;
  }

  for (const [label, addr, abi, fn] of [
    ["LayerZero V1", V1, V1_ABI, "chainId"],
    ["LayerZero V2", V2, V2_ABI, "eid"],
  ]) {
    const code = await provider.getCode(addr).catch(() => "0x");
    if (!code || code === "0x") {
      console.log(`  ${label}: tidak ada kontrak`);
      continue;
    }
    try {
      const contract = new ethers.Contract(addr, abi, provider);
      const value = await contract[fn]();
      console.log(`  ${label}: BERFUNGSI — ${fn}() = ${value}  (${(code.length - 2) / 2}B)`);
      if (label.endsWith("V1")) verdict[c.id].v1 = true;
      else verdict[c.id].v2 = true;
    } catch (e) {
      console.log(
        `  ${label}: ada ${(code.length - 2) / 2}B tapi ${fn}() GAGAL -> bukan endpoint sungguhan` +
          ` (${(e.shortMessage || e.message || "").slice(0, 45)})`
      );
    }
  }
}

console.log(`\n${"═".repeat(74)}\nKESIMPULAN\n${"═".repeat(74)}`);
const rows = Object.values(verdict);
for (const r of rows) {
  const usable = r.v1 || r.v2;
  console.log(`  ${r.name.padEnd(16)} ${usable ? `bisa dipakai (${r.v2 ? "V2" : "V1"})` : "TIDAK ada endpoint yang berfungsi"}`);
}
const all = rows.every((r) => r.v1 || r.v2);
const missing = rows.filter((r) => !(r.v1 || r.v2)).map((r) => r.name);
console.log(
  `\n  Token satu-supply lintas keempat chain via LayerZero: ${all ? "MUNGKIN" : "TIDAK MUNGKIN sekarang"}`
);
if (!all) console.log(`  Terhalang di: ${missing.join(", ")}`);
