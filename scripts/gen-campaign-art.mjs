#!/usr/bin/env node
/**
 * Hasilkan gambar latar untuk SETIAP slide dek campaign lewat 0G Compute (z-image-turbo).
 *
 * KENAPA SKRIP TERSENDIRI, BUKAN LEWAT /api/generate-logo
 *
 * Endpoint itu mengunci `size` ke 256x256 dengan alasan yang benar untuk tugasnya: logo
 * dirender 48–64 px dan ikut ditambatkan ke 0G DA, jadi berkas besar mahal permanen.
 * Latar dek dirender 1280x720 dan tidak pernah menyentuh chain, jadi batasan itu tidak
 * berlaku — tapi juga tidak boleh dilonggarkan di endpoint produksi hanya demi dek.
 *
 * UKURAN SUDAH DIPROBE, HASILNYA DICATAT
 *
 * 1280x720 DITERIMA z-image-turbo (diukur: ~650–700 KB PNG, 5–7 s per gambar). Jadi tidak
 * perlu memotong rasio persegi lewat object-fit. Daftar `sizes` tetap berisi cadangan
 * 1024x1024 supaya kalau router berubah, skrip ini turun kelas sendiri daripada gagal.
 *
 * KENAPA HASILNYA DI-JPEG-KAN, BUKAN DIPAKAI PNG APA ADANYA
 *
 * Delapan PNG 700 KB berarti PDF sekitar 6 MB untuk gambar yang dirender pada opacity
 * 0,12–0,5. Diukur: JPEG 1120 px kualitas 82 tinggal ~60–110 KB, dan pada opacity itu
 * artefaknya tidak mungkin terlihat. PNG mentahnya tetap disimpan di `raw/` supaya kalau
 * nanti ada yang mau dipakai penuh, tidak perlu memanggil model lagi.
 *
 *   node scripts/gen-campaign-art.mjs
 *   node scripts/gen-campaign-art.mjs --force     # timpa yang sudah ada
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import sharp from "sharp";

/**
 * JPEG terbit ke `public/`, PNG mentah TIDAK.
 *
 * Yang disajikan cuma JPEG-nya (~12–23 KB masing-masing), dan itulah yang perlu ada di git
 * supaya dek yang di-commit tidak kehilangan latarnya. PNG mentah dari model berjumlah 5,4 MB
 * untuk delapan gambar dan tidak pernah diminta browser — memasukkannya ke repo berarti
 * membayar 5,4 MB di setiap clone demi berkas yang hanya dipakai kalau suatu saat mau
 * mengekspor ulang dengan kualitas berbeda. Jadi mentahnya tinggal di `build/` yang diabaikan
 * git, dan skrip ini memakainya ulang kalau ada supaya tidak memanggil model dua kali.
 */
const OUT_DIR = "public/campaign/art";
const RAW_DIR = "build/campaign/art-raw";
/**
 * Manifest juga TIDAK terbit. Isinya prompt lengkap tiap gambar — catatan kerja, bukan bagian
 * dari campaign — dan menaruhnya di `public/` berarti ia tersaji di
 * `campaign.adexto.xyz/art/manifest.json` tanpa ada yang pernah memintanya.
 */
const MANIFEST = "build/campaign/art-manifest.json";
const FORCE = process.argv.includes("--force");

/**
 * `--only=nama` membatasi ke satu gambar.
 *
 * Ada karena memperbaiki satu latar yang kurang pas seharusnya tidak berarti memanggil model
 * delapan kali dan mengganti tujuh gambar yang sudah disetujui — hasil model tidak
 * deterministik, jadi regenerasi menyeluruh akan mengubah yang tidak diminta berubah.
 */
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);

const JPEG_WIDTH = 1120;
const JPEG_QUALITY = 82;

// ── Kunci dibaca dari .env.local, sebab skrip ini bukan bagian dari runtime Next ──
function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(".env.local", "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim() : "";
  } catch {
    return "";
  }
}

const KEY = env("OG_ROUTER_API_KEY");
const URL_BASE = env("OG_ROUTER_URL") || "https://router-api.0g.ai/v1";
if (!KEY) {
  console.error("OG_ROUTER_API_KEY tidak ada di env maupun .env.local — tidak ada yang bisa dipanggil.");
  process.exit(1);
}

