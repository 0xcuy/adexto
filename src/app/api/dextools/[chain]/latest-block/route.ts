import { latestBlock, runtime } from "../../../dexscreener/_lib/adapter";
import { handle, preflight } from "../../../dexscreener/_lib/respond";

export const dynamic = "force-dynamic";

/** DEXTools adapter: `GET /latest-block` → `{ block }`. Same block as the DEX Screener adapter. */
export async function GET(req: Request, ctx: { params: Promise<{ chain: string }> }) {
  const { chain } = await ctx.params;
  return handle(req, chain, "latest-block", "no-store", async (cfg) => ({ block: await latestBlock(runtime(cfg)) }), "dextools");
}

export function OPTIONS() {
  return preflight();
}
