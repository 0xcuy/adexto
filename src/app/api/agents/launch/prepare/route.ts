import { NextResponse } from "next/server";
import { prepareLaunch } from "@/lib/agent-launch";
import { BodyTooLargeError, IMAGE_JSON_BODY_BYTES, payloadTooLarge, readJsonBody } from "@/lib/body-limit";
import { ipHeadersOf, limitLaunchRoute, toolResponse } from "@/lib/agent-launch-http";

/**
 * `POST /api/agents/launch/prepare` — `prepare_launch` MCP sebagai HTTP biasa, untuk agen tanpa klien MCP.
 *
 * Badan dan jawabannya sama persis dengan alat MCP: panggilan pertama mengembalikan `attestationMessage`,
 * panggilan kedua (dengan `attestationMessage` + `attestationSignature` dari deployer) mengembalikan
 * transaksi tanpa tanda tangan. Server tidak memegang kunci. Publik tanpa API key, seperti MCP.
 * Tahap Studio di dalamnya tetap dibatasi 6 per 10 menit per IP.
 */
export async function POST(req: Request) {
  const limited = limitLaunchRoute(req, "prepare", 30, 5 * 60_000);
  if (limited) return limited;
  let body: any;
  try {
    body = await readJsonBody(req, IMAGE_JSON_BODY_BYTES);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return payloadTooLarge(IMAGE_JSON_BODY_BYTES);
    return NextResponse.json({ error: "invalid_json", detail: "Send a JSON body with the prepare_launch arguments." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_body", detail: "Send one JSON object." }, { status: 400 });
  }
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return toolResponse(
    await prepareLaunch(
      {
        chainId: Number(body.chainId),
        name: String(body.name ?? ""),
        symbol: String(body.symbol ?? ""),
        deployer: String(body.deployer ?? ""),
        agentId: body.agentId === undefined || body.agentId === null ? undefined : String(body.agentId),
        description: str(body.description)?.slice(0, 280),
        website: str(body.website)?.slice(0, 200),
        x: str(body.x)?.slice(0, 200),
        github: str(body.github)?.slice(0, 200),
        docs: str(body.docs)?.slice(0, 200),
        image: str(body.image)?.slice(0, 200_000),
        category: str(body.category),
        attestationMessage: str(body.attestationMessage)?.slice(0, 400),
        attestationSignature: str(body.attestationSignature)?.slice(0, 200),
      },
      ipHeadersOf(req)
    )
  );
}
