/**
 * World ID 4.0 sebagai gerbang peluncuran.
 *
 * MENGAPA 4.0, BUKAN 3.0
 *
 * Percobaan pertama memakai `verifyCloudProof` dari idkit 2.x — jalur legacy 3.0
 * yang hanya butuh `app_id` + `action`. Itu berjalan, tapi membiarkan dua
 * kredensial yang dimiliki pemilik proyek menganggur: `rp_id` dan `signing_key`.
 * Keduanya milik World ID 4.0, tempat backend menandatangani SETIAP permintaan
 * proof. Tanda tangan itu bukan hiasan: ia membuktikan permintaan datang dari
 * aplikasi kita, sehingga orang lain tidak bisa memakai identitas app ini untuk
 * memanen verifikasi di situsnya sendiri. Karena itu jalurnya dipindah ke 4.0.
 *
 * KUNCI TANDA TANGAN TIDAK PERNAH KE KLIEN
 *
 * Klien hanya menerima hasil tanda tangan (`nonce`, `created_at`, `expires_at`,
 * `signature`) lewat `/api/worldid/signature`. Kunci privatnya tetap di server.
 *
 * NULLIFIER DISIMPAN SEBAGAI DESIMAL
 *
 * Dokumen World memperingatkan menyimpan nullifier sebagai string hex bisa
 * menimbulkan celah keamanan karena perbedaan kapitalisasi dan parsing. Versi
 * sebelumnya di berkas ini memakai hex mentah sebagai kunci penyimpanan, jadi
 * `0xAB…` dan `0xab…` akan dianggap dua orang berbeda — orang yang sama bisa
 * lolos dua kali. Sekarang semuanya dinormalkan lewat BigInt ke desimal.
 */
import crypto from "node:crypto";
import { signRequest } from "@worldcoin/idkit-server";
import { readJson, writeJson } from "@/lib/server-store";

const NULLIFIER_FILE = "worldid-nullifiers.json";
const DEFAULT_VERIFY_BASE = "https://developer.world.org";
/** Token sengaja berumur pendek: ia hanya perlu bertahan dari klik verifikasi ke klik launch. */
const TOKEN_TTL_SECONDS = 30 * 60;
/** Umur tanda tangan RP. 5 menit sesuai bawaan protokol. */
const RP_SIGNATURE_TTL_SECONDS = 300;

export interface WorldIdConfig {
  /** Gerbang menyala hanya bila keempat kredensial lengkap. */
  enabled: boolean;
  appId: string;
  rpId: string;
  action: string;
  verifyBase: string;
  /** Bila true, satu manusia hanya boleh meluncurkan satu kali selamanya. */
  oneLaunchPerHuman: boolean;
  /** Menerima proof v3 lama selain v4. Bawaan false: app ini app baru. */
  allowLegacyProofs: boolean;
}

function signingKey(): string {
  return (process.env.WORLD_ID_SIGNING_KEY || "").trim();
}

export function worldIdConfig(): WorldIdConfig {
  const appId = (process.env.NEXT_PUBLIC_WORLD_ID_APP_ID || "").trim();
  const rpId = (process.env.WORLD_ID_RP_ID || "").trim();
  const action = (process.env.NEXT_PUBLIC_WORLD_ID_ACTION || "").trim();
  return {
    // Tanpa rp_id atau signing_key, permintaan proof 4.0 tidak bisa ditandatangani,
    // jadi gerbangnya dianggap mati ketimbang setengah jalan.
    enabled: Boolean(appId && rpId && action && signingKey()),
    appId,
    rpId,
    action,
    verifyBase: (process.env.WORLD_ID_VERIFY_URL || DEFAULT_VERIFY_BASE).replace(/\/+$/, ""),
    oneLaunchPerHuman: process.env.WORLD_ID_ONE_LAUNCH_PER_HUMAN === "true",
    allowLegacyProofs: process.env.WORLD_ID_ALLOW_LEGACY_PROOFS === "true",
  };
}

