import { NextResponse } from "next/server";
import { A2aError, X402_EXTENSION_URI, cancelTask, getTask, listTasks, sendMessage, to03 } from "@/lib/a2a";
import { BodyTooLargeError, IMAGE_JSON_BODY_BYTES, readTextBody } from "@/lib/body-limit";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { ipHeadersOf } from "@/lib/agent-launch-http";

/**
 * Endpoint A2A (JSON-RPC 2.0) agen "ADEXTO Launchpad". Logika dan alasannya di `src/lib/a2a.ts`; kartu di
 * `/.well-known/agent-card.json`.
 *
 * Versi dari header `A2A-Version` (atau parameter kueri `A2A-Version`): kosong = 0.3 (wajib menurut §3.6.2),
 * "1.0" = 1.0, selain itu VersionNotSupportedError (-32009). Nama metode kedua versi diterima; bentuk
 * jawaban mengikuti versi yang diminta. Publik tanpa autentikasi, dibatasi per IP.
 */
const SEND_LIMIT = 60;
const READ_LIMIT = 300;
const WINDOW_MS = 5 * 60_000;

const METHOD_V1: Record<string, "send" | "get" | "cancel" | "list" | "stream" | "push" | "card"> = {
  SendMessage: "send",
  GetTask: "get",
  CancelTask: "cancel",
  ListTasks: "list",
  SendStreamingMessage: "stream",
  SubscribeToTask: "stream",
  CreateTaskPushNotificationConfig: "push",
  GetTaskPushNotificationConfig: "push",
  ListTaskPushNotificationConfigs: "push",
  DeleteTaskPushNotificationConfig: "push",
  GetExtendedAgentCard: "card",
  // 0.3
  "message/send": "send",
  "tasks/get": "get",
  "tasks/cancel": "cancel",
  "tasks/list": "list",
  "message/stream": "stream",
  "tasks/resubscribe": "stream",
  "tasks/pushNotificationConfig/set": "push",
  "tasks/pushNotificationConfig/get": "push",
  "tasks/pushNotificationConfig/list": "push",
  "tasks/pushNotificationConfig/delete": "push",
  "agent/getAuthenticatedExtendedCard": "card",
};

function rpc(id: unknown, body: { result: unknown } | { error: unknown }, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, ...body }, { status, headers: { "cache-control": "no-store", ...headers } });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const rawVersion = (req.headers.get("a2a-version") ?? url.searchParams.get("A2A-Version") ?? "").trim();
  const version = rawVersion === "" ? "0.3" : rawVersion.split(".").slice(0, 2).join(".");

  let text: string;
  try {
    text = await readTextBody(req, IMAGE_JSON_BODY_BYTES);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return rpc(null, { error: { code: -32600, message: `Request body is larger than ${IMAGE_JSON_BODY_BYTES} bytes.` } }, 413);
    return rpc(null, { error: { code: -32700, message: "Invalid JSON payload" } }, 400);
  }
  let msg: any;
  try {
    msg = JSON.parse(text);
  } catch {
    return rpc(null, { error: { code: -32700, message: "Invalid JSON payload" } }, 400);
  }
  if (Array.isArray(msg) || !msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpc(msg?.id ?? null, { error: { code: -32600, message: "Request payload validation error" } }, 400);
  }
  const id = msg.id;

  if (version !== "1.0" && version !== "0.3") {
    return rpc(id, {
      error: new A2aError(-32009, `A2A protocol version ${rawVersion.slice(0, 16)} is not supported. Supported: 1.0, 0.3.`, "VERSION_NOT_SUPPORTED", { supportedVersions: "1.0,0.3" }).toJsonRpc(),
    });
  }

  const op = Object.prototype.hasOwnProperty.call(METHOD_V1, msg.method) ? METHOD_V1[msg.method] : null;
  if (!op) return rpc(id, { error: { code: -32601, message: "Method not found" } });

  const limit = op === "send" ? SEND_LIMIT : READ_LIMIT;
  const gate = rateLimit(`a2a-${op === "send" ? "send" : "read"}:${clientIp(req)}`, limit, WINDOW_MS);
  if (!gate.ok) {
    return rpc(id, { error: { code: -32603, message: `Rate limit exceeded: at most ${limit} calls per 5 minutes. Retry after ${gate.retryAfter} s.` } }, 429, rateLimitHeaders(gate));
  }

  // Ekstensi yang diminta klien (A2A 1.0: `A2A-Extensions`; 0.3: `X-A2A-Extensions`). Yang kami dukung
  // digaungkan kembali sebagai tanda aktif. Tidak wajib, jadi permintaan tanpanya tetap dilayani.
  const requested = `${req.headers.get("a2a-extensions") ?? ""},${req.headers.get("x-a2a-extensions") ?? ""}`
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const extHeaders: Record<string, string> = requested.includes(X402_EXTENSION_URI)
    ? { "A2A-Extensions": X402_EXTENSION_URI, "X-A2A-Extensions": X402_EXTENSION_URI }
    : {};

  try {
    let result: unknown;
    if (op === "send") result = await sendMessage(msg.params, ipHeadersOf(req));
    else if (op === "get") result = getTask(msg.params);
    else if (op === "cancel") result = cancelTask(msg.params);
    else if (op === "list") result = listTasks(msg.params);
    else if (op === "stream") throw new A2aError(-32004, "Streaming is not supported by this agent. Use SendMessage and GetTask.", "UNSUPPORTED_OPERATION");
    else if (op === "push") throw new A2aError(-32003, "Push notifications are not supported by this agent.", "PUSH_NOTIFICATION_NOT_SUPPORTED");
    else throw new A2aError(-32004, "This agent has no extended agent card.", "UNSUPPORTED_OPERATION");
    return rpc(
      id,
      { result: version === "0.3" ? to03(result, op === "send" ? "message/send" : op === "get" ? "tasks/get" : op === "cancel" ? "tasks/cancel" : "") : result },
      200,
      extHeaders
    );
  } catch (e) {
    if (e instanceof A2aError) return rpc(id, { error: e.toJsonRpc() });
    return rpc(id, { error: { code: -32603, message: "Internal error" } }, 500);
  }
}

export async function GET() {
  return NextResponse.json(
    { endpoint: "/api/a2a", protocol: "A2A JSON-RPC 2.0", versions: ["1.0", "0.3"], agentCard: "/.well-known/agent-card.json" },
    { headers: { "cache-control": "public, max-age=300" } }
  );
}
