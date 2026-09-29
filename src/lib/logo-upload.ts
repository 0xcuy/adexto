"use client";

import {
  ACCEPTED_MIME,
  LOGO_PX,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MB,
  validateProjectImage,
} from "@/lib/logo-image";

/**
 * Baca berkas yang dipilih creator menjadi data URI persegi `LOGO_PX × LOGO_PX`.
 *
 * KENAPA DI SINI DAN BUKAN DI KOMPONEN
 *
 * Langkah ini semula hidup inline di `studio/page.tsx`, dan itu benar selama studio adalah
 * satu-satunya tempat gambar bisa dipilih. Sejak pemilik pasar juga bisa mengganti gambar
 * dari halaman pasarnya, salinan kedua akan berarti dua aturan ukuran, dua batas berkas, dan
 * dua kalimat galat yang perlahan berbeda — padahal server hanya punya satu validator.
 *
 * Yang dijaga di sini persis yang dijaga sebelumnya, tanpa pelonggaran:
 *   - hanya PNG/JPEG/WebP;
 *   - maksimum `MAX_UPLOAD_MB` MB;
 *   - WAJIB persegi, karena gambar dirender di kotak persegi di setiap permukaan dan
 *     memotongnya sendiri akan memotong bagian yang mungkin justru isi logonya;
 *   - hasil kanvas diperiksa ulang dengan `validateProjectImage`, validator yang SAMA yang
 *     dipakai server. Kanvas 256x256 dari foto penuh detail bisa melewati batas panjang data
 *     URI, dan mengetahuinya di sini jauh lebih baik daripada ditolak API setelah orang
 *     menandatangani sesuatu.
 */
export type UploadResult = { ok: true; value: string } | { ok: false; reason: string };

export async function readSquareLogoFile(file: File): Promise<UploadResult> {
  if (!ACCEPTED_MIME.includes(file.type as (typeof ACCEPTED_MIME)[number])) {
    return { ok: false, reason: `That file is ${file.type || "of an unknown type"}. Use PNG, JPEG or WebP.` };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      reason: `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB, over the ${MAX_UPLOAD_MB} MB limit.`,
    };
  }

  // `createObjectURL` dipakai alih-alih FileReader: ia tidak menyalin seluruh berkas ke
  // memori sebagai base64 hanya untuk diukur. Dibebaskan di `finally`.
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = objectUrl;
    });

    if (img.naturalWidth !== img.naturalHeight) {
      return {
        ok: false,
        reason:
          `That image is ${img.naturalWidth}×${img.naturalHeight}. It has to be square — ` +
          `crop it to equal width and height first.`,
      };
    }

    const canvas = document.createElement("canvas");
    canvas.width = LOGO_PX;
    canvas.height = LOGO_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return { ok: false, reason: "This browser would not give a 2D canvas, so the image could not be resized." };
    }
    ctx.drawImage(img, 0, 0, LOGO_PX, LOGO_PX);
    const dataUri = canvas.toDataURL("image/png");

    const check = validateProjectImage(dataUri);
    if (!check.ok) return { ok: false, reason: `${check.reason} Try a flatter image, or a simpler logo.` };
    return { ok: true, value: check.value };
  } catch {
    return { ok: false, reason: "That file could not be read as an image." };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
