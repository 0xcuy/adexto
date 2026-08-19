/**
 * POST /api/worldid/verify — verifikasi payload World ID, lalu terbitkan token.
 *
 * Gerbang peluncuran dulu hanya tanda tangan wallet: membuktikan kendali atas
 * sebuah alamat, bukan bahwa pemohonnya manusia yang berbeda. Route ini menutup
 * celah itu. Payload diverifikasi di SERVER lewat endpoint v4 — memvalidasinya
 * di browser tidak berguna karena `/api/deploy` bisa dipanggil langsung tanpa
 * membuka UI.
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
    // app_id memang publik (widget membutuhkannya). rp_id TIDAK disiarkan:
    // ia hanya dipakai server, dan sampai ke klien lewat tanda tangan RP.
    appId: cfg.enabled ? cfg.appId : null,
    action: cfg.enabled ? cfg.action : null,
    protocol: "4.0",
    allowLegacyProofs: cfg.allowLegacyProofs,
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
  // Payload IDKit diteruskan apa adanya; bentuknya berbeda antara proof v3 dan
  // v4, dan merakitnya ulang di sini hanya menambah tempat untuk salah.
  const payload = body?.payload ?? body?.proof;

  const result = await verifyWorldIdProof(payload, address);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }

  const token = issueWorldIdToken(address, result.nullifier);
  if (!token) {
    return NextResponse.json(
      { error: "World ID gate is misconfigured on the server.", code: "WORLDID_SECRET_MISSING" },
      { status: 503 }
    );
  }

  return NextResponse.json({
    ok: true,
    token,
    protocolVersion: result.protocolVersion,
    // Nullifier TIDAK dikembalikan utuh: itu pengenal stabil per manusia, dan
    // menyiarkannya ke klien mempermudah korelasi antar layanan.
    nullifierPrefix: `${result.nullifier.slice(0, 8)}…`,
  });
}
