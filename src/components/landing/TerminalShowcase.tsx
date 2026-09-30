/**
 * Showcase 3D: terminal yang dibuka setiap pasar, digambar sebagai ilustrasi.
 *
 * SENGAJA ilustrasi, bukan tangkapan layar atau data hidup. Tangkapan layar membawa harga
 * dan ticker yang basi sehari kemudian, dan data hidup menambah permintaan jaringan ke
 * halaman yang paling perlu cepat — untuk hiasan. Jadi di sini tidak ada satu angka pun:
 * lilin dari jalan acak ber-seed tetap (hasilnya sama di setiap render, tanpa Math.random
 * sehingga tidak ada selisih hidrasi), tangga kedalaman dan feed berupa batang tanpa label.
 * Seluruh bingkainya `aria-hidden`; yang dibaca pembaca layar adalah judul dan chip di
 * sekitarnya, dan setiap chip menyebut fitur yang memang ada di TokenTerminal.
 *
 * Gerak 3D-nya CSS murni (`.showcase-3d` di globals.css): bingkai datang miring lalu
 * tegak saat masuk layar, chip melayang dengan kecepatan berbeda.
 */

type Candle = { o: number; c: number; h: number; l: number };

function candles(count: number, seed: number): Candle[] {
  // LCG kecil: deterministik, cukup acak untuk dilihat, dan identik di server dan klien.
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const out: Candle[] = [];
  let price = 40;
  for (let i = 0; i < count; i++) {
    const drift = 0.55 + Math.sin(i / 6) * 0.35; // naik pelan dengan gelombang
    const move = (rnd() - 0.42) * 6 + drift;
    const o = price;
    const c = Math.max(8, price + move);
    const h = Math.max(o, c) + rnd() * 3;
    const l = Math.min(o, c) - rnd() * 3;
    out.push({ o, c, h, l });
    price = c;
  }
  return out;
}

const SERIES = candles(46, 20260930);
const MIN = Math.min(...SERIES.map((k) => k.l));
const MAX = Math.max(...SERIES.map((k) => k.h));

const CHIPS: Array<{ label: string; body: string; pos: string; y: string }> = [
  // Offset dalam rem, bukan persen lebar bingkai: -6% pada lebar 1024–1150 mendorong chip keluar
  // layar (bingkai hampir selebar kontainer di sana). Mulai xl ada ruang untuk menjorok lebih jauh.
  { label: "Candles from one second", body: "up to 1y and All", pos: "top-14 lg:-left-3 xl:-left-12", y: "70px" },
  { label: "A depth ladder", body: "read from the curve's own reserves", pos: "top-8 lg:-right-3 xl:-right-10", y: "110px" },
  { label: "Your position and PnL", body: "from every fill since launch", pos: "bottom-12 lg:-left-2 xl:-left-6", y: "40px" },
  { label: "Holders, watchlist, share cards", body: "on every market page", pos: "bottom-20 lg:-right-2 xl:-right-8", y: "90px" },
];

