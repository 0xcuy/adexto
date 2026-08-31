"use client";

import { useState } from "react";
import { ADEXTO_CONTRACTS } from "@/config/contracts";
import { PUBLISHED_SUBGRAPH } from "@/config/subgraph";
import { 
  CheckCircle2, ExternalLink, ShieldCheck, Database, Copy, Check, 
  Cpu, Layers, Sparkles 
} from "lucide-react";

export default function VerifiedDeploymentCard() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  /**
   * Chains in one place, so a new generation is added once rather than four times.
   *
   * The previous version hand-wrote seven entries covering only the v1 factory and
   * the v1 hook. When `AdextoCurveFactory` — the contract that actually launches
   * tokens — went live on all four mainnets, this card kept listing exclusively the
   * superseded generation, so /pitch showed a registry with the current contract
   * missing from it entirely.
   */
  const CHAINS = [
    { key: "og", label: "0G Mainnet 16661" },
    { key: "base", label: "Base Mainnet 8453" },
    { key: "arbitrum", label: "Arbitrum One 42161" },
    { key: "monad", label: "Monad Mainnet 143" },
  ] as const;

  const chainOf = (key: (typeof CHAINS)[number]["key"]) => ADEXTO_CONTRACTS[key];

  const records = [
    /**
     * Current generation first, because it is the one that matters to a reader.
     *
     * `curveFactoryAddress` comes from `NEXT_PUBLIC_CURVE_FACTORY_*`, so an entry
     * appears here exactly when the app is genuinely wired to that factory. A card
     * that listed the address while the studio still refused to launch would be the
     * same contradiction this page has already been fixed for twice.
     */
    ...CHAINS.flatMap((c) => {
      const chain = chainOf(c.key);
      if (!chain.curveFactoryAddress) return [];
      return [
        {
          label: `AdextoCurveFactory (${c.label})`,
          address: chain.curveFactoryAddress,
          explorerUrl: `${chain.blockExplorer}/address/${chain.curveFactoryAddress}`,
          badge: "launches tokens · v0.10.0",
          color: "border-ok/30 bg-ok/10 text-ok",
        },
      ];
    }),
    /**
     * ERC-8004 Identity Registry. Not ours, and listed for that reason: a launch may
     * bind an agent id here, and the factory calls `ownerOf` on it, so a reader
     * checking our claims needs the address we actually call.
     */
    {
      label: "ERC-8004 Identity Registry (same address on all four mainnets)",
      address: ADEXTO_CONTRACTS.agentRegistry,
      explorerUrl: `https://basescan.org/address/${ADEXTO_CONTRACTS.agentRegistry}`,
      badge: "third-party · upgradeable proxy",
      color: "border-warn/30 bg-warn/10 text-warn",
    },
    // Superseded generation, kept because the addresses are real and permanent, and
    // because deleting them would hide what earlier versions of this page claimed.
    ...CHAINS.flatMap((c) => {
      const chain = chainOf(c.key);
      return [
        {
          label: `AdextoTrinityFactory (${c.label})`,
          address: chain.factoryAddress,
          explorerUrl: `${chain.blockExplorer}/address/${chain.factoryAddress}`,
          badge: "superseded · v1",
          color: "border-line bg-cream-3 text-ink-soft",
        },
        {
          label: `SovereignHook (${c.label})`,
          address: chain.sovereignHookAddress,
          explorerUrl: `${chain.blockExplorer}/address/${chain.sovereignHookAddress}`,
          badge: "superseded · cannot settle trades",
          color: "border-line bg-cream-3 text-ink-soft",
        },
      ];
    }),
    {
      // Badge ini dulu berbunyi "The Graph Published" dengan warna accent, dan
      // secara harfiah benar — NFT subgraph-nya memang ada di Arbitrum One. Tapi
      // versi yang dipublish mendeklarasikan `network: mainnet` (Ethereum) untuk
      // alamat 0xe8E9Cf43… yang punya 0 byte bytecode di Ethereum dan 7216 byte
      // di 0G. Jadi ia memindai chain yang salah sejak blok 1 dan sudah
      // mengindeks nol baris. Menampilkannya sebagai sumber data hijau adalah
      // klaim yang tidak bisa dipertahankan; badge-nya sekarang menyebut apa
      // yang benar-benar disajikannya.
      label: "The Graph Subgraph NFT (Arbitrum One 42161)",
      address: PUBLISHED_SUBGRAPH.subgraphId,
      explorerUrl: PUBLISHED_SUBGRAPH.explorerUrl,
      badge: "published · serves no data yet",
      color: "border-warn/30 bg-warn/10 text-warn",
    },
    {
      /**
       * "Attestation Root" was the wrong word, and it is the same misnomer that let
       * this project claim a hardware attestation nobody ever checked — the contract
       * parameter carrying this value was renamed from `teeAttestationRoot` to
       * `metadataRoot` for exactly that reason. It is a content hash of the launch
       * metadata, stored on 0G DA. Nothing about it attests to an enclave.
       *
       * The transaction is real and was checked before this entry was kept: block
       * 41,868,253 on 0G mainnet, sent by the deployer, status success, 324 bytes of
       * calldata. It appeared alongside invented trade records that were deleted, so
       * it was verified rather than assumed guilty by association.
       */
      label: "0G DA metadata storage root (not an attestation)",
      address: "0xeaa56a1fe9b216f0f58cc0957c8d4793451c69a423c5a73ad6e420749eb4509d",
      explorerUrl: `https://chainscan.0g.ai/tx/0xcfac6cd412f69cefeb2d509edf5dbdeef5dc0fb4613932223b99a4ce535b8c55`,
      badge: "0G DA · content hash",
      color: "border-accent/30 bg-accent-soft text-accent",
    },
    {
      label: "Cloudflare Workers x402 Edge Paywall Gateway",
      address: ADEXTO_CONTRACTS.edgeX402Gateway,
      explorerUrl: ADEXTO_CONTRACTS.edgeX402Gateway,
      badge: "HTTP 402 Edge Active",
      color: "border-warn/30 bg-warn/10 text-warn",
    },
  ];

  return (
    <div className="w-full max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 py-10 overflow-hidden">
      {/* Tanpa bingkai luar: tabel di dalamnya sudah punya bingkai sendiri, dan
          setelah seksi lain dilepas bingkainya, kotak ini menjadi satu-satunya
          kotak besar di halaman — bingkai ganda yang justru menarik perhatian
          ke wadah, bukan ke isinya. */}
      <div className="relative overflow-hidden">
        {/* Glow Accent */}
        <div className="hidden sm:block absolute top-0 right-0 w-96 h-96 bg-accent-soft rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-line pb-6 mb-6">
          <div>
            {/* Badge ini sengaja tetap "DEPLOYED & VERIFIABLE", bukan naik jadi
                "LIVE", meskipun factory kurva kini sudah di-broadcast. Alasannya
                sama seperti dulu, hanya bergeser: yang bisa dipertahankan adalah
                "alamat-alamat ini ada dan bisa kamu periksa". "LIVE" mengundang
                pembaca menyimpulkan ada pasar yang berjalan, dan belum ada satu
                pun token diluncurkan. */}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cream-3 border border-line text-ink-soft text-xs font-mono font-bold mb-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-ok" />
              <span>DEPLOYED &amp; VERIFIABLE ON-CHAIN</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-semibold text-ink flex items-center gap-2">
              <span>Deployed contract registry</span>
            </h2>
            <p className="text-xs sm:text-sm text-ink-soft mt-1">
              Addresses below are the <strong className="text-ink">v1</strong> generation, deployed and verifiable on
              each chain. The executable <code className="text-accent">AdextoCurveFactory</code> is now live on all
              four mainnets, so launching is enabled — but no token has been launched through it yet, which is why
              there is still nothing to trade.
            </p>
          </div>

          <div className="flex items-center gap-3 font-mono text-xs">
            <div className="px-3 py-1.5 rounded-lg bg-white border border-line text-ink-soft">
              RPC: <span className="text-accent font-bold">evmrpc.0g.ai</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-white border border-line text-ink-soft">
              DA: <span className="text-ok font-bold">indexer-turbo</span>
            </div>
          </div>
        </div>

        {/* Daftar kontrak.
            Dulu ini 11 kartu dalam grid dua kolom, masing-masing dengan kotak
            alamat sendiri dan dua tautan berlabel teks — satu bagian memakan
            hampir separuh tinggi halaman dan terbaca seperti dump basis data.
            Sekarang baris ramping: label, badge, alamat, dan dua aksi ikon.
            Data, tautan, dan logika salin tidak berubah. */}
        <div className="rounded-xl border border-line overflow-hidden">
          {/* Badge diberi kolom sendiri. Saat ia ikut mengalir bersama label,
              label panjang seperti "AdextoTrinityFactory (Arbitrum One 42161)"
              mendorong badge ke baris kedua dan tinggi baris jadi tidak rata. */}
          <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1.15fr)_auto] items-center gap-3 border-b border-line bg-cream-3/[0.03] px-3 py-2">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">Contract</span>
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">Gen</span>
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">Address</span>
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">Verify</span>
          </div>

          <div className="divide-y divide-line/[0.06]">
            {records.map((rec, i) => {
              const isCopied = copiedKey === `rec_${i}`;
              return (
                <div
                  key={i}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2.5 transition-colors hover:bg-cream-3/[0.025] sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.15fr)_auto] sm:gap-3"
                >
                  <span className="min-w-0 truncate text-[11px] font-bold text-ink" title={rec.label}>
                    {rec.label}
                  </span>

                  <span
                    className={`justify-self-end whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider sm:justify-self-start ${rec.color}`}
                  >
                    {rec.badge}
                  </span>

                  <span className="addr col-span-2 min-w-0 truncate text-accent/90 sm:col-span-1" title={rec.address}>
                    {rec.address}
                  </span>

                  <div className="col-span-2 flex items-center gap-1 justify-end sm:col-span-1">
                    <button
                      type="button"
                      onClick={() => copyToClipboard(rec.address, `rec_${i}`)}
                      title={isCopied ? "Copied" : "Copy address"}
                      aria-label={`Copy address for ${rec.label}`}
                      className="rounded-md p-1.5 text-ink-soft transition-colors hover:bg-cream-3 hover:text-ink"
                    >
                      {isCopied ? (
                        <Check className="h-3.5 w-3.5 text-ok" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <a
                      href={rec.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Verify on explorer"
                      aria-label={`Verify ${rec.label} on explorer`}
                      className="rounded-md p-1.5 text-accent transition-colors hover:bg-accent-soft hover:text-accent"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
