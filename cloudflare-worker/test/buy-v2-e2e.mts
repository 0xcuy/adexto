/**
 * Uji ujung-ke-ujung jalur x402 v2 di rute beli: `wrangler dev` sungguhan, fork anvil Base, USDC
 * sungguhan, kurva $BLOOP sungguhan di fork, dan klien RESMI `@x402/fetch`. Tanpa uang: saldo USDC
 * dan ETH diisi anvil.
 *
 * Yang dibuktikan, dengan membaca chain fork, bukan dengan percaya jawaban HTTP:
 *   - 402 membawa `PAYMENT-REQUIRED` yang lolos validator x402scan (`@agentcash/discovery`) sebagai
 *     x402 v2, sementara badannya tetap bentuk lama (`network: "base"`, `maxAmountRequired`);
 *   - `@x402/fetch` membayar lewat `PAYMENT-SIGNATURE`: token terkirim ke payer, tepat harga yang
 *     diiklankan pindah ke payee, `PAYMENT-RESPONSE` sukses dengan network `eip155:8453`;
 *   - jalur lama tidak berubah: amplop kita di `X-PAYMENT` juga membeli;
 *   - otorisasi v2 yang sudah dipakai ditolak 402 `invalid_transaction_state`, dan alasannya ada di
 *     `PAYMENT-REQUIRED`;
 *   - dua header pembayaran berbeda isi ditolak 400 sebelum verifikasi, tanpa uang tersentuh.
 *
 * Pengaman: menolak jalan kalau RPC bukan anvil atau Worker bukan localhost.
 *
 * Persiapan:
 *   anvil --fork-url https://mainnet.base.org --chain-id 8453 --host 127.0.0.1
 *   RELAYER_KEY=<kunci uji sekali pakai, mis. dari `cast wallet new`>
 *   cd cloudflare-worker && npx wrangler dev --local --ip 127.0.0.1 --port 8787 \
 *     --var X402_RELAYER_PRIVATE_KEY:$RELAYER_KEY --var BASE_RPC:http://127.0.0.1:8545
 *   npm i --prefix /tmp/x402-sdk @x402/fetch@2.28.0 @x402/evm@2.28.0 @agentcash/discovery@1.7.5 viem@2.55.17
 *
 * Jalankan dari akar repo:
 *   RELAYER_KEY=$RELAYER_KEY X402_SDK_DIR=/tmp/x402-sdk npx tsx cloudflare-worker/test/buy-v2-e2e.mts
 *
 * SDK-nya sengaja tidak masuk dependensi repo: yang diuji adalah kecocokan dengan klien pihak
 * ketiga versi tertentu, jadi versinya ditulis di perintah di atas, bukan di package.json.
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import { ethers } from "ethers";
import { encodePaymentPayload, signAuthorization, USDC_BASE, type PaymentRequirements } from "../src/x402";

const WORKER = (process.env.WORKER_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");
const FORK_RPC = process.env.FORK_RPC || "http://127.0.0.1:8545";
const RELAYER_KEY = process.env.RELAYER_KEY || "";
const SDK_DIR = process.env.X402_SDK_DIR || "/tmp/x402-sdk";
const SYMBOL = (process.env.SYMBOL || "bloop").toLowerCase();
const USDC_BALANCE_SLOT = 9n; // `balanceAndBlacklistStates` FiatTokenV2_2, sama dengan compute-e2e
let fails = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) fails++;
  console.log(`${pass ? "OK  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};
const head = (t: string) => console.log(`\n── ${t}`);
const short = (v: unknown) => JSON.stringify(v)?.slice(0, 160) ?? "";
const decodeHeader = (h: string | null) =>
  h ? JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(h), (c) => c.charCodeAt(0)))) : null;

if (!["127.0.0.1", "localhost"].includes(new URL(WORKER).hostname)) {
  console.error(`Refusing to run: ${WORKER} is not a local worker.`);
  process.exit(2);
}
const provider = new ethers.JsonRpcProvider(FORK_RPC, 8453, { staticNetwork: true, batchMaxCount: 1 });
const clientVersion = String(await provider.send("web3_clientVersion", []).catch(() => ""));
if (!/anvil/i.test(clientVersion)) {
  console.error(`Refusing to run: ${FORK_RPC} is not anvil ("${clientVersion}").`);
  process.exit(2);
}
if (!/^0x[0-9a-fA-F]{64}$/.test(RELAYER_KEY)) {
  console.error("RELAYER_KEY must be the throwaway key wrangler dev was started with.");
  process.exit(2);
}
const sdk = createRequire(join(SDK_DIR, "noop.js"));
const { x402Client, wrapFetchWithPayment } = sdk("@x402/fetch");
const { registerExactEvmScheme } = sdk("@x402/evm/exact/client");
const { privateKeyToAccount } = sdk("viem/accounts");
const { validatePaymentRequiredDetailed, checkEndpointSchema } = sdk("@agentcash/discovery");

// ── dompet uji ─────────────────────────────────────────────────────────────

const usdc = new ethers.Contract(
  USDC_BASE.address,
  ["function balanceOf(address) view returns (uint256)", "function authorizationState(address,bytes32) view returns (bool)"],
  provider
);
async function setUsdc(address: string, atomic: bigint) {
  const slot = ethers.solidityPackedKeccak256(["uint256", "uint256"], [address, USDC_BALANCE_SLOT]);
  await provider.send("anvil_setStorageAt", [USDC_BASE.address, slot, ethers.toBeHex(atomic, 32)]);
}
// Akun acak, bukan akun bawaan anvil: yang bawaan punya delegasi EIP-7702 penyapu di Base mainnet.
const relayer = new ethers.Wallet(RELAYER_KEY);
await provider.send("anvil_setBalance", [relayer.address, ethers.toQuantity(ethers.parseEther("1"))]);
const v2Payer = ethers.Wallet.createRandom().connect(provider);
const v1Payer = ethers.Wallet.createRandom().connect(provider);
await setUsdc(v2Payer.address, 1_000_000n);
await setUsdc(v1Payer.address, 1_000_000n);
check("payers funded with 1 USDC each on the fork", (await usdc.balanceOf(v2Payer.address)) === 1_000_000n && (await usdc.balanceOf(v1Payer.address)) === 1_000_000n);

const url = `${WORKER}/v1/x402/buy/${SYMBOL}`;
async function get(headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(180_000) });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 200) };
  }
  return { status: res.status, json, headers: res.headers };
}

// ── tantangan ──────────────────────────────────────────────────────────────

head("challenge: the old body plus the v2 header");
const unpaid = await get();
check("402", unpaid.status === 402, `status ${unpaid.status} ${short(unpaid.json?.error)}`);
const terms: PaymentRequirements = unpaid.json?.accepts?.[0];
check("body unchanged: accepts[0] network base, maxAmountRequired", terms?.network === "base" && /^\d+$/.test(String(terms?.maxAmountRequired)), short(terms));
const pr = decodeHeader(unpaid.headers.get("payment-required"));
check("PAYMENT-REQUIRED decodes to x402Version 2", pr?.x402Version === 2, short(pr?.error));
check(
  "header terms = body terms, in v2 form",
  pr?.accepts?.[0]?.network === "eip155:8453" &&
    pr?.accepts?.[0]?.amount === terms?.maxAmountRequired &&
    pr?.accepts?.[0]?.payTo === terms?.payTo &&
    pr?.accepts?.[0]?.asset === terms?.asset,
  short(pr?.accepts?.[0])
);
const validated = validatePaymentRequiredDetailed(pr);
check("x402scan validator: valid", validated.valid === true, short(validated.issues));
const probe = await checkEndpointSchema({ url, probe: true, signal: AbortSignal.timeout(60_000) });
const getAdvisory = probe.found ? probe.advisories.find((a: any) => a.method === "GET") : undefined;
const x402Options = (getAdvisory?.paymentOptions ?? []).filter((o: any) => o.protocol === "x402");
check("x402scan probe: GET is paid with a v2 x402 option", x402Options.length > 0 && x402Options.every((o: any) => o.version === 2), short(x402Options));

// ── bayar dengan SDK resmi v2 ──────────────────────────────────────────────

head("pay with @x402/fetch (PAYMENT-SIGNATURE)");
const token = new ethers.Contract(String(unpaid.json?.quote?.token), ["function balanceOf(address) view returns (uint256)"], provider);
const payTo = String(terms.payTo);
const price = BigInt(terms.maxAmountRequired);
const payeeBefore = await usdc.balanceOf(payTo);
const sent: string[] = [];
const recordingFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  const sig = req.headers.get("PAYMENT-SIGNATURE");
  if (sig) sent.push(sig);
  return fetch(req);
};
const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(v2Payer.privateKey as `0x${string}`) });
const payFetch = wrapFetchWithPayment(recordingFetch, client);
const paidRes: Response = await payFetch(url, { signal: AbortSignal.timeout(180_000) });
const paid: any = await paidRes.json().catch(() => null);
check("200 delivered and settled", paidRes.status === 200 && paid?.delivery?.success === true && paid?.settlement?.success === true, `status ${paidRes.status} ${short(paid?.error ?? paid?.settlement)}`);
check("the SDK sent exactly one PAYMENT-SIGNATURE", sent.length === 1);
const v2Body = decodeHeader(sent[0] ?? null);
check("the SDK used the v2 envelope", v2Body?.x402Version === 2 && v2Body?.accepted?.network === "eip155:8453", short(v2Body?.accepted));
const pres = decodeHeader(paidRes.headers.get("payment-response"));
check("PAYMENT-RESPONSE: success on eip155:8453", pres?.success === true && pres?.network === "eip155:8453" && /^0x[0-9a-f]{64}$/i.test(String(pres?.transaction)), short(pres));
check("tokens delivered to the payer", (await token.balanceOf(v2Payer.address)) > 0n);
check("payee received exactly the price", (await usdc.balanceOf(payTo)) - payeeBefore === price);
check("payer paid exactly the price", (await usdc.balanceOf(v2Payer.address)) === 1_000_000n - price);
const settleRc = pres?.transaction ? await provider.getTransactionReceipt(pres.transaction) : null;
check("settlement transaction mined on the fork", settleRc?.status === 1, String(pres?.transaction));

head("the same v2 authorization again");
const replay = await get({ "PAYMENT-SIGNATURE": sent[0] ?? "" });
check("402 invalid_transaction_state", replay.status === 402 && replay.json?.error === "invalid_transaction_state", `status ${replay.status} ${short(replay.json?.error)}`);
check("reason repeated in PAYMENT-REQUIRED", decodeHeader(replay.headers.get("payment-required"))?.error === "invalid_transaction_state");

// ── jalur lama ─────────────────────────────────────────────────────────────

head("the old path: our envelope in X-PAYMENT");
const v1Auth = await signAuthorization({ signer: v1Payer, requirements: terms, provider });
const conflict = await get({ "X-PAYMENT": encodePaymentPayload(v1Auth), "PAYMENT-SIGNATURE": "e30=" });
check("two different payment headers: 400 before verification", conflict.status === 400 && conflict.json?.error === "conflicting_payment_headers", `status ${conflict.status}`);
check("nothing moved, the authorization is unused", (await usdc.balanceOf(v1Payer.address)) === 1_000_000n && !(await usdc.authorizationState(v1Payer.address, v1Auth.payload.authorization.nonce)));
const payeeMid = await usdc.balanceOf(payTo);
const v1 = await get({ "X-PAYMENT": encodePaymentPayload(v1Auth) });
check("200 delivered and settled", v1.status === 200 && v1.json?.delivery?.success === true && v1.json?.settlement?.success === true, `status ${v1.status} ${short(v1.json?.error ?? v1.json?.settlement)}`);
const xres = decodeHeader(v1.headers.get("x-payment-response"));
check("X-PAYMENT-RESPONSE unchanged: network base", xres?.success === true && xres?.network === "base", short(xres));
check("tokens delivered, exact price moved", (await token.balanceOf(v1Payer.address)) > 0n && (await usdc.balanceOf(payTo)) - payeeMid === price);

console.log(`\n${fails === 0 ? "ALL PASSED" : `${fails} FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
