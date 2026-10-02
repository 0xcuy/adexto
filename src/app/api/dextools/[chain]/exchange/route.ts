import { runtime } from "../../../dexscreener/_lib/adapter";
import { dextoolsExchange } from "../../../dexscreener/_lib/dextools";
import { handle, preflight } from "../../../dexscreener/_lib/respond";

export const dynamic = "force-dynamic";

/** DEXTools adapter: `GET /exchange?id=<factory address>` → `{ exchange }`. */
export async function GET(req: Request, ctx: { params: Promise<{ chain: string }> }) {
  const { chain } = await ctx.params;
  return handle(
    req,
    chain,
    "exchange",
    "public, max-age=3600",
    async (cfg, url) => ({ exchange: dextoolsExchange(runtime(cfg), url.searchParams.get("id")) }),
    "dextools"
  );
}

export function OPTIONS() {
  return preflight();
}
