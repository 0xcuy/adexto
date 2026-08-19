/**
 * Pemeriksaan read-only: apakah kontrak Governor benar-benar ada di keempat
 * mainnet?
 *
 * Halaman /governance memasang badge "LIVE" dan judul "4 Chains Live", sementara
 * runbook hanya mencatat Governor di 0G dan Arbitrum. Salah satu dari keduanya
 * pasti keliru, dan itu bisa diselesaikan dengan `eth_getCode` — tanpa biaya
 * apa pun karena murni pembacaan.
 */
import { ethers } from "ethers";
import { ADEXTO_CONTRACTS } from "../src/config/contracts.ts";

const TARGETS = [
  { key: "0G", chainId: 16661, rpc: "https://evmrpc.0g.ai", addr: ADEXTO_CONTRACTS.og.governorAddress },
  { key: "Arbitrum", chainId: 42161, rpc: "https://arb1.arbitrum.io/rpc", addr: ADEXTO_CONTRACTS.arbitrum.governorAddress },
  { key: "Base", chainId: 8453, rpc: "https://mainnet.base.org", addr: ADEXTO_CONTRACTS.base.governorAddress },
  { key: "Monad", chainId: 143, rpc: "https://rpc.monad.xyz", addr: ADEXTO_CONTRACTS.monad.governorAddress },
];

for (const t of TARGETS) {
  try {
    const provider = new ethers.JsonRpcProvider(t.rpc, undefined, { staticNetwork: true });
    const code = await provider.getCode(t.addr);
    const bytes = (code.length - 2) / 2;
    console.log(`${t.key.padEnd(9)} ${t.addr}  ${bytes > 0 ? `ADA (${bytes} byte)` : "TIDAK ADA (0 byte)"}`);
  } catch (err) {
    console.log(`${t.key.padEnd(9)} ${t.addr}  GAGAL BACA: ${String(err.message).slice(0, 70)}`);
  }
}
