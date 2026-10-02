import { runtime } from "../../../dexscreener/_lib/adapter";
import { dextoolsBlock } from "../../../dexscreener/_lib/dextools";
import { handle, preflight } from "../../../dexscreener/_lib/respond";

export const dynamic = "force-dynamic";

/** DEXTools adapter: `GET /block?number=` or `?timestamp=` → `{ block }`, up to `/latest-block`. */
export async function GET(req: Request, ctx: { params: Promise<{ chain: string }> }) {
  const { chain } = await ctx.params;
  return handle(
    req,
    chain,
    "block",
    "public, max-age=60",
    async (cfg, url) => ({ block: await dextoolsBlock(runtime(cfg), url) }),
    "dextools"
  );
}

export function OPTIONS() {
  return preflight();
}
