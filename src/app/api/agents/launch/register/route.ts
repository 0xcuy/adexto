import { NextResponse } from "next/server";
import { registerLaunch } from "@/lib/agent-launch";
import { BodyTooLargeError, payloadTooLarge, readJsonBody } from "@/lib/body-limit";
import { ipHeadersOf, limitLaunchRoute, toolResponse } from "@/lib/agent-launch-http";

/**
 * `POST /api/agents/launch/register` — `register_launch` MCP sebagai HTTP biasa: `{ chainId, txHash }`.
 *
 * Semua nilai yang didaftarkan dibaca dari event `TrinityProjectDeployed` di receipt, bukan dari pemanggil,
 * dan memanggilnya ulang untuk tx yang sama mengembalikan listing yang ada. Pasar yang terdaftar lewat sini
 * ditandai `launchedVia: "api"`.
 */
export async function POST(req: Request) {
  const limited = limitLaunchRoute(req, "register", 30, 5 * 60_000);
  if (limited) return limited;
  let body: any;
  try {
    body = await readJsonBody(req, 4 * 1024);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return payloadTooLarge(4 * 1024);
    return NextResponse.json({ error: "invalid_json", detail: "Send { chainId, txHash }." }, { status: 400 });
  }
  return toolResponse(await registerLaunch({ chainId: Number(body?.chainId), txHash: String(body?.txHash ?? "") }, ipHeadersOf(req), "api"));
}
