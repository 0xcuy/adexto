import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import CookieConsent from "@/components/CookieConsent";
import { WalletProvider } from "@/context/WalletContext";
import MobileTabBar from "@/components/MobileTabBar";
import { DEFAULT_THEME, THEME_BOOT_SCRIPT, THEME_COLOR } from "@/lib/theme";

/**
 * Display & body. Berkas woff2 (subset latin, variable) ada di src/app/fonts dan
 * berlisensi SIL OFL 1.1 — dimuat lokal supaya build Docker tidak butuh jaringan,
 * alasan yang sama dengan pemilihan paket Geist dulu. Geist tetap dipasang: Geist Mono
 * untuk angka/alamat, dan Geist Sans sebagai fallback glyph di luar subset latin
 * (mis. angka subscript ₀–₉ pada harga kecil).
 */
const bricolage = localFont({
  src: "./fonts/BricolageGrotesque-Variable.woff2",
  variable: "--font-bricolage",
  weight: "200 800",
  display: "swap",
});
const inter = localFont({
  src: "./fonts/Inter-Variable.woff2",
  variable: "--font-inter",
  weight: "300 800",
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: THEME_COLOR[DEFAULT_THEME],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * Judul tab dulu memakai kepanjangan "Autonomous Decentralized EXchange & Token Orchestrator".
 * Dicabut 2026-09-30 bersama baris yang sama di footer: produknya membuka pasar, dan judulnya
 * sekarang kalimat hero yang sama.
 *
 * "0.70%" di ketiga deskripsi adalah bagian creator pada tier Standard factory yang sedang
 * dipakai meluncurkan (lihat FEE_TIERS di Studio dan FAQ halaman depan). Dulu tertulis 0.10%,
 * angka generasi 0.11.0 — deskripsi ini tersalin ke pratinjau tautan dan cache mesin pencari,
 * jadi angka basi di sini hidup jauh lebih lama daripada halamannya.
 */
export const metadata: Metadata = {
  title: "ADEXTO — Open a market, not just a token",
  description:
    "ADEXTO (adexto.xyz): launch an agent-bound token on a sovereign bonding curve that needs no liquidity deposit. 100% of supply enters the curve, the creator holds none and is paid 0.70% of every swap instead.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/logo.svg",
  },
  /**
   * Kartu pratinjau tautan.
   *
   * Sebelum ini TIDAK ADA metadata openGraph sama sekali, jadi setiap tautan
   * adexto.xyz yang dibagikan ke X, Discord, atau Telegram muncul sebagai
   * pratinjau kosong — hanya URL mentah. Gambarnya dibuat oleh
   * `scripts/capture-og-image.mjs` dengan tipografi yang sama seperti situs.
   *
   * metadataBase membuat `/og.png` diubah menjadi URL absolut. Tanpa itu Next
   * memancarkan jalur relatif, dan setiap pengurai pratinjau menolaknya.
   */
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://adexto.xyz"),
  openGraph: {
    type: "website",
    siteName: "ADEXTO",
    title: "ADEXTO — launch an AI agent token with no liquidity deposit",
    /**
     * Kalimat terakhir dulu berbunyi "World ID proves each creator is a distinct
     * person." Gerbangnya sudah dicabut, jadi kalimat itu jadi klaim palsu — dan
     * yang paling berbahaya, karena description openGraph tersalin ke pratinjau X,
     * Discord, dan Telegram lalu tersimpan di cache mereka jauh lebih lama daripada
     * halamannya sendiri. Penggantinya menyebut ERC-8004, yang benar-benar berjalan.
     */
    description:
      "100% of supply enters a sovereign bonding curve, a launch costs gas only, and the creator earns 0.70% of every swap. Tokens can be bound to an ERC-8004 agent identity at launch.",
    url: "/",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "ADEXTO — sovereign bonding curve launchpad" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ADEXTO — launch an AI agent token with no liquidity deposit",
    description:
      "Gas-only launches on Monad, Arbitrum, Robinhood Chain, Base and 0G. Creator paid 0.70% of every swap, no free token allocation.",
    images: ["/og.png"],
  },
};

/**
 * Tipografi nyata. Sebelumnya seluruh situs memakai `-apple-system` — font sistem.
 * Itu penyebab terbesar tampilan terasa belum dirancang, dan tidak ada penyesuaian
 * CSS lain yang bisa menggantikannya. Perhatikan juga bahwa `tailwind.config`
 * merujuk `--font-sans` dan `--font-mono` yang tidak pernah didefinisikan, sehingga
 * setiap `font-sans`/`font-mono` diam-diam jatuh ke font sistem; variabel itu kini
 * dipetakan ke Geist di globals.css.
 *
 * Geist dipilih karena angka dan alamat heksadesimalnya jernih pada ukuran kecil,
 * dan paketnya membawa file font sendiri sehingga build Docker tidak perlu jaringan.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning HANYA pada <html>: skrip tema di <head> boleh mengganti
    // data-theme sebelum React hidrasi. Tidak berlaku ke anak-anaknya.
    <html
      lang="en"
      data-theme={DEFAULT_THEME}
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} ${bricolage.variable} ${inter.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      {/*
        Latar sebelumnya adalah <Live3DBackground />: swarm 180 titik three.js
        dengan inti ikosahedron berputar, dipasang fixed di belakang SEMUA halaman.
        Di tema gelap itu terbaca sebagai kedalaman. Di atas cream, garis cyan dan
        ungu 18% opasitas itu berubah jadi corat-coret di belakang teks — dan pada
        halaman trading ia bersaing langsung dengan grafik lilin, satu-satunya
        gambar di layar yang benar-benar membawa data.
        Penggantinya berupa satu gradasi cream yang sangat halus di globals.css.
        Komponennya dihapus, bukan disembunyikan, supaya tidak ada canvas WebGL
        yang tetap ikut dirender di setiap muat halaman.
      */}
      <body className="bg-cream text-ink min-h-screen flex flex-col antialiased selection:bg-accent-soft selection:text-accent">
        <WalletProvider>
          {/* Ruang bawah di mobile untuk tab bar tetap (lihat MobileTabBar). */}
          <div className="relative z-10 flex flex-col min-h-screen pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] lg:pb-0">
            <Navbar />
            <main className="flex-1">{children}</main>
            <Footer />
            <MobileTabBar />
            {/* Di luar <main> dan sesudah Footer, sebab ia melayang di atas segalanya
                (`fixed bottom-0`) dan bukan bagian dari alur dokumen. Menaruhnya di dalam
                <main> akan membuatnya ikut terpotong oleh halaman yang punya overflow
                sendiri. */}
            <CookieConsent />
          </div>
        </WalletProvider>
      </body>
    </html>
  );
}
