/**
 * Kenapa Monad gagal di peluncuran 4-chain tapi sukses saat sendiri?
 * Probe staticCall langsung ke keempat factory dengan argumen identik.
 * Read-only, tanpa transaksi.
 */
import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const PK = process.env.OG_PRIVATE_KEY || process.env.PRIVATE_KEY;
const ACCOUNT = new ethers.Wallet(PK).address;

const TARGETS = [
  { name: "0G Testnet", id: 16602, rpc: "https://evmrpc-testnet.0g.ai", factory: "0x6394E3820d62a9Ab901128bEf5A04860b71A535c", sym: "0G" },
  { name: "Arbitrum Sepolia", id: 421614, rpc: "https://sepolia-rollup.arbitrum.io/rpc", factory: "0x75EeDEd196D2BE283d815D52F617eB70bCe865bC", sym: "ETH" },
  { name: "Base Sepolia", id: 84532, rpc: "https://sepolia.base.org", factory: "0x5A2F13f1eFB86bD1e1814A5212690A2B765c85C8", sym: "ETH" },
  { name: "Monad Testnet", id: 10143, rpc: "https://testnet-rpc.monad.xyz", factory: "0x33811F9c53da5071A130F18D844f64999dBD43bA", sym: "MON" },
];

const ABI = [
  "function deployTrinityProject(string name, string symbol, uint256 initialSupply, address agentIdentity, uint256 swapFeeBps, uint256 treasuryShareBps, bytes32 teeAttestationRoot, uint256 poolTokenBps) payable returns (address token, address pool)",
  "function isSymbolAvailable(string symbol) view returns (bool)",
  "function totalProjectsCount() view returns (uint256)",
];

const SEEDS = ["0.0005", "0.01", "0.5"];
const TICKER = `PROBE${Math.floor(Math.random() * 900 + 100)}`;

for (const t of TARGETS) {
  console.log(`\n[${t.name} · ${t.id}]  factory ${t.factory}`);
  try {
    const provider = new ethers.JsonRpcProvider(t.rpc);
    const wallet = new ethers.Wallet(PK, provider);
    const factory = new ethers.Contract(t.factory, ABI, wallet);

    const [bal, code, count, feeData, block] = await Promise.all([
      provider.getBalance(ACCOUNT),
      provider.getCode(t.factory),
      factory.totalProjectsCount().catch(() => "n/a"),
      provider.getFeeData(),
      provider.getBlock("latest"),
    ]);
    console.log(`  saldo=${ethers.formatEther(bal)} ${t.sym}  factoryCode=${(code.length - 2) / 2}B  projects=${count}`);
    console.log(`  gasPrice=${ethers.formatUnits(feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n, "gwei")} gwei  blockGasLimit=${block?.gasLimit}`);
    console.log(`  isSymbolAvailable(${TICKER})=${await factory.isSymbolAvailable(TICKER).catch(() => "err")}`);

    for (const seed of SEEDS) {
      const value = ethers.parseEther(seed);
      const args = [
        "Probe Launch",
        TICKER,
        1_000_000_000n,
        ACCOUNT,
        30,
        10,
        ethers.keccak256(ethers.toUtf8Bytes(TICKER)),
        8000,
      ];
      let staticResult = "";
      try {
        const r = await factory.deployTrinityProject.staticCall(...args, { value });
        staticResult = `OK token=${r[0].slice(0, 12)}… pool=${r[1].slice(0, 12)}…`;
      } catch (e) {
        staticResult = `REVERT: ${(e.shortMessage || e.info?.error?.message || e.message || "").slice(0, 110)}`;
      }

      let gasResult = "";
      try {
        const g = await factory.deployTrinityProject.estimateGas(...args, { value });
        gasResult = `gas=${g}`;
      } catch (e) {
        gasResult = `estimateGas gagal: ${(e.shortMessage || e.info?.error?.message || e.message || "").slice(0, 80)}`;
      }

      console.log(`  seed ${seed.padEnd(7)} -> staticCall ${staticResult}`);
      console.log(`                    ${gasResult}`);
    }
  } catch (e) {
    console.log(`  RPC gagal: ${(e.shortMessage || e.message || "").slice(0, 90)}`);
  }
}
