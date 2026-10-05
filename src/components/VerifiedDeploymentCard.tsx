"use client";

import { useState } from "react";
import {
  ADEXTO_CONTRACTS,
  CURVE_FACTORY_GENERATION,
  SUPERSEDED_CURVE_FACTORY_GENERATION,
} from "@/config/contracts";
import { PUBLISHED_SUBGRAPH } from "@/config/subgraph";
import { 
  CheckCircle2, ExternalLink, ShieldCheck, Database, Copy, Check, 
  Cpu, Layers, Sparkles 
} from "lucide-react";
import { LAUNCH_CLAUSE } from "@/lib/launch-state";
import { LAUNCH_CHAIN_COUNT_WORD } from "@/lib/chains";

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
    { key: "robinhood", label: "Robinhood Chain 4663" },
    // Only rendered once NEXT_PUBLIC_CURVE_FACTORY_ARC is set (see the filter below).
    { key: "arc", label: "Arc 5042" },
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
          label: `${CURVE_FACTORY_GENERATION.contract} (${c.label})`,
          address: chain.curveFactoryAddress,
          explorerUrl: `${chain.blockExplorer}/address/${chain.curveFactoryAddress}`,
          badge: `launches tokens · v${CURVE_FACTORY_GENERATION.version}`,
          color: "border-ok/30 bg-ok/10 text-ok",
        },
      ];
    }),
    /**
     * Factory kurva yang digantikan, kalau ada.
     *
     * Muncul hanya ketika `NEXT_PUBLIC_CURVE_FACTORY_PREV_*` terisi, jadi sebelum ada
     * penerusnya baris ini tidak ada sama sekali — bukan baris kosong yang menyiratkan
     * ada generasi lain. Setelah ada, alamatnya WAJIB tetap tampil: pasar yang sudah
     * hidup lahir dari kontrak itu dan bytecode-nya tidak bisa diubah, jadi
     * menghilangkannya berarti menyembunyikan justru kontrak yang paling ingin
     * diperiksa orang.
     */
    ...CHAINS.flatMap((c) => {
      const chain = chainOf(c.key);
      if (!chain.supersededCurveFactoryAddress) return [];
      return [
        {
          label: `${SUPERSEDED_CURVE_FACTORY_GENERATION.contract} (${c.label})`,
          address: chain.supersededCurveFactoryAddress,
          explorerUrl: `${chain.blockExplorer}/address/${chain.supersededCurveFactoryAddress}`,
          badge: `superseded · v${SUPERSEDED_CURVE_FACTORY_GENERATION.version} · markets still tradable`,
          color: "border-line bg-cream-3 text-ink-soft",
        },
      ];
    }),
    /**
     * ERC-8004 Identity Registry. Not ours, and listed for that reason: a launch may
     * bind an agent id here, and the factory calls `ownerOf` on it, so a reader
     * checking our claims needs the address we actually call.
     */
    {
      label: `ERC-8004 Identity Registry (same address on all ${LAUNCH_CHAIN_COUNT_WORD} mainnets)`,
      address: ADEXTO_CONTRACTS.agentRegistry,
      explorerUrl: `https://basescan.org/address/${ADEXTO_CONTRACTS.agentRegistry}`,
      badge: "third-party · upgradeable proxy",
      color: "border-warn/30 bg-warn/10 text-warn",
    },
    // The pre-release hook-era contracts (AdextoTrinityFactory, SovereignHook) are no longer
    // listed: they never settled a trade, no market lives on them, and the README dropped
    // them too. Their addresses stay in src/config/contracts.ts.
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

  /**
   * Tata letak untuk kolom baca docs (±720 px), satu-satunya tempat kartu ini dirender (`/docs`, seksi
   * "Contracts and status"; `src/app/_pitch` folder privat, tidak dirutekan). Dulu kartu ini memakai grid
   * empat kolom selebar halaman: di kolom docs labelnya terpotong jadi "AdextoFacto…", dan di ponsel label
   * generasi lama pecah per huruf karena badge-nya `nowrap` (tangkapan Playwright 4 Okt). Sekarang setiap
   * baris dua tingkat: label + badge, lalu alamat + aksi.
   */
  return (
    <div className="w-full pt-6">
      {/* Tanpa bingkai luar: tabel di dalamnya sudah punya bingkai sendiri, dan
          setelah seksi lain dilepas bingkainya, kotak ini menjadi satu-satunya
          kotak besar di halaman — bingkai ganda yang justru menarik perhatian
          ke wadah, bukan ke isinya. */}
      <div className="relative overflow-hidden">
        {/* Glow Accent */}
        <div className="hidden sm:block absolute top-0 right-0 w-96 h-96 bg-accent-soft rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />

        <div className="relative mb-5 flex flex-col gap-4 border-b border-line pb-6">
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
            {/* h3: di /docs kartu ini berada di bawah h2 "Contracts and status". */}
            <h3 className="text-[18px] font-semibold leading-snug text-ink">Deployed contract registry</h3>
            {/* Kalimat ini dulu berbunyi "Addresses below are the v1 generation".
                Itu SALAH sejak tabelnya sendiri diperbaiki: empat baris teratas adalah
                AdextoCurveFactory v0.10.0 — justru generasi yang dipakai. Tabelnya
                dibetulkan (lihat komentar di atas `records`), captionnya tidak, jadi
                selama itu caption ini mendeskripsikan tabel versi LAMA tepat di atas
                tabel barunya.

                Sekarang caption tidak lagi mengklaim generasi untuk SELURUH daftar.
                Generasi adalah urusan badge di setiap baris (dulu kolom "Gen"), karena di
                situ ia tidak bisa berbeda dari baris yang dijelaskannya. */}
            <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
              Every address here is deployed and can be checked on its own chain. The list spans two generations on
              purpose and each row states which one it is:{" "}
              {/* Kalimat ini membantah tabelnya sendiri untuk KEDUA kalinya, dengan cara
                  yang sama seperti yang dijelaskan komentar di atas. Ia menamai
                  AdextoCurveFactory v0.10.0 sebagai generasi yang meluncurkan token hari
                  ini, padahal `records` di atas sudah membangun baris teratasnya dari
                  `CURVE_FACTORY_GENERATION` — yaitu AdextoFactory 0.11.0. Nama DAN versinya
                  sekarang dua-duanya dari konstanta yang sama, jadi caption tidak bisa lagi
                  menyebut generasi yang berbeda dari tabel di bawahnya. */}
              <code className="text-accent">{CURVE_FACTORY_GENERATION.contract}</code>{" "}
              <strong className="text-ink">v{CURVE_FACTORY_GENERATION.version}</strong> (ADEXTO v1) is the generation
              that launches tokens today, and the superseded{" "}
              <code className="text-accent">{SUPERSEDED_CURVE_FACTORY_GENERATION.contract}</code>{" "}
              v{SUPERSEDED_CURVE_FACTORY_GENERATION.version} entries are kept because the six earlier markets were
              created by them and still trade.{" "}
              {/* Kalimat ini dulu berbunyi "…but {LAUNCH_CLAUSE}, which is why there is still
                  nothing to trade." Dua-duanya berhenti benar begitu $ADEXTO diluncurkan:
                  klausanya berubah makna, dan ada pasar yang bisa diperdagangkan.
                  `{" "}` di atas: tanpa itu JSX menempelkan dua kalimat ("trade.Launching"). */}
              Launching is enabled on all {LAUNCH_CHAIN_COUNT_WORD} mainnets, and {LAUNCH_CLAUSE}.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
            <div className="px-3 py-1.5 rounded-lg bg-surface border border-line text-ink-soft">
              RPC: <span className="text-accent font-bold">evmrpc.0g.ai</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-surface border border-line text-ink-soft">
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
        <div className="relative rounded-xl border border-line overflow-hidden">
          {/* Dua tingkat per baris, tanpa kepala kolom. Baris pertama label (boleh membungkus, tidak pernah
              dipotong) lalu badge generasi, yang turun ke baris sendiri bila tidak muat. Baris kedua alamat
              dan dua aksi. Alamat dipotong di TENGAH (awal + enam karakter terakhir tetap terlihat), dan
              tombol Copy selalu menyalin alamat lengkap. */}
          <ul className="divide-y divide-line">
            {records.map((rec, i) => {
              const isCopied = copiedKey === `rec_${i}`;
              const tail = rec.address.length > 24 ? rec.address.slice(-6) : "";
              const head = tail ? rec.address.slice(0, -6) : rec.address;
              return (
                <li key={i} className="px-3 py-2.5 transition-colors hover:bg-cream-3/[0.025] sm:px-4">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="min-w-0 break-words text-[13px] font-semibold leading-snug text-ink">{rec.label}</span>
                    <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase leading-normal tracking-wider ${rec.color}`}>
                      {rec.badge}
                    </span>
                  </div>

                  <div className="mt-0.5 flex items-center gap-1">
                    <span className="addr flex min-w-0 flex-1 text-accent/90" title={rec.address}>
                      <span className="min-w-0 truncate">{head}</span>
                      {tail && <span className="shrink-0">{tail}</span>}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(rec.address, `rec_${i}`)}
                      title={isCopied ? "Copied" : "Copy address"}
                      aria-label={`Copy address for ${rec.label}`}
                      // 36 px di layar sentuh (dulu 23 px, rapat dengan tombol di sebelahnya), 28 px mulai lg.
                      className="inline-flex h-[36px] w-[36px] items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-cream-3 hover:text-ink lg:h-[28px] lg:w-[28px]"
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
                      className="inline-flex h-[36px] w-[36px] items-center justify-center rounded-md text-accent transition-colors hover:bg-accent-soft hover:text-accent lg:h-[28px] lg:w-[28px]"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
