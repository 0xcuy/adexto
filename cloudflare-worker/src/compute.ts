/**
 * Compute berbayar per panggilan lewat x402: `POST /v1/compute/chat/completions`.
 *
 * APA YANG DIJUAL
 *
 * Satu chat completion OpenAI-compatible dari pool Agent Compute (Adexto Router di
 * `compute.adexto.xyz/v1`, model `0g/deepseek-v4-flash` di 0G Compute), dibayar dengan satu
 * otorisasi USDC di Base. Tanpa stake, tanpa akun, tanpa kunci API di sisi pemanggil. Gateway-nya
 * sama dengan pembelian token, jadi satu OpenAPI, satu payee, satu jalur settlement.
 *
 * SAKLAR, DAN APA ARTINYA "MATI"
 *
 * Mati kecuali `X402_COMPUTE_ENABLED` bernilai "true". Mati berarti rute ini menjawab 404
 * `compute_not_enabled` dan TIDAK disebut di `/openapi.json` maupun `/.well-known/x402`: kedua
 * dokumen itu byte-identik dengan sebelum modul ini ada. Hidup tetapi belum diberi harga
 * (`X402_COMPUTE_PRICE_ATOMIC`) atau kunci router (`X402_COMPUTE_ROUTER_KEY`) menjawab 503, juga
 * tanpa menagih dan juga tanpa muncul di discovery. Jadi tidak ada keadaan setengah jalan yang
 * mengiklankan sesuatu yang tidak bisa dibayar.
 *
 * URUTANNYA: VERIFIKASI → INFERENSI → SETTLE → BARU HASILNYA DIKIRIM
 *
 * Prinsipnya sama dengan pembelian token di `index.ts` (antar dulu, tagih kemudian), dengan satu
 * perbedaan yang disengaja di akhir:
 *   - router gagal → tidak ditagih; otorisasi yang ditandatangani tetap belum terpakai;
 *   - settle gagal → hasilnya DITAHAN. Token yang sudah terkirim tidak bisa ditarik, tetapi teks
 *     bisa. Kalau teksnya dikirim juga, otorisasi yang sengaja dibuat gagal (saldo dipindah
 *     sesudah verifikasi, nonce dipakai di tempat lain) menjadi jalan inferensi gratis tanpa
 *     batas. Biaya inferensi yang ditahan, ≈ $0,001, ditanggung kami.
 *
 * BATAS, SEMUANYA DIPERIKSA SEBELUM ADA YANG DITAGIH
 *
 *   - isi pesan total ≤ 8.000 karakter (≈ 2.000 token);
 *   - `max_tokens` dipaksa ≤ 512 (dipotong, bukan ditolak; jawaban 402 menyebutnya);
 *   - `stream: true` ditolak, dan `stream: false` dikirim EKSPLISIT ke router. Router mencatat
 *     pemakaian dari jawaban utuh; celah meteran SSE yang ditemukan 2 Okt tidak boleh bisa
 *     dijangkau lewat rute yang dibayar per panggilan;
 *   - parameter di luar daftar ditolak, bukan dibuang diam-diam: `tools` atau `n` yang
 *     dihilangkan tanpa kabar membuat pemanggil membayar jawaban untuk pertanyaan yang berbeda;
 *   - per payer: `X402_COMPUTE_PAYER_LIMIT` ("jumlah/detik", bawaan 20/600), dihitung per
 *     isolate. Ini rem, bukan pagar: plafon sebenarnya adalah batas bulanan kunci router.
 *
 * MODUL MURNI
 *
 * `handleCompute` menerima dependensinya (verify, settle, router), jadi urutan di atas diuji
 * tanpa wrangler dan tanpa uang: `cloudflare-worker/test/compute.test.ts`.
 */
import {
  buildPaymentRequirements,
  decodePaymentPayload,
  paymentRequiredHeader,
  paymentResponseHeader,
  readPaymentHeader,
  X402_VERSION,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResult,
  type VerifyResult,
} from "./x402";
import { resourceInfo, type ComputeListing } from "./discovery";

export const COMPUTE_PATH = "/v1/compute/chat/completions";

