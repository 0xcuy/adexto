import { NextResponse } from "next/server";

// 0G Compute Official Mainnet Router Endpoint
const OG_ROUTER_URL = process.env.OG_ROUTER_URL || "https://router-api.0g.ai/v1";
const OG_API_KEY = process.env.OG_ROUTER_API_KEY || "";

export async function POST(req: Request) {
  try {
    const { messages, model, systemPrompt, chain, temperature } = await req.json();

    // Default to verified active model on 0G Mainnet Router
    const targetModel = model || "glm-5.2";

    const systemMessage = {
      role: "system",
      content:
        systemPrompt ||
        `You are the ADEXTO Autonomous Orchestrator Agent (adexto.xyz).
Powered by 0G Compute Router Mainnet, Uniswap v4 Sovereign Hooks on ${chain || "Base"}, and Cloudflare Workers x402 edge monetization.
Help developers generate smart contracts, configure dynamic AMM bonding curves, audit tokenomics, and test on-chain actions. Answer directly and concisely in English with clean code blocks.`,
    };

    const payload = {
      model: targetModel,
      messages: [systemMessage, ...messages],
      temperature: temperature ?? 0.3,
      max_tokens: 4096,
      stream: true,
    };

    const res = await fetch(`${OG_ROUTER_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${OG_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `0G Router Mainnet error (${res.status}): ${errText}` },
        { status: res.status }
      );
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const readableStream = new ReadableStream({
      async start(controller) {
        if (!res.body) {
          controller.close();
          return;
        }

        const reader = res.body.getReader();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith(":")) continue;

              if (trimmed === "data: [DONE]") {
                controller.close();
                return;
              }

              if (trimmed.startsWith("data: ")) {
                try {
                  const jsonStr = trimmed.slice(6);
                  const parsed = JSON.parse(jsonStr);
                  const delta = parsed.choices?.[0]?.delta;
                  const content = delta?.content || delta?.reasoning_content || "";
                  if (content) {
                    controller.enqueue(encoder.encode(content));
                  }
                } catch {
                  // Ignore partial buffer
                }
              }
            }
          }
        } catch (err: any) {
          controller.error(err);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: `0G Compute Engine Error: ${error.message || "Failed to stream"}` },
      { status: 500 }
    );
  }
}
