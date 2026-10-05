/**
 * A2A `buy_token` (a2a-x402 v0.2) against a running site, WITHOUT paying anything.
 *
 * Every payment this script sends is deliberately wrong (amount, payTo, network, expiry) or is a
 * rejection, so each one must be refused by the A2A agent before it reaches the gateway. A valid
 * payment is never built: the paid path is exercised only by the recorded mainnet run.
 *
 * Usage: BASE_URL=http://127.0.0.1:3607 node scripts/test-a2a-buy.mjs [SYMBOL] [CHAIN_ID]
 */
import { ethers } from "ethers";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3607").replace(/\/$/, "");
const SYMBOL = (process.argv[2] || "LOOP").toUpperCase();
const CHAIN = Number(process.argv[3] || 42161);
const EXT = "https://github.com/google-agentic-commerce/a2a-x402/blob/main/spec/v0.2";
const wallet = ethers.Wallet.createRandom(); // throwaway, holds nothing

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
};
let n = 0;
async function rpc(method, params, version = "1.0", headers = {}) {
  const res = await fetch(`${BASE}/api/a2a`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(version ? { "A2A-Version": version } : {}), ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }),
  });
  return { headers: res.headers, body: await res.json() };
}
const msg = (extra) => ({ messageId: crypto.randomUUID(), role: "ROLE_USER", ...extra });

async function sign(accept, overrides = {}) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const authorization = {
    from: wallet.address,
    to: accept.payTo,
    value: String(accept.maxAmountRequired ?? accept.amount),
    validAfter: String(now - 60n),
    validBefore: String(now + 300n),
    nonce: ethers.hexlify(ethers.randomBytes(32)),
    ...overrides,
  };
  const signature = await wallet.signTypedData(
    { name: accept.extra?.name ?? "USD Coin", version: accept.extra?.version ?? "2", chainId: 8453, verifyingContract: accept.asset },
    {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    authorization
  );
  return { x402Version: 1, scheme: "exact", network: accept.network, payload: { signature, authorization } };
}

// 1. card
const card = await (await fetch(`${BASE}/.well-known/agent-card.json`)).json();
check("card lists buy_token", card.skills?.some((s) => s.id === "buy_token"));
check("card declares the x402 extension", card.capabilities?.extensions?.some((e) => e.uri === EXT && e.required === false));

// 2. 402 over v1.0, with the extension activated
const r1 = await rpc("SendMessage", { message: msg({ parts: [{ data: { skill: "buy_token", symbol: SYMBOL, chainId: CHAIN, to: wallet.address } }] }) }, "1.0", { "A2A-Extensions": EXT });
const t1 = r1.body.result?.task;
const meta1 = t1?.status?.message?.metadata ?? {};
const accept = meta1["x402.payment.required"]?.accepts?.[0];
check("v1.0 buy_token → INPUT_REQUIRED", t1?.status?.state === "TASK_STATE_INPUT_REQUIRED", JSON.stringify(r1.body).slice(0, 300));
check("metadata payment-required", meta1["x402.payment.status"] === "payment-required");
check("accepts[0] is USDC on Base to the treasury", accept && String(accept.asset).toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" && /^0x[0-9a-fA-F]{40}$/.test(accept.payTo));
check("extension echoed in the response header", (r1.headers.get("a2a-extensions") ?? "").includes(EXT));

if (accept) {
  const cont = async (metadata, parts = [{ text: "payment" }]) =>
    (await rpc("SendMessage", { message: msg({ taskId: t1.id, contextId: t1.contextId, parts, metadata }) })).body.result?.task;

  // 3. wrong amount, wrong payTo, wrong network, expired: refused locally, task stays open
  const wrongAmount = await cont({ "x402.payment.status": "payment-submitted", "x402.payment.payload": await sign(accept, { value: "1" }) });
  check("wrong amount refused before the gateway", wrongAmount?.status?.state === "TASK_STATE_INPUT_REQUIRED" && wrongAmount.status.message.metadata["x402.payment.error"] === "INVALID_AMOUNT");
  const wrongTo = await cont({ "x402.payment.status": "payment-submitted", "x402.payment.payload": await sign(accept, { to: wallet.address }) });
  check("wrong payTo refused", wrongTo?.status?.message?.metadata?.["x402.payment.error"] === "INVALID_AMOUNT");
  const badNet = { ...(await sign(accept)), network: "polygon" };
  const wrongNet = await cont({ "x402.payment.status": "payment-submitted", "x402.payment.payload": badNet });
  check("wrong network refused", wrongNet?.status?.message?.metadata?.["x402.payment.error"] === "NETWORK_MISMATCH");
  const old = BigInt(Math.floor(Date.now() / 1000));
  const expired = await cont({ "x402.payment.status": "payment-submitted", "x402.payment.payload": await sign(accept, { validAfter: String(old - 900n), validBefore: String(old - 600n) }) });
  check("expired authorization refused", expired?.status?.message?.metadata?.["x402.payment.error"] === "EXPIRED_PAYMENT");
  const garbage = await cont({}, [{ data: { xPayment: "not-base64-json" } }]);
  check("malformed xPayment keeps the task waiting", garbage?.status?.state === "TASK_STATE_INPUT_REQUIRED");
  check(
    "history keeps the payment status but not the signed payload",
    JSON.stringify(garbage?.history ?? []).includes("payment-submitted") && !JSON.stringify(garbage?.history ?? []).includes('"signature"')
  );

  // 4. reject → canceled, terminal
  const rejected = await cont({ "x402.payment.status": "payment-rejected" });
  check("payment-rejected → CANCELED", rejected?.status?.state === "TASK_STATE_CANCELED");
  const after = await rpc("SendMessage", { message: msg({ taskId: t1.id, parts: [{ text: "again" }] }) });
  check("ended task refuses more input", after.body.error?.code === -32004);
}

// 5. 0.3 shape
const r3 = await rpc("message/send", { message: { kind: "message", messageId: crypto.randomUUID(), role: "user", parts: [{ kind: "data", data: { skill: "buy_token", symbol: SYMBOL, chainId: CHAIN, to: wallet.address } }] } }, "");
check("0.3 buy_token → input-required with metadata", r3.body.result?.status?.state === "input-required" && r3.body.result?.status?.message?.metadata?.["x402.payment.status"] === "payment-required");

// 6. bad input and unknown task
const bad = await rpc("SendMessage", { message: msg({ parts: [{ data: { skill: "buy_token", symbol: SYMBOL, chainId: CHAIN, to: "nope" } }] }) });
check("invalid recipient → REJECTED", bad.body.result?.task?.status?.state === "TASK_STATE_REJECTED");
const unknown = await rpc("SendMessage", { message: msg({ parts: [{ data: { skill: "buy_token", symbol: "NOSUCHMKT", chainId: CHAIN, to: wallet.address } }] }) });
check("unknown market → REJECTED, nothing charged", unknown.body.result?.task?.status?.state === "TASK_STATE_REJECTED");
const foreign = await rpc("SendMessage", { message: msg({ taskId: crypto.randomUUID(), parts: [{ text: "x" }] }) });
check("foreign taskId → TaskNotFound", foreign.body.error?.code === -32001);

// 7. list_markets is public-only
const lm = await rpc("SendMessage", { message: msg({ parts: [{ data: { skill: "list_markets" } }] }) });
const syms = (lm.body.result?.message?.parts ?? []).find((p) => p.data)?.data?.markets?.map((m) => `${m.chainId}:${m.symbol}`) ?? [];
check("list_markets never lists 42161:ARBTTEST", !syms.includes("42161:ARBTTEST"), syms.join(","));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
