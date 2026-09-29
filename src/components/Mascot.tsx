/**
 * Maskot ADEXTO — robot putih-violet dengan tanda "A" di dada.
 *
 * Berkas di public/mascot/ dipotong dari lembar karakter `maskot adexto.png` oleh
 * scripts/crop-mascot.mjs (webp beralpha, tanpa pantulan lantai). Pose yang tersedia sengaja dibatasi pada yang ada di
 * lembar itu, supaya karakternya selalu konsisten dan tidak pernah "digambar ulang" oleh
 * model lain di satu halaman.
 *
 * Dekorasi murni: alt kosong + aria-hidden, karena tidak ada informasi yang dibawa gambar.
 */
export type MascotPose =
  | "front"
  | "threequarter"
  | "idle"
  | "wave"
  | "point"
  | "think"
  | "celebrate"
  | "run"
  | "jump"
  | "sit";

/** Ukuran asli berkas, supaya browser menyisihkan ruang yang benar (tanpa layout shift). */
// Dihasilkan ulang oleh scripts/crop-mascot.mjs, yang juga membuang pantulan lantai
// semi-transparan di bawah kaki (dulu tampil sebagai bercak putih di latar gelap).
const DIMENSIONS: Record<MascotPose, [number, number]> = {
  front: [315, 476],
  threequarter: [282, 477],
  idle: [145, 212],
  wave: [167, 212],
  point: [164, 210],
  think: [124, 212],
  celebrate: [189, 214],
  run: [169, 209],
  jump: [203, 203],
  sit: [160, 179],
};

export default function Mascot({
  pose,
  className = "",
  priority = false,
}: {
  pose: MascotPose;
  className?: string;
  priority?: boolean;
}) {
  const [w, h] = DIMENSIONS[pose];
  return (
    <img
      src={`/mascot/${pose}.webp`}
      width={w}
      height={h}
      alt=""
      aria-hidden="true"
      draggable={false}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      /* object-contain adalah pagar terakhir: walaupun pemanggil kelak memasang w+h
         sekaligus, pose tidak pernah dipipihkan atau diregangkan. */
      className={`select-none object-contain ${className}`}
    />
  );
}
