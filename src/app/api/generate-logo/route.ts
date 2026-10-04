import { NextResponse } from "next/server";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
/**
 * `LOGO_PX` diimpor, tidak lagi ditulis ulang di sini.
 *
 * Studio memperkecil logo yang diunggah ke sisi yang sama supaya kedua jalur memakan ruang
 * registry yang sebanding. Dua konstanta terpisah akan menyimpang tanpa ada yang gagal.
 */
import { LOGO_PX, sniffImageMime, validateProjectImage } from "@/lib/logo-image";
import { readJsonBody } from "@/lib/body-limit";

const OG_ROUTER_URL = process.env.OG_ROUTER_URL || "https://router-api.0g.ai/v1";
const OG_API_KEY = process.env.OG_ROUTER_API_KEY || "";

/**
 * Ukuran keluaran DIPATOK, dan angkanya berasal dari pengukuran.
 *
 * Sebelumnya `size` tidak dikirim sama sekali, jadi z-image-turbo memakai
 * defaultnya. Diukur langsung ke router:
 *
 *   tanpa size  -> 1024x1024, PNG 464 KiB, data URI ~618 KiB, 6,1 s
 *   512x512     ->  512x512,  PNG  76 KiB, data URI ~102 KiB, 2,3 s
 *   256x256     ->  256x256,  PNG  27 KiB, data URI  ~36 KiB, 1,7 s
 *
 * Logo ini dirender paling besar `w-16 h-16` (64 px) di studio, dan 48 px di kartu
 * /explorer. Pada DPR 3x itu 192 px, jadi 256 px masih melebihi kebutuhan sementara
 * ukurannya 17x lebih kecil dan 3,6x lebih cepat.
 *
 * Bukan cuma soal kenyamanan: data URI ini disimpan sebagai field `image` di
 * projects.json — satu berkas JSON yang dibaca dan di-parse utuh oleh registry.
 * 618 KiB per proyek dikalikan batas 500 proyek berarti berkas registry ratusan
 * megabita.
 *
 * KOREKSI: blok ini dulu menambahkan "DAN ikut masuk metadata yang ditambatkan ke 0G DA,
 * yang tidak bisa ditarik kembali". Itu tidak benar, dan permanensi adalah alasan yang jauh
 * lebih berat daripada yang sebenarnya berlaku. Diperiksa: payload yang `handlePrepare`
 * unggah ke 0G DA berisi protocol, token, dex, agent dan teeAttestation — tidak ada `image`,
 * dan studio bahkan tidak mengirim field itu ke stage `prepare`. Batasnya tetap benar; yang
 * dilindungi adalah registry, bukan DA.
 */
const LOGO_SIZE = `${LOGO_PX}x${LOGO_PX}`;

/**
 * Prompt tidak lagi meminta tema gelap, dan tidak lagi meminta "8k".
 *
 * Dua alasan. Pertama, situsnya cream/terang sejak lama, sementara prompt ini masih
 * meminta "dark obsidian background, glowing cyan and purple neon" — palet produk
 * yang sudah tidak ada, jadi logonya selalu bertabrakan dengan halaman yang
 * memuatnya. Kedua, "8k render" mendorong model ke keluaran besar, yang persis
 * masalah yang dipatok LOGO_SIZE di atas.
 *
 * Larangan teks ditambahkan karena model gambar menuliskan huruf yang rusak kalau
 * tidak dilarang, dan sebuah logo dengan teks berantakan lebih buruk daripada logo
 * tanpa teks.
 */
