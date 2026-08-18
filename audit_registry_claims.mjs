/**
 * Memverifikasi klaim "Live On-Chain" pada daftar kontrak, satu per satu.
 *
 * Yang diperiksa untuk setiap alamat:
 *   1. apakah ada bytecode di sana (deployed?)
 *   2. untuk receiver CCIP: apa yang dikembalikan `router()`, dan apakah alamat
 *      router itu sendiri punya bytecode
 *
 * Poin pentingnya: kontrak receiver yang ter-deploy TIDAK sama dengan CCIP yang
 * berfungsi. Receiver hanya menunggu pesan; supaya ada pesan, Chainlink harus
 * punya Router di kedua chain dan lane-nya harus diaktifkan.
 */
import { ethers } from "ethers";

const CHAINS = {
  og: { name: "0G Mainnet", chainId: 16661, rpc: "https://evmrpc.0g.ai" },
  arbitrum: { name: "Arbitrum One", chainId: 42161, rpc: "https://arb1.arbitrum.io/rpc" },
  base: { name: "Base Mainnet", chainId: 8453, rpc: "https://mainnet.base.org" },
  monad: { name: "Monad Mainnet", chainId: 143, rpc: "https://rpc.monad.xyz" },
};

/** Alamat sesuai daftar yang dipublikasikan. */
const CLAIMS = {
  og: [
    ["AdextoTrinityFactory", "0xe8E9Cf43f88D065892c35c4aDa002C7B8b11F3e0"],
    ["SovereignHook", "0x592c697aD1Fa712c6701C90991B96264aB2E98d8"],
    ["AdextoGovernor", "0x5045b117dDF788078c535f37837fDB6384da034d"],
    ["AdextoCCIPReceiver", "0xaD0C7BFF5aDfeb01C3DaF2bF8C85414FE4D47Ab4"],
  ],
  arbitrum: [
    ["AdextoTrinityFactory", "0x2674654D4a8B79f84c1daC4Cf254EA066e59bC56"],
    ["SovereignHook", "0xbC72FE919F85E679e7d95e2b471AaDA3c7c3Ac39"],
    ["AdextoGovernor", "0x33811F9c53da5071A130F18D844f64999dBD43bA"],
    ["AdextoCCIPReceiver", "0x5800e9715a47a598fce9bc3B65a95FD6BeBf76A3"],
  ],
};

/** Router CCIP resmi Chainlink, untuk pembanding. */
const OFFICIAL_ROUTER = {
  arbitrum: "0x141fa059441E0ca23ce184B6A78bafD2A517DdE8",
  base: "0x881e3A65B4d4a04dD529061dd0071cf975F58bCD",
};

const ABI = [
  "function router() view returns (address)",
  "function getRouter() view returns (address)",
  "function owner() view returns (address)",
];

const provider = (c) => {
  const req = new ethers.FetchRequest(c.rpc);
  req.timeout = 45000;
  return new ethers.JsonRpcProvider(req, c.chainId, { staticNetwork: true });
};

for (const [key, list] of Object.entries(CLAIMS)) {
  const c = CHAINS[key];
  console.log(`\n${"=".repeat(74)}\n${c.name} (${c.chainId})\n${"=".repeat(74)}`);
  let p;
  try {
    p = provider(c);
    await p.getBlockNumber();
  } catch (e) {
    console.log(`  RPC tidak menjawab: ${(e.shortMessage || e.message).slice(0, 60)}`);
    continue;
  }

  for (const [label, addr] of list) {
    let code = "0x";
    try {
      code = await p.getCode(addr);
    } catch (e) {
      console.log(`  ${label.padEnd(22)} GAGAL dibaca`);
      continue;
    }
    const size = (code.length - 2) / 2;
    const deployed = code !== "0x";
    console.log(`  ${label.padEnd(22)} ${deployed ? `ADA (${size} byte)` : "TIDAK ADA KONTRAK"}  ${addr}`);

    if (deployed && /CCIP/i.test(label)) {
      let routerAddr = null;
      for (const fn of ["router", "getRouter"]) {
        try {
          const ct = new ethers.Contract(addr, ABI, p);
          routerAddr = await ct[fn]();
          break;
        } catch {
          /* coba nama berikutnya */
        }
      }
      if (!routerAddr) {
        console.log(`  ${"".padEnd(22)}   -> tidak punya router()/getRouter() yang bisa dibaca`);
        continue;
      }
      const routerCode = await p.getCode(routerAddr).catch(() => "0x");
      const routerIsContract = routerCode !== "0x";
      console.log(`  ${"".padEnd(22)}   -> router() = ${routerAddr}`);
      console.log(
        `  ${"".padEnd(22)}      ${
          routerIsContract ? `ADA kontrak (${(routerCode.length - 2) / 2} byte)` : "BUKAN KONTRAK — tidak ada bytecode"
        }`
      );
      if (OFFICIAL_ROUTER[key]) {
        const match = routerAddr.toLowerCase() === OFFICIAL_ROUTER[key].toLowerCase();
        console.log(
          `  ${"".padEnd(22)}      ${match ? "COCOK" : "TIDAK COCOK"} dengan router resmi Chainlink ${OFFICIAL_ROUTER[key]}`
        );
      } else {
        console.log(`  ${"".padEnd(22)}      Chainlink tidak menerbitkan router CCIP untuk chain ini`);
      }
    }
  }
}

console.log(`\n${"=".repeat(74)}\nAPAKAH CHAINLINK PUNYA ROUTER CCIP DI 0G & MONAD?\n${"=".repeat(74)}`);
for (const key of ["og", "monad"]) {
  const c = CHAINS[key];
  try {
    const p = provider(c);
    // Uji alamat router resmi milik chain LAIN di chain ini: kalau Chainlink
    // benar-benar hadir, biasanya ada deployment; kalau kosong, tidak ada.
    const probes = Object.values(OFFICIAL_ROUTER);
    const found = [];
    for (const r of probes) {
      const code = await p.getCode(r).catch(() => "0x");
      if (code !== "0x") found.push(r);
    }
    console.log(
      `  ${c.name.padEnd(14)} ${
        found.length ? `ada bytecode di ${found.join(", ")}` : "tidak ada deployment Chainlink pada alamat router yang dikenal"
      }`
    );
  } catch {
    console.log(`  ${c.name.padEnd(14)} RPC tidak menjawab`);
  }
}
