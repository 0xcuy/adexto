/**
 * Membaca badan permintaan DENGAN batas ukuran.
 *
 * KENAPA INI ADA
 *
 * Tidak ada satu pun lapisan yang membatasi ukuran badan permintaan ke rute API:
 * `next.config.ts` tidak (route handler App Router memang tidak punya `bodyParser.sizeLimit`),
 * matcher middleware mengecualikan `/api`, dan `deploy/Caddyfile` tidak memasang
 * `request_body max_size`. Cloudflare memotong di sekitar 100 MB, dan jalur langsung ke origin
 * tidak memotong sama sekali.
 *
 * Jadi `await req.json()` di rute anonim berarti: kirim beberapa badan 100 MB sekaligus, proses
 * Node tunggal itu kehabisan heap, kontainer di-restart (`restart: always`) — dan restart itu
 * sekaligus MENGOSONGKAN pembatas laju yang disimpan di memori. Rute MCP malah menyalin badan
 * tiga kali (`text()`, `JSON.parse`, lalu `new Request(...)`).
 *
 * CARANYA
 *
 * `Content-Length` diperiksa lebih dulu, supaya badan yang mengaku besar ditolak tanpa satu
 * byte pun dibaca. Tetapi header itu ditulis pengirim dan boleh tidak ada (chunked), jadi
 * aliran tetap dibaca bertahap dan dihentikan begitu melewati batas — memori yang terpakai
 * paling banyak `maxBytes` ditambah satu potongan, berapa pun yang dikirim.
 */

export class BodyTooLargeError extends Error {
  readonly limit: number;
  constructor(limit: number) {
    super(`Request body is larger than ${limit} bytes.`);
    this.name = "BodyTooLargeError";
    this.limit = limit;
  }
}

/** Batas bawaan untuk rute JSON biasa. Badan yang sah di situs ini berukuran beberapa KB. */
export const DEFAULT_JSON_BODY_BYTES = 64 * 1024;

/**
 * Untuk rute yang membawa logo sebagai data URI: `MAX_IMAGE_DATA_URI_CHARS` (200.000) di
 * `src/lib/logo-image.ts`, ditambah ruang untuk field lainnya.
 */
export const IMAGE_JSON_BODY_BYTES = 512 * 1024;

export async function readTextBody(req: Request, maxBytes: number): Promise<string> {
  const declared = req.headers.get("content-length");
  if (declared !== null && declared.trim() !== "") {
    const n = Number(declared);
    if (Number.isFinite(n) && n > maxBytes) throw new BodyTooLargeError(maxBytes);
  }
  if (!req.body) return "";

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      // Sisa aliran dibatalkan, bukan dibaca sampai habis: membacanya adalah kerja yang
      // justru hendak dihindari.
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }

  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

/**
 * Pengganti `req.json()` dengan batas. Semantik kegagalannya sama: badan kosong atau bukan
 * JSON melempar `SyntaxError`, jadi pemanggil yang sudah menangkap galat parse tidak perlu
 * berubah. Badan yang terlalu besar melempar `BodyTooLargeError`.
 */
export async function readJsonBody<T = any>(req: Request, maxBytes = DEFAULT_JSON_BODY_BYTES): Promise<T> {
  const text = await readTextBody(req, maxBytes);
  return JSON.parse(text) as T;
}

/** Jawaban 413 yang seragam, supaya klien tahu yang salah adalah ukurannya. */
export function payloadTooLarge(limit: number): Response {
  return Response.json(
    { error: "payload_too_large", detail: `Request body is larger than ${limit} bytes.` },
    { status: 413 }
  );
}
