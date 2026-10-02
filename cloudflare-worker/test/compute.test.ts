/**
 * Uji urutan compute berbayar tanpa wrangler, tanpa RPC, tanpa uang.
 *
 * verify, settle dan router diganti tiruan yang mencatat urutan panggilan, jadi yang diuji adalah
 * janji modulnya: tidak ada yang ditagih sebelum inferensi berhasil, hasil tidak dikirim sebelum
 * settlement berhasil, dan semua batas diperiksa sebelum pembayaran disentuh.
 *
 * Jalankan dari akar repo:  npx tsx --test cloudflare-worker/test/compute.test.ts
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  COMPUTE_LIMITS,
  COMPUTE_PATH,
  computeListing,
  formatUsdc,
  handleCompute,
  resetComputeState,
  routerCaller,
  sanitizeCompletion,
  type ComputeDeps,
  type ComputeEnv,
  type RouterRequest,
} from "../src/compute";
import { openApiDocument, wellKnownX402 } from "../src/discovery";
import { encodePaymentPayload, type PaymentPayload } from "../src/x402";

const ORIGIN = "https://x402.test";
const PAYEE = "0x24268Fffc119ec5550F68e80D94476fD64daE967";
const PAYER = "0x1111111111111111111111111111111111111111";

function env(over: Partial<ComputeEnv> = {}): ComputeEnv {
  return {
    X402_PAYEE: PAYEE,
    X402_COMPUTE_ENABLED: "true",
    X402_COMPUTE_PRICE_ATOMIC: "5000",
    X402_COMPUTE_ROUTER_KEY: "test-key",
    ...over,
  };
}

function payment(nonceByte = "aa"): string {
  const p: PaymentPayload = {
    x402Version: 2,
    scheme: "exact",
    network: "base",
    payload: {
      signature: "0x" + "11".repeat(65),
      authorization: {
        from: PAYER,
        to: PAYEE,
        value: "5000",
        validAfter: "0",
        validBefore: "9999999999",
        nonce: "0x" + nonceByte.repeat(32),
      },
    },
  };
  return encodePaymentPayload(p);
}

function request(body: unknown, headers: Record<string, string> = {}, method = "POST"): Request {
  return new Request(`${ORIGIN}${COMPUTE_PATH}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: method === "GET" ? undefined : body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body),
  });
}

const goodBody = { messages: [{ role: "user", content: "Hello" }] };

const completion = {
  id: "chatcmpl-1",
  object: "chat.completion" as const,
  created: 1,
  model: "0g/deepseek-v4-flash",
  choices: [{ index: 0, message: { role: "assistant" as const, content: "Hi there." }, finish_reason: "stop" }],
  usage: { prompt_tokens: 830, completion_tokens: 4, total_tokens: 834 },
};

/** Tiruan dengan pencatat urutan. Setiap langkah bisa dibuat gagal. */
function deps(opts: { verifyOk?: boolean; routerOk?: boolean; settleOk?: boolean; routerGate?: Promise<void> } = {}) {
  const calls: string[] = [];
  const routed: RouterRequest[] = [];
  const d: ComputeDeps = {
    async verify() {
      calls.push("verify");
      return opts.verifyOk === false
        ? { isValid: false, invalidReason: "insufficient_funds", detail: "saldo 0", payer: PAYER }
        : { isValid: true, payer: PAYER };
    },
    async callRouter(req) {
      calls.push("router");
      routed.push(req);
      if (opts.routerGate) await opts.routerGate;
      return opts.routerOk === false ? { ok: false, status: 500, detail: "boom" } : { ok: true, completion };
    },
    async settle() {
      calls.push("settle");
      return opts.settleOk === false
        ? { success: false, errorReason: "invalid_transaction_state", detail: "nonce sudah terpakai", payer: PAYER }
        : { success: true, transaction: "0x" + "ab".repeat(32), network: "base", payer: PAYER };
    },
  };
  return { d, calls, routed };
}

beforeEach(() => resetComputeState());

test("switch off: 404 compute_not_enabled and nothing is called", async () => {
  for (const value of [undefined, "", "false", "1", "yes"]) {
    const { d, calls } = deps();
    const r = await handleCompute(request(goodBody, { "X-PAYMENT": payment() }), env({ X402_COMPUTE_ENABLED: value }), d, ORIGIN);
    assert.equal(r.status, 404);
    assert.equal((r.body as any).error, "compute_not_enabled");
    assert.deepEqual(calls, []);
  }
});

