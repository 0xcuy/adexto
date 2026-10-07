#!/usr/bin/env node
/**
 * Gambar hero untuk setiap halaman docs (`/docs` dan `/docs/<slug>`), lewat router 0G (z-image-turbo).
 *
 *   node scripts/docs-images.mjs generate                 # semua slug yang belum punya gambar mentah
 *   node scripts/docs-images.mjs generate --only fees,mcp --force
 *   node scripts/docs-images.mjs sheet                    # lembar kontak (≤1600 px) untuk memilih varian
 *   node scripts/docs-images.mjs build --pick fees=2,mcp=1   # potong 12:5, tulis WebP ke public/docs/art/
 *
 * KENAPA SEPERTI INI
 *
 * - Satu gambar per halaman, dipilih dari dua varian. Model ini kadang mengukir huruf di permukaan
 *   benda bulat (koin, kubus), jadi benda seperti itu selalu disebut KOSONG di prompt, dan larangan
 *   teks tetap ditulis di akhir setiap prompt (pelajaran skrip hero /agent-compute lama, dihapus 7 Okt saat hero itu diganti maskot resmi).
 * - Latar arang hangat, aksen ungu, sorot krem: tema bawaan situs gelap (rgb 23,18,13), jadi banner
 *   gelap menyatu di sana dan tetap terbaca sebagai kartu di tema terang.
 * - Robot putih kecil bervisor ungu HANYA di halaman agen. Maskot resmi tidak ditiru: versi model
 *   selalu melenceng dari aslinya.
 * - Gambar mentah ditulis ke luar repo (bawaan `/tmp/adexto-docs-art`). `build/` ikut tersinkron ke VPS
 *   oleh `deploy-vps.sh`, dan enam puluh PNG mentah tidak perlu ikut.
 * - Keluaran: `public/docs/art/<slug>.webp` (1440×600) dan `<slug>-720.webp` (720×300). Path di bawah
 *   `/docs/` juga milik subdomain docs di middleware, jadi `docs.adexto.xyz` menyajikannya tanpa
 *   pengalihan. Peta slug → gambar ada di `src/app/docs/docs-art.ts`.
 *
 * Kunci dibaca dari env atau `.env.local` dan tidak pernah dicetak.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const RAW = process.env.DOCS_ART_RAW || path.join(os.tmpdir(), "adexto-docs-art");
const OUT = "public/docs/art";
const W = 1440;
const H = 600;

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(".env.local", "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, "") : "";
  } catch {
    return "";
  }
}

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const STYLE =
  "Wide cinematic 3D render for a documentation banner, minimal and calm, soft studio lighting, matte ceramic and " +
  "frosted glass materials, a seamless warm near-black charcoal background, glowing deep violet light accents, soft " +
  "warm cream highlights, shallow depth of field, the subject centred and fairly small with generous empty dark space " +
  "on the left and on the right and above and below. Palette limited to charcoal, deep violet #7c3aed and warm cream.";
const BLANK = "Every coin, card and cube is completely blank: smooth faces with no engraving, no emblem, no symbol.";
const ROBOT = "a small friendly white robot with a rounded head and a glossy violet visor";
const NO_TEXT = "No text, no letters, no numbers, no logos, no watermark, no signature, no user interface.";

/** Satu entri per halaman. `home` adalah `/docs`. */
export const ART = [
  ["home", "a smooth glowing violet curve rising from left to right above a dark landscape, six small floating stone platforms beneath it, tiny plain cream coins travelling up along the curve"],
  ["quickstart", "three flat round stepping stones in a dark still pool leading to a small open doorway of soft violet light, each stone faintly glowing cream"],
  ["glossary", "a neat floating grid of small frosted glass tiles, each tile holding one different simple glowing geometric shape such as a circle, a curve, an arrow or a hexagon"],
  ["launch", "a small cream ceramic rocket lifting off from a round violet glowing launch pad, its exhaust trail bending into a smooth rising curve"],
  ["studio-guide", "a tidy dark workbench with one large glossy plain coin standing upright in a soft violet spotlight, a few small precise tools laid out neatly beside it"],
  ["agent-launch", `${ROBOT} pressing a large round glowing button on a low pedestal, a tiny cream ceramic rocket lifting off beside it`],
  // Putaran kedua untuk `fees`, `market-page` dan `chains`: koin di atas dan bejana di bawah terpotong
  // oleh crop 12:5, grafik pertama terus menanjak (gambar docs tidak boleh menjanjikan harga naik), dan
  // "enam yang identik" keluar berbeda-beda. Komposisinya sekarang ditulis mendatar dan eksplisit.
  ["fees", "one glowing plain coin floating on the left, four thin streams of light flowing from it to the right into four small glass vessels of different sizes standing in a row, the whole scene inside the middle band of the frame, wide horizontal composition"],
  ["agent-identity", `${ROBOT} holding up a glowing blank identity card with a small violet seal`],
  ["trading", "a smooth glowing violet curve shaped like a gentle hill with a polished cream sphere rolling along it, soft reflections on a dark glossy floor"],
  // Dua putaran grafik lilin tetap menanjak walau diminta datar, jadi subjeknya diganti: dasbor abstrak.
  ["market-page", "a floating frosted glass dashboard panel divided into three areas: a gently wavy horizontal line, a row of short bars of mixed heights in no order, and a small ring gauge, violet and cream glow"],
  ["finding-markets", "a large glass magnifying lens hovering over a field of small glowing plain coins of different sizes scattered on a dark surface, violet light inside the lens"],
  ["cross-chain", "an elegant arc of violet light forming a bridge between two floating dark stone islands, small plain cream coins travelling across the bridge"],
  ["wallets", "a sleek dark leather wallet lying half open with a soft violet glow coming from inside and a small cream key resting on top"],
  ["chains", "a straight row of six exactly identical small dark stone pedestals, each holding an exactly identical small glowing violet crystal of the same size and shape, wide horizontal composition, the row inside the middle band of the frame"],
  ["creator-earnings", "a clear glass jar slowly filling with small glowing plain cream coins that fall from a thin stream of violet light above it"],
  ["staking", "a neat stack of glossy plain coins resting on a round glowing violet pedestal that sends a soft beam of light upward"],
  ["compute", `${ROBOT} sitting beside a glowing blank cube with thin violet light lines running across its faces like circuitry`],
  ["referrals", "two small glowing spheres connected by a thin elegant chain of light, a tiny plain cream coin travelling along the chain from one sphere to the other"],
  ["mcp", `${ROBOT} plugging a thin glowing cable into a port on a floating dark server block`],
  ["a2a", `two copies of ${ROBOT} facing each other, passing a small glowing orb of violet light between them`],
  ["x402", "a glowing plain coin passing through a tall thin archway of violet light, and on the other side a small cream parcel appearing, dark glossy floor"],
  ["public-api", "a calm constellation of small floating frosted glass blocks connected by thin glowing violet lines"],
  ["data", "thin streams of violet and cream light flowing from six small floating platforms into one clear glass crystal in the centre"],
  ["security", "a translucent glowing shield standing in front of a smooth violet curve, soft cream rim light"],
  ["check-a-market", "a glass magnifying lens examining one large glossy plain coin standing upright, a soft violet glow along the coin's edge"],
  ["risks", "a narrow glowing path running along the edge of a dark cliff, a few balanced stones stacked beside it, soft violet light rising from below"],
  ["reporting", "a small cream flag planted on a dark rock, a soft violet beacon light glowing behind it"],
  ["faq", "several frosted glass speech bubbles of different sizes floating in the dark, each with a soft violet glow inside and nothing written in them"],
  ["troubleshooting", "a small wrench and a few precise gears arranged on a dark surface, one gear glowing violet, soft cream rim light"],
  ["telegram", "a folded cream paper plane gliding through the dark with a thin violet light trail behind it"],
].map(([slug, subject]) => ({ slug, prompt: `${STYLE} Subject: ${subject}. ${BLANK} ${NO_TEXT}` }));

