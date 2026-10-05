import { randomUUID } from "node:crypto";
import { prepareLaunch, registerLaunch, type IpHeaders } from "@/lib/agent-launch";
import { findProject, listProjects, type ProjectRecord } from "@/lib/registry";
import { resolveChainOrDefault } from "@/lib/chains";

/**
 * Agen A2A "ADEXTO Launchpad": peluncuran pasar lewat Agent2Agent Protocol, dengan kunci agen pemanggil.
 *
 * SPESIFIKASI: A2A v1.0 (a2a-protocol.org/latest, diperiksa 5 Okt 2026), binding JSON-RPC 2.0. Metode
 * PascalCase (`SendMessage`, `GetTask`, `ListTasks`, `CancelTask`), state `TASK_STATE_*`, part tanpa
 * `kind`. Header `A2A-Version` yang kosong WAJIB dibaca 0.3 (§3.6.2), jadi bentuk 0.3 (`message/send`,
 * `kind`, state huruf kecil) juga dilayani lewat penerjemah di bawah. Model internal selalu v1.0.
 *
 * APA YANG DILAKUKAN AGEN INI, dan yang tidak:
 *   - Deterministik, tanpa LLM: pesan teks bebas dijawab dengan cara memakai skill, bukan ditebak.
 *   - `launch_market` adalah SATU task multi-turn yang memanggil fungsi yang sama dengan MCP:
 *       data peluncuran → INPUT_REQUIRED + `attestationMessage`
 *       `attestationSignature` → INPUT_REQUIRED + artifact transaksi tanpa tanda tangan
 *       `txHash` → `register_launch` → COMPLETED + artifact pasar
 *     Server tidak pernah memegang kunci; pemanggil menandatangani dan mengirim sendiri.
 *   - `list_markets` / `get_market` dijawab sebagai Message langsung, tanpa task.
 *   - Tanpa streaming, push notification, atau extended card (dinyatakan false di kartu).
 *
 * TANPA AUTENTIKASI, dan cakupannya: id task adalah UUID acak yang hanya diketahui pembuatnya, jadi
 * `GetTask`/`CancelTask` berlaku sebagai kapabilitas pemegang id. `ListTasks` hanya mengembalikan task
 * dalam `contextId` yang diberikan (juga UUID dari server), tidak pernah daftar global. Isi task tidak
 * rahasia: alamat deployer, pesan attestation, dan transaksi yang belum ditandatangani.
 *
 * Disimpan di memori proses, maksimal 2.000 task, 6 jam. Restart kontainer menghapusnya; pemanggil yang
 * sudah mengirim transaksi tetap bisa menyelesaikan lewat task baru (`txHash` saja) atau `register_launch`.
 */

export const A2A_PATH = "/api/a2a";
export function a2aPublicOrigin(): string {
  const o = process.env.A2A_PUBLIC_URL?.trim();
  return o && /^https?:\/\/[^\s/]+$/.test(o) ? o : "https://adexto.xyz";
}

// ── model v1.0 ───────────────────────────────────────────────────────────────

type State =
  | "TASK_STATE_SUBMITTED"
  | "TASK_STATE_WORKING"
  | "TASK_STATE_INPUT_REQUIRED"
  | "TASK_STATE_COMPLETED"
  | "TASK_STATE_FAILED"
  | "TASK_STATE_CANCELED"
  | "TASK_STATE_REJECTED";
const TERMINAL = new Set<State>(["TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED"]);

type Part = { text: string } | { data: unknown; mediaType: "application/json" };
interface Message {
  messageId: string;
  contextId?: string;
  taskId?: string;
  role: "ROLE_USER" | "ROLE_AGENT";
  parts: Part[];
  metadata?: Record<string, unknown>;
}
interface Artifact {
  artifactId: string;
  name: string;
  description?: string;
  parts: Part[];
}
interface Task {
  id: string;
  contextId: string;
  status: { state: State; message?: Message; timestamp: string };
  artifacts?: Artifact[];
  history?: Message[];
  metadata?: Record<string, unknown>;
}

