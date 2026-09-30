/**
 * Draf pengumuman sesudah peluncuran: teks siap tempel untuk X dan Farcaster.
 *
 * Token yang lahir tanpa diumumkan praktis tidak lahir, dan kebanyakan peluncur bukan penulis
 * pemasaran. Jadi layar sukses memberi satu draf yang sudah berisi fakta yang benar — ticker,
 * nama, chain, alamat token, tautan pasar — dan dua tombol yang membuka composer masing-masing
 * dengan draf itu. Tidak ada yang diposting otomatis dan tidak ada kunci API: yang memposting
 * adalah akun peluncur sendiri, dari peramban mereka.
 *
 * ISI DRAF HANYA FAKTA YANG BENAR SAAT PELUNCURAN
 *
 * Tidak ada janji harga, tidak ada "to the moon", dan tidak ada klaim performa. Yang ditulis:
 * seluruh suplai ada di kurva tanpa fungsi penarikan, dan peluncur tidak memegang satu token pun
 * — keduanya dijamin kontrak pada detik peluncuran. Teksnya berbahasa Inggris karena akan
 * beredar di permukaan publik.
 */

export interface AnnouncementInput {
  name: string;
  symbol: string;
  chainName: string;
  chainId: number;
  tokenAddress: string;
  /** Asal publik situs, mis. `https://adexto.xyz`. */
  origin: string;
}

export interface Announcement {
  /** Teks tanpa tautan; tautannya dikirim sebagai `url`/`embeds[]` supaya jadi pratinjau. */
  body: string;
  /** Teks lengkap untuk disalin, tautan di akhir. */
  full: string;
  marketUrl: string;
  xUrl: string;
  farcasterUrl: string;
}

const short = (address: string) => (/^0x[a-fA-F0-9]{40}$/.test(address) ? `${address.slice(0, 6)}…${address.slice(-4)}` : address);

export function marketUrlFor(origin: string, symbol: string, chainId: number): string {
  return `${origin.replace(/\/+$/, "")}/token/${encodeURIComponent(symbol.toLowerCase())}?chain=${chainId}`;
}

export function launchAnnouncement(input: AnnouncementInput): Announcement {
  const symbol = input.symbol.trim().toUpperCase();
  const name = input.name.trim();
  const marketUrl = marketUrlFor(input.origin, symbol, input.chainId);
  const body = [
    `I just launched $${symbol}${name && name.toUpperCase() !== symbol ? ` (${name})` : ""} on ${input.chainName}.`,
    "",
    "100% of the supply sits in a bonding curve with no withdrawal function, and I hold none of it.",
    "",
    `Token: ${short(input.tokenAddress)}`,
  ].join("\n");
  return { ...composeLinks(body, marketUrl), body, full: `${body}\n${marketUrl}`, marketUrl };
}

/** Tautan composer untuk teks yang sudah ada (mis. sesudah peluncur menyuntingnya). */
export function composeLinks(body: string, marketUrl: string): { xUrl: string; farcasterUrl: string } {
  const text = encodeURIComponent(body);
  const url = encodeURIComponent(marketUrl);
  return {
    // X menempelkan `url` di akhir postingan dan merendernya sebagai kartu.
    xUrl: `https://x.com/intent/post?text=${text}&url=${url}`,
    // Farcaster: tautan sebagai embed supaya klien merender pratinjaunya (maksimal dua embed).
    farcasterUrl: `https://farcaster.xyz/~/compose?text=${text}&embeds[]=${url}`,
  };
}
