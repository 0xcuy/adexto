"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import {
  Cpu, RefreshCw, Sparkles, ShieldCheck, Send, Bot, ChevronDown,
  Lock, CheckCircle2, AlertTriangle, Wand2, Dices, XCircle, Info, Droplets, Fingerprint,
  ImagePlus, Zap, SlidersHorizontal, Link2, Check, Fuel, HandCoins,
} from "lucide-react";
import { buildStudioPrefillUrl, parseStudioPrefill, sanitizeSymbol, type StudioMode } from "@/lib/studio-prefill";
import { CURVE_FACTORY_GENERATION } from "@/config/contracts";

import Mascot, { type MascotPose } from "@/components/Mascot";
import { readSquareLogoFile } from "@/lib/logo-upload";
import { useWallet } from "@/context/WalletContext";
import { FormattedMarkdown } from "@/components/FormattedMarkdown";
import LaunchCostCard from "@/components/LaunchCostCard";
import LaunchAnnouncement from "@/components/LaunchAnnouncement";
import { CHAIN_LIST, type ChainInfo } from "@/lib/chains";
import { CURVE_FACTORY_ABI, checkAgentOwnership, describeTxError, ensureWalletChain } from "@/lib/dex";
import { getActiveEip1193 } from "@/lib/wallet-provider";
import { formatSmallNumber } from "@/lib/pricing";
import { OPENING_MARKET_CAP_USD, openingVirtualNative } from "@/lib/opening-cap";
import {
  ACCEPT_ATTR,
  ACCEPTED_MIME,
  LOGO_PX,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MB,
  validateProjectImage,
} from "@/lib/logo-image";
import { DEFAULT_CATEGORY, MARKET_CATEGORIES, type MarketCategory } from "@/lib/categories";
import { streamChat, type ChatReasoningProgress } from "@/lib/chat-stream";

/**
 * Launch console.
 *
 * Rebuilt around four audit findings:
 *   1. `/api/deploy` invented the token address with `Math.random()`. The address is
 *      now read from the `TrinityProjectDeployed` receipt event and verified
 *      server-side before the project is registered.
 *   2. A rejected on-chain transaction was swallowed by `console.warn` and the UI
 *      still printed "Deployment Succeeded" with a fake address. Failures are now
 *      surfaced per chain and never produce a success screen on their own.
 *   3. The button claimed "Deploy across 4 Chains" while `factoryAddress` was a
 *      two-way ternary, so Base and Monad were never touched. Each selected chain
 *      now gets its own transaction, and chains without a v2 factory are shown as
 *      unavailable instead of being silently skipped.
 *   4. The "World ID Proof of Humanity" gate was a plain `personal_sign` with no
 *      server verification. It is now labelled as address attestation and the
 *      signature is verified server-side.
 *
 * GERBANG PROOF-OF-PERSONHOOD SUDAH DICABUT
 *
 * Pernah ada lapis kedua World ID di sini. Ia dicabut karena menuntut verifikasi Orb
 * untuk lewat, dan itu berarti hampir semua calon pengguna — termasuk pemilik proyek
 * ini — terkunci di luar konsol peluncurannya sendiri. Gerbang yang tidak bisa dilewati
 * siapa pun bukan keamanan, itu halaman mati.
 *
 * Yang HARUS diingat kalau ada yang tergoda memasangnya kembali: `deployTrinity` di
 * factory tidak punya access control sama sekali, jadi gerbang apa pun di sini hanya
 * menjaga PENDAFTARAN di registry situs, bukan peluncuran on-chain. Siapa pun selalu
 * bisa memanggil factory langsung. Karena itu jangan pernah menulis copy yang
 * menyatakan setiap kreator adalah orang yang terverifikasi berbeda.
 */

type DeployStatus = "pending" | "signing" | "confirming" | "registering" | "success" | "failed" | "skipped";

interface ChainResult {
  chainKey: string;
  chainName: string;
  chainId: number;
  status: DeployStatus;
  message?: string;
  txHash?: string;
  tokenAddress?: string;
  poolAddress?: string;
  explorerTx?: string;
}

interface TickerChainState {
  chainId: number;
  chainKey: string | null;
  available: boolean;
  reason: string | null;
}

/**
 * Hasil pemeriksaan ticker, disimpan UNTUK SEMUA chain sekaligus.
 *
 * `available` dan `reason` global sengaja DIBUANG dari state ini. Keduanya bergantung
 * pada chain mana yang sedang dipilih, dan menyimpannya berarti setiap klik chain
 * memaksa pengambilan ulang ke server hanya untuk mengubah satu boolean. Sekarang
 * keduanya diturunkan dari `perChain` di dalam komponen — nol jaringan saat berganti
 * chain.
 *
 * `error` hanya untuk kegagalan jaringan, bukan untuk ticker yang tidak tersedia:
 * alasan per-chain sudah memuat penolakan format maupun ticker terpesan.
 */
interface TickerState {
  checking: boolean;
  perChain: TickerChainState[];
  error: string | null;
}

const MODELS = [
  { id: "glm-5.3", label: "0G: GLM-5.3" },
  { id: "0gm-1.0-35b-a3b", label: "0G: 0GM-1.0 35B" },
  { id: "0gm-1.0-35b-a3b-sia", label: "0G: 0GM-1.0 SIA" },
];

/**
 * Satu gaya untuk semua kolom isian.
 *
 * Tiap input dulu menuliskan sendiri `bg-cream-2 border border-line/[0.06]`:
 * garis dengan opacity 6% di atas kartu, jadi praktis tidak pernah tergambar.
 * Akibatnya nama token, ticker, supply dan mandate terbaca sebagai teks biasa —
 * tidak ada satu pun tanda bahwa keempatnya bisa diketik, padahal mengisinya
 * adalah seluruh maksud panel ini. Sekarang garisnya utuh, latarnya putih di atas
 * kartu cream, tingginya cukup untuk disentuh, dan fokusnya punya ring supaya
 * kolom aktif terlihat tanpa bergantung pada outline bawaan peramban yang dibuang.
 */
const FIELD_CLASS =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink transition-colors " +
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

/**
 * Pancingan untuk co-pilot.
 *
 * Kolom kanan dulu memuat satu sapaan lalu ratusan piksel putih sampai kotak
 * input di dasarnya — ruang terbesar di halaman ini dipakai untuk tidak
 * mengatakan apa pun. Mengklik salah satu hanya MENGISI kotak input, tidak
 * mengirim, supaya pertanyaannya masih bisa disunting dulu.
 */
/**
 * Pose robot yang bisa dipakai sebagai emblem pasar.
 *
 * Sengaja daftar eksplisit dan bukan hasil membaca direktori: berkas di `public/mascot/`
 * dihasilkan `scripts/crop-mascot.mjs`, dan kalau suatu saat ada pose baru di sana, ia
 * harus MASUK ke sini secara sadar — galeri yang tumbuh sendiri akan menerbitkan pose
 * yang belum pernah dilihat siapa pun sebagai pilihan resmi.
 *
 * Disimpan sebagai jalur, bukan data URI: `validateProjectImage` menerima jalur internal,
 * dan itu jauh lebih murah daripada 34 KB base64 per pasar di registry.
 */
const MASCOT_PRESETS: MascotPose[] = [
  "front",
  "threequarter",
  "idle",
  "wave",
  "point",
  "think",
  "celebrate",
  "run",
  "jump",
  "sit",
];

const SUGGESTED_PROMPTS = [
  // Tanpa angka: tarifnya bisa dipilih creator dan kaki protokol ditambahkan di atasnya
  // per chain, jadi menuliskan "0.30%" dan "tiga" di teks statis akan salah setiap kali
  // seseorang memilih tier lain atau chain yang factory-nya sudah naik versi.
  "Explain how the swap fee splits, and what a trader actually pays",
  "If I hold no tokens, how do I actually get paid?",
  "Which chain should I launch on first, and why?",
  "Write a mandate for a delta-neutral yield agent",
];

/**
 * The three fee tiers, as one source of truth.
 *
 * These numbers used to live inline in the tier buttons while `applyPreset` set the
 * total and the buyback share but NOT the creator share. Picking the "defi" preset
 * therefore selected the 0.10% tier while leaving the creator cut at whatever it was,
 * usually the 0.10% default — so the parts (0.10 + 0.02) exceeded the whole (0.10).
 * The UI hid it because the depth readout is `Math.max(0, ...)`, and the server turned
 * it into a NEGATIVE depth of −2 bps on the way to the factory.
 *
 * Keeping the split in one table means a preset cannot select a tier and then disagree
 * with it. Each row must satisfy creator + cut <= fee, which the deploy route now
 * enforces server-side as well.
 */
const FEE_TIERS = {
  low: { fee: 0.6, creator: 0.4, cut: 0.05, label: "0.60% Low" },
  standard: { fee: 1.0, creator: 0.7, cut: 0.1, label: "1.00% Standard" },
  meme: { fee: 2.0, creator: 1.5, cut: 0.2, label: "2.00% Meme" },
} as const;

/**
 * KENAPA TIER LAMA TIDAK BISA DIPERTAHANKAN, bukan sekadar dinaikkan karena selera.
 *
 * Nilai sebelumnya adalah 0.10 / 0.30 / 0.50 dengan kaki protokol 0.10% DITAMBAHKAN di
 * atasnya. Sejak 0.12.0 kaki itu DIPOTONG DARI DALAM `swapFeeBps`, dan konsekuensinya
 * aritmetis, bukan estetis: tier 0.10% berarti seluruh tarif habis oleh kaki protokol
 * sendiri, sehingga `creator + buyback + 0.10 <= 0.10` mustahil dipenuhi dan factory
 * menolak peluncurannya. Tier itu bukan jadi kurang menarik, ia jadi tidak bisa dipakai.
 *
 * Batas bawah yang sesungguhnya: creator 70% + buyback 10% dari total menyisakan 20%
 * untuk protokol dan depth, jadi depth baru positif ketika total melewati 0.50%. Karena
 * itu tier terendah 0.60% dan bukan 0.50% — pada 0.50% depth-nya tepat nol, dan lantai
 * harga berhenti naik selamanya untuk pasar itu.
 *
 * Tiap baris dihitung ulang di sini supaya bisa diperiksa tanpa menjalankan apa pun.
 * depth = fee - creator - cut - 0.10:
 *
 *   low       0.60 - 0.40 - 0.05 - 0.10 = 0.05
 *   standard  1.00 - 0.70 - 0.10 - 0.10 = 0.10
 *   meme      2.00 - 1.50 - 0.20 - 0.10 = 0.20
 *
 * `standard` adalah model 0.12.0 yang diputuskan: 1% total, creator 70%, buyback 10%,
 * protokol 10%, depth 10%. Dua tier lainnya mengikuti bentuk yang sama dengan depth
 * tetap positif.
 */

type FeeTier = keyof typeof FEE_TIERS;

/**
 * Persona bawaan formulir (milik preset demo "Aegis Quant AI") dan pengganti netralnya untuk
 * mode Express.
 *
 * Express dipakai orang yang hanya mengisi nama, ticker dan gambar, jadi persona "quant market
 * maker" akan menempel ke token apa pun tanpa mereka pernah membacanya — dan menjanjikan
 * perilaku yang tidak ada: tidak ada bot yang memperdagangkan pasar atas nama creator. Diganti
 * HANYA bila masih persis bawaan; persona yang sudah disunting creator tidak disentuh.
 */
const DEFAULT_PERSONA = "24/7 quant market maker and liquidity rebalancer";
const EXPRESS_PERSONA = "Answers questions about this market: its curve, its fees and its depth.";

/** Server menolak attestation lebih tua dari 30 menit; Express menandatangani ulang sebelum itu. */
const ATTESTATION_REFRESH_MS = 25 * 60_000;
const attestationAge = (message: string) => {
  const m = message.match(/Timestamp:\s*(\d+)/);
  return m ? Date.now() - Number(m[1]) : Number.POSITIVE_INFINITY;
};