const SIZES = ["1920x1088", "1664x928", "1440x1440", "1280x1280"];

async function generateOne(key, base, job) {
  for (const size of SIZES) {
    const t0 = Date.now();
    let res;
    try {
      res = await fetch(`${base}/images/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: "z-image-turbo", prompt: job.prompt, n: 2, size, response_format: "b64_json" }),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (e) {
      console.log(`${job.slug}: ${size} failed (${String(e?.message ?? e).slice(0, 120)})`);
      continue;
    }
    if (!res.ok) {
      console.log(`${job.slug}: ${size} refused (HTTP ${res.status}) ${(await res.text()).replace(/\s+/g, " ").slice(0, 160)}`);
      continue;
    }
    const j = await res.json();
    const imgs = (j?.data || []).map((d) => d?.b64_json).filter((b) => typeof b === "string" && b.length);
    if (!imgs.length) {
      console.log(`${job.slug}: ${size} returned no image data`);
      continue;
    }
    imgs.forEach((b, i) => writeFileSync(path.join(RAW, `${job.slug}-${i + 1}.png`), Buffer.from(b, "base64")));
    writeFileSync(
      path.join(RAW, `${job.slug}.json`),
      JSON.stringify({ slug: job.slug, model: "z-image-turbo", size, images: imgs.length, prompt: job.prompt, at: new Date().toISOString() }, null, 2),
    );
    console.log(`${job.slug}: ${imgs.length} image(s) at ${size} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    return;
  }
  throw new Error(`${job.slug}: every size was refused`);
}

async function generate() {
  const key = env("OG_ROUTER_API_KEY");
  const base = env("OG_ROUTER_URL") || "https://router-api.0g.ai/v1";
  if (!key) {
    console.error("OG_ROUTER_API_KEY is missing from the environment and .env.local.");
    process.exit(1);
  }
  mkdirSync(RAW, { recursive: true });
  const only = arg("only")?.split(",").map((s) => s.trim());
  const force = process.argv.includes("--force");
  const jobs = ART.filter((a) => (only ? only.includes(a.slug) : true)).filter(
    (a) => force || !existsSync(path.join(RAW, `${a.slug}-1.png`)),
  );
  console.log(`${jobs.length} job(s), raw images in ${RAW}`);
  // Empat sekaligus: cukup cepat, dan router tidak pernah menolak karena laju pada empat.
  const queue = [...jobs];
  const failed = [];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const job = queue.shift();
        try {
          await generateOne(key, base, job);
        } catch (e) {
          failed.push(job.slug);
          console.error(`FAILED ${e?.message ?? e}`);
        }
      }
    }),
  );
  if (failed.length) {
    console.error(`failed: ${failed.join(", ")}`);
    process.exit(1);
  }
}

