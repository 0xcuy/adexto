/**
 * World ID (zero-knowledge proof) sebagai gerbang peluncuran.
 *
 * Sebelum ini, gerbang launch hanyalah tanda tangan wallet yang diverifikasi di
 * server. Itu membuktikan seseorang menguasai sebuah alamat — bukan bahwa dia
 * manusia yang berbeda. Siapa pun bisa membuat wallet baru tanpa batas, jadi
 * tidak ada hambatan Sybil sama sekali. Berkas ini menambahkan lapisan yang
 * hilang itu: proof World ID diverifikasi di server, lalu `nullifier_hash`-nya
 * dipakai untuk mengikat satu manusia ke satu wallet.
 *
 * Kenapa verifikasi harus di SERVER: proof yang divalidasi di browser tidak
 * bernilai apa-apa, karena penyerang tinggal memanggil `/api/deploy` langsung
 * tanpa membuka UI. Karena itu `/api/deploy` menuntut token yang HANYA bisa
 * diterbitkan oleh route verifikasi ini.
 *
 * Kenapa ada `WORLD_ID_VERIFY_URL`: verifikasi sesungguhnya memanggil layanan
 * Worldcoin, yang tidak bisa dihubungi dari pengujian otomatis tanpa proof orb
 * asli. Env itu memungkinkan harness mengarahkan verifier ke stub lokal,
 * sehingga logika gerbang — nullifier terpakai, proof ditolak, token kedaluwarsa
 * — benar-benar teruji tanpa kredensial produksi.
 */
import crypto from "node:crypto";
import { verifyCloudProof } from "@worldcoin/idkit-core/backend";
import { readJson, writeJson } from "@/lib/server-store";

const NULLIFIER_FILE = "worldid-nullifiers.json";
const DEFAULT_VERIFY_BASE = "https://developer.worldcoin.org";
/** Token sengaja berumur pendek: ia hanya perlu bertahan dari klik verifikasi ke klik launch. */
const TOKEN_TTL_SECONDS = 30 * 60;

export interface WorldIdProof {
  merkle_root: string;
  nullifier_hash: string;
  proof: string;
  verification_level: string;
}

export interface WorldIdConfig {
  /** Gerbang hanya menyala bila app id DAN action terisi. */
  enabled: boolean;
  appId: string;
  action: string;
  verifyBase: string;
  /** Bila true, satu manusia hanya boleh meluncurkan satu kali selamanya. */
  oneLaunchPerHuman: boolean;
}

export function worldIdConfig(): WorldIdConfig {
  const appId = (process.env.NEXT_PUBLIC_WORLD_ID_APP_ID || "").trim();
  const action = (process.env.NEXT_PUBLIC_WORLD_ID_ACTION || "").trim();
  return {
    enabled: Boolean(appId && action),
    appId,
    action,
    verifyBase: (process.env.WORLD_ID_VERIFY_URL || DEFAULT_VERIFY_BASE).replace(/\/+$/, ""),
    oneLaunchPerHuman: process.env.WORLD_ID_ONE_LAUNCH_PER_HUMAN === "true",
  };
}

/**
 * Rahasia penanda tangan token.
 *
 * Fail-closed: tanpa rahasia, tidak ada token yang bisa diterbitkan maupun
 * diterima. Kalau tidak, token bisa dipalsukan siapa saja dan seluruh gerbang
 * ini jadi hiasan.
 */
function tokenSecret(): string | null {
  const secret = process.env.WORLD_ID_TOKEN_SECRET || process.env.ADEXTO_TELEMETRY_SECRET || "";
  return secret.length >= 16 ? secret : null;
}

type NullifierEntry = { address: string; firstSeen: string; launches: number };
type NullifierStore = Record<string, NullifierEntry>;

const readStore = (): NullifierStore => readJson<NullifierStore>(NULLIFIER_FILE, {});

/** Hasil verifikasi proof, sebelum token diterbitkan. */
export type VerifyResult =
  | { ok: true; nullifierHash: string; verificationLevel: string }
  | { ok: false; status: number; error: string; code: string };

