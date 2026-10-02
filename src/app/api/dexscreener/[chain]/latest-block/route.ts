import { latestBlock, runtime } from "../../_lib/adapter";
import { handle, preflight } from "../../_lib/respond";

export const dynamic = "force-dynamic";

/** DEX Screener adapter: `GET /latest-block` → `{ block: { blockNumber, blockTimestamp } }`. */
export async function GET(req: Request, ctx: { params: Promise<{ chain: string }> }) {
  const { chain } = await ctx.params;
  return handle(req, chain, "latest-block", "no-store", async (cfg) => ({ block: await latestBlock(runtime(cfg)) }));
}

export function OPTIONS() {
  return preflight();
}
