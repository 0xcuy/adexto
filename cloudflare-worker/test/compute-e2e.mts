/**
 * Uji ujung-ke-ujung compute berbayar: `wrangler dev` sungguhan, USDC sungguhan di fork anvil Base,
 * tanda tangan EIP-3009 sungguhan, router tiruan. Tanpa uang: saldo USDC dan ETH diisi anvil.
 *
 * Yang dibuktikan, dengan membaca chain fork, bukan dengan percaya jawaban HTTP:
 *   - model gagal → saldo payer tidak berubah dan nonce otorisasinya belum terpakai;
 *   - sukses → tepat 5000 atom USDC pindah ke payee, tx settlement ada di chain;
 *   - otorisasi yang sudah dipakai, atau payer tanpa saldo → ditolak SEBELUM model dipanggil;
 *   - batas diperiksa sebelum pembayaran; router menerima `stream: false` dan `max_tokens` ≤ 512.
 *
 * Pengaman: menolak jalan kalau RPC bukan anvil atau Worker bukan localhost.
 *
 * Persiapan (lihat komentar di `compute.test.ts` untuk uji tanpa wrangler):
 *   anvil --fork-url https://mainnet.base.org --chain-id 8453 --host 127.0.0.1
 *   RELAYER_KEY=$(cast wallet new --json | jq -r '.[0].private_key')   # kunci uji sekali pakai
 *   cd cloudflare-worker && npx wrangler dev --local --ip 127.0.0.1 --port 8787 \
 *     --var X402_RELAYER_PRIVATE_KEY:$RELAYER_KEY --var BASE_RPC:http://127.0.0.1:8545 \
 *     --var X402_COMPUTE_ENABLED:true --var X402_COMPUTE_PRICE_ATOMIC:5000 \
 *     --var X402_COMPUTE_ROUTER_URL:http://127.0.0.1:8799/v1 --var X402_COMPUTE_ROUTER_KEY:test-router-key
 *
 * Jalankan dari akar repo:
 *   RELAYER_KEY=$RELAYER_KEY npx tsx cloudflare-worker/test/compute-e2e.mts
 *
 * `.mts`, bukan `.ts`: package.json akar tidak `"type": "module"`, dan berkas ini memakai
 * top-level await.
 */
import { createServer } from "node:http";
import { ethers } from "ethers";
import { encodePaymentPayload, signAuthorization, USDC_BASE, type PaymentRequirements } from "../src/x402";

