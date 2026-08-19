"use client";
/**
 * Tombol verifikasi World ID 4.0.
 *
 * Dipisah dari halaman studio dan dimuat dinamis karena idkit menarik dependensi
 * besar. Menaruhnya langsung di studio berarti setiap pemuatan halaman membawa
 * berat itu, bahkan di deployment yang tidak mengonfigurasi World ID.
 *
 * Komponen ini TIDAK memutuskan sah atau tidak. Ia mengambil tanda tangan RP dari
 * backend, menyerahkannya ke widget, lalu meneruskan hasilnya kembali ke backend
 * untuk diverifikasi. Proof yang divalidasi di browser tidak bernilai apa pun —
 * `/api/deploy` bisa dipanggil langsung tanpa membuka UI ini.
 *
 * Kunci penanda tangan tidak pernah menyentuh berkas ini.
 */
import { useState } from "react";
import { IDKitRequestWidget, proofOfHuman, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { RefreshCw } from "lucide-react";

interface Props {
  appId: string;
  action: string;
  /** Menerima proof v3 lama selain v4. Ditentukan server. */
  allowLegacyProofs?: boolean;
  busy: boolean;
  disabled: boolean
  ;
  onProof: (payload: IDKitResult) => void | Promise<void>;
}

export default function WorldIdVerifyButton({
  appId,
  action,
  allowLegacyProofs = false,
  busy,
  disabled,
  onProof,
}: Props) {
  const [open, setOpen] = useState(false);
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Tanda tangan diambil SAAT DIKLIK, bukan saat halaman dimuat.
   *
   * Umurnya hanya 5 menit. Mengambilnya lebih awal berarti tanda tangan sudah
   * kedaluwarsa untuk pengguna yang membaca halaman dulu sebelum menekan tombol.
   */
  const begin = async () => {
    setError(null);
    setFetching(true);
    try {
      const res = await fetch("/api/worldid/signature", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data?.rpContext) throw new Error(data?.error || `signature failed (${res.status})`);
      setRpContext(data.rpContext as RpContext);
      setOpen(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFetching(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={begin}
        disabled={busy || disabled || fetching}
        className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-mono text-[11px] font-bold border border-white/20 flex items-center gap-1 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy || fetching ? (
          <>
            <RefreshCw className="w-3 h-3 animate-spin text-cyan-300" /> {fetching ? "Preparing…" : "Verifying…"}
          </>
        ) : (
          "Verify with World ID"
        )}
      </button>

      {error && <span className="text-[10px] font-mono text-red-300">{error}</span>}

      {rpContext && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={appId as `app_${string}`}
          action={action}
          rp_context={rpContext}
          allow_legacy_proofs={allowLegacyProofs}
          preset={proofOfHuman()}
          onSuccess={(result) => {
            setOpen(false);
            void onProof(result);
          }}
        />
      )}
    </>
  );
}
