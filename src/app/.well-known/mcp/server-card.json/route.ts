/**
 * Kartu server MCP di `/.well-known/mcp/server-card.json`.
 *
 * Dua pembaca, satu dokumen:
 *   - bentuk Server Card (SEP-2127, ekstensi eksperimental MCP): identitas, transport dan versi
 *     protokol — cukup untuk menemukan dan menyambung ke server sebelum ada koneksi;
 *   - Smithery membaca path ini sebagai "static server card" bila pemindaian otomatisnya
 *     gagal, dan dari sana ia butuh daftar alat.
 * Objek Server Card terbuka (tanpa `additionalProperties: false`), jadi `serverInfo` dan `tools`
 * boleh menumpang tanpa melanggar skemanya.
 *
 * Daftar alat TIDAK ditulis tangan. Ia diambil dari `tools/list` server MCP itu sendiri, di dalam
 * proses, pada setiap permintaan — kartu statis akan basi begitu satu alat ditambahkan, dan kartu
 * yang menyebut alat yang tidak ada lebih buruk daripada tidak ada kartu.
 */
import { POST as mcpPOST } from "@/app/api/[transport]/route";
import server from "../../../../../server.json";

export const dynamic = "force-dynamic";

/** Versi yang dijawab endpoint: 2026-07-28 secara native, generasi 2025 lewat fallback stateless. */
const PROTOCOL_VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"];

async function liveTools(): Promise<unknown[]> {
  const res = await mcpPOST(
    new Request("http://127.0.0.1/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    })
  );
  const raw = await res.text();
  const line = raw.split("\n").find((l) => l.startsWith("data: "));
  const payload = JSON.parse(line ? line.slice(6) : raw);
  return Array.isArray(payload?.result?.tools) ? payload.result.tools : [];
}

export async function GET() {
  let tools: unknown[] = [];
  try {
    tools = await liveTools();
  } catch {
    // Kartu tetap dijawab tanpa daftar alat: identitas dan transport tidak bergantung padanya.
  }
  const body = {
    $schema: "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
    name: server.name,
    version: server.version,
    title: server.title,
    description: server.description,
    websiteUrl: server.websiteUrl,
    repository: server.repository,
    icons: server.icons,
    remotes: server.remotes.map((r) => ({ ...r, supportedProtocolVersions: PROTOCOL_VERSIONS })),
    serverInfo: { name: "adexto-x402", version: server.version },
    authentication: { required: false, schemes: [] },
    tools,
    resources: [],
    prompts: [],
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=300",
    },
  });
}
