import { NextResponse } from "next/server";
import { listProjects } from "@/lib/registry";
import { LOGO_URL_PATTERN, logoContentHash } from "@/lib/logo-image";

/**
 * Sajikan logo pasar sebagai GAMBAR, bukan sebagai data URI di dalam badan JSON.
 *
 * KENAPA RUTE INI ADA
 *
 * Diukur di produksi: `POST /api/graphql` mengembalikan 217.801 byte dan 206.855 di antaranya
 * adalah field `image`. `/explorer` dan `SwapTerminal` sama-sama mengambil payload itu, jadi
 * dua halaman yang dilaporkan berat memang menarik 218 KB JSON sebelum menggambar apa pun.
 * Alasannya ada di `src/lib/logo-image.ts`; rute ini adalah sisi penyajiannya.
 *
 * KENAPA DIBACA DARI REGISTRY, BUKAN DARI DISK
 *
 * Logonya tidak pernah menjadi berkas. Ia disimpan sebagai data URI di field `image` pada
 * `projects.json` — keputusan lama yang tidak diubah di sini, sebab mengubahnya berarti
 * memigrasi registry produksi. Rute ini hanya men-decode-nya saat penyajian, jadi tidak ada
 * yang perlu dipindahkan dan tidak ada data yang bisa hilang.
 */

/** Nama berisi hash isi, jadi satu URL selalu memberi byte yang sama. */
const IMMUTABLE = "public, max-age=31536000, immutable";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const m = LOGO_URL_PATTERN.exec(name);
  if (!m) {
    return NextResponse.json({ error: "logo name must be <chainId>-<symbol>-<hash8>.<ext>" }, { status: 400 });
  }
  const [, chainIdRaw, symbol, hash, ext] = m;
  const chainId = Number(chainIdRaw);

  const project = listProjects().find(
    (p) => p.chainId === chainId && p.symbol.toLowerCase().replace(/[^a-z0-9]/g, "") === symbol
  );
  if (!project || typeof project.image !== "string" || !project.image.startsWith("data:")) {
    return NextResponse.json({ error: "no inline logo for that market" }, { status: 404 });
  }

  /**
   * Hash DICOCOKKAN, bukan diabaikan.
   *
   * Tanpa ini, nama apa pun dengan chain dan ticker yang benar akan mengembalikan logo apa
   * pun yang sedang tersimpan — dan karena jawabannya `immutable` setahun, satu permintaan
   * dengan hash usang akan membuat browser menyimpan gambar yang salah secara permanen.
   * Dicocokkan, URL lama menjadi 404 dan browser mengambil URL baru dari payload.
   */
  if (logoContentHash(project.image) !== hash) {
    return NextResponse.json({ error: "stale logo hash" }, { status: 404 });
  }

  const comma = project.image.indexOf(",");
  const bytes = Buffer.from(project.image.slice(comma + 1), "base64");

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Content-Length": String(bytes.length),
      "Cache-Control": IMMUTABLE,
    },
  });
}