/** Keadaan peluncuran yang dibawa task di antara giliran. Tidak pernah dikirim ke klien apa adanya. */
interface LaunchState {
  step: "sign_attestation" | "send_transaction" | "register";
  input: {
    chainId: number;
    name: string;
    symbol: string;
    deployer: string;
    agentId?: string;
    description?: string;
    website?: string;
    x?: string;
    github?: string;
    docs?: string;
    image?: string;
    category?: string;
  };
  attestationMessage?: string;
}
interface Stored {
  task: Task;
  launch: LaunchState | null;
  updatedAt: number;
  busy: boolean;
}

const TASK_TTL_MS = 6 * 60 * 60_000;
const MAX_TASKS = 2_000;
const STORE_KEY = "__adextoA2aTasksV1";

function store(): Map<string, Stored> {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!(g[STORE_KEY] instanceof Map)) g[STORE_KEY] = new Map<string, Stored>();
  return g[STORE_KEY] as Map<string, Stored>;
}
function getStored(id: string): Stored | null {
  const s = store().get(id);
  if (!s) return null;
  if (Date.now() - s.updatedAt > TASK_TTL_MS) {
    store().delete(id);
    return null;
  }
  return s;
}
function putStored(s: Stored) {
  const m = store();
  s.updatedAt = Date.now();
  m.delete(s.task.id);
  while (m.size >= MAX_TASKS) {
    const first = m.keys().next();
    if (first.done) break;
    m.delete(first.value);
  }
  m.set(s.task.id, s);
}

const now = () => new Date().toISOString();
const text = (t: string): Part => ({ text: t });
const data = (d: unknown): Part => ({ data: d, mediaType: "application/json" });
function agentMessage(parts: Part[], ctx: { contextId: string; taskId?: string }): Message {
  return { messageId: randomUUID(), contextId: ctx.contextId, ...(ctx.taskId ? { taskId: ctx.taskId } : {}), role: "ROLE_AGENT", parts };
}

// ── galat ────────────────────────────────────────────────────────────────────

export class A2aError extends Error {
  constructor(readonly code: number, message: string, readonly reason: string, readonly metadata: Record<string, string> = {}) {
    super(message);
  }
  toJsonRpc() {
    return {
      code: this.code,
      message: this.message,
      data: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: this.reason, domain: "a2a-protocol.org", metadata: this.metadata }],
    };
  }
}
const taskNotFound = (id: string) => new A2aError(-32001, "Task not found", "TASK_NOT_FOUND", { taskId: id });
const invalidParams = (detail: string) => new A2aError(-32602, `Invalid parameters: ${detail}`, "INVALID_PARAMS");

// ── kartu ────────────────────────────────────────────────────────────────────

const LAUNCH_SCHEMA = {
  skill: "launch_market",
  chainId: "143 Monad | 42161 Arbitrum One | 4663 Robinhood Chain | 8453 Base | 16661 0G",
  name: "Market name, up to 64 bytes",
  symbol: "Ticker, 2 to 12 characters, A-Z and 0-9",
  deployer: "0x… wallet that signs and sends the launch; it becomes the creator",
  agentId: "Optional ERC-8004 agent id on that chain, owned by deployer",
  description: "Optional one-line pitch, up to 280 characters",
};

