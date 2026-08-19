import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { WalletProvider } from "@/context/WalletContext";

export const metadata: Metadata = {
  title: "ADEXTO — Autonomous Decentralized EXchange & Token Orchestrator",
  description:
    "ADEXTO (adexto.xyz): launch an agent-bound token on a sovereign bonding curve that needs no liquidity deposit. 100% of supply enters the curve, the creator holds none and is paid 0.10% of every swap instead.",
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
    description:
      "100% of supply enters a sovereign bonding curve, a launch costs gas only, and the creator earns 0.10% of every swap. World ID proves each creator is a distinct person.",
    url: "/",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "ADEXTO — sovereign bonding curve launchpad" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ADEXTO — launch an AI agent token with no liquidity deposit",
    description:
      "Gas-only launches on 0G, Base, Arbitrum and Monad. Creator paid 0.10% of every swap, no free token allocation.",
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
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
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
          <div className="relative z-10 flex flex-col min-h-screen">
            <Navbar />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
        </WalletProvider>
      </body>
    </html>
  );
}
