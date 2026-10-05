import { createHash } from "node:crypto";
import { readJson, writeJson } from "@/lib/server-store";

/**
 * Hitungan pemakaian MCP: `tools/call` per alat per hari (UTC), dan jumlah pemanggil berbeda.
 *
 * KENAPA ADA: KPI "panggilan tool MCP" (PLAN-1) tidak punya sumber data sama sekali, jadi halaman
 * tidak bisa menyatakan angka apa pun dengan jujur. Ini sumbernya.
 *
 * YANG DISIMPAN, dan yang tidak: hanya hitungan, dan untuk pemanggil berbeda hanya hash SHA-256 terpotong
 * dari keranjang IP (`clientIp`, IPv6 per /64) dengan garam harian. IP mentah tidak pernah ditulis.
 *
 * YANG TIDAK BISA DIBEDAKAN: panggilan kami sendiri dan panggilan pihak luar lewat IP saja. Karena itu
 * setiap angka yang ditampilkan dilabeli "all callers, ADEXTO included".
 *
 * Disimpan di `.data/mcp-usage.json`, ditulis paling sering sekali per 30 detik, 60 hari terakhir.
 */
const FILE = "mcp-usage.json";
const KEEP_DAYS = 60;
const FLUSH_MS = 30_000;

interface DayRow {
  tools: Record<string, number>;
  /** Hash pemanggil berbeda hari itu. */
  callers: string[];
}
interface UsageStore {
  since: string;
  days: Record<string, DayRow>;
}

const KEY = "__adextoMcpUsageV1";
type Slot = { store: UsageStore; dirty: boolean; timer: ReturnType<typeof setTimeout> | null };

function slot(): Slot {
  const g = globalThis as unknown as Record<string, Slot | undefined>;
  const cur = g[KEY];
  if (cur && cur.store && typeof cur.store === "object" && cur.store.days) return cur;
  const loaded = readJson<UsageStore | null>(FILE, null);
  const store: UsageStore =
    loaded && typeof loaded.since === "string" && loaded.days && typeof loaded.days === "object"
      ? loaded
      : { since: new Date().toISOString().slice(0, 10), days: {} };
  const s: Slot = { store, dirty: false, timer: null };
  g[KEY] = s;
  return s;
}

function flushSoon(s: Slot) {
  s.dirty = true;
  if (s.timer) return;
  s.timer = setTimeout(() => {
    s.timer = null;
    if (!s.dirty) return;
    s.dirty = false;
    const keys = Object.keys(s.store.days).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete s.store.days[k];
    writeJson(FILE, s.store, { compact: true });
  }, FLUSH_MS);
  // Jangan menahan proses tetap hidup hanya karena penulisan tertunda.
  (s.timer as { unref?: () => void }).unref?.();
}

/** Catat satu `tools/call`. Nama alat dibatasi supaya kunci acak tidak menumbuhkan berkas. */
export function recordToolCall(tool: string, callerBucket: string): void {
  if (!/^[a-z_]{1,40}$/.test(tool)) return;
  const s = slot();
  const day = new Date().toISOString().slice(0, 10);
  const row = (s.store.days[day] ??= { tools: {}, callers: [] });
  row.tools[tool] = (row.tools[tool] ?? 0) + 1;
  const h = createHash("sha256").update(`${day}:${callerBucket}`).digest("hex").slice(0, 16);
  if (row.callers.length < 5000 && !row.callers.includes(h)) row.callers.push(h);
  flushSoon(s);
}

export interface McpUsageSummary {
  since: string;
  days: number;
  calls: number;
  launchCalls: number;
  callerDays: number;
  byTool: Array<[string, number]>;
}

/** Ringkasan `days` hari terakhir (termasuk hari ini). `callerDays` = jumlah pemanggil berbeda per hari, dijumlah. */
export function mcpUsageSummary(days = 7): McpUsageSummary {
  const s = slot();
  const from = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const byTool: Record<string, number> = {};
  let callerDays = 0;
  for (const [day, row] of Object.entries(s.store.days)) {
    if (day < from) continue;
    callerDays += row.callers.length;
    for (const [tool, n] of Object.entries(row.tools)) byTool[tool] = (byTool[tool] ?? 0) + n;
  }
  const calls = Object.values(byTool).reduce((a, b) => a + b, 0);
  return {
    since: s.store.since,
    days,
    calls,
    launchCalls: (byTool.prepare_launch ?? 0) + (byTool.register_launch ?? 0),
    callerDays,
    byTool: Object.entries(byTool).sort((a, b) => b[1] - a[1]),
  };
}
