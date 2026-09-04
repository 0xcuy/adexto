import Link from "next/link";
import { Terminal, Shield, Cpu, Zap, Github, Twitter, Layers, CloudLightning } from "lucide-react";
import { LAUNCH_SENTENCE } from "@/lib/launch-state";

export default function Footer() {
  return (
    <footer className="border-t border-line bg-cream-2 relative z-10 text-ink-soft text-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl overflow-hidden border border-line p-1 bg-white">
                <img src="/logo.svg" alt="ADEXTO Protocol Logo" className="w-full h-full object-contain" />
              </div>
              <div>
                <span className="font-semibold text-ink tracking-wide text-base block leading-tight">ADEXTO PROTOCOL</span>
                <span className="text-[10px] text-ink-soft">Autonomous Decentralized EXchange &amp; Token Orchestrator</span>
              </div>
            </div>
            {/* Dulu kalimat ini mengulang nama panjangnya lalu menambahkan
                "powered by 0G Private Computer (TEE)". Pengulangannya sudah ada di
                baris di atas, dan bagian TEE-nya adalah klaim yang tidak kami
                verifikasi. Diganti dengan apa yang benar-benar dilakukan produk. */}
            <p className="text-ink-soft leading-relaxed text-xs">
              Launch an agent token on a bonding curve that needs no liquidity deposit, on 0G, Base,
              Arbitrum or Monad. The creator is paid out of every swap instead of holding an allocation.
            </p>
            <div className="flex items-center gap-2 pt-2">
              {/* Dulu "● 0G TEE Mainnet Ready" dengan titik hijau — dan titik hijau
                  di footer berarti "sedang berjalan". Yang benar: agen memanggil
                  router 0G lewat HTTPS biasa, dan tidak ada satu baris kode pun di
                  repo ini yang mengambil atau memverifikasi attestation SEV-SNP.
                  Jadi TEE-nya adalah klaim 0G, bukan klaim yang kami buktikan. */}
              <Link
                href="/docs"
                className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-cream-3 text-ink-soft border border-line hover:text-ink"
                title="0G router reports Intel TDX attestation via dstack. ADEXTO reads that declaration; it does not verify the raw quote."
              >
                0G TeeML · TDX reported
              </Link>
              {/* Amber di sini dulu terbaca sebagai peringatan. Cloudflare x402
                  adalah nama fitur, bukan keadaan, jadi warna peringatan
                  dikembalikan untuk keperluan aslinya. */}
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-accent-soft text-accent border border-accent/30">
                Cloudflare x402 Edge
              </span>
            </div>
          </div>

          <div>
            <h4 className="font-bold text-ink mb-3 uppercase tracking-wider text-xs">Protocol &amp; Apps</h4>
            <ul className="space-y-2 text-ink-soft">
              <li><Link href="/studio" className="hover:text-accent transition-colors">Launch Studio</Link></li>
              <li><Link href="/explorer" className="hover:text-accent transition-colors">Live Explorer</Link></li>
              <li><Link href="/swap" className="hover:text-accent transition-colors">Sovereign DEX Swap</Link></li>
              <li><Link href="/agent/demo" className="hover:text-accent transition-colors">Cloudflare x402 Demo</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-ink mb-3 uppercase tracking-wider text-xs">Architecture &amp; Trust</h4>
            <ul className="space-y-2 text-ink-soft">
              <li><Link href="/whitepaper" className="hover:text-accent transition-colors">Whitepaper &amp; Tokenomics</Link></li>
              <li><Link href="/pitch" className="hover:text-accent transition-colors">VC Memorandum &amp; Grants</Link></li>
              {/* Dua label ini menjanjikan lebih dari yang ada. Suite MCP belum
                  dibangun sama sekali, dan "Verifiable Compute" menyiratkan kami
                  memeriksa attestation — tidak. Halaman docs sekarang menyatakan
                  status keduanya, jadi tautannya diberi nama sesuai isinya. */}
              <li><Link href="/docs" className="hover:text-accent transition-colors">Technical status</Link></li>
              <li><Link href="/pitch" className="hover:text-accent transition-colors">Deployed contract registry</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-ink mb-3 uppercase tracking-wider text-xs">EVM chains</h4>
            {/* Dulu empat baris berkotak dengan border cyan/sky/ungu/biru dan empat
                titik berkedip. Kolom footer lain berupa daftar polos, jadi kotak
                pelangi ini terlihat seperti tabel yang tersesat — dan empat animasi
                berkedip sekaligus hanya menarik mata tanpa memberi informasi.
                Sekarang: satu daftar, pemisah hairline, angka rata kanan. */}
            {/* Kata "Live" dihapus dari keempat baris.
                Kolom ini dulu berbunyi "0G Mainnet 16661 Live" di keempat chain,
                dua inci di bawah catatan hero yang menyatakan factory peluncuran
                BELUM di-broadcast. Dua pernyataan itu tidak bisa keduanya benar,
                dan pembaca akan memercayai yang lebih berani. Yang benar: keempat
                chain didukung oleh aplikasi ini, tetapi belum ada satu pun yang
                bisa meluncurkan token. Judul kolomnya juga diubah dari "Supported"
                — kata itu tidak menjanjikan apa-apa — menjadi pernyataan status. */}
            <ul className="divide-y divide-line text-xs">
              {[
                { name: "0G Mainnet", id: "16661" },
                { name: "Arbitrum One", id: "42161" },
                { name: "Monad Mainnet", id: "143" },
                { name: "Base Mainnet", id: "8453" },
              ].map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-ink-soft">{c.name}</span>
                  <span className="font-mono text-[11px] text-ink-faint">{c.id}</span>
                </li>
              ))}
            </ul>
            {/* This footer shows on every page, so a stale sentence here is a
                stale sentence everywhere — it kept saying launching was disabled
                after the curve factory had actually been broadcast to all four
                mainnets, contradicting the studio two scrolls above it. */}
            <p className="mt-2 text-[10px] leading-relaxed text-ink-faint">{LAUNCH_SENTENCE}</p>
          </div>
        </div>

      <div className="mt-8 pt-6 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-ink-soft">
        {/* "Zero central points of failure" dihapus. Itu tidak benar dan mudah
            dibantah: aplikasi ini satu kontainer di satu VPS di belakang satu
            Caddy, registry-nya satu berkas JSON di satu volume, /api/chat
            bergantung pada satu kunci router, dan gerbang x402 satu Worker.
            Yang memang tanpa titik pusat kegagalan adalah KONTRAKNYA — kurva
            tidak punya fungsi penarikan dan tidak punya pemilik yang bisa
            menghentikannya. Itu klaim yang bisa dipertahankan, jadi itu yang
            ditulis. */}
        <p>© 2026 ADEXTO (adexto.xyz). Curves are immutable and have no withdrawal function.</p>
        <div className="flex items-center gap-4">
          <a
            href="https://x.com/adexto_"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-ink-soft hover:text-accent transition-colors font-semibold"
          >
            <Twitter className="w-4 h-4" />
            <span>@adexto_</span>
          </a>
          <a
            href="https://github.com/0xcuy/adexto"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-ink-soft hover:text-accent transition-colors font-semibold"
          >
            <Github className="w-4 h-4" />
            <span>GitHub</span>
          </a>
        </div>
      </div>
      </div>
    </footer>
  );
}