export const COMPUTE_LIMITS = {
  maxInputChars: 8_000,
  maxTokens: 512,
  maxMessages: 32,
  maxStop: 4,
  /** Badan mentah. 8.000 karakter isi plus amplop JSON jauh di bawah ini. */
  maxBodyBytes: 64_000,
} as const;

export const COMPUTE_DEFAULTS = {
  routerUrl: "https://compute.adexto.xyz/v1",
  model: "0g/deepseek-v4-flash",
  timeoutMs: 60_000,
  payerLimit: { count: 20, windowSeconds: 600 },
} as const;

export interface ComputeEnv {
  /** Penerima USDC, sama dengan pembelian token. */
  X402_PAYEE: string;
  /** "true" menyalakan rute. Nilai lain apa pun, termasuk kosong, berarti mati. */
  X402_COMPUTE_ENABLED?: string;
  /** Harga per panggilan dalam satuan terkecil USDC (6 desimal): 5000 = $0,005. Kosong = belum dijual. */
  X402_COMPUTE_PRICE_ATOMIC?: string;
  /** Basis OpenAI-compatible router, tanpa `/chat/completions`. */
  X402_COMPUTE_ROUTER_URL?: string;
  /** Rahasia (`wrangler secret put`): kunci router khusus produk ini, dengan plafon bulanan. */
  X402_COMPUTE_ROUTER_KEY?: string;
  /** Satu-satunya model yang dijual. */
  X402_COMPUTE_MODEL?: string;
  X402_COMPUTE_TIMEOUT_MS?: string;
  /** "jumlah/detik" per payer, misalnya "20/600". */
  X402_COMPUTE_PAYER_LIMIT?: string;
}

type Role = "system" | "user" | "assistant";

export interface RouterRequest {
  model: string;
  messages: Array<{ role: Role; content: string }>;
  max_tokens: number;
  /** Selalu false, dan selalu dikirim. Lihat catatan berkas. */
  stream: false;
  temperature?: number;
  top_p?: number;
  stop?: string[];
}

export interface Completion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{ index: number; message: { role: "assistant"; content: string }; finish_reason: string | null }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
}

export type RouterResult = { ok: true; completion: Completion } | { ok: false; status: number | null; detail: string };

export interface ComputeDeps {
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResult>;
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResult>;
  callRouter(request: RouterRequest): Promise<RouterResult>;
  /** Milidetik epoch. Disuntik di uji supaya batas per payer tidak bergantung jam. */
  now?(): number;
}

export interface ComputeReply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

const NO_CHARGE = "No payment was taken.";
const UNUSED = "No payment was taken. The authorization you signed is unused and still spendable.";

// ── konfigurasi ────────────────────────────────────────────────────────────

export function computeEnabled(env: Pick<ComputeEnv, "X402_COMPUTE_ENABLED">): boolean {
  return String(env.X402_COMPUTE_ENABLED ?? "").trim().toLowerCase() === "true";
}

export function computePriceAtomic(env: Pick<ComputeEnv, "X402_COMPUTE_PRICE_ATOMIC">): bigint | null {
  const raw = String(env.X402_COMPUTE_PRICE_ATOMIC ?? "").trim();
  if (!/^\d{1,12}$/.test(raw)) return null;
  const value = BigInt(raw);
  return value > 0n ? value : null;
}

export function computeModel(env: Pick<ComputeEnv, "X402_COMPUTE_MODEL">): string {
  return String(env.X402_COMPUTE_MODEL ?? "").trim() || COMPUTE_DEFAULTS.model;
}

/** Hidup, berharga, dan punya kunci router. Hanya dalam keadaan ini rute disebut di discovery. */
export function computeReady(env: ComputeEnv): boolean {
  return computeEnabled(env) && computePriceAtomic(env) !== null && Boolean(env.X402_COMPUTE_ROUTER_KEY) && Boolean(env.X402_PAYEE);
}

function payerLimit(env: ComputeEnv): { count: number; windowMs: number } {
  const m = /^(\d{1,5})\/(\d{1,6})$/.exec(String(env.X402_COMPUTE_PAYER_LIMIT ?? "").trim());
  if (!m) {
    return { count: COMPUTE_DEFAULTS.payerLimit.count, windowMs: COMPUTE_DEFAULTS.payerLimit.windowSeconds * 1000 };
  }
  return { count: Math.max(1, Number(m[1])), windowMs: Math.max(1, Number(m[2])) * 1000 };
}

