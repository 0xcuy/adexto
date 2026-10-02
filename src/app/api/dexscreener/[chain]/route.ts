import { chainSummary, runtime } from "../_lib/adapter";
import { handle, preflight } from "../_lib/respond";

export const dynamic = "force-dynamic";

/**
 * Adapter root for one chain. Not part of the DEX Screener spec: a summary for whoever reviews
 * the integration (served pairs, confirmations, request limits).
 */
export async function GET(req: Request, ctx: { params: Promise<{ chain: string }> }) {
  const { chain } = await ctx.params;
  return handle(req, chain, "summary", "no-store", async (cfg) => chainSummary(runtime(cfg)));
}

export function OPTIONS() {
  return preflight();
}