const WORKER = (process.env.WORKER_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");
const FORK_RPC = process.env.FORK_RPC || "http://127.0.0.1:8545";
const ROUTER_PORT = Number(process.env.ROUTER_PORT || 8799);
const ROUTER_KEY = process.env.ROUTER_KEY || "test-router-key";
const RELAYER_KEY = process.env.RELAYER_KEY || "";
const PATH = "/v1/compute/chat/completions";
const USDC_BALANCE_SLOT = 9n; // `balanceAndBlacklistStates` FiatTokenV2_2, diperiksa terhadap balanceOf di fork

let fails = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) fails++;
  console.log(`${pass ? "OK  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};
const head = (t: string) => console.log(`\n── ${t}`);

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

// ── router tiruan ──────────────────────────────────────────────────────────

const routerSeen: Array<{ auth: string | undefined; body: any }> = [];
const router = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    routerSeen.push({ auth: req.headers.authorization, body });
    if (req.url !== "/v1/chat/completions" || req.headers.authorization !== `Bearer ${ROUTER_KEY}`) {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "bad key" }));
      return;
    }
    if (JSON.stringify(body.messages).includes("FAIL")) {
      res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: "upstream exploded" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        id: "chatcmpl-e2e",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: "A bonding curve prices a token by its supply.", reasoning_content: "internal" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 830, completion_tokens: 12, total_tokens: 842 },
        x_0g_trace: { provider: "0xinternal" },
      })
    );
  });
});
await new Promise<void>((resolve) => router.listen(ROUTER_PORT, "127.0.0.1", resolve));

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
const relayer = new ethers.Wallet(RELAYER_KEY);
await provider.send("anvil_setBalance", [relayer.address, ethers.toQuantity(ethers.parseEther("1"))]);
const payer = ethers.Wallet.createRandom().connect(provider);
const broke = ethers.Wallet.createRandom().connect(provider);
await setUsdc(payer.address, 1_000_000n);
check("payer funded with 1 USDC on the fork", (await usdc.balanceOf(payer.address)) === 1_000_000n);

async function post(body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${WORKER}${PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 200) };
  }
  return { status: res.status, json, headers: res.headers };
}
const body = (content: string, extra: Record<string, unknown> = {}) => ({ messages: [{ role: "user", content }], ...extra });

// ── kasus ──────────────────────────────────────────────────────────────────

head("terms and limits");
const probe = await post(undefined);
check("no body: 402 with POST bazaar schema", probe.status === 402 && probe.json?.extensions?.bazaar?.info?.input?.method === "POST", `status ${probe.status}`);
const terms: PaymentRequirements = probe.json?.accepts?.[0];
check("price 5000 to the payee", terms?.maxAmountRequired === "5000" && /^0x/.test(String(terms?.payTo)), short(terms));
const tooLong = await post(body("x".repeat(8001)));
check("8001 characters: 400 before any charge", tooLong.status === 400 && tooLong.json?.error === "input_too_long");
const stream = await post(body("hi", { stream: true }));
check("stream true: 400", stream.status === 400 && stream.json?.error === "stream_not_supported");

head("the model fails: nothing is charged");
const payeeBefore = await usdc.balanceOf(terms.payTo);
const failAuth = await signAuthorization({ signer: payer, requirements: terms, provider });
const failed = await post(body("FAIL on purpose"), { "X-PAYMENT": encodePaymentPayload(failAuth) });
check("502 upstream_failed", failed.status === 502 && failed.json?.error === "upstream_failed", short(failed.json));
check("payer balance unchanged", (await usdc.balanceOf(payer.address)) === 1_000_000n);
check("that authorization's nonce is still unused", (await usdc.authorizationState(payer.address, failAuth.payload.authorization.nonce)) === false);

head("success: settled on chain, then the completion");
const routerCallsBefore = routerSeen.length;
const okAuth = await signAuthorization({ signer: payer, requirements: terms, provider });
const paid = await post(body("What is a bonding curve?", { max_tokens: 4096 }), { "X-PAYMENT": encodePaymentPayload(okAuth) });
check("200 with the completion", paid.status === 200 && paid.json?.choices?.[0]?.message?.content?.includes("bonding curve"), `status ${paid.status} ${short(paid.json?.error ?? "")}`);
check("internal router fields stripped", !/x_0g_trace|reasoning_content|internal/.test(JSON.stringify(paid.json)));
const sent = routerSeen[routerCallsBefore]?.body;
check("router got stream false, max_tokens 512, the key", sent?.stream === false && sent?.max_tokens === 512 && routerSeen[routerCallsBefore]?.auth === `Bearer ${ROUTER_KEY}`, short(sent));
check("payer paid exactly 5000 atoms", (await usdc.balanceOf(payer.address)) === 1_000_000n - 5000n);
check("payee received exactly 5000 atoms", (await usdc.balanceOf(terms.payTo)) - payeeBefore === 5000n);
check("nonce now used", (await usdc.authorizationState(payer.address, okAuth.payload.authorization.nonce)) === true);
const settleTx = String(paid.json?.x402?.settlement?.transaction ?? "");
const receipt = settleTx ? await provider.getTransactionReceipt(settleTx) : null;
check("settlement transaction mined on the fork", receipt?.status === 1, settleTx);
const header = paid.headers.get("x-payment-response");
check("X-PAYMENT-RESPONSE says success", Boolean(header) && JSON.parse(Buffer.from(String(header), "base64").toString("utf8")).success === true);

head("refused before the model");
const routerCallsMid = routerSeen.length;
const replay = await post(body("again"), { "X-PAYMENT": encodePaymentPayload(okAuth) });
check("a settled authorization replayed: 402 invalid_transaction_state", replay.status === 402 && replay.json?.error === "invalid_transaction_state", short(replay.json?.error));
const brokeAuth = await signAuthorization({ signer: broke, requirements: terms, provider });
const noFunds = await post(body("hi"), { "X-PAYMENT": encodePaymentPayload(brokeAuth) });
check("a payer without USDC: 402 insufficient_funds", noFunds.status === 402 && noFunds.json?.error === "insufficient_funds", short(noFunds.json?.error));
check("the model was not called for either", routerSeen.length === routerCallsMid);

head("discovery with the switch on");
const doc = await (await fetch(`${WORKER}/openapi.json`)).json();
check("openapi lists the compute route at 0.005", doc?.paths?.[PATH]?.post?.["x-payment-info"]?.price?.amount === "0.005");
const wk = await (await fetch(`${WORKER}/.well-known/x402`)).json();
// wrangler dev melaporkan host route-nya (x402.adexto.xyz) sebagai origin permintaan, bukan 127.0.0.1.
check(".well-known/x402 lists it", Array.isArray(wk?.resources) && wk.resources.some((r: string) => r.endsWith(PATH)));

router.close();
console.log(`\n${fails === 0 ? "ALL PASSED" : `${fails} FAILED`}`);
process.exit(fails === 0 ? 0 : 1);

function short(v: unknown) {
  return JSON.stringify(v ?? null).slice(0, 180);
}