/**
 * Gaya bersama.
 *
 * Dek ini krem dengan aksen ungu #7c3aed. Gambar bertema gelap akan terlihat ditempel dari
 * produk lain — persis kesalahan yang dulu diperbaiki di prompt logo. Larangan teks
 * dipertahankan dengan alasan yang sama: model gambar menulis huruf rusak, dan huruf rusak
 * di latar slide lebih buruk daripada tidak ada huruf.
 *
 * "Nothing else in frame" penting untuk latar: begitu model menambahkan pemandangan, gambar
 * mulai bersaing dengan teks di atasnya alih-alih mendukungnya.
 */
const STYLE =
  "Soft studio lighting, clean and premium, plenty of empty space, shallow depth of field. " +
  "Palette limited to warm cream, off-white, pale grey and deep violet #7c3aed accents. " +
  "Nothing else in frame, no scenery, no props. " +
  "No text, no letters, no numbers, no logos, no watermark, no signature, no UI mockups.";

/**
 * KENAPA SETIAP PROMPT MENYEBUT "BLANK" UNTUK BENDA BULAT
 *
 * Percobaan pertama mengukir huruf "R" di permukaan koin meski teks sudah dilarang di
 * tingkat gaya. Larangan umum ternyata tidak mengikat untuk objek yang oleh model dianggap
 * memang berhuruf. Koin, medali, dan token harus disebut kosong secara eksplisit.
 *
 * KENAPA TIDAK ADA GRAFIK YANG NAIK
 *
 * Percobaan pertama untuk slide pasar menghasilkan candlestick menanjak dengan panah — enak
 * dilihat, tapi artinya "harga akan naik". Dek ini sengaja tidak menjanjikan apa pun soal
 * harga, jadi memakainya membuat gambar mengucapkan klaim yang teksnya justru dihindari.
 * Bentuk netral lebih aman daripada bentuk yang menjual arah.
 */
const JOBS = [
  {
    file: "cover",
    slide: "1 · cover",
    prompt:
      "A friendly rounded white robot with a glowing violet visor standing beside a single " +
      "large floating coin, three-quarter view, the coin catching the light. " +
      "The coin is completely blank: a smooth polished plain disc with no engraving, no " +
      "emblem, no symbol, no letter and no number on its face. " +
      "Minimal seamless studio backdrop. " +
      STYLE,
  },
  {
    file: "product",
    slide: "2 · one transaction",
    prompt:
      "One single smooth violet rounded cube resting on a low cream pedestal, softly lit, " +
      "centred with wide empty space around it, minimal seamless backdrop. " +
      STYLE,
  },
  {
    file: "arrives",
    slide: "3 · what arrives with the market",
    /**
     * BENTUKNYA TIDAK BOLEH PERSEGI PANJANG, dan ini pelajaran dari percobaan pertama.
     *
     * Versi pertama meminta "three rounded rectangular panels in a row". Slide 3 memuat tiga
     * kartu putih dalam satu baris, jadi latarnya mengulang persis susunan yang sama sedikit
     * bergeser — hasilnya terlihat seperti kartu hantu atau cacat render, bukan latar.
     *
     * Aturannya: latar tidak boleh menirukan geometri konten di atasnya. Torus dipilih karena
     * bentuknya tidak mungkin tertukar dengan kartu.
     *
     * DUA ring, bukan satu: satu torus berdiri tegak terbaca sebagai huruf "O" — larangan teks
     * lolos karena yang digambar memang benda, bukan huruf, tapi matanya tetap membacanya
     * begitu. Dua ring yang bertaut menjadi bentuk yang jelas benda, dan kebetulan cocok
     * dengan isi slide: hal-hal yang datang bersama pasarnya, saling terhubung.
     */
    prompt:
      "Two smooth interlocking torus rings, one deep violet and one warm cream, linked together " +
      "and resting at a slight angle on a pale surface, soft shadow, generous empty space " +
      "around them, minimal seamless backdrop. " +
      STYLE,
  },
  {
    file: "tasks",
    slide: "4 · the four tasks",
    prompt:
      "Four blank rounded cream tiles in a neat row on a pale surface, each tile plain and " +
      "empty, one tile tilted slightly forward in violet, minimal seamless backdrop. " +
      STYLE,
  },
  {
    file: "price",
    slide: "5 · task 3 numbers",
    prompt:
      "A small neat stack of three blank polished coins resting on a pale cream surface, " +
      "warm metal and violet tones, each coin face completely plain with no engraving, no " +
      "emblem, no symbol, no letter and no number. Minimal seamless backdrop. " +
      STYLE,
  },
  {
    file: "reward",
    slide: "6 · the OAT",
    prompt:
      "One single blank polished violet medallion standing upright on a pale cream surface, " +
      "smooth plain face with no engraving, no emblem, no symbol, no letter and no number, " +
      "soft cream ribbon behind it, minimal seamless backdrop. " +
      STYLE,
  },
  {
    file: "traction",
    slide: "7 · four mainnets",
    prompt:
      "Four smooth blank spheres of graduated violet and cream standing in a straight row on " +
      "a pale surface, evenly spaced, equal size, soft reflections, minimal seamless backdrop. " +
      STYLE,
  },
  {
    file: "links",
    slide: "8 · links",
    prompt:
      "A friendly rounded white robot with a glowing violet visor, three-quarter view, one " +
      "arm raised in a small friendly wave, standing alone on a minimal seamless backdrop. " +
      STYLE,
  },
];

