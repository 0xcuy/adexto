/**
 * Pembaca aliran /api/chat, dipakai bersama oleh studio co-pilot dan terminal token.
 *
 * KENAPA SATU BERKAS, BUKAN DUA SALINAN
 *
 * Sebelumnya kedua pemanggil menulis sendiri loop `reader.read()` + `decoder.decode`
 * yang identik. Selama wire format-nya teks mentah, duplikasi itu murah. Begitu
 * format berpindah ke SSE berframe, dua salinan berarti dua parser yang harus
 * berubah bersamaan — dan pola "dua salinan yang lalu berpisah" sudah beberapa kali
 * jadi sumber bug di repo ini. Jadi parsernya dipindah ke sini sekalian.
 *
 * KENAPA SSE, BUKAN TEKS MENTAH
 *
 * Model GLM di router 0G menghabiskan sebagian besar waktunya di `reasoning_content`,
 * dan itu sengaja tidak ditampilkan sebagai jawaban. Dengan teks mentah tidak ada
 * kanal untuk mengabarkan "masih berpikir", jadi klien menampilkan gelembung kosong
 * selama ~90% waktu tunggu — terlihat seperti aplikasi menggantung. Lihat catatan di
 * src/app/api/chat/route.ts.
 */

export interface ChatReasoningProgress {
  /** Jumlah karakter reasoning yang sudah diterima router. */
  chars: number;
  /** Ekor reasoning, sudah dirapikan jadi satu baris. Boleh kosong. */
  preview: string;
}

export interface ChatStreamHandlers {
  /** Sambungan hidup, sebelum token apa pun. Dipakai untuk mengganti spinner mati. */
  onOpen?: () => void;
  onReasoning?: (progress: ChatReasoningProgress) => void;
  /**
   * Potongan JAWABAN. `full` adalah akumulasi sampai sekarang, `delta` potongan baru.
   * Pemanggil hampir selalu ingin `full` karena itu yang dirender.
   */
  onContent?: (full: string, delta: string) => void;
  onDone?: (info: { reasoningChars: number; contentChars: number }) => void;
}

interface Frame {
  type?: string;
  chars?: number;
  preview?: string;
  text?: string;
  message?: string;
  reasoningChars?: number;
  contentChars?: number;
}

/**
 * Mengirim satu permintaan chat dan mengalirkan jawabannya.
 *
 * @returns jawaban utuh (kanal `content`), bukan reasoning.
 * @throws bila HTTP-nya gagal atau server mengirim frame error.
 */
export async function streamChat(
  payload: Record<string, unknown>,
  handlers: ChatStreamHandlers = {},
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  /**
   * Jalur galat TETAP JSON, bukan SSE.
   *
   * Kunci router yang belum diset menjawab 503 dengan penjelasan; membacanya sebagai
   * SSE akan menghasilkan "chat unavailable" yang tidak memberi tahu apa pun. Jadi
   * pesan aslinya diteruskan.
   */
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const json = await res.json();
      if (json?.error) detail = String(json.error);
    } catch {
      // Bukan JSON; biarkan detail apa adanya.
    }
    throw new Error(detail);
  }
  if (!res.body) throw new Error("The chat response had no body.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let errored: string | null = null;

  const handleFrame = (frame: Frame) => {
    switch (frame.type) {
      case "open":
        handlers.onOpen?.();
        break;
      case "reasoning":
        handlers.onReasoning?.({ chars: Number(frame.chars) || 0, preview: String(frame.preview ?? "") });
        break;
      case "content": {
        const delta = String(frame.text ?? "");
        if (!delta) break;
        full += delta;
        handlers.onContent?.(full, delta);
        break;
      }
      case "done":
        handlers.onDone?.({
          reasoningChars: Number(frame.reasoningChars) || 0,
          contentChars: Number(frame.contentChars) || 0,
        });
        break;
      case "error":
        errored = String(frame.message ?? "The 0G router reported an error.");
        break;
      default:
        // Tipe frame yang tidak dikenal diabaikan, supaya menambah tipe baru di
        // server tidak memecahkan klien yang belum diperbarui.
        break;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Frame SSE dipisah baris kosong. Sisanya disimpan: satu frame bisa terbelah
    // di antara dua chunk TCP, dan mem-parse separuh frame akan membuang token.
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      for (const line of part.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim();
        if (!raw) continue;
        try {
          handleFrame(JSON.parse(raw) as Frame);
        } catch {
          // Frame cacat dilewati, bukan menjatuhkan seluruh jawaban.
        }
      }
    }
  }

  if (errored) throw new Error(errored);
  return full;
}
