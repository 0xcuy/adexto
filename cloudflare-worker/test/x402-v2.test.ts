/**
 * Uji jalur x402 v2 yang ditambahkan di samping badan v1: header `PAYMENT-REQUIRED`, amplop
 * `PAYMENT-SIGNATURE`, header `PAYMENT-RESPONSE`, dan penolakan dua header yang berbeda isi.
 *
 * Tanpa wrangler, tanpa RPC, tanpa uang. Jalur bayar sungguhan (SDK resmi `@x402/fetch` terhadap
 * fork Base) ada di `buy-v2-e2e.mts`.
 *
 * Jalankan dari akar repo:  npx tsx --test cloudflare-worker/test/x402-v2.test.ts
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  base64Json,
  buildPaymentRequirements,
  caip2Network,
  decodePaymentPayload,
  encodePaymentPayload,
  paymentRequiredHeader,
  paymentResponseHeader,
  readPaymentHeader,
  v2Requirements,
  type PaymentPayload,
} from "../src/x402";
import { COMPUTE_PATH, handleCompute, resetComputeState, type ComputeDeps, type ComputeEnv } from "../src/compute";

const PAYEE = "0x24268Fffc119ec5550F68e80D94476fD64daE967";
const PAYER = "0x1111111111111111111111111111111111111111";
const ORIGIN = "https://x402.test";

const decode = (header: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(header), (c) => c.charCodeAt(0))));

const authorization = {
  from: PAYER,
  to: PAYEE,
  value: "5000",
  validAfter: "0",
  validBefore: "9999999999",
  nonce: "0x" + "aa".repeat(32),
};
const signature = "0x" + "11".repeat(65);

const requirements = buildPaymentRequirements({
  resource: `${ORIGIN}/v1/x402/buy/adexto`,
  description: "Buy $ADEXTO on 0G Mainnet with USDC on Base.",
  amountAtomic: 100000n,
  payTo: PAYEE,
});

/** Amplop persis seperti yang dirakit `@x402/core` 2.28 untuk x402Version 2. */
function v2Envelope(network = "eip155:8453") {
  return {
    x402Version: 2,
    payload: { authorization, signature },
    accepted: { ...v2Requirements(requirements), network },
    resource: { url: requirements.resource, description: "Buy $ADEXTO … on 0G", mimeType: "application/json" },
    extensions: {},
  };
}

test("decodePaymentPayload: the v1 envelope is unchanged", () => {
  const v1: PaymentPayload = { x402Version: 2, scheme: "exact", network: "base", payload: { signature, authorization } };
  const out = decodePaymentPayload(encodePaymentPayload(v1));
  assert.deepEqual(out, v1);
});

test("decodePaymentPayload: the v2 envelope maps to scheme exact and network base, including UTF-8 text", () => {
  const out = decodePaymentPayload(base64Json(v2Envelope()));
  assert.ok(out);
  assert.equal(out.x402Version, 2);
  assert.equal(out.scheme, "exact");
  assert.equal(out.network, "base");
  assert.deepEqual(out.payload, { authorization, signature });
});

test("decodePaymentPayload: another CAIP-2 network stays as it is, so verifyPayment refuses it", () => {
  const out = decodePaymentPayload(base64Json(v2Envelope("eip155:1")));
  assert.equal(out?.network, "eip155:1");
});

test("decodePaymentPayload: garbage and incomplete payloads are null", () => {
  assert.equal(decodePaymentPayload("%%%"), null);
  assert.equal(decodePaymentPayload(base64Json({ x402Version: 2, payload: { authorization } })), null);
  assert.equal(decodePaymentPayload(base64Json({ x402Version: 2, accepted: { scheme: "exact" } })), null);
});

test("readPaymentHeader: either name, the same value twice, or a conflict", () => {
  assert.deepEqual(readPaymentHeader(new Headers()), { value: null });
  assert.deepEqual(readPaymentHeader(new Headers({ "X-PAYMENT": "a" })), { value: "a" });
  assert.deepEqual(readPaymentHeader(new Headers({ "PAYMENT-SIGNATURE": "b" })), { value: "b" });
  assert.deepEqual(readPaymentHeader(new Headers({ "X-PAYMENT": "a", "PAYMENT-SIGNATURE": "a" })), { value: "a" });
  assert.deepEqual(readPaymentHeader(new Headers({ "X-PAYMENT": "a", "PAYMENT-SIGNATURE": "b" })), { conflict: true });
});

test("paymentRequiredHeader: the same terms in v2 form", () => {
  const header = paymentRequiredHeader({
    requirements,
    resource: { url: requirements.resource, description: "Buy … now", mimeType: "application/json" },
    error: "PAYMENT-SIGNATURE header is required",
    extensions: { bazaar: { info: { output: { example: { to: "0x… (the payer)" } } } } },
  });
  const pr = decode(header);
  assert.equal(pr.x402Version, 2);
  assert.equal(pr.error, "PAYMENT-SIGNATURE header is required");
  assert.equal(pr.resource.description, "Buy … now");
  assert.equal(pr.extensions.bazaar.info.output.example.to, "0x… (the payer)");
  assert.deepEqual(pr.accepts, [
    {
      scheme: "exact",
      network: "eip155:8453",
      amount: "100000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: PAYEE,
      maxTimeoutSeconds: 300,
      extra: { name: "USD Coin", version: "2", assetTransferMethod: "eip3009" },
    },
  ]);
});

