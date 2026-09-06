/**
 * Isi pasar $ADEXTO dengan perdagangan nyata, seperti pola rekaman demo.
 *
 *   node scripts/seed-adexto-trades.mjs                # dry run
 *   node scripts/seed-adexto-trades.mjs --broadcast
 *
 * KENAPA POLANYA SEPERTI INI, BUKAN SEKADAR BEBERAPA PEMBELIAN
 *
 * Jaraknya ~25 detik dan urutannya campur beli/jual, dua-duanya karena alasan yang
 * pernah terbukti di rekaman pertama: pada bucket 1 menit, perdagangan yang berjarak
 * puluhan detik menyatu menjadi satu candle, dan `close` bucket itu diambil dari fill
 * TERAKHIR. Akibatnya 4 pembelian dan 1 penjualan menghasilkan NOL candle merah —
 * penjualannya lenyap dari chart. Jarak 25 detik memberi tiap fill bucket sendiri pada
 * tf=15, dan penjualan yang diselipkan memastikan chart-nya punya dua arah.
 *
 * `minTokensOut` / `minNativeOut` DIHITUNG dari kuotasi dengan toleransi 1%, bukan
 * diisi nol. Nol akan lebih mudah, tetapi nol tidak menguji apa pun: justru batas itu
 * yang akan menolak transaksi kalau kuotasi klien dan kontrak tidak sepakat — dan
 * ketidaksepakatan itu persis bug yang muncul kalau satu kaki fee terlupa.
 */
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local', quiet: true });

const BROADCAST = process.argv.includes('--broadcast');
const flagValue = (name, fallback = '') => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};
const RPC = process.env.OG_RPC_URL || 'https://evmrpc.0g.ai';
const PK = process.env.OG_PRIVATE_KEY || process.env.PRIVATE_KEY;
if (!PK) {
  console.error('Missing OG_PRIVATE_KEY / PRIVATE_KEY in .env.local');
  process.exit(1);
}

// Hanya $ADEXTO. Kurva 0.11.0 yang sekarang terdaftar di situs.
const CURVE = process.env.SEED_CURVE || '0xc80e0659D2Fc29e62605C9DF6182a85372652B60';
const TOKEN = process.env.SEED_TOKEN || '0xA1358C17004469C7CA5365AbafD294F9b2c11DF7';
const GAP_MS = Number(process.env.SEED_GAP_MS || 25_000);
const SLIPPAGE_BPS = 100n; // 1%

const CURVE_ABI = [
  'function VERSION() view returns (string)',
  'function totalFeeBps() view returns (uint256)',
  'function swapCount() view returns (uint256)',
  'function realNative() view returns (uint256)',
  'function protocolOwed() view returns (uint256)',
  'function creatorOwed() view returns (uint256)',
  'function treasuryNative() view returns (uint256)',
  'function spotPriceNativePerToken() view returns (uint256)',
  'function floorPriceNativePerToken() view returns (uint256)',
  'function getBuyQuote(uint256) view returns (uint256 tokensOut, uint256 depthFee, uint256 creatorFee, uint256 treasuryFee, uint256 protocolFee)',
  'function getSellQuote(uint256) view returns (uint256 nativeOut, uint256 depthFee, uint256 creatorFee, uint256 treasuryFee, uint256 protocolFee)',
  'function buy(uint256 minTokensOut, address to, uint256 deadline) payable returns (uint256)',
  'function sell(uint256 tokenAmountIn, uint256 minNativeOut, address to, uint256 deadline) returns (uint256)',
];
const ERC20 = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function symbol() view returns (string)',
];

const provider = new ethers.JsonRpcProvider(RPC, 16661, { staticNetwork: true });
const wallet = new ethers.NonceManager(new ethers.Wallet(PK, provider));
const ME = new ethers.Wallet(PK).address;

