import { NextResponse } from "next/server";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { BodyTooLargeError, payloadTooLarge, readJsonBody } from "@/lib/body-limit";
import { AGENT_MODEL_IDS } from "@/lib/og-attestation";
import { publicErrorMessage } from "@/lib/public-error";
import { chainNameList } from "@/lib/chains";

// 0G Compute Official Mainnet Router Endpoint
const OG_ROUTER_URL = process.env.OG_ROUTER_URL || "https://router-api.0g.ai/v1";
/**
 * Kunci HARUS dari environment. Sebelumnya ada kunci asli tertulis langsung
 * sebagai fallback di sini (dan ikut ter-commit), sehingga merotasi env tidak
 * mencabut kunci lama — siapa pun yang membaca repo tetap bisa memakainya.
 * Sekarang fail-closed: tanpa env, endpoint menolak dengan jelas.
 */
const OG_API_KEY = process.env.OG_ROUTER_API_KEY || "";

/**
 * Batas laju, karena endpoint ini membelanjakan uang tanpa autentikasi.
 *
 * Setiap permintaan memanggil 0G Router yang berbayar. Sebelum ini tidak ada batas apa pun,
 * jadi satu loop `curl` bisa menghabiskan kuota dan gejalanya "agent chat mati", bukan "kami
 * dikuras". 20 per 5 menit longgar untuk percakapan manusia — satu tanya-jawab jarang lebih
 * dari beberapa permintaan — dan sempit untuk skrip.
 */
const CHAT_LIMIT = 20;
const CHAT_WINDOW_MS = 5 * 60 * 1000;

/**
 * Batas MASUKAN, karena `max_tokens` hanya membatasi keluaran.
 *
 * Tanpa ini satu permintaan bisa membawa riwayat sebesar jendela konteks model, dan 20
 * permintaan per 5 menit menjadi 20 kali konteks penuh yang dibayar kunci kami. Angkanya
 * longgar untuk pemakai sungguhan: prompt sistem terminal token (state kurva + mandat)
 * sekitar 3 KB, dan percakapan panel jarang lebih dari belasan giliran. Riwayat yang lebih
 * panjang DIPOTONG dari yang tertua, bukan ditolak, jadi percakapan panjang tetap jalan.
 */
const CHAT_MAX_BODY_BYTES = 128 * 1024;
const MAX_SYSTEM_PROMPT_CHARS = 8_000;
const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 8_000;
const MAX_HISTORY_CHARS = 32_000;
/** Model penalaran di router bisa berpikir lama sebelum token pertama; dua menit di atasnya. */
const CHAT_UPSTREAM_TIMEOUT_MS = 120_000;

type ChatMessage = { role: "user" | "assistant"; content: string };

/**
 * Riwayat yang dikirim ke router: hanya giliran `user`/`assistant` berisi teks, paling banyak
 * `MAX_MESSAGES`, masing-masing dipotong, dan totalnya dijaga dengan membuang yang tertua.
 *
 * Peran `system` dari klien dibuang. Prompt sistem sudah punya jalurnya sendiri
 * (`systemPrompt`, yang dibatasi panjangnya); membiarkan pesan `system` lain menyelip di
 * riwayat berarti dua jalur untuk hal yang sama, dan hanya satu yang dibatasi.
 */
function boundedMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];
  const out: ChatMessage[] = [];
  for (const m of input.slice(-MAX_MESSAGES)) {
    if (!m || typeof m !== "object") continue;
    const role = (m as { role?: unknown }).role;
    const content = (m as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string" || !content) continue;
    out.push({ role, content: content.slice(0, MAX_MESSAGE_CHARS) });
  }
  let total = out.reduce((n, m) => n + m.content.length, 0);
  while (out.length > 1 && total > MAX_HISTORY_CHARS) {
    total -= out[0].content.length;
    out.shift();
  }
  return out;
}

