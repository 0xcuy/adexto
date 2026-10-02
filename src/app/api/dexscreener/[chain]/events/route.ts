import { blockRange, eventsBetween, runtime } from "../../_lib/adapter";
import { handle, preflight } from "../../_lib/respond";

export const dynamic = "force-dynamic";

/**
 * DEX Screener adapter: `GET /events?fromBlock=&toBlock=` (both inclusive) → `{ events }`.
 * Only blocks at or below `/latest-block` are served, so every response is final.
 */
export async function GET(req: Request, ctx: { params: Promise<{ chain: string }> }) {
  const { chain } = await ctx.params;
  return handle(req, chain, "events", "public, max-age=60", async (cfg, url) => {
    const { fromBlock, toBlock } = blockRange(url, cfg.chain.chainId);
    return { events: await eventsBetween(runtime(cfg), fromBlock, toBlock) };
  });
}

export function OPTIONS() {
  return preflight();
}
