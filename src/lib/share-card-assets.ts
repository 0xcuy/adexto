import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Gambar robot untuk kartu bagikan, dibaca DARI DISK sebagai data URI.
 *
 * KENAPA BUKAN URL
 *
 * Versi pertama memberi satori `src={`${origin}/share/robot-celebrate.png`}` dengan hanya
 * `height`. Itu bekerja di lokal dan GAGAL di produksi dengan "Image size cannot be determined":
 * satori harus mengambil berkasnya sendiri untuk mengukur, dan permintaan itu berasal dari DALAM
 * kontainer menuju host publiknya sendiri — perjalanan yang melewati DNS, proxy, dan TLS yang
 * tidak ada alasan untuk diandalkan hanya demi membaca berkas yang sudah ikut di dalam image.
 * Kegagalannya pun muncul sebagai 502 tanpa menyebut gambar sebagai sebabnya.
 *
 * Berkasnya ada di `public/share/`, jadi ia ada di filesystem proses ini. Membacanya langsung
 * menghapus seluruh perjalanan itu, dan dimensinya diketahui di sini sehingga satori tidak perlu
 * mengukur apa pun.
 *
 * Di-cache per proses: kartu dirender sesering orang membagikannya, dan berkas ini tidak berubah
 * selama umur kontainer.
 */

/** Ukuran asli berkas, dari `scripts` yang menghasilkannya. */
const ROBOT_SOURCE = { file: "robot-celebrate.png", width: 371, height: 420 } as const;

let cached: string | null = null;

function robotDataUri(): string | null {
  if (cached !== null) return cached;
  try {
    // `process.cwd()` adalah akar aplikasi baik di `next dev` maupun di image standalone.
    const bytes = readFileSync(join(process.cwd(), "public", "share", ROBOT_SOURCE.file));
    cached = `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    // Berkasnya hilang dari image: kartu tetap dirender tanpa robot. Sebuah kartu tanpa hiasan
    // masih menyampaikan angkanya; kartu yang gagal total tidak menyampaikan apa pun.
    cached = null;
  }
  return cached;
}

/**
 * Sumber dan dimensi robot untuk tinggi yang diminta.
 *
 * Lebarnya dihitung dari rasio asli, bukan dibiarkan kosong: satori menuntut keduanya untuk
 * gambar yang tidak bisa ia ukur sendiri, dan menyerahkan itu pada pengukuran jarak jauh adalah
 * cacat yang baru saja diperbaiki.
 */
export function robotImage(height: number): { src: string; width: number; height: number } | null {
  const src = robotDataUri();
  if (!src) return null;
  return {
    src,
    height,
    width: Math.round((ROBOT_SOURCE.width / ROBOT_SOURCE.height) * height),
  };
}
