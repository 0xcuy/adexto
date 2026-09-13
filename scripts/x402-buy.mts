/**
 * Beli token lewat gerbang x402 dengan UANG SUNGGUHAN, lalu buktikan kedua kakinya.
 *
 *   ./node_modules/.bin/tsx scripts/x402-buy.mts --symbol parcel
 *   ./node_modules/.bin/tsx scripts/x402-buy.mts --symbol parcel --broadcast
 *
 * KENAPA BERKAS INI ADA
 *
 * Dua pembelian sungguhan pertama dikutip di README, /pitch, dan runbook sebagai bukti
 * jalur berbayarnya hidup — tetapi skrip yang melakukannya tidak ada di repo. Jadi klaim
 * paling kuat proyek ini bergantung pada dua hash yang tidak bisa direproduksi siapa pun,
 * termasuk kami. `scripts/test-x402-settlement.mts` menguji facilitator terhadap token
 * EIP-3009 tiruan di anvil; ia tidak pernah menyentuh gerbang yang hidup.
 *
 * YANG DIBUKTIKAN, dan urutannya penting
 *
 * Pembayar TIDAK perlu gas dan TIDAK perlu aset chain tujuan. Ia menandatangani otorisasi
 * EIP-3009 di Base — tanda tangan, bukan transaksi — dan relayer yang mengirimkannya. Lalu
 * kurva di chain tujuan mengirim token LANGSUNG ke pembayar; tidak ada langkah di mana kami
 * memegang tokennya.
 *
 * Karena itu verifikasinya membaca DUA chain sesudahnya: saldo USDC pembayar di Base turun
 * tepat sebesar harga, dan saldo tokennya di chain pasar naik. Status 200 dari gerbang
 * tidak dipercaya sebagai bukti — itu pelajaran yang sudah dibayar sekali di proyek ini,
 * ketika resi status-1 dianggap membuktikan burn padahal yang membuktikannya adalah
 * kecocokan antara penghitung kurva dan suplai token.
 */
import { ethers } from "ethers";
import * as dotenv from "dotenv";
import { signAuthorization, encodePaymentPayload, type PaymentRequirements } from "../cloudflare-worker/src/x402";

dotenv.config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const argOf = (f: string) => {
  const i = args.indexOf(f);
  return i === -1 ? "" : (args[i + 1] || "").trim();
};
const BROADCAST = args.includes("--broadcast");
const SYMBOL = (argOf("--symbol") || "parcel").toLowerCase();
const GATEWAY = argOf("--gateway") || "https://x402.adexto.xyz";

/**
 * RPC Base publik, BUKAN relai kami.
 *
 * Relai di `/api/rpc/base` menuntut `RPC_RELAY_SECRET` dan sengaja hanya dipegang Worker.
 * Skrip ini hanya membaca dan menandatangani, jadi tidak butuh relai itu — dan memakai RPC
 * publik di sini justru membuktikan pembayar tidak perlu infrastruktur kami.
 */
const BASE_RPC = process.env.X402_BUY_BASE_RPC || "https://mainnet.base.org";
const PAYER_KEY = process.env.X402_BUYER_PRIVATE_KEY || process.env.OG_PRIVATE_KEY || process.env.PRIVATE_KEY;
if (!PAYER_KEY) {
  console.error("Butuh X402_BUYER_PRIVATE_KEY (atau OG_PRIVATE_KEY) di .env.local");
  process.exit(1);
}

const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const base = new ethers.JsonRpcProvider(BASE_RPC, 8453, { staticNetwork: true });
const payer = new ethers.Wallet(PAYER_KEY, base);

console.log(`gerbang : ${GATEWAY}/v1/x402/buy/${SYMBOL}`);
console.log(`pembayar: ${payer.address}\n`);

// ── 1. Tantangan 402 ────────────────────────────────────────────────────────
const challengeRes = await fetch(`${GATEWAY}/v1/x402/buy/${SYMBOL}`, { signal: AbortSignal.timeout(60000) });
const challenge: any = await challengeRes.json();
if (challengeRes.status !== 402) {
  console.error(`Diharapkan 402, dapat ${challengeRes.status}:`, JSON.stringify(challenge).slice(0, 300));
  process.exit(1);
}
const requirements: PaymentRequirements = challenge.accepts[0];
const q = challenge.quote;

