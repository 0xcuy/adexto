import { pairInfo, runtime } from "../../_lib/adapter";
import { handle, preflight } from "../../_lib/respond";

export const dynamic = "force-dynamic";

/** DEX Screener adapter: `GET /pair?id=<curve address>` → `{ pair }`. Pair data is immutable. */
export async function GET(req: Request, ctx: { params: Promise<{ chain: string }> }) {
  const { chain } = await ctx.params;
  return handle(req, chain, "pair", "public, max-age=300", async (cfg, url) => ({
    pair: await pairInfo(runtime(cfg), url.searchParams.get("id")),
  }));
}

export function OPTIONS() {
  return preflight();
}