/**
 * Rahasia penanda tangan token internal — BEDA dari signing key World ID.
 *
 * Fail-closed: tanpa rahasia, tidak ada token yang bisa diterbitkan maupun
 * diterima. Kalau tidak, token bisa dipalsukan siapa saja dan seluruh gerbang
 * ini jadi hiasan.
 */
function tokenSecret(): string | null {
  const secret = process.env.WORLD_ID_TOKEN_SECRET || process.env.ADEXTO_TELEMETRY_SECRET || "";
  return secret.length >= 16 ? secret : null;
}

/**
 * Nullifier dinormalkan ke desimal.
 *
 * Nullifier adalah bilangan 256-bit yang datang sebagai hex. Membandingkan
 * bentuk hex-nya secara mentah rapuh: kapitalisasi berbeda, ada-tidaknya awalan
 * 0x, dan nol di depan semuanya menghasilkan string berbeda untuk ANGKA YANG
 * SAMA — dan setiap perbedaan itu berarti satu orang bisa terhitung dua kali.
 */
export function normalizeNullifier(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!/^(0x)?[0-9a-fA-F]{1,64}$/.test(s)) return null;
  try {
    return BigInt(s.startsWith("0x") ? s : `0x${s}`).toString(10);
  } catch {
    return null;
  }
}

/**
 * Yang dicatat adalah TICKER yang sudah diluncurkan, bukan sekadar penghitung.
 *
 * Versi sebelumnya memakai `launches: number` yang dinaikkan setiap tahap confirm.
 * Karena launch multi-chain memanggil confirm sekali PER CHAIN, mode ketat
 * (`oneLaunchPerHuman`) akan menolak chain kedua dari peluncuran yang sama —
 * memblokir fitur utama produk ini alih-alih memblokir Sybil. Menyimpan himpunan
 * ticker membuat "satu orang satu peluncuran" berarti satu TOKEN di semua chain,
 * yang memang maksudnya.
 */
type NullifierEntry = { address: string; firstSeen: string; symbols: string[] };
type NullifierStore = Record<string, NullifierEntry>;

/** Entri lama memakai `launches`; dibaca ulang tanpa merusak apa pun. */
function readStore(): NullifierStore {
  const raw = readJson<Record<string, any>>(NULLIFIER_FILE, {});
  const out: NullifierStore = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = {
      address: String(v?.address ?? ""),
      firstSeen: String(v?.firstSeen ?? new Date().toISOString()),
      symbols: Array.isArray(v?.symbols) ? v.symbols.map((s: unknown) => String(s).toUpperCase()) : [],
    };
  }
  return out;
}

/** Konteks RP yang dibutuhkan widget. Kunci privatnya tidak termasuk. */
export type RpContextResult =
  | { ok: true; rpContext: { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string } }
  | { ok: false; status: number; code: string; error: string };

export function issueRpContext(): RpContextResult {
  const cfg = worldIdConfig();
  if (!cfg.enabled) {
    return {
      ok: false,
      status: 503,
      code: "WORLDID_NOT_CONFIGURED",
      error: "World ID is not configured on this deployment.",
    };
  }
  try {
    const signed = signRequest({
      signingKeyHex: signingKey(),
      action: cfg.action,
      ttl: RP_SIGNATURE_TTL_SECONDS,
    });
    return {
      ok: true,
      rpContext: {
        rp_id: cfg.rpId,
        nonce: signed.nonce,
        created_at: signed.createdAt,
        expires_at: signed.expiresAt,
        signature: signed.sig,
      },
    };
  } catch (error) {
    // Kunci yang salah bentuk terdeteksi di sini, bukan di tengah alur pengguna.
    return {
      ok: false,
      status: 500,
      code: "WORLDID_SIGNING_FAILED",
      error: `Could not sign the World ID request: ${(error as Error).message}`,
    };
  }
}