/** Arah potong per slug, bila subjeknya tidak di tengah (nilai `position` sharp). Bawaan: tengah. */
const CROP = { chains: "bottom", "creator-earnings": "bottom" };

/**
 * Varian yang dipakai (7 Okt, dipilih dari lembar kontak). `--pick` menimpanya. Ditulis di sini supaya
 * `build` berikutnya menghasilkan gambar yang sama dengan yang ter-commit.
 */
const PICKS = {
  glossary: "2", fees: "2", trading: "2", "market-page": "2", wallets: "2", referrals: "2",
  a2a: "2", "public-api": "2", data: "2", risks: "2", troubleshooting: "2",
};

/** Potongan 12:5, ukuran apa pun gambar mentahnya. */
async function crop(file, width, slug) {
  return sharp(file).resize({ width, height: Math.round((width * H) / W), fit: "cover", position: CROP[slug] ?? "centre" });
}

async function sheet() {
  const TW = 600;
  const TH = Math.round((TW * H) / W);
  const LABEL = 28;
  const ROWS = 6;
  const only = arg("only")?.split(",").map((s) => s.trim());
  const slugs = ART.map((a) => a.slug)
    .filter((s) => (only ? only.includes(s) : true))
    .filter((s) => existsSync(path.join(RAW, `${s}-1.png`)));
  for (let s = 0; s * ROWS < slugs.length; s++) {
    const part = slugs.slice(s * ROWS, s * ROWS + ROWS);
    const width = TW * 2 + 30;
    const height = part.length * (TH + LABEL + 10) + 10;
    const layers = [];
    for (const [r, slug] of part.entries()) {
      const top = 10 + r * (TH + LABEL + 10);
      const svg = `<svg width="${width}" height="${LABEL}" xmlns="http://www.w3.org/2000/svg"><text x="10" y="20" font-family="sans-serif" font-size="18" fill="#f4efe4">${slug}  ·  left = 1, right = 2</text></svg>`;
      layers.push({ input: Buffer.from(svg), top, left: 0 });
      for (const v of [1, 2]) {
        const f = path.join(RAW, `${slug}-${v}.png`);
        if (!existsSync(f)) continue;
        layers.push({ input: await (await crop(f, TW, slug)).png().toBuffer(), top: top + LABEL, left: 10 + (v - 1) * (TW + 10) });
      }
    }
    const out = path.join(RAW, `sheet-${s + 1}.png`);
    await sharp({ create: { width, height, channels: 3, background: "#2a2420" } }).composite(layers).png().toFile(out);
    console.log(`${out} (${width}×${height}): ${part.join(", ")}`);
  }
}

async function build() {
  const picks = {
    ...PICKS,
    ...Object.fromEntries(
      (arg("pick") ?? "")
        .split(",")
        .filter(Boolean)
        .map((p) => p.split("=").map((x) => x.trim())),
    ),
  };
  mkdirSync(OUT, { recursive: true });
  for (const { slug } of ART) {
    const v = picks[slug] ?? "1";
    const src = path.join(RAW, `${slug}-${v}.png`);
    if (!existsSync(src)) {
      console.log(`${slug}: no raw image ${src}, skipped`);
      continue;
    }
    const big = path.join(OUT, `${slug}.webp`);
    const small = path.join(OUT, `${slug}-720.webp`);
    await (await crop(src, W, slug)).webp({ quality: 74, effort: 6 }).toFile(big);
    await (await crop(src, 720, slug)).webp({ quality: 72, effort: 6 }).toFile(small);
    console.log(`${slug}: variant ${v} -> ${Math.round(statSync(big).size / 1024)} KB + ${Math.round(statSync(small).size / 1024)} KB`);
  }
}

const cmd = process.argv[2];
if (cmd === "generate") await generate();
else if (cmd === "sheet") await sheet();
else if (cmd === "build") await build();
else {
  console.error("usage: node scripts/docs-images.mjs generate|sheet|build [--only a,b] [--force] [--pick slug=2,…]");
  process.exit(1);
}
