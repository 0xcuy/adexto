import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { findProject } from "@/lib/registry";
import { resolveChainOrDefault } from "@/lib/chains";
import { readPoolState } from "@/lib/dex";
import { publicErrorMessage } from "@/lib/public-error";

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

/**
 * Satu `readPoolState` adalah 15 `eth_call`, masing-masing permintaan HTTP sendiri ke RPC publik.
 *
 * Rute ini dulu menjalankannya pada SETIAP permintaan, tanpa cache dan tanpa batas laju —
 * padahal setiap order book yang terbuka memanggilnya tiap 15 detik. N penonton berarti N×15
 * panggilan per siklus, dan satu loop anonim cukup untuk membuat RPC publik membatasi IP origin,
 * yang lalu menggagalkan pembacaan di seluruh situs. Hasilnya sekarang dibagi 5 detik per kurva
 * (termasuk yang sedang berjalan); kuncinya alamat kurva dari registry, jadi jumlahnya terbatas.
 */
const POOL_TTL_MS = 5_000;
const poolCache = new Map<string, { at: number; value: ReturnType<typeof readPoolState> }>();

function cachedPoolState(chain: ReturnType<typeof resolveChainOrDefault>, poolAddress: string): ReturnType<typeof readPoolState> {
  const key = `${chain.chainId}:${poolAddress.toLowerCase()}`;
  const now = Date.now();
  const hit = poolCache.get(key);
  if (hit && now - hit.at < POOL_TTL_MS) return hit.value;
  const value = readPoolState(chain, poolAddress);
  poolCache.set(key, { at: now, value });
  // Kegagalan tidak disimpan: permintaan berikutnya mencoba lagi alih-alih mewarisi galat.
  value.catch(() => {
    if (poolCache.get(key)?.value === value) poolCache.delete(key);
  });
  return value;
}

/**
 * SENGAJA tanpa batas laju per IP, dan cache di atas yang menggantikannya.
 *
 * Pemanggil terbesar rute ini adalah Worker x402: `resolveMarket` memanggilnya untuk setiap
 * kutipan dan setiap pembelian. Subrequest Worker tiba di origin dengan SATU `cf-connecting-ip`
 * milik Cloudflare, jadi batas per IP di sini menjadi batas GLOBAL untuk seluruh gerbang x402 —
 * dan siapa pun yang membanjiri kutipan di Worker akan menghabiskannya untuk pembeli sungguhan.
 * Biaya RPC rute ini sudah dibatasi cache (paling banyak satu pembacaan per kurva per 5 detik,
 * berapa pun permintaannya), jadi batas laju tidak menambah perlindungan yang berarti.
 */
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

    const state = await cachedPoolState(chain, project.poolAddress);
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
      /**
       * Keempat kaki, plus totalnya, dibaca dari kurva itu sendiri.
       *
       * Sebelumnya hanya dua yang dikirim, dan order book menghitung harga kliringnya
       * dari dua itu saja — jadi tangganya selalu lebih bagus daripada kenyataan
       * sebesar kaki creator. Kaki protokol memperlebar selisih itu, jadi totalnya
       * dikirim eksplisit supaya pemakainya tidak perlu menjumlah sendiri dan tidak
       * bisa lupa satu kaki lagi nanti.
       */
      creatorFeeBps: Number(state.creatorFeeBps),
      protocolFeeBps: Number(state.protocolFeeBps),
      totalFeeBps: Number(state.totalFeeBps),
    });
  } catch (error: any) {
    return NextResponse.json({ error: publicErrorMessage(error) }, { status: 500 });
  }
}