console.log("── tantangan 402 ──");
console.log(`  bayar     : ${q.payWith.amount} (${requirements.asset}) di ${requirements.network}`);
console.log(`  ke        : ${requirements.payTo}`);
console.log(`  terima    : ~${Number(q.deliver.quotedTokensOut).toFixed(4)} $${q.symbol} di ${q.chain}`);
console.log(`  minimum   : ${Number(q.deliver.minTokensOut).toFixed(4)} $${q.symbol}`);
console.log(`  kurva bel.: ${Number(q.deliver.nativeSpent).toFixed(6)} ${q.deliver.nativeSymbol} dari persediaan kami`);
console.log(`  persediaan: inStock=${q.inventory.inStock} remainingBuys=${q.inventory.remainingBuys}`);

if (!q.inventory.inStock) {
  console.error("\nBATAL: gerbang melaporkan persediaan habis; pembayaran akan ditolak sebelum diambil.");
  process.exit(1);
}

// ── 2. Saldo sebelum, di kedua chain ────────────────────────────────────────
const usdc = new ethers.Contract(requirements.asset, ERC20, base);
const marketProvider = new ethers.JsonRpcProvider(
  q.chainId === 143
    ? process.env.MONAD_RPC_URL || "https://rpc.monad.xyz"
    : process.env.OG_RPC_URL || "https://evmrpc.0g.ai",
  q.chainId,
  { staticNetwork: true }
);
const tokenC = new ethers.Contract(q.token, ERC20, marketProvider);

const before = {
  usdc: await usdc.balanceOf(payer.address),
  token: await tokenC.balanceOf(payer.address),
};
console.log("\n── sebelum ──");
console.log(`  USDC di Base      : ${ethers.formatUnits(before.usdc, 6)}`);
console.log(`  $${q.symbol} di ${q.chain}: ${ethers.formatUnits(before.token, 18)}`);

if (before.usdc < BigInt(requirements.maxAmountRequired)) {
  console.error(`\nBATAL: pembayar butuh ${Number(requirements.maxAmountRequired) / 1e6} USDC`);
  process.exit(1);
}

// ── 3. Tanda tangan otorisasi. Tidak ada transaksi dari pembayar ────────────
const payload = await signAuthorization({ signer: payer, requirements, provider: base });
console.log("\n── otorisasi EIP-3009 ditandatangani ──");
console.log(`  nonce      : ${payload.payload.authorization.nonce}`);
console.log(`  berlaku s.d: ${new Date(Number(payload.payload.authorization.validBefore) * 1000).toISOString()}`);
console.log("  pembayar tidak mengirim transaksi dan tidak membayar gas.");

if (!BROADCAST) {
  console.log("\nDRY RUN — otorisasi TIDAK dikirim. Ulangi dengan --broadcast.");
  process.exit(0);
}

// ── 4. Kirim ulang permintaan, kali ini berbayar ────────────────────────────
console.log("\n── mengirim X-PAYMENT ──");
const t0 = Date.now();
const paidRes = await fetch(`${GATEWAY}/v1/x402/buy/${SYMBOL}`, {
  headers: { "X-PAYMENT": encodePaymentPayload(payload) },
  signal: AbortSignal.timeout(180000),
});
const paid: any = await paidRes.json();
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`  HTTP ${paidRes.status} dalam ${elapsed}s`);

if (paidRes.status !== 200) {
  console.error("  gerbang menolak:", JSON.stringify(paid).slice(0, 400));
  process.exit(1);
}

console.log(`  pengiriman : ${paid.delivery?.transaction}`);
console.log(`  settlement : ${paid.settlement?.transaction} (${paid.settlement?.success ? "sukses" : "GAGAL"})`);
if (paid.buyback) console.log(`  buyback    : executed=${paid.buyback.executed} ${paid.buyback.detail ?? ""}`);

// ── 5. Buktikan dari KEDUA chain, bukan dari respons ────────────────────────
console.log("\n── menunggu kedua chain, lalu membaca ulang saldo ──");
await new Promise((r) => setTimeout(r, 6000));
const after = {
  usdc: await usdc.balanceOf(payer.address),
  token: await tokenC.balanceOf(payer.address),
};
const spent = before.usdc - after.usdc;
const got = after.token - before.token;
const min = ethers.parseEther(q.deliver.minTokensOut);

console.log(`  USDC keluar        : ${ethers.formatUnits(spent, 6)} (diharapkan ${Number(requirements.maxAmountRequired) / 1e6})`);
console.log(`  $${q.symbol} diterima : ${ethers.formatUnits(got, 18)}`);
console.log(`  di atas minTokensOut: ${got >= min ? "YA" : "TIDAK"}`);

const ok =
  spent === BigInt(requirements.maxAmountRequired) && got > 0n && got >= min && paid.settlement?.success === true;
console.log(`\n${ok ? "LULUS" : "GAGAL"} — satu permintaan HTTP, dua chain, ${elapsed}s`);
process.exit(ok ? 0 : 1);
