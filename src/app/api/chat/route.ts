import { NextResponse } from "next/server";

// 0G Compute Official Mainnet Router Endpoint
const OG_ROUTER_URL = process.env.OG_ROUTER_URL || "https://router-api.0g.ai/v1";
/**
 * Kunci HARUS dari environment. Sebelumnya ada kunci asli tertulis langsung
 * sebagai fallback di sini (dan ikut ter-commit), sehingga merotasi env tidak
 * mencabut kunci lama — siapa pun yang membaca repo tetap bisa memakainya.
 * Sekarang fail-closed: tanpa env, endpoint menolak dengan jelas.
 */
const OG_API_KEY = process.env.OG_ROUTER_API_KEY || "";

export async function POST(req: Request) {
  try {
    if (!OG_API_KEY) {
      return NextResponse.json(
        { error: "Agent chat is not configured: OG_ROUTER_API_KEY is missing on the server." },
        { status: 503 }
      );
    }
    const { messages, model, systemPrompt, chain, temperature } = await req.json();

    // Default to verified active model on 0G Mainnet Router
    const targetModel = model || "glm-5.3";

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
        /**
         * Model GLM di router 0G mengirim DUA aliran dalam satu delta:
         *
         * Ditulis "glm-5.2" waktu pertama ditemukan, dan itu bikin penanganan di
         * bawah terlihat seperti tambalan khusus satu versi yang boleh dibuang saat
         * versinya naik. Bukan. Diukur ulang pada glm-5.3: satu permintaan
         * menghasilkan 910 karakter `reasoning_content` berbanding 98 karakter
         * `content` — jadi perilakunya bertahan, dan membuang penanganan ini akan
         * menampilkan sembilan kali lebih banyak kalimat berpikir daripada jawaban.
         * `reasoning_content` (deliberasi internal) dan `content` (jawaban).
         * Kode lama memakai `content || reasoning_content`, sehingga yang tampil ke
         * user adalah kalimat berpikir model — "Let's write a concise review",
         * "Drafting the Review" — bukan jawabannya. Sekarang hanya `content` yang
         * dialirkan; reasoning disimpan dan baru dipakai sebagai cadangan kalau
         * model TIDAK menghasilkan jawaban sama sekali, supaya panel tidak kosong.
         */
        let emitted = false;
        let reasoning = "";
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          controller.close();
        };

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
                if (!emitted && reasoning) controller.enqueue(encoder.encode(reasoning));
                close();
                return;
              }

              if (trimmed.startsWith("data: ")) {
                try {
                  const parsed = JSON.parse(trimmed.slice(6));
                  const delta = parsed.choices?.[0]?.delta;
                  if (delta?.reasoning_content) reasoning += delta.reasoning_content;
                  if (delta?.content) {
                    emitted = true;
                    controller.enqueue(encoder.encode(delta.content));
                  }
                } catch {
                  // Potongan buffer yang belum lengkap; abaikan.
                }
              }
            }
          }
          if (!emitted && reasoning) controller.enqueue(encoder.encode(reasoning));
        } catch (err: any) {
          if (!closed) {
            closed = true;
            controller.error(err);
          }
        } finally {
          // Dulu `close()` dipanggil tanpa penjaga, jadi jalur [DONE] dan error
          // bisa menutup controller dua kali dan melempar TypeError.
          close();
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
