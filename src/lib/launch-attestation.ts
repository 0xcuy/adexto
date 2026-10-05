import { TERMS_ACCEPTANCE_LINE } from "@/config/terms";

/**
 * Templat pesan attestation peluncuran, SATU untuk semua jalur: Studio (`signAttestation`), MCP
 * `prepare_launch`, A2A `launch_market` dan REST. `/api/deploy` (`verifyLaunchAttestation`) memeriksa
 * awalan, baris `Deployer:`, umur `Timestamp:` dan baris persetujuan Terms.
 *
 * Berkas kecil tanpa dependensi server, supaya Studio (klien) dan tes bisa mengimpornya.
 */
export function launchAttestationMessage(deployer: string, symbol: string, timestamp = Date.now()): string {
  return `ADEXTO launch attestation\nDeployer: ${deployer}\nTicker: ${symbol}\nTimestamp: ${timestamp}\n${TERMS_ACCEPTANCE_LINE}`;
}
