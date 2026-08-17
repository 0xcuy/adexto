import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Fetch live spot prices from Binance / CoinGecko public feed
    const res = await fetch(
      "https://api.binance.com/api/v3/ticker/price?symbols=%5B%22ETHUSDT%22,%22ARBUSDT%22,%22BTCUSDT%22%5D",
      { next: { revalidate: 30 } } // cache for 30s
    );

    let ethPrice = 2650.0;
    let arbPrice = 0.55;
    let btcPrice = 62500.0;

    if (res.ok) {
      const data = await res.json();
      data.forEach((item: any) => {
        if (item.symbol === "ETHUSDT") ethPrice = parseFloat(item.price);
        if (item.symbol === "ARBUSDT") arbPrice = parseFloat(item.price);
        if (item.symbol === "BTCUSDT") btcPrice = parseFloat(item.price);
      });
    }

    const prices: Record<string, number> = {
      ETH: ethPrice,
      "0G": 1.0,
      A0GI: 1.0,
      USDC: 1.0,
      USDT: 1.0,
      cbBTC: btcPrice,
      ARB: arbPrice,
      MON: 0.25,
    };

    return NextResponse.json({ success: true, prices, updatedAt: new Date().toISOString() });
  } catch (error: any) {
    // Fallback benchmark
    return NextResponse.json({
      success: true,
      prices: {
        ETH: 2650.0,
        "0G": 1.0,
        A0GI: 1.0,
        USDC: 1.0,
        USDT: 1.0,
        cbBTC: 62500.0,
        ARB: 0.55,
        MON: 0.25,
      },
    });
  }
}
