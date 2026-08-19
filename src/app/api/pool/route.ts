import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { findProject } from "@/lib/registry";
import { resolveChainOrDefault } from "@/lib/chains";
import { readPoolState } from "@/lib/dex";

/**
 * Read-only pool state for a market.
 *
 * Lets the order book and the swap panels show real reserves and a real spot
 * price instead of the synthetic ladder the old LiveOrderBook generated from a
 * hardcoded base price. Returns `tradable: false` with an explicit `reason` when
 * the market has no executable pool, which is what the UI uses to disable the
 * Buy/Sell buttons rather than sending a transaction that reverts.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get("symbol") || "").toUpperCase();
    if (!symbol) return NextResponse.json({ error: "symbol is required." }, { status: 400 });

    // A ticker can now exist on several chains as independent markets, so the
    // caller may pin one. Without chainId the primary deployment is used.
    const chainIdParam = searchParams.get("chainId");
    const chainId = chainIdParam && Number.isFinite(Number(chainIdParam)) ? Number(chainIdParam) : null;

    const project = findProject(symbol, chainId);
    if (!project) {
      return NextResponse.json(
        { error: chainId ? `Unknown market: ${symbol} on chain ${chainId}` : `Unknown market: ${symbol}` },
        { status: 404 }
      );
    }

    const chain = resolveChainOrDefault(project.chainId);
    const base = {
      symbol: project.symbol,
      name: project.name,
      chainId: chain.chainId,
      chainName: chain.name,
      nativeSymbol: chain.nativeSymbol,
      tokenAddress: project.tokenAddress,
      poolAddress: project.poolAddress,
      lpFeeBps: project.lpFeeBps,
      treasuryBuybackBps: project.treasuryBuybackBps,
      verified: project.verified,
      curated: project.curated,
      priceNative: project.priceNative,
      supply: project.supply,
      dexFactoryLive: chain.dexLive,
    };

    if (!project.poolAddress) {
      return NextResponse.json({
        ...base,
        tradable: false,
        reason: chain.dexLive
          ? "This market has no executable curve yet."
          : `No launch factory is deployed on ${chain.name} yet, so no executable market exists for this ticker.`,
      });
    }

    const state = await readPoolState(chain, project.poolAddress);
    if (!state || !state.initialized) {
      return NextResponse.json({
        ...base,
        tradable: false,
        reason: state
          ? // Kurva tidak pernah butuh setoran, jadi keadaan ini berarti belum di-init,
            // bukan belum di-seed.
            "The market exists but has not been initialised yet."
          : "The address recorded for this market does not expose a tradable swap interface.",
      });
    }

    return NextResponse.json({
      ...base,
      tradable: true,
      reason: null,
      reserveNative: ethers.formatEther(state.reserveNative),
      reserveToken: ethers.formatUnits(state.reserveToken, state.tokenDecimals),
      tokenDecimals: state.tokenDecimals,
      spotPriceNative: state.spotPriceNative,
      lpFeeBps: Number(state.lpFeeBps),
      treasuryBuybackBps: Number(state.treasuryBuybackBps),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