/** 5000n → "0.005", 100000n → "0.1". `toFixed(2)` akan menampilkan $0,005 sebagai "0.01". */
export function formatUsdc(atomic: bigint): string {
  const whole = atomic / 1_000_000n;
  const frac = (atomic % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

// ── validasi badan ─────────────────────────────────────────────────────────

/** `user` diterima demi kompatibilitas klien OpenAI, tetapi tidak diteruskan ke router. */
const ACCEPTED_KEYS = ["model", "messages", "max_tokens", "max_completion_tokens", "temperature", "top_p", "stop", "stream", "user"];
const ROLES = new Set<Role>(["system", "user", "assistant"]);

export type ParsedBody =
  | { ok: true; request: RouterRequest; inputChars: number; requestedMaxTokens: number | null }
  | { ok: false; body: Record<string, unknown> };

/** Isi pesan sebagai teks: string, atau larik bagian `{type:"text", text}`. Selain itu null. */
function textOf(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  let out = "";
  for (const part of content) {
    if (!part || typeof part !== "object") return null;
    const p = part as { type?: unknown; text?: unknown };
    if (p.type !== "text" || typeof p.text !== "string") return null;
    out += p.text;
  }
  return out;
}

export function parseComputeBody(body: unknown, model: string): ParsedBody {
  const fail = (error: string, detail: string, extra: Record<string, unknown> = {}): ParsedBody => ({
    ok: false,
    body: { error, detail, ...extra, note: NO_CHARGE },
  });

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail("invalid_body", "The body must be a JSON object with a messages array.");
  }
  const b = body as Record<string, unknown>;

  const unknown = Object.keys(b).filter((k) => !ACCEPTED_KEYS.includes(k));
  if (unknown.length > 0) {
    return fail("unsupported_parameter", `Not accepted on this route: ${unknown.slice(0, 8).join(", ")}.`, { accepted: ACCEPTED_KEYS });
  }
  if (b.stream === true) {
    return fail("stream_not_supported", "This route answers with one JSON completion. Send stream: false or omit it.");
  }
  if (b.stream !== undefined && b.stream !== false) return fail("invalid_stream", "stream must be false or omitted.");
  if (b.model !== undefined && b.model !== model) {
    return fail("model_not_offered", `This route serves ${model} only.`, { model });
  }

  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    return fail("messages_required", "messages must be a non-empty array of {role, content}.");
  }
  if (b.messages.length > COMPUTE_LIMITS.maxMessages) {
    return fail("too_many_messages", `At most ${COMPUTE_LIMITS.maxMessages} messages per request.`);
  }
  const messages: RouterRequest["messages"] = [];
  let inputChars = 0;
  for (const [i, m] of b.messages.entries()) {
    if (!m || typeof m !== "object") return fail("invalid_message", `messages[${i}] must be an object.`);
    const role = (m as { role?: unknown }).role as Role;
    if (!ROLES.has(role)) return fail("invalid_role", `messages[${i}].role must be system, user or assistant.`);
    const content = textOf((m as { content?: unknown }).content);
    if (content === null) {
      return fail("unsupported_content", `messages[${i}].content must be a string or an array of text parts.`);
    }
    inputChars += content.length;
    messages.push({ role, content });
  }
  if (inputChars > COMPUTE_LIMITS.maxInputChars) {
    return fail(
      "input_too_long",
      `The messages hold ${inputChars} characters; the limit is ${COMPUTE_LIMITS.maxInputChars}.`,
      { inputChars, limit: COMPUTE_LIMITS.maxInputChars }
    );
  }
  if (!messages.some((m) => m.role === "user" && m.content.trim())) {
    return fail("user_message_required", "At least one message must have role user and some text.");
  }

  const rawMax = b.max_tokens ?? b.max_completion_tokens;
  let requestedMaxTokens: number | null = null;
  if (rawMax !== undefined && rawMax !== null) {
    if (typeof rawMax !== "number" || !Number.isInteger(rawMax) || rawMax < 1) {
      return fail("invalid_max_tokens", "max_tokens must be a positive integer.");
    }
    requestedMaxTokens = rawMax;
  }

  const request: RouterRequest = {
    model,
    messages,
    max_tokens: Math.min(requestedMaxTokens ?? COMPUTE_LIMITS.maxTokens, COMPUTE_LIMITS.maxTokens),
    stream: false,
  };
  if (b.temperature !== undefined) {
    if (typeof b.temperature !== "number" || !(b.temperature >= 0 && b.temperature <= 2)) {
      return fail("invalid_temperature", "temperature must be a number from 0 to 2.");
    }
    request.temperature = b.temperature;
  }
  if (b.top_p !== undefined) {
    if (typeof b.top_p !== "number" || !(b.top_p > 0 && b.top_p <= 1)) {
      return fail("invalid_top_p", "top_p must be a number above 0 and at most 1.");
    }
    request.top_p = b.top_p;
  }
  if (b.stop !== undefined) {
    const stop = typeof b.stop === "string" ? [b.stop] : b.stop;
    if (
      !Array.isArray(stop) ||
      stop.length > COMPUTE_LIMITS.maxStop ||
      stop.some((s) => typeof s !== "string" || s.length === 0 || s.length > 64)
    ) {
      return fail("invalid_stop", `stop must be a string or up to ${COMPUTE_LIMITS.maxStop} strings of 1 to 64 characters.`);
    }
    request.stop = stop as string[];
  }
  return { ok: true, request, inputChars, requestedMaxTokens };
}