export function agentCard() {
  const origin = a2aPublicOrigin();
  const url = `${origin}${A2A_PATH}`;
  return {
    name: "ADEXTO Launchpad",
    description:
      "Launches a token market on a bonding curve for the calling agent, on Monad, Arbitrum One, Robinhood Chain, Base or 0G. " +
      "The agent signs with its own key: this server returns the attestation message and the unsigned launch transaction and " +
      "never holds a key. Gas only, all supply inside the curve, no liquidity deposit, 0.70% of every trade to the creator on " +
      "the standard fee preset. Also lists markets and reads one market.",
    supportedInterfaces: [
      { url, protocolBinding: "JSONRPC", protocolVersion: "1.0" },
      { url, protocolBinding: "JSONRPC", protocolVersion: "0.3" },
    ],
    provider: { organization: "ADEXTO", url: origin },
    iconUrl: `${origin}/brand/adexto-512.png`,
    version: "1.0.0",
    documentationUrl: `${origin}/agents`,
    capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
    defaultInputModes: ["application/json", "text/plain"],
    defaultOutputModes: ["application/json", "text/plain"],
    skills: [
      {
        id: "launch_market",
        name: "Launch a market",
        description:
          "A multi-turn task. Send a data part {skill:'launch_market', chainId, name, symbol, deployer, agentId?, description?}. " +
          "The task returns TASK_STATE_INPUT_REQUIRED with attestationMessage: sign it with personal_sign (EIP-191) from deployer " +
          "and reply on the same task with {attestationSignature}. The task then returns the unsigned launch transaction as an " +
          "artifact: send it from deployer (value 0, gas only) and reply with {txHash}. When it is mined the market is listed and " +
          "the task completes with the market artifact.",
        tags: ["launch", "token", "bonding-curve", "erc-8004", "evm"],
        examples: [JSON.stringify({ skill: "launch_market", chainId: 143, name: "Signal Desk", symbol: "SIGDSK", deployer: "0xYourAddress" })],
        inputModes: ["application/json"],
        outputModes: ["application/json", "text/plain"],
      },
      {
        id: "list_markets",
        name: "List markets",
        description: "Every listed ADEXTO market: symbol, chain, token, curve, price in the native asset and page URL. Data part {skill:'list_markets'}.",
        tags: ["markets", "read"],
        examples: [JSON.stringify({ skill: "list_markets" })],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
      {
        id: "get_market",
        name: "Get a market",
        description: "One market by ticker, optionally on one chain. Data part {skill:'get_market', symbol, chainId?}.",
        tags: ["markets", "read"],
        examples: [JSON.stringify({ skill: "get_market", symbol: "LOOP", chainId: 143 })],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
    ],
    // Bentuk 0.3, untuk klien lama yang membaca kartu dari bidang tingkat atas. Klien 1.0 mengabaikannya.
    protocolVersion: "0.3",
    url,
    preferredTransport: "JSONRPC",
  };
}

// ── skill baca ───────────────────────────────────────────────────────────────

function marketView(p: ProjectRecord) {
  const chain = resolveChainOrDefault(p.chainId);
  const origin = a2aPublicOrigin();
  return {
    symbol: p.symbol,
    name: p.name,
    chainId: p.chainId,
    chain: chain.name,
    token: p.tokenAddress,
    curve: p.poolAddress,
    creator: p.creator,
    priceNative: p.priceNative,
    nativeSymbol: p.nativeSymbol,
    agentId: p.agentIdentity?.agentId ?? null,
    page: `${origin}/token/${p.slug}?chain=${p.chainId}`,
  };
}

// ── giliran peluncuran ───────────────────────────────────────────────────────

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

function readLaunchInput(d: Record<string, unknown>): LaunchState["input"] | string {
  const chainId = Number(d.chainId);
  if (!Number.isInteger(chainId) || chainId <= 0) return "chainId must be a chain id number.";
  const name = str(d.name, 64);
  const symbol = str(d.symbol, 12);
  const deployer = str(d.deployer, 42);
  if (!name || !symbol || !deployer) return "name, symbol and deployer are required.";
  const agentId = d.agentId === undefined || d.agentId === null || d.agentId === "" ? undefined : String(d.agentId);
  return {
    chainId,
    name,
    symbol,
    deployer,
    agentId,
    description: str(d.description, 280),
    website: str(d.website, 200),
    x: str(d.x, 200),
    github: str(d.github, 200),
    docs: str(d.docs, 200),
    image: str(d.image, 200_000),
    category: str(d.category, 40),
  };
}

function setStatus(s: Stored, state: State, parts: Part[]) {
  const msg = agentMessage(parts, { contextId: s.task.contextId, taskId: s.task.id });
  s.task.status = { state, message: msg, timestamp: now() };
  s.task.history = [...(s.task.history ?? []), msg].slice(-20);
}
function addArtifact(s: Stored, a: Omit<Artifact, "artifactId">) {
  s.task.artifacts = [...(s.task.artifacts ?? []).filter((x) => x.name !== a.name), { artifactId: randomUUID(), ...a }];
}

async function runLaunchTurn(s: Stored, d: Record<string, unknown>, ipHeaders: IpHeaders): Promise<void> {
  const L = s.launch!;
  // Peserta boleh langsung memberi txHash pada giliran mana pun sesudah data awal (mis. setelah restart).
  const txHash = str(d.txHash, 66);
  if (txHash) L.step = "register";

  if (L.step === "sign_attestation") {
    const signature = str(d.attestationSignature, 200);
    if (!signature) {
      setStatus(s, "TASK_STATE_INPUT_REQUIRED", [
        text(`Sign attestationMessage with personal_sign from ${L.input.deployer}, then reply on this task with {"attestationSignature":"0x…"}.`),
        data({ step: "sign_attestation", attestationMessage: L.attestationMessage }),
      ]);
      return;
    }
    const r = await prepareLaunch({ ...L.input, attestationMessage: L.attestationMessage, attestationSignature: signature }, ipHeaders);
    if (r.error) {
      const retry = r.error === "attestation_invalid" || r.error === "attestation_mismatch";
      setStatus(s, retry ? "TASK_STATE_INPUT_REQUIRED" : "TASK_STATE_FAILED", [
        text(String(r.detail ?? r.error) + (retry ? " Sign the attestationMessage again and reply with the new signature." : "")),
        data({ error: r.error, detail: r.detail ?? null, ...(retry ? { attestationMessage: L.attestationMessage } : {}) }),
      ]);
      return;
    }
    L.step = "send_transaction";
    addArtifact(s, {
      name: "unsigned-launch-transaction",
      description: `Send from ${L.input.deployer} on ${r.chain} (value 0, gas only).`,
      parts: [data({ transaction: r.transaction, simulation: r.simulation, gasEstimate: r.gasEstimate, estimatedCostWei: r.estimatedCostWei, fundsSufficient: r.fundsSufficient, nativeSymbol: r.nativeSymbol, market: r.market })],
    });
    setStatus(s, "TASK_STATE_INPUT_REQUIRED", [
      text(`Sign and send the unsigned-launch-transaction artifact from ${L.input.deployer} on ${r.chain}. When it is sent, reply on this task with {"txHash":"0x…"}.`),
      data({ step: "send_transaction" }),
    ]);
    return;
  }

  if (L.step === "send_transaction" && !txHash) {
    setStatus(s, "TASK_STATE_INPUT_REQUIRED", [text('Reply with {"txHash":"0x…"} once the launch transaction is sent.'), data({ step: "send_transaction" })]);
    return;
  }

  // register
  const r = await registerLaunch({ chainId: L.input.chainId, txHash: txHash ?? "" }, ipHeaders, "a2a");
  if (r.error === "not_mined_yet") {
    setStatus(s, "TASK_STATE_INPUT_REQUIRED", [text(`${String(r.detail)} Reply with the same txHash when it is mined.`), data({ step: "register", error: r.error, txHash })]);
    return;
  }
  if (r.error) {
    setStatus(s, r.error === "invalid_tx_hash" ? "TASK_STATE_INPUT_REQUIRED" : "TASK_STATE_FAILED", [text(String(r.detail ?? r.error)), data({ error: r.error, detail: r.detail ?? null })]);
    return;
  }
  // Transaksi peluncuran pasar LAIN tidak menyelesaikan task ini.
  if (String(r.symbol).toUpperCase() !== L.input.symbol.toUpperCase() || Number(r.chainId) !== L.input.chainId) {
    setStatus(s, "TASK_STATE_INPUT_REQUIRED", [
      text(`That transaction launched $${String(r.symbol)} on chain ${String(r.chainId)}, not $${L.input.symbol.toUpperCase()} on chain ${L.input.chainId}. Reply with the txHash of this launch.`),
      data({ step: "register", error: "different_market", launched: { symbol: r.symbol, chainId: r.chainId } }),
    ]);
    return;
  }
  addArtifact(s, { name: "market", description: `$${String(r.symbol)} is listed on ADEXTO.`, parts: [data(r)] });
  setStatus(s, "TASK_STATE_COMPLETED", [text(`$${String(r.symbol)} is live: ${String(r.page)}`)]);
}

// ── operasi ──────────────────────────────────────────────────────────────────

type IncomingPart = { text?: unknown; data?: unknown; raw?: unknown; url?: unknown; kind?: unknown; file?: unknown };

/** Bacaan longgar pesan klien: v1.0 dan 0.3 sama-sama diterima. */
function readUserMessage(m: unknown): { message: Message; data: Record<string, unknown> | null; textOnly: string } {
  if (!m || typeof m !== "object") throw invalidParams("message is required.");
  const msg = m as { messageId?: unknown; contextId?: unknown; taskId?: unknown; role?: unknown; parts?: unknown; metadata?: unknown };
  if (typeof msg.messageId !== "string" || !msg.messageId) throw invalidParams("message.messageId is required.");
  if (msg.role !== "ROLE_USER" && msg.role !== "user") throw invalidParams("message.role must be ROLE_USER.");
  if (!Array.isArray(msg.parts) || msg.parts.length === 0 || msg.parts.length > 10) throw invalidParams("message.parts needs 1 to 10 parts.");
  const parts: Part[] = [];
  let found: Record<string, unknown> | null = null;
  const texts: string[] = [];
  for (const raw of msg.parts as IncomingPart[]) {
    if (raw && typeof raw.text === "string") {
      parts.push(text(raw.text.slice(0, 4000)));
      texts.push(raw.text);
    } else if (raw && raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)) {
      parts.push(data(raw.data));
      found ??= raw.data as Record<string, unknown>;
    } else if (raw && (raw.raw !== undefined || raw.url !== undefined || raw.file !== undefined)) {
      throw new A2aError(-32005, "Content type not supported: send text or JSON data parts.", "CONTENT_TYPE_NOT_SUPPORTED");
    } else {
      throw invalidParams("each part must be a text part or a data part.");
    }
  }
  // Teks yang isinya JSON objek diperlakukan sebagai data, untuk klien yang hanya bisa mengirim teks.
  if (!found) {
    for (const t of texts) {
      try {
        const j = JSON.parse(t);
        if (j && typeof j === "object" && !Array.isArray(j)) {
          found = j;
          break;
        }
      } catch {
        // bukan JSON
      }
    }
  }
  return {
    message: {
      messageId: msg.messageId,
      role: "ROLE_USER",
      parts,
      ...(typeof msg.contextId === "string" ? { contextId: msg.contextId } : {}),
      ...(typeof msg.taskId === "string" ? { taskId: msg.taskId } : {}),
    },
    data: found,
    textOnly: texts.join("\n"),
  };
}

const HELP =
  "This agent works from JSON data parts. Launch: {\"skill\":\"launch_market\",\"chainId\":143,\"name\":\"Signal Desk\",\"symbol\":\"SIGDSK\",\"deployer\":\"0x…\"}. " +
  "Read: {\"skill\":\"list_markets\"} or {\"skill\":\"get_market\",\"symbol\":\"LOOP\",\"chainId\":143}. Skills are listed in /.well-known/agent-card.json.";

function history(t: Task, historyLength: unknown): Task {
  const n = historyLength === undefined || historyLength === null ? undefined : Number(historyLength);
  if (n === undefined || !Number.isFinite(n)) return t;
  if (n <= 0) {
    const { history: _h, ...rest } = t;
    return rest;
  }
  return { ...t, history: (t.history ?? []).slice(-Math.floor(n)) };
}

export async function sendMessage(params: any, ipHeaders: IpHeaders): Promise<{ task: Task } | { message: Message }> {
  const { message, data: d, textOnly } = readUserMessage(params?.message);
  const cfg = params?.configuration ?? {};

  // Lanjutan task yang ada.
  if (message.taskId) {
    const s = getStored(message.taskId);
    if (!s) throw taskNotFound(message.taskId);
    if (TERMINAL.has(s.task.status.state)) {
      throw new A2aError(-32004, "This task has ended and cannot accept more messages. Start a new task.", "UNSUPPORTED_OPERATION", { taskId: s.task.id });
    }
    if (message.contextId && message.contextId !== s.task.contextId) throw invalidParams("contextId does not match the task.");
    if (s.busy) throw new A2aError(-32004, "The previous message on this task is still being processed.", "UNSUPPORTED_OPERATION", { taskId: s.task.id });
    s.task.history = [...(s.task.history ?? []), { ...message, contextId: s.task.contextId }].slice(-20);
    if (!s.launch) throw new A2aError(-32004, "This task does not take further input.", "UNSUPPORTED_OPERATION");
    return runTask(s, d ?? {}, ipHeaders, cfg);
  }

  const contextId = message.contextId ?? randomUUID();
  const skill = typeof d?.skill === "string" ? d.skill : typeof (params?.metadata as any)?.skill === "string" ? (params.metadata as any).skill : null;

  // Teks bebas tidak ditebak: agen ini deterministik, jadi jawabannya cara memakai skill.
  if (!d || !skill) {
    void textOnly;
    return { message: agentMessage([text(HELP), data({ skills: ["launch_market", "list_markets", "get_market"], launchMarket: LAUNCH_SCHEMA })], { contextId }) };
  }
  if (skill === "list_markets") {
    const markets = listProjects().map(marketView);
    return { message: agentMessage([text(`${markets.length} markets listed on ADEXTO.`), data({ markets })], { contextId }) };
  }
  if (skill === "get_market") {
    const sym = str(d.symbol, 12)?.toUpperCase();
    if (!sym) throw invalidParams("get_market needs symbol.");
    const chainId = d.chainId === undefined ? null : Number(d.chainId);
    const p = chainId ? findProject(sym.toLowerCase(), chainId) : listProjects().find((x) => x.symbol === sym) ?? null;
    if (!p) return { message: agentMessage([text(`No market $${sym}${chainId ? ` on chain ${chainId}` : ""} is listed.`), data({ error: "unknown_market", symbol: sym })], { contextId }) };
    return { message: agentMessage([text(`$${p.symbol} on ${resolveChainOrDefault(p.chainId).name}.`), data({ market: marketView(p) })], { contextId }) };
  }
  if (skill !== "launch_market") throw invalidParams(`unknown skill ${String(skill).slice(0, 40)}. Use launch_market, list_markets or get_market.`);

  const taskId = randomUUID();
  const task: Task = {
    id: taskId,
    contextId,
    status: { state: "TASK_STATE_SUBMITTED", timestamp: now() },
    history: [{ ...message, contextId, taskId }],
    metadata: { skill: "launch_market" },
  };
  const parsed = readLaunchInput(d);
  const s: Stored = { task, launch: null, updatedAt: Date.now(), busy: false };
  if (typeof parsed === "string") {
    setStatus(s, "TASK_STATE_REJECTED", [text(parsed), data({ error: "invalid_input", detail: parsed, expected: LAUNCH_SCHEMA })]);
    putStored(s);
    return { task: history(task, cfg.historyLength) };
  }
  s.launch = { step: "sign_attestation", input: parsed };
  putStored(s);
  // Langkah 1 (gratis, tanpa tanda tangan): pemeriksaan + pesan attestation.
  const first = await prepareLaunch(parsed, ipHeaders);
  if (first.error) {
    setStatus(s, "TASK_STATE_REJECTED", [text(String(first.detail ?? first.error)), data({ error: first.error, detail: first.detail ?? null })]);
  } else {
    s.launch.attestationMessage = String(first.attestationMessage);
    setStatus(s, "TASK_STATE_INPUT_REQUIRED", [
      text(`Checks passed. Sign attestationMessage with personal_sign from ${parsed.deployer}, then reply on this task with {"attestationSignature":"0x…"}. Valid for 30 minutes.`),
      data({ step: "sign_attestation", attestationMessage: first.attestationMessage, signWith: first.signWith, checks: first.checks }),
    ]);
  }
  putStored(s);
  return { task: history(task, cfg.historyLength) };
}

async function runTask(s: Stored, d: Record<string, unknown>, ipHeaders: IpHeaders, cfg: any): Promise<{ task: Task }> {
  s.busy = true;
  s.task.status = { ...s.task.status, state: "TASK_STATE_WORKING", timestamp: now() };
  putStored(s);
  const work = runLaunchTurn(s, d, ipHeaders)
    .catch(() => setStatus(s, "TASK_STATE_FAILED", [text("Internal error while processing this step.")]))
    .finally(() => {
      s.busy = false;
      putStored(s);
    });
  // `returnImmediately`: task dikembalikan dalam WORKING, hasilnya dibaca lewat GetTask.
  if (cfg?.returnImmediately === true) return { task: history(structuredClone(s.task), cfg.historyLength) };
  await work;
  return { task: history(s.task, cfg?.historyLength) };
}

export function getTask(params: any): Task {
  const id = typeof params?.id === "string" ? params.id : "";
  const s = id ? getStored(id) : null;
  if (!s) throw taskNotFound(id);
  return history(s.task, params?.historyLength);
}

export function cancelTask(params: any): Task {
  const id = typeof params?.id === "string" ? params.id : "";
  const s = id ? getStored(id) : null;
  if (!s) throw taskNotFound(id);
  if (TERMINAL.has(s.task.status.state)) throw new A2aError(-32002, "Task is not cancelable", "TASK_NOT_CANCELABLE", { taskId: id });
  setStatus(s, "TASK_STATE_CANCELED", [text("Canceled. Nothing was sent: this server never sends transactions.")]);
  putStored(s);
  return s.task;
}

/** Hanya task dalam `contextId` yang diberikan; tanpa contextId daftar kosong (tidak ada daftar global). */
export function listTasks(params: any) {
  const contextId = typeof params?.contextId === "string" ? params.contextId : null;
  const pageSize = Math.min(100, Math.max(1, Number(params?.pageSize) || 50));
  const tasks = contextId
    ? [...store().values()]
        .filter((s) => s.task.contextId === contextId && Date.now() - s.updatedAt <= TASK_TTL_MS)
        .filter((s) => !params?.status || s.task.status.state === params.status)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, pageSize)
        .map((s) => history(s.task, params?.historyLength ?? 0))
    : [];
  return { tasks, nextPageToken: "", pageSize, totalSize: tasks.length };
}

