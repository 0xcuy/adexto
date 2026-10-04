import { handlePublicRpc } from "@/lib/public-rpc";

/**
 * RPC publik baca-saja untuk peramban: `POST /api/public-rpc/robinhood`.
 *
 * Publik tanpa autentikasi, dan itu disengaja: isinya data chain publik. Daftar izin metode,
 * batas ukuran, batas laju, dan cache ada di `src/lib/public-rpc.ts`, berikut alasannya.
 * Ini BUKAN relai berkunci `/api/rpc/[chain]` milik Worker x402; keduanya tidak berbagi kode.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ chain: string }> }) {
  const { chain } = await ctx.params;
  return handlePublicRpc(req, chain);
}
