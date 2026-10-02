import { blockRange, runtime } from "../../../dexscreener/_lib/adapter";
import { dextoolsEvents } from "../../../dexscreener/_lib/dextools";
import { handle, preflight } from "../../../dexscreener/_lib/respond";

export const dynamic = "force-dynamic";

/**
 * DEXTools adapter: `GET /events?fromBlock=&toBlock=` (both inclusive) → `{ events }`, with
 * `creation` events for new pairs and `swap` events. Only blocks up to `/latest-block`.
 */
export async function GET(req: Request, ctx: { params: Promise<{ chain: string }> }) {
  const { chain } = await ctx.params;
  return handle(
    req,
    chain,
    "events",
    "public, max-age=60",
    async (cfg, url) => {
      const { fromBlock, toBlock } = blockRange(url, cfg.chain.chainId);
      return { events: await dextoolsEvents(runtime(cfg), fromBlock, toBlock) };
    },
    "dextools"
  );
}

export function OPTIONS() {
  return preflight();
}
