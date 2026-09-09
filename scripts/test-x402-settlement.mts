/**
 * Uji jalur pembayaran x402 ujung-ke-ujung terhadap implementasi EIP-3009 yang patuh.
 *
 *   anvil --port 8546            (atau --fork-url apa pun; chainId bebas)
 *   ./node_modules/.bin/tsx scripts/test-x402-settlement.mts
 *
 * KENAPA BUKAN USDC BASE LANGSUNG
 *
 * Percobaan pertama menguji terhadap USDC Base di atas fork anvil dan SETIAP otorisasi
 * ditolak dengan "FiatTokenV2: invalid signature" — enam belas kombinasi nama/versi/
 * chainId, dan `permit` pun ditolak sama, meskipun `DOMAIN_SEPARATOR()` yang dikembalikan
 * kontraknya COCOK persis dengan hasil hitungan kita, typehash-nya standar, digest manual
 * dan digest ethers identik, dan precompile `ecrecover` di fork itu memulihkan alamat
 * pembayar dengan benar. Sebabnya tidak berhasil saya isolasi. Karena itu ia dicatat
 * sebagai risiko yang belum terpecahkan, bukan diklaim beres.
 *
 * Yang diuji di sini karena itu bukan "USDC menerima pembayaran kita", melainkan klaim
 * yang memang bisa dibuktikan: facilitator kita membentuk otorisasi yang diterima
 * implementasi EIP-3009 yang patuh, dan menolak yang cacat dengan alasan yang TEPAT.
 */
import { ethers } from 'ethers';
import { readFileSync } from 'node:fs';
import {
  buildPaymentRequirements,
  signAuthorization,
  verifyPayment,
  settlePayment,
  encodePaymentPayload,
  decodePaymentPayload,
} from '../cloudflare-worker/src/x402';

const RPC = process.env.X402_TEST_RPC || 'http://127.0.0.1:8546';
const PAY_TO = '0x24268Fffc119ec5550F68e80D94476fD64daE967';
const RELAYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const PAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const PRICE = 5_000n; // 0,005 pada 6 desimal

const provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: false });
const payer = new ethers.Wallet(PAYER_KEY, provider);
const relayer = new ethers.Wallet(RELAYER_KEY, provider);

let fail = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'GAGAL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail += 1;
};

console.log('── deploy token EIP-3009 yang patuh ──');
const art = JSON.parse(readFileSync('build/forge-out/MockEIP3009Token.sol/MockEIP3009Token.json', 'utf8'));
const factory = new ethers.ContractFactory(art.abi, art.bytecode.object, relayer);
const token = await factory.deploy('USD Coin');
await token.waitForDeployment();
const asset = await token.getAddress();
const net = await provider.getNetwork();
console.log(`  token ${asset} · chainId ${net.chainId}`);

const t = new ethers.Contract(
  asset,
  [
    'function mint(address,uint256)',
    'function balanceOf(address) view returns (uint256)',
    'function authorizationState(address,bytes32) view returns (bool)',
    'function DOMAIN_SEPARATOR() view returns (bytes32)',
  ],
  relayer,
);
await (await t.mint(payer.address, 1_000_000n)).wait();
const startPayer = await t.balanceOf(payer.address);
const startTreasury = await t.balanceOf(PAY_TO);
check('pembayar punya saldo', startPayer >= PRICE, `${ethers.formatUnits(startPayer, 6)}`);

const requirements = buildPaymentRequirements({
  resource: 'https://adexto.xyz/api/x402/quote/adexto',
  description: 'Signed on-chain quote bundle for one ADEXTO market',
  amountAtomic: PRICE,
  payTo: PAY_TO,
  asset,
  network: `evm-${net.chainId}`,
});

console.log('\n── domain yang kita hitung vs yang dipakai kontrak ──');
const onchainSep = await t.DOMAIN_SEPARATOR();
const calcSep = ethers.TypedDataEncoder.hashDomain({
  name: 'USD Coin',
  version: '2',
  chainId: Number(net.chainId),
  verifyingContract: asset,
});
check('DOMAIN_SEPARATOR cocok', onchainSep.toLowerCase() === calcSep.toLowerCase(), onchainSep.slice(0, 22));

console.log('\n── jalur bahagia: tanda tangan -> verify -> settle ──');
const payload = await signAuthorization({ signer: payer, requirements, provider });
const decoded = decodePaymentPayload(encodePaymentPayload(payload));
check('payload bulak-balik lewat base64', decoded !== null);

const v = await verifyPayment({ payload: decoded!, requirements, provider });
check('verify menerima otorisasi yang sah', v.isValid, v.invalidReason ?? `payer ${v.payer}`);

// Diambil SEBELUM settle: yang membuktikan pembayaran gasless bukan saldo yang nol —
// akun uji anvil sudah terisi — melainkan saldo yang TIDAK BERUBAH melewati settle.
const payerEthBefore = await provider.getBalance(payer.address);
const s = await settlePayment({ payload: decoded!, requirements, provider, relayerKey: RELAYER_KEY });
check('settle berhasil di chain', s.success, s.errorReason ? `${s.errorReason}: ${s.detail}` : `tx ${s.transaction?.slice(0, 14)}…`);