/**
 * Prompt sekarang meminta RENDER 3D dari satu subjek konkret, dan subjeknya ditulis dari
 * deskripsi creator.
 *
 * KENAPA DIGANTI LAGI, dan ini terbaca di keluarannya
 *
 * Studio hanya mengirim nama dan ticker, jadi prompt selalu jatuh ke cabang "lencana
 * abstrak". Diukur 2026-10-01 pada produksi: "Aegis Quant AI" keluar sebagai dua bentuk
 * ungu yang terbaca sebagai huruf "M" — persis keluhan "generic, cuma logo huruf". Larangan
 * "not a letterform" di prompt lama tidak menolong: bentuk abstrak dua-tiga lingkaran
 * memang paling mudah terbaca sebagai huruf, apa pun yang dilarang.
 *
 * Penyebab dasarnya: model gambar tidak tahu APA yang harus digambar. Nama saja bukan
 * petunjuk visual ("Wombo" bukan berarti wombat bagi model), dan deskripsi creator tidak
 * pernah sampai ke sini.
 *
 * DUA LANGKAH, dan kenapa langkah pertama memakai model teks
 *
 * 1. `visualBrief` meminta glm-5.3 menulis SATU kalimat subjek dari nama, ticker, pitch
 *    dan mandat agent: "a glossy shield hovering above a translucent candlestick chart…".
 *    Deskripsi creator biasanya kalimat pemasaran, bukan benda; menerjemahkannya menjadi
 *    benda adalah pekerjaan model bahasa, bukan model gambar.
 * 2. Kalimat itu dimasukkan ke templat 3D di bawah.
 *
 * Langkah pertama BOLEH gagal: tanpa jawaban model, subjeknya disusun dari deskripsi atau
 * nama apa adanya, dan gambar tetap dibuat. Yang dipakai dilaporkan di `briefSource`.
 *
 * KENAPA 3D SEKARANG AMAN DI 256 PX — dulu alasannya untuk "flat vector"
 *
 * Komentar lama berkata bayangan dan tekstur menjadi bubur di 48–64 px. Itu benar untuk
 * adegan yang ramai, dan tidak untuk SATU objek bulat dengan siluet tegas di latar polos —
 * itulah yang diminta templat ini ("app-icon composition"). Diukur di router: tiga subjek
 * pada 256x256 keluar 64–70 KB PNG (~94 ribu karakter data URI, di bawah batas 200 ribu
 * `MAX_IMAGE_DATA_URI_CHARS`), terbaca jelas dan tanpa huruf.
 *
 * YANG TETAP DIPERTAHANKAN:
 *   - larangan teks, sebab z-image-turbo pandai menulis huruf dan akan melakukannya;
 *   - latar cream terang, sebab situsnya cream.
 */
const BRIEF_MODEL = "glm-5.3";
/** Batas waktu langkah brief. Diukur ~2,6 s dengan `reasoning_effort: "low"`. */
const BRIEF_TIMEOUT_MS = 12_000;
const BRIEF_MAX_CHARS = 240;

const BRIEF_SYSTEM =
  "You write the subject for a 3D app-icon render that represents a crypto token. " +
  "Reply with ONE sentence of at most 25 words naming one concrete object, creature or character, " +
  "with its key materials and colours. Take the subject from the description when there is one, " +
  "otherwise from the name. Keep it friendly and family-safe; if the input asks for anything violent, " +
  "sexual or hateful, describe a neutral glowing gemstone instead. Never include text, letters, " +
  "numbers, logos, brand names or real people. Reply with the sentence only.";

interface BriefInput {
  tokenName?: string;
  tokenSymbol?: string;
  description?: string;
  persona?: string;
  subject?: string;
}

/** Satu baris, tanpa kutip pembungkus, dipotong. Keluaran model diperlakukan sebagai data. */
function cleanBrief(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/[.。]+$/, "")
    .slice(0, BRIEF_MAX_CHARS)
    .trim();
}

/**
 * Subjek tanpa model: dari `subject`, lalu deskripsi, lalu nama.
 *
 * Dipakai ketika langkah brief gagal atau kunci router tidak ada. Bukan sebaik brief model,
 * tapi tetap memberi model gambar sesuatu yang bisa digambar alih-alih "a community token".
 */
function fallbackBrief(input: BriefInput): string {
  const subject = input.subject?.trim();
  if (subject) return cleanBrief(subject);
  const name = input.tokenName?.trim() || "a community token";
  const description = input.description?.trim();
  return cleanBrief(
    description
      ? `a single friendly object that stands for "${name}": ${description}`
      : `a single friendly object or mascot that stands for "${name}"`
  );
}