// ── router ─────────────────────────────────────────────────────────────────

/**
 * Hanya bidang OpenAI yang dikirim balik. Jejak internal router (`x_0g_trace`, `reasoning_content`
 * dan sejenisnya) dibuang: pemanggil membayar jawaban, bukan isi log kami. Jawaban tanpa teks sama
 * sekali dianggap kegagalan router, jadi tidak ditagih.
 */
export function sanitizeCompletion(raw: unknown, model: string, nowMs = Date.now()): Completion | null {
  const j = (raw ?? {}) as Record<string, any>;
  const choices = Array.isArray(j.choices) ? j.choices : [];
  const out = choices.map((c: any, i: number) => ({
    index: Number.isInteger(c?.index) ? Number(c.index) : i,
    message: { role: "assistant" as const, content: typeof c?.message?.content === "string" ? c.message.content : "" },
    finish_reason: typeof c?.finish_reason === "string" ? c.finish_reason : null,
  }));
  if (out.length === 0 || !out.some((c: Completion["choices"][number]) => c.message.content.trim())) return null;
  const u = j.usage;
  const prompt = Number(u?.prompt_tokens);
  const completion = Number(u?.completion_tokens);
  const usage =
    Number.isFinite(prompt) && Number.isFinite(completion)
      ? { prompt_tokens: prompt, completion_tokens: completion, total_tokens: Number.isFinite(Number(u?.total_tokens)) ? Number(u.total_tokens) : prompt + completion }
      : null;
  return {
    id: typeof j.id === "string" && j.id ? j.id.slice(0, 120) : `adexto-${nowMs}`,
    object: "chat.completion",
    created: Number.isFinite(Number(j.created)) ? Number(j.created) : Math.floor(nowMs / 1000),
    model: typeof j.model === "string" && j.model ? j.model : model,
    choices: out,
    usage,
  };
}

/** Panggilan router yang sebenarnya. `fetchImpl` disuntik di uji. */
export function routerCaller(env: ComputeEnv, fetchImpl: typeof fetch = fetch): (request: RouterRequest) => Promise<RouterResult> {
  const base = String(env.X402_COMPUTE_ROUTER_URL || COMPUTE_DEFAULTS.routerUrl).replace(/\/+$/, "");
  const timeoutMs = Number(env.X402_COMPUTE_TIMEOUT_MS) > 0 ? Number(env.X402_COMPUTE_TIMEOUT_MS) : COMPUTE_DEFAULTS.timeoutMs;
  return async (request) => {
    let res: Response;
    try {
      res = await fetchImpl(`${base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env.X402_COMPUTE_ROUTER_KEY ?? ""}` },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e: any) {
      return { ok: false, status: null, detail: String(e?.name === "TimeoutError" ? `timeout after ${timeoutMs} ms` : e?.message ?? e).slice(0, 160) };
    }
    const text = await res.text().catch(() => "");
    if (!res.ok) return { ok: false, status: res.status, detail: text.slice(0, 160) };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, status: res.status, detail: "the router answered with something other than JSON" };
    }
    const completion = sanitizeCompletion(parsed, request.model);
    if (!completion) return { ok: false, status: res.status, detail: "the router answered without any completion text" };
    return { ok: true, completion };
  };
}

