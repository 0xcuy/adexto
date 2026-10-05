import { NextResponse } from "next/server";
import { listProjects } from "@/lib/registry";
import { agentLaunchVia } from "@/config/agent-launches";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";

/**
 * `GET /api/agents/launches?deployer=0x…[&symbol=&chainId=]` — pasar terdaftar milik satu creator.
 *
 * Dipakai pelacak peluncuran di `/agents`: sesudah agen memanggil `register_launch`, pasarnya muncul di
 * sini dan halaman berganti dari "waiting" ke "live". Isinya data registry publik (sama dengan
 * `list_markets`), dibatasi per IP karena halaman memanggilnya berulang.
 */
const LIMIT = 120;
const WINDOW_MS = 5 * 60_000;

export async function GET(req: Request) {
  const gate = rateLimit(`agents-launches:${clientIp(req)}`, LIMIT, WINDOW_MS);
  if (!gate.ok) {
    return NextResponse.json({ error: "rate_limited", detail: `At most ${LIMIT} requests per 5 minutes.` }, { status: 429, headers: rateLimitHeaders(gate) });
  }
  const url = new URL(req.url);
  const deployer = (url.searchParams.get("deployer") ?? "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(deployer)) {
    return NextResponse.json({ error: "invalid_deployer", detail: "deployer must be a 20-byte hex address." }, { status: 400 });
  }
  const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase();
  const chainId = Number(url.searchParams.get("chainId") ?? NaN);

  const launches = listProjects()
    .filter((p) => p.creator.toLowerCase() === deployer)
    .filter((p) => !symbol || p.symbol === symbol)
    .filter((p) => !Number.isFinite(chainId) || p.chainId === chainId)
    .sort((a, b) => b.deployedAt - a.deployedAt)
    .slice(0, 20)
    .map((p) => ({
      symbol: p.symbol,
      name: p.name,
      chainId: p.chainId,
      token: p.tokenAddress,
      txHash: p.txHash,
      deployedAt: p.deployedAt,
      launchedVia: agentLaunchVia(p),
      page: `/token/${p.slug}?chain=${p.chainId}`,
    }));
  return NextResponse.json({ deployer, launches }, { headers: { "cache-control": "no-store" } });
}
