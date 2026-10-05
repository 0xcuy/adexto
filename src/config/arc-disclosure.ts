/**
 * Pengungkapan khusus Arc, ditampilkan HANYA setelah Arc bisa meluncurkan.
 *
 * Kalimat "nobody, including us, can freeze …" di Terms, Disclaimer dan Security benar untuk kontrak
 * ADEXTO di setiap chain, termasuk Arc. Yang berbeda di Arc adalah ASET native-nya: USDC milik Circle,
 * dan chain itu menegakkan blocklist USDC di tingkat protokol. Transfer native ke atau dari alamat yang
 * diblokir revert, jadi kurva, creator atau trader yang diblokir tidak bisa menerima atau mengirim
 * cadangan kurva, walaupun kontrak kita sendiri tidak punya blacklist. Tanpa catatan ini, klaim "tidak
 * bisa dibekukan" akan menyesatkan tepat di chain yang asetnya bisa dibekukan.
 *
 * Sumber: docs.arc.io/arc/references/evm-differences.md ("Value transfer rules"), dibaca 2026-10-06.
 * Teks yang dirender WAJIB bahasa Inggris.
 */
import { CHAINS } from "@/lib/chains";

/** True sekali `NEXT_PUBLIC_CURVE_FACTORY_ARC` terisi. Sebelum itu tidak ada yang perlu diungkap. */
export const ARC_LIVE: boolean = CHAINS.Arc.dexLive;

export const ARC_USDC_NOTE =
  "On Arc the native asset is USDC, and Arc enforces Circle's USDC blocklist at the protocol level: any native " +
  "transfer to or from a blocklisted address reverts. A blocklisted wallet cannot pay into an Arc curve or be paid " +
  "by one. If a curve itself were blocklisted, nobody could trade on it, and if its creator or the protocol " +
  "treasury were, their fee claims would fail. The ADEXTO contracts have no blacklist of their own, and we can " +
  "neither add nor lift one: this rule belongs to Arc.";
