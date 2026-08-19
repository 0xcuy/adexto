/**
 * POST /api/worldid/verify — verifikasi proof World ID, lalu terbitkan token.
 *
 * Gerbang peluncuran dulu hanya tanda tangan wallet: membuktikan kendali atas
 * sebuah alamat, bukan bahwa pemohonnya manusia yang berbeda. Route ini menutup
 * celah itu. Proof diverifikasi di SERVER — memvalidasinya di browser tidak
 * berguna karena `/api/deploy` bisa dipanggil langsung tanpa membuka UI.
 *
 * Yang dikembalikan adalah token ber-HMAC yang terikat ke alamat wallet, dan
 * `/api/deploy` menolak launch tanpa token itu selama World ID dikonfigurasi.
 *
 * GET dipakai UI untuk mengetahui apakah gerbangnya menyala di deployment ini,
 * supaya studio tidak menampilkan tombol verifikasi yang mustahil dipakai.
 */
import { NextRequest, NextResponse } from "next/server";
import { issueWorldIdToken, verifyWorldIdProof, worldIdConfig } from "@/lib/worldid";

export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = worldIdConfig();
  return NextResponse.json({
    enabled: cfg.enabled,
    appId: cfg.enabled ? cfg.appId : null,
    action: cfg.enabled ? cfg.action : null,
    oneLaunchPerHuman: cfg.oneLaunchPerHuman,
    // Dinyatakan terang-terangan supaya UI tidak pernah mengklaim proteksi yang
    // sebenarnya tidak menyala.
    gate: cfg.enabled ? "world-id-zkp" : "wallet-signature-only",
  });
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON.", code: "BAD_JSON" }, { status: 400 });
  }

  const address = String(body?.address || "");
  const proof = body?.proof;

  const result = await verifyWorldIdProof(proof, address);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }

  const token = issueWorldIdToken(address, result.nullifierHash);
  if (!token) {
    return NextResponse.json(
      { error: "World ID gate is misconfigured on the server.", code: "WORLDID_SECRET_MISSING" },
      { status: 503 }
    );
  }

  return NextResponse.json({
    ok: true,
    token,
    verificationLevel: result.verificationLevel,
    // Nullifier TIDAK dikembalikan utuh: itu pengenal stabil per manusia, dan
    // menyiarkannya ke klien mempermudah korelasi antar layanan.
    nullifierPrefix: `${result.nullifierHash.slice(0, 10)}…`,
  });
}
