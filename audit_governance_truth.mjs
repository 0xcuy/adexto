/**
 * Apa yang SEBENARNYA ada di keempat Governor yang sudah ter-deploy.
 *
 * KENAPA SKRIP INI MASIH ADA SETELAH HALAMANNYA DIHAPUS
 *
 * Ia ditulis untuk memperbaiki /governance, yang dulu menampilkan tiga proposal
 * (AIP-01..03) beserta hasil voting dan sebuah "Your Voting Power" bersatuan ADAI —
 * semuanya array konstan di berkas komponen, bukan bacaan chain. Halaman itu sekarang
 * DICABUT seluruhnya, bukan diperbaiki: governance tidak bisa dibuat berfungsi di
 * desain ini tanpa menambah permukaan admin yang justru dijanjikan tidak ada.
 *
 * Tapi README masih membuat klaim spesifik tentang keempat kontrak itu — governanceToken
 * alamat nol di Base dan Monad, menunjuk hook v1 tanpa `balanceOf` di 0G dan Arbitrum,
 * `proposalCount` nol di keempatnya, threshold dan quorum bersatuan ADAI yang tidak
 * pernah ada. Skrip inilah buktinya. Klaim tanpa cara memeriksanya adalah klaim yang
 * akan basi tanpa ada yang tahu.
 *
 * Read-only, nol biaya.
 */
import { ethers } from "ethers";

const GOVERNORS = [
  { key: "0G", chainId: 16661, rpc: "https://evmrpc.0g.ai", addr: "0x5045b117dDF788078c535f37837fDB6384da034d" },
  { key: "Arbitrum", chainId: 42161, rpc: "https://arb1.arbitrum.io/rpc", addr: "0x33811F9c53da5071A130F18D844f64999dBD43bA" },
  { key: "Base", chainId: 8453, rpc: "https://mainnet.base.org", addr: "0x01b250a2db25561dB185f4628B93C72048D8bc1B" },
  { key: "Monad", chainId: 143, rpc: "https://rpc.monad.xyz", addr: "0x01b250a2db25561dB185f4628B93C72048D8bc1B" },
];

const ABI = [
  "function proposalCount() view returns (uint256)",
  "function governanceToken() view returns (address)",
  "function PROPOSAL_THRESHOLD() view returns (uint256)",
  "function QUORUM_VOTES() view returns (uint256)",
];
const ERC20 = [
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function totalSupply() view returns (uint256)",
];

for (const g of GOVERNORS) {
  console.log(`\n${g.key} (${g.chainId})  governor ${g.addr}`);
  try {
    const provider = new ethers.JsonRpcProvider(g.rpc, undefined, { staticNetwork: true });
    const code = await provider.getCode(g.addr);
    console.log(`  bytecode        : ${code === "0x" ? "TIDAK ADA KONTRAK" : `${(code.length - 2) / 2} byte`}`);
    if (code === "0x") continue;

    const gov = new ethers.Contract(g.addr, ABI, provider);
    const count = await gov.proposalCount().catch((e) => `gagal dibaca (${e.shortMessage ?? e.message})`);
    console.log(`  proposalCount   : ${count}`);

    const token = await gov.governanceToken().catch((e) => `gagal dibaca (${e.shortMessage ?? e.message})`);
    console.log(`  governanceToken : ${token}`);

    if (typeof token === "string" && ethers.isAddress(token)) {
      const tcode = await provider.getCode(token);
      if (tcode === "0x") {
        console.log(`  token bytecode  : TIDAK ADA KONTRAK di alamat itu`);
      } else {
        const erc = new ethers.Contract(token, ERC20, provider);
        const [sym, nm, sup] = await Promise.all([
          erc.symbol().catch(() => "?"),
          erc.name().catch(() => "?"),
          erc.totalSupply().catch(() => 0n),
        ]);
        console.log(`  token           : ${nm} (${sym}) supply ${ethers.formatEther(sup)}`);
      }
    }
  } catch (e) {
    console.log(`  GAGAL: ${e.shortMessage ?? e.message}`);
  }
}
