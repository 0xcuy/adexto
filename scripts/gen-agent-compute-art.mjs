#!/usr/bin/env node
/**
 * Gambar hero untuk `/agent-compute`, lewat 0G Compute (z-image-turbo).
 *
 * KENAPA BERKAS TERSENDIRI, BUKAN MENAMBAH JOB KE `gen-campaign-art.mjs`
 *
 * Skrip itu mematok `OUT_DIR`, `RAW_DIR` dan manifest ke `campaign/` di tingkat modul, dan
 * prompt-prompt di dalamnya dipilih untuk satu dek dengan aturannya sendiri — latar tidak boleh
 * menirukan geometri kartu, tidak boleh ada grafik menanjak. Menjadikannya generik berarti
 * menambah parameter set ke berkas yang tugasnya sudah selesai dan terbukti, demi satu gambar.
 *
 * Yang DIPINJAM adalah pelajarannya, bukan kodenya:
 *   - benda bulat harus disebut KOSONG secara eksplisit, atau model mengukir huruf di sana
 *   - palet dibatasi krem dan ungu situs ini, supaya gambarnya tidak terlihat ditempel
 *   - keluaran di-JPEG-kan; PNG mentah dari model ratusan KB untuk gambar yang dirender kecil
 *
 *   node scripts/gen-agent-compute-art.mjs
 *   node scripts/gen-agent-compute-art.mjs --force
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import sharp from "sharp";

const OUT = "public/agent-compute/hero.jpg";
const RAW = "build/agent-compute-hero.png";
const FORCE = process.argv.includes("--force");

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(".env.local", "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim() : "";
  } catch {
    return "";
  }
}

const KEY = env("OG_ROUTER_API_KEY");
const URL_BASE = env("OG_ROUTER_URL") || "https://router-api.0g.ai/v1";
if (!KEY) {
  console.error("OG_ROUTER_API_KEY tidak ada di env maupun .env.local");
  process.exit(1);
}

/**
 * Robot memegang kubus bercahaya: agen, dan compute yang dibukanya.
 *
 * "Blank" disebut untuk kubusnya dengan alasan yang sama seperti koin di dek campaign — model
 * mengukir huruf di permukaan benda yang dianggapnya berlabel, dan larangan teks tingkat gaya
 * saja tidak mengikat untuk itu.
 */
const PROMPT =
  "A friendly rounded white robot standing beside a single glowing violet cube floating above a " +
  "low pedestal, three-quarter view, the cube casting soft light on the robot. " +
  "The cube faces are completely blank: smooth surfaces with no engraving, no emblem, no symbol, " +
  "no letter and no number. " +
  "Minimal seamless studio backdrop, nothing else in frame, no scenery, no props. " +
  "Soft studio lighting, clean and premium, plenty of empty space, shallow depth of field. " +
  "Palette limited to warm cream, off-white, pale grey and deep violet #7c3aed accents. " +
  "No text, no letters, no numbers, no logos, no watermark, no signature, no UI mockups.";

async function generate(size) {
  const res = await fetch(`${URL_BASE}/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: "z-image-turbo", prompt: PROMPT, n: 1, size, response_format: "b64_json" }),
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

mkdirSync("public/agent-compute", { recursive: true });
mkdirSync("build", { recursive: true });

if (existsSync(OUT) && !FORCE) {
  console.log(`${OUT} sudah ada, dilewati (pakai --force untuk menimpa)`);
  process.exit(0);
}

let buf = null;
if (existsSync(RAW) && !FORCE) {
  buf = readFileSync(RAW);
  console.log("memakai PNG mentah yang sudah ada");
} else {
  for (const size of ["1280x720", "1024x1024"]) {
    const t0 = Date.now();
    const r = await generate(size);
    if (r.ok) {
      buf = r.buf;
      writeFileSync(RAW, buf);
      console.log(`${size}: PNG ${Math.round(buf.length / 1024)} KB, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      break;
    }
    console.log(`${size} ditolak (${r.status}) — ${r.detail}`);
  }
}

if (!buf) {
  console.error("GAGAL di semua ukuran");
  process.exit(1);
}

await sharp(buf).resize({ width: 1120, withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toFile(OUT);
console.log(`${OUT} — ${Math.round(statSync(OUT).size / 1024)} KB`);