export default function StudioPage() {
  const { address, isConnected, isConnecting, connectWallet, switchToChain } = useWallet();

  // ── form state ───────────────────────────────────────────────────────────
  const [tokenName, setTokenName] = useState("Aegis Quant AI");
  const [tokenTicker, setTokenTicker] = useState("AQUANT");
  const [tokenSupply, setTokenSupply] = useState("1,000,000,000");
  /**
   * Kategori yang dipilih creator.
   *
   * Bawaannya `DEFAULT_CATEGORY` supaya perilakunya identik dengan sebelum field ini ada:
   * siapa pun yang tidak menyentuh dropdown mendapat hasil yang sama seperti dulu.
   */
  const [category, setCategory] = useState<MarketCategory>(DEFAULT_CATEGORY);
  const [generatedLogo, setGeneratedLogo] = useState<string | null>("/logo.svg");
  /**
   * Apakah logo yang terpasang benar-benar keluaran model, atau gambar cadangan.
   *
   * /api/generate-logo dulu menjawab `success: true` dengan `model:
   * "z-image-turbo (0G TEE Fallback)"` untuk SVG yang digambar sendiri, sehingga
   * panel ini tidak punya cara membedakannya — dan menampilkan nama model di atas
   * gambar yang tidak pernah disentuh model. Sekarang route melaporkan `generated`,
   * dan panelnya menuruti itu.
   */
  const [logoInfo, setLogoInfo] = useState<{ generated: boolean; note?: string } | null>(null);
  const [isGeneratingLogo, setIsGeneratingLogo] = useState(false);
  /**
   * Dari mana logo yang terpasang berasal.
   *
   * Dipisah dari `logoInfo` karena keduanya menjawab pertanyaan berbeda: `logoInfo` menjawab
   * "apakah model benar-benar jalan", sedangkan ini menjawab "apakah creator memilih
   * gambarnya sendiri". Perlu dibedakan sebab begitu creator mengunggah logonya sendiri,
   * tombol Generate harus mati — kalau tidak, satu klik tak sengaja menimpa berkas yang baru
   * saja dipilih dan tidak ada jalan mengembalikannya.
   */
  const [logoSource, setLogoSource] = useState<"default" | "generated" | "uploaded" | "preset">("default");
  /** Galeri preset dibuka atau tidak. Tertutup dulu supaya barisnya tidak ramai. */
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [isReadingLogo, setIsReadingLogo] = useState(false);
  const logoFileRef = useRef<HTMLInputElement | null>(null);

  const [feeTier, setFeeTier] = useState<FeeTier>("standard");
  /** Nilai awal HARUS sama dengan FEE_TIERS.standard, kalau tidak layar buka dengan tier
   *  yang tersorot tidak cocok dengan angka di sebelahnya sampai seseorang mengkliknya. */
  /**
   * `<number>` WAJIB eksplisit. `FEE_TIERS` memakai `as const`, jadi
   * `useState(FEE_TIERS.standard.fee)` menyimpulkan tipe literal `1` dan bukan `number` —
   * lalu `applyFeeTier` gagal dikompilasi ketika mencoba menyetel 0.6 atau 2.
   */
  const [totalSwapFee, setTotalSwapFee] = useState<number>(FEE_TIERS.standard.fee);
  /** Streamed to the creator on every swap — the reason no free token allocation is needed. */
  const [creatorCut, setCreatorCut] = useState<number>(FEE_TIERS.standard.creator);
  const [treasuryCut, setTreasuryCut] = useState<number>(FEE_TIERS.standard.cut);
  /** Harga native USD, untuk menampilkan market cap buka yang sama di tiap chain. */
  const [nativeUsd, setNativeUsd] = useState<Record<string, number>>({});
  const [customSubdomain, setCustomSubdomain] = useState("aquant");
  const [agentPersona, setAgentPersona] = useState(DEFAULT_PERSONA);
  /**
   * Pitch dan tautan publik milik pasar ini. Semuanya OPSIONAL.
   *
   * Tidak satu pun ikut membentuk calldata: `deployTrinity` tidak menerimanya, jadi
   * mengubahnya tidak mengubah apa pun yang di-deploy. Yang berubah hanya baris registry
   * dan apa yang tampil di halaman pasar. Pembersihannya (skema URL, panjang, bentuk
   * handle) dikerjakan registry di server — layar ini tidak boleh menjadi satu-satunya
   * penjaga, karena siapa pun bisa memanggil `/api/deploy` tanpa melewatinya.
   */
  const [description, setDescription] = useState("");
  const [linkWebsite, setLinkWebsite] = useState("");
  const [linkGithub, setLinkGithub] = useState("");
  const [linkX, setLinkX] = useState("");
  const [linkDocs, setLinkDocs] = useState("");
  const [selectedModel, setSelectedModel] = useState("glm-5.3");

  /**
   * ERC-8004 agent identity to bind at launch.
   *
   * Off by default, and that is the whole reason the launch keeps its
   * one-transaction, gas-only shape: binding an identity requires the creator to
   * have registered an agent in the Identity Registry first, which is a separate
   * transaction against a contract that is not ours.
   *
   * `agentId` is kept as a string because it is typed, and because "" and "0" are
   * different things here — agent 0 is a real agent somebody owns on every chain we
   * launch on, so an empty field must not collapse into id 0.
   *
   * The id is stored PER CHAIN, keyed by chainId, and not as one shared value.
   * The Identity Registry lives at the same address on all four mainnets, which
   * makes a single global id look right, but each registry keeps its own state:
   * `ownerOf(0)` returns three different owners across the four chains. Our own
   * registrations came back 84622 on Base, 1457 on Arbitrum, 3545431 on 0G and
   * 10247 on Monad. Sharing one id across a four-chain launch therefore binds on
   * the chain it came from and reverts on the rest with
   * "Factory: agent not owned by caller" — after the user has paid gas for each.
   */
  const [agentBinding, setAgentBinding] = useState<{ enabled: boolean; agentIds: Record<number, string> }>({
    enabled: false,
    agentIds: {},
  });
  /**
   * Result of checking, on-chain, that the connected wallet owns that agent —
   * one result per chain, because ownership is a per-chain fact.
   */
  type AgentCheck = {
    state: "idle" | "checking" | "owned" | "not-owned" | "missing" | "error";
    detail?: string;
  };
  const [agentChecks, setAgentChecks] = useState<Record<number, AgentCheck>>({});
  /**
   * Cache kepemilikan agent, dikunci `chainId:agentId:wallet`.
   *
   * `useRef` dan bukan state: isinya tidak boleh memicu render, dan ia hanya perlu
   * hidup selama halaman terbuka. Ketiga bagian kuncinya wajib ada — mengganti wallet
   * atau agentId mengubah jawabannya, jadi kunci yang lebih pendek akan menampilkan
   * jawaban milik orang lain.
   */
  const agentCacheRef = useRef<Map<string, AgentCheck>>(new Map());

  /** Dropdown model: terbuka/tertutup, plus ref untuk mendeteksi klik di luarnya. */
  const [modelOpen, setModelOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);

  const liveChains = CHAIN_LIST.filter((c) => c.dexLive);
  const offlineChains = CHAIN_LIST.filter((c) => !c.dexLive);

  /**
   * SATU chain per peluncuran, dipilih seperti radio.
   *
   * Dulu keempat chain menyala secara default dan tombolnya multi-select. Yang
   * dihasilkan: creator yang tidak berpikir panjang meluncurkan ke empat chain
   * sekaligus dan mendapat EMPAT pasar tipis, bukan satu yang layak. Karena tidak ada
   * bridge, keempatnya adalah pasar terpisah dengan harga yang bergerak sendiri-
   * sendiri — jadi likuiditas yang sudah kecil terbelah empat, dan angka harga yang
   * berbeda-beda membuat pembacanya menyangka ada yang rusak.
   *
   * Tetap disimpan sebagai array, bukan number tunggal, karena seluruh jalur
   * peluncuran di bawah bekerja per chain dalam loop dan melaporkan hasilnya per
   * chain. Mengubahnya jadi skalar akan memaksa perubahan di banyak tempat tanpa
   * menambah kejelasan; yang berubah hanya isinya selalu tepat satu.
   *
   * Meluncurkan ke chain lain tetap bisa — sebagai peluncuran TERPISAH, satu per satu,
   * dengan keputusan sadar tiap kali.
   */
  const [targetChainIds, setTargetChainIds] = useState<number[]>(
    liveChains.length > 0 ? [liveChains[0].chainId] : []
  );

  // ── gating + results ─────────────────────────────────────────────────────
  const [ticker, setTicker] = useState<TickerState>({ checking: false, perChain: [], error: null });
  const [attestation, setAttestation] = useState<{ signature: string; message: string; signer: string } | null>(null);
  const [attesting, setAttesting] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [results, setResults] = useState<ChainResult[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);

  /**
   * Express = nama, ticker, gambar, lalu satu tombol. Advanced = formulir lima langkah.
   *
   * Bawaannya Advanced supaya perilaku halaman dan setiap harness audit yang menunjuk formulir
   * lima langkah tidak berubah; Express dibuka lewat tombol di atas formulir atau tautan
   * `?mode=express`. Keduanya memakai state yang SAMA — beralih mode tidak membuang isian.
   */
  const [mode, setMode] = useState<StudioMode>("advanced");
  const [linkCopied, setLinkCopied] = useState(false);

  const enterMode = (next: StudioMode) => {
    setMode(next);
    if (next === "express") setAgentPersona((p) => (p === DEFAULT_PERSONA ? EXPRESS_PERSONA : p));
    // Mode ikut di URL supaya muat ulang tidak melempar creator kembali ke formulir panjang.
    try {
      const url = new URL(window.location.href);
      if (next === "express") url.searchParams.set("mode", "express");
      else url.searchParams.delete("mode");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // Tanpa URL yang bisa ditulis, mode tetap berlaku untuk sesi ini.
    }
  };

  /**
   * Prefill dari query, sekali saat dimuat. Dibaca dari `window.location`, bukan
   * `useSearchParams`, supaya halaman ini tidak butuh batas Suspense hanya untuk empat kunci.
   *
   * Tautan Express TANPA nama/ticker mengosongkan contoh "Aegis Quant AI / AQUANT": orang yang
   * datang untuk meluncurkan tokennya sendiri tidak boleh mendapati ticker demo terisi dan
   * satu klik dari mainnet.
   */
  useEffect(() => {
    const p = parseStudioPrefill(window.location.search, liveChains);
    if (p.mode === "express") {
      setMode("express");
      setAgentPersona((cur) => (cur === DEFAULT_PERSONA ? EXPRESS_PERSONA : cur));
      if (!p.name) setTokenName("");
      if (!p.symbol) {
        setTokenTicker("");
        setCustomSubdomain("");
      }
    }
    if (p.name) setTokenName(p.name);
    if (p.symbol) {
      setTokenTicker(p.symbol);
      setCustomSubdomain(p.symbol.toLowerCase());
    }
    if (p.chainId) setTargetChainIds([p.chainId]);
    // Sekali saja: prefill adalah titik awal, bukan sinkronisasi dua arah dengan URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const supplyNumber = Number(tokenSupply.replace(/[^0-9]/g, "")) || 0;

  /**
   * Jumlah native untuk market cap buka, HANYA untuk ilustrasi di layar.
   *
   * Angka yang benar-benar masuk calldata datang dari server saat prepare. Di
   * sini dipakai harga live yang sama supaya yang ditampilkan cocok dengan yang
   * akan terjadi; `defaultVirtualNative` dipakai kalau feed harga belum termuat,
   * dan itu memang cuma cadangan tampilan.
   */
  const virtualNativeFor = (chain: ChainInfo) => {
    const price = nativeUsd[chain.nativeSymbol];
    if (!price || price <= 0) return chain.defaultVirtualNative;
    return openingVirtualNative(price);
  };
  /**
   * Chain used for the illustrative opening price. Prefers the first chain that
   * will actually launch, so the number shown matches what the user is about to do.
   */
  const primaryChain: ChainInfo =
    liveChains.find((c) => targetChainIds.includes(c.chainId)) ?? liveChains[0] ?? CHAIN_LIST[0];

  // Attestation is bound to the address, so changing accounts invalidates it.
  useEffect(() => {
    if (attestation && attestation.signer.toLowerCase() !== (address ?? "").toLowerCase()) setAttestation(null);
  }, [address, attestation]);

  useEffect(() => {
    let alive = true;
    fetch("/api/prices")
      .then((r) => r.json())
      .then((d) => {
        if (alive && d?.prices) setNativeUsd(d.prices);
      })
      .catch(() => {
        // Ilustrasi jatuh ke defaultVirtualNative; calldata tetap menunggu server.
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Kaki fee protokol per chain, DIBACA dari factory lewat GET /api/deploy.
   *
   * Tidak ditulis sebagai konstanta di sini karena angkanya bukan milik halaman ini:
   * ia `PROTOCOL_FEE_BPS` di factory, dipungut DI ATAS total yang diatur creator, dan
   * berbeda antar chain selama rollout-nya bertahap. Menulis "+0.10%" di layar akan
   * berbohong di chain yang factory-nya masih 0.10.0; menulis "0.30% total" akan
   * berbohong begitu chain-nya naik. Membaca dari chain menghapus pilihan itu.
   *
   * Kosong berarti belum terbaca, dan panelnya menampilkan tiga kaki seperti sebelumnya
   * — bukan menebak kaki keempat yang mungkin tidak ada.
   */
  const [protocolFeeBpsByChain, setProtocolFeeBpsByChain] = useState<Record<number, number>>({});
  /**
   * Apakah kaki protokol chain itu dipotong DARI DALAM total yang dikonfigurasi.
   *
   * Dibaca dari server, bukan disimpulkan dari string versi di sini. Angka ini menentukan
   * apakah `depthCut` harus menyisihkan ruang untuk kaki protokol, dan server memakai
   * jawaban yang sama untuk menyusun `lpFeeBps` yang masuk calldata. Dua penalaran
   * terpisah atas hal yang sama adalah cara paling mudah membuat layar dan calldata
   * berselisih — dan selisih itu tersimpan permanen, karena tiap kaki `immutable`.
   */
  const [protocolCarvedByChain, setProtocolCarvedByChain] = useState<Record<number, boolean>>({});

  useEffect(() => {
    let alive = true;
    fetch("/api/deploy")
      .then((r) => r.json())
      .then((d) => {
        if (!alive || !Array.isArray(d?.factories)) return;
        const map: Record<number, number> = {};
        const carved: Record<number, boolean> = {};
        for (const f of d.factories) {
          if (!Number.isFinite(Number(f?.chainId))) continue;
          map[Number(f.chainId)] = Number(f?.protocolFeeBps ?? 0);
          carved[Number(f.chainId)] = Boolean(f?.protocolLegCarvedOut);
        }
        setProtocolFeeBpsByChain(map);
        setProtocolCarvedByChain(carved);
      })
      .catch(() => {
        // Tidak terbaca: panel tetap menampilkan kaki yang diketahui pasti.
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Ketersediaan ticker, diambil untuk SELURUH chain hidup sekaligus.
   *
   * `targetChainIds` sengaja TIDAK ada di daftar dependensi, dan itu inti perbaikannya.
   * Dulu ia ada di sana, jadi setiap klik chain menjatuhkan panel ke status "checking"
   * lalu menunggu debounce 450 ms ditambah satu perjalanan jaringan — sekitar 0,7 detik
   * diam per klik, yang terbaca sebagai UI melamun padahal tidak ada yang dikerjakan.
   * Debounce itu memang perlu, tapi untuk KETIKAN, bukan untuk klik. Mengetik
   * menghasilkan satu event per huruf; memilih chain adalah satu tindakan diskret yang
   * jawabannya sudah kita punya.
   *
   * Mengambil keempat chain sekaligus tidak lebih mahal: GET /api/deploy menjawab dari
   * registry di memori tanpa satu pun panggilan RPC, dan diukur di produksi 4 chain
   * sama cepatnya dengan 1. Jadi berganti chain sekarang nol jaringan.
   *
   * Bonusnya memperbaiki bug diam: tombol chain menandai chain yang tickernya sudah
   * terpakai lewat `blockedChainIds`, tapi dulu hanya chain TERPILIH yang pernah
   * diambil — jadi chain lain tidak pernah bisa tampil tertanda sebelum diklik.
   */
  /**
   * Menutup dropdown model lewat klik di luar dan Escape.
   *
   * `<select>` native memberi keduanya gratis; penggantinya harus memasangnya sendiri,
   * dan tanpa ini menu akan menggantung terbuka sampai ada yang memilih sesuatu.
   * Escape dipasang di window, bukan hanya di listbox, supaya tetap bekerja walau fokus
   * sudah pindah ke tempat lain.
   */
  useEffect(() => {
    if (!modelOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!modelMenuRef.current?.contains(e.target as Node)) setModelOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModelOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("touchstart", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("touchstart", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [modelOpen]);

  const liveChainIdsKey = liveChains.map((c) => c.chainId).join(",");
  useEffect(() => {
    const symbol = tokenTicker.trim().toUpperCase();
    if (!symbol) {
      setTicker({ checking: false, perChain: [], error: null });
      return;
    }
    setTicker((prev) => ({ ...prev, checking: true }));
    const handle = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ symbol, chainIds: liveChainIdsKey });
        if (address) params.set("creator", address);
        const res = await fetch(`/api/deploy?${params.toString()}`);
        const data = await res.json();
        setTicker({
          checking: false,
          perChain: Array.isArray(data.perChain) ? data.perChain : [],
          error: null,
        });
      } catch {
        setTicker({ checking: false, perChain: [], error: "Could not check ticker availability." });
      }
    }, 450);
    return () => clearTimeout(handle);
  }, [tokenTicker, address, liveChainIdsKey]);

  /**
   * Jawaban untuk chain yang SEDANG dipilih, dibaca dari peta yang sudah ada di memori.
   *
   * Diturunkan, bukan disimpan, supaya berganti chain hanya menghitung ulang — tidak
   * mengambil ulang. Ditempatkan di sini, sebelum `deploy` dan sebelum JSX, supaya satu
   * definisi ini melayani semua pemakainya.
   */
  const selectedTickerCheck = ticker.perChain.find((p) => targetChainIds.includes(p.chainId)) ?? null;
  const tickerAvailable: boolean | null =
    ticker.perChain.length === 0 ? null : selectedTickerCheck ? selectedTickerCheck.available : null;
  const tickerReason: string | null =
    selectedTickerCheck && !selectedTickerCheck.available ? selectedTickerCheck.reason : ticker.error;

  /**
   * Check agent ownership on-chain while the field is being typed.
   *
   * The factory rejects an unowned agent anyway, so this is convenience rather than
   * security — but a rejected launch costs a signature and a failed transaction per
   * chain, and finding out in the form is free. Debounced for the same reason the
   * ticker check is.
   */
  const selectedChainsKey = targetChainIds.join(",");
  const agentIdsKey = JSON.stringify(agentBinding.agentIds);
  useEffect(() => {
    if (!agentBinding.enabled) {
      setAgentChecks({});
      return;
    }
    // Every selected chain is checked against ITS OWN rpc. Checking only the
    // primary chain used to be enough to enable the button while three of four
    // chains were still guaranteed to revert.
    const targets = liveChains.filter((c) => targetChainIds.includes(c.chainId));
    const pending: Record<number, AgentCheck> = {};
    /**
     * Chain yang benar-benar perlu ditembak RPC. Sisanya dijawab dari cache.
     *
     * Kepemilikan agent tidak berubah selama (chain, agentId, wallet) sama, jadi
     * kembali ke chain yang sudah diperiksa tidak boleh menampilkan "checking" lagi —
     * itu setengah detik diam plus satu perjalanan RPC untuk jawaban yang sudah ada.
     * Bersama pengambilan ticker di atas, inilah yang membuat klik chain jadi instan.
     */
    const needsFetch: typeof targets = [];
    for (const chain of targets) {
      const raw = (agentBinding.agentIds[chain.chainId] ?? "").trim();
      if (!/^\d+$/.test(raw)) {
        pending[chain.chainId] = { state: "idle" };
        continue;
      }
      if (!address) {
        pending[chain.chainId] = { state: "error", detail: "Connect a wallet to check ownership." };
        continue;
      }
      const cached = agentCacheRef.current.get(`${chain.chainId}:${raw}:${address.toLowerCase()}`);
      if (cached) {
        pending[chain.chainId] = cached;
        continue;
      }
      pending[chain.chainId] = { state: "checking" };
      needsFetch.push(chain);
    }
    setAgentChecks(pending);
    // Tanpa yang perlu diambil, tidak ada timer yang dipasang: klik chain berakhir di sini.
    if (!address || needsFetch.length === 0) return;

    const handle = setTimeout(async () => {
      const settled = await Promise.all(
        needsFetch.map(async (chain) => {
          const raw = (agentBinding.agentIds[chain.chainId] ?? "").trim();
          if (!/^\d+$/.test(raw)) return [chain.chainId, { state: "idle" } as AgentCheck] as const;
          const result = await checkAgentOwnership(chain.rpcUrl, BigInt(raw), address);
          let check: AgentCheck;
          if (result.state === "owned") {
            check = {
              state: "owned",
              detail: result.uri ? `agentURI ${result.uri.slice(0, 28)}…` : "no agentURI set yet",
            };
          } else if (result.state === "not-owned") {
            check = { state: "not-owned", detail: `owned by ${result.owner.slice(0, 10)}…` };
          } else if (result.state === "missing") {
            check = { state: "missing", detail: `no ERC-8004 registry on ${chain.key}` };
          } else {
            check = { state: "error", detail: result.detail };
          }
          // Hasil "error" TIDAK di-cache: itu biasanya RPC yang sedang terganggu, dan
          // menyimpannya berarti kegagalan sementara jadi permanen sampai halaman dimuat
          // ulang. Sisanya adalah fakta on-chain yang stabil untuk kunci ini.
          if (check.state !== "error") {
            agentCacheRef.current.set(`${chain.chainId}:${raw}:${address.toLowerCase()}`, check);
          }
          return [chain.chainId, check] as const;
        })
      );
      // Digabung, bukan menimpa: `settled` hanya memuat chain yang baru ditembak, jadi
      // menimpa akan menghapus jawaban chain lain yang sudah terpasang dari cache.
      setAgentChecks((prev) => ({ ...prev, ...Object.fromEntries(settled) }));
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentBinding.enabled, agentIdsKey, address, selectedChainsKey]);

  /**
   * Memilih chain, bukan menoggle-nya: yang dipilih menjadi satu-satunya.
   *
   * Sebelumnya fungsi ini menambah/mengurangi dari daftar, dengan penjaga agar tidak
   * pernah kosong. Sekarang ia mengganti isi daftar, jadi keadaan "tidak ada chain
   * terpilih" tidak mungkin terjadi dan penjaga itu tidak lagi diperlukan.
   */
  const selectChain = (chainId: number) => setTargetChainIds([chainId]);

  /** Selecting a tier must move all three numbers together, or the split desyncs. */
  const applyFeeTier = (tier: FeeTier) => {
    const { fee, creator, cut } = FEE_TIERS[tier];
    setFeeTier(tier);
    setTotalSwapFee(fee);
    setCreatorCut(creator);
    setTreasuryCut(cut);
  };

  const applyPreset = (type: "quant" | "meme" | "defi") => {
    if (type === "meme") {
      setTokenName("Cyber Doge AI");
      setTokenTicker("CDOGE");
      setCustomSubdomain("cdoge");
      setTokenSupply("1,000,000,000");
      applyFeeTier("meme");
      setAgentPersona("Viral meme quant bot with aggressive auto-buyback");
      setDescription("A meme market with an auto-buyback bot behind it.");
    } else if (type === "quant") {
      setTokenName("Aegis Quant AI");
      setTokenTicker("AQUANT");
      setCustomSubdomain("aquant");
      setTokenSupply("1,000,000,000");
      applyFeeTier("standard");
      setAgentPersona("24/7 quant market maker and liquidity rebalancer");
      setDescription("A quant agent that makes markets around the clock.");
    } else {
      setTokenName("Nova Yield Protocol");
      setTokenTicker("NYIELD");
      setCustomSubdomain("novayield");
      setTokenSupply("500,000,000");
      applyFeeTier("low");
      setAgentPersona("Delta-neutral yield hedging and institutional LP routing");
      setDescription("Delta-neutral yield, hedged and routed automatically.");
    }
  };

  /**
   * Register an ERC-8004 agent from the CREATOR'S OWN WALLET, per chain.
   *
   * The wallet that registers must be the wallet that launches:
   * `AdextoFactory.deployTrinity` requires `ownerOf(agentId) == msg.sender`, so an agent
   * registered by anyone else — including us — makes the launch revert. That is why this
   * is a wallet signature and not a server action like logo generation, even though both
   * appear as one button in this panel.
   *
   * The id is read from the mint `Transfer` event rather than assumed sequential. Reading
   * `totalSupply()` afterwards would look equivalent and is not: two registrations landing
   * in the same block would both see the later number.
   */
  const [creatingAgent, setCreatingAgent] = useState<number | null>(null);

  const handleCreateAgent = async (chain: ChainInfo) => {
    if (!isConnected) {
      await connectWallet();
      return;
    }
    const symbol = tokenTicker.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(symbol)) {
      setGlobalError("Enter the ticker first — the agent's registration file names the market it serves.");
      return;
    }
    setCreatingAgent(chain.chainId);
    setGlobalError(null);
    try {
      // Built on the server: the CIDv1 helper needs `node:crypto`, and pinning needs a
      // key that must never reach the browser.
      const res = await fetch("/api/agent/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId: chain.chainId,
          symbol,
          marketName: tokenName.trim(),
          persona: agentPersona.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not build the registration file.");

      const ethereum = getActiveEip1193();
      await ensureWalletChain(ethereum, chain);
      const provider = new ethers.BrowserProvider(ethereum);
      const signer = await provider.getSigner();
      const registry = new ethers.Contract(
        data.registry,
        [
          "function register(string agentURI) returns (uint256)",
          "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
        ],
        signer
      );

      const tx = await registry.register(data.uri);
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) throw new Error("The registration transaction reverted.");

      const iface = new ethers.Interface([
        "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
      ]);
      let newId: bigint | null = null;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "Transfer" && parsed.args.from === ethers.ZeroAddress) {
            newId = parsed.args.tokenId as bigint;
          }
        } catch {
          // not the registry's event
        }
      }
      if (newId === null) {
        /**
         * The transaction succeeded but we cannot name the id, so the field stays empty
         * rather than being filled with a guess. An agent bound by a wrong id is permanent,
         * and the creator can still read the id from the explorer link below.
         */
        throw new Error(
          `Registered in ${tx.hash} but the mint event could not be read, so the id is unknown. ` +
            `Open the transaction on ${chain.blockExplorer} and paste the token id manually.`
        );
      }

      setAgentBinding((p) => ({
        ...p,
        enabled: true,
        agentIds: { ...p.agentIds, [chain.chainId]: String(newId) },
      }));
    } catch (e) {
      setGlobalError(describeTxError(e));
    } finally {
      setCreatingAgent(null);
    }
  };

  /**
   * Minta tanda tangan attestation dan KEMBALIKAN hasilnya, selain menyimpannya.
   *
   * Dikembalikan karena Express menandatangani lalu langsung meluncurkan di klik yang sama:
   * `setAttestation` baru terlihat di render berikutnya, jadi `handleDeploy` di klik itu
   * akan membaca state lama (null) kalau tidak diberi nilainya langsung. Melempar bila
   * pengguna menolak, dan pemanggil yang memutuskan pesan galatnya.
   */
  const signAttestation = async () => {
    const ethereum = getActiveEip1193();
    const provider = new ethers.BrowserProvider(ethereum);
    const signer = await provider.getSigner();
    const signerAddress = await signer.getAddress();
    const message =
      `ADEXTO launch attestation\n` +
      `Deployer: ${signerAddress}\n` +
      `Ticker: ${tokenTicker.trim().toUpperCase()}\n` +
      `Timestamp: ${Date.now()}`;
    const signature = await signer.signMessage(message);
    const signed = { signature, message, signer: signerAddress };
    setAttestation(signed);
    return signed;
  };

  const handleAttest = async () => {
    if (!isConnected) {
      await connectWallet();
      return;
    }
    setAttesting(true);
    setGlobalError(null);
    try {
      await signAttestation();
    } catch (error) {
      setGlobalError(describeTxError(error));
    } finally {
      setAttesting(false);
    }
  };

  const handleGenerateLogo = async () => {
    setIsGeneratingLogo(true);
    try {
      /**
       * Prompt TIDAK dikirim dari sini lagi.
       *
       * Baris ini dulu memaksa "neon cyan and purple glow on obsidian" — palet tema
       * gelap yang sudah dicabut dari seluruh aplikasi, jadi setiap logo lahir
       * bertabrakan dengan halaman cream yang memuatnya. Prompt bawaan sekarang
       * tinggal satu, di route-nya, sehingga tema dan larangan teks tidak bisa
       * berbeda antara dua tempat.
       */
      const res = await fetch("/api/generate-logo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenName, tokenSymbol: tokenTicker }),
      });
      const data = await res.json();
      if (data.imageUrl) {
        setGeneratedLogo(data.imageUrl);
        setLogoInfo({ generated: Boolean(data.generated), note: data.note });
        setLogoSource("generated");
        setLogoError(null);
      }
    } catch (error) {
      console.warn("[adexto] logo generation failed:", error);
      setLogoInfo({ generated: false, note: "Request failed before the router answered." });
    } finally {
      setIsGeneratingLogo(false);
    }
  };

  /**
   * Unggah logo yang sudah dimiliki creator.
   *
   * KENAPA DIGAMBAR ULANG KE KANVAS, BUKAN DISIMPAN APA ADANYA
   *
   * Nilainya berakhir sebagai data URI di dalam `projects.json`, satu berkas yang di-parse
   * utuh dan dibatasi 500 pasar. Menyimpan berkas asli berarti ukuran registry ditentukan
   * oleh kamera orang lain. Digambar ulang ke {@link LOGO_PX} px membuat unggahan memakan
   * ruang yang sama dengan hasil generate, jadi tidak ada jalur yang lebih mahal dari yang
   * lain.
   *
   * KENAPA WAJIB PERSEGI, DAN KENAPA DITOLAK ALIH-ALIH DIPOTONG
   *
   * Logo dirender di dalam kotak dengan `object-contain` di studio, /explorer dan halaman
   * token. Gambar 16:9 akan tampil sebagai garis tipis dengan ruang kosong di atas dan bawah
   * — masih "berfungsi", jadi tidak ada yang melaporkannya sebagai galat, dan creator baru
   * menyadarinya setelah pasarnya terdaftar. Memotong otomatis lebih buruk lagi: ia memilih
   * bagian mana yang dibuang tanpa bertanya. Jadi ditolak di depan, dengan ukuran yang
   * terbaca supaya jelas apa yang harus diperbaiki.
   */
  const handleLogoFile = async (file: File | null) => {
    if (!file) return;
    setLogoError(null);
    setIsReadingLogo(true);
    try {
      // Pembacaan, pemeriksaan persegi, resize, dan validasi ulang hidup di
      // `@/lib/logo-upload` supaya halaman ini dan halaman pasar memakai satu aturan.
      const result = await readSquareLogoFile(file);
      if (!result.ok) {
        setLogoError(result.reason);
        return;
      }
      setGeneratedLogo(result.value);
      setLogoSource("uploaded");
      setLogoInfo(null);
    } finally {
      setIsReadingLogo(false);
      // Direset supaya memilih berkas yang SAMA lagi tetap memicu `change`.
      if (logoFileRef.current) logoFileRef.current.value = "";
    }
  };

  /** Kembali ke bawaan, sehingga Generate hidup lagi. */
  const clearUploadedLogo = () => {
    setGeneratedLogo("/logo.svg");
    setLogoSource("default");
    setLogoInfo(null);
    setLogoError(null);
  };

  // ── deploy ───────────────────────────────────────────────────────────────
  const updateResult = useCallback((chainId: number, patch: Partial<ChainResult>) => {
    setResults((prev) => prev.map((r) => (r.chainId === chainId ? { ...r, ...patch } : r)));
  }, []);

  /**
   * `att` default-nya state attestation; Express mengopernya langsung setelah menandatangani
   * (lihat `signAttestation`). Tombol Advanced WAJIB memanggil `handleDeploy()` tanpa argumen,
   * bukan `onClick={handleDeploy}` — yang kedua mengoper event klik sebagai `att`.
   */
  const handleDeploy = async (att: { signature: string; message: string; signer: string } | null = attestation) => {
    setGlobalError(null);
    if (!isConnected || !address) {
      await connectWallet();
      return;
    }
    if (!att) {
      setGlobalError("Sign the launch attestation first.");
      return;
    }
    if (supplyNumber <= 0) {
      setGlobalError("Supply must be greater than zero — the curve needs tokens to sell.");
      return;
    }
    if (supplyNumber <= 0) {
      setGlobalError("Supply must be greater than zero.");
      return;
    }

    // Launch only where the factory exists AND the ticker is free on that chain.
    // A chain whose ticker is taken is skipped rather than aborting the whole run.
    const selected = liveChains.filter((c) => targetChainIds.includes(c.chainId));
    if (selected.length === 0) {
      setGlobalError("No selected chain has a launch factory deployed, so no tradable curve can be created.");
      return;
    }

    const blockedIds = new Set(ticker.perChain.filter((p) => !p.available).map((p) => p.chainId));
    const chains = selected.filter((c) => !blockedIds.has(c.chainId));
    const skipped = selected.filter((c) => blockedIds.has(c.chainId));

    if (chains.length === 0) {
      setGlobalError(tickerReason ?? `Ticker ${tokenTicker.toUpperCase()} is not available on any selected chain.`);
      return;
    }
    if (skipped.length > 0) {
      setGlobalError(
        `Skipping ${skipped.map((c) => c.key).join(", ")}: ticker already has a market there. Launching on ${chains
          .map((c) => c.key)
          .join(", ")}.`
      );
    }

    setDeploying(true);
    setResults(
      chains.map((c) => ({ chainKey: c.key, chainName: c.name, chainId: c.chainId, status: "pending" as DeployStatus }))
    );

    const symbol = tokenTicker.trim().toUpperCase();

    // Stage 1 — anchor metadata and get the attestation root that goes in calldata.
    let attestationRoot: string;
    let daStorageTx: string | null = null;
    let lpFeeBps = Math.round(depthCut * 100);
    let treasuryBuybackBps = Math.round(treasuryCut * 100);
    const serverVirtualNative: Record<number, string> = {};
    try {
      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "prepare",
          name: tokenName,
          symbol,
          supply: String(supplyNumber),
          swapFee: totalSwapFee,
          // creatorCut WAJIB ikut: tanpa ini server tidak bisa menghitung depth
          // fee (swapFee − creator − treasury) dan akan melaporkannya kelebihan
          // sebesar bagian creator, lalu nilai salah itu ditimpa balik ke sini.
          creatorCut,
          treasuryCut,
          model: selectedModel,
          persona: agentPersona,
          // Sent so the anchored metadata records the ERC-8004 binding for THIS
          // launch. The server only describes it; the factory is what verifies it.
          bindAgent: agentBinding.enabled,
          // A map, not one value: the anchored metadata is shared by every chain in
          // the launch, and the agent's id differs on each of them.
          agentIds: agentBinding.enabled ? agentBinding.agentIds : null,
          deployer: address,
          targetChains: chains.map((c) => c.chainId),
          attestationSignature: att.signature,
          attestationMessage: att.message,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `prepare failed (${res.status})`);
      attestationRoot = data.attestationRoot;
      daStorageTx = data.daStorageTx ?? null;
      lpFeeBps = Number(data.lpFeeBps ?? lpFeeBps);
      treasuryBuybackBps = Number(data.treasuryBuybackBps ?? treasuryBuybackBps);
      // `virtualNative` DATANG DARI SERVER, dihitung dari harga native live agar
      // market cap buka sama di setiap chain. Angka di config hanya cadangan
      // tampilan; memakainya untuk calldata akan mengembalikan ketidaksetaraan
      // yang justru sedang diperbaiki.
      for (const t of (data.deployTargets ?? []) as Array<{ chainId: number; virtualNative: string }>) {
        if (t?.chainId && t?.virtualNative) serverVirtualNative[t.chainId] = t.virtualNative;
      }
      if (Object.keys(serverVirtualNative).length === 0) {
        throw new Error("server did not return an opening market cap for any chain");
      }
    } catch (error: any) {
      setGlobalError(`Preparation failed: ${error.message}`);
      setDeploying(false);
      setResults([]);
      return;
    }

    // Stage 2 — one transaction per chain. Each is independent and reported honestly.
    //
    // `virtualNative` berbeda per chain karena ia adalah market cap buka dalam aset
    // native chain itu. Nilainya diambil dari server, yang menghitungnya dari harga
    // live sehingga nilai USD-nya SAMA di keempat chain. Dulu angkanya dipaku per
    // chain, dan karena harga koin bergerak, satu ticker bisa membuka $212 di 0G
    // tapi $1.939 di Base — selisih yang tidak bisa diratakan arbitrase karena
    // tidak ada bridge.
    const argsFor = (chain: ChainInfo) =>
      [
        tokenName,
        symbol,
        BigInt(supplyNumber),
        address as string,
        ethers.parseEther(serverVirtualNative[chain.chainId]),
        BigInt(Math.round(totalSwapFee * 100)),
        BigInt(Math.round(creatorCut * 100)),
        BigInt(treasuryBuybackBps),
        attestationRoot,
        // ERC-8004 binding. Off unless the creator supplied an agent id they own,
        // which keeps the default launch at one transaction and gas only.
        //
        // The flag is separate from the id on purpose: agent 0 exists and is owned
        // on every chain we launch on, so `agentId == 0` cannot mean "no agent".
        // The factory rejects a non-zero id when the flag is false rather than
        // ignoring it, so a half-filled form fails loudly instead of quietly
        // producing a token whose agent the creator believes is attached.
        //
        // The id is read for THIS chain. It is not one shared value: each registry
        // keeps its own state, so the same agent has a different id on every chain,
        // and reusing one id across the loop reverts everywhere except its home
        // chain.
        agentBinding.enabled,
        agentBinding.enabled ? BigInt(agentBinding.agentIds[chain.chainId]) : 0n,
      ] as const;

    const ethereum = getActiveEip1193();
    const iface = new ethers.Interface(CURVE_FACTORY_ABI);

    for (const chain of chains) {
      try {
        // Public RPCs drop reads occasionally, and in a four-chain launch one flaky
        // read would otherwise cost the user a chain. The pre-flight is retried; the
        // send never is, so a transaction can never be submitted twice.
        let factory: ethers.Contract | null = null;
        let preflightError: unknown = null;

        for (let attempt = 1; attempt <= 3 && !factory; attempt++) {
          try {
            updateResult(chain.chainId, {
              status: "signing",
              message: attempt === 1 ? `Switching wallet to ${chain.name}…` : `Retrying ${chain.name} (${attempt}/3)…`,
            });
            await ensureWalletChain(ethereum, chain);

            const provider = new ethers.BrowserProvider(ethereum);
            const signer = await provider.getSigner();
            const candidate = new ethers.Contract(chain.curveFactoryAddress as string, CURVE_FACTORY_ABI, signer);

            // Simulate first: a revert here costs nothing and gives the real reason.
            // Sama seperti di use-sovereign-swap: yang ditulis TUJUANNYA, bukan nama
            // tekniknya. "Simulating launch…" terbaca seperti peluncuran pura-pura,
            // padahal yang terjadi adalah pemeriksaan agar revert tidak membuang gas.
            updateResult(chain.chainId, { message: "Checking the launch would succeed…" });
            await candidate.deployTrinity.staticCall(...argsFor(chain));
            factory = candidate;
          } catch (error) {
            preflightError = error;
            if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 3000));
          }
        }

        if (!factory) throw preflightError;

        updateResult(chain.chainId, { message: "Confirm in your wallet…" });
        // No `value`: a launch costs gas only.
        const tx = await factory.deployTrinity(...argsFor(chain));
        updateResult(chain.chainId, { status: "confirming", txHash: tx.hash, message: "Waiting for confirmation…" });

        const receipt = await tx.wait();
        if (!receipt || receipt.status !== 1) throw new Error("Transaction reverted on-chain.");

        // Read the real addresses out of the receipt.
        let tokenAddress: string | undefined;
        let poolAddress: string | undefined;
        for (const log of receipt.logs) {
          try {
            const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
            if (parsed?.name === "TrinityProjectDeployed") {
              tokenAddress = parsed.args.token;
              // `curve`, BUKAN `pool`. Event-nya menamai argumen kedua `curve`
              // (lihat CURVE_FACTORY_ABI), jadi `parsed.args.pool` selalu
              // undefined — alamat kurva hilang dari layar "registering" dan,
              // bila server kebetulan tidak mengembalikannya, dari laporan akhir
              // juga. `/api/deploy` sudah membaca `curve ?? pool`; ini menyusul.
              poolAddress = parsed.args.curve ?? parsed.args.pool;
              break;
            }
          } catch {
            // not a factory event
          }
        }
        if (!tokenAddress) throw new Error("Receipt did not contain TrinityProjectDeployed.");

        updateResult(chain.chainId, {
          status: "registering",
          tokenAddress,
          poolAddress,
          message: "Verifying on-chain and registering…",
        });

        const confirmRes = await fetch("/api/deploy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stage: "confirm",
            chainId: chain.chainId,
            txHash: receipt.hash,
            name: tokenName,
            symbol,
            supply: String(supplyNumber),
            lpFeeBps,
            treasuryBuybackBps,
            creator: address,
            persona: agentPersona,
            agentModel: `0G Router (${selectedModel})`,
            image: generatedLogo ?? "/logo.svg",
            category,
            // Dikirim apa adanya; server yang membersihkan. Lihat catatan pada state-nya.
            description: description.trim() || null,
            website: linkWebsite.trim() || null,
            github: linkGithub.trim() || null,
            x: linkX.trim() || null,
            docs: linkDocs.trim() || null,
            attestationRoot,
            daStorageTx,
            targetChainIds: chains.map((c) => c.chainId),
          }),
        });
        const confirmData = await confirmRes.json();
        if (!confirmRes.ok) throw new Error(confirmData.error || `registration failed (${confirmRes.status})`);

        updateResult(chain.chainId, {
          status: "success",
          message: confirmData.message,
          explorerTx: confirmData.deployment?.explorerTx,
          poolAddress: confirmData.project?.poolAddress ?? poolAddress,
        });
      } catch (error) {
        // Keep the raw error in the console: the human-readable mapping is for the
        // UI, but diagnosing a chain-specific failure needs the original payload.
        console.error(`[adexto] launch failed on ${chain.name} (${chain.chainId}):`, error);
        updateResult(chain.chainId, { status: "failed", message: describeTxError(error) });
      }
    }

    setDeploying(false);
  };

  /**
   * Satu tombol Express: sambungkan dompet, tandatangani attestation bila belum ada (atau
   * sudah mendekati kedaluwarsa 30 menit di server, atau milik alamat lain), lalu luncurkan
   * dengan jalur yang sama persis dengan Advanced. Tidak ada jalur deploy kedua.
   *
   * Setelah connect, fungsi ini BERHENTI: `isConnected`/`address` baru terbaca di render
   * berikutnya, jadi melanjutkan di closure yang sama akan meluncurkan tanpa alamat. Label
   * tombol berganti dan klik kedua melanjutkan.
   */
  const handleExpressLaunch = async () => {
    setGlobalError(null);
    if (!isConnected || !address) {
      await connectWallet();
      return;
    }
    let att = attestation;
    const stale =
      !att ||
      att.signer.toLowerCase() !== address.toLowerCase() ||
      attestationAge(att.message) > ATTESTATION_REFRESH_MS;
    if (stale) {
      setAttesting(true);
      try {
        att = await signAttestation();
      } catch (error) {
        setGlobalError(describeTxError(error));
        return;
      } finally {
        setAttesting(false);
      }
    }
    await handleDeploy(att);
  };

  /** Tautan yang membuka Studio di Express dengan nama, ticker dan chain ini. */
  const copyPrefillLink = async () => {
    const origin = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
    const url = buildStudioPrefillUrl(origin, { name: tokenName, symbol: tokenTicker, chainId: targetChainIds[0] ?? null });
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    } catch {
      setLinkCopied(false);
    }
  };

  // ── AI co-pilot ──────────────────────────────────────────────────────────
  const [inputMessage, setInputMessage] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  /**
   * Progres fase berpikir model, atau null kalau tidak sedang berpikir.
   *
   * Indikator lama hanya spinner dengan teks tetap "Reasoning on 0G…". Karena model
   * menghabiskan sebagian besar waktu di kanal reasoning yang tidak ditampilkan,
   * spinner itu berputar puluhan detik tanpa satu pun perubahan di layar — dan
   * spinner yang tidak berubah tidak bisa dibedakan dari aplikasi yang menggantung.
   */
  const [thinking, setThinking] = useState<ChatReasoningProgress | null>(null);
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([
      {
        role: "assistant",
        content:
          `⚡ **ADEXTO Studio**\n\n` +
          `• Model: **0G Router (${selectedModel})**\n` +
          `• Factory: **${CURVE_FACTORY_GENERATION.contract} ${CURVE_FACTORY_GENERATION.version}** (token + bonding curve in one transaction, no liquidity deposit)\n` +
          `• Live chains: **${liveChains.length > 0 ? liveChains.map((c) => c.key).join(", ") : "none yet"}**\n\n` +
          `Describe your concept, or configure the launch on the left.`,
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, chatLoading]);

  const sendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!inputMessage.trim() || chatLoading) return;

    const next = [...messages, { role: "user" as const, content: inputMessage }];
    setMessages(next);
    setInputMessage("");
    setChatLoading(true);
    setThinking(null);
    // Gelembung asisten dipasang SEBELUM permintaan, supaya jalur galat mengisi
    // gelembung yang sama alih-alih menambah satu lagi di bawahnya.
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
    try {
      await streamChat(
        { messages: next, model: selectedModel },
        {
          onReasoning: (progress) => setThinking(progress),
          onContent: (full) => {
            // Begitu jawaban mulai masuk, indikator berpikir harus hilang: menampilkan
            // keduanya sekaligus membuat pembaca menyangka reasoning bagian dari jawaban.
            setThinking(null);
            setMessages((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = { role: "assistant", content: full };
              return copy;
            });
          },
        }
      );
    } catch (error: any) {
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: `0G Compute error: ${error.message}` };
        return copy;
      });
    } finally {
      setThinking(null);
      setChatLoading(false);
    }
  };

  const successes = results.filter((r) => r.status === "success");
  const failures = results.filter((r) => r.status === "failed");
  const finished = results.length > 0 && !deploying;
  // Chains that will actually be launched on: factory present, selected, and the
  // ticker still free there.
  const blockedChainIds = new Set(ticker.perChain.filter((p) => !p.available).map((p) => p.chainId));
  const launchTargets = liveChains.filter((c) => targetChainIds.includes(c.chainId) && !blockedChainIds.has(c.chainId));
  const skippedTargets = liveChains.filter((c) => targetChainIds.includes(c.chainId) && blockedChainIds.has(c.chainId));

  // No seed to validate any more: a launch needs supply, a signed attestation and
  // at least one chain that is not already using this ticker.
  /**
   * When agent binding is switched on, the id has to be one the wallet actually
   * owns. The factory enforces it, so this only decides whether the button lets the
   * user pay for a transaction that is already known to revert.
   *
   * Every chain being launched on needs its OWN owned id, not just the primary
   * one, because the binding is checked per chain by that chain's own registry.
   */
  const agentBindingSatisfied =
    !agentBinding.enabled ||
    (launchTargets.length > 0 && launchTargets.every((c) => agentChecks[c.chainId]?.state === "owned"));
  const canDeploy =
    isConnected &&
    Boolean(attestation) &&
    agentBindingSatisfied &&
    supplyNumber > 0 &&
    liveChains.length > 0 &&
    launchTargets.length > 0;

  /**
   * Kaki protokol untuk chain yang BENAR-BENAR dituju, diambil yang tertinggi.
   *
   * Yang tertinggi, bukan rata-rata: angka ini dipakai untuk memberi tahu creator
   * berapa yang dibayar trader, dan meratakan dua chain yang tarifnya berbeda
   * menghasilkan angka yang tidak berlaku di chain mana pun. Server memakai aturan
   * yang sama untuk `totalPaidBps`, jadi layar dan calldata tidak berselisih.
   *
   * Nol berarti tidak ada chain tujuan yang memungut kaki protokol — keadaan sekarang,
   * dan panel di bawah lalu menampilkan tiga kaki saja.
   */
  const protocolCut =
    launchTargets.reduce((max, c) => Math.max(max, protocolFeeBpsByChain[c.chainId] ?? 0), 0) / 100;
  /**
   * Apakah SEMUA chain tujuan memotong kaki protokol dari dalam total.
   *
   * `every`, bukan `some`, dan defaultnya false lewat `length > 0`. Kalau ada satu chain
   * yang masih aditif, layar harus memakai aritmetika aditif — angka yang lebih besar —
   * karena itulah yang benar-benar dibayar trader di chain tersebut. Menampilkan total
   * yang lebih kecil akan mengecilkan biaya yang sebenarnya, arah kesalahan yang paling
   * tidak boleh diambil di halaman yang mengutip harga.
   *
   * `/api/deploy` menolak campuran generasi saat peluncuran, jadi keadaan campuran tidak
   * bisa berakhir sebagai transaksi. Layar tetap harus jujur selama campuran itu terpilih.
   */
  const protocolCarvedOut =
    launchTargets.length > 0 && launchTargets.every((c) => protocolCarvedByChain[c.chainId] === true);
  /**
   * Yang benar-benar keluar dari dompet trader. SEJAK 0.12.0 INI SAMA DENGAN
   * `totalSwapFee`, karena kaki protokol dipotong dari dalamnya alih-alih ditambahkan.
   *
   * Dibiarkan sebagai variabel tersendiri dan bukan diganti `totalSwapFee` di semua
   * pemakaiannya: ia dipakai sebagai PEMBAGI untuk lebar keempat segmen bar fee di bawah,
   * dan sebuah pembagi yang bernama "total yang dibayar" menjelaskan kenapa segmen-segmen
   * itu berjumlah 100% lebar. Menggantinya dengan `totalSwapFee` akan membuat baris-baris
   * itu terbaca seperti kebetulan.
   */
  const totalPaidPct = totalSwapFee + (protocolCarvedOut ? 0 : protocolCut);
  /**
   * Depth adalah SISA setelah tiga kaki bernama, dan sejak 0.12.0 kaki protokol adalah
   * salah satunya.
   *
   * Sukunya BERSYARAT, bukan selalu ada: pada factory 0.11.0 kaki protokol ditagih di atas
   * total, jadi depth tidak perlu memberi ruang untuknya, dan menguranginya di sana akan
   * melaporkan depth 10 bps lebih kecil daripada yang benar-benar ter-deploy.
   *
   * Dipindahkan ke sini dari atas berkas dengan sengaja: ia sekarang bergantung pada
   * `protocolCut`, yang butuh `launchTargets`. Menaruhnya di atas akan membuatnya membaca
   * `protocolCut` sebelum variabel itu ada.
   *
   * `Math.max(0, ...)` DIPERTAHANKAN sebagai penjaga tampilan, bukan sebagai perbaikan:
   * ia menahan layar dari menampilkan depth negatif selagi creator menggeser slider. Yang
   * menolak pembagian mustahil adalah factory dan /api/deploy, bukan baris ini — dan itu
   * pembagian kerja yang benar, karena angka negatif di sini berarti calldata-nya salah.
   */
  const depthCut = Math.max(0, totalSwapFee - creatorCut - treasuryCut - (protocolCarvedOut ? protocolCut : 0));
  /** Struktur fee factory tiap chain tujuan sudah terbaca dari /api/deploy. */
  const feeLegsKnown = launchTargets.length > 0 && launchTargets.every((c) => c.chainId in protocolCarvedByChain);

  // ── Express ──────────────────────────────────────────────────────────────
  /**
   * Gerbang tombol Express: sama dengan `canDeploy`, minus attestation (ditandatangani di klik
   * itu sendiri) dan minus koneksi (tombolnya yang menyambungkan). Ditambah nama, ticker, dan
   * pemeriksaan ticker yang sudah selesai: di Express tidak ada langkah lain tempat creator
   * akan melihat bahwa tickernya ternyata terpakai.
   */
  const expressReady =
    Boolean(tokenName.trim()) &&
    Boolean(tokenTicker.trim()) &&
    !ticker.checking &&
    agentBindingSatisfied &&
    supplyNumber > 0 &&
    liveChains.length > 0 &&
    launchTargets.length > 0;

  const expressLabel = deploying
    ? "Deploying…"
    : attesting
    ? "Sign in your wallet…"
    : liveChains.length === 0
    ? "Factory not deployed yet"
    : !isConnected
    ? "Connect wallet"
    : !tokenName.trim()
    ? "Enter a name"
    : !tokenTicker.trim()
    ? "Enter a ticker"
    : ticker.checking
    ? "Checking the ticker…"
    : launchTargets.length === 0
    ? "Choose an available ticker"
    : !agentBindingSatisfied
    ? "Agent id needed, see Advanced"
    : supplyNumber <= 0
    ? "Set a supply in Advanced"
    : `Launch on ${launchTargets[0]?.key ?? "—"} · gas only`;

  /**
   * Pilihan mode sebagai dua kartu, bukan sakelar kecil.
   *
   * Sakelar 11px di pojok membuat Express — jalan tersingkat untuk orang yang baru mencoba —
   * nyaris tak terlihat, padahal itu keputusan pertama di halaman ini. `data-testid` dan
   * `aria-pressed` dipertahankan: probe dan harness menunjuk keduanya.
   */
  const modeToggle = (
    <div role="group" aria-label="Launch mode" className="grid grid-cols-2 gap-2">
      {(
        [
          ["express", "Express", Zap, "Name, ticker, image — then one button."],
          ["advanced", "Advanced", SlidersHorizontal, "Every setting, in five steps."],
        ] as const
      ).map(([m, label, Icon, blurb]) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => enterMode(m)}
          data-testid={`mode-${m}`}
          className={`group flex items-start gap-2.5 rounded-xl border p-3 text-left transition-[border-color,background-color,box-shadow] duration-200 ${
            mode === m
              ? "border-accent/50 bg-accent-soft shadow-[var(--glow-accent)]"
              : "border-line bg-cream-2 hover:border-accent/30"
          }`}
        >
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              mode === m ? "bg-accent text-white" : "bg-surface text-accent"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-bold text-ink">{label}</span>
            <span className="block text-[11px] leading-snug text-ink-soft">{blurb}</span>
          </span>
        </button>
      ))}
    </div>
  );

  const expressPanel = (
    <div className="space-y-3" data-testid="express-launch">
      <div className="space-y-3 rounded-xl border border-accent/30 bg-accent-soft p-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Launch in one step</h2>
          <p className="text-[11px] leading-relaxed text-ink-soft">
            Name, ticker and an image. Everything else uses the settings listed below, and Advanced changes any of them
            without losing what you typed here.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <Field label="Name">
            <input
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              maxLength={64}
              placeholder="e.g. Orbit Cat"
              aria-label="Token name"
              data-testid="express-name"
              className={`${FIELD_CLASS} font-semibold`}
            />
          </Field>
          <Field
            label="Ticker"
            hint={
              !tokenTicker.trim()
                ? "letters and digits, up to 12"
                : ticker.checking
                ? "checking…"
                : launchTargets.length > 0
                ? `available on ${launchTargets.map((c) => c.key).join(", ")}`
                : tickerAvailable === false
                ? tickerReason ?? "unavailable"
                : undefined
            }
            hintTone={launchTargets.length > 0 && tokenTicker.trim() ? "ok" : tickerAvailable === false ? "error" : "muted"}
          >
            <input
              value={tokenTicker}
              onChange={(e) => {
                const value = sanitizeSymbol(e.target.value);
                setTokenTicker(value);
                setCustomSubdomain(value.toLowerCase());
              }}
              placeholder="ORBIT"
              aria-label="Ticker"
              data-testid="express-ticker"
              className={`${FIELD_CLASS} font-mono font-bold text-accent ${tickerAvailable === false ? "border-danger" : ""}`}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-2.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-accent/30 bg-cream-2 p-1">
            <img src={generatedLogo ?? "/logo.svg"} alt="Token image preview" className="h-full w-full object-contain" />
          </div>
          {/* min-w supaya di layar sempit tombol turun ke baris baru, bukan menjepit teks ini
              jadi kolom empat baris. */}
          <div className="min-w-[9rem] flex-1">
            <div className="text-[11px] font-bold text-ink">Image</div>
            <span className="text-[10px] text-ink-soft">
              {logoSource === "uploaded"
                ? `Your image, resized to ${LOGO_PX}×${LOGO_PX}`
                : logoSource === "generated"
                ? logoInfo?.generated
                  ? "Rendered on the 0G router"
                  : "Placeholder emblem: the router did not return an image"
                : logoSource === "preset"
                ? "ADEXTO robot preset"
                : "A square image of your own, or generate one"}
            </span>
          </div>
          {/* Input tersembunyi yang sama dengan Advanced (satu ref): hanya satu mode yang dirender. */}
          <input
            ref={logoFileRef}
            type="file"
            accept={ACCEPT_ATTR}
            className="hidden"
            onChange={(e) => handleLogoFile(e.target.files?.[0] ?? null)}
          />
          <div className="flex items-center gap-1.5">
            {logoSource === "uploaded" && (
              <button
                type="button"
                onClick={clearUploadedLogo}
                className="flex items-center gap-1.5 rounded-lg border border-line bg-cream-2 px-3 py-1.5 text-xs font-bold text-ink-soft"
              >
                <XCircle className="h-3 w-3" /> Remove
              </button>
            )}
            <button
              type="button"
              onClick={() => logoFileRef.current?.click()}
              disabled={isReadingLogo}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-cream-2 px-3 py-1.5 text-xs font-bold text-ink disabled:opacity-50"
            >
              {isReadingLogo ? <RefreshCw className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}
              {logoSource === "uploaded" ? "Replace" : "Upload"}
            </button>
            <button
              type="button"
              onClick={handleGenerateLogo}
              disabled={isGeneratingLogo || logoSource === "uploaded" || !tokenName.trim()}
              title={
                logoSource === "uploaded"
                  ? "Your own image is in use. Remove it to generate one instead."
                  : !tokenName.trim()
                  ? "Enter a name first: the image is drawn from it."
                  : undefined
              }
              className="flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent-soft px-3 py-1.5 text-xs font-bold text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isGeneratingLogo ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
              {isGeneratingLogo ? "Rendering…" : "Generate"}
            </button>
          </div>
        </div>
        {logoError && <p className="text-[10px] text-danger">{logoError}</p>}

        <div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-ink-soft">Chain</div>
          <div role="radiogroup" aria-label="Launch chain" className="grid grid-cols-2 gap-1.5 text-[11px] sm:grid-cols-4">
            {liveChains.map((chain) => {
              const selected = targetChainIds.includes(chain.chainId);
              const taken = blockedChainIds.has(chain.chainId);
              return (
                <button
                  key={chain.chainId}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => selectChain(chain.chainId)}
                  title={taken ? `${chain.name} · this ticker already has a market here` : chain.name}
                  className={`flex items-center justify-between rounded-lg border p-2 text-left transition-all ${
                    selected ? "border-accent/60 bg-surface text-ink shadow-[var(--glow-accent)]" : "border-line bg-cream-2 text-ink-soft"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {selected ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-accent" />
                    ) : (
                      <span className="h-3.5 w-3.5 shrink-0 rounded border border-line" />
                    )}
                    <span className="truncate font-bold">{chain.key}</span>
                  </span>
                  {taken && <XCircle className="h-3 w-3 shrink-0 text-danger" aria-label="ticker taken here" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-surface" data-testid="express-settings">
        <div className="flex items-center justify-between gap-2 border-b border-line bg-cream-2 px-3 py-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink">Settings used</span>
          <button type="button" onClick={() => enterMode("advanced")} className="text-[10px] font-semibold text-accent hover:underline">
            Change in Advanced
          </button>
        </div>
        <dl className="grid grid-cols-1 gap-px bg-cream-3 text-[11px] sm:grid-cols-2">
          <div className="bg-surface px-3 py-2">
            <dt className="text-[9px] uppercase tracking-wider text-ink-faint">Fee per trade</dt>
            <dd className="mt-0.5 font-medium text-ink" data-testid="express-fee">
              {totalPaidPct.toFixed(2)}% · {creatorCut.toFixed(2)}% of it to you
            </dd>
          </div>
          <div className="bg-surface px-3 py-2">
            <dt className="text-[9px] uppercase tracking-wider text-ink-faint">Supply</dt>
            <dd className="mt-0.5 font-medium text-ink">
              {supplyNumber.toLocaleString("en-US")} · all in the curve, none to you
            </dd>
          </div>
          <div className="bg-surface px-3 py-2">
            <dt className="text-[9px] uppercase tracking-wider text-ink-faint">Market agent</dt>
            <dd className="mt-0.5 truncate font-medium text-ink" title={agentPersona}>
              {agentPersona || "none"}
            </dd>
          </div>
          <div className="bg-surface px-3 py-2">
            <dt className="text-[9px] uppercase tracking-wider text-ink-faint">Agent identity (ERC-8004)</dt>
            <dd className="mt-0.5 font-medium text-ink">
              {agentBinding.enabled ? "binding on, set in Advanced" : "not bound"}
            </dd>
          </div>
        </dl>
      </div>

      <LaunchCostCard chainIds={launchTargets.map((c) => c.chainId)} traderPaysPct={totalPaidPct} creatorKeepsPct={creatorCut} />

      {globalError && (
        <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-2.5 text-[11px] text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
          <span>{globalError}</span>
        </div>
      )}

      {deploying && results.length > 0 && (
        <div className="space-y-1.5">
          {results.map((r) => (
            <ResultRow key={r.chainId} result={r} />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={handleExpressLaunch}
        disabled={deploying || attesting || (isConnected && !expressReady)}
        data-testid="express-launch-button"
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3.5 text-sm font-bold text-white shadow-lg shadow-accent/20 transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:border disabled:border-line-strong disabled:bg-cream-3 disabled:text-ink-soft disabled:shadow-none"
      >
        {deploying || attesting ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        ) : !isConnected ? (
          <Lock className="h-3.5 w-3.5" />
        ) : (
          <Zap className="h-3.5 w-3.5" />
        )}
        {expressLabel}
      </button>
      <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-ink-soft">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          Your wallet asks twice: a free signature that proves you control this address, then the launch transaction,
          which costs gas. There is no liquidity deposit.
        </span>
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
        <span className="text-[10px] leading-relaxed text-ink-faint">
          A link that opens this form with the same name, ticker and chain. Whoever opens it launches from their own
          wallet.
        </span>
        <button
          type="button"
          onClick={copyPrefillLink}
          data-testid="express-copy-link"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-ink hover:border-accent/40"
        >
          {linkCopied ? <Check className="h-3.5 w-3.5 text-ok" /> : <Link2 className="h-3.5 w-3.5" />}
          {linkCopied ? "Link copied" : "Copy launch link"}
        </button>
      </div>
    </div>
  );

  return (
    /* Halaman ini dulu dipatok setinggi viewport (`lg:h-[calc(100vh-4rem)]` +
       `lg:overflow-hidden`), sehingga formulir tujuh langkah harus digulir di dalam
       kotak sempit sementara sisa halaman diam. Sekarang halamannya menggulir biasa
       dan rel kanan yang menempel — ringkasan launch selalu terlihat tanpa
       memenjarakan formulirnya. */
    <div className="mx-auto w-full max-w-[1400px] px-3 py-5 sm:px-5">
      {/* Sambutan. Tiga janji di chip adalah fakta kontrak yang sama dengan yang dijelaskan di
          langkah-langkah di bawah (tidak payable, 100% supply ke kurva, tanpa owner) — bukan
          klaim baru, hanya diletakkan di tempat orang memutuskan untuk mulai. */}
      <div className="studio-welcome relative mb-4 overflow-hidden rounded-card border border-line p-5 sm:p-7">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 -top-32 h-80 w-80 rounded-full opacity-60 blur-3xl"
          style={{ background: "radial-gradient(closest-side, rgb(var(--accent-fill-rgb) / 0.35), transparent)" }}
        />
        <div className="relative flex items-end gap-4">
          <div className="min-w-0 flex-1">
            {/* Ponsel: maskot kecil di samping judul, pola yang sama dengan hero landing di ponsel.
                Maskot besar di kanan baru muncul mulai sm; berkasnya sama, jadi tidak ada unduhan kedua. */}
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="kicker mb-2">ADEXTO Studio</p>
                <h1 className="font-display text-[1.9rem] font-light leading-[1.08] tracking-tight text-ink sm:text-[2.6rem]">
                  Let&apos;s open your market.
                </h1>
              </div>
              <Mascot
                pose="wave"
                priority
                className="mascot-float h-[4.5rem] w-auto shrink-0 drop-shadow-[0_12px_20px_rgba(76,29,149,0.4)] sm:hidden"
              />
            </div>
            <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-ink-soft sm:text-[15px]">
              One transaction, and it trades from the first block. You pay the chain&apos;s gas and nothing else, and
              a share of every swap is yours from the first one.
            </p>
            {/* Ponsel: kisi 2×2 yang ringkas (dua baris, bukan tiga) supaya pilihan mode tetap
                terlihat tanpa menggulir jauh. */}
            <ul className="mt-4 grid grid-cols-2 gap-1.5 text-[11.5px] sm:flex sm:flex-wrap sm:gap-2 sm:text-[12px]">
              {(
                [
                  [Fuel, "Gas only"],
                  [Droplets, "No liquidity deposit"],
                  [HandCoins, "You earn on every swap"],
                  [ShieldCheck, "No owner, no admin key"],
                ] as const
              ).map(([Icon, label]) => (
                <li
                  key={label}
                  className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-line bg-surface/70 px-2.5 py-1 font-medium text-ink backdrop-blur sm:px-3"
                >
                  <Icon className="h-3.5 w-3.5 text-accent" aria-hidden="true" /> {label}
                </li>
              ))}
            </ul>
          </div>
          <Mascot
            pose="wave"
            priority
            className="mascot-float relative hidden h-28 w-auto shrink-0 drop-shadow-[0_18px_30px_rgba(76,29,149,0.45)] sm:block lg:h-36"
          />
        </div>
      </div>

      {/* Top strip */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5 sm:gap-4">
        {/* Label "ADEXTO STUDIO" di sini dicabut: kartu sambutan di atasnya sudah membawanya,
            jadi yang tersisa di strip hanya keadaan dompet dan pilihan model. */}
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-medium text-ink-faint">Wallet</span>
          {isConnected ? (
            <span className="text-ok font-mono text-xs font-medium flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-ok animate-pulse" />
              {address?.slice(0, 6)}…{address?.slice(-4)}
            </span>
          ) : (
            <button
              onClick={() => connectWallet()}
              disabled={isConnecting}
              className="text-warn hover:text-warn text-xs font-medium flex items-center gap-1.5 bg-warn/10 border border-warn/30 px-2 py-0.5 rounded"
            >
              <Lock className="w-3 h-3 text-warn" /> {isConnecting ? "Connecting…" : "Connect wallet"}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs">
          {/* Tiga tombol ini mengisi SELURUH formulir sekaligus, tapi dulu berdiri
              sebagai tiga kata lepas — "Quant AI  Viral Meme  DeFi Yield" — tanpa
              petunjuk bahwa mengkliknya menimpa nama, ticker, tier fee, dan mandat
              agen. Sekarang bergaris dan berlabel.
              Kelas hover-nya juga dibuat statis. Sebelumnya `hover:${color}` disusun
              dari variabel, jadi pemindai Tailwind tidak bisa melihatnya; kelasnya
              hanya ada di CSS karena kebetulan dipakai berkas lain. */}
          <div className="hidden md:flex items-center gap-1 rounded-lg border border-line bg-surface p-1">
            <span className="pl-1.5 pr-0.5 text-[10px] uppercase tracking-wider text-ink-faint">Presets</span>
            {(
              [
                ["quant", "Quant AI"],
                ["meme", "Viral Meme"],
                ["defi", "DeFi Yield"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                title={`Fill the whole form with the ${label} template`}
                className="rounded-md px-2.5 py-1 text-[11px] font-semibold text-ink-soft transition-colors hover:bg-cream-3 hover:text-ink"
              >
                {label}
              </button>
            ))}
          </div>

          {/**
           * Dropdown model: dulu `<select>` native, sekarang dirender DI DALAM halaman.
           *
           * Alasannya bukan estetika. Popup `<select>` native digambar oleh browser/OS di
           * luar permukaan halaman, dan itu terukur: mengkliknya menambah 0 node DOM
           * (494 -> 494), dan ketiga `<option>`-nya berkotak 0x0 bahkan saat terbuka.
           * Akibatnya ia tidak pernah ikut terekam screencast Playwright — jadi tidak
           * mungkin memperlihatkan pilihan model 0G di video demo, dan Playwright pun
           * tidak bisa diandalkan untuk membukanya (jalur resminya `selectOption`, yang
           * mengganti nilai tanpa pernah menampilkan popup).
           *
           * Versi ini pakai button + listbox, jadi ia hidup di DOM: bisa difilmkan, bisa
           * dites, dan tetap bisa dipakai keyboard. Aksesibilitasnya ditulis eksplisit
           * karena `<select>` native memberi semua itu gratis dan penggantinya harus
           * membayarnya sendiri: aria-haspopup/expanded, role listbox/option,
           * aria-selected, panah atas-bawah, Enter/Space, Escape, dan klik di luar.
           */}
          <div ref={modelMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setModelOpen((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setModelOpen(true);
                }
              }}
              aria-haspopup="listbox"
              aria-expanded={modelOpen}
              /**
               * `aria-label` WAJIB di sini, bukan hiasan.
               *
               * ChainSwitcher di navbar sudah memakai `aria-haspopup="listbox"` dengan
               * anak-anak `role="option"`. Tanpa label pembeda, selector seperti
               * `button[aria-haspopup="listbox"]` mengenai tombol navbar itu lebih dulu —
               * dan itu benar-benar terjadi: probe pertama membuka pemilih jaringan lalu
               * melaporkan empat "option" berisi nama chain, bukan tiga model. Label ini
               * yang dipakai perekam dan probe untuk menunjuk kontrol yang benar.
               */
              aria-label="0G model"
              title="Pick the 0G model this token's agent runs on"
              className="flex items-center gap-1.5 bg-surface rounded-lg px-2.5 py-1.5 text-accent font-bold text-xs hover:bg-cream-3 transition-colors"
            >
              <Cpu className="w-3.5 h-3.5 shrink-0" />
              <span className="max-w-[150px] truncate">
                {MODELS.find((m) => m.id === selectedModel)?.label ?? selectedModel}
              </span>
              <ChevronDown className={`w-3 h-3 text-accent/60 transition-transform ${modelOpen ? "rotate-180" : ""}`} />
            </button>

            {modelOpen && (
              <ul
                role="listbox"
                aria-label="0G model"
                tabIndex={-1}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setModelOpen(false);
                    return;
                  }
                  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                  e.preventDefault();
                  const at = MODELS.findIndex((m) => m.id === selectedModel);
                  const next = e.key === "ArrowDown" ? at + 1 : at - 1;
                  const wrapped = (next + MODELS.length) % MODELS.length;
                  setSelectedModel(MODELS[wrapped].id);
                }}
                className="absolute right-0 top-full mt-1 z-30 min-w-[210px] rounded-xl border border-line bg-surface p-1 shadow-lg"
              >
                {MODELS.map((m) => {
                  const active = m.id === selectedModel;
                  return (
                    <li key={m.id} role="option" aria-selected={active}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedModel(m.id);
                          setModelOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition-colors ${
                          active ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-cream-3 hover:text-ink"
                        }`}
                      >
                        <Cpu className={`w-3.5 h-3.5 shrink-0 ${active ? "text-accent" : "text-ink-faint"}`} />
                        <span className="truncate">{m.label}</span>
                        {active && <CheckCircle2 className="ml-auto w-3.5 h-3.5 shrink-0" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start">
        {/* Left: launch control */}
        <div className="flex min-h-[520px] flex-col rounded-card border border-line bg-surface p-3 shadow-[var(--shadow-panel)] sm:p-5 lg:col-span-8">
          {finished ? (
            <DeployReport
              results={results}
              symbol={tokenTicker.trim().toUpperCase()}
              name={tokenName.trim()}
              onReset={() => {
                setResults([]);
                setGlobalError(null);
              }}
            />
          ) : (
            <div className="space-y-3">
              {modeToggle}
              {mode === "express" ? (
                expressPanel
              ) : (
              <>
              <StepRail
                steps={[
                  { id: "step-chains", label: "Chains", done: launchTargets.length > 0 },
                  {
                    id: "step-token",
                    label: "Token",
                    done: Boolean(tokenName.trim()) && Boolean(tokenTicker.trim()) && supplyNumber > 0 && tickerAvailable !== false,
                  },
                  { id: "step-curve", label: "Curve", done: totalSwapFee > 0 },
                  { id: "step-agent", label: "Agent", done: Boolean(agentPersona.trim()) },
                  { id: "step-verify", label: "Verify", done: Boolean(attestation) },
                ]}
              />

              {liveChains.length === 0 && (
                <div className="p-3 rounded-xl bg-warn/10 border border-warn/30 flex items-start gap-2 text-[11px] text-warn">
                  <AlertTriangle className="w-4 h-4 text-warn mt-0.5 shrink-0" />
                  <span>
                    <strong>Launching is disabled.</strong> No launch factory is deployed on any chain yet, so a launch
                    could not create a tradable curve. Broadcast it with{" "}
                    <code className="text-accent">node scripts/deploy-sovereign-curve.mjs --chain 0g --broadcast</code>{" "}
                    and set <code className="text-accent">NEXT_PUBLIC_CURVE_FACTORY_0G</code>.
                  </span>
                </div>
              )}

              {/* Chain matrix */}
              <div id="step-chains" className="scroll-mt-12 space-y-2.5 rounded-xl border border-accent/30 bg-accent-soft p-3.5">
                <SectionHeading step={1} title="Where it lives" />

                {/* Satu chain per peluncuran. Kalimat ini ada di depan supaya creator
                    tidak perlu menemukannya sendiri setelah bertanya-tanya kenapa
                    pilihannya berpindah, bukan bertambah. */}
                <p className="pl-8 text-[11.5px] leading-relaxed text-ink-soft">
                  Pick one chain. Each chain is its own market with its own supply and price, and nothing bridges
                  between them. Want to be on another chain too? Launch there as well once this one is live.
                </p>

                <div role="radiogroup" aria-label="Launch chain" className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[11px]">
                  {CHAIN_LIST.map((chain) => {
                    const selectable = chain.dexLive;
                    const selected = selectable && targetChainIds.includes(chain.chainId);
                    return (
                      <button
                        key={chain.chainId}
                        type="button"
                        disabled={!selectable}
                        onClick={() => selectChain(chain.chainId)}
                        role="radio"
                        aria-checked={selected}
                        title={
                          !selectable
                            ? `No launch factory is deployed on ${chain.name} yet`
                            : blockedChainIds.has(chain.chainId)
                            ? `${chain.name} · this ticker already has a market here, it will be skipped`
                            : // Tampilkan factory yang BENAR-BENAR dipakai chain ini. Fallback ke
                              // `factoryV2Address` sudah dicabut: generasi berseed tidak pernah
                              // punya factory yang di-broadcast, dan tx launch di baris ~749 hanya
                              // pernah dibangun dari `curveFactoryAddress`.
                              `${chain.name} · factory ${chain.curveFactoryAddress}`
                        }
                        className={`flex items-center justify-between p-2 rounded-lg border text-left transition-all ${
                          !selectable
                            ? "bg-cream-2 border-line text-ink-faint cursor-not-allowed"
                            : selected
                            ? // Teks `ink` di atas permukaan padat, BUKAN aksen di atas aksen.
                              // Varian sebelumnya menumpuk `bg-accent-soft` chip di atas
                              // `bg-accent-soft` pembungkus langkahnya, lalu menulis di atasnya
                              // dengan warna aksen juga — 5,3:1 pada teks 9px, yaitu ungu samar
                              // di atas ungu. Sekarang tanda terpilih dibawa border dan ikon
                              // centang, sementara tulisannya kontras penuh.
                              "bg-surface border-accent/60 text-ink shadow-[var(--glow-accent)]"
                            : "bg-cream-2 border-line text-ink-soft"
                        }`}
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          {selectable ? (
                            selected ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-accent shrink-0" />
                            ) : (
                              <span className="w-3.5 h-3.5 rounded border border-line shrink-0" />
                            )
                          ) : (
                            <Lock className="w-3.5 h-3.5 shrink-0" />
                          )}
                          <span className="font-bold truncate">{chain.key}</span>
                        </span>
                        <span className="text-[9px] font-mono shrink-0">{chain.chainId}</span>
                      </button>
                    );
                  })}
                </div>

                {offlineChains.length > 0 && (
                  <p className="text-[10px] text-ink-faint flex items-start gap-1.5">
                    <Info className="w-3 h-3 mt-0.5 shrink-0" />
                    {offlineChains.map((c) => c.key).join(", ")} unavailable: no launch factory deployed, so a launch
                    there would produce a token with no curve.
                  </p>
                )}
              </div>

              {/* Token */}
              <Section
                id="step-token"
                step={2}
                title="Your token"
                blurb="What people will see: the name, the ticker and the picture."
              >
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <Field label="Name">
                    <input
                      value={tokenName}
                      onChange={(e) => setTokenName(e.target.value)}
                      className={`${FIELD_CLASS} font-semibold`}
                    />
                  </Field>
                  <Field
                    label="Ticker"
                    hint={
                      ticker.checking
                        ? "checking…"
                        : tickerAvailable === true
                        ? `available on ${launchTargets.length || targetChainIds.length} chain(s)`
                        : launchTargets.length > 0
                        ? `available on ${launchTargets.map((c) => c.key).join(", ")}`
                        : tickerAvailable === false
                        ? tickerReason ?? "unavailable"
                        : undefined
                    }
                    hintTone={
                      launchTargets.length > 0 ? "ok" : tickerAvailable === false ? "error" : "muted"
                    }
                  >
                    <input
                      value={tokenTicker}
                      onChange={(e) => {
                        const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
                        setTokenTicker(value);
                        setCustomSubdomain(value.toLowerCase());
                      }}
                      className={`${FIELD_CLASS} font-mono font-bold text-accent ${
                        tickerAvailable === false ? "border-danger" : ""
                      }`}
                    />
                  </Field>
                  <Field label="Supply (whole tokens)">
                    <input
                      value={tokenSupply}
                      onChange={(e) => setTokenSupply(e.target.value)}
                      className={`${FIELD_CLASS} font-mono font-semibold`}
                    />
                  </Field>
                </div>

                {/* Kategori.
                    Sebelumnya tidak ada di form sama sekali, jadi setiap pasar tercatat
                    "defi" — `/api/deploy` menerima field ini tapi studio tidak pernah
                    mengirimnya. Akibatnya tab kategori di /explorer, yang diturunkan dari
                    data, hanya pernah punya satu isi. */}
                <Field
                  label="Category"
                  hint={MARKET_CATEGORIES.find((c) => c.key === category)?.hint}
                >
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as MarketCategory)}
                    className={`${FIELD_CLASS} font-semibold`}
                  >
                    {MARKET_CATEGORIES.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <p className="text-[10px] text-ink-faint">
                  Decides which tab your market appears under in the{" "}
                  <Link href="/explorer" className="text-accent hover:underline">
                    explorer
                  </Link>
                  . It does not affect the curve, the fees or anything on chain.
                </p>

                {/* Pitch dan tautan.
                    Dipasang DI DALAM langkah "Token", bukan sebagai langkah baru, supaya
                    rel langkah di atas panel tetap berisi tujuh langkah yang sama —
                    menambah langkah kedelapan hanya untuk kolom opsional membuat
                    peluncuran terasa lebih panjang daripada yang sebenarnya.

                    Semuanya opsional, dan tidak ada satu pun yang masuk calldata: yang
                    berubah hanya baris registry dan apa yang tampil di halaman pasar. */}
                <details className="group/links rounded-xl border border-line bg-surface [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer list-none items-center gap-2 p-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-ink">
                      Description &amp; links
                    </span>
                    {/* Ringkasan berapa yang sudah diisi, supaya panel tertutup tidak
                        menyembunyikan bahwa isinya sudah ada. */}
                    <span className="ml-auto text-[10px] text-ink-faint">
                      {[description, linkX, linkWebsite, linkGithub, linkDocs].filter((v) => v.trim()).length > 0
                        ? `${[description, linkX, linkWebsite, linkGithub, linkDocs].filter((v) => v.trim()).length} filled`
                        : "optional"}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform duration-200 group-open/links:rotate-180" />
                  </summary>
                  <div className="space-y-2.5 px-3 pb-3">

                  <Field label="One-line pitch">
                    <div className="relative">
                      <input
                        value={description}
                        onChange={(e) => setDescription(e.target.value.slice(0, 160))}
                        placeholder="What is this market for?"
                        aria-label="One-line pitch"
                        className={`${FIELD_CLASS} pr-14`}
                      />
                      {/* Hitungan karakter, bukan pemotongan senyap: batas 160 ditegakkan
                          juga di server, jadi orang harus melihat batasnya sebelum menekan
                          launch — bukan menemukan pitch-nya terpotong setelahnya. */}
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-ink-faint" data-numeric>
                        {description.length}/160
                      </span>
                    </div>
                  </Field>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Field label="X / Twitter">
                      <input
                        value={linkX}
                        onChange={(e) => setLinkX(e.target.value)}
                        placeholder="@yourhandle"
                        aria-label="X handle"
                        className={FIELD_CLASS}
                      />
                    </Field>
                    <Field label="Website">
                      <input
                        value={linkWebsite}
                        onChange={(e) => setLinkWebsite(e.target.value)}
                        placeholder="https://yourproject.xyz"
                        aria-label="Website URL"
                        inputMode="url"
                        className={FIELD_CLASS}
                      />
                    </Field>
                    <Field label="GitHub">
                      <input
                        value={linkGithub}
                        onChange={(e) => setLinkGithub(e.target.value)}
                        placeholder="https://github.com/you/repo"
                        aria-label="GitHub URL"
                        inputMode="url"
                        className={FIELD_CLASS}
                      />
                    </Field>
                    <Field label="Docs">
                      <input
                        value={linkDocs}
                        onChange={(e) => setLinkDocs(e.target.value)}
                        placeholder="https://docs.yourproject.xyz"
                        aria-label="Docs URL"
                        inputMode="url"
                        className={FIELD_CLASS}
                      />
                    </Field>
                  </div>

                  <p className="text-[10px] leading-relaxed text-ink-faint">
                    Shown on your market page. Only <code className="text-accent">http</code> and{" "}
                    <code className="text-accent">https</code> links are stored, and the X field keeps the handle rather
                    than a full URL — anything else is dropped rather than published.
                  </p>
                  </div>
                </details>

                {/* Logo: unggah milik sendiri, atau biarkan model menggambarnya.
                    Unggah didahulukan dalam urutan tombol karena creator yang SUDAH punya
                    logo adalah kasus yang lebih umum, dan sebelumnya mereka tidak punya
                    jalan sama sekali selain menerima apa pun yang keluar dari model. */}
                <div className="p-2.5 rounded-xl bg-surface border border-line space-y-2">
                  {/* `flex-wrap` + `min-w` pada blok teks: di layar sempit tombol turun ke baris
                      sendiri. Sebelumnya tombol `shrink-0` memakan ~280px dari 320px, dan teks
                      di sebelahnya terjepit jadi kolom 44px — satu kata per baris (terukur 390px). */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-[12rem] flex-1 items-center gap-3">
                      <div className="w-10 h-10 rounded-xl overflow-hidden bg-surface border border-accent/30 p-1 flex items-center justify-center shrink-0">
                        <img src={generatedLogo ?? "/logo.svg"} alt="Token logo preview" className="w-full h-full object-contain" />
                      </div>
                      {/* Nama model hanya ditulis kalau model itu memang jalan.
                          Sebelumnya "0G z-image-turbo" tercetak tetap, termasuk di atas
                          gambar cadangan yang digambar sendiri oleh server — dan sekarang
                          juga akan salah di atas berkas yang diunggah creator. */}
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold text-ink">
                          {logoSource === "uploaded"
                            ? "Your image"
                            : logoSource === "preset"
                            ? "ADEXTO robot preset"
                            : logoInfo && !logoInfo.generated
                            ? "Placeholder emblem"
                            : "0G z-image-turbo"}
                        </div>
                        <span className="text-[10px] text-ink-soft" title={logoInfo?.note}>
                          {logoSource === "uploaded"
                            ? `Resized to ${LOGO_PX}×${LOGO_PX} · generation is off`
                            : logoSource === "preset"
                            ? "Served as a file on this site, not stored inline"
                            : logoInfo === null
                            ? "Generate an emblem, or upload one you already have"
                            : logoInfo.generated
                            ? `Rendered on the 0G router · ${LOGO_PX}×${LOGO_PX}`
                            : "Drawn locally — the router did not return an image"}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {/* Input asli disembunyikan, bukan dihapus: tombol di sebelahnya yang
                          memicunya, supaya gayanya sama dengan tombol lain di form ini dan
                          tetap bisa dijangkau keyboard lewat tombol itu. */}
                      <input
                        ref={logoFileRef}
                        type="file"
                        accept={ACCEPT_ATTR}
                        className="hidden"
                        onChange={(e) => handleLogoFile(e.target.files?.[0] ?? null)}
                      />
                      {logoSource === "uploaded" ? (
                        <button
                          type="button"
                          onClick={clearUploadedLogo}
                          className="px-3 py-1.5 rounded-lg bg-cream-2 hover:bg-cream-2 text-ink-soft border border-line text-xs font-bold flex items-center gap-1.5"
                        >
                          <XCircle className="w-3 h-3" /> Remove
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => logoFileRef.current?.click()}
                        disabled={isReadingLogo}
                        className="px-3 py-1.5 rounded-lg bg-cream-2 hover:bg-cream-2 text-ink border border-line text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {isReadingLogo ? (
                          <>
                            <RefreshCw className="w-3 h-3 animate-spin" /> Reading…
                          </>
                        ) : (
                          <>
                            <ImagePlus className="w-3 h-3" /> {logoSource === "uploaded" ? "Replace" : "Upload"}
                          </>
                        )}
                      </button>
                      {/* Mati begitu ada unggahan, dengan alasan yang tertulis di `title`.
                          Satu klik di sini akan menimpa berkas yang baru dipilih, dan tidak
                          ada salinan untuk mengembalikannya. "Remove" adalah jalan keluarnya. */}
                      <button
                        type="button"
                        onClick={handleGenerateLogo}
                        disabled={isGeneratingLogo || logoSource === "uploaded"}
                        title={
                          logoSource === "uploaded"
                            ? "Your own image is in use. Remove it to generate one instead."
                            : undefined
                        }
                        className="px-3 py-1.5 rounded-lg bg-accent-soft hover:bg-accent-soft text-accent border border-accent/30 text-xs font-bold flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {isGeneratingLogo ? (
                          <>
                            <RefreshCw className="w-3 h-3 animate-spin" /> Rendering…
                          </>
                        ) : (
                          <>
                            <Wand2 className="w-3 h-3" /> Generate
                          </>
                        )}
                      </button>
                      {/* Preset: sepuluh pose robot ADEXTO yang sudah ada di situs ini.
                          Tidak mematikan tombol lain — memilih preset hanya menimpa gambar
                          yang sedang dipakai, dan itu bisa dibatalkan dengan memilih yang
                          lain, Generate, atau Upload. */}
                      <button
                        type="button"
                        onClick={() => setPresetsOpen((v) => !v)}
                        aria-expanded={presetsOpen}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                          presetsOpen || logoSource === "preset"
                            ? "border-accent/60 bg-surface text-ink"
                            : "border-line bg-cream-2 text-ink"
                        }`}
                      >
                        <Bot className="h-3 w-3" /> Presets
                      </button>
                    </div>
                  </div>

                  {presetsOpen && (
                    <div className="rounded-xl border border-line bg-cream-2 p-2">
                      <p className="mb-2 text-[10px] text-ink-faint">
                        Pick a 3D ADEXTO robot. Stored as a path on this site, so it costs the registry nothing and
                        loads from cache.
                      </p>
                      <ul className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
                        {MASCOT_PRESETS.map((pose) => {
                          const src = `/mascot/${pose}.webp`;
                          const active = generatedLogo === src;
                          return (
                            <li key={pose}>
                              <button
                                type="button"
                                onClick={() => {
                                  setGeneratedLogo(src);
                                  setLogoSource("preset");
                                  setLogoInfo(null);
                                  setLogoError(null);
                                }}
                                aria-pressed={active}
                                title={`ADEXTO robot · ${pose}`}
                                className={`flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border p-1 transition-colors ${
                                  active ? "border-accent/60 bg-surface" : "border-line bg-surface hover:border-accent/40"
                                }`}
                              >
                                <Mascot pose={pose} className="h-full w-auto" />
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {/* Persyaratannya ditulis SEBELUM orang memilih berkas, bukan hanya sebagai
                      galat sesudahnya. */}
                  <p className="text-[10px] text-ink-faint">
                    PNG, JPEG or WebP · <strong className="text-ink-soft">square</strong> · max{" "}
                    <strong className="text-ink-soft">{MAX_UPLOAD_MB} MB</strong>. Whatever you upload is
                    resized to {LOGO_PX}×{LOGO_PX} and stored with the market.
                  </p>

                  {logoError ? (
                    <p role="alert" className="text-[10px] text-danger flex items-start gap-1.5">
                      <AlertTriangle className="w-3 h-3 mt-px shrink-0" />
                      <span>{logoError}</span>
                    </p>
                  ) : null}
                </div>
              </Section>

              {/* Curve.
                  The seed-liquidity input and the supply-split slider used to live
                  here. Both are gone: the curve needs no native deposit, and 100%
                  of supply enters it, so there is nothing left to configure and
                  nothing for the creator to dump. */}
              <Section
                id="step-curve"
                step={3}
                title="Price and fees"
                blurb="How trades are priced, and your share of every one."
                defaultOpen={false}
                hint={`${totalSwapFee.toFixed(2)}% swap fee · ${creatorCut.toFixed(2)}% to you`}
              >
                <div className="rounded-xl border border-ok/30 bg-ok/10 p-2.5 flex items-start gap-2 text-[10px]">
                  <Droplets className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />
                  <span className="text-ink-soft">
                    <strong className="text-ok">No liquidity deposit.</strong> The curve opens with a virtual
                    reserve, so you pay gas only — the live figure for your chain is in the cost card under Verify.
                    Every token is tradable from the launch transaction onward.
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Row
                    label="Supply into curve"
                    value={`100% · ${supplyNumber > 0 ? supplyNumber.toLocaleString("en-US") : "—"}`}
                  />
                  <Row label="Your token allocation" value="0 — you earn from fees" />
                </div>

                <div className="p-2 rounded-xl bg-cream-2 flex items-start gap-2 text-[10px] text-ink-soft">
                  <Droplets className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
                  <span>
                    {/* USD didahulukan: itu satu-satunya angka yang berarti sama di
                        keempat chain. Jumlah native-nya berbeda per chain justru
                        AGAR nilai USD-nya sama. */}
                    Opening market cap{" "}
                    <strong className="text-accent">≈ ${OPENING_MARKET_CAP_USD.toLocaleString("en-US")}</strong> on
                    every chain you select
                    {virtualNativeFor(primaryChain) > 0 && (
                      <>
                        {" "}
                        — {formatSmallNumber(virtualNativeFor(primaryChain), 6)} {primaryChain.nativeSymbol} on{" "}
                        {primaryChain.key}
                      </>
                    )}
                    .{" "}
                    <span title={supplyNumber > 0 ? String(virtualNativeFor(primaryChain) / supplyNumber) : undefined}>
                      Opening price{" "}
                      {supplyNumber > 0 ? formatSmallNumber(virtualNativeFor(primaryChain) / supplyNumber) : "—"}{" "}
                      {primaryChain.nativeSymbol} per token.
                    </span>
                    <br />
                    <span className="text-warn/90">
                      The curve has no withdrawal function, so nobody can drain it — not you either. The depth share of
                      each fee stays in the curve, which raises the price floor as volume accumulates.
                    </span>
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                  {/* Split dari total yang DIKONFIGURASI: depth · creator · buyback (· protocol).
                      Bagian creator inilah yang menggantikan alokasi token gratis,
                      jadi tidak ada apa pun yang bisa di-dump creator.

                      Depth di tombol WAJIB dihitung dengan aturan yang sama dengan `depthCut`.
                      Versi sebelumnya memakai `fee - creator - cut` — rumus 0.11.0 — sehingga
                      sejak 0.12.0 tombol Standard menulis "0.20% depth" sementara baris di
                      bawahnya (dan calldata) 0.10%: dua angka berbeda untuk satu kurva di
                      layar yang sama. */}
                  {(Object.entries(FEE_TIERS) as Array<[FeeTier, (typeof FEE_TIERS)[FeeTier]]>).map(
                    ([tier, { fee, creator, cut, label }]) => (
                      <button
                        key={tier}
                        onClick={() => applyFeeTier(tier)}
                        className={`p-2 rounded-xl text-left transition-all border ${
                          feeTier === tier
                            ? "bg-accent-soft text-ink border-accent/30"
                            : "bg-cream-2 text-ink-soft border-transparent hover:text-ink"
                        }`}
                      >
                        <span className="font-bold block text-[11px] text-accent">{label}</span>
                        {/* Depth hanya ditulis setelah struktur fee factory chain ini terbaca dari
                            /api/deploy: sebelum itu tidak diketahui apakah kaki protokol ada di dalam
                            total, dan menebak berarti menulis angka yang salah selama sedetik. */}
                        <span className="text-[10px] leading-snug text-ink-soft" data-testid={`tier-split-${tier}`}>
                          {feeLegsKnown
                            ? `${Math.max(0, fee - creator - cut - (protocolCarvedOut ? protocolCut : 0)).toFixed(2)}% depth · `
                            : ""}
                          {creator.toFixed(2)}% you · {cut.toFixed(2)}% buyback
                          {feeLegsKnown && protocolCarvedOut && protocolCut > 0 ? ` · ${protocolCut.toFixed(2)}% protocol` : ""}
                        </span>
                      </button>
                    )
                  )}
                </div>

                <div className="p-2 rounded-xl bg-cream-2 space-y-1">
                  {/* Lebar tiap segmen diukur terhadap TOTAL YANG DIBAYAR. Sejak 0.12.0
                      angka itu sama dengan total yang dikonfigurasi, karena kaki protokol
                      dipotong dari dalam dan `depthCut` sudah memberi ruang untuknya —
                      jadi keempat segmen berjumlah tepat 100% lebar batang.

                      Pembaginya tetap ditulis `totalPaidPct` dan bukan `totalSwapFee`
                      supaya kalau suatu saat ada kaki yang kembali ditagih di luar
                      kuotasi, satu variabel itu yang berubah dan batangnya ikut benar
                      sendiri. Di 0.11.0 justru inilah yang menahan segmen keempat dari
                      meluber keluar batang. */}
                  <div className="flex flex-wrap justify-between gap-x-3 text-[10px]">
                    {/* Angka depth menunggu struktur fee factory, alasannya sama dengan tombol tier. */}
                    <span className="text-accent font-medium" data-testid="fee-bar-depth">
                      Curve depth: {feeLegsKnown ? `${depthCut.toFixed(2)}%` : "…"}
                    </span>
                    <span className="text-ok font-medium">Your revenue: {creatorCut.toFixed(2)}%</span>
                    <span className="text-accent font-medium">Buyback: {treasuryCut.toFixed(2)}%</span>
                    {protocolCut > 0 ? (
                      <span className="text-ink-soft font-medium">Protocol: {protocolCut.toFixed(2)}%</span>
                    ) : null}
                  </div>
                  <div className="h-1.5 rounded-full bg-cream-3/[0.05] overflow-hidden flex">
                    <div className="bg-accent-soft h-full" style={{ width: `${(depthCut / totalPaidPct) * 100}%` }} />
                    <div className="bg-ok/10 h-full" style={{ width: `${(creatorCut / totalPaidPct) * 100}%` }} />
                    <div className="bg-accent-soft h-full" style={{ width: `${(treasuryCut / totalPaidPct) * 100}%` }} />
                    {protocolCut > 0 ? (
                      <div className="bg-ink-faint/30 h-full" style={{ width: `${(protocolCut / totalPaidPct) * 100}%` }} />
                    ) : null}
                  </div>
                  {protocolCut > 0 ? (
                    <span className="block text-[9px] text-ink-soft">
                      Traders pay <span data-numeric>{totalPaidPct.toFixed(2)}%</span> in total, and nothing is added on
                      top of it. The protocol&apos;s <span data-numeric>{protocolCut.toFixed(2)}%</span> is one of the
                      four legs inside that figure, alongside your{" "}
                      <span data-numeric>{creatorCut.toFixed(2)}%</span>. It is immutable per market, like every other
                      leg.
                    </span>
                  ) : null}
                  <span className="block text-[9px] text-ok">
                    You earn {creatorCut.toFixed(2)}% of every swap, streamed to your wallet. You receive no free tokens,
                    so there is nothing you could dump.
                  </span>
                  <span className="text-[9px] font-mono text-ink-faint block">
                    Subdomain: {customSubdomain || "myswap"}.adexto.xyz
                  </span>
                </div>
              </Section>

              {/* Agent */}
              <Section
                id="step-agent"
                step={4}
                title="Market agent"
                blurb="What your market's agent tells holders, running on 0G Compute."
                defaultOpen={false}
                hint={selectedModel}
              >
                <Field label="Mandate">
                  <input
                    value={agentPersona}
                    onChange={(e) => setAgentPersona(e.target.value)}
                    className={FIELD_CLASS}
                  />
                </Field>

                {/* ERC-8004 identity, optional and off by default.
                    Kept optional deliberately: registering an agent is a separate
                    transaction against a registry that is not ours, so requiring it
                    would turn every launch into two transactions — including for
                    creators who do not want an on-chain agent identity at all. */}
                <div className="rounded-xl border border-line bg-surface p-3 space-y-2">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={agentBinding.enabled}
                      onChange={(e) => setAgentBinding((p) => ({ ...p, enabled: e.target.checked }))}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[color:var(--accent)]"
                    />
                    <span className="text-[11px] leading-relaxed text-ink-soft">
                      <strong className="text-ink">Bind an ERC-8004 agent identity.</strong> Links this token to an agent
                      you already registered in the Identity Registry, so anything outside ADEXTO can discover it. Leave
                      this off and the launch stays a single transaction.
                    </span>
                  </label>

                  {agentBinding.enabled && (
                    <div className="space-y-1.5 pl-5">
                      {/* One field per selected chain. A single shared field was
                          wrong: the same agent carries a different id on every
                          chain, so one value can only ever be correct on one of
                          them and the rest revert after paying gas. */}
                      {liveChains
                        .filter((c) => targetChainIds.includes(c.chainId))
                        .map((chain) => {
                          const check = agentChecks[chain.chainId] ?? { state: "idle" as const };
                          return (
                            <Field
                              key={chain.chainId}
                              label={`Agent id on ${chain.name}`}
                              hint={
                                check.state === "checking"
                                  ? "checking…"
                                  : check.state === "owned"
                                  ? `you own this agent · ${check.detail ?? ""}`
                                  : check.state === "not-owned"
                                  ? `not yours · ${check.detail ?? ""}`
                                  : check.state === "missing" || check.state === "error"
                                  ? check.detail
                                  : undefined
                              }
                              hintTone={
                                check.state === "owned"
                                  ? "ok"
                                  : check.state === "not-owned" || check.state === "missing"
                                  ? "error"
                                  : "muted"
                              }
                            >
                              <div className="flex gap-1.5">
                                <input
                                  value={agentBinding.agentIds[chain.chainId] ?? ""}
                                  onChange={(e) =>
                                    setAgentBinding((p) => ({
                                      ...p,
                                      agentIds: {
                                        ...p.agentIds,
                                        [chain.chainId]: e.target.value.replace(/[^0-9]/g, ""),
                                      },
                                    }))
                                  }
                                  placeholder={`id on ${chain.name}`}
                                  className={`${FIELD_CLASS} font-mono`}
                                />
                                {/* Muncul hanya saat kolomnya kosong. Sesudah terisi, tombol
                                    "buat" di sebelah id yang sudah ada adalah undangan untuk
                                    mendaftar dua kali dan membayar gas untuk agent kedua yang
                                    tidak akan dipakai. */}
                                {!(agentBinding.agentIds[chain.chainId] ?? "").trim() && (
                                  <button
                                    type="button"
                                    onClick={() => handleCreateAgent(chain)}
                                    disabled={creatingAgent !== null}
                                    className="shrink-0 rounded-lg border border-line-strong px-2.5 py-2 text-[10px] font-medium text-ink transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
                                  >
                                    {creatingAgent === chain.chainId ? "registering…" : "Create"}
                                  </button>
                                )}
                              </div>
                            </Field>
                          );
                        })}
                      <p className="text-[10px] leading-relaxed text-ink-faint">
                        {/* Stated because the number 0 is a live agent here, and a
                            blank field must not be read as agent 0. */}
                        One id per chain: the registry sits at the same address everywhere but keeps separate state, so
                        the same agent has a different id on each chain. <strong className="font-medium text-ink-soft">Create</strong>{" "}
                        registers one from your own wallet and fills the field — it costs gas, and it has to be your
                        wallet because the factory checks that you own the agent before it binds it. The registries
                        exist on mainnet only. Agent id 0 is a real agent, so leaving a field blank is not the same as
                        entering 0.
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
                  {/* Pil ini dulu berbunyi "AMD SEV-SNP enclave" sebagai fakta.
                      Router 0G berkata Intel TDX lewat dstack, dan tier untuk model
                      kita adalah TeeML — enklave milik 0G sendiri. Tautannya ke /docs
                      karena di sana angkanya dibaca langsung dari router. */}
                  <a
                    href="/docs"
                    className="px-2 py-0.5 rounded bg-accent-soft text-accent border border-accent/30 hover:underline"
                    title="0G router reports Intel TDX attestation via dstack for this model. ADEXTO reads that declaration but does not verify the raw quote."
                  >
                    0G TeeML · TDX reported
                  </a>
                  {/* Amber dipesan untuk peringatan; ini nama fitur. */}
                  <span className="px-2 py-0.5 rounded bg-accent-soft text-accent border border-accent/30">
                    Cloudflare x402
                  </span>
                  <span className="px-2 py-0.5 rounded bg-accent-soft text-accent border border-accent/30">
                    0G DA metadata anchor
                  </span>
                </div>
              </Section>

              {/* Verifikasi — dua gerbang yang berbeda, dikelompokkan jadi satu langkah.
                  Sebelumnya keduanya berupa dua kotak lepas tanpa judul di antara
                  seksi bernomor, sehingga terbaca seperti catatan pinggir alih-alih
                  syarat yang menahan tombol launch. */}
              <div id="step-verify" className="scroll-mt-12 space-y-2.5 rounded-xl border border-line bg-cream-2 p-3.5">
              <div>
                <SectionHeading step={5} title="Check and sign" />
                <p className="mt-0.5 pl-8 text-[11.5px] leading-snug text-ink-faint">
                  See what the launch costs, then sign once to prove the address is yours. The signature is free.
                </p>
              </div>

              {/* Biaya di titik keputusan, sebelum tanda tangan: gas hidup per chain yang dipilih,
                  tanpa setoran, dan fee per trade dari struktur factory chain itu. */}
              <LaunchCostCard
                chainIds={launchTargets.map((c) => c.chainId)}
                traderPaysPct={totalPaidPct}
                creatorKeepsPct={creatorCut}
              />

              {/* Attestation */}
              <div className="p-3 rounded-xl bg-surface border border-line space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <ShieldCheck className={`w-5 h-5 shrink-0 ${attestation ? "text-ok" : "text-ink-faint"}`} />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-ink flex items-center gap-1.5 flex-wrap">
                        <span>Deployer address attestation</span>
                        {attestation && (
                          <span className="text-[10px] px-1.5 rounded bg-ok/10 text-ok border border-ok/30">
                            SIGNED
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-ink-soft">
                        Signature verified server-side and bound to your address
                      </span>
                    </div>
                  </div>

                  {attestation ? (
                    <span className="text-ok text-xs font-bold flex items-center gap-1 shrink-0">
                      <CheckCircle2 className="w-4 h-4" /> Ready
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleAttest}
                      disabled={attesting}
                      className="px-3 py-1.5 rounded-lg bg-cream-3 hover:bg-cream-3 text-ink text-[11px] font-bold border border-line flex items-center gap-1 shrink-0"
                    >
                      {attesting ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin text-accent" /> Signing…
                        </>
                      ) : (
                        "Sign attestation"
                      )}
                    </button>
                  )}
                </div>

                <p className="text-[10px] text-warn/90 flex items-start gap-1.5 pt-1 border-t border-line">
                  <Info className="w-3 h-3 mt-0.5 shrink-0" />
                  {/* Teks WAJIB dibungkus satu <span>. Induknya adalah flex container,
                      jadi tanpa pembungkus ini setiap potongan teks, <strong>, dan <code>
                      menjadi item flex tersendiri dan tersusun MENYAMPING — kalimatnya
                      terbaca menyilang antar kolom. */}
                  {/* Kalimat lama: "…not that you are a distinct person. Wallets are free
                      to create, so Sybil resistance is a separate step below." Dua hal salah
                      begitu gerbangnya dicabut. Pertama, "distinct person" kini frasa terlarang
                      di audit_claims. Kedua, dan ini lebih buruk: TIDAK ADA lagi langkah di
                      bawah, jadi kalimat itu menunjuk panel yang sudah dihapus dan menjanjikan
                      lapisan yang tidak ada. Penggantinya menyatakan batasnya apa adanya. */}
                  <span>
                    This proves control of an address, nothing more. Addresses cost nothing to create, so this is not a
                    Sybil barrier — what limits a launch is ticker uniqueness per chain and the gas it costs, not
                    identity.
                  </span>
                </p>
              </div>

              {/* Panel World ID dulu di sini. Dicabut bersama gerbangnya — lihat catatan
                  di kepala berkas. Tidak diganti dengan panel "identity: none": kotak
                  yang mengumumkan ketiadaan fitur hanya menambah bising, dan yang
                  benar-benar mengikat launch — attestation wallet — sudah punya panelnya
                  sendiri persis di atas. */}
              </div>
              {/* ↑ tutup #step-verify */}

              {globalError && (
                <div className="p-2.5 rounded-xl bg-danger/10 border border-danger/30 text-[11px] text-danger flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-danger mt-0.5 shrink-0" />
                  <span>{globalError}</span>
                </div>
              )}

              {deploying && results.length > 0 && (
                <div className="space-y-1.5">
                  {results.map((r) => (
                    <ResultRow key={r.chainId} result={r} />
                  ))}
                </div>
              )}

              {/* Belum tersambung = tombol ini YANG menyambungkan (handleDeploy memanggil
                  connectWallet). Dulu ia mati sambil bertuliskan "Connect wallet", jadi label
                  yang menyuruh menyambung justru tidak bisa diklik — terutama di ponsel, tempat
                  tombol connect di strip atas tidak terlihat di layar yang sama. */}
              <button
                onClick={() => handleDeploy()}
                disabled={deploying || liveChains.length === 0 || (isConnected && !canDeploy)}
                /* Keadaan nonaktif tidak lagi memakai `opacity-40`. Ungu pekat yang
                   diredupkan sampai 40% dengan teks putih di atasnya menghasilkan
                   rasio kontras di bawah 2:1 — dan justru di keadaan inilah
                   tombolnya WAJIB terbaca, karena tulisannya adalah satu-satunya
                   tempat yang memberi tahu apa yang masih kurang. */
                className="w-full py-3.5 rounded-xl font-bold text-sm bg-accent hover:bg-accent-strong text-white transition-colors flex items-center justify-center gap-2 shadow-lg shadow-accent/20 disabled:shadow-none disabled:cursor-not-allowed disabled:border disabled:border-line-strong disabled:bg-cream-3 disabled:text-ink-soft"
              >
                {deploying ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Deploying…
                  </>
                ) : liveChains.length === 0 ? (
                  <>
                    <Lock className="w-3.5 h-3.5" /> Factory not deployed yet
                  </>
                ) : !isConnected ? (
                  <>
                    <Lock className="w-3.5 h-3.5" /> Connect wallet
                  </>
                ) : !attestation ? (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5 text-warn" /> Sign attestation to unlock
                  </>
                ) : launchTargets.length === 0 ? (
                  <>
                    <XCircle className="w-3.5 h-3.5" /> Choose an available ticker
                  </>
                ) : !agentBindingSatisfied ? (
                  <>
                    <Fingerprint className="w-3.5 h-3.5" />{" "}
                    {launchTargets.some((c) => agentChecks[c.chainId]?.state === "checking")
                      ? "Checking agent ownership…"
                      : (() => {
                          // Name the chains still missing an owned id, so the block
                          // is actionable instead of a generic refusal.
                          const missing = launchTargets.filter(
                            (c) => agentChecks[c.chainId]?.state !== "owned"
                          );
                          return missing.length === launchTargets.length
                            ? "Enter an agent id you own on each chain"
                            : `Agent id needed on ${missing.map((c) => c.key).join(", ")}`;
                        })()}
                  </>
                ) : (
                  <>
                    {/* Satu chain, jadi tidak ada lagi daftar yang digabung dengan "+". */}
                    <Sparkles className="w-3.5 h-3.5" /> Launch on {launchTargets[0]?.key ?? "—"} · gas only
                  </>
                )}
              </button>

              {/* Dengan satu chain per peluncuran, "akan dilewati" berarti tidak ada
                  yang tersisa untuk diluncurkan — jadi kalimatnya harus menyuruh
                  memilih chain lain, bukan memberi tahu bahwa satu dari beberapa
                  chain dibuang. */}
              {skippedTargets.length > 0 && (
                <p className="text-[10px] text-warn/90 flex items-start gap-1.5">
                  <Info className="w-3 h-3 mt-0.5 shrink-0" />
                  This ticker already has a market on {skippedTargets.map((c) => c.key).join(", ")}. Pick another chain,
                  or change the ticker.
                </p>
              )}

              <div className="rounded-xl border border-line bg-surface overflow-hidden">
                <div className="flex items-center gap-2 border-b border-line bg-cream-3/[0.03] px-3 py-2">
                  <Info className="h-3 w-3 text-accent" />
                  {/* Judulnya dulu "How a multi-chain launch works", benar ketika satu
                      peluncuran bisa mengenai empat chain sekaligus. Sekarang satu
                      peluncuran = satu chain, jadi yang dijelaskan adalah konsekuensi
                      berada di lebih dari satu chain — lewat beberapa peluncuran. */}
                  <span className="text-[10px] font-bold uppercase tracking-wider text-ink">
                    Launching on more than one chain
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-px bg-cream-3 sm:grid-cols-3">
                  <div className="bg-surface p-3">
                    <p className="text-[9px] uppercase tracking-wider text-ink-faint">One launch, one chain</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
                      Each launch creates one token and one curve on the chain you picked. Supply, depth and price are
                      independent, so launching the same ticker elsewhere later gives you a second, separate market.
                    </p>
                  </div>
                  <div className="bg-surface p-3">
                    <p className="text-[9px] uppercase tracking-wider text-ink-faint">No bridging</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
                      Nothing moves between chains, so the price on 0G and Base can differ. Arbitrage is up to the market.
                    </p>
                  </div>
                  <div className="bg-surface p-3">
                    <p className="text-[9px] uppercase tracking-wider text-ink-faint">Per-chain cost</p>
                    {/* Dulu "usually under $0.10" — angka tulisan tangan yang sudah salah untuk
                        Arbitrum (~$0.18 terukur 2026-09-30). Angka hidupnya ada di kartu biaya. */}
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
                      Gas only — the live figure for each chain is in the cost card above. You need a little of that
                      chain&apos;s native asset to pay it — <span className="text-ok">no liquidity deposit</span>.
                    </p>
                  </div>
                </div>
                <p className="border-t border-line px-3 py-2 text-[10px] text-ink-faint">
                  A chain without enough gas is skipped on its own — the others still launch.
                </p>
              </div>

              <p className="text-[9px] text-ink-faint leading-relaxed">
                Each selected chain gets its own transaction to{" "}
                <code className="text-accent">deployTrinityProject</code>, simulated first so a revert costs no gas. The
                token and pool addresses come from the receipt event and are verified server-side before the market is
                registered.
              </p>
              </>
              )}
            </div>
          )}
        </div>

        {/* Right: rel yang menempel — ringkasan launch di atas, co-pilot di bawah. */}
        {/* top-20 = 70px (rem situs 14px) = navbar 57px + 13px. Sticky baru bekerja setelah body berhenti
            menjadi kontainer gulir (lihat catatan overflow-x di globals.css); dengan top-4 rel
            ini menempel DI BAWAH navbar dan kepalanya tertutup. */}
        <div className="space-y-3 lg:sticky lg:top-20 lg:col-span-4">
          {/* Ringkasan launch.
              HANYA MEMBACA state yang sudah ada (nama, ticker, logo, supply, chain
              tujuan, pembagian fee yang sudah dihitung di atas). Tidak ada input, tidak
              ada tombol, dan tidak ada aritmetika baru di sini — supaya panel ini tidak
              bisa berselisih dengan calldata, dan supaya selector audit yang mencari
              `input[value="AQUANT"]` atau tombol "Launch on" tetap menunjuk formulir. */}
          <div className="overflow-hidden rounded-card border border-line bg-surface shadow-[var(--shadow-panel)]">
            <div className="flex items-center justify-between gap-2 border-b border-line bg-cream-2 px-3 py-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-soft">Your launch</span>
              <span
                className={`rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                  attestation ? "border-ok/30 bg-ok/10 text-ok" : "border-warn/30 bg-warn/10 text-warn"
                }`}
              >
                {attestation ? "attested" : "not attested"}
              </span>
            </div>

            <div className="flex items-center gap-3 px-3 py-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-accent/30 bg-cream-2 p-1">
                <img src={generatedLogo ?? "/logo.svg"} alt="" aria-hidden="true" className="h-full w-full object-contain" />
              </div>
              <div className="min-w-0">
                <p className="truncate font-display text-[16px] font-medium text-ink">{tokenName || "Untitled"}</p>
                <p className="truncate text-[11px] text-ink-faint">
                  ${tokenTicker.trim().toUpperCase() || "—"} · {launchTargets[0]?.key ?? "no chain selected"}
                </p>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-px border-t border-line bg-cream-3 text-[11px]">
              <div className="bg-surface px-3 py-2">
                <dt className="text-[9px] uppercase tracking-wider text-ink-faint">Supply</dt>
                <dd className="mt-0.5 font-medium text-ink" data-numeric>
                  {supplyNumber > 0 ? supplyNumber.toLocaleString("en-US") : "—"}
                </dd>
              </div>
              <div className="bg-surface px-3 py-2">
                <dt className="text-[9px] uppercase tracking-wider text-ink-faint">You keep</dt>
                <dd className="mt-0.5 font-medium text-ok" data-numeric>
                  {creatorCut.toFixed(2)}% of swaps
                </dd>
              </div>
              <div className="bg-surface px-3 py-2">
                <dt className="text-[9px] uppercase tracking-wider text-ink-faint">Trader pays</dt>
                <dd className="mt-0.5 font-medium text-ink" data-numeric>
                  {totalPaidPct.toFixed(2)}%
                </dd>
              </div>
              <div className="bg-surface px-3 py-2">
                <dt className="text-[9px] uppercase tracking-wider text-ink-faint">Your allocation</dt>
                <dd className="mt-0.5 font-medium text-ink">0 tokens</dd>
              </div>
            </dl>

            <p className="flex items-start gap-1.5 border-t border-line px-3 py-2 text-[10px] leading-relaxed text-ink-faint">
              <Droplets className="mt-0.5 h-3 w-3 shrink-0 text-ok" />
              <span>
                {/* Depth dan kaki protokol menunggu `feeLegsKnown`, sama seperti tombol tier: sebelum
                    /api/deploy menjawab, depth yang tertulis di sini adalah rumus 0.11.0 (0.20%)
                    padahal kurvanya akan ter-deploy dengan 0.10%. */}
                Gas only — <span className="text-ok">no liquidity deposit</span>. Split:{" "}
                <span data-testid="launch-summary-split">
                  {feeLegsKnown ? `${depthCut.toFixed(2)}% depth · ` : ""}
                  {creatorCut.toFixed(2)}% creator · {treasuryCut.toFixed(2)}% buyback
                  {feeLegsKnown && protocolCut > 0 ? ` · ${protocolCut.toFixed(2)}% protocol` : ""}
                </span>
                .
              </span>
            </p>
          </div>

          <div className="flex h-[480px] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-[var(--shadow-panel)] lg:h-[calc(100vh-13rem)]">
          <div className="p-2.5 border-b border-line bg-cream-2 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-accent flex items-center justify-center text-white">
                <Bot className="w-3 h-3" />
              </div>
              <span className="font-bold text-ink text-xs">0G TEE Co-Pilot</span>
              <span className="text-[9px] font-mono text-accent bg-accent-soft px-1.5 py-0.5 rounded font-bold">
                {selectedModel}
              </span>
            </div>
            <button
              onClick={() => setMessages((prev) => prev.slice(0, 1))}
              className="p-1 text-ink-faint hover:text-ink"
              title="Reset chat"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>

          <div className="px-3 py-1 bg-cream-2 border-b border-line flex items-center justify-between text-[10px] text-ink-soft">
            <span>
              Target: <strong className="text-accent font-bold">{customSubdomain || "myswap"}.adexto.xyz</strong>
            </span>
            <span>
              Chains:{" "}
              <strong className="text-accent font-bold">
                {liveChains.length === 0
                  ? "none live"
                  : liveChains
                      .filter((c) => targetChainIds.includes(c.chainId))
                      .map((c) => c.key)
                      .join(", ") || "none selected"}
              </strong>
            </span>
          </div>

          <div ref={chatRef} className="flex-1 overflow-y-auto p-3 space-y-2.5 font-sans text-xs bg-cream-2">
            {messages.map((m, idx) => (
              <div key={idx} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "assistant" && (
                  <div className="w-5 h-5 rounded bg-accent-soft text-accent flex items-center justify-center shrink-0 mt-0.5">
                    <Cpu className="w-3 h-3" />
                  </div>
                )}
                <div
                  className={`max-w-[90%] rounded-xl p-2.5 leading-relaxed ${
                    m.role === "user"
                      ? "bg-accent-soft border border-accent/30 text-ink"
                      : "bg-surface border border-line text-ink"
                  }`}
                >
                  <span className="text-[9px] font-bold block mb-1 uppercase tracking-wider text-ink-faint">
                    {m.role === "user" ? "You" : `0G TEE (${selectedModel})`}
                  </span>
                  <div className="text-xs">
                    {m.content ? (
                      <FormattedMarkdown text={m.content} />
                    ) : chatLoading && idx === messages.length - 1 ? (
                      /* Indikator berpikir yang BERGERAK.
                         Hitungan karakter datang dari kanal reasoning model lewat SSE,
                         jadi angkanya benar-benar naik selama model bekerja. Cuplikannya
                         ditulis miring dan pucat, dan diberi label "reasoning" secara
                         eksplisit — yang dulu salah bukan menampilkan reasoning,
                         melainkan menampilkannya sebagai jawaban. */
                      <span className="flex flex-col gap-1 text-xs">
                        <span className="flex items-center gap-1 text-accent">
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          Reasoning on 0G
                          {thinking && thinking.chars > 0 ? ` · ${thinking.chars} chars` : "…"}
                        </span>
                        {thinking?.preview && (
                          <span className="text-[10px] italic leading-snug text-ink-faint line-clamp-2">
                            {thinking.preview}
                          </span>
                        )}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}

            {messages.length <= 1 && !chatLoading && (
              <div className="space-y-1.5 pt-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Try asking</p>
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setInputMessage(prompt)}
                    className="w-full rounded-xl border border-line bg-surface px-2.5 py-2 text-left text-[11px] leading-relaxed text-ink-soft transition-colors hover:border-accent/40 hover:text-ink"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={sendMessage} className="p-2 border-t border-line bg-cream-2 flex gap-2 shrink-0">
            <input
              type="text"
              placeholder="Ask the 0G co-pilot…"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              disabled={chatLoading}
              className={FIELD_CLASS}
            />
            <button
              type="submit"
              disabled={chatLoading || !inputMessage.trim()}
              className="px-3 py-1.5 rounded-lg font-bold text-xs bg-accent hover:bg-accent-strong text-white disabled:opacity-50"
            >
              <Send className="w-3 h-3" />
            </button>
          </form>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── presentational helpers ──────────────────────────────────────────────────

/**
 * Pembungkus satu langkah peluncuran.
 *
 * Prop `tone` dihapus. Ia dulu menerima "pink" | "purple" | "cyan" dan memilih
 * warna tepi serta judul — tetapi setelah palet disatukan menjadi satu aksen,
 * ketiga cabangnya mengembalikan kelas yang sama persis. Yang tertinggal hanyalah
 * ternary yang menyaran ada perbedaan padahal tidak ada, dan setiap pemanggil
 * harus memilih salah satu warna tanpa akibat apa pun.
 *
 * `id` ditambahkan supaya rel langkah di atas panel bisa menggulir ke sini.
 */
function Section({
  id,
  step,
  title,
  hint,
  blurb,
  defaultOpen = true,
  children,
}: {
  id: string;
  step: number;
  title: string;
  /** Ringkasan satu baris yang tetap terbaca saat panelnya tertutup. */
  hint?: string;
  /** Satu kalimat "langkah ini untuk apa", dengan bahasa orang yang baru pertama kali. */
  blurb?: string;
  /**
   * Terbuka saat halaman dimuat.
   *
   * Langkah "Token" TETAP terbuka, dan itu bukan pilihan gaya: harness peluncuran
   * mengisi `input[value="AQUANT"]` dan `input[value="Aegis Quant AI"]` secara langsung,
   * dan Playwright menunggu elemen TERLIHAT sebelum menulis — isi `<details>` yang
   * tertutup ada di DOM tapi tidak terlihat, jadi mengunci langkah itu tertutup akan
   * membuat setiap harness gagal di baris yang tidak menyebut sebabnya.
   */
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      id={id}
      open={defaultOpen}
      className="group scroll-mt-12 rounded-xl border border-line bg-cream-2 [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 p-3.5">
        <div className="min-w-0">
          <SectionHeading step={step} title={title} />
          {blurb ? <p className="mt-0.5 pl-8 text-[11.5px] leading-snug text-ink-faint">{blurb}</p> : null}
          {/* Di ponsel ringkasan pindah ke bawah judul: di kanan ia terpotong jadi "1.00% sw…". */}
          {hint ? <p className="mt-0.5 pl-8 text-[11px] font-medium text-accent sm:hidden">{hint}</p> : null}
        </div>
        {hint ? <span className="ml-auto hidden truncate text-[10.5px] text-ink-faint sm:inline">{hint}</span> : null}
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform duration-200 group-open:rotate-180 ${
            hint ? "" : "ml-auto"
          }`}
        />
      </summary>
      <div className="space-y-2.5 px-3.5 pb-3.5">{children}</div>
    </details>
  );
}