// ── batas per payer dan pemakaian ganda, per isolate ───────────────────────

const payerHits = new Map<string, number[]>();
const inFlight = new Set<string>();

function takePayerSlot(payer: string, limit: { count: number; windowMs: number }, now: number): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const key = payer.toLowerCase();
  const recent = (payerHits.get(key) ?? []).filter((t) => now - t < limit.windowMs);
  if (recent.length >= limit.count) {
    payerHits.set(key, recent);
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + limit.windowMs - now) / 1000)) };
  }
  recent.push(now);
  payerHits.set(key, recent);
  // Peta ini hidup selama isolate hidup; payer yang sudah lewat jendelanya dibuang sesekali.
  if (payerHits.size > 5_000) {
    for (const [k, v] of payerHits) if (v.every((t) => now - t >= limit.windowMs)) payerHits.delete(k);
  }
  return { ok: true };
}

/** Hanya untuk uji: mulai dari isolate kosong. */
export function resetComputeState(): void {
  payerHits.clear();
  inFlight.clear();
}

// ── discovery ──────────────────────────────────────────────────────────────

function bodySchema(model: string) {
  return {
    type: "object",
    properties: {
      messages: {
        type: "array",
        minItems: 1,
        maxItems: COMPUTE_LIMITS.maxMessages,
        description: `OpenAI chat messages. All content together at most ${COMPUTE_LIMITS.maxInputChars} characters; at least one user message.`,
        items: {
          type: "object",
          properties: {
            role: { type: "string", enum: ["system", "user", "assistant"] },
            content: { type: "string", description: "Text. An array of {type: \"text\", text} parts is also accepted." },
          },
          required: ["role", "content"],
        },
      },
      max_tokens: { type: "integer", minimum: 1, maximum: COMPUTE_LIMITS.maxTokens, description: `Capped at ${COMPUTE_LIMITS.maxTokens}; larger values are lowered, not refused.` },
      max_completion_tokens: { type: "integer", minimum: 1, description: "Alias of max_tokens." },
      temperature: { type: "number", minimum: 0, maximum: 2 },
      top_p: { type: "number", exclusiveMinimum: 0, maximum: 1 },
      stop: {
        anyOf: [
          { type: "string", minLength: 1, maxLength: 64 },
          { type: "array", maxItems: COMPUTE_LIMITS.maxStop, items: { type: "string", minLength: 1, maxLength: 64 } },
        ],
      },
      model: { type: "string", enum: [model], description: "Optional. The one model this route serves." },
      stream: { type: "boolean", const: false, description: "Streaming is not offered." },
      user: { type: "string", description: "Accepted for client compatibility; not forwarded." },
    },
    required: ["messages"],
    additionalProperties: false,
  };
}

function bodyExample() {
  return {
    messages: [{ role: "user", content: "Summarize what a bonding curve is in two sentences." }],
    max_tokens: 256,
  };
}