export type VerifyResult =
  | { ok: true; nullifier: string; protocolVersion: string }
  | { ok: false; status: number; error: string; code: string };

/**
 * Verifikasi payload IDKit lewat endpoint v4, lalu tegakkan aturan Sybil.
 *
 * Payload diteruskan APA ADANYA sesuai dokumen; bentuknya berbeda antara proof
 * v3 dan v4, dan merakitnya ulang di sini hanya menambah tempat untuk salah.
 */
export async function verifyWorldIdProof(payload: any, address: string): Promise<VerifyResult> {
  const cfg = worldIdConfig();
  if (!cfg.enabled) {
    return { ok: false, status: 503, code: "WORLDID_NOT_CONFIGURED", error: "World ID is not configured on this deployment." };
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

  const responses = Array.isArray(payload?.responses) ? payload.responses : [];
  if (responses.length === 0) {
    return { ok: false, status: 400, code: "BAD_PROOF", error: "The World ID payload carries no proof responses." };
  }
  let nullifier = normalizeNullifier(responses[0]?.nullifier);
  if (!nullifier) {
    return { ok: false, status: 400, code: "BAD_PROOF", error: "The World ID payload has no usable nullifier." };
  }
  if (!cfg.allowLegacyProofs && payload?.protocol_version !== "4.0") {
    return {
      ok: false,
      status: 400,
      code: "WORLDID_LEGACY_PROOF",
      error: `Only World ID 4.0 proofs are accepted here (received ${payload?.protocol_version ?? "unknown"}).`,
    };
  }

  try {
    const res = await fetch(`${cfg.verifyBase}/api/v4/verify/${encodeURIComponent(cfg.rpId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json().catch(() => ({}) as any);
    if (!res.ok || body?.success === false) {
      const code = String(body?.code || "");
      return {
        ok: false,
        status: 401,
        // World menolak verifikasi KEDUA dari orang yang sama bila action-nya
        // ber-`max_verifications: 1`. Pesan mentahnya tidak menjelaskan apa pun ke
        // creator, jadi diterjemahkan di sini.
        code: code === "max_verifications_reached" ? "WORLDID_ALREADY_LAUNCHED" : "WORLDID_PROOF_REJECTED",
        error:
          code === "max_verifications_reached"
            ? "This World ID has already been used to launch here. Each person gets one launch."
            : String(body?.detail || code || body?.error || `World ID rejected this proof (${res.status}).`),
      };
    }
    // Nullifier diambil dari JAWABAN VERIFIER bila tersedia, bukan dari payload
    // kiriman klien. Keduanya seharusnya sama — World tidak akan membalas sukses
    // untuk proof yang nullifier-nya tidak cocok — tapi memakai nilai yang
    // benar-benar divalidasi menghapus asumsi bahwa `responses[0]` yang saya baca
    // adalah entri yang sama dengan yang diverifikasi. Untuk permintaan dengan
    // beberapa kredensial, urutannya belum tentu sejajar.
    const attested = normalizeNullifier(body?.results?.[0]?.nullifier);
    if (attested) nullifier = attested;
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
  // baru tanpa batas — celah yang dibiarkan terbuka oleh gerbang tanda tangan
  // wallet saja.
  const signal = address.toLowerCase();
  const store = readStore();
  const existing = store[nullifier];
  if (existing && existing.address !== signal) {
    return {
      ok: false,
      status: 409,
      code: "WORLDID_BOUND_ELSEWHERE",
      error: "This World ID is already bound to a different wallet.",
    };
  }
  if (existing && cfg.oneLaunchPerHuman && existing.symbols.length > 0) {
    return {
      ok: false,
      status: 409,
      code: "WORLDID_ALREADY_LAUNCHED",
      error: `This World ID has already launched ${existing.symbols.join(", ")}. Each person gets one launch.`,
    };
  }

  store[nullifier] = {
    address: signal,
    firstSeen: existing?.firstSeen ?? new Date().toISOString(),
    symbols: existing?.symbols ?? [],
  };
  writeJson(NULLIFIER_FILE, store);

  return { ok: true, nullifier, protocolVersion: String(payload?.protocol_version ?? "unknown") };
}

/** Token pembawa bukti: `<exp>.<nullifier>.<hmac>`, terikat ke alamat. */
export function issueWorldIdToken(address: string, nullifier: string): string | null {
  const secret = tokenSecret();
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const body = `${address.toLowerCase()}|${nullifier}|${exp}`;
  const mac = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `${exp}.${nullifier}.${mac}`;
}

export type TokenCheck = { ok: true; nullifier: string } | { ok: false; error: string; code: string };

/**
 * @param symbol Ticker yang sedang diluncurkan. WAJIB diberikan pada tahap
 * confirm: mode ketat harus mengizinkan confirm berikutnya untuk ticker yang
 * SAMA (chain ke-2 sampai ke-4 dari satu peluncuran) sambil menolak ticker baru.
 */
export function verifyWorldIdToken(token: string, address: string, symbol?: string): TokenCheck {
  const secret = tokenSecret();
  if (!secret) return { ok: false, code: "WORLDID_SECRET_MISSING", error: "World ID gate is misconfigured on the server." };
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return { ok: false, code: "BAD_ADDRESS", error: "A valid wallet address is required." };

  const parts = String(token || "").split(".");
  if (parts.length !== 3) return { ok: false, code: "WORLDID_TOKEN_MALFORMED", error: "World ID verification is required before launching." };
  const [expRaw, nullifier, mac] = parts;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp)) return { ok: false, code: "WORLDID_TOKEN_MALFORMED", error: "World ID token is malformed." };
  if (exp * 1000 < Date.now()) return { ok: false, code: "WORLDID_TOKEN_EXPIRED", error: "World ID verification expired, please verify again." };

  const expected = crypto.createHmac("sha256", secret).update(`${address.toLowerCase()}|${nullifier}|${exp}`).digest("hex");
  // timingSafeEqual menuntut panjang sama, jadi panjangnya diperiksa lebih dulu.
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, code: "WORLDID_TOKEN_INVALID", error: "World ID token does not match this wallet." };
  }

  const entry = readStore()[nullifier];
  if (!entry) return { ok: false, code: "WORLDID_UNKNOWN_NULLIFIER", error: "This World ID verification is no longer on record." };
  if (entry.address !== address.toLowerCase()) {
    return { ok: false, code: "WORLDID_BOUND_ELSEWHERE", error: "This World ID is bound to a different wallet." };
  }
  const cfg = worldIdConfig();
  const wanted = (symbol ?? "").toUpperCase();
  // Ticker yang sama boleh lanjut: itu chain berikutnya dari peluncuran yang sama.
  if (cfg.oneLaunchPerHuman && entry.symbols.length > 0 && (!wanted || !entry.symbols.includes(wanted))) {
    return {
      ok: false,
      code: "WORLDID_ALREADY_LAUNCHED",
      error: `This World ID has already launched ${entry.symbols.join(", ")}. Each person gets one launch.`,
    };
  }
  return { ok: true, nullifier };
}

/**
 * Dicatat SETELAH launch berhasil, supaya percobaan yang gagal — tx revert, RPC
 * putus — tidak menghanguskan hak launch seseorang tanpa dia mendapat apa pun.
 *
 * Ticker disimpan sebagai himpunan, jadi empat chain dari satu peluncuran tetap
 * terhitung SATU peluncuran.
 */
export function recordLaunch(nullifier: string, symbol?: string): void {
  const store = readStore();
  const entry = store[nullifier];
  if (!entry) return;
  const s = (symbol ?? "").toUpperCase();
  if (s && !entry.symbols.includes(s)) entry.symbols.push(s);
  store[nullifier] = entry;
  writeJson(NULLIFIER_FILE, store);
}
