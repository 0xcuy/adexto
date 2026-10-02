/**
 * Verifikasi tanda tangan admin program pertumbuhan (server saja).
 *
 * Admin = `GROWTH_ADMIN_ADDRESSES` (dipisah koma) bila diset, kalau tidak deployer dan treasury
 * (`DEFAULT_GROWTH_ADMINS`). Tidak ada sesi dan tidak ada kunci di server: setiap aksi membawa
 * tanda tangan EIP-191 atas pesan aksi itu sendiri, berlaku sepuluh menit.
 */
import { ethers } from "ethers";
import { DEFAULT_GROWTH_ADMINS } from "@/config/growth-programs";
import { ADMIN_SIGNATURE_MAX_AGE_MS } from "@/lib/growth-admin-message";

export function growthAdmins(): string[] {
  const raw = (process.env.GROWTH_ADMIN_ADDRESSES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const list = raw.length > 0 ? raw : [...DEFAULT_GROWTH_ADMINS];
  return list.filter((a) => ethers.isAddress(a)).map((a) => a.toLowerCase());
}

export type AdminVerdict = { ok: true; admin: string } | { ok: false; status: number; code: string; error: string };

export function verifyAdmin(message: string, signature: unknown, issuedAt: unknown): AdminVerdict {
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    return { ok: false, status: 400, code: "BAD_SIGNATURE", error: "A 65-byte signature is required." };
  }
  const at = Number(issuedAt);
  if (!Number.isFinite(at) || Math.abs(Date.now() - at) > ADMIN_SIGNATURE_MAX_AGE_MS) {
    return { ok: false, status: 400, code: "STALE_SIGNATURE", error: "The signature is older than ten minutes; sign again." };
  }
  let signer: string;
  try {
    signer = ethers.verifyMessage(message, signature).toLowerCase();
  } catch {
    return { ok: false, status: 400, code: "BAD_SIGNATURE", error: "The signature does not verify." };
  }
  if (!growthAdmins().includes(signer)) {
    return { ok: false, status: 403, code: "NOT_ADMIN", error: "This address is not a growth admin." };
  }
  return { ok: true, admin: signer };
}
