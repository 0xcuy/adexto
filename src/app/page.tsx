/* Halaman depan.
 *
 * Susunannya mengikuti pola launcher yang paling mudah diadopsi (hero berpintu, lalu
 * pasar yang hidup), tetapi dengan bobot data ADEXTO sendiri:
 *
 *   1. hero: satu janji, dua tombol, empat PINTU BERGAMBAR (trade · launch · swap · compute)
 *   2. pasar yang hidup di kiri + tiga langkah meluncurkan di kanan
 *   3. pita empat angka faktual
 *   4. apa yang dibuka satu launch (empat kartu)
 *   5. untuk siapa (empat kartu kecil — dilipat ke dalam, bukan seksi besar)
 *   6. apa yang ditegakkan kontrak (tiga poin)
 *   7. pertanyaan + biaya per chain + ABI, SEMUA DILIPAT supaya halaman tidak ramai
 *
 * Tidak ada klaim baru. Setiap kalimat diambil dari versi yang sudah diaudit
 * (audit_claims / audit_consistency); yang berubah hanya panjang dan susunannya.
 */

import Link from "next/link";
import {
  ArrowRight,
  ArrowDownUp,
  Bot,
  CandlestickChart,
  CheckCircle2,
  ChevronDown,
  CloudLightning,
  Coins,
  Compass,
  Cpu,
  Lock,
  MessagesSquare,
  Music2,
  Palette,
  PenLine,
  Rocket,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import Mascot, { type MascotPose } from "@/components/Mascot";
import HeroSparks from "@/components/landing/HeroSparks";
import LiveMarkets from "@/components/landing/LiveMarkets";
import TiltStage from "@/components/landing/TiltStage";
import TerminalShowcase from "@/components/landing/TerminalShowcase";
import { launchCosts, launchCostRange, formatUsd } from "@/lib/launch-cost";
import { CURVE_FACTORY_GENERATION } from "@/config/contracts";
import { CHAIN_LIST, chainMark } from "@/lib/chains";

/**
 * Baris logo di bawah pintu hero: chain yang factory peluncurannya benar-benar ada
 * (`dexLive`), dalam urutan CHAIN_LIST. Chain tanpa factory tidak ditulis "live", dan chain
 * tanpa logo (devchain) tidak diberi logo karangan — keduanya disaring di sini.
 */
const HERO_CHAINS = CHAIN_LIST.filter((c) => c.dexLive && chainMark(c));

/**
 * Kontrak yang ABI-nya diterbitkan. Daftar ini WAJIB sama dengan isi public/abi/,
 * dan audit_consistency memeriksanya.
 */
const ABI_FILES = ["AdextoFactory", "AdextoCurve", "AdextoToken"] as const;

/** Pintu masuk bergambar. Satu tujuan, satu kata, satu pose maskot. */
const DOORS: Array<{ href: string; label: string; hint: string; pose: MascotPose; icon: typeof Rocket }> = [
  { href: "/explorer", label: "Trade", hint: "live markets", pose: "run", icon: Compass },
  { href: "/studio", label: "Launch", hint: "gas only", pose: "celebrate", icon: Rocket },
  { href: "/swap", label: "Swap", hint: "any chain", pose: "point", icon: ArrowDownUp },
  { href: "/agent-compute", label: "Compute", hint: "stake for AI", pose: "think", icon: Cpu },
];

/**
 * Kemampuan yang dibawa SETIAP pasar, ditumpuk di samping maskot utama.
 *
 * Ketiganya adalah versi pendek dari kartu "What your market opens with" di bawah, jadi
 * tidak ada klaim baru di sini — yang berubah hanya panjangnya. Dua hal sengaja dijaga:
 *
 *   - x402 ditulis "pay from another chain", BUKAN "bridge". Tidak ada yang dijembatani:
 *     pembeli membayar dengan aset yang sudah dipegangnya lewat HTTP. Menyebutnya bridge
 *     akan menjanjikan mekanisme yang tidak ada di kode.
 *   - "its own agent" merujuk agen yang menjawab tentang pasarnya di 0G Compute, bukan
 *     agen yang memperdagangkannya.
 */
const CAPABILITIES: Array<{ label: string; body: string; hint: string; pose: MascotPose; icon: typeof Rocket; href: string }> = [
  {
    label: "MCP ready",
    body: "Agents find and price it",
    hint: "from the launch transaction",
    pose: "threequarter",
    icon: Bot,
    href: "/mcp",
  },
  {
    label: "Pay from any chain",
    body: "USDC on Base buys it",
    hint: "x402 over HTTP · no bridging",
    pose: "idle",
    icon: CloudLightning,
    href: "/x402",
  },
  {
    /**
     * Ini agen MILIK PASAR ITU — yang menjawab pemegangnya di halaman pasarnya,
     * dengan identitas yang diikat ke kurva pada transaksi peluncuran.
     *
     * Tautannya SENGAJA bukan `/agent-compute`: halaman itu soal staking $ADEXTO untuk
     * membuka jatah compute, bukan soal agen per-token, jadi mengirim orang ke sana
     * menjawab pertanyaan yang berbeda dari yang dibangkitkan kartu ini.
     * `/docs/agent-identity` adalah satu-satunya halaman yang benar-benar menjelaskan
     * pengikatan itu (ERC-8004, kepemilikan diperiksa saat deploy), jadi ke sana.
     */
    label: "Its own agent",
    body: "Answers your holders",
    hint: "bound to the market at launch",
    pose: "wave",
    icon: MessagesSquare,
    href: "/docs/agent-identity",
  },
];

const STEPS = [
  {
    icon: Wallet,
    title: "Connect a wallet",
    body: "Pick Monad, Arbitrum, Robinhood Chain, Base or 0G. Each chain is its own market with its own price.",
  },
  {
    icon: PenLine,
    title: "Name it, sign it",
    body: "Name, ticker and an emblem — upload one or generate it on 0G Compute. One signature proves you own the address.",
  },
  {
    icon: Rocket,
    title: "It trades immediately",
    body: "One transaction opens the curve with 100% of supply inside. You hold none of it and earn from every swap.",
  },
];

const OPENS_WITH = [
  {
    icon: CandlestickChart,
    title: "A trading terminal",
    body: "Candles from one second to one year, RSI, MACD, Bollinger and VWAP, a live order book and a trade feed — from the first block.",
  },
  {
    icon: MessagesSquare,
    title: "An agent that answers for it",
    body: "Holders can ask about the curve, the fee split or the depth. It runs on 0G Compute rather than a scripted FAQ.",
  },
  {
    icon: CloudLightning,
    title: "A price payable from another chain",
    body: "A buyer holding only USDC on Base can take a position over plain HTTP, without bridging or holding your chain's gas token.",
  },
  {
    icon: Bot,
    title: "Buyers that are machines",
    body: "AI agents find, price and buy your market through MCP the moment it launches. There is no listing step.",
  },
];

const AUDIENCE = [
  { icon: Palette, title: "Artists", body: "Give collectors a market to back your work." },
  { icon: Music2, title: "Musicians", body: "Something fans can hold between releases." },
  { icon: Users, title: "Communities", body: "One token for your group, trading from block one." },
  { icon: Bot, title: "Builders", body: "Agents and apps can price it over HTTP." },
];

const ENFORCED = [
  { icon: CheckCircle2, title: "The creator holds nothing.", body: "100% of supply enters the curve, so there is no allocation to sell." },
  { icon: Lock, title: "No withdrawal function exists.", body: "Nobody can drain a curve — not the creator, not us." },
  { icon: ShieldCheck, title: "Fees are immutable.", body: "0.70% to the creator, set at deployment, with no setter and no admin." },
];

const FAQ = [
  {
    q: "What actually stops the developer from rugging?",
    a: "Mostly the cap table, not the enclave. The creator receives zero tokens, so there is no position to dump; the curve has no withdrawal function, so the reserve cannot be drained by anyone including us; and the agent address is fixed at launch. Those three are enforced in the contracts and you can read them. 0G's router reports Intel TDX attestation through dstack for every model we call — /docs shows that read live — but we cannot obtain the raw quote, so do not treat it as something ADEXTO proved.",
  },
  {
    q: "What stops a sniper from taking the whole launch?",
    a: "For 180 seconds after launch, AdextoToken._update refuses any transfer that would leave a wallet holding more than 1% of supply, so splitting a buy across many transactions does not get around it. The window is measured in seconds, so it is the same length on every chain. Every swap also carries a slippage bound and a deadline, and buys are simulated before signing so a trade that would revert never costs gas.",
  },
  {
    q: "Where does the creator's money come from?",
    a: "From inside the 1.00% a trader already pays, not from an extra fee on top. On the current factory that splits into 0.70% to the creator, 0.10% that stays in the curve as depth, 0.10% for the buyback and 0.10% for the protocol. Markets from earlier factories keep their own immutable split, shown on each market's page. The creator holds no supply, so the only way to get paid is for the market to trade.",
  },
  {
    q: "Is there a graduation step?",
    a: "No. The curve is the permanent venue, so the migration into an external pool — where most launchpad exploits have happened — simply is not in the design.",
  },
];

const faqItem = "group card rounded-panel px-5 py-4 [&_summary::-webkit-details-marker]:hidden";
const faqSummary = "flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium text-ink";
const faqChevron = "h-4 w-4 shrink-0 text-ink-faint transition-transform duration-300 group-open:rotate-180";

export default async function HomePage() {
  const costs = await launchCosts();
  const costRange = launchCostRange(costs);

  return (
    <div className="relative flex flex-col">
      {/* ── HERO ─────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <HeroSparks className="absolute inset-0 h-full w-full" />
        {/* Dua cahaya dengan kecepatan paralaks berbeda: yang besar di kanan turun lebih lambat
            dari halaman, yang kecil di kiri lebih lambat lagi — dari situ kedalamannya terbaca. */}
        <div
          aria-hidden="true"
          className="px-layer pointer-events-none absolute -right-40 top-10 h-[620px] w-[620px] rounded-full opacity-70 blur-3xl"
          style={{
            background: "radial-gradient(closest-side, rgb(var(--accent-fill-rgb) / 0.28), transparent)",
            ["--px-y" as string]: "170px",
          }}
        />
        <div
          aria-hidden="true"
          className="px-layer pointer-events-none absolute -left-56 top-72 h-[460px] w-[460px] rounded-full opacity-50 blur-3xl"
          style={{
            background: "radial-gradient(closest-side, rgb(var(--accent-fill-rgb) / 0.2), transparent)",
            ["--px-y" as string]: "90px",
          }}
        />

        <div className="relative mx-auto grid w-full max-w-7xl items-center gap-10 px-4 pb-14 pt-10 sm:px-6 sm:pt-14 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:px-8 lg:pb-20 lg:pt-20">
          <div className="px-fade">
            <p className="kicker mb-5">ADEXTO Protocol v{CURVE_FACTORY_GENERATION.version}</p>

            {/* Di bawah lg, robotnya BERDAMPINGAN dengan judul.
                Maskot utama sebelumnya hanya dirender dari lg ke atas, jadi pengunjung ponsel —
                mayoritasnya — tidak pernah melihat karakter yang membawa identitas situs ini;
                yang tersisa hanya empat maskot mungil di kartu pintu. Diletakkan di SAMPING
                judul, bukan di atasnya, supaya ia tidak mendorong tombol utama ke bawah lipatan:
                judul dan robot menempati baris yang sama. */}
            <div className="flex items-start gap-4 lg:block">
              <h1 className="min-w-0 flex-1 text-[2.1rem] font-light leading-[1.05] tracking-[-0.04em] text-ink sm:text-5xl lg:text-[4.6rem] lg:leading-[1.02]">
                Open a market, <span className="font-normal text-accent">not just a token.</span>
              </h1>
              <div aria-hidden="true" className="relative shrink-0 lg:hidden">
                <div
                  className="absolute inset-0 rounded-full opacity-70 blur-2xl"
                  style={{ background: "radial-gradient(closest-side, rgb(var(--accent-fill-rgb) / 0.4), transparent)" }}
                />
                <Mascot
                  pose="front"
                  priority
                  className="mascot-float relative h-32 w-auto drop-shadow-[0_14px_28px_rgba(76,29,149,0.45)] sm:h-40"
                />
              </div>
            </div>

            <p className="mt-6 max-w-xl text-[16px] leading-relaxed text-ink-soft sm:text-lg">
              One transaction, gas only, no liquidity deposit. You hold none of the supply, and{" "}
              <span className="font-semibold text-ink" data-numeric>
                0.70%
              </span>{" "}
              of every trade is yours for as long as it trades.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/studio"
                className="btn-glow inline-flex h-12 items-center gap-2 rounded-2xl bg-accent px-6 text-[15px] font-semibold text-white hover:bg-accent-strong"
              >
                Open Studio <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/explorer"
                className="inline-flex h-12 items-center gap-2 rounded-2xl border border-line bg-surface/60 px-6 text-[15px] font-semibold text-ink backdrop-blur transition-colors hover:border-accent/50 hover:text-accent"
              >
                See a live market <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            {/* Empat pintu bergambar. Ini jalan masuk utama ke seluruh situs. */}
            <nav aria-label="Where to start" className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {DOORS.map(({ href, label, hint, pose, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="glass group relative flex h-36 flex-col justify-end overflow-hidden rounded-panel p-3 transition-[transform,border-color,box-shadow] duration-300 ease-settle hover:-translate-y-1 hover:border-accent/40 hover:shadow-[var(--glow-accent)] sm:h-44"
                >
                  <div
                    aria-hidden="true"
                    className="absolute inset-x-0 top-0 h-2/3 opacity-60 transition-opacity duration-300 group-hover:opacity-100"
                    style={{ background: "radial-gradient(60% 70% at 50% 40%, rgb(var(--accent-fill-rgb) / 0.35), transparent)" }}
                  />
                  <Mascot
                    pose={pose}
                    className="absolute left-1/2 top-2 h-[62%] w-auto -translate-x-1/2 drop-shadow-[0_10px_18px_rgba(0,0,0,0.35)] transition-transform duration-500 ease-settle group-hover:-translate-y-1 group-hover:scale-105"
                  />
                  <span className="relative flex items-end justify-between">
                    <span>
                      <span className="block font-display text-[17px] font-medium leading-tight text-ink">{label}</span>
                      <span className="block text-[11px] text-ink-faint">{hint}</span>
                    </span>
                    <Icon className="h-4 w-4 text-ink-faint transition-colors group-hover:text-accent" />
                  </span>
                </Link>
              ))}
            </nav>

            {/* Chain tempat pasar bisa dibuka, di celah kecil di bawah pintu. Logo tidak dipotong
                bulat: logo Base persegi, dan memotong logo dicantumkan sebagai penyalahgunaan di
                brand kit pemiliknya. */}
            {HERO_CHAINS.length > 0 ? (
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="hero-chains">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">Live on</span>
                <ul aria-label="Chains with a live launch factory" className="flex flex-wrap items-center gap-2">
                  {HERO_CHAINS.map((c) => (
                    <li
                      key={c.chainId}
                      className="glass inline-flex h-8 items-center gap-2 rounded-full pl-2 pr-3 text-[12.5px] font-medium text-ink"
                    >
                      <img
                        src={chainMark(c) as string}
                        alt=""
                        aria-hidden="true"
                        width={18}
                        height={18}
                        className="h-[18px] w-[18px] object-contain"
                      />
                      {c.key}
                    </li>
                  ))}
                  {/* Robinhood Chain comes from CHAIN_LIST like every other chain, and only once
                      NEXT_PUBLIC_CURVE_FACTORY_ROBINHOOD is set, so the chip never claims a
                      factory that is not wired. */}
                </ul>
              </div>
            ) : null}

            {/* Versi ponsel/tablet dari tumpukan kemampuan di kolom kanan: di bawah lg
                kolom itu tidak dirender, dan kemampuan ini tidak boleh hanya ada di
                desktop. Tanpa maskot di sini — pintu di atasnya sudah bergambar. */}
            <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3 lg:hidden">
              {CAPABILITIES.map(({ label, body, hint, icon: Icon, href }) => (
                <li key={label}>
                  <Link
                    href={href}
                    className="glass group flex h-full items-start gap-2.5 rounded-panel px-3 py-2.5 transition-colors hover:border-accent/40"
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    <span>
                      <span className="block text-[13px] font-semibold text-ink">{label}</span>
                      <span className="block text-[11px] leading-snug text-ink-soft">{body}</span>
                      <span className="block text-[10px] leading-snug text-ink-faint">{hint}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Maskot utama + tumpukan kemampuan. Hanya dari lg ke atas.
              Dua chip melayang yang dulu di sini ("Cost to launch: Gas only" dan
              "Creator take: 0.70%") DICABUT: kedua angka itu sudah diucapkan kalimat hero
              tepat di sebelahnya, jadi mereka mengulang dengan bobot visual besar sambil
              memakan tempat yang sekarang dipakai kemampuan yang belum disebut di mana pun
              di layar pertama. */}
          <div className="hidden h-full min-h-[520px] items-center gap-4 lg:flex">
            {/* Panggung 3D. Tiga kedalaman — cincin orbit di belakang, bayangan di tengah,
                robot di depan — dimiringkan bersama oleh TiltStage, jadi lapisan depan
                bergeser lebih jauh dari yang belakang. Lapisannya pembungkus terpisah dari
                animasi `mascot-float`/`mascot-orbit`, karena keduanya juga memakai `transform`. */}
            <div className="px-layer relative flex h-full flex-1 items-center justify-center" style={{ ["--px-y" as string]: "90px" }}>
              <TiltStage className="h-full min-h-[520px] w-full" max={8}>
                <div aria-hidden="true" className="depth-back pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="mascot-orbit absolute h-[400px] w-[400px] rounded-full border border-accent/20" />
                  <div className="mascot-orbit mascot-orbit--slow absolute h-[510px] w-[510px] rounded-full border border-dashed border-line-strong/60" />
                </div>
                <div aria-hidden="true" className="depth-mid pointer-events-none absolute inset-x-0 bottom-12 flex justify-center">
                  <div className="h-10 w-56 rounded-[100%] bg-black/40 blur-xl" />
                </div>
                <div className="depth-front relative">
                  <Mascot pose="front" priority className="mascot-float relative h-[420px] w-auto drop-shadow-[0_30px_60px_rgba(76,29,149,0.45)]" />
                </div>
              </TiltStage>
            </div>

            {/* Tumpukan vertikal, tinggi tiap kartu sama dengan kartu pintu di kiri. Bergerak
                lebih cepat dari robot saat digulir: lapisan terdekat, jadi paling jauh bergeser. */}
            <ul className="px-layer flex w-[186px] shrink-0 flex-col gap-3" style={{ ["--px-y" as string]: "-120px" }}>
              {CAPABILITIES.map(({ label, body, hint, pose, icon: Icon, href }) => (
                <li key={label}>
                  <Link
                    href={href}
                    className="glass group relative flex h-44 flex-col justify-end overflow-hidden rounded-panel p-3 transition-[transform,border-color,box-shadow] duration-300 ease-settle hover:-translate-y-1 hover:border-accent/40 hover:shadow-[var(--glow-accent)]"
                  >
                    <div
                      aria-hidden="true"
                      className="absolute inset-x-0 top-0 h-2/3 opacity-60 transition-opacity duration-300 group-hover:opacity-100"
                      style={{ background: "radial-gradient(60% 70% at 50% 40%, rgb(var(--accent-fill-rgb) / 0.35), transparent)" }}
                    />
                    <Mascot
                      pose={pose}
                      className="absolute left-1/2 top-2 h-[50%] w-auto -translate-x-1/2 drop-shadow-[0_10px_18px_rgba(0,0,0,0.35)] transition-transform duration-500 ease-settle group-hover:-translate-y-1 group-hover:scale-105"
                    />
                    <span className="relative">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-display text-[15px] font-medium leading-tight text-ink">{label}</span>
                        <Icon className="h-3.5 w-3.5 shrink-0 text-ink-faint transition-colors group-hover:text-accent" />
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-ink-soft">{body}</span>
                      <span className="mt-0.5 block text-[10px] leading-snug text-ink-faint">{hint}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── PASAR HIDUP + TIGA LANGKAH ───────────────────────────────────────── */}
      <section className="mx-auto grid w-full max-w-7xl gap-5 px-4 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:px-8">
        <LiveMarkets />

        <div className="glass relative overflow-hidden rounded-card p-6">
          <Mascot pose="wave" className="absolute -right-2 -top-1 h-32 w-auto opacity-95" />
          <p className="kicker">Launch in three steps</p>
          <h2 className="mt-3 max-w-[14rem] text-[26px] font-medium leading-tight tracking-tight text-ink">
            From idea to a trading market.
          </h2>
          <ol className="mt-6 space-y-4">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="flex gap-3">
                <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <Icon className="h-4 w-4" />
                  <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-white">
                    {i + 1}
                  </span>
                </span>
                <span>
                  <span className="block text-[14px] font-semibold text-ink">{title}</span>
                  <span className="block text-[13px] leading-relaxed text-ink-soft">{body}</span>
                </span>
              </li>
            ))}
          </ol>
          <Link
            href="/studio"
            className="btn-glow mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[14px] font-semibold text-white hover:bg-accent-strong"
          >
            Open Studio <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* ── SHOWCASE TERMINAL 3D ─────────────────────────────────────────────── */}
      <TerminalShowcase />

      {/* ── APA YANG DIBUKA SATU LAUNCH ──────────────────────────────────────── */}
      <section className="relative mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div
          aria-hidden="true"
          className="px-view pointer-events-none absolute right-0 top-40 h-[380px] w-[520px] max-w-full rounded-full opacity-50 blur-3xl"
          style={{ background: "radial-gradient(closest-side, rgb(var(--accent-fill-rgb) / 0.22), transparent)", ["--px-y" as string]: "70px" }}
        />
        <div className="grid items-end gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="max-w-2xl">
            <p className="kicker mb-3">What your market opens with</p>
            <h2 className="text-3xl font-light tracking-tight text-ink sm:text-[2.6rem] sm:leading-[1.1]">
              A launchpad hands you a token page. <span className="text-accent">This hands you a venue.</span>
            </h2>
          </div>
          <Link
            href="/explorer"
            className="inline-flex items-center gap-2 text-[14px] font-semibold text-accent hover:underline underline-offset-4"
          >
            See a live market <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="reveal-3d-group relative mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {OPENS_WITH.map(({ icon: Icon, title, body }) => (
            <div key={title} className="reveal-3d adexto-lift glass rounded-card p-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-5 text-[17px] font-medium leading-snug text-ink">{title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{body}</p>
            </div>
          ))}
        </div>

        {/* Untuk siapa — sengaja kecil: satu baris chip, bukan seksi tersendiri. */}
        <ul className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {AUDIENCE.map(({ icon: Icon, title, body }) => (
            <li key={title} className="glass flex items-start gap-2.5 rounded-panel px-4 py-3">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <span>
                <span className="block text-[13px] font-semibold text-ink">{title}</span>
                <span className="block text-[12px] leading-relaxed text-ink-soft">{body}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── APA YANG DITEGAKKAN KONTRAK ──────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="glass relative overflow-hidden rounded-card p-6 sm:p-8">
          <Mascot pose="sit" className="absolute -bottom-2 right-4 hidden h-32 w-auto opacity-90 lg:block" />
          <p className="kicker mb-3">
            <ShieldCheck className="h-3.5 w-3.5" /> What the contract enforces
          </p>
          <h2 className="text-[26px] font-medium leading-tight tracking-tight text-ink sm:text-3xl">
            Nothing to rug, nothing to drain
          </h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3 lg:pr-40">
            {ENFORCED.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-soft">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
                <span>
                  <strong className="text-ink">{title}</strong> {body}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-6 text-[12px] leading-relaxed text-ink-faint lg:pr-40">
            There is no graduation step either: the curve is the permanent venue, so the migration into an external pool — where
            most launchpad exploits have happened — is not in the design.
          </p>
        </div>
      </section>

      {/* ── PERTANYAAN, BIAYA, ABI — semuanya dilipat ─────────────────────────── */}
      <section className="mx-auto w-full max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
        <p className="kicker mx-auto mb-3 w-fit">Questions we get asked</p>
        <h2 className="mb-8 text-center text-3xl font-light tracking-tight text-ink">The hard ones</h2>

        <div className="space-y-2.5">
          <details className={faqItem}>
            <summary className={faqSummary}>
              What does it cost to launch?
              <ChevronDown className={faqChevron} />
            </summary>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
              Only the chain&apos;s gas. <code className="text-accent">deployTrinity</code> is not{" "}
              <code className="text-accent">payable</code>, so the contract could not take a launch fee.
              {costRange ? (
                <>
                  {" "}
                  Right now that runs from <strong className="text-ink">{formatUsd(costRange.min.costUsd as number)}</strong> on{" "}
                  {costRange.min.chainName} to <strong className="text-ink">{formatUsd(costRange.max.costUsd as number)}</strong> on{" "}
                  {costRange.max.chainName}.
                </>
              ) : null}
            </p>
            <table className="mt-3 w-full text-left text-[13px]">
              <tbody>
                {costs.map((c) => (
                  <tr key={c.chainKey} className="border-b border-line/60 last:border-0">
                    <td className="py-2 pr-3 text-ink">
                      <Coins className="mr-1.5 inline h-3.5 w-3.5 text-ink-faint" />
                      {c.chainName}
                    </td>
                    <td className="py-2 text-right" data-numeric>
                      {c.live ? (
                        <span className="font-semibold text-ink">{formatUsd(c.costUsd as number)}</span>
                      ) : (
                        <span className="text-xs text-ink-faint">gas price unavailable</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
              Paid in each chain&apos;s own gas token and priced at page load, so these move with the market. No liquidity
              deposit is required and none is possible — 100% of supply enters the curve at genesis.
            </p>
          </details>

          {FAQ.map(({ q, a }) => (
            <details key={q} className={faqItem}>
              <summary className={faqSummary}>
                {q}
                <ChevronDown className={faqChevron} />
              </summary>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">{a}</p>
            </details>
          ))}
        </div>

        {/* Untuk developer: satu baris, bukan satu panel penuh. */}
        <p className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[12px] text-ink-faint">
          <span>
            Published interface · {CURVE_FACTORY_GENERATION.contract} {CURVE_FACTORY_GENERATION.version} ·
          </span>
          {ABI_FILES.map((name) => (
            <a key={name} href={`/abi/${name}.json`} className="font-mono text-accent hover:underline underline-offset-4">
              {name}
            </a>
          ))}
        </p>
        <p className="mt-1 text-center text-[11px] leading-relaxed text-ink-faint">
          Every deploy compares each published ABI byte for byte against the compiled artifact, so these cannot drift from what
          is running.
        </p>
      </section>

      {/* ── PENUTUP ──────────────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-4 pb-24 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-card border border-accent/25 bg-gradient-to-br from-accent/20 via-surface to-surface p-8 sm:p-12">
          <div
            aria-hidden="true"
            className="px-view pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full opacity-60 blur-3xl"
            style={{ background: "radial-gradient(closest-side, rgb(var(--accent-fill-rgb) / 0.35), transparent)", ["--px-y" as string]: "40px" }}
          />
          <div className="px-view absolute -bottom-3 right-6 hidden sm:block" style={{ ["--px-y" as string]: "-24px" }}>
            <Mascot pose="jump" className="mascot-float h-44 w-auto" />
          </div>
          <h2 className="max-w-xl text-3xl font-light tracking-tight text-ink sm:text-5xl">Open your market</h2>
          <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-ink-soft">
            One transaction and it is trading — with its terminal, its agent, and a price the rest of the internet can pay.
          </p>
          <Link
            href="/studio"
            className="btn-glow mt-8 inline-flex h-12 items-center gap-2 rounded-2xl bg-accent px-6 text-[15px] font-semibold text-white hover:bg-accent-strong"
          >
            Open Studio <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
