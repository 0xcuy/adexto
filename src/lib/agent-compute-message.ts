/**
 * Pesan yang ditandatangani untuk menerbitkan atau mencabut kunci pool Agent Compute.
 *
 * Dipakai BERSAMA oleh panel dan oleh rute API. Kalau kedua sisi membangun kalimatnya
 * masing-masing, satu perubahan kata di salah satu sisi akan membuat setiap tanda tangan gagal
 * diverifikasi, dan gejalanya "signature does not authorise this action" — galat yang menunjuk ke
 * arah yang salah. Satu berkas, satu kalimat.
 *
 * Ia tidak tinggal di `route.ts` karena route handler App Router hanya boleh mengekspor verb HTTP
 * dan beberapa nama konfigurasi; ekspor lain ditolak saat build.
 */
export const AGENT_KEY_ISSUE_ACTION = "Issue an agent compute API key";
export const AGENT_KEY_REVOKE_ACTION = "Revoke my agent compute API key";

/**
 * Satu kunci per TOKEN yang di-stake (owner 2026-10-01: beda chain, beda centang, beda kunci).
 * Karena itu pesannya menyebut stake yang dimaksud, dan tanda tangan untuk satu token tidak bisa
 * dipakai menerbitkan atau mencabut kunci token lain. Pesan tanpa baris `Stake:` berasal dari
 * sebelum ada kunci per token, dan hanya berlaku untuk $ADEXTO.
 */
function build(action: string, endpoint: string, address: string, timestamp: number, stake?: string): string {
  return [
    "ADEXTO Agent Compute",
    action,
    ...(stake ? [`Stake: ${stake}`] : []),
    `Endpoint: ${endpoint}`,
    `Address: ${address}`,
    `Timestamp: ${timestamp}`,
  ].join("\n");
}

export function issueKeyMessage(endpoint: string, address: string, timestamp = Date.now(), stake?: string): string {
  return build(AGENT_KEY_ISSUE_ACTION, endpoint, address, timestamp, stake);
}

export function revokeKeyMessage(endpoint: string, address: string, timestamp = Date.now(), stake?: string): string {
  return build(AGENT_KEY_REVOKE_ACTION, endpoint, address, timestamp, stake);
}

/** Id stake yang disebut sebuah pesan bertanda tangan, atau null kalau pesannya tidak menyebut. */
export function stakeInMessage(message: string): string | null {
  const m = message.match(/^Stake: ([a-z0-9-]+)$/m);
  return m ? m[1] : null;
}
