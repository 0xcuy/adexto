import { readFileSync } from "node:fs";
import { join, normalize, sep } from "node:path";

/**
 * Aset dan alamat untuk kartu bagikan (`/api/share-card/...`). Hanya untuk route server:
 * modul ini membaca disk, jadi komponen klien tidak boleh mengimpornya.
 *
 * ATURAN YANG BERLAKU UNTUK SEMUANYA: KARTU TIDAK MEMBACA DIRINYA SENDIRI LEWAT JARINGAN
 *
 * Di dalam kontainer produksi, `req.url` BUKAN alamat publik. Next menyusunnya dari `HOSTNAME`
 * dan `PORT` proses (0.0.0.0:3000) ditambah protokol dari `x-forwarded-proto` proxy, jadi
 * hasilnya `https://0.0.0.0:3000/...`. Terukur dari dalam kontainer pada 2026-09-29:
 *
 *   - kartu mencetak `0.0.0.0:3000/token/bloop?chain=8453` sebagai tautannya, dan QR-nya
 *     mengarah ke alamat yang sama, jadi siapa pun yang memindainya tidak sampai ke mana pun;
 *   - `fetch(`${url.origin}/api/prices`)` berbicara TLS ke port HTTP polos, gagal, dan kartu
 *     jatuh ke "not priced yet". Permintaan yang sama TANPA `x-forwarded-proto` mencetak
 *     $4.48K — bukti bahwa sebabnya alamat itu, bukan feed harganya.
 *
 * Di lokal keduanya lolos karena tidak ada proxy, dan itulah sebabnya cacat ini sampai ke
 * produksi. Jadi: alamat publik dari konfigurasi, harga dari pustaka, gambar dari disk.
 */

const FALLBACK_ORIGIN = "https://adexto.xyz";

/**
 * Alamat publik situs, untuk tautan dan QR di kartu.
 *
 * Dari `NEXT_PUBLIC_APP_URL` — variabel yang sama yang dipakai `metadataBase` di
 * `src/app/layout.tsx` — dan SENGAJA bukan dari header `Host`. Kartu adalah gambar bermerek
 * ADEXTO yang beredar ke luar; kalau alamatnya diambil dari header permintaan, siapa pun bisa
 * meminta kartu dengan `Host` palsu dan mendapat gambar resmi yang QR-nya mengarah ke domain
 * miliknya.
 */
export function publicOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL || FALLBACK_ORIGIN;
  try {
    const u = new URL(raw);
    if (u.protocol === "https:" || u.protocol === "http:") return u.origin;
  } catch {
    // nilai konfigurasi rusak: jatuh ke domain produksi
  }
  return FALLBACK_ORIGIN;
}

const PUBLIC_DIR = join(process.cwd(), "public");

/** Gambar di atas ini tidak di-inline; kartunya jatuh ke monogram. */
const MAX_INLINE_BYTES = 2_000_000;

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/**
 * Di-cache per proses: kartu dirender sesering orang membagikannya, dan isi `public/` tidak
 * berubah selama umur kontainer.
 */
const fileCache = new Map<string, string | null>();

/** Berkas di `public/` sebagai data URI, atau null bila tidak ada atau di luar `public/`. */
function publicFileDataUri(relative: string): string | null {
  const cached = fileCache.get(relative);
  if (cached !== undefined) return cached;
  let value: string | null = null;
  const ext = relative.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME[ext];
  try {
    const full = normalize(join(PUBLIC_DIR, relative));
    // `../` di jalurnya tidak boleh keluar dari `public/`.
    if (mime && full.startsWith(PUBLIC_DIR + sep)) {
      const bytes = readFileSync(full);
      if (bytes.length <= MAX_INLINE_BYTES) value = `data:${mime};base64,${bytes.toString("base64")}`;
    }
  } catch {
    // berkasnya tidak ada: pemanggil memakai monogram
    value = null;
  }
  fileCache.set(relative, value);
  return value;
}

/**
 * Mark ADEXTO bertinta krem, 256x256, dari `scripts/render-share-mark.mjs`.
 *
 * Kartu dulu menggambar kotak violet berhuruf "A" sebagai pengganti logo, karena satori tidak
 * menggambar `logo.svg`. Berkas PNG ini adalah logo yang sama, dirasterkan.
 */
export function brandMark(size: number): { src: string; width: number; height: number } | null {
  const src = publicFileDataUri("share/adexto-mark.png");
  return src ? { src, width: size, height: size } : null;
}

/**
 * Sumber gambar token untuk kartu, atau null bila harus memakai monogram ticker.
 *
 * Registry hanya menyimpan dua bentuk (`validateProjectImage` di `src/lib/logo-image.ts`):
 * data URI raster, atau jalur relatif di situs ini. Keduanya diselesaikan TANPA jaringan.
 * `/logo.svg` adalah bawaan untuk pasar tanpa gambar dan tampil sebagai logo ADEXTO di
 * halamannya, jadi di kartu ia juga tampil sebagai logo ADEXTO — bukan sebagai kotak kosong.
 */
export function tokenLogoSrc(image: string | null | undefined): string | null {
  if (!image) return null;
  if (/^data:image\/(?:png|jpeg|webp);base64,/.test(image)) return image;
  if (image === "/logo.svg") return brandMark(256)?.src ?? null;
  if (/^\/[^/?#][^?#]*\.(?:png|jpe?g|webp)$/i.test(image)) return publicFileDataUri(image.slice(1));
  return null;
}

/**
 * Gambar robot untuk kartu bagikan, dibaca DARI DISK sebagai data URI.
 *
 * Versi pertama memberi satori `src={`${origin}/share/robot-celebrate.png`}` dengan hanya
 * `height`. Itu bekerja di lokal dan GAGAL di produksi dengan "Image size cannot be determined",
 * karena alasan yang sama dengan catatan di atas: permintaan dari dalam kontainer ke alamat
 * yang bukan alamat publiknya. Dimensinya diketahui di sini sehingga satori tidak perlu
 * mengukur apa pun.
 */

/** Ukuran asli berkas `public/share/robot-celebrate.png`. */
const ROBOT_SOURCE = { file: "share/robot-celebrate.png", width: 371, height: 420 } as const;

/**
 * Sumber dan dimensi robot untuk tinggi yang diminta.
 *
 * Lebarnya dihitung dari rasio asli, bukan dibiarkan kosong: satori menuntut keduanya untuk
 * gambar yang tidak bisa ia ukur sendiri.
 */
export function robotImage(height: number): { src: string; width: number; height: number } | null {
  const src = publicFileDataUri(ROBOT_SOURCE.file);
  if (!src) return null;
  return {
    src,
    height,
    width: Math.round((ROBOT_SOURCE.width / ROBOT_SOURCE.height) * height),
  };
}
