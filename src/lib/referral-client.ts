/**
 * Referral di klien: mengubah kode tersimpan menjadi alamat untuk ekor calldata, dan melaporkan
 * trade yang sudah terkonfirmasi ke `POST /api/referral/record`. Tidak pernah menghalangi trade:
 * setiap kegagalan di sini berarti trade berjalan tanpa atribusi, bukan trade yang gagal.
 */
import { readStoredRef } from "@/lib/referral-tag";

let cache: { code: string; address: string | null; at: number } | null = null;

/** Alamat perujuk untuk trade oleh `wallet`, atau null (tidak ada kode, kode tidak dikenal, atau diri sendiri). */
export async function referrerFor(wallet: string | null | undefined): Promise<{ code: string; address: string } | null> {
  const code = readStoredRef();
  if (!code) return null;
  try {
    if (!cache || cache.code !== code || Date.now() - cache.at > 5 * 60_000) {
      const res = await fetch(`/api/referral/resolve?ref=${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(3_000) });
      const body = res.ok ? await res.json() : null;
      cache = { code, address: typeof body?.address === "string" ? body.address : null, at: Date.now() };
    }
  } catch {
    return null;
  }
  if (!cache.address) return null;
  if (wallet && cache.address.toLowerCase() === wallet.toLowerCase()) return null;
  return { code, address: cache.address };
}

/** Laporkan trade bertag. Dicoba ulang beberapa kali karena RPC baca bisa tertinggal dari receipt dompet. */
export function reportReferredTrade(p: { txHash: string; chainId: number; code: string }): void {
  const body = JSON.stringify({ txHash: p.txHash, chainId: p.chainId, ref: p.code, source: "ui" });
  const attempt = async (n: number) => {
    try {
      const res = await fetch("/api/referral/record", { method: "POST", headers: { "content-type": "application/json" }, body });
      if (res.status === 404 && n < 4) setTimeout(() => attempt(n + 1), 3_000 * (n + 1));
    } catch {
      if (n < 4) setTimeout(() => attempt(n + 1), 3_000 * (n + 1));
    }
  };
  void attempt(0);
}