test("paymentResponseHeader: CAIP-2 network, empty transaction when there is none", () => {
  assert.deepEqual(decode(paymentResponseHeader({ success: true, transaction: "0xab", network: "base", payer: PAYER })), {
    success: true,
    transaction: "0xab",
    network: "eip155:8453",
    payer: PAYER,
  });
  assert.deepEqual(decode(paymentResponseHeader({ success: false, errorReason: "unexpected_settle_error", network: "base" })), {
    success: false,
    transaction: "",
    network: "eip155:8453",
    errorReason: "unexpected_settle_error",
  });
  assert.equal(caip2Network("base"), "eip155:8453");
  assert.equal(caip2Network("eip155:10"), "eip155:10");
});

// ── compute: header yang sama lewat handler sungguhan, dependensi tiruan ─────────────────────

const computeEnv: ComputeEnv = {
  X402_PAYEE: PAYEE,
  X402_COMPUTE_ENABLED: "true",
  X402_COMPUTE_PRICE_ATOMIC: "5000",
  X402_COMPUTE_ROUTER_KEY: "test-key",
};
const goodBody = JSON.stringify({ messages: [{ role: "user", content: "Hello" }] });

function deps(opts: { verifyOk?: boolean } = {}) {
  const calls: string[] = [];
  const seen: PaymentPayload[] = [];
  const d: ComputeDeps = {
    async verify(payload) {
      calls.push("verify");
      seen.push(payload);
      return opts.verifyOk === false
        ? { isValid: false, invalidReason: "insufficient_funds", detail: "saldo 0", payer: PAYER }
        : { isValid: true, payer: PAYER };
    },
    async callRouter() {
      calls.push("router");
      return {
        ok: true,
        completion: {
          id: "c1",
          object: "chat.completion",
          created: 1,
          model: "m",
          choices: [{ index: 0, message: { role: "assistant", content: "Hi." }, finish_reason: "stop" }],
        },
      };
    },
    async settle() {
      calls.push("settle");
      return { success: true, transaction: "0x" + "ab".repeat(32), network: "base", payer: PAYER };
    },
  };
  return { d, calls, seen };
}

const post = (headers: Record<string, string>) =>
  new Request(`${ORIGIN}${COMPUTE_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: goodBody });

const computePayment = (nonce = "bb") => {
  const env = v2Envelope();
  return base64Json({
    ...env,
    accepted: { ...env.accepted, amount: "5000" },
    payload: { signature, authorization: { ...authorization, nonce: "0x" + nonce.repeat(32) } },
  });
};

beforeEach(() => resetComputeState());

test("compute: the unpaid 402 carries PAYMENT-REQUIRED with the compute terms", async () => {
  const { d, calls } = deps();
  const r = await handleCompute(post({}), computeEnv, d, ORIGIN);
  assert.equal(r.status, 402);
  const pr = decode(String(r.headers?.["PAYMENT-REQUIRED"]));
  assert.equal(pr.x402Version, 2);
  assert.equal(pr.accepts[0].network, "eip155:8453");
  assert.equal(pr.accepts[0].amount, "5000");
  assert.equal(pr.resource.url, `${ORIGIN}${COMPUTE_PATH}`);
  assert.ok(pr.extensions.bazaar);
  assert.deepEqual(calls, []);
});

test("compute: a v2 payment in PAYMENT-SIGNATURE is verified as exact on base, then both response headers", async () => {
  const { d, calls, seen } = deps();
  const r = await handleCompute(post({ "PAYMENT-SIGNATURE": computePayment() }), computeEnv, d, ORIGIN);
  assert.equal(r.status, 200);
  assert.deepEqual(calls, ["verify", "router", "settle"]);
  assert.equal(seen[0].scheme, "exact");
  assert.equal(seen[0].network, "base");
  assert.equal(decode(String(r.headers?.["PAYMENT-RESPONSE"])).network, "eip155:8453");
  assert.equal(decode(String(r.headers?.["X-PAYMENT-RESPONSE"])).network, "base");
});

test("compute: two different payments in two headers are refused before anything runs", async () => {
  const { d, calls } = deps();
  const r = await handleCompute(post({ "PAYMENT-SIGNATURE": computePayment("cc"), "X-PAYMENT": computePayment("dd") }), computeEnv, d, ORIGIN);
  assert.equal(r.status, 400);
  assert.equal((r.body as any).error, "conflicting_payment_headers");
  assert.deepEqual(calls, []);
});

test("compute: a failed verification repeats the reason in PAYMENT-REQUIRED", async () => {
  const { d, calls } = deps({ verifyOk: false });
  const r = await handleCompute(post({ "PAYMENT-SIGNATURE": computePayment("ee") }), computeEnv, d, ORIGIN);
  assert.equal(r.status, 402);
  assert.equal(decode(String(r.headers?.["PAYMENT-REQUIRED"])).error, "insufficient_funds");
  assert.deepEqual(calls, ["verify"]);
});
