/**
 * Pemeriksaan read-only: integrasi mana yang benar-benar ada di mainnet?
 *
 * Dibuat untuk menjawab "Uniswap dan CCIP aktif atau tidak?" dengan bukti, bukan
 * ingatan. Murni `eth_getCode`, jadi tanpa biaya sama sekali. (World ID dulu ikut
 * ditanyakan di sini; ia tidak pernah punya kontrak untuk diperiksa, dan sekarang
 * integrasinya dicabut sepenuhnya.)
 *
 * Pakai: node --experimental-strip-types scripts/check-integrations-live.mjs
 *
 * Catatan: ADA-nya bytecode hanya membuktikan kontraknya ter-deploy. Itu TIDAK
 * membuktikan jalurnya bisa dipakai — CCIP receiver ada di keempat chain, tapi
 * lane-nya tetap mati karena Chainlink tidak menerbitkan router untuk 0G/Monad.
 */
import { ethers } from "ethers";
import { ADEXTO_CONTRACTS } from "../src/config/contracts.ts";

const CHAINS = [
  { key: "0G", rpc: "https://evmrpc.0g.ai", c: ADEXTO_CONTRACTS.og },
  { key: "Arbitrum", rpc: "https://arb1.arbitrum.io/rpc", c: ADEXTO_CONTRACTS.arbitrum },
  { key: "Base", rpc: "https://mainnet.base.org", c: ADEXTO_CONTRACTS.base },
  { key: "Monad", rpc: "https://rpc.monad.xyz", c: ADEXTO_CONTRACTS.monad },
];

/** RPC 0G kadang timeout sekali lalu normal, jadi pembacaan diulang. */
async function codeOf(provider, addr, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      return (await provider.getCode(addr)).length / 2 - 1;
    } catch (err) {
      if (i === tries - 1) throw err;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

for (const { key, rpc, c } of CHAINS) {
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
  for (const [name, addr] of [
    ["governor", c.governorAddress],
    ["ccipReceiver", c.ccipReceiverAddress],
    ["sovereignHook", c.sovereignHookAddress],
    ["curveFactory", c.curveFactoryAddress],
  ]) {
    if (!addr) {
      console.log(`${key.padEnd(9)} ${name.padEnd(14)} ${"-".padEnd(42)}  TIDAK DISET`);
      continue;
    }
    try {
      const bytes = await codeOf(provider, addr);
      console.log(`${key.padEnd(9)} ${name.padEnd(14)} ${addr}  ${bytes > 0 ? `ADA (${bytes} byte)` : "TIDAK ADA (0 byte)"}`);
    } catch (err) {
      console.log(`${key.padEnd(9)} ${name.padEnd(14)} ${addr}  GAGAL BACA: ${String(err.message).slice(0, 45)}`);
    }
  }
}
