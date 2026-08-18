/**
 * Apakah desain "bayar sekali di 0G, CCIP aktifkan 4 chain" mungkin?
 *
 * Syaratnya: ada CCIP Router resmi di 0G yang bisa mengirim ke Arbitrum, Base, Monad.
 * Skrip ini:
 *   1. membaca alamat router yang dipakai kontrak CCIP ADEXTO yang sudah ter-deploy
 *   2. menguji apakah alamat itu benar-benar CCIP Router (isChainSupported / getFee)
 *   3. menguji router CCIP resmi yang diketahui di setiap chain
 *
 * Read-only, tanpa transaksi.
 */
import { ethers } from "ethers";

const DEPLOYED = [
  { name: "0G Mainnet", id: 16661, rpc: "https://evmrpc.0g.ai", ccipReceiver: "0xaD0C7BFF5aDfeb01C3DaF2bF8C85414FE4D47Ab4" },
  { name: "Arbitrum One", id: 42161, rpc: "https://arb1.arbitrum.io/rpc", ccipReceiver: "0x5800e9715a47a598fce9bc3B65a95FD6BeBf76A3" },
  { name: "Base Mainnet", id: 8453, rpc: "https://mainnet.base.org", ccipReceiver: "0x1eE8701Dd8CD8C456E71ef74bd3Dbf0b377B6D8d" },
  { name: "Monad Mainnet", id: 143, rpc: "https://rpc.monad.xyz", ccipReceiver: "0x1eE8701Dd8CD8C456E71ef74bd3Dbf0b377B6D8d" },
];

// Router CCIP resmi Chainlink (yang diketahui publik).
const OFFICIAL_ROUTERS = {
  42161: "0x141fa059441E0ca23ce184B6A78bafD2A517DdE8",
  8453: "0x881e3A65B4d4a04dD529061dd0071cf975F58bCD",
  1: "0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D",
};

const RECEIVER_ABI = ["function router() view returns (address)", "function targetHook() view returns (address)"];
const ROUTER_ABI = [
  "function isChainSupported(uint64 chainSelector) view returns (bool)",
  "function getSupportedTokens(uint64 chainSelector) view returns (address[])",
  "function typeAndVersion() view returns (string)",
];

const SELECTORS = {
  "0G": null, // tidak ada selector CCIP resmi yang diketahui untuk 0G
  Arbitrum: 4949039107694359620n,
  Base: 15971525489660198786n,
  Monad: null,
};

console.log("1) ROUTER APA YANG DIPAKAI KONTRAK CCIP ADEXTO YANG SUDAH TER-DEPLOY?\n");

for (const d of DEPLOYED) {
  let provider;
  try {
    provider = new ethers.JsonRpcProvider(d.rpc);
    await provider.getBlockNumber();
  } catch (e) {
    console.log(`[${d.name}] RPC gagal\n`);
    continue;
  }

  console.log(`[${d.name} · ${d.id}]  receiver ${d.ccipReceiver}`);
  const code = await provider.getCode(d.ccipReceiver).catch(() => "0x");
  if (!code || code === "0x") {
    console.log(`  tidak ada kontrak di alamat ini\n`);
    continue;
  }

  try {
    const receiver = new ethers.Contract(d.ccipReceiver, RECEIVER_ABI, provider);
    const routerAddr = await receiver.router();
    console.log(`  router() = ${routerAddr}`);

    if (routerAddr === ethers.ZeroAddress) {
      console.log(`  => router DISETEL KE ALAMAT NOL: kontrak ini tidak pernah bisa menerima pesan CCIP\n`);
      continue;
    }

    const routerCode = await provider.getCode(routerAddr).catch(() => "0x");
    if (!routerCode || routerCode === "0x") {
      console.log(`  => TIDAK ADA KONTRAK di alamat router itu: bukan CCIP router\n`);
      continue;
    }

    const router = new ethers.Contract(routerAddr, ROUTER_ABI, provider);
    try {
      const tv = await router.typeAndVersion();
      console.log(`  router.typeAndVersion() = "${tv}"  (${(routerCode.length - 2) / 2}B)`);
    } catch {
      console.log(`  router ada ${(routerCode.length - 2) / 2}B tapi typeAndVersion() gagal -> bukan CCIP Router resmi`);
    }
  } catch (e) {
    console.log(`  gagal membaca router(): ${(e.shortMessage || e.message || "").slice(0, 60)}`);
  }
  console.log();
}

console.log(`\n2) ADAKAH CCIP ROUTER RESMI DI SETIAP CHAIN?\n`);

for (const d of DEPLOYED) {
  let provider;
  try {
    provider = new ethers.JsonRpcProvider(d.rpc);
    await provider.getBlockNumber();
  } catch {
    console.log(`[${d.name}] RPC gagal`);
    continue;
  }
  const known = OFFICIAL_ROUTERS[d.id];
  if (!known) {
    console.log(`[${d.name.padEnd(14)}] Chainlink tidak mempublikasikan router CCIP untuk chain ini`);
    continue;
  }
  const code = await provider.getCode(known).catch(() => "0x");
  if (!code || code === "0x") {
    console.log(`[${d.name.padEnd(14)}] router resmi ${known} -> tidak ada kontrak`);
    continue;
  }
  try {
    const router = new ethers.Contract(known, ROUTER_ABI, provider);
    const tv = await router.typeAndVersion();
    const supports = [];
    for (const [key, sel] of Object.entries(SELECTORS)) {
      if (!sel) continue;
      try {
        if (await router.isChainSupported(sel)) supports.push(key);
      } catch {
        /* ignore */
      }
    }
    console.log(`[${d.name.padEnd(14)}] "${tv}" BERFUNGSI · bisa kirim ke: ${supports.join(", ") || "(tidak terdeteksi)"}`);
  } catch (e) {
    console.log(`[${d.name.padEnd(14)}] router ada tapi bukan CCIP: ${(e.shortMessage || e.message || "").slice(0, 45)}`);
  }
}

console.log(`\n${"═".repeat(76)}`);
console.log("Catatan: agar 0G bisa MENGIRIM pesan CCIP, Chainlink harus menjalankan");
console.log("infrastruktur CCIP (Router + Commit/Execute DON) di 0G. Itu bukan sesuatu");
console.log("yang bisa kita deploy sendiri — lane-nya harus dibuka oleh Chainlink.");