function Chart() {
  const W = 560;
  const H = 220;
  const pad = 8;
  const step = (W - pad * 2) / SERIES.length;
  const y = (v: number) => pad + (1 - (v - MIN) / (MAX - MIN)) * (H - pad * 2);
  const up = "rgb(var(--ok-rgb))";
  const down = "rgb(var(--danger-rgb))";
  const line = SERIES.map((k, i) => `${i === 0 ? "M" : "L"}${(pad + i * step + step / 2).toFixed(1)},${y(k.c).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="showcase-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--accent-fill-rgb))" stopOpacity="0.28" />
          <stop offset="100%" stopColor="rgb(var(--accent-fill-rgb))" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} stroke="rgb(var(--line-rgb))" strokeOpacity="0.6" strokeDasharray="3 6" />
      ))}
      <path d={`${line} L${W - pad},${H} L${pad},${H} Z`} fill="url(#showcase-area)" />
      {SERIES.map((k, i) => {
        const x = pad + i * step + step / 2;
        const color = k.c >= k.o ? up : down;
        const top = y(Math.max(k.o, k.c));
        const bottom = y(Math.min(k.o, k.c));
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={y(k.h)} y2={y(k.l)} stroke={color} strokeWidth="1.2" />
            <rect x={x - step * 0.32} y={top} width={step * 0.64} height={Math.max(1.5, bottom - top)} rx="1" fill={color} />
          </g>
        );
      })}
    </svg>
  );
}

function Skeleton({ w, tone = "ink" }: { w: string; tone?: "ink" | "ok" | "danger" | "accent" }) {
  const bg =
    tone === "ok" ? "bg-ok/60" : tone === "danger" ? "bg-danger/55" : tone === "accent" ? "bg-accent/60" : "bg-ink/15";
  return <span className={`block h-2 rounded-full ${bg}`} style={{ width: w }} />;
}

export default function TerminalShowcase() {
  return (
    <section className="relative mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8" aria-labelledby="showcase-title">
      {/* Cahaya di belakang kaca: tanpa warna di belakangnya, kaca hanya terlihat abu-abu. */}
      <div
        aria-hidden="true"
        className="px-view pointer-events-none absolute left-1/2 top-1/3 h-[520px] w-[820px] max-w-full -translate-x-1/2 rounded-full opacity-70 blur-3xl"
        style={{ background: "radial-gradient(closest-side, rgb(var(--accent-fill-rgb) / 0.32), transparent)", ["--px-y" as string]: "90px" }}
      />

      <div className="relative mx-auto max-w-2xl text-center">
        <p className="kicker mx-auto mb-3 w-fit">The terminal</p>
        <h2 id="showcase-title" className="text-3xl font-light tracking-tight text-ink sm:text-[2.8rem] sm:leading-[1.08]">
          Every market opens with a terminal. <span className="text-ink-faint">Trading from the first block.</span>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-ink-soft">
          Candles, the curve&apos;s depth, the trade feed and your own position are there the moment the launch
          transaction lands. No listing, no waiting for an indexer.
        </p>
      </div>

      <div className="showcase-3d relative mx-auto mt-12 max-w-5xl sm:mt-16">
        <div aria-hidden="true" className="showcase-3d__device glass rounded-[28px] p-2.5 sm:p-4">
          <div className="overflow-hidden rounded-[20px] border border-line bg-cream/70">
            {/* Bilah atas: ticker, harga, chain — sebagai bentuk, bukan angka. */}
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-[11px] font-bold text-white">A</span>
              <span className="w-24">
                <Skeleton w="70%" />
                <span className="mt-1.5 block">
                  <Skeleton w="45%" />
                </span>
              </span>
              <span className="ml-2 hidden gap-1.5 sm:flex">
                {["1s", "1m", "1h", "1d", "All"].map((t, i) => (
                  <span
                    key={t}
                    className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${i === 2 ? "bg-accent-soft text-accent" : "text-ink-faint"}`}
                  >
                    {t}
                  </span>
                ))}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <span className="hidden rounded-full border border-line px-2.5 py-1 text-[10px] font-semibold text-ink-soft sm:inline">
                  chain
                </span>
                <span className="rounded-lg bg-ok/80 px-3 py-1 text-[11px] font-bold text-white">Buy</span>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_200px]">
              <div className="h-44 border-b border-line p-2 sm:h-64 sm:border-b-0 sm:border-r">
                <Chart />
              </div>
              {/* Tangga kedalaman: jual di atas, beli di bawah, lebar makin kecil menjauhi spread. */}
              <div className="hidden flex-col justify-center gap-1.5 p-4 sm:flex">
                {[88, 72, 58, 44, 30].map((w) => (
                  <span key={`a${w}`} className="flex justify-end">
                    <span className="block h-2.5 rounded-sm bg-danger/35" style={{ width: `${w}%` }} />
                  </span>
                ))}
                <span className="my-1 block h-px bg-line" />
                {[34, 48, 62, 78, 92].map((w) => (
                  <span key={`b${w}`} className="flex justify-end">
                    <span className="block h-2.5 rounded-sm bg-ok/35" style={{ width: `${w}%` }} />
                  </span>
                ))}
              </div>
            </div>

            {/* Feed perdagangan. */}
            <div className="grid grid-cols-1 gap-2 border-t border-line px-4 py-3 sm:grid-cols-2">
              {[
                ["B", "ok", "62%"],
                ["S", "danger", "44%"],
                ["B", "ok", "78%"],
                ["B", "ok", "51%"],
              ].map(([side, tone, w], i) => (
                <span key={i} className={`items-center gap-2 ${i > 1 ? "hidden sm:flex" : "flex"}`}>
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-md text-[9px] font-bold ${
                      tone === "ok" ? "bg-ok/15 text-ok" : "bg-danger/15 text-danger"
                    }`}
                  >
                    {side}
                  </span>
                  <span className="flex-1">
                    <Skeleton w={w} tone={tone as "ok" | "danger"} />
                  </span>
                  <Skeleton w="18%" />
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Chip melayang: desktop di sekeliling bingkai, ponsel sebagai kisi di bawahnya. */}
        <ul className="mt-6 grid grid-cols-2 gap-2 lg:mt-0">
          {CHIPS.map((chip) => (
            <li
              key={chip.label}
              className={`showcase-chip glass rounded-2xl px-3.5 py-2.5 lg:absolute lg:w-56 ${chip.pos}`}
              style={{ ["--chip-y" as string]: chip.y }}
            >
              <span className="block text-[13px] font-semibold text-ink">{chip.label}</span>
              <span className="block text-[11.5px] leading-snug text-ink-soft">{chip.body}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
