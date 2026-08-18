import { NextResponse } from "next/server";

export async function GET() {
  try {
    let ethPrice = 2650.0;
    let arbPrice = 0.55;
    let btcPrice = 62500.0;
    let ogPrice = 0.15; // default fallback

    // 1. Fetch live major spot prices from Binance public feed
    try {
      const res = await fetch(
        "https://api.binance.com/api/v3/ticker/price?symbols=%5B%22ETHUSDT%22,%22ARBUSDT%22,%22BTCUSDT%22%5D",
        { next: { revalidate: 30 } }
      );
      if (res.ok) {
        const data = await res.json();
        data.forEach((item: any) => {
          if (item.symbol === "ETHUSDT") ethPrice = parseFloat(item.price);
          if (item.symbol === "ARBUSDT") arbPrice = parseFloat(item.price);
          if (item.symbol === "BTCUSDT") btcPrice = parseFloat(item.price);
        });
      }
    } catch {}

    // 2. Fetch live 0G price feed from CoinGecko / DEX public oracle
    try {
      const cgRes = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=zero-gravity,0g-network,arbitrum,ethereum&vs_currencies=usd",
        { next: { revalidate: 30 } }
      );
      if (cgRes.ok) {
        const cgData = await cgRes.json();
        if (cgData["zero-gravity"]?.usd) {
          ogPrice = parseFloat(cgData["zero-gravity"].usd);
        } else if (cgData["0g-network"]?.usd) {
          ogPrice = parseFloat(cgData["0g-network"].usd);
        }
      }
    } catch {}

    const prices: Record<string, number> = {
      ETH: ethPrice,
      "0G": ogPrice,
      A0GI: ogPrice,
      USDC: 1.0,
      USDT: 1.0,
      cbBTC: btcPrice,
      ARB: arbPrice,
      MON: 0.25,
    };

    return NextResponse.json({ success: true, prices, updatedAt: new Date().toISOString() });
  } catch (error: any) {
    return NextResponse.json({
      success: true,
      prices: {
        ETH: 2650.0,
        "0G": 0.15,
        A0GI: 0.15,
        USDC: 1.0,
        USDT: 1.0,
        cbBTC: 62500.0,
        ARB: 0.55,
        MON: 0.25,
      },
    });
  }
}
