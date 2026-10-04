import type { NextConfig } from "next";

/**
 * Header keamanan untuk SETIAP respons — halaman, rute API, dan berkas di `public/`.
 *
 * KENAPA DI SINI, BUKAN DI CADDY ATAU CLOUDFLARE
 *
 * Diukur 4 Oktober 2026 di `https://adexto.xyz/`: respons tidak membawa satu pun dari header
 * ini, dan malah membawa `x-powered-by: Next.js`. Caddyfile tidak menambahkannya, dan zone
 * Cloudflare juga tidak. Ditaruh di aplikasi, header-nya ikut ke mana pun aplikasi ini
 * dijalankan — termasuk kalau suatu saat ia disajikan tanpa salah satu lapisan di depannya.
 *
 * YANG SENGAJA TIDAK DIPASANG
 *
 *   - CSP penuh (`script-src` dan seterusnya). Konektor dompet, WalletConnect/Reown dan skrip
 *     inline Next memuat dari banyak asal; CSP yang salah menebak satu asal mematikan tombol
 *     "Connect" tanpa galat yang terlihat pengguna. Yang dipasang hanya direktif yang tidak
 *     menyentuh skrip: `frame-ancestors`, `base-uri`, `object-src`.
 *   - `Cross-Origin-Opener-Policy`. Coinbase/Base Account dan sebagian dompet membuka popup lalu
 *     berbicara lewat `window.opener`; COOP `same-origin` memutus jalur itu.
 *   - `Cross-Origin-Resource-Policy`. Kartu bagi (`/api/share-card/*`) dimuat klien X, Telegram
 *     dan Farcaster dari asal mereka sendiri.
 *   - `preload` pada HSTS. Itu komitmen ke daftar browser yang sulit ditarik kembali, jadi ia
 *     keputusan pemilik domain, bukan efek samping sebuah commit.
 */
const SECURITY_HEADERS = [
  // Setahun, semua subdomain. Seluruh `*.adexto.xyz` sudah HTTPS (wildcard di Caddy dan proxy
  // Cloudflare), jadi tidak ada host yang terkunci keluar oleh ini.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // Tanpa ini browser boleh menebak tipe isi. `/api/logo/*` menyajikan byte yang diunggah
  // orang; tebakan yang salah bisa mengubah "gambar" menjadi dokumen yang dijalankan.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Clickjacking. Situs ini meminta tanda tangan dan transaksi dompet; halaman lain yang
  // membingkainya secara transparan bisa menuntun klik ke tombol "Buy". Tidak ada satu pun
  // `<iframe>` yang membingkai situs ini (diperiksa: tidak ada pemakaian iframe di repo).
  // `X-Frame-Options` untuk browser lama, `frame-ancestors` untuk yang baru.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
  },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Hanya fitur yang memang tidak dipakai. `clipboard-write` dibiarkan (CopyField), begitu pula
  // `usb`/`hid` yang dipakai sebagian konektor dompet perangkat keras.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // `x-powered-by: Next.js` hanya memberi tahu pemindai versi mana yang harus dicoba.
  poweredByHeader: false,
  images: {
    /**
     * Pengoptimal gambar (`/_next/image`) hanya boleh mengambil berkas statis milik repo.
     *
     * KENAPA INI PENTING
     *
     * GHSA-2xp9-vwfh-vxw4 (kritis, Next < 15.5.24): men-decode AVIF buatan penyerang lewat
     * sharp/libheif bisa berujung eksekusi kode di server. Tanpa `localPatterns`, pengoptimal
     * menerima JALUR LOKAL APA PUN — termasuk `/api/logo/<nama>.png`, yang menyajikan byte
     * logo yang diunggah pembuat pasar. Jadi rantai serangannya ada di repo ini sendiri:
     * unggah "PNG" yang isinya AVIF, lalu minta `/_next/image?url=/api/logo/...`.
     *
     * Versinya sudah dinaikkan ke 15.5.27 dan sharp ke 0.35.x; daftar ini lapisan kedua,
     * supaya kerentanan decoder berikutnya juga tidak bisa dicapai lewat byte unggahan orang.
     * Satu-satunya pemakai `next/image` hari ini adalah `/recognition`. Halaman baru yang
     * memakai `next/image` dengan berkas di luar daftar ini akan mendapat 400 dari pengoptimal
     * — tambahkan direktorinya di sini, jangan pernah `/api/**`.
     */
    localPatterns: [
      { pathname: "/recognition/**", search: "" },
      { pathname: "/brand/**", search: "" },
      { pathname: "/hero/**", search: "" },
      { pathname: "/mascot/**", search: "" },
      { pathname: "/share/**", search: "" },
      { pathname: "/agent-compute/**", search: "" },
    ],
    // Setiap kombinasi (url, w, q) adalah satu kerja encode baru. Membiarkan q bebas 1–100
    // memberi pemindai 100x varian per gambar untuk membakar CPU. `next/image` memakai 75
    // kalau `quality` tidak diberikan, dan tidak ada pemanggil yang memberikannya.
    qualities: [75],
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