test("switch on but unpriced or unkeyed: 503 before anything", async () => {
  for (const over of [{ X402_COMPUTE_PRICE_ATOMIC: "" }, { X402_COMPUTE_PRICE_ATOMIC: "0" }, { X402_COMPUTE_PRICE_ATOMIC: "abc" }, { X402_COMPUTE_ROUTER_KEY: "" }]) {
    const { d, calls } = deps();
    const r = await handleCompute(request(goodBody, { "X-PAYMENT": payment() }), env(over), d, ORIGIN);
    assert.equal(r.status, 503, JSON.stringify(over));
    assert.equal((r.body as any).error, "compute_not_configured");
    assert.deepEqual(calls, []);
  }
});

test("GET is 405", async () => {
  const { d } = deps();
  const r = await handleCompute(request(undefined, {}, "GET"), env(), d, ORIGIN);
  assert.equal(r.status, 405);
});

test("no body, no payment: 402 terms with a POST bazaar schema", async () => {
  const { d, calls } = deps();
  const r = await handleCompute(request(undefined), env(), d, ORIGIN);
  const b = r.body as any;
  assert.equal(r.status, 402);
  assert.equal(b.accepts[0].maxAmountRequired, "5000");
  assert.equal(b.accepts[0].amount, "5000");
  assert.equal(b.accepts[0].payTo, PAYEE);
  assert.equal(b.accepts[0].resource, `${ORIGIN}${COMPUTE_PATH}`);
  assert.equal(b.resource.url, `${ORIGIN}${COMPUTE_PATH}`);
  assert.equal(b.extensions.bazaar.info.input.method, "POST");
  assert.equal(b.extensions.bazaar.info.input.bodyType, "json");
  assert.deepEqual(b.extensions.bazaar.schema.properties.input.required, ["type", "method", "bodyType", "body"]);
  assert.equal(b.quote.price, "0.005 USDC");
  assert.deepEqual(calls, []);
});