export async function POST(req: Request) {
  try {
    if (!OG_API_KEY) {
      return NextResponse.json(
        { error: "Agent chat is not configured: OG_ROUTER_API_KEY is missing on the server." },
        { status: 503 }
      );
    }
    // Diperiksa SEBELUM body dibaca dan sebelum model dipanggil: yang dibatasi adalah biaya,
    // dan biaya itu keluar di panggilan hilir, bukan di parsing.
    const gate = rateLimit(`chat:${clientIp(req)}`, CHAT_LIMIT, CHAT_WINDOW_MS);
    if (!gate.ok) {
      return NextResponse.json(
        {
          error: "Too many requests. This endpoint calls a paid model, so it is rate limited.",
          retryAfter: gate.retryAfter,
        },
        { status: 429, headers: rateLimitHeaders(gate) }
      );
    }
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req, CHAT_MAX_BODY_BYTES);
    } catch (e) {
      if (e instanceof BodyTooLargeError) return payloadTooLarge(e.limit);
      return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
    }

    /**
     * Model DIBATASI ke daftar yang memang ditawarkan situs ini.
     *
     * Sebelumnya `model` diteruskan apa adanya ke router dengan kunci kami. Router yang sama
     * melayani model lain yang jauh lebih mahal, jadi endpoint anonim ini adalah proxy gratis
     * ke model mana pun yang bisa dijangkau kunci itu. Model yang tidak dikenal jatuh ke
     * bawaan, bukan ditolak: Studio dan terminal token hanya pernah mengirim id dari
     * `AGENT_MODEL_IDS`, jadi yang berubah hanya pemanggil yang memilih model sendiri.
     */
    // Baris `targetModel` di bawah sengaja berbentuk "nama-variabel atau-bawaan": audit_consistency.mjs
    // membaca model bawaan chat dari pola itu untuk memastikan /api/chat tidak memakai model pool.
    const model =
      typeof body.model === "string" && (AGENT_MODEL_IDS as readonly string[]).includes(body.model) ? body.model : "";
    const targetModel = model || "glm-5.3";

    const messages = boundedMessages(body.messages);
    if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
      return NextResponse.json({ error: "messages must end with a user message." }, { status: 400 });
    }
    const systemPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt.slice(0, MAX_SYSTEM_PROMPT_CHARS) : "";
    const chain = typeof body.chain === "string" ? body.chain.slice(0, 40) : "";
    const temperature =
      typeof body.temperature === "number" && Number.isFinite(body.temperature)
        ? Math.min(Math.max(body.temperature, 0), 1.5)
        : undefined;

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
ADEXTO launches agent-bound ERC-20s onto their own bonding curve. Each launch deploys AdextoCurve, a constant-product (x*y=k) AMM with a virtual native reserve, so opening a market needs no liquidity deposit and costs gas only. The curve is the permanent venue: there is no external pool, no graduation step, and no withdraw/sweep/rescue function — native leaves only as a seller's payout or a fee claim to an immutable address. For 180 seconds after launch no wallet may hold more than 1% of supply. The buyback share of each swap accrues in the curve and is spent on a buy-and-burn when someone calls it; nothing runs it on a schedule. The launch factory is ADEXTO v1 (1.0.0), live on ${chainNameList()}; the caller is currently on ${chain || "Base"}. Inference runs on the 0G Compute Router. ERC-8004 identity binding is optional and verified against the Identity Registry at launch. The Cloudflare Workers x402 edge sells cross-chain buys: a caller pays USDC on Base with an EIP-3009 authorization and the curve on the target chain delivers the tokens straight to their address. Payment settlement is live and has been done with real funds. What is not built: routing that USDC into the curve's buyback vault, and the size of any buy is capped by the native inventory we hold, so the endpoint answers 503 once it runs out.
Help developers generate smart contracts, configure bonding curve parameters, audit tokenomics, and test on-chain actions. Answer directly and concisely in English with clean code blocks. Never claim an integration, audit, or partnership that is not listed above; if you are unsure whether ADEXTO has something, say you do not know.`,
    };

    const payload = {
      model: targetModel,
      messages: [systemMessage, ...messages],
      temperature: temperature ?? 0.3,
      max_tokens: 4096,
      stream: true,
    };

    /**
     * Permintaan hilir dihentikan ketika pengunjungnya pergi, atau setelah batas waktu.
     *
     * Sebelumnya tidak ada `signal` sama sekali: router yang menggantung menahan soket ini
     * selamanya, dan pengunjung yang menutup tab tetap membuat model menulis sampai 4.096
     * token yang tidak dibaca siapa pun — dibayar oleh kunci kami. `req.signal` gugur saat
     * klien memutus; `cancel()` pada aliran di bawah menangani kasus yang sama dari sisi
     * respons.
     */
    const upstream = new AbortController();
    const onClientGone = () => upstream.abort();
    req.signal?.addEventListener("abort", onClientGone, { once: true });
    const deadline = setTimeout(() => upstream.abort(), CHAT_UPSTREAM_TIMEOUT_MS);

    const res = await fetch(`${OG_ROUTER_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${OG_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: upstream.signal,
    }).catch((e) => {
      clearTimeout(deadline);
      throw e;
    });

    if (!res.ok) {
      clearTimeout(deadline);
      // Detail router dicatat di log server, tidak diteruskan apa adanya ke pemanggil anonim.
      const errText = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
      console.warn(`[adexto] chat router ${res.status}: ${errText}`);
      return NextResponse.json(
        { error: `0G Router Mainnet error (${res.status}).` },
        { status: res.status >= 500 ? 502 : res.status }
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
          clearTimeout(deadline);
          req.signal?.removeEventListener("abort", onClientGone);
          close();
        }
      },
      // Klien memutus di tengah aliran: hentikan juga generasi di router.
      cancel() {
        clearTimeout(deadline);
        upstream.abort();
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
      { error: `0G Compute Engine Error: ${publicErrorMessage(error, "Failed to stream")}` },
      { status: 500 }
    );
  }
}