const SIZES = ["1280x720", "1024x1024"];

async function generate(prompt, size) {
  const res = await fetch(`${URL_BASE}/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: "z-image-turbo", prompt, n: 1, size, response_format: "b64_json" }),
  });
  if (!res.ok) {
    const t = (await res.text()).replace(/\s+/g, " ").slice(0, 160);
    return { ok: false, status: res.status, detail: t };
  }
  const j = await res.json();
  const b64 = j?.data?.[0]?.b64_json;
  if (typeof b64 !== "string" || !b64.length) return { ok: false, status: 200, detail: "jawaban tanpa data gambar" };
  return { ok: true, buf: Buffer.from(b64, "base64") };
}

mkdirSync(RAW_DIR, { recursive: true });
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};

if (ONLY && !JOBS.some((j) => j.file === ONLY)) {
  console.error(`--only=${ONLY} tidak cocok dengan nama mana pun. Pilihan: ${JOBS.map((j) => j.file).join(", ")}`);
  process.exit(1);
}

for (const job of JOBS) {
  if (ONLY && job.file !== ONLY) continue;

  const jpg = `${OUT_DIR}/${job.file}.jpg`;
  const raw = `${RAW_DIR}/${job.file}.png`;

  if (existsSync(jpg) && !FORCE) {
    console.log(`${job.file}: sudah ada, dilewati (pakai --force untuk menimpa)`);
    continue;
  }

  let buf = null;
  let usedSize = null;

  // PNG mentah yang sudah ada dipakai ulang: tidak ada alasan membayar panggilan model dua
  // kali hanya untuk mengubah kualitas JPEG.
  if (existsSync(raw) && !FORCE) {
    buf = readFileSync(raw);
    usedSize = manifest[job.file]?.size || "dari raw";
    console.log(`${job.file}: memakai PNG mentah yang sudah ada`);
  } else {
    for (const size of SIZES) {
      const t0 = Date.now();
      const r = await generate(job.prompt, size);
      if (r.ok) {
        buf = r.buf;
        usedSize = size;
        writeFileSync(raw, buf);
        console.log(`${job.file}: ${size}, PNG ${Math.round(buf.length / 1024)} KB, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        break;
      }
      console.log(`${job.file}: ${size} ditolak (${r.status}) — ${r.detail}`);
    }
  }

  if (!buf) {
    console.error(`${job.file}: GAGAL di semua ukuran`);
    continue;
  }

  await sharp(buf).resize({ width: JPEG_WIDTH, withoutEnlargement: true }).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toFile(jpg);
  const kb = Math.round(statSync(jpg).size / 1024);
  console.log(`${job.file}: -> ${job.file}.jpg ${kb} KB`);

  manifest[job.file] = {
    slide: job.slide,
    size: usedSize,
    jpegWidth: JPEG_WIDTH,
    jpegQuality: JPEG_QUALITY,
    jpegBytes: statSync(jpg).size,
    model: "z-image-turbo",
    prompt: job.prompt,
    at: new Date().toISOString(),
  };
}

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest -> ${MANIFEST}`);