function completionExample(model: string) {
  return {
    id: "chatcmpl-…",
    object: "chat.completion",
    model,
    choices: [{ index: 0, message: { role: "assistant", content: "…" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    x402: { settlement: { success: true, transaction: "0x…", network: "base", amount: "…" } },
  };
}

function computeDescription(model: string): string {
  return (
    `One OpenAI-compatible chat completion from ${model} on 0G Compute, paid with USDC on Base. ` +
    `Up to ${COMPUTE_LIMITS.maxInputChars} input characters and ${COMPUTE_LIMITS.maxTokens} output tokens. ` +
    "The completion is returned only after the payment settles; a failed model call is not charged."
  );
}

/** `extensions.bazaar` untuk rute POST: bentuk `createBodyDiscoveryExtension` dari @x402/extensions. */
export function computeBazaarExtension(model: string) {
  return {
    info: {
      input: { type: "http", method: "POST", bodyType: "json", body: bodyExample() },
      output: { type: "json", example: completionExample(model) },
    },
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        input: {
          type: "object",
          properties: {
            type: { type: "string", const: "http" },
            method: { type: "string", enum: ["POST", "PUT", "PATCH"] },
            bodyType: { type: "string", enum: ["json", "form-data", "text"] },
            body: bodySchema(model),
          },
          required: ["type", "method", "bodyType", "body"],
          additionalProperties: false,
        },
        output: {
          type: "object",
          properties: { type: { type: "string" }, example: { type: "object" } },
          required: ["type"],
        },
      },
      required: ["input"],
    },
  };
}

/**
 * Entri discovery untuk rute ini (OpenAPI + `/.well-known/x402`), atau null. Null kecuali
 * `computeReady`, jadi saklar mati berarti dokumen discovery tidak berubah sama sekali.
 */
export function computeListing(env: ComputeEnv, gateway: string): ComputeListing | null {
  const price = computePriceAtomic(env);
  if (!computeReady(env) || price === null) return null;
  const model = computeModel(env);
  const usd = formatUsdc(price);
  const post = {
    operationId: "chatCompletion",
    summary: `One OpenAI-compatible chat completion for ${usd} USDC on Base`,
    description:
      `${computeDescription(model)} Unpaid: 402 with accepts[0]. Refused before any charge: invalid body or ` +
      "limits (400), too many requests from one payer (429), compute not configured (503).",
    security: [],
    parameters: [
      {
        name: "X-PAYMENT",
        in: "header",
        required: false,
        description: "Base64 x402 payment payload. Omit it to receive the 402 terms.",
        schema: { type: "string" },
      },
      {
        name: "PAYMENT-SIGNATURE",
        in: "header",
        required: false,
        description: "The same payment in the x402 v2 envelope, as sent by @x402/fetch. Use one header, not both.",
        schema: { type: "string" },
      },
    ],
    requestBody: {
      required: true,
      content: { "application/json": { schema: bodySchema(model), example: bodyExample() } },
    },
    "x-payment-info": {
      price: { mode: "fixed", currency: "USD", amount: usd },
      protocols: [{ x402: { scheme: "exact", network: "base", asset: "USDC" } }],
    },
    responses: {
      "200": {
        description: "Settled. A chat.completion with x402.settlement added.",
        content: { "application/json": { schema: { type: "object" }, example: completionExample(model) } },
      },
      "400": { description: "Invalid body or over a limit. No payment was taken." },
      "402": {
        description:
          "Payment Required, a payment that failed verification, or a settlement that failed (the completion is withheld and nothing is charged).",
      },
      "409": { description: "The same authorization is already in use by another request. No payment was taken." },
      "429": { description: "Too many requests from this payer. No payment was taken." },
      "502": { description: "The model failed. No payment was taken." },
      "503": { description: "Compute is not configured. No payment was taken." },
    },
  };
  return {
    resource: `${gateway}${COMPUTE_PATH}`,
    instructions:
      `${gateway}${COMPUTE_PATH} sells one ${model} chat completion for ${usd} USDC: POST an OpenAI chat body, ` +
      "pay the same way, and the completion is returned after the payment settles.",
    openApi: {
      path: COMPUTE_PATH,
      item: { post },
      guidance:
        ` POST ${COMPUTE_PATH} with an OpenAI chat body (messages, optional max_tokens up to ${COMPUTE_LIMITS.maxTokens}) ` +
        `for one ${model} completion at ${usd} USDC; the payment flow is the same, and the completion is returned ` +
        "only after the payment settles.",
    },
  };
}

// ── handler ────────────────────────────────────────────────────────────────

/** Header `PAYMENT-REQUIRED` (x402 v2) untuk setiap 402 compute; `error` membawa alasannya. */
function v2Challenge(requirements: PaymentRequirements, model: string, error: string): Record<string, string> {
  return {
    "PAYMENT-REQUIRED": paymentRequiredHeader({
      requirements,
      resource: resourceInfo({ url: requirements.resource, description: requirements.description }),
      error,
      extensions: { bazaar: computeBazaarExtension(model) },
    }),
  };
}

function challenge(requirements: PaymentRequirements, model: string, parsed: Extract<ParsedBody, { ok: true }> | null): ComputeReply {
  return {
    status: 402,
    body: {
      x402Version: X402_VERSION,
      error: "X-PAYMENT header is required",
      resource: resourceInfo({ url: requirements.resource, description: requirements.description }),
      accepts: [{ ...requirements, amount: requirements.maxAmountRequired }],
      extensions: { bazaar: computeBazaarExtension(model) },
      quote: {
        model,
        price: `${formatUsdc(BigInt(requirements.maxAmountRequired))} USDC`,
        limits: { maxInputChars: COMPUTE_LIMITS.maxInputChars, maxTokens: COMPUTE_LIMITS.maxTokens, stream: false },
        ...(parsed
          ? {
              request: {
                inputChars: parsed.inputChars,
                maxTokens: parsed.request.max_tokens,
                maxTokensCapped: parsed.requestedMaxTokens !== null && parsed.requestedMaxTokens > COMPUTE_LIMITS.maxTokens,
              },
            }
          : {}),
        order: "Verify the payment, run the model, settle, then return the completion. A failed model call is not charged.",
      },
    },
    headers: {
      "WWW-Authenticate": 'x402 realm="adexto-compute"',
      ...v2Challenge(requirements, model, "PAYMENT-SIGNATURE header is required"),
    },
  };
}

const b64 = (o: unknown) =>
  typeof btoa === "function" ? btoa(JSON.stringify(o)) : Buffer.from(JSON.stringify(o), "utf8").toString("base64");

export async function handleCompute(request: Request, env: ComputeEnv, deps: ComputeDeps, origin: string): Promise<ComputeReply> {
  if (!computeEnabled(env)) {
    return { status: 404, body: { error: "compute_not_enabled", detail: "Paid compute is not enabled on this gateway." } };
  }
  if (request.method !== "POST") {
    return {
      status: 405,
      body: { error: "method_not_allowed", detail: `Use POST ${COMPUTE_PATH} with an OpenAI chat body.` },
      headers: { Allow: "POST, OPTIONS" },
    };
  }
  const price = computePriceAtomic(env);
  if (price === null || !env.X402_COMPUTE_ROUTER_KEY || !env.X402_PAYEE) {
    return {
      status: 503,
      body: { error: "compute_not_configured", detail: "Paid compute has no price or no model key configured yet.", note: NO_CHARGE },
    };
  }

  const model = computeModel(env);
  const requirements = buildPaymentRequirements({
    resource: `${origin}${COMPUTE_PATH}`,
    description: computeDescription(model),
    amountAtomic: price,
    payTo: env.X402_PAYEE,
  });

  // `content-length` yang mengaku besar ditolak SEBELUM badan dibaca: `text()` menampung badan
  // utuh di memori isolate (128 MB), dan pemeriksaan panjang sesudahnya sudah terlambat.
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > COMPUTE_LIMITS.maxBodyBytes) {
    return { status: 413, body: { error: "body_too_large", detail: `The body is over ${COMPUTE_LIMITS.maxBodyBytes} bytes.`, note: NO_CHARGE } };
  }
  const raw = await request.text();
  if (raw.length > COMPUTE_LIMITS.maxBodyBytes) {
    return { status: 413, body: { error: "body_too_large", detail: `The body is over ${COMPUTE_LIMITS.maxBodyBytes} bytes.`, note: NO_CHARGE } };
  }
  let json: unknown = undefined;
  if (raw.trim()) {
    try {
      json = JSON.parse(raw);
    } catch {
      return { status: 400, body: { error: "invalid_json", detail: "The body is not valid JSON.", note: NO_CHARGE } };
    }
  }
  const paymentRead = readPaymentHeader(request.headers);
  if ("conflict" in paymentRead) {
    return {
      status: 400,
      body: {
        error: "conflicting_payment_headers",
        detail: "X-PAYMENT and PAYMENT-SIGNATURE carry different payments. Send one payment in one header.",
        note: NO_CHARGE,
      },
    };
  }
  const paymentHeader = paymentRead.value;

  // Tanpa badan: probe discovery. Dijawab dengan syarat pembayaran, bukan galat, supaya indexer
  // yang mengetuk rute tanpa isi membaca skema badan dari `extensions.bazaar`.
  if (json === undefined) {
    if (paymentHeader) {
      return { status: 400, body: { error: "messages_required", detail: "Send the chat body with the payment.", note: UNUSED } };
    }
    return challenge(requirements, model, null);
  }

  const parsed = parseComputeBody(json, model);
  if (!parsed.ok) {
    return { status: 400, body: paymentHeader ? { ...parsed.body, note: UNUSED } : parsed.body };
  }
  if (!paymentHeader) return challenge(requirements, model, parsed);

  const payload = decodePaymentPayload(paymentHeader);
  if (!payload) {
    return {
      status: 402,
      body: { x402Version: X402_VERSION, error: "invalid_payload", detail: "X-PAYMENT (or PAYMENT-SIGNATURE) must be base64 JSON", accepts: [requirements] },
      headers: v2Challenge(requirements, model, "invalid_payload"),
    };
  }

  /**
   * Satu otorisasi, satu permintaan yang sedang jalan. Tanpa ini otorisasi yang sama yang dikirim
   * sepuluh kali bersamaan lolos verifikasi sepuluh kali (nonce-nya belum terpakai), menjalankan
   * sepuluh inferensi, lalu hanya satu yang ter-settle. Hasil sembilan lainnya memang ditahan,
   * tetapi inferensinya sudah dibayar kami. Per isolate; lintas isolate dibatasi oleh settle.
   */
  const a = payload.payload.authorization;
  const flightKey = `${String(a.from).toLowerCase()}:${String(a.nonce).toLowerCase()}`;
  if (inFlight.has(flightKey)) {
    return { status: 409, body: { error: "payment_in_use", detail: "This authorization is already being used by another request.", note: NO_CHARGE } };
  }
  inFlight.add(flightKey);
  try {
    const pre = await deps.verify(payload, requirements);
    if (!pre.isValid) {
      return {
        status: 402,
        body: { x402Version: X402_VERSION, error: pre.invalidReason, detail: pre.detail, payer: pre.payer, accepts: [requirements] },
        headers: v2Challenge(requirements, model, pre.invalidReason ?? "unexpected_verify_error"),
      };
    }
    const payer = String(pre.payer ?? a.from);

    const slot = takePayerSlot(payer, payerLimit(env), deps.now ? deps.now() : Date.now());
    if (!slot.ok) {
      return {
        status: 429,
        body: { error: "rate_limited", detail: "Too many paid requests from this payer.", retryAfterSeconds: slot.retryAfterSeconds, note: UNUSED },
        headers: { "Retry-After": String(slot.retryAfterSeconds) },
      };
    }

    // Inferensi dulu. Gagal di sini berarti tidak ada yang ditagih.
    const routed = await deps.callRouter(parsed.request);
    if (!routed.ok) {
      return {
        status: 502,
        body: { error: "upstream_failed", detail: "The model did not return a completion.", upstreamStatus: routed.status, note: UNUSED },
      };
    }

    // Baru tagih. Gagal di sini berarti hasilnya ditahan.
    const settled = await deps.settle(payload, requirements);
    if (!settled.success) {
      return {
        status: 402,
        body: {
          x402Version: X402_VERSION,
          error: "settlement_failed",
          errorReason: settled.errorReason,
          detail: settled.detail,
          payer: settled.payer,
          accepts: [requirements],
          note: "The completion is withheld because the payment did not settle. Nothing was charged.",
        },
        headers: v2Challenge(requirements, model, settled.errorReason ?? "unexpected_settle_error"),
      };
    }

    return {
      status: 200,
      body: {
        ...routed.completion,
        x402: {
          settlement: {
            success: true,
            transaction: settled.transaction,
            network: settled.network,
            payer: settled.payer,
            asset: requirements.asset,
            amount: requirements.maxAmountRequired,
            payTo: requirements.payTo,
          },
          limits: { maxInputChars: COMPUTE_LIMITS.maxInputChars, maxTokens: parsed.request.max_tokens },
        },
      },
      headers: {
        "X-PAYMENT-RESPONSE": b64({
          success: true,
          transaction: settled.transaction,
          network: requirements.network,
          payer: settled.payer,
        }),
        "PAYMENT-RESPONSE": paymentResponseHeader({
          success: true,
          transaction: settled.transaction,
          network: requirements.network,
          payer: settled.payer,
        }),
      },
    };
  } finally {
    inFlight.delete(flightKey);
  }
}