async function visualBrief(input: BriefInput): Promise<{ text: string; source: "model" | "input" }> {
  // `subject` eksplisit menang: pemanggil yang sudah tahu wujudnya tidak perlu ditafsirkan ulang.
  if (input.subject?.trim() || !OG_API_KEY) return { text: fallbackBrief(input), source: "input" };

  const lines = [
    `Token name: ${input.tokenName?.trim() || "(none)"}`,
    input.tokenSymbol?.trim() ? `Ticker: ${input.tokenSymbol.trim().toUpperCase()}` : null,
    input.description?.trim() ? `Description: ${input.description.trim().slice(0, 300)}` : null,
    input.persona?.trim() ? `Agent mandate: ${input.persona.trim().slice(0, 300)}` : null,
  ].filter(Boolean);

  try {
    const res = await fetch(`${OG_ROUTER_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OG_API_KEY}` },
      body: JSON.stringify({
        model: BRIEF_MODEL,
        /**
         * `reasoning_effort: "low"` bukan penyetelan kosmetik. Tanpa itu glm-5.3 menghabiskan
         * seluruh 400 token di `reasoning_content` dan mengembalikan `content` KOSONG setelah
         * 7,8 s (diukur). Dengan "low": 2,6 s, reasoning 21 karakter, kalimatnya utuh.
         */
        reasoning_effort: "low",
        temperature: 0.5,
        max_tokens: 300,
        messages: [
          { role: "system", content: BRIEF_SYSTEM },
          { role: "user", content: lines.join("\n") },
        ],
      }),
      signal: AbortSignal.timeout(BRIEF_TIMEOUT_MS),
    });
    if (!res.ok) return { text: fallbackBrief(input), source: "input" };
    const json = await res.json();
    const text = cleanBrief(String(json?.choices?.[0]?.message?.content ?? ""));
    // Kurang dari tiga kata hampir pasti bukan subjek, melainkan sisa penolakan atau galat.
    if (text.split(" ").length < 3) return { text: fallbackBrief(input), source: "input" };
    return { text, source: "model" };
  } catch {
    return { text: fallbackBrief(input), source: "input" };
  }
}

function defaultPrompt(brief: string): string {
  return (
    `3D render of ${brief}. One single centred subject, app-icon composition, smooth rounded forms, ` +
    `glossy soft-plastic and clay materials, soft studio lighting with a gentle contact shadow, ` +
    `vivid harmonious colours, plain warm cream background. Crisp silhouette that stays readable ` +
    `at small size. No text, no letters, no numbers, no logos, no watermark, no border.`
  );
}

/**
 * Logo cadangan prosedural, dengan palet yang dipakai situs SEKARANG.
 *
 * Versi lama memakai latar #050711 dengan gradien cyan/ungu/pink — tema gelap yang
 * sudah dicabut dari seluruh aplikasi, sehingga logo cadangan terlihat berasal dari
 * produk lain. Nilai di bawah diambil dari globals.css: cream-2 #fbf8f1,
 * accent #7c3aed, ink #201810, line #e7dcc7.
 *
 * Di-encode base64, bukan ditempel apa adanya. Bentuk `utf8,` yang lama membiarkan
 * `<`, `>` dan tanda kutip mentah di dalam URI — kebetulan jalan di atribut `src`,
 * tapi pecah begitu string yang sama masuk ke CSS, ke JSON, atau ke metadata.
 */
