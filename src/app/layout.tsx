import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Live3DBackground from "@/components/Live3DBackground";
import { WalletProvider } from "@/context/WalletContext";

export const metadata: Metadata = {
  title: "ADEXTO — Autonomous Decentralized EXchange & Token Orchestrator",
  description: "ADEXTO (adexto.xyz): Production infrastructure binding ERC-8004 tokens, Uniswap v4 Sovereign Hooks, and 24/7 0G TEE Agents with Cloudflare Workers x402 edge monetization.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
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
