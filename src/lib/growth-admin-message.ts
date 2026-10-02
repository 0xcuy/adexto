/**
 * Pesan EIP-191 untuk aksi admin program pertumbuhan, dibangun di satu tempat untuk klien
 * (`/admin`) dan server (yang memverifikasinya). Pola yang sama dengan `buildUpdateMessage` di
 * `src/lib/market-update.ts`: server membangun ulang pesannya dari field yang dikirim, jadi tanda
 * tangan hanya berlaku untuk aksi persis itu.
 */

/** Tanda tangan admin berlaku sepuluh menit sejak `issuedAt`. */
export const ADMIN_SIGNATURE_MAX_AGE_MS = 10 * 60 * 1000;

export type PromotedAction =
  | { action: "approve"; chainId: number; token: string; startsAt: number; hours: number; paymentRef: string }
  | { action: "remove"; id: string };

export function promotedMessage(a: PromotedAction, issuedAt: number): string {
  const lines = ["ADEXTO promoted slot", `action: ${a.action}`];
  if (a.action === "approve") {
    lines.push(`chain: ${a.chainId}`, `token: ${a.token.toLowerCase()}`, `startsAt: ${a.startsAt}`, `hours: ${a.hours}`, `payment: ${a.paymentRef}`);
  } else {
    lines.push(`id: ${a.id}`);
  }
  lines.push(`issuedAt: ${issuedAt}`);
  return lines.join("\n");
}

export function referralExportMessage(week: string, issuedAt: number): string {
  return ["ADEXTO referral export", `week: ${week}`, `issuedAt: ${issuedAt}`].join("\n");
}
