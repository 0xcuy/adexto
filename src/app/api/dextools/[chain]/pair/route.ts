import { runtime } from "../../../dexscreener/_lib/adapter";
import { dextoolsPair } from "../../../dexscreener/_lib/dextools";
import { handle, preflight } from "../../../dexscreener/_lib/respond";

export const dynamic = "force-dynamic";

/** DEXTools adapter: `GET /pair?id=<curve address>` → `{ pair }`. */
export async function GET(req: Request, ctx: { params: Promise<{ chain: string }> }) {
  const { chain } = await ctx.params;
  return handle(
    req,
    chain,
    "pair",
    "public, max-age=300",
    async (cfg, url) => ({ pair: await dextoolsPair(runtime(cfg), url.searchParams.get("id")) }),
    "dextools"
  );
}

export function OPTIONS() {
  return preflight();
}
