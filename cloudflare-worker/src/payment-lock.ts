/**
 * Satu otorisasi pembayaran, SATU pengiriman token.
 *
 * KENAPA INI ADA
 *
 * Gerbang membeli token mengantar dulu lalu menagih (lihat `index.ts`). Pemeriksaan "nonce sudah
 * terpakai" di `verifyPayment` membaca `authorizationState` di USDC — dan nonce itu baru tercatat
 * SESUDAH settle. Jadi otorisasi yang SAMA, dikirim N kali bersamaan, lolos verifikasi N kali,
 * diantar N kali dengan persediaan native kami, lalu hanya satu yang tertagih. Satu tanda tangan
 * 0,02 USDC menjadi N pengiriman; satu-satunya plafon adalah seberapa banyak permintaan muat di
 * jendela beberapa detik selama pengiriman berjalan, dan habisnya persediaan berarti gerbang
 * menjawab 503 untuk semua orang.
 *
 * Jalur compute (`compute.ts`) sudah menutup kelas ini per isolate, dan ia bisa melakukannya
 * dengan tenang karena hasilnya DITAHAN kalau settle gagal. Token yang sudah terkirim tidak bisa
 * ditahan, jadi jalur beli butuh kunci yang berlaku lintas isolate dan lintas lokasi.
 *
 * CARANYA
 *
 * Durable Object per payer (`idFromName(payer)`): satu instans di seluruh dunia untuk setiap
 * alamat, dan permintaan ke satu instans dieksekusi berurutan. `get` lalu `put` di storage-nya
 * tidak bisa disela permintaan lain (input gate), jadi klaim atas (payer, nonce) atomik. Klaim
 * disimpan sampai otorisasinya kedaluwarsa — sesudah `validBefore` USDC sendiri menolaknya.
 *
 * Klaim DILEPAS hanya kalau pengiriman gagal sebelum transaksi terkirim atau transaksinya revert:
 * pada dua keadaan itu tidak ada token yang berpindah, dan pesan galatnya memang menjanjikan
 * bahwa otorisasinya "unused and still spendable". Terkirim, tak terkonfirmasi, atau sukses =
 * klaim bertahan.
 *
 * TANPA BINDING
 *
 * Kalau `PAYMENT_LOCK` belum diikat (wrangler.toml lama), kunci jatuh ke Set per isolate — sama
 * dengan jalur compute: menutup pengulangan naif yang mendarat di isolate yang sama, tidak lebih.
 * Kalau binding ada tetapi tidak menjawab, permintaan DITOLAK (503, tanpa menagih apa pun):
 * untuk jalur yang memindahkan dana, gagal tertutup lebih murah daripada gagal terbuka.
 */

// Tipe minimal, supaya folder ini tidak bergantung pada @cloudflare/workers-types.
interface StorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T = unknown>(options?: { limit?: number }): Promise<Map<string, T>>;
}
interface StateLike {
  storage: StorageLike;
}
interface StubLike {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}
export interface PaymentLockNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): StubLike;
}
export interface PaymentLockEnv {
  PAYMENT_LOCK?: PaymentLockNamespace;
}

const NONCE_RE = /^0x[0-9a-f]{64}$/;
const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
/** Klaim disimpan sampai `validBefore` ditambah jeda ini. */
const KEEP_AFTER_EXPIRY_S = 3_600;
/** Plafon simpan untuk `validBefore` yang sengaja dibuat sangat jauh. */
const MAX_KEEP_S = 30 * 24 * 3_600;
/** Entri yang diperiksa untuk dibersihkan per klaim, supaya biaya satu klaim tetap kecil. */
const PRUNE_SCAN = 256;

export class PaymentNonceLock {
  private readonly storage: StorageLike;