// ── terjemahan 0.3 ───────────────────────────────────────────────────────────

const V03_STATE: Record<State, string> = {
  TASK_STATE_SUBMITTED: "submitted",
  TASK_STATE_WORKING: "working",
  TASK_STATE_INPUT_REQUIRED: "input-required",
  TASK_STATE_COMPLETED: "completed",
  TASK_STATE_FAILED: "failed",
  TASK_STATE_CANCELED: "canceled",
  TASK_STATE_REJECTED: "rejected",
};
const partTo03 = (p: Part) => ("text" in p ? { kind: "text", text: p.text } : { kind: "data", data: p.data });
const msgTo03 = (m: Message) => ({ ...m, kind: "message", role: m.role === "ROLE_USER" ? "user" : "agent", parts: m.parts.map(partTo03) });
function taskTo03(t: Task) {
  return {
    ...t,
    kind: "task",
    status: { ...t.status, state: V03_STATE[t.status.state], ...(t.status.message ? { message: msgTo03(t.status.message) } : {}) },
    ...(t.artifacts ? { artifacts: t.artifacts.map((a) => ({ ...a, parts: a.parts.map(partTo03) })) } : {}),
    ...(t.history ? { history: t.history.map(msgTo03) } : {}),
  };
}
export function to03(result: unknown, method: string): unknown {
  if (method === "message/send") {
    const r = result as { task?: Task; message?: Message };
    return r.task ? taskTo03(r.task) : msgTo03(r.message!);
  }
  if (method === "tasks/get" || method === "tasks/cancel") return taskTo03(result as Task);
  return result;
}
