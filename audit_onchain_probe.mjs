/**
 * Probe on-chain READ-ONLY (gratis): apakah alamat tujuan Buy/Sell/Swap benar-benar
 * bisa menerima native transfer, dan apakah kontrak yang diklaim LIVE memang ada.
 * Hanya getCode + estimateGas (eth_call). Tidak ada transaksi dikirim.
 */
import { ethers } from "ethers";

const FROM = "0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D";

const CHAINS = {
  "0G (16661)": {
    rpc: "https://evmrpc.0g.ai",
    addrs: {
      "SovereignHook <- tujuan Buy/Sell": "0x592c697aD1Fa712c6701C90991B96264aB2E98d8",
      "TrinityFactory (0G)": "0xe8E9Cf43f88D065892c35c4aDa002C7B8b11F3e0",
      "AEGIS token": "0xb5A8A26A929e8E44E18D00a73448d4e1a22D0dEd",
      "Governor (0G)": "0x5045b117dDF788078c535f37837fDB6384da034d",
    },
  },
  "Arbitrum (42161)": {
    rpc: "https://arb1.arbitrum.io/rpc",
    addrs: {
      "QNOVA poolAddress <- tujuan swap": "0x2674654D4a8B79f84c1daC4Cf254EA066e59bC56",
      "CSENT poolAddress <- tujuan swap": "0xbC72FE919F85E679e7d95e2b471AaDA3c7c3Ac39",
      "Governor (Arbitrum)": "0x33811F9c53da5071A130F18D844f64999dBD43bA",
    },
  },
  "Base (8453)": {
    rpc: "https://mainnet.base.org",
    addrs: {
      "Base factory (diklaim Live On-Chain)": "0x8e63e117E71A80Cfc10fDF375F079e2e29cd7D7D",
      "Base hook (diklaim Live On-Chain)": "0xb264D861264B0e4f8fb98A61B7694BA8a3B6BBe3",
    },
  },
  "Monad (143)": {
    rpc: "https://rpc.monad.xyz",
    addrs: {
      "Monad factory (diklaim Live On-Chain)": "0x8e63e117E71A80Cfc10fDF375F079e2e29cd7D7D",
      "Monad hook (diklaim Live On-Chain)": "0xb264D861264B0e4f8fb98A61B7694BA8a3B6BBe3",
    },
  },
};

for (const [name, cfg] of Object.entries(CHAINS)) {
  let provider;
  try {
    provider = new ethers.JsonRpcProvider(cfg.rpc);
    const bn = await provider.getBlockNumber();
    const net = await provider.getNetwork();
    console.log(`\n[${name}] rpc ok, chainId=${net.chainId}, blok=${bn}`);
  } catch (e) {
    console.log(`\n[${name}] RPC GAGAL: ${(e.shortMessage || e.message).slice(0, 120)}`);
    continue;
  }
  for (const [label, addr] of Object.entries(cfg.addrs)) {
    let code = "0x";
    try { code = await provider.getCode(addr); } catch { /* ignore */ }
    const hasCode = code && code !== "0x";
    let est = "-";
    if (hasCode) {
      try {
        const g = await provider.estimateGas({ from: FROM, to: addr, value: ethers.parseEther("0.0001") });
        est = `BISA (gas=${g})`;
      } catch (e) {
        est = `REVERT: ${(e.shortMessage || e.info?.error?.message || e.message || "").slice(0, 80)}`;
      }
    }
    console.log(`  ${label.padEnd(38)} code=${hasCode ? `ADA (${(code.length - 2) / 2}B)` : "TIDAK ADA KONTRAK"}   terima-native: ${est}`);
  }
}

const sel = ethers.id("deployTrinityProject(string,string,uint256,address,uint256,uint256,bytes32)").slice(0, 10);
console.log(`\nselector deployTrinityProject(...) yang dikirim /studio = ${sel}`);
for (const [name, addr, rpc] of [
  ["0G factory", "0xe8E9Cf43f88D065892c35c4aDa002C7B8b11F3e0", "https://evmrpc.0g.ai"],
  ["Arbitrum factory", "0x2674654D4a8B79f84c1daC4Cf254EA066e59bC56", "https://arb1.arbitrum.io/rpc"],
]) {
  try {
    const p = new ethers.JsonRpcProvider(rpc);
    const code = await p.getCode(addr);
    console.log(`  ${name}: selector ada di bytecode = ${code.includes(sel.slice(2))}`);
  } catch (e) {
    console.log(`  ${name}: gagal cek (${(e.shortMessage || e.message).slice(0, 60)})`);
  }
}
