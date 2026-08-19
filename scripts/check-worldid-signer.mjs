/**
 * Apakah tanda tangan RP yang diterbitkan server benar-benar berasal dari kunci
 * yang terdaftar di Developer Portal?
 *
 * Ini pemeriksaan yang tidak bisa dilakukan stub verifier. Stub menerima apa pun
 * yang kita kirim, jadi kunci yang salah tetap "lulus" di harness — tapi World
 * akan menolak SETIAP permintaan proof nyata. Di sini tanda tangan dibongkar
 * kembali ke alamat penandatangannya lalu dicocokkan dengan signer address.
 *
 * Pakai: node scripts/check-worldid-signer.mjs
 *   env: BASE_URL (bawaan http://127.0.0.1:3100)
 *        WORLD_ID_SIGNER_FILE (berkas berisi signer address, di luar repo)
 *        WORLD_ID_ACTION (harus sama dengan yang dipakai server)
 */
import fs from "node:fs";
import { ethers } from "ethers";
import { computeRpSignatureMessage } from "@worldcoin/idkit-server";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const ACTION = process.env.WORLD_ID_ACTION || "launch-token";
const SIGNER_FILE = process.env.WORLD_ID_SIGNER_FILE || "/home/cucu/Coder/Work/worldcoin private key";

const res = await fetch(`${BASE}/api/worldid/signature`, { method: "POST" });
const body = await res.json();
if (!body?.rpContext) {
  console.log(`  GAGAL: server tidak menerbitkan tanda tangan (HTTP ${res.status}) ${body?.error ?? ""}`);
  process.exit(1);
}
const rp = body.rpContext;

// Pesan dibangun dengan helper RESMI, bukan rakitan sendiri: formatnya
// version(1) || nonce(32) || createdAt(8 BE) || expiresAt(8 BE) || action(32).
const msg = computeRpSignatureMessage(ethers.getBytes(rp.nonce), rp.created_at, rp.expires_at, ACTION);
const recovered = ethers.verifyMessage(msg, rp.signature);

console.log(`  rp_id            : ${rp.rp_id}`);
console.log(`  panjang pesan    : ${msg.length} byte (81 = proof dengan action, 49 = sesi)`);
console.log(`  pulih dari sig   : ${recovered}`);

let expected = null;
try {
  const raw = fs.readFileSync(SIGNER_FILE, "utf8");
  // Alamat 40-hex TERAKHIR di berkas adalah signer address; yang 64-hex adalah kuncinya.
  const addrs = raw.match(/0x[0-9a-fA-F]{40}\b/g) || [];
  expected = addrs.at(-1) ?? null;
} catch {
  console.log(`  (berkas signer tidak terbaca: ${SIGNER_FILE})`);
}

if (!expected) {
  console.log("  TIDAK BISA DICOCOKKAN: signer address tidak ditemukan");
  process.exit(1);
}
console.log(`  signer terdaftar : ${expected}`);
const match = recovered.toLowerCase() === expected.toLowerCase();
console.log(match ? "  COCOK — kunci sesuai signer address terdaftar" : "  TIDAK COCOK — World akan menolak setiap permintaan proof nyata");
process.exit(match ? 0 : 1);