const endPayer = await t.balanceOf(payer.address);
const endTreasury = await t.balanceOf(PAY_TO);
check(
  'dana berpindah tepat sebesar harganya',
  startPayer - endPayer === PRICE && endTreasury - startTreasury === PRICE,
  `pembayar -${ethers.formatUnits(startPayer - endPayer, 6)} · penerima +${ethers.formatUnits(endTreasury - startTreasury, 6)}`,
);
const payerEthAfter = await provider.getBalance(payer.address);
check(
  'pembayaran gasless: saldo ETH pembayar tidak berubah',
  payerEthAfter === payerEthBefore,
  `${ethers.formatEther(payerEthBefore)} -> ${ethers.formatEther(payerEthAfter)} ETH`,
);
check('relayer yang menanggung gasnya', (await provider.getBalance(relayer.address)) < ethers.parseEther('10000'), 'saldo relayer turun');
check('nonce tercatat terpakai di token', await t.authorizationState(payer.address, decoded!.payload.authorization.nonce));

console.log('\n── pengiriman ganda ditolak oleh nonce on-chain ──');
const again = await settlePayment({ payload: decoded!, requirements, provider, relayerKey: RELAYER_KEY });
check('otorisasi sama tidak bisa dipakai dua kali', !again.success, `${again.errorReason}: ${String(again.detail).slice(0, 40)}`);
check('saldo penerima tidak bertambah lagi', (await t.balanceOf(PAY_TO)) === endTreasury);

console.log('\n── tiap penolakan harus punya alasan TEPAT, bukan sekadar gagal ──');
const now = () => BigInt(Math.floor(Date.now() / 1000));
const cases: Array<[string, () => Promise<any>, string]> = [
  ['nilai tidak sesuai iklan', async () => {
    const p = await signAuthorization({ signer: payer, requirements: { ...requirements, maxAmountRequired: '1' }, provider });
    return verifyPayment({ payload: p, requirements, provider });
  }, 'invalid_exact_evm_payload_authorization_value_mismatch'],
  ['penerima bukan payTo', async () => {
    const p = await signAuthorization({ signer: payer, requirements: { ...requirements, payTo: relayer.address }, provider });
    return verifyPayment({ payload: p, requirements, provider });
  }, 'invalid_exact_evm_payload_recipient_mismatch'],
  ['otorisasi kedaluwarsa', async () => {
    const p = await signAuthorization({ signer: payer, requirements, provider, validAfter: now() - 600n, validBefore: now() - 300n });
    return verifyPayment({ payload: p, requirements, provider });
  }, 'invalid_exact_evm_payload_authorization_valid_before'],
  ['otorisasi belum berlaku', async () => {
    const p = await signAuthorization({ signer: payer, requirements, provider, validAfter: now() + 300n, validBefore: now() + 900n });
    return verifyPayment({ payload: p, requirements, provider });
  }, 'invalid_exact_evm_payload_authorization_valid_after'],
  ['tanda tangan dirusak', async () => {
    const p = await signAuthorization({ signer: payer, requirements, provider });
    const bad = { ...p, payload: { ...p.payload, signature: p.payload.signature.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')) } };
    return verifyPayment({ payload: bad as any, requirements, provider });
  }, 'invalid_exact_evm_payload_signature'],
  ['network tidak cocok', async () => {
    const p = await signAuthorization({ signer: payer, requirements, provider });
    return verifyPayment({ payload: { ...p, network: 'ethereum' }, requirements, provider });
  }, 'invalid_network'],
  ['skema tidak dikenal', async () => {
    const p = await signAuthorization({ signer: payer, requirements, provider });
    return verifyPayment({ payload: { ...p, scheme: 'upto' }, requirements, provider });
  }, 'invalid_scheme'],
  ['nonce bukan bytes32', async () => {
    const p = await signAuthorization({ signer: payer, requirements, provider });
    return verifyPayment({ payload: { ...p, payload: { ...p.payload, authorization: { ...p.payload.authorization, nonce: '0x1234' } } } as any, requirements, provider });
  }, 'invalid_payload'],
  ['saldo pembayar tidak cukup', async () => {
    const broke = ethers.Wallet.createRandom().connect(provider);
    const p = await signAuthorization({ signer: broke, requirements, provider });
    return verifyPayment({ payload: p, requirements, provider });
  }, 'insufficient_funds'],
  ['nonce sudah terpakai', async () => verifyPayment({ payload: decoded!, requirements, provider }), 'invalid_transaction_state'],
];
for (const [label, run, expected] of cases) {
  const r = await run();
  check(`${label} -> ${expected}`, r.isValid === false && r.invalidReason === expected, r.invalidReason ?? 'DITERIMA padahal seharusnya tidak');
}

console.log(`\n${fail === 0 ? 'semua lulus' : `${fail} GAGAL`}`);
process.exit(fail === 0 ? 0 : 1);
