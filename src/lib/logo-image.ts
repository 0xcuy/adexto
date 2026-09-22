/**
 * Batas dan validasi untuk gambar token — dipakai klien DAN server.
 *
 * KENAPA SATU BERKAS, BUKAN ANGKA DI DUA TEMPAT
 *
 * Studio memeriksa berkas sebelum mengunggahnya, tapi pemeriksaan di browser bukan
 * penegakan: `/api/deploy` menerima JSON dari siapa pun dan `body.image` selama ini diterima
 * apa adanya (`image: body.image || "/logo.svg"`), tanpa satu pun batas. Jadi angkanya harus
 * dipakai bersama, dan yang mengikat adalah pemeriksaan di server.
 *
 * KENAPA ADA BATAS SAMA SEKALI
 *
 * Nilai ini disimpan sebagai field `image` di `projects.json` — SATU berkas JSON yang dibaca
 * dan di-parse utuh setiap kali registry disentuh. Batas registry-nya 500 pasar
 * (`MAX_CUSTOM_PROJECTS` di `src/lib/registry.ts`), jadi ukuran per gambar dikalikan 500.
 * Pada 256x256 PNG (~36 KB sebagai data URI) itu ~18 MB pada kondisi penuh, yang masih bisa
 * di-parse. Satu unggahan 5 MB tanpa batas menjadikannya 2,5 GB.
 *
 * CATATAN: nilai ini TIDAK ditambatkan ke 0G DA. Komentar di `/api/generate-logo` pernah
 * menyatakan sebaliknya sebagai alasan mematok 256 px. Diperiksa: payload yang diunggah
 * `handlePrepare` ke 0G DA berisi protocol, token, dex, agent, teeAttestation dan seterusnya
 * — tidak ada `image`, dan stage `prepare` bahkan tidak dikirimi field itu oleh studio.
 * Alasan membatasi ukuran tetap berlaku, tapi alasannya adalah registry, bukan DA.
 */

/** Sisi keluaran, sama dengan yang dipakai `/api/generate-logo` supaya keduanya sebanding. */
export const LOGO_PX = 256;

/**
 * Batas berkas MASUKAN, sebelum diperkecil.
 *
 * Bukan batas yang disimpan: apa pun yang diunggah digambar ulang ke kanvas 256x256, jadi yang
 * tersimpan selalu seukuran hasil generate. Angka ini semata melindungi tab dari men-decode
 * berkas raksasa — 2 MB sudah jauh di atas logo mana pun yang masuk akal.
 */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Untuk pesan di UI, supaya angkanya tidak ditulis ulang sebagai teks. */
export const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / (1024 * 1024);

/**
 * Tipe yang diterima. SVG sengaja TIDAK ada.
 *
 * Bukan karena `<img>` akan menjalankan skrip di dalamnya — ia tidak akan. Tapi SVG adalah
 * teks tak terbatas yang tidak bisa diperkecil oleh kanvas menjadi ukuran yang dapat
 * diprediksi, sehingga satu-satunya jaminan yang diberikan modul ini — apa pun yang masuk
 * keluar sebagai 256x256 — tidak berlaku untuknya.
 */
export const ACCEPTED_MIME = ["image/png", "image/jpeg", "image/webp"] as const;
export const ACCEPT_ATTR = ACCEPTED_MIME.join(",");

/**
 * Batas panjang data URI yang disimpan.
 *
 * 256x256 PNG dari kanvas berkisar 30–90 KB tergantung isinya (foto yang diperkecil
 * ter-encode jauh lebih besar daripada emblem rata). base64 menambah sekitar sepertiga.
 * 200.000 karakter memberi ruang untuk kasus terburuk yang wajar sambil tetap menolak
 * apa pun yang jelas bukan hasil jalur ini.
 */
export const MAX_IMAGE_DATA_URI_CHARS = 200_000;

export type ImageCheck = { ok: true; value: string } | { ok: false, reason: string };

/**
 * Validasi nilai `image` yang datang dari klien.
 *
 * Menerima dua bentuk, dan tidak lebih:
 *   1. jalur relatif di situs ini, seperti `/logo.svg` — bawaan waktu creator tidak memilih apa pun;
 *   2. data URI raster di dalam batas panjang.
 *
 * URL absolut ditolak dengan sengaja. Membiarkannya berarti `projects.json` menyimpan
 * hotlink ke host pihak ketiga: gambarnya bisa berubah menjadi apa pun setelah listing, atau
 * hilang, dan setiap pengunjung /explorer mengirimkan permintaan ke host itu.
 */
export function validateProjectImage(input: unknown): ImageCheck {
  if (input === undefined || input === null || input === "") return { ok: true, value: "/logo.svg" };

  if (typeof input !== "string") return { ok: false, reason: "image must be a string" };

  // Jalur internal: satu garis miring, lalu bukan garis miring lagi (`//host` adalah URL
  // protocol-relative, bukan jalur lokal).
  if (/^\/[^/]/.test(input)) {
    if (input.length > 512) return { ok: false, reason: "image path is too long" };
    return { ok: true, value: input };
  }

  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(input);
  if (!m) {
    return {
      ok: false,
      reason:
        "image must be a site-relative path or a base64 data URI of type " +
        `${ACCEPTED_MIME.join(", ")}`,
    };
  }
  if (input.length > MAX_IMAGE_DATA_URI_CHARS) {
    return {
      ok: false,
      reason:
        `image data URI is ${input.length} characters, over the ${MAX_IMAGE_DATA_URI_CHARS} limit. ` +
        `Images are stored inline in the market registry, so each one is capped.`,
    };
  }
  return { ok: true, value: input };
}