  constructor(state: StateLike) {
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const nonce = (url.searchParams.get("nonce") ?? "").toLowerCase();
    if (!NONCE_RE.test(nonce)) return new Response("bad nonce", { status: 400 });
    const now = Math.floor(Date.now() / 1000);

    if (url.pathname === "/claim") {
      const until = await this.storage.get<number>(nonce);
      if (typeof until === "number" && until > now) return new Response("in_use", { status: 409 });
      const validBefore = Number(url.searchParams.get("validBefore") ?? "0");
      const base = Number.isFinite(validBefore) && validBefore > now ? Math.min(validBefore, now + MAX_KEEP_S) : now;
      await this.storage.put(nonce, base + KEEP_AFTER_EXPIRY_S);
      await this.prune(now);
      return new Response("claimed", { status: 200 });
    }
    if (url.pathname === "/release") {
      await this.storage.delete(nonce);
      return new Response("released", { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }

  private async prune(now: number): Promise<void> {
    const entries = await this.storage.list<number>({ limit: PRUNE_SCAN });
    for (const [key, until] of entries) {
      if (typeof until !== "number" || until <= now) await this.storage.delete(key);
    }
  }
}

/** Isolate-lokal: lapis pertama, dan satu-satunya kalau binding belum ada. */
const localClaims = new Set<string>();

export type PaymentClaim =
  | {
      ok: true;
      /**
       * Panggil tepat sekali. `keep: true` = pengiriman mungkin sudah terjadi; klaim bertahan.
       * `keep: false` = tidak ada token yang berpindah; otorisasinya boleh dipakai lagi.
       */
      finish(keep: boolean): Promise<void>;
    }
  | { ok: false; status: number; error: string; detail: string };

export async function claimPayment(
  env: PaymentLockEnv,
  payerRaw: string,
  nonceRaw: string,
  validBeforeRaw: string | number | bigint
): Promise<PaymentClaim> {
  const payer = String(payerRaw).toLowerCase();
  const nonce = String(nonceRaw).toLowerCase();
  if (!ADDRESS_RE.test(payer) || !NONCE_RE.test(nonce)) {
    return { ok: false, status: 400, error: "invalid_payload", detail: "payer or nonce has the wrong shape." };
  }
  const key = `${payer}:${nonce}`;
  if (localClaims.has(key)) {
    return inUse();
  }
  localClaims.add(key);

  const ns = env.PAYMENT_LOCK;
  if (!ns) {
    return { ok: true, finish: async () => void localClaims.delete(key) };
  }

  let stub: StubLike;
  try {
    stub = ns.get(ns.idFromName(payer));
    const res = await stub.fetch(
      `https://payment-lock/claim?nonce=${nonce}&validBefore=${encodeURIComponent(String(validBeforeRaw))}`,
      { method: "POST" }
    );
    if (res.status === 409) {
      localClaims.delete(key);
      return inUse();
    }
    if (!res.ok) throw new Error(`lock answered ${res.status}`);
  } catch (e) {
    localClaims.delete(key);
    return {
      ok: false,
      status: 503,
      error: "payment_lock_unavailable",
      detail: `The payment lock did not answer (${String((e as Error)?.message ?? e).slice(0, 80)}). No payment was taken; retry shortly.`,
    };
  }

  return {
    ok: true,
    finish: async (keep: boolean) => {
      localClaims.delete(key);
      if (keep) return;
      try {
        await stub.fetch(`https://payment-lock/release?nonce=${nonce}`, { method: "POST" });
      } catch {
        // Gagal melepas berarti otorisasi itu tertahan sampai kedaluwarsa: pembeli menandatangani
        // yang baru. Itu arah gagal yang aman.
      }
    },
  };
}

function inUse(): PaymentClaim {
  return {
    ok: false,
    status: 409,
    error: "payment_in_use",
    detail:
      "This authorization is already being used by another request, or it already paid for a delivery. " +
      "No payment was taken by this request. Sign a new authorization to buy again.",
  };
}

/** Untuk pengujian. */
export function resetPaymentLockState(): void {
  localClaims.clear();
}
