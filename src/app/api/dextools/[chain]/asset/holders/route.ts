import { runtime } from "../../../../dexscreener/_lib/adapter";
import { dextoolsHolders } from "../../../../dexscreener/_lib/dextools";
import { handle, preflight } from "../../../../dexscreener/_lib/respond";

export const dynamic = "force-dynamic";

/** DEXTools adapter: `GET /asset/holders?id=&page=&pageSize=` → `{ asset: { id, totalHoldersCount, holders } }`. */
export async function GET(req: Request, ctx: { params: Promise<{ chain: string }> }) {
  const { chain } = await ctx.params;
  return handle(
    req,
    chain,
    "holders",
    "public, max-age=60",
    async (cfg, url) => ({ asset: await dextoolsHolders(runtime(cfg), url) }),
    "dextools"
  );
}

export function OPTIONS() {
  return preflight();
}