function proceduralLogo(tokenSymbol?: string): string {
  const initials = (tokenSymbol || "AI").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "AI";
  const c = LOGO_PX / 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${LOGO_PX}" height="${LOGO_PX}" viewBox="0 0 ${LOGO_PX} ${LOGO_PX}">` +
    `<rect width="${LOGO_PX}" height="${LOGO_PX}" rx="64" fill="#fbf8f1"/>` +
    `<rect x="4" y="4" width="${LOGO_PX - 8}" height="${LOGO_PX - 8}" rx="60" fill="none" stroke="#e7dcc7" stroke-width="2"/>` +
    `<circle cx="${c}" cy="${c}" r="92" fill="none" stroke="#7c3aed" stroke-width="6" stroke-opacity="0.9"/>` +
    `<circle cx="${c}" cy="${c}" r="74" fill="#7c3aed" fill-opacity="0.08"/>` +
    `<text x="${c}" y="${c + 17}" font-family="ui-monospace,monospace" font-size="46" font-weight="700" ` +
    `fill="#201810" text-anchor="middle">${initials}</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/**
 * Jawaban menyebut APA yang benar-benar terjadi.
 *
 * Versi lama mengembalikan `model: "z-image-turbo (0G TEE Fallback)"` pada jalur
 * yang TIDAK memanggil model apa pun — dan menyebut TEE, yang tidak diverifikasi
 * di mana pun di repo ini. Satu jalur lain bahkan mengembalikan `model:
 * "z-image-turbo"` polos untuk SVG yang digambar sendiri. Keduanya `success: true`,
 * jadi pemanggil tidak punya cara membedakan logo hasil model dari gambar
 * cadangan. Itu kelas klaim yang sama yang dicabut dari seluruh situs ini.
 *
 * `generated` sekarang satu-satunya sumber jawaban untuk "apakah ada model yang
 * jalan", dan `model` bernilai null kalau tidak ada.
 */
interface LogoResponse {
  imageUrl: string;
  generated: boolean;
  source: "0g-router" | "procedural-svg";
  model: string | null;
  size: string | null;
  prompt: string;
  /** Subjek yang digambar, dan dari mana asalnya: ditulis model teks, atau disusun dari masukan. */
  brief?: string;
  briefSource?: "model" | "input" | "caller-prompt";
  note?: string;
}

function fallback(
  prompt: string,
  tokenSymbol: string | undefined,
  note: string,
  brief?: { text: string; source: LogoResponse["briefSource"] }
): NextResponse {
  const body: LogoResponse = {
    imageUrl: proceduralLogo(tokenSymbol),
    generated: false,
    source: "procedural-svg",
    model: null,
    size: `${LOGO_PX}x${LOGO_PX}`,
    prompt,
    brief: brief?.text,
    briefSource: brief?.source,
    note,
  };
  // Tetap HTTP 200: gambarnya memang bisa dipakai. Yang membedakan `generated`.
  return NextResponse.json(body);
}

/**
 * Lebih ketat daripada `/api/chat`, dan sengaja.
 *
 * Pembuatan gambar jauh lebih mahal per panggilan daripada satu penyelesaian teks, dan
 * pemakaian nyatanya jauh lebih jarang: seorang creator membuat logo beberapa kali saat
 * meluncurkan satu pasar, bukan puluhan kali per menit. 8 per 10 menit tidak akan pernah
 * disentuh orang yang sedang memakai studio.
 */
const LOGO_LIMIT = 8;
const LOGO_WINDOW_MS = 10 * 60 * 1000;

export async function POST(req: Request) {
  let prompt = "";
  let tokenSymbol: string | undefined;

  try {
    /**
     * Dibatasi SEBELUM model dipanggil, dan jawabannya 429 — bukan `fallback()`.
     *
     * `fallback()` mengembalikan HTTP 200 dengan logo cadangan, yang benar ketika model
     * tidak dikonfigurasi atau gagal: pemanggilnya tetap dapat gambar. Tetapi untuk batas
     * laju, 200 akan menyembunyikan penolakannya — pemanggil tidak tahu harus mundur, dan
     * sebuah skrip akan terus memukul dengan kecepatan penuh. Yang dibedakan di sini adalah
     * "kami tidak bisa menggambar" versus "kamu terlalu cepat".
     */
    const gate = rateLimit(`logo:${clientIp(req)}`, LOGO_LIMIT, LOGO_WINDOW_MS);
    if (!gate.ok) {
      return NextResponse.json(
        {
          error: "Too many logo requests. Image generation is billed per call, so it is rate limited.",
          retryAfter: gate.retryAfter,
        },
        { status: 429, headers: rateLimitHeaders(gate) }
      );
    }
    // Dibatasi: semua field dipotong ke beberapa ratus karakter di bawah, jadi badan yang sah
    // tidak pernah mendekati 64 KB. Badan yang lebih besar dibaca sebagai kosong.
    const parsed: any = await readJsonBody(req).catch(() => ({}));
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
    tokenSymbol = str(parsed.tokenSymbol, 16);
    const tokenName = str(parsed.tokenName, 64);
    /**
     * `subject` menggambarkan WUJUD yang digambar — "a round wombat astronaut". Kalau ada, ia
     * dipakai apa adanya. `description` (pitch creator) dan `persona` (mandat agent) adalah
     * bahan untuk brief model; keduanya opsional, dan tanpa keduanya brief ditulis dari nama.
     */
    const briefInput: BriefInput = {
      tokenName,
      tokenSymbol,
      subject: str(parsed.subject, BRIEF_MAX_CHARS),
      description: str(parsed.description, 300),
      persona: str(parsed.persona, 300),
    };

    let brief: { text: string; source: LogoResponse["briefSource"] };
    if (typeof parsed.prompt === "string" && parsed.prompt.trim()) {
      prompt = parsed.prompt.trim().slice(0, 1200);
      brief = { text: prompt, source: "caller-prompt" };
    } else {
      brief = await visualBrief(briefInput);
      prompt = defaultPrompt(brief.text);
    }

    if (!OG_API_KEY) {
      return fallback(prompt, tokenSymbol, "OG_ROUTER_API_KEY is not set on the server, so no model was called.", brief);
    }

    const res = await fetch(`${OG_ROUTER_URL}/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OG_API_KEY}` },
      body: JSON.stringify({
        model: "z-image-turbo",
        prompt,
        n: 1,
        size: LOGO_SIZE,
        response_format: "b64_json",
      }),
      // Tanpa batas waktu, router yang menggantung menahan soket dan memori permintaan ini
      // selamanya. Render "turbo" diukur dalam detik; 60 detik jauh di atasnya, dan habisnya
      // waktu jatuh ke `catch` di bawah yang tetap mengembalikan logo cadangan.
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const errText = (await res.text()).replace(/\s+/g, " ").slice(0, 200);
      console.warn(`[adexto] z-image-turbo ${res.status}: ${errText}`);
      return fallback(prompt, tokenSymbol, `0G router returned ${res.status}, so a procedural logo was drawn instead.`, brief);
    }

    const json = await res.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (typeof b64 !== "string" || b64.length === 0) {
      return fallback(prompt, tokenSymbol, "0G router answered without image data, so a procedural logo was drawn instead.", brief);
    }

    /**
     * Diperiksa dengan aturan yang SAMA dengan `/api/deploy` sebelum dikembalikan.
     *
     * Render 3D lebih berat daripada emblem datar (diukur 64–70 KB, dulu ~43 KB). Masih jauh
     * di bawah batas, tetapi kalau suatu render melewatinya, creator baru tahu SESUDAH token
     * hidup di chain: confirm menolak gambarnya dengan 400. Lebih baik ditolak di sini, saat
     * menekan Generate lagi masih gratis.
     */
    /**
     * Label diambil dari BYTE-nya, bukan diasumsikan PNG.
     *
     * `validateProjectImage` sekarang menolak data URI yang labelnya tidak cocok dengan isinya
     * (lihat `sniffImageMime`). Kalau router suatu hari menjawab JPEG atau WebP, label PNG yang
     * ditulis mati di sini akan membuat setiap render jatuh ke `fallback()`.
     */
    const kind = sniffImageMime(b64);
    if (!kind) {
      return fallback(prompt, tokenSymbol, "0G router answered with bytes that are not a PNG, JPEG or WebP image.", brief);
    }
    const imageUrl = `data:${kind};base64,${b64}`;
    const check = validateProjectImage(imageUrl);
    if (!check.ok) {
      return fallback(prompt, tokenSymbol, `The render was too large to list (${check.reason}). Generate again.`, brief);
    }

    const body: LogoResponse = {
      imageUrl,
      generated: true,
      source: "0g-router",
      model: "z-image-turbo",
      size: LOGO_SIZE,
      prompt,
      brief: brief.text,
      briefSource: brief.source,
    };
    return NextResponse.json(body);
  } catch (error: any) {
    // Bahkan kegagalan tak terduga tetap mengembalikan gambar yang bisa dipakai,
    // tapi TIDAK pernah mengaku sebagai hasil model.
    return fallback(
      prompt || defaultPrompt(fallbackBrief({ tokenSymbol })),
      tokenSymbol,
      `Logo generation failed: ${String(error?.message || error).slice(0, 120)}`
    );
  }
}
