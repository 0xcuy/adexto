import { createHash } from "node:crypto";
import { agentCard } from "@/lib/a2a";

/**
 * Kartu agen A2A di lokasi well-known yang ditetapkan spesifikasi (§8.2): `/.well-known/agent-card.json`.
 * Isi dan alasannya di `src/lib/a2a.ts`. Cache 5 menit dan ETag dari isi kartu (§8.6).
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const body = JSON.stringify(agentCard(), null, 2);
  const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`;
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "public, max-age=300",
    etag,
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}
