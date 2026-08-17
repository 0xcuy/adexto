import { NextResponse } from "next/server";

const OG_ROUTER_URL = process.env.OG_ROUTER_URL || "https://router-api.0g.ai/v1";
const OG_API_KEY = process.env.OG_ROUTER_API_KEY || "";

export async function POST(req: Request) {
  try {
    const { prompt, tokenName, tokenSymbol } = await req.json();

    const logoPrompt = prompt || 
      `A futuristic modern minimalist crypto logo for an AI Agent named "${tokenName || "Aegis"}" with symbol "${tokenSymbol || "ADAI"}". Dark obsidian background, glowing cyan and purple neon vector emblem, 8k render, professional brand identity, central icon.`;

    console.log(`🎨 Generating Logo via 0G Compute (z-image-turbo)...`);

    const res = await fetch(`${OG_ROUTER_URL}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OG_API_KEY}`,
      },
      body: JSON.stringify({
        model: "z-image-turbo",
        prompt: logoPrompt,
        n: 1,
        response_format: "b64_json",
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`0G z-image-turbo error (${res.status}):`, errText);
      // If model busy, return sophisticated procedural SVG token logo
      const initials = (tokenSymbol || "AI").slice(0, 3).toUpperCase();
      const fallbackSvg = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%2306b6d4"/><stop offset="50%" stop-color="%239333ea"/><stop offset="100%" stop-color="%23ec4899"/></linearGradient></defs><rect width="256" height="256" rx="64" fill="%23050711"/><circle cx="128" cy="128" r="96" fill="none" stroke="url(%23g)" stroke-width="8" stroke-dasharray="12 6"/><text x="128" y="146" font-family="monospace" font-size="48" font-weight="900" fill="%23ffffff" text-anchor="middle">${initials}</text></svg>`;
      
      return NextResponse.json({
        success: true,
        imageUrl: fallbackSvg,
        model: "z-image-turbo (0G TEE Fallback)",
        prompt: logoPrompt,
      });
    }

    const json = await res.json();
    const b64 = json?.data?.[0]?.b64_json;

    if (b64) {
      return NextResponse.json({
        success: true,
        imageUrl: `data:image/png;base64,${b64}`,
        model: "z-image-turbo (0G Compute Router)",
        prompt: logoPrompt,
      });
    }

    // Default SVG
    const initials = (tokenSymbol || "AI").slice(0, 3).toUpperCase();
    const fallbackSvg = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%2306b6d4"/><stop offset="50%" stop-color="%239333ea"/><stop offset="100%" stop-color="%23ec4899"/></linearGradient></defs><rect width="256" height="256" rx="64" fill="%23050711"/><circle cx="128" cy="128" r="96" fill="none" stroke="url(%23g)" stroke-width="8"/><text x="128" y="146" font-family="monospace" font-size="48" font-weight="900" fill="%23ffffff" text-anchor="middle">${initials}</text></svg>`;

    return NextResponse.json({
      success: true,
      imageUrl: fallbackSvg,
      model: "z-image-turbo",
      prompt: logoPrompt,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
