/**
 * Peluncuran lewat alat agen yang terjadi SEBELUM `ProjectRecord.launchedVia` ada (5 Okt 2026).
 *
 * Dicatat per tx peluncuran, bukan per ticker, dan setiap baris bisa diperiksa di chain: kedua $LOOP
 * diluncurkan dengan `prepare_launch` → tanda tangan dompet creator → kirim → `register_launch`
 * (lihat `why` di `src/config/onchain-launches.json`). Data produksi tidak ditulis langsung; daftar
 * ini yang mengisi kekosongan untuk baris lama. Peluncuran baru ditandai otomatis oleh `registerLaunch`.
 */
import type { ProjectRecord } from "@/lib/registry";

export const KNOWN_AGENT_LAUNCHES: ReadonlyArray<{ chainId: number; txHash: string; via: "mcp" | "api" }> = [
  { chainId: 143, txHash: "0x086de87c2d3b1e04afd7a10d4f21b111af4fe9a71e3b80440686ddd92fd7a9c4", via: "mcp" },
  { chainId: 42161, txHash: "0x0f8e469ca46906b9202714da2a614ed61f2f7af332751f3ee03eaf29e2e1030e", via: "mcp" },
];

/** Jalur agen yang mendaftarkan pasar ini, atau null bila bukan lewat alat agen. */
export function agentLaunchVia(p: Pick<ProjectRecord, "chainId" | "txHash" | "launchedVia">): "mcp" | "api" | null {
  if (p.launchedVia) return p.launchedVia;
  const tx = (p.txHash ?? "").toLowerCase();
  return KNOWN_AGENT_LAUNCHES.find((k) => k.chainId === p.chainId && k.txHash === tx)?.via ?? null;
}
