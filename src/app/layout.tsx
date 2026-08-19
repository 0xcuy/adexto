import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Live3DBackground from "@/components/Live3DBackground";
import { WalletProvider } from "@/context/WalletContext";

export const metadata: Metadata = {
  title: "ADEXTO — Autonomous Decentralized EXchange & Token Orchestrator",
  description: "ADEXTO (adexto.xyz): Production infrastructure binding ERC-8004 tokens, sovereign bonding curves that need no liquidity deposit, and 24/7 0G TEE Agents with Cloudflare Workers x402 edge monetization.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/logo.svg",
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
    <html lang="en" className={`dark ${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="bg-[#04060a] text-slate-100 min-h-screen flex flex-col antialiased selection:bg-cyan-500/30 selection:text-cyan-200">
        <WalletProvider>
          <Live3DBackground />
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