test("limits are enforced before the payment is touched", async () => {
  const cases: Array<[unknown, string]> = [
    [{ messages: [{ role: "user", content: "x".repeat(COMPUTE_LIMITS.maxInputChars + 1) }] }, "input_too_long"],
    [{ ...goodBody, stream: true }, "stream_not_supported"],
    [{ ...goodBody, tools: [] }, "unsupported_parameter"],
    [{ ...goodBody, n: 3 }, "unsupported_parameter"],
    [{ ...goodBody, model: "gpt-5" }, "model_not_offered"],
    [{ messages: [] }, "messages_required"],
    [{ messages: [{ role: "system", content: "only system" }] }, "user_message_required"],
    [{ messages: [{ role: "tool", content: "x" }] }, "invalid_role"],
    [{ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://x" } }] }] }, "unsupported_content"],
    [{ ...goodBody, max_tokens: 0 }, "invalid_max_tokens"],
    [{ ...goodBody, temperature: 3 }, "invalid_temperature"],
    ["{not json", "invalid_json"],
  ];
  for (const [body, error] of cases) {
    const { d, calls } = deps();
    const r = await handleCompute(request(body, { "X-PAYMENT": payment() }), env(), d, ORIGIN);
    assert.equal(r.status, 400, error);
    assert.equal((r.body as any).error, error);
    assert.match(String((r.body as any).note), /No payment was taken/);
    assert.deepEqual(calls, [], error);
  }
  // Tepat di batas masih diterima.
  const { d } = deps();
  const ok = await handleCompute(request({ messages: [{ role: "user", content: "x".repeat(COMPUTE_LIMITS.maxInputChars) }] }), env(), d, ORIGIN);
  assert.equal(ok.status, 402);
});

test("max_tokens is capped at 512 and the router always gets stream: false and the one model", async () => {
  const unpaid = await handleCompute(request({ ...goodBody, max_tokens: 4096 }), env(), deps().d, ORIGIN);
  assert.equal(unpaid.status, 402);
  assert.equal((unpaid.body as any).quote.request.maxTokens, 512);
  assert.equal((unpaid.body as any).quote.request.maxTokensCapped, true);

  const { d, routed } = deps();
  const r = await handleCompute(
    request({ ...goodBody, max_tokens: 4096, stream: false, user: "u-1" }, { "X-PAYMENT": payment() }),
    env(),
    d,
    ORIGIN
  );
  assert.equal(r.status, 200);
  assert.equal(routed[0].max_tokens, 512);
  assert.equal(routed[0].stream, false);
  assert.equal(routed[0].model, "0g/deepseek-v4-flash");
  assert.equal((routed[0] as any).user, undefined);
});

test("a payload that is not base64 JSON: 402 invalid_payload, nothing called", async () => {
  const { d, calls } = deps();
  const r = await handleCompute(request(goodBody, { "X-PAYMENT": "%%%" }), env(), d, ORIGIN);
  assert.equal(r.status, 402);
  assert.equal((r.body as any).error, "invalid_payload");
  assert.deepEqual(calls, []);
});

test("verification fails: 402, the model is never called", async () => {
  const { d, calls } = deps({ verifyOk: false });
  const r = await handleCompute(request(goodBody, { "X-PAYMENT": payment() }), env(), d, ORIGIN);
  assert.equal(r.status, 402);
  assert.equal((r.body as any).error, "insufficient_funds");
  assert.deepEqual(calls, ["verify"]);
});

test("the model fails: 502 and NO settlement", async () => {
  const { d, calls } = deps({ routerOk: false });
  const r = await handleCompute(request(goodBody, { "X-PAYMENT": payment() }), env(), d, ORIGIN);
  assert.equal(r.status, 502);
  assert.equal((r.body as any).error, "upstream_failed");
  assert.match(String((r.body as any).note), /unused and still spendable/);
  assert.deepEqual(calls, ["verify", "router"]);
});

test("settlement fails: 402 and the completion is withheld", async () => {
  const { d, calls } = deps({ settleOk: false });
  const r = await handleCompute(request(goodBody, { "X-PAYMENT": payment() }), env(), d, ORIGIN);
  const b = r.body as any;
  assert.equal(r.status, 402);
  assert.equal(b.error, "settlement_failed");
  assert.equal(b.choices, undefined);
  assert.doesNotMatch(JSON.stringify(b), /Hi there/);
  assert.deepEqual(calls, ["verify", "router", "settle"]);
});

test("success: verify, model, settle in that order, then the completion with X-PAYMENT-RESPONSE", async () => {
  const { d, calls } = deps();
  const r = await handleCompute(request(goodBody, { "X-PAYMENT": payment() }), env(), d, ORIGIN);
  const b = r.body as any;
  assert.equal(r.status, 200);
  assert.deepEqual(calls, ["verify", "router", "settle"]);
  assert.equal(b.object, "chat.completion");
  assert.equal(b.choices[0].message.content, "Hi there.");
  assert.equal(b.x402.settlement.success, true);
  assert.equal(b.x402.settlement.amount, "5000");
  assert.equal(b.x402.settlement.payTo, PAYEE);
  const header = JSON.parse(Buffer.from(String(r.headers?.["X-PAYMENT-RESPONSE"]), "base64").toString("utf8"));
  assert.equal(header.success, true);
  assert.equal(header.payer, PAYER);
});

test("per-payer limit: refused before the model, with Retry-After", async () => {
  let now = 1_000_000;
  const e = env({ X402_COMPUTE_PAYER_LIMIT: "2/600" });
  for (const nonce of ["01", "02"]) {
    const { d } = deps();
    d.now = () => now;
    assert.equal((await handleCompute(request(goodBody, { "X-PAYMENT": payment(nonce) }), e, d, ORIGIN)).status, 200);
  }
  const { d, calls } = deps();
  d.now = () => now;
  const r = await handleCompute(request(goodBody, { "X-PAYMENT": payment("03") }), e, d, ORIGIN);
  assert.equal(r.status, 429);
  assert.equal(r.headers?.["Retry-After"], "600");
  assert.deepEqual(calls, ["verify"]);
  // Sesudah jendelanya lewat, payer yang sama dilayani lagi.
  now += 600_001;
  const later = deps();
  later.d.now = () => now;
  assert.equal((await handleCompute(request(goodBody, { "X-PAYMENT": payment("04") }), e, later.d, ORIGIN)).status, 200);
});

test("the same authorization twice at once: the second is refused before verification", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const first = deps({ routerGate: gate });
  const second = deps();
  const p1 = handleCompute(request(goodBody, { "X-PAYMENT": payment("77") }), env(), first.d, ORIGIN);
  await new Promise((r) => setTimeout(r, 10));
  const r2 = await handleCompute(request(goodBody, { "X-PAYMENT": payment("77") }), env(), second.d, ORIGIN);
  assert.equal(r2.status, 409);
  assert.deepEqual(second.calls, []);
  release();
  assert.equal((await p1).status, 200);
  // Sesudah yang pertama selesai, otorisasi itu tidak lagi "sedang dipakai".
  const third = deps();
  assert.equal((await handleCompute(request(goodBody, { "X-PAYMENT": payment("77") }), env(), third.d, ORIGIN)).status, 200);
});

test("router caller: sends the key and stream false, keeps only OpenAI fields, treats empty text as failure", async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const fakeFetch = (reply: () => Response) =>
    (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return reply();
    }) as unknown as typeof fetch;

  const call = routerCaller(
    env({ X402_COMPUTE_ROUTER_URL: "http://router.test/v1/" }),
    fakeFetch(() => new Response(JSON.stringify({ ...completion, x_0g_trace: { provider: "0xabc" }, choices: [{ ...completion.choices[0], message: { role: "assistant", content: "ok", reasoning_content: "internal" } }] }), { status: 200 }))
  );
  const res = await call({ model: "0g/deepseek-v4-flash", messages: [{ role: "user", content: "hi" }], max_tokens: 5, stream: false });
  assert.equal(res.ok, true);
  assert.equal(seen[0].url, "http://router.test/v1/chat/completions");
  assert.equal((seen[0].init.headers as Record<string, string>).authorization, "Bearer test-key");
  assert.equal(JSON.parse(String(seen[0].init.body)).stream, false);
  const text = JSON.stringify(res);
  assert.doesNotMatch(text, /x_0g_trace|reasoning_content|internal/);

  const empty = routerCaller(env(), fakeFetch(() => new Response(JSON.stringify({ choices: [{ message: { content: "  " } }] }), { status: 200 })));
  assert.equal((await empty({ model: "m", messages: [], max_tokens: 1, stream: false })).ok, false);
  const down = routerCaller(env(), fakeFetch(() => new Response("upstream exploded", { status: 503 })));
  const downRes = await down({ model: "m", messages: [], max_tokens: 1, stream: false });
  assert.equal(downRes.ok, false);
  assert.equal(downRes.ok === false ? downRes.status : 0, 503);
  assert.equal(sanitizeCompletion({ choices: [] }, "m"), null);
});

