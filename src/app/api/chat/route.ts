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
        /**
         * Prompt ini pernah berbunyi "Powered by 0G Compute Router Mainnet, Uniswap v4
         * Sovereign Hooks on ${chain}, and Cloudflare Workers x402 edge monetization."
         *
         * Dua dari tiga bagian itu salah, dan ini tempat paling berbahaya untuk salah:
         * audit klaim membaca HALAMAN yang dirender, sementara kalimat di sini keluar
         * lewat mulut model. Tidak ada satu pun penjaga statis yang bisa menangkapnya,
         * dan model akan mengulanginya dengan yakin ke setiap penanya. Integrasi
         * Uniswap tidak pernah ada — kurvanya AMM sendiri — dan x402 baru menjawab
         * quote, belum menyelesaikan pembayaran. Instruksi terakhir ada supaya model
         * tidak mengisi sendiri kekosongan yang ditinggalkan koreksi ini.
         */
        `You are the ADEXTO Autonomous Orchestrator Agent (adexto.xyz).
ADEXTO launches agent-bound ERC-20s onto their own bonding curve. Each launch deploys SovereignCurve, a constant-product (x*y=k) AMM with a virtual native reserve, so opening a market needs no liquidity deposit and costs gas only. The curve is the permanent venue: there is no external pool, no graduation step, and no withdraw/sweep/rescue function — native leaves only as a seller's payout or the creator's fee claim. Live on 0G, Base, Arbitrum and Monad; the caller is currently on ${chain || "Base"}. Inference runs on the 0G Compute Router. ERC-8004 identity binding is optional and verified against the Identity Registry at launch. The Cloudflare Workers x402 edge answers HTTP 402 quotes only — settlement is not built and returns 501.
Help developers generate smart contracts, configure bonding curve parameters, audit tokenomics, and test on-chain actions. Answer directly and concisely in English with clean code blocks. Never claim an integration, audit, or partnership that is not listed above; if you are unsure whether ADEXTO has something, say you do not know.`,
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
        /**
         * Formatnya SSE berframe bertipe, bukan teks mentah lagi.
         *
         * Alasannya bukan kerapian. Model GLM di router 0G menghabiskan sebagian
         * besar waktunya di `reasoning_content`, dan itu SENGAJA tidak ditampilkan
         * sebagai jawaban (lihat catatan di bawah). Akibatnya, dengan wire format
         * teks mentah tidak ada kanal untuk mengabarkan "masih berpikir": server
         * diam total sampai token `content` pertama muncul. Diukur pada satu
         * permintaan glm-5.3: 910 karakter reasoning berbanding 98 karakter jawaban,
         * jadi kliennya menampilkan gelembung kosong selama ~90% waktu tunggu — yang
         * terlihat seperti aplikasi menggantung, bukan model yang bekerja.
         *
         * Frame yang dikirim:
         *   {"type":"open"}                          segera, supaya klien tahu
         *                                            sambungannya hidup
         *   {"type":"reasoning","chars":N,"preview"} progres fase berpikir
         *   {"type":"content","text":"..."}          potongan JAWABAN
         *   {"type":"done","reasoningChars","contentChars"}
         *   {"type":"error","message"}
         *
         * `preview` boleh ditampilkan, TAPI harus jelas berlabel sebagai proses
         * berpikir dan hilang begitu jawaban mulai masuk. Yang dulu salah bukan
         * menampilkan reasoning, melainkan menampilkannya SEBAGAI jawaban.
         */
        const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

        if (!res.body) {
          send({ type: "error", message: "0G router returned an empty body." });
          controller.close();
          return;
        }

        send({ type: "open" });

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
        let contentChars = 0;
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          controller.close();
        };

        /**
         * Frame reasoning di-throttle per 24 karakter.
         *
         * Satu frame per delta juga jalan, tapi tiap frame memicu satu setState di
         * klien; pada 910 karakter itu ratusan render untuk indikator yang cuma perlu
         * terlihat bergerak. 24 karakter cukup halus untuk mata dan memangkas
         * rendernya jadi puluhan.
         */
        let lastReasoningAt = 0;
        const flushReasoning = (force = false) => {
          if (reasoning.length === lastReasoningAt) return;
          if (!force && reasoning.length - lastReasoningAt < 24) return;
          lastReasoningAt = reasoning.length;
          send({
            type: "reasoning",
            chars: reasoning.length,
            // Ekor, bukan kepala: yang informatif adalah apa yang sedang dipikirkan
            // sekarang. Baris baru dirapikan supaya satu baris indikator tetap satu baris.
            preview: reasoning.slice(-110).replace(/\s+/g, " ").trim(),
          });
        };

        /**
         * Satu jalan keluar untuk semua akhir yang normal.
         *
         * Dulu cadangan "pakai reasoning kalau tidak ada jawaban" ditulis dua kali —
         * di jalur [DONE] dan sesudah loop — dan dua salinan seperti itulah yang
         * sebelumnya membuat controller sempat ditutup dua kali.
         */
        const finish = () => {
          if (!emitted && reasoning) {
            contentChars = reasoning.length;
            send({ type: "content", text: reasoning });
          }
          send({ type: "done", reasoningChars: reasoning.length, contentChars });
          close();
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
                flushReasoning(true);
                finish();
                return;
              }

              if (trimmed.startsWith("data: ")) {
                try {
                  const parsed = JSON.parse(trimmed.slice(6));
                  const delta = parsed.choices?.[0]?.delta;
                  if (delta?.reasoning_content) {
                    reasoning += delta.reasoning_content;
                    flushReasoning();
                  }
                  if (delta?.content) {
                    emitted = true;
                    contentChars += String(delta.content).length;
                    send({ type: "content", text: delta.content });
                  }
                } catch {
                  // Potongan buffer yang belum lengkap; abaikan.
                }
              }
            }
          }
          // Router menutup tanpa [DONE]. Tetap diakhiri rapi, bukan digantung.
          flushReasoning(true);
          finish();
        } catch (err: any) {
          /**
           * `controller.error()` DIGANTI frame error.
           *
           * Dulu galat di tengah aliran memakai controller.error(), yang di sisi
           * klien muncul sebagai fetch yang putus — tidak bisa dibedakan dari koneksi
           * mati, jadi panel hanya berhenti tanpa penjelasan. Sekarang alasannya ikut
           * terkirim, lalu stream ditutup normal.
           */
          if (!closed) {
            try {
              send({ type: "error", message: String(err?.message || err).slice(0, 200) });
            } catch {
              // controller sudah tidak menerima; tidak ada yang bisa dilakukan.
            }
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
        "Content-Type": "text/event-stream; charset=utf-8",
        // `no-transform` ikut disebut supaya proxy tidak "membantu" dengan
        // mengompres lalu menyangga aliran ini.
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        /**
         * Tanpa header ini, seluruh pekerjaan di atas bisa sia-sia di produksi.
         * Aplikasi berjalan di belakang Caddy; proxy yang menyangga respons akan
         * menahan frame sampai stream selesai, dan hasilnya persis gejala yang
         * sedang diperbaiki — diam lama, lalu semuanya muncul sekaligus. Header ini
         * dipatuhi nginx dan Caddy sebagai penanda "jangan sangga".
         */
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: `0G Compute Engine Error: ${error.message || "Failed to stream"}` },
      { status: 500 }
    );
  }
}
