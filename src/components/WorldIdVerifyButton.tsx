"use client";
/**
 * Tombol verifikasi World ID.
 *
 * Dipisah dari halaman studio dan dimuat dinamis karena `@worldcoin/idkit`
 * menarik Tailwind sebagai dependensi runtime. Menaruhnya langsung di studio
 * berarti setiap pemuatan halaman membawa berat itu, bahkan di deployment yang
 * tidak mengonfigurasi World ID sama sekali.
 *
 * Komponen ini TIDAK memutuskan sah atau tidak. Ia hanya mengambil proof dari
 * widget lalu menyerahkannya ke pemanggil, yang mengirimkannya ke server. Proof
 * yang divalidasi di browser tidak bernilai apa pun — `/api/deploy` bisa
 * dipanggil langsung tanpa membuka UI ini.
 */
import { IDKitWidget, VerificationLevel, type ISuccessResult } from "@worldcoin/idkit";
import { RefreshCw } from "lucide-react";

interface Props {
  appId: string;
  action: string;
  /** Alamat wallet: mengikat proof ke pemohon, sehingga tidak bisa dipakai ulang wallet lain. */
  signal: string;
  busy: boolean;
  disabled: boolean;
  onProof: (proof: ISuccessResult) => void | Promise<void>;
}

export default function WorldIdVerifyButton({ appId, action, signal, busy, disabled, onProof }: Props) {
  return (
    <IDKitWidget
      app_id={appId as `app_${string}`}
      action={action}
      signal={signal}
      verification_level={VerificationLevel.Orb}
      onSuccess={(proof) => {
        void onProof(proof);
      }}
    >
      {({ open }) => (
        <button
          type="button"
          onClick={open}
          disabled={busy || disabled}
          className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-mono text-[11px] font-bold border border-white/20 flex items-center gap-1 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? (
            <>
              <RefreshCw className="w-3 h-3 animate-spin text-cyan-300" /> Verifying…
            </>
          ) : (
            "Verify with World ID"
          )}
        </button>
      )}
    </IDKitWidget>
  );
}
