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

function build(action: string, endpoint: string, address: string, timestamp: number): string {
  return [
    "ADEXTO Agent Compute",
    action,
    `Endpoint: ${endpoint}`,
    `Address: ${address}`,
    `Timestamp: ${timestamp}`,
  ].join("\n");
}

export function issueKeyMessage(endpoint: string, address: string, timestamp = Date.now()): string {
  return build(AGENT_KEY_ISSUE_ACTION, endpoint, address, timestamp);
}

export function revokeKeyMessage(endpoint: string, address: string, timestamp = Date.now()): string {
  return build(AGENT_KEY_REVOKE_ACTION, endpoint, address, timestamp);
}