function SectionHeading({ step, title }: { step: number; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white shadow-[var(--glow-accent)]"
      >
        {step}
      </span>
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
    </div>
  );
}

/**
 * Rel langkah.
 *
 * Sebelumnya panel kiri adalah satu kolom bergulir setinggi ~2.400 px berisi
 * spanduk peringatan, matriks chain, tiga seksi bernomor, dua kotak verifikasi,
 * tombol launch, lalu tabel penjelasan — tanpa satu pun penunjuk posisi. Efeknya:
 * tidak terlihat ada berapa langkah, di langkah mana kita berada, dan yang paling
 * merugikan, APA yang masih menahan tombol launch. Tombolnya sendiri hanya bisa
 * menyebut satu penghalang sekaligus ("Sign attestation to unlock"), jadi
 * penghalang berikutnya baru muncul setelah yang pertama beres.
 *
 * Rel ini murni pembacaan: setiap `done` dihitung dari state yang sudah ada dan
 * tidak ada nilai baru yang mengalir ke `canDeploy`, ke calldata, atau ke server.
 */
function StepRail({
  steps,
}: {
  steps: Array<{ id: string; label: string; done: boolean }>;
}) {
  return (
    <nav aria-label="Launch steps" className="sticky top-16 z-10 -mx-3 mb-1 bg-surface/95 px-3 pb-2 pt-1 backdrop-blur sm:-mx-4 sm:px-4">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-[10px]">
        {steps.map((step, i) => (
          <li key={step.id} className="flex items-center gap-1">
            <a
              href={`#${step.id}`}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors ${
                step.done
                  ? "border-ok/30 bg-ok/10 text-ok"
                  : "border-line bg-cream-2 text-ink-soft hover:text-ink"
              }`}
            >
              {step.done ? (
                <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-3 w-3 shrink-0 items-center justify-center rounded-full border border-current text-[7px] font-bold"
                >
                  {i + 1}
                </span>
              )}
              <span className="font-bold uppercase tracking-wider">{step.label}</span>
              <span className="sr-only">{step.done ? " — done" : " — not done yet"}</span>
            </a>
            {i < steps.length - 1 && (
              <span aria-hidden="true" className="h-px w-2 bg-line-strong" />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Field({
  label,
  hint,
  hintTone = "muted",
  children,
}: {
  label: string;
  hint?: string;
  hintTone?: "ok" | "error" | "muted";
  children: React.ReactNode;
}) {
  const hintColor = hintTone === "ok" ? "text-ok" : hintTone === "error" ? "text-danger" : "text-ink-faint";
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-ink-soft">{label}</span>
        {hint && <span className={`text-[10px] ${hintColor} truncate`}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function ResultRow({ result }: { result: ChainResult }) {
  const tone =
    result.status === "success"
      ? "bg-ok/10 border-ok/30 text-ok"
      : result.status === "failed"
      ? "bg-danger/10 border-danger/30 text-danger"
      : "bg-cream-3/[0.03] border-line text-ink-soft";

  return (
    <div className={`p-2 rounded-xl border flex items-center justify-between gap-2 text-[10px] ${tone}`}>
      <span className="font-bold shrink-0">{result.chainName}</span>
      <span className="flex items-center gap-1.5 min-w-0">
        {result.status === "success" ? (
          <CheckCircle2 className="w-3 h-3 text-ok shrink-0" />
        ) : result.status === "failed" ? (
          <XCircle className="w-3 h-3 text-danger shrink-0" />
        ) : (
          <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
        )}
        <span className="truncate">{result.message ?? result.status}</span>
      </span>
    </div>
  );
}

function DeployReport({
  results,
  symbol,
  name,
  onReset,
}: {
  results: ChainResult[];
  symbol: string;
  /** Nama token, untuk draf pengumuman. */
  name: string;
  onReset: () => void;
}) {
  const successes = results.filter((r) => r.status === "success");
  const failures = results.filter((r) => r.status === "failed");
  const allFailed = successes.length === 0;

  return (
    <div className="space-y-4 my-auto">
      <div
        className={`relative overflow-hidden p-4 rounded-2xl border space-y-1 ${
          allFailed ? "bg-danger/10 border-danger/30" : "bg-ok/10 border-ok/30"
        }`}
      >
        {!allFailed && (
          <Mascot
            pose="celebrate"
            className="mascot-float pointer-events-none absolute -bottom-2 right-2 h-20 w-auto opacity-95 sm:h-24"
          />
        )}
        <div className={`flex items-center gap-2 font-bold text-sm ${allFailed ? "text-danger" : "text-ok"}`}>
          {allFailed ? <XCircle className="w-5 h-5 text-danger" /> : <CheckCircle2 className="w-5 h-5 text-ok" />}
          {allFailed
            ? `Launch failed on all ${results.length} chain(s)`
            : `${symbol} live on ${successes.length} of ${results.length} chain(s)`}
        </div>
        {!allFailed && (
          <p className="max-w-[75%] text-[12.5px] leading-relaxed text-ink-soft">
            It is trading now. Tell people where to find it — your share of every swap starts with the first trade.
          </p>
        )}
        {failures.length > 0 && !allFailed && (
          <p className="text-[11px] text-warn">
            {failures.length} chain(s) failed — details below. Nothing was registered for those.
          </p>
        )}
      </div>

      <div className="space-y-2 font-mono text-xs">
        {results.map((r) => (
          <div
            key={r.chainId}
            className={`p-3 rounded-xl border space-y-1.5 ${
              r.status === "success" ? "bg-cream-2 border-ok/30" : "bg-cream-2 border-danger/30"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-ink">
                {r.chainName} <span className="text-ink-faint">({r.chainId})</span>
              </span>
              <span className={r.status === "success" ? "text-ok" : "text-danger"}>{r.status}</span>
            </div>

            {r.status === "success" ? (
              <div className="space-y-1 text-[11px]">
                <Row label="Token" value={r.tokenAddress ?? "—"} />
                <Row label="Pool" value={r.poolAddress ?? "—"} />
                {r.explorerTx && (
                  <a
                    href={r.explorerTx}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline block"
                  >
                    View launch transaction →
                  </a>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-danger leading-relaxed">{r.message}</p>
            )}
          </div>
        ))}
      </div>

      {/* Pengumuman: setiap peluncuran langsung punya jalur publikasi, dari akun peluncur
          sendiri. Satu blok per chain yang berhasil, karena tiap chain adalah pasar sendiri. */}
      {successes
        .filter((r) => r.tokenAddress)
        .map((r) => (
          <LaunchAnnouncement
            key={`announce-${r.chainId}`}
            name={name}
            symbol={symbol}
            chainName={r.chainName}
            chainId={r.chainId}
            tokenAddress={r.tokenAddress as string}
          />
        ))}

      <div className="flex flex-col sm:flex-row gap-3 pt-2 font-sans">
        <button
          onClick={onReset}
          className="flex-1 py-2.5 rounded-xl bg-cream-3 hover:bg-cream-3 text-ink font-semibold text-xs transition-all"
        >
          Launch another
        </button>
        {successes.length > 0 && (
          <Link
            // `?chain=` dipaku: ticker yang sama bisa punya pasar di chain lain, dan tanpa ini
            // tombolnya membuka pasar tertua, bukan yang baru saja diluncurkan.
            href={`/token/${symbol.toLowerCase()}?chain=${successes[0].chainId}`}
            className="flex-1 py-2.5 rounded-xl bg-accent hover:bg-accent-strong text-white font-semibold text-xs text-center flex items-center justify-center gap-1"
          >
            Open ${symbol} terminal →
          </Link>
        )}
      </div>
      {successes.length > 0 && (
        <p className="text-center font-sans text-[11px] text-ink-soft">
          Your share of every swap accrues from the first trade.{" "}
          <Link href="/creator" className="font-semibold text-accent hover:underline" data-testid="report-creator-link">
            Track and claim it on Creator earnings
          </Link>
          .
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-ink-soft shrink-0">{label}:</span>
      <span className="text-accent font-bold truncate">{value}</span>
    </div>
  );
}
