import { NextResponse } from "next/server";

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
 * projects.json — satu berkas JSON yang dibaca dan di-parse utuh oleh registry —
 * DAN ikut masuk metadata yang ditambatkan ke 0G DA, yang tidak bisa ditarik
 * kembali. 618 KiB per proyek dikalikan batas 500 proyek berarti berkas registry
 * ratusan megabita.
 */
const LOGO_SIZE = "256x256";

/** Angka yang sama dengan LOGO_SIZE, dipakai untuk SVG cadangan. */
const LOGO_PX = 256;

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
function defaultPrompt(tokenName?: string, tokenSymbol?: string): string {
  const name = tokenName?.trim() || "an autonomous agent";
  const symbol = tokenSymbol?.trim() ? ` (${tokenSymbol.trim()})` : "";
  return (
    `Minimalist flat vector emblem for ${name}${symbol}, an autonomous AI agent token. ` +
    `One single centred geometric glyph, deep violet on a plain light background, ` +
    `generous margins, crisp edges, no gradients, no photorealism, no drop shadows. ` +
    `Absolutely no text, no letters, no numbers, no watermark.`
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
  note?: string;
}

function fallback(prompt: string, tokenSymbol: string | undefined, note: string): NextResponse {
  const body: LogoResponse = {
    imageUrl: proceduralLogo(tokenSymbol),
    generated: false,
    source: "procedural-svg",
    model: null,
    size: `${LOGO_PX}x${LOGO_PX}`,
    prompt,
    note,
  };
  // Tetap HTTP 200: gambarnya memang bisa dipakai. Yang membedakan `generated`.
  return NextResponse.json(body);
}

export async function POST(req: Request) {
  let prompt = "";
  let tokenSymbol: string | undefined;

  try {
    const parsed = await req.json().catch(() => ({}));
    tokenSymbol = typeof parsed.tokenSymbol === "string" ? parsed.tokenSymbol : undefined;
    const tokenName = typeof parsed.tokenName === "string" ? parsed.tokenName : undefined;
    prompt = typeof parsed.prompt === "string" && parsed.prompt.trim()
      ? parsed.prompt.trim()
      : defaultPrompt(tokenName, tokenSymbol);

    if (!OG_API_KEY) {
      return fallback(prompt, tokenSymbol, "OG_ROUTER_API_KEY is not set on the server, so no model was called.");
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
    });

    if (!res.ok) {
      const errText = (await res.text()).replace(/\s+/g, " ").slice(0, 200);
      console.warn(`[adexto] z-image-turbo ${res.status}: ${errText}`);
      return fallback(prompt, tokenSymbol, `0G router returned ${res.status}, so a procedural logo was drawn instead.`);
    }

    const json = await res.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (typeof b64 !== "string" || b64.length === 0) {
      return fallback(prompt, tokenSymbol, "0G router answered without image data, so a procedural logo was drawn instead.");
    }

    const body: LogoResponse = {
      imageUrl: `data:image/png;base64,${b64}`,
      generated: true,
      source: "0g-router",
      model: "z-image-turbo",
      size: LOGO_SIZE,
      prompt,
    };
    return NextResponse.json(body);
  } catch (error: any) {
    // Bahkan kegagalan tak terduga tetap mengembalikan gambar yang bisa dipakai,
    // tapi TIDAK pernah mengaku sebagai hasil model.
    return fallback(
      prompt || defaultPrompt(),
      tokenSymbol,
      `Logo generation failed: ${String(error?.message || error).slice(0, 120)}`
    );
  }
}
