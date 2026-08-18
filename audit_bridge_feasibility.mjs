/**
 * Apakah token omnichain sungguhan (satu supply, bisa dipindah antar chain)
 * mungkin dibuat di 0G + Arbitrum + Base + Monad?
 *
 * Untuk itu dibutuhkan lapisan pesan lintas-chain yang hidup di KEEMPAT chain.
 * Skrip ini memeriksa keberadaan bytecode endpoint LayerZero V2 dan router CCIP
 * di alamat kanoniknya. Read-only, tanpa transaksi.
 */
import { ethers } from "ethers";

const CHAINS = [
  { name: "0G Mainnet", id: 16661, rpc: "https://evmrpc.0g.ai" },
  { name: "Arbitrum One", id: 42161, rpc: "https://arb1.arbitrum.io/rpc" },
  { name: "Base Mainnet", id: 8453, rpc: "https://mainnet.base.org" },
  { name: "Monad Mainnet", id: 143, rpc: "https://rpc.monad.xyz" },
];

// Alamat kanonik yang sama di banyak chain EVM.
const PROBES = [
  { label: "LayerZero V2 EndpointV2", address: "0x1a44076050125825900e736c501f859c50fE728c" },
  { label: "LayerZero V1 Endpoint", address: "0x3c2269811836af69497E5F486A85D7316753cf62" },
  // Router CCIP berbeda per chain; ini alamat resmi yang diketahui.
  { label: "CCIP Router (Arbitrum)", address: "0x141fa059441E0ca23ce184B6A78bafD2A517DdE8", onlyChain: 42161 },
  { label: "CCIP Router (Base)", address: "0x881e3A65B4d4a04dD529061dd0071cf975F58bCD", onlyChain: 8453 },
];

const results = {};

for (const c of CHAINS) {
  console.log(`\n[${c.name} · ${c.id}]`);
  results[c.id] = { name: c.name, lz: false, ccip: false };
  let provider;
  try {
    provider = new ethers.JsonRpcProvider(c.rpc);
    await provider.getBlockNumber();
  } catch (e) {
    console.log(`  RPC gagal: ${(e.shortMessage || e.message || "").slice(0, 60)}`);
    continue;
  }

  for (const p of PROBES) {
    if (p.onlyChain && p.onlyChain !== c.id) continue;
    let code = "0x";
    try {
      code = await provider.getCode(p.address);
    } catch {
      /* ignore */
    }
    const has = code && code !== "0x";
    console.log(`  ${has ? "ADA      " : "tidak ada"} ${p.label.padEnd(26)} ${p.address}${has ? `  (${(code.length - 2) / 2}B)` : ""}`);
    if (has && p.label.startsWith("LayerZero")) results[c.id].lz = true;
    if (has && p.label.startsWith("CCIP")) results[c.id].ccip = true;
  }
}

console.log(`\n${"═".repeat(72)}\nKESIMPULAN KELAYAKAN\n${"═".repeat(72)}`);
const rows = Object.values(results);
const lzAll = rows.every((r) => r.lz);
const lzSome = rows.filter((r) => r.lz).map((r) => r.name);
const lzNone = rows.filter((r) => !r.lz).map((r) => r.name);

console.log(`  LayerZero tersedia di : ${lzSome.length ? lzSome.join(", ") : "tidak ada"}`);
console.log(`  LayerZero TIDAK ada di: ${lzNone.length ? lzNone.join(", ") : "-"}`);
console.log(
  `\n  Token omnichain ber-supply tunggal lintas KEEMPAT chain: ${lzAll ? "MUNGKIN via LayerZero OFT" : "BELUM MUNGKIN dengan LayerZero"}`
);
if (!lzAll) {
  console.log(
    `  Alasan: burn-and-mint butuh endpoint di setiap chain. Chain tanpa endpoint\n` +
      `  tidak bisa ikut dalam supply bersama, jadi harus dikeluarkan atau memakai\n` +
      `  bridge kustom yang harus diaudit sendiri.`
  );
}
