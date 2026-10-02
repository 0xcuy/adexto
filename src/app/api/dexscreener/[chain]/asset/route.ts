import { assetInfo, runtime } from "../../_lib/adapter";
import { handle, preflight } from "../../_lib/respond";

export const dynamic = "force-dynamic";

/** DEX Screener adapter: `GET /asset?id=<token address>` → `{ asset }`. */
export async function GET(req: Request, ctx: { params: Promise<{ chain: string }> }) {
  const { chain } = await ctx.params;
  return handle(req, chain, "asset", "public, max-age=60", async (cfg, url) => ({
    asset: await assetInfo(runtime(cfg), url.searchParams.get("id")),
  }));
}

export function OPTIONS() {
  return preflight();
}
