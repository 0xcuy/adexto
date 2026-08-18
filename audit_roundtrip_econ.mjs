/**
 * Menjawab: "kalau beli sedikit pakai uang asli lalu dijual, kembalinya berapa?"
 *
 * Versi pertama skrip ini SALAH: ia memanggil getSellQuote pada state pool
 * SEBELUM pembelian, sehingga slippage terhitung dua kali dan hasilnya tampak
 * rugi 23% untuk beli 0,01. Padahal pada kurva x*y=k, membeli lalu langsung
 * menjual kembali menggerakkan harga naik lalu turun lagi; dampak harga itu
 * KEMBALI. Yang benar-benar hilang hanya fee dua sisi dan gas.
 *
 * Karena itu di sini ada dua bagian:
 *   1. PENGUKURAN NYATA — beli lalu jual sungguhan di 0G Testnet, angka apa adanya.
 *   2. Proyeksi berdasarkan rumus, yang sudah divalidasi oleh pengukuran itu.
 * Ditambah biaya gas mainnet pada harga gas saat ini.
 */
import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const PK = process.env.OG_PRIVATE_KEY || process.env.PRIVATE_KEY;
const POOL_ABI = [
  "function getReserves() view returns (uint256,uint256)",
  "function getBuyQuote(uint256) view returns (uint256,uint256,uint256)",
  "function getSellQuote(uint256) view returns (uint256,uint256,uint256)",
  "function lpFeeBps() view returns (uint16)",
  "function treasuryBuybackBps() view returns (uint16)",
  "function targetToken() view returns (address)",
  "function buy(uint256 minTokensOut, address to, uint256 deadline) payable returns (uint256)",
  "function sell(uint256 tokenAmountIn, uint256 minNativeOut, address to, uint256 deadline) returns (uint256)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

const REF = {
  rpc: "https://evmrpc-testnet.0g.ai",
  chainId: 16602,
  pool: process.env.ECON_POOL || "0xD8672f905011497083FF2b36968c7e11af95aFFd",
};
const TEST_BUY = process.env .ECON_BUY || "0.001";

const GAS_UNITS = { buy: 120000, approve: 46000, sell: 130000, launch: 2819449 };
const MAINNETS = [
  { name: "0G Mainnet", rpc: "https://evmrpc.0g.ai", chainId: 16661, sym: "0G", usd: 2.1 },
  { name: "Arbitrum One", rpc: "https://arb1.arbitrum.io/rpc", chainId: 42161, sym: "ETH", usd: 3000 },
  { name: "Base Mainnet", rpc: "https://mainnet.base.org", chainId: 8453, sym: "ETH", usd: 3000 },
  { name: "Monad Mainnet", rpc: "https://rpc.monad.xyz", chainId: 143, sym: "MON", usd: 0.05 },
];

const f = (v, d = 8) => Number(ethers.formatEther(v)).toFixed(d);
const money = (v, usd) => (usd ? `  (~$${v * usd < 0.01 ? (v * usd).toFixed(4) : (v * usd).toFixed(2)})` : "");

(async () => {
  const req = new ethers.FetchRequest(REF.rpc);
  req.timeout = 60000;
  const provider = new ethers.JsonRpcProvider(req, REF.chainId, { staticNetwork: true });
  const pool = new ethers.Contract(REF.pool, POOL_ABI, provider);

  const [natRes, tokRes] = await pool.getReserves();
  const lpBps = Number(await pool.lpFeeBps());
  const bbBps = Number(await pool.treasuryBuybackBps());
  const feeBps = lpBps + bbBps;

  console.log("POOL REFERENSI (nyata, 0G Testnet)");
  console.log(`  reserve : ${f(natRes, 6)} native / ${Number(ethers.formatEther(tokRes)).toLocaleString("id-ID", { maximumFractionDigits: 0 })} token`);
  console.log(`  fee     : ${lpBps / 100}% likuiditas (tinggal di pool) + ${bbBps / 100}% buyback = ${feeBps / 100}% per sisi\n`);

  // ── 1. Pengukuran nyata ───────────────────────────────────────────────────
  if (PK) {
    const wallet = new ethers.Wallet(PK, provider);
    const poolW = pool.connect(wallet);
    const tokenAddr = await pool.targetToken();
    const token = new ethers.Contract(tokenAddr, ERC20_ABI, wallet);
    const inWei = ethers.parseEther(TEST_BUY);

    console.log(`PENGUKURAN NYATA — beli ${TEST_BUY} lalu jual semuanya kembali`);
    const natBefore = await provider.getBalance(wallet.address);
    const tokBefore = await token.balanceOf(wallet.address);

    const dl = Math.floor(Date.now() / 1000) + 1800;
    const buyTx = await poolW.buy(0, wallet.address, dl, { value: inWei });
    const buyRc = await buyTx.wait();
    const tokAfterBuy = await token.balanceOf(wallet.address);
    const got = tokAfterBuy - tokBefore;
    console.log(`  beli   : ${TEST_BUY} native -> ${Number(ethers.formatEther(got)).toLocaleString("id-ID", { maximumFractionDigits: 0 })} token`);

    const apTx = await token.approve(REF.pool, got);
    const apRc = await apTx.wait();
    const sellTx = await poolW.sell(got, 0, wallet.address, Math.floor(Date.now() / 1000) + 1800);
    const sellRc = await sellTx.wait();
    const natAfter = await provider.getBalance(wallet.address);

    const gasSpent =
      buyRc.gasUsed * buyRc.gasPrice + apRc.gasUsed * apRc.gasPrice + sellRc.gasUsed * sellRc.gasPrice;
    // Kembali bersih dari kurva = perubahan saldo + gas + modal yang tadi keluar.
    const returned = natAfter - natBefore + gasSpent + inWei;
    const ratio = Number(returned) / Number(inWei);

    console.log(`  jual   : semua token -> ${f(returned, 8)} native kembali`);
    console.log(`  gas    : ${f(gasSpent, 8)} native (3 transaksi)`);
    console.log(`  KEMBALI: ${(ratio * 100).toFixed(3)}% dari modal, di luar gas`);
    console.log(`  rugi   : ${((1 - ratio) * 100).toFixed(3)}%  (teori fee dua sisi = ${(
      (1 - (1 - feeBps / 10000) ** 2) * 100
    ).toFixed(3)}%)\n`);
  } else {
    console.log("PENGUKURAN NYATA dilewati: OG_PRIVATE_KEY/PRIVATE_KEY tidak ada\n");
  }

  // ── 2. Proyeksi rumus (state berurutan, bukan kuotasi ganda) ──────────────
  console.log("PROYEKSI: rugi pulang-balik tidak bergantung ukuran, tapi SLIPPAGE bergantung");
  console.log("  (slippage penting kalau Anda TAHAN tokennya, bukan kalau langsung dijual)\n");
  console.log(`  ${"beli".padEnd(10)} ${"% reserve".padEnd(11)} ${"harga vs spot".padEnd(14)} ${"pulang-balik"}`);

  const Rn = Number(ethers.formatEther(natRes));
  const Rt = Number(ethers.formatEther(tokRes));
  const feeMul = 1 - feeBps / 10000;
  for (const amt of ["0.0001", "0.0005", "0.001", "0.005", "0.01", "0.05"]) {
    const x = Number(amt);
    const dx = x * feeMul;
    const tokensOut = (Rt * dx) / (Rn + dx);
    const spotTokens = x * (Rt / Rn);
    const slip = (1 - tokensOut / spotTokens) * 100;
    const roundTrip = feeMul * feeMul;
    console.log(
      `  ${amt.padEnd(10)} ${((x / Rn) * 100).toFixed(1).padStart(6)}%     ${(
        "-" + slip.toFixed(2) + "%"
      ).padEnd(14)} ${(roundTrip * 100).toFixed(2)}% kembali`
    );
  }

  // ── 3. Gas mainnet ────────────────────────────────────────────────────────
  console.log("\nBIAYA GAS MAINNET (harga gas saat ini; gas unit dari hasil uji kami)");
  for (const m of MAINNETS) {
    try {
      const r = new ethers.FetchRequest(m.rpc);
      r.timeout = 30000;
      const p = new ethers.JsonRpcProvider(r, m.chainId, { staticNetwork: true });
      const fee = await p.getFeeData();
      const gp = fee.maxFeePerGas || fee.gasPrice || 0n;
      const round = gp * BigInt(GAS_UNITS.buy + GAS_UNITS.approve + GAS_UNITS.sell);
      const launch = gp * BigInt(GAS_UNITS.launch);
      console.log(
        `  ${m.name.padEnd(14)} ${(+ethers.formatUnits(gp, "gwei")).toFixed(3).padStart(8)} gwei | ` +
          `beli+jual ${f(round, 8)} ${m.sym}${money(Number(ethers.formatEther(round)), m.usd)} | ` +
          `launch ${f(launch, 8)} ${m.sym}${money(Number(ethers.formatEther(launch)), m.usd)}`
      );
    } catch (e) {
      console.log(`  ${m.name.padEnd(14)} RPC tidak menjawab`);
    }
  }
  console.log("\n  USD memakai asumsi kasar (ETH $3000, 0G $2,1, MON $0,05), hanya untuk skala.");
})();
