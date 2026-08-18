/**
 * READ-ONLY: kenapa alamat yang "sudah terdaftar" tetap perlu deploy baru.
 *
 * Membandingkan bytecode yang BENAR-BENAR ada di alamat v1 dengan selector fungsi
 * yang dibutuhkan untuk trading, lalu memeriksa apakah ada jalur upgrade (proxy).
 * Hanya eth_getCode + eth_getStorageAt. Tidak ada transaksi, tidak ada gas.
 */
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";

const sel = (sig) => ethers.id(sig).slice(2, 10);

const REQUIRED_FOR_TRADING = {
  "buy(uint256,address,uint256)": sel("buy(uint256,address,uint256)"),
  "sell(uint256,uint256,address,uint256)": sel("sell(uint256,uint256,address,uint256)"),
  "getBuyQuote(uint256)": sel("getBuyQuote(uint256)"),
  "getSellQuote(uint256)": sel("getSellQuote(uint256)"),
  "initializePool(uint256)": sel("initializePool(uint256)"),
  "getReserves()": sel("getReserves()"),
};

const V1_ONLY = {
  "afterSwap(...)": sel("afterSwap(address,(address,address,uint24,int24,address),int128,int128,bytes)"),
  "executeScheduledBurn(uint256)": sel("executeScheduledBurn(uint256)"),
};

const FACTORY_SIGS = {
  "v1 deployTrinityProject (7 arg)": sel("deployTrinityProject(string,string,uint256,address,uint256,uint256,bytes32)"),
  "v2 deployTrinityProject (8 arg)": sel(
    "deployTrinityProject(string,string,uint256,address,uint256,uint256,bytes32,uint256)"
  ),
};

// EIP-1967 implementation slot: keccak256("eip1967.proxy.implementation") - 1
const EIP1967_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const TARGETS = [
  { chain: "0G Mainnet", chainId: 16661, rpc: "https://evmrpc.0g.ai", label: "SovereignHook v1", address: "0x592c697aD1Fa712c6701C90991B96264aB2E98d8" },
  { chain: "0G Mainnet", chainId: 16661, rpc: "https://evmrpc.0g.ai", label: "TrinityFactory v1", address: "0xe8E9Cf43f88D065892c35c4aDa002C7B8b11F3e0" },
  { chain: "Arbitrum One", chainId: 42161, rpc: "https://arb1.arbitrum.io/rpc", label: "SovereignHook v1", address: "0xbC72FE919F85E679e7d95e2b471AaDA3c7c3Ac39" },
  { chain: "Base Mainnet", chainId: 8453, rpc: "https://mainnet.base.org", label: "SovereignHook v1", address: "0xb264D861264B0e4f8fb98A61B7694BA8a3B6BBe3" },
  { chain: "Monad Mainnet", chainId: 143, rpc: "https://rpc.monad.xyz", label: "SovereignHook v1", address: "0xb264D861264B0e4f8fb98A61B7694BA8a3B6BBe3" },
];

const artifact = (name) =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), "build", "artifacts", `${name}.json`), "utf8"));

console.log("PEMBANDINGAN BYTECODE ON-CHAIN vs KEBUTUHAN TRADING (read-only)\n");

for (const t of TARGETS) {
  let code = "0x";
  try {
    const provider = new ethers.JsonRpcProvider(t.rpc);
    code = await provider.getCode(t.address);
  } catch (e) {
    console.log(`[${t.chain}] ${t.label} — RPC gagal: ${(e.shortMessage || e.message).slice(0, 60)}\n`);
    continue;
  }

  const bytes = (code.length - 2) / 2;
  console.log(`[${t.chain} · ${t.chainId}] ${t.label}`);
  console.log(`  ${t.address}`);
  console.log(`  bytecode: ${bytes} byte  keccak=${ethers.keccak256(code).slice(0, 18)}…`);

  if (t.label.includes("Hook")) {
    const missing = [];
    for (const [sig, s] of Object.entries(REQUIRED_FOR_TRADING)) {
      const present = code.includes(s);
      console.log(`    ${present ? "ADA        " : "TIDAK ADA  "} ${sig}`);
      if (!present) missing.push(sig);
    }
    for (const [sig, s] of Object.entries(V1_ONLY)) {
      console.log(`    ${code.includes(s) ? "ADA        " : "TIDAK ADA  "} ${sig}   (fungsi v1)`);
    }
    console.log(
      `  => ${missing.length === 0 ? "bisa trading" : `${missing.length}/${Object.keys(REQUIRED_FOR_TRADING).length} fungsi trading TIDAK ADA di bytecode`}`
    );
  } else {
    for (const [sig, s] of Object.entries(FACTORY_SIGS)) {
      console.log(`    ${code.includes(s) ? "ADA        " : "TIDAK ADA  "} ${sig}`);
    }
  }

  // Jalur upgrade?
  const hasDelegatecall = /f4/.test(code.slice(2).match(/.{2}/g)?.join("") ?? "") && code.includes("f4");
  let implSlot = "0x0";
  try {
    const provider = new ethers.JsonRpcProvider(t.rpc);
    implSlot = await provider.getStorage(t.address, EIP1967_SLOT);
  } catch {
    // abaikan
  }
  const isProxy = implSlot !== "0x" + "0".repeat(64) && implSlot !== "0x0";
  console.log(`  proxy EIP-1967? ${isProxy ? `YA -> impl ${implSlot}` : "TIDAK (slot implementation kosong)"}`);
  console.log(`  => ${isProxy ? "bisa di-upgrade tanpa alamat baru" : "TIDAK ADA jalur upgrade: bytecode permanen"}\n`);
}

console.log("BYTECODE v2 YANG SUDAH DIKOMPILASI DI REPO\n");
for (const name of ["SovereignHook", "AdextoTrinityFactoryV2"]) {
  try {
    const a = artifact(name);
    const deployed = a.deployedBytecode ?? "0x";
    console.log(`  ${name}`);
    console.log(`    runtime bytecode: ${(deployed.length - 2) / 2} byte  keccak=${ethers.keccak256(deployed).slice(0, 18)}…`);
    const which = name === "SovereignHook" ? REQUIRED_FOR_TRADING : FACTORY_SIGS;
    for (const [sig, s] of Object.entries(which)) {
      console.log(`    ${deployed.includes(s) ? "ADA        " : "TIDAK ADA  "} ${sig}`);
    }
  } catch {
    console.log(`  ${name}: artefak belum dikompilasi (jalankan scripts/compile-contracts.mjs --via-ir)`);
  }
  console.log();
}
