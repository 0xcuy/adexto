/**
 * Pesan galat yang boleh dikirim ke pemanggil anonim.
 *
 * KENAPA BUKAN `error.message` APA ADANYA
 *
 * Galat ethers v6 menaruh seluruh konteks permintaan di `message`: URL RPC yang dipakai, badan
 * permintaan, dan badan jawaban mentah penyedia. Diukur di rute ini sendiri: `POST /api/deploy`
 * dengan hash transaksi yang tidak ada menjawab `server response 403 Forbidden (request={ },
 * response={ }, error=null, info={ "requestUrl": "https://base-rpc.publicnode.com",
 * "responseBody": "{…}" …`. URL publik itu sendiri bukan rahasia, tetapi rute yang menggemakan
 * isi jawaban hulu ke siapa pun adalah tempat rahasia berikutnya akan bocor — misalnya begitu
 * sebuah RPC berkunci ditambahkan ke daftar.
 *
 * ethers menyediakan `shortMessage` untuk persis kebutuhan ini: kalimat ringkasnya tanpa dump
 * konteks. Galat lain dipotong pada baris pertama. Detail lengkap tetap tersedia di log server.
 */
export function publicErrorMessage(error: unknown, fallback = "Unexpected error"): string {
  const e = error as { shortMessage?: unknown; message?: unknown } | null | undefined;
  const raw =
    typeof e?.shortMessage === "string" && e.shortMessage
      ? e.shortMessage
      : typeof e?.message === "string"
        ? e.message
        : typeof error === "string"
          ? error
          : "";
  const firstLine = raw.split(/\r?\n/)[0] ?? "";
  // Dump konteks ethers lama selalu diawali " (request=" / " (info=" / " (code=".
  const trimmed = firstLine.replace(/\s\((?:request|response|info|code|error|transaction|action|data)=.*$/s, "");
  return (trimmed.trim() || fallback).slice(0, 200);
}