/**
 * Tunggu receipt dengan SABAR, karena `tx.wait()` tidak cukup di 0G.
 *
 * RPC publik 0G menjawab `-32000 no matching receipts found: this may indicate
 * potential data corruption` untuk transaksi yang SUDAH masuk blok. Terbukti di
 * jalannya skrip ini: `approve` gagal di `tx.wait()` dengan pesan itu, prosesnya mati
 * di tengah seri, dan pemeriksaan sesudahnya menemukan receipt-nya ada — status 1,
 * blok 43708796. Jadi itu kegagalan BACA, bukan kegagalan transaksi, dan
 * memperlakukannya sebagai kegagalan transaksi adalah kesimpulan yang salah pada
 * keadaan yang benar.
 *
 * Yang berbahaya kalau tidak ditangani: prosesnya berhenti setelah transaksi terkirim,
 * jadi keadaan on-chain sudah maju sementara skripnya berpikir belum. Menunggu ulang
 * lewat hash menghilangkan seluruh kelas masalah itu.
 */
const waitMined = async (tx, label = '') => {
  for (let attempt = 1; attempt <= 40; attempt++) {
    try {
      const rc = await provider.getTransactionReceipt(tx.hash);
      if (rc) {
        if (rc.status !== 1) throw new Error(`transaksi revert: ${tx.hash}`);
        if (attempt > 1) console.log(`     receipt ${label} terbaca pada percobaan ${attempt}`);
        return rc;
      }
    } catch (e) {
      const msg = String(e.shortMessage ?? e.message ?? e);
      if (msg.includes('revert')) throw e;
      if (attempt === 1 || attempt % 5 === 0) {
        console.log(`     RPC belum bisa menyajikan receipt ${label} (percobaan ${attempt}): ${msg.slice(0, 60)}`);
      }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`receipt ${tx.hash} tidak muncul setelah 120s`);
};
const curve = new ethers.Contract(CURVE, CURVE_ABI, wallet);
const token = new ethers.Contract(TOKEN, ERC20, wallet);

const fmt = (v) => Number(ethers.formatEther(v)).toLocaleString('en-US', { maximumFractionDigits: 9 });
const fmtTok = (v) => Number(ethers.formatUnits(v, 18)).toLocaleString('en-US', { maximumFractionDigits: 4 });

/**
 * Urutannya mengikuti rekaman: empat pembelian dengan dua penjualan diselipkan.
 * `part` untuk jual adalah pembagi saldo saat itu, dihitung saat langkahnya jalan —
 * bukan dipaku di muka — supaya penjualan terakhir tidak pernah melebihi yang dipegang.
 */
const FULL_PLAN = [
  { kind: 'buy', native: '0.004' },
  { kind: 'buy', native: '0.004' },
  { kind: 'sell', divisor: 3n },
  { kind: 'buy', native: '0.005' },
  { kind: 'sell', divisor: 4n },
  { kind: 'buy', native: '0.004' },
];

/**
 * `--from N` melanjutkan dari langkah ke-N, satu-basis.
 *
 * Ada karena RPC 0G memutus seri ini di tengah dan langkah yang sudah terkirim tidak
 * bisa dibatalkan. Tanpa cara melanjutkan, satu-satunya pilihan adalah menjalankan
 * ulang seluruh rencana — yang berarti mengirim ulang pembelian yang sudah masuk blok
 * dan membuat riwayat pasar tidak seperti yang dimaksud. Melanjutkan lebih jujur
 * daripada mengulang.
 */
const FROM = Math.max(1, Number(flagValue('from', '1')));
const PLAN = FULL_PLAN.slice(FROM - 1);

const symbol = await token.symbol();
const [version, totalBps, swapsBefore, spotBefore, floorBefore] = await Promise.all([
  curve.VERSION(),
  curve.totalFeeBps(),
  curve.swapCount(),
  curve.spotPriceNativePerToken(),
  curve.floorPriceNativePerToken(),
]);
const nativeBefore = await provider.getBalance(ME);
const heldBefore = await token.balanceOf(ME);

console.log(`pasar    : $${symbol}  kurva ${CURVE}`);
console.log(`VERSION  : ${version}   totalFeeBps ${totalBps} (${(Number(totalBps) / 100).toFixed(2)}% dibayar trader)`);
console.log(`trader   : ${ME}`);
console.log(`sekarang : ${swapsBefore} swap · spot ${ethers.formatEther(spotBefore)} · floor ${ethers.formatEther(floorBefore)} 0G/token`);
console.log(`saldo    : ${fmt(nativeBefore)} 0G · ${fmtTok(heldBefore)} ${symbol}`);
console.log(`rencana  : ${PLAN.map((p) => (p.kind === 'buy' ? `beli ${p.native}` : `jual 1/${p.divisor}`)).join(' → ')}`);
console.log(`jarak    : ${GAP_MS / 1000}s antar perdagangan\n`);

if (!BROADCAST) {
  // Simulasi setiap langkah tanpa mengirim apa pun, supaya kegagalan terlihat gratis.
  console.log('DRY RUN — simulasi tiap langkah:');
  let simHeld = heldBefore;
  for (const [i, stepPlan] of PLAN.entries()) {
    if (stepPlan.kind === 'buy') {
      const value = ethers.parseEther(stepPlan.native);
      const q = await curve.getBuyQuote(value);
      const minOut = (BigInt(q[0]) * (10_000n - SLIPPAGE_BPS)) / 10_000n;
      await curve.buy.staticCall(minOut, ME, 0, { value });
      simHeld += BigInt(q[0]);
      console.log(
        `  ${i + 1}. BELI  ${stepPlan.native} 0G -> ~${fmtTok(q[0])} ${symbol}  (protocolFee ${fmt(q[4])} 0G)`,
      );
    } else {
      const amount = simHeld / stepPlan.divisor;
      if (amount === 0n) {
        console.log(`  ${i + 1}. JUAL  dilewati, saldo simulasi nol`);
        continue;
      }
      const q = await curve.getSellQuote(amount);
      console.log(
        `  ${i + 1}. JUAL  ${fmtTok(amount)} ${symbol} -> ~${fmt(q[0])} 0G  (protocolFee ${fmt(q[4])} 0G)`,
      );
      simHeld -= amount;
    }
  }
  console.log('\nSemua langkah lolos simulasi. Jalankan lagi dengan --broadcast untuk mengirim.');
  process.exit(0);
}

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`     ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures += 1;
};

const fills = [];
for (const [i, stepPlan] of PLAN.entries()) {
  // Nomornya mengikuti rencana PENUH, bukan potongannya, supaya log saat melanjutkan
  // menyebut langkah yang sama dengan log saat jalan pertama.
  const n = FROM + i;
  if (i > 0) {
    console.log(`  … tunggu ${GAP_MS / 1000}s supaya fill ini dapat candle sendiri`);
    await new Promise((r) => setTimeout(r, GAP_MS));
  }

  if (stepPlan.kind === 'buy') {
    const value = ethers.parseEther(stepPlan.native);
    const q = await curve.getBuyQuote(value);
    const minOut = (BigInt(q[0]) * (10_000n - SLIPPAGE_BPS)) / 10_000n;
    console.log(`\n${n}) BELI ${stepPlan.native} 0G — kuotasi ${fmtTok(q[0])} ${symbol}, minOut ${fmtTok(minOut)}`);
    const before = await token.balanceOf(ME);
    const tx = await curve.buy(minOut, ME, 0, { value });
    const rc = await waitMined(tx, 'beli');
    const got = (await token.balanceOf(ME)) - before;
    console.log(`     tx ${tx.hash}  block ${rc.blockNumber}`);
    check('diterima persis seperti kuotasi', got === BigInt(q[0]), `${fmtTok(got)}`);
    fills.push({ n, kind: 'BUY', native: value, token: got, protocolFee: BigInt(q[4]) });
  } else {
    const held = await token.balanceOf(ME);
    const amount = held / stepPlan.divisor;
    if (amount === 0n) {
      console.log(`\n${n}) JUAL dilewati — tidak ada saldo`);
      continue;
    }
    const q = await curve.getSellQuote(amount);
    const minOut = (BigInt(q[0]) * (10_000n - SLIPPAGE_BPS)) / 10_000n;
    console.log(`\n${n}) JUAL ${fmtTok(amount)} ${symbol} — kuotasi ${fmt(q[0])} 0G, minOut ${fmt(minOut)}`);

    const allowance = await token.allowance(ME, CURVE);
    if (allowance < amount) {
      const ap = await token.approve(CURVE, amount);
      await waitMined(ap, 'approve');
      console.log(`     approve ${ap.hash}`);
    }
    const nativeBeforeSell = await provider.getBalance(ME);
    const tx = await curve.sell(amount, minOut, ME, 0);
    const rc = await waitMined(tx, 'jual');
    const gasCost = rc.gasUsed * rc.gasPrice;
    const received = (await provider.getBalance(ME)) - nativeBeforeSell + gasCost;
    console.log(`     tx ${tx.hash}  block ${rc.blockNumber}`);
    check('hasil jual persis seperti kuotasi', received === BigInt(q[0]), `${fmt(received)}`);
    fills.push({ n, kind: 'SELL', native: BigInt(q[0]), token: amount, protocolFee: BigInt(q[4]) });
  }
}

const [swapsAfter, spotAfter, floorAfter, real, protoOwed, creatorOwed, buyback] = await Promise.all([
  curve.swapCount(),
  curve.spotPriceNativePerToken(),
  curve.floorPriceNativePerToken(),
  curve.realNative(),
  curve.protocolOwed(),
  curve.creatorOwed(),
  curve.treasuryNative(),
]);

console.log(`\n── ringkasan ──`);
for (const f of fills) {
  console.log(
    `  ${String(f.n).padStart(2)}. ${f.kind.padEnd(4)} ${fmt(f.native).padStart(12)} 0G  ` +
      `${fmtTok(f.token).padStart(14)} ${symbol}  protocolFee ${fmt(f.protocolFee)}`,
  );
}
const buys = fills.filter((f) => f.kind === 'BUY').length;
const sells = fills.filter((f) => f.kind === 'SELL').length;
const protocolTotal = fills.reduce((s, f) => s + f.protocolFee, 0n);

console.log(`\nswapCount ${swapsBefore} -> ${swapsAfter}   (${buys} beli, ${sells} jual)`);
console.log(`spot  ${ethers.formatEther(spotBefore)} -> ${ethers.formatEther(spotAfter)} 0G/token`);
console.log(`floor ${ethers.formatEther(floorBefore)} -> ${ethers.formatEther(floorAfter)} 0G/token`);
console.log(`realNative kurva ${fmt(real)} 0G`);
console.log(`terakumulasi: creator ${fmt(creatorOwed)} · buyback ${fmt(buyback)} · protokol ${fmt(protoOwed)} 0G`);
console.log(`fee protokol dari seri ini: ${fmt(protocolTotal)} 0G`);

check('ada fill di KEDUA arah, jadi chart punya dua warna', buys > 0 && sells > 0, `${buys} beli / ${sells} jual`);
check('swapCount naik sebanyak fill yang dikirim', swapsAfter - swapsBefore === BigInt(fills.length));
check('lantai harga naik (fee depth mengendap)', floorAfter > floorBefore);
check('fee protokol terakumulasi dari seri ini', protoOwed > 0n, `${fmt(protoOwed)} 0G`);

console.log(failures === 0 ? '\nSEMUA CEK LULUS' : `\n${failures} CEK GAGAL`);
process.exit(failures === 0 ? 0 : 1);