test("discovery: off means byte-identical documents; ready means one extra path and resource", () => {
  const markets = [{ slug: "parcel", chainId: 143, tradable: true }];
  const base = { gateway: ORIGIN, priceAtomic: 100000n, markets };
  const before = JSON.stringify(openApiDocument(base));
  const off = computeListing(env({ X402_COMPUTE_ENABLED: "false" }), ORIGIN);
  assert.equal(off, null);
  assert.equal(JSON.stringify(openApiDocument({ ...base, compute: off })), before);
  assert.equal(JSON.stringify(wellKnownX402(ORIGIN, markets, off)), JSON.stringify(wellKnownX402(ORIGIN, markets)));
  // Hidup tetapi tanpa harga juga tidak diiklankan.
  assert.equal(computeListing(env({ X402_COMPUTE_PRICE_ATOMIC: "" }), ORIGIN), null);

  const on = computeListing(env(), ORIGIN);
  assert.ok(on);
  const doc = openApiDocument({ ...base, compute: on }) as any;
  assert.deepEqual(Object.keys(doc.paths), ["/v1/x402/buy/{symbol}", COMPUTE_PATH]);
  assert.equal(doc.paths[COMPUTE_PATH].post["x-payment-info"].price.amount, "0.005");
  assert.equal(doc.paths["/v1/x402/buy/{symbol}"].get["x-payment-info"].price.amount, "0.10");
  const wk = wellKnownX402(ORIGIN, markets, on);
  assert.deepEqual(wk.resources, [`${ORIGIN}/v1/x402/buy/parcel?chain=143`, `${ORIGIN}${COMPUTE_PATH}`]);
});

test("formatUsdc", () => {
  assert.equal(formatUsdc(5000n), "0.005");
  assert.equal(formatUsdc(100000n), "0.1");
  assert.equal(formatUsdc(1_000_000n), "1");
  assert.equal(formatUsdc(1_234_567n), "1.234567");
});