export async function verifyWorldIdProof(proof: WorldIdProof, address: string): Promise<VerifyResult> {
  const cfg = worldIdConfig();
  if (!cfg.enabled) {
    return {
      ok: false,
      status: 503,
      code: "WORLDID_NOT_CONFIGURED",
      error: "World ID is not configured on this deployment (NEXT_PUBLIC_WORLD_ID_APP_ID / NEXT_PUBLIC_WORLD_ID_ACTION).",
    };
  }
  if (!tokenSecret()) {
    return {
      ok: false,
      status: 503,
      code: "WORLDID_SECRET_MISSING",
      error: "World ID verification is disabled: WORLD_ID_TOKEN_SECRET is not set (minimum 16 characters).",
    };
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return { ok: false, status: 400, code: "BAD_ADDRESS", error: "A valid wallet address is required." };
  }
  for (const field of ["merkle_root", "nullifier_hash", "proof", "verification_level"] as const) {
    if (!proof?.[field] || typeof proof[field] !== "string") {
      return { ok: false, status: 400, code: "BAD_PROOF", error: `World ID proof is missing ${field}.` };
    }
  }

  // `signal` mengikat proof ke alamat wallet yang meminta. Tanpa ini, proof yang
  // sah untuk satu orang bisa dipotong dari lalu lintas dan dipakai ulang oleh
  // wallet lain.
  const signal = address.toLowerCase();

  // Dipakai helper resmi `verifyCloudProof`, bukan HTTP rakitan sendiri: helper
  // itu yang menghitung `signal_hash` dengan `hashToField` — cara hashing yang
  // sama seperti sisi klien. Merakit body sendiri berarti menebak detail itu,
  // dan salah hash membuat setiap proof yang sah ditolak.
  try {
    const result = await verifyCloudProof(
      proof as never,
      cfg.appId as `app_${string}`,
      cfg.action,
      signal,
      `${cfg.verifyBase}/api/v2/verify/${encodeURIComponent(cfg.appId)}`
    );
    if (!result.success) {
      return {
        ok: false,
        status: 401,
        code: "WORLDID_PROOF_REJECTED",
        error: String(result.detail || result.code || "World ID rejected this proof."),
      };
    }
  } catch (error) {
    return {
      ok: false,
      status: 502,
      code: "WORLDID_UNREACHABLE",
      error: `Could not reach the World ID verifier: ${(error as Error).message}`,
    };
  }

  // Nullifier stabil per manusia per action, jadi inilah tempat aturan Sybil
  // ditegakkan. Pengikatan ke satu wallet mencegah satu orang memanen wallet
  // baru tanpa batas — persis celah yang dibiarkan terbuka sebelumnya.
  const store = readStore();
  const existing = store[proof.nullifier_hash];
  if (existing && existing.address !== signal) {
    return {
      ok: false,
      status: 409,
      code: "WORLDID_BOUND_ELSEWHERE",
      error: "This World ID is already bound to a different wallet.",
    };
  }
  if (existing && cfg.oneLaunchPerHuman && existing.launches > 0) {
    return {
      ok: false,
      status: 409,
      code: "WORLDID_ALREADY_LAUNCHED",
      error: "This World ID has already been used for a launch.",
    };
  }

  store[proof.nullifier_hash] = {
    address: signal,
    firstSeen: existing?.firstSeen ?? new Date().toISOString(),
    launches: existing?.launches ?? 0,
  };
  writeJson(NULLIFIER_FILE, store);

  return { ok: true, nullifierHash: proof.nullifier_hash, verificationLevel: proof.verification_level };
}

/** Token pembawa bukti: `<exp>.<nullifier>.<hmac>`, terikat ke alamat. */
export function issueWorldIdToken(address: string, nullifierHash: string): string | null {
  const secret = tokenSecret();
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const body = `${address.toLowerCase()}|${nullifierHash}|${exp}`;
  const mac = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `${exp}.${nullifierHash}.${mac}`;
}

export type TokenCheck = { ok: true; nullifierHash: string } | { ok: false; error: string; code: string };

export function verifyWorldIdToken(token: string, address: string): TokenCheck {
  const secret = tokenSecret();
  if (!secret) return { ok: false, code: "WORLDID_SECRET_MISSING", error: "World ID gate is misconfigured on the server." };
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return { ok: false, code: "BAD_ADDRESS", error: "A valid wallet address is required." };

  const parts = String(token || "").split(".");
  if (parts.length !== 3) return { ok: false, code: "WORLDID_TOKEN_MALFORMED", error: "World ID verification is required before launching." };
  const [expRaw, nullifierHash, mac] = parts;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp)) return { ok: false, code: "WORLDID_TOKEN_MALFORMED", error: "World ID token is malformed." };
  if (exp * 1000 < Date.now()) return { ok: false, code: "WORLDID_TOKEN_EXPIRED", error: "World ID verification expired, please verify again." };

  const expected = crypto.createHmac("sha256", secret).update(`${address.toLowerCase()}|${nullifierHash}|${exp}`).digest("hex");
  // timingSafeEqual menuntut panjang sama, jadi panjangnya diperiksa lebih dulu.
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, code: "WORLDID_TOKEN_INVALID", error: "World ID token does not match this wallet." };
  }

  const entry = readStore()[nullifierHash];
  if (!entry) return { ok: false, code: "WORLDID_UNKNOWN_NULLIFIER", error: "This World ID verification is no longer on record." };
  if (entry.address !== address.toLowerCase()) {
    return { ok: false, code: "WORLDID_BOUND_ELSEWHERE", error: "This World ID is bound to a different wallet." };
  }
  const cfg = worldIdConfig();
  if (cfg.oneLaunchPerHuman && entry.launches > 0) {
    return { ok: false, code: "WORLDID_ALREADY_LAUNCHED", error: "This World ID has already been used for a launch." };
  }
  return { ok: true, nullifierHash };
}

/** Dicatat SETELAH launch berhasil, supaya percobaan yang gagal tidak menghanguskan kuota. */
export function recordLaunch(nullifierHash: string): void {
  const store = readStore();
  const entry = store[nullifierHash];
  if (!entry) return;
  entry.launches += 1;
  store[nullifierHash] = entry;
  writeJson(NULLIFIER_FILE, store);
}
