import { NextResponse } from "next/server";
import { prepareLaunch } from "@/lib/agent-launch";
import { BodyTooLargeError, payloadTooLarge, readJsonBody } from "@/lib/body-limit";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";

/**
 * Preflight peluncuran untuk launch console di `/agents`: menjalankan LANGKAH 1 `prepare_launch` saja.
 *
 * Baca saja dan gratis. Langkah 1 memeriksa chain, ticker di registry dan di factory, kuota ticker per
 * alamat, dan kepemilikan `agentId`, lalu mengembalikan pesan attestation yang nanti ditandatangani
 * agen. Ia tidak menyentuh 0G DA, tidak menandatangani apa pun, dan tidak mengirim transaksi: semua
 * itu hanya terjadi di langkah 2, yang tetap lewat MCP dengan tanda tangan deployer.
 *
 * `attestationMessage`/`attestationSignature` dari pemanggil DIBUANG, supaya rute ini tidak pernah
 * bisa memicu langkah 2. Publik tanpa autentikasi (data yang sama dijawab MCP tanpa kunci), dibatasi
 * per IP karena setiap panggilan membaca chain.
 */
const LIMIT = 30;
const WINDOW_MS = 5 * 60_000;

export async function POST(req: Request) {
  const gate = rateLimit(`agents-preflight:${clientIp(req)}`, LIMIT, WINDOW_MS);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "rate_limited", detail: `At most ${LIMIT} checks per 5 minutes from one address.` },
      { status: 429, headers: rateLimitHeaders(gate) }
    );
  }

  let body: any;
  try {
    body = await readJsonBody(req, 4 * 1024);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return payloadTooLarge(4 * 1024);
    return NextResponse.json({ error: "invalid_json", detail: "Send a JSON body." }, { status: 400 });
  }

  const input = {
    chainId: Number(body?.chainId),
    name: String(body?.name ?? ""),
    symbol: String(body?.symbol ?? ""),
    deployer: String(body?.deployer ?? ""),
    agentId: body?.agentId ? String(body.agentId) : undefined,
  };
  const result = await prepareLaunch(input, {});
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
