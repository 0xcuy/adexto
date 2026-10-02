import { runtime } from "../../../dexscreener/_lib/adapter";
import { dextoolsAsset } from "../../../dexscreener/_lib/dextools";
import { handle, preflight } from "../../../dexscreener/_lib/respond";

export const dynamic = "force-dynamic";

/** DEXTools adapter: `GET /asset?id=<token address>` → `{ asset }`. */
export async function GET(req: Request, ctx: { params: Promise<{ chain: string }> }) {
  const { chain } = await ctx.params;
  return handle(
    req,
    chain,
    "asset",
    "public, max-age=60",
    async (cfg, url) => ({ asset: await dextoolsAsset(runtime(cfg), url.searchParams.get("id")) }),
    "dextools"
  );
}

export function OPTIONS() {
  return preflight();
}
