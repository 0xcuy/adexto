// Potong ulang pose maskot dari lembar asli, TANPA pantulan lantai semi-transparan.
// Masker: piksel padat (alpha>=200) didilatasi R px; alpha di luar masker = 0.
// Tepi anti-alias robot (<=R px dari tubuh) tetap, pantulan lantai yang melebar hilang.
import sharp from "sharp";
import fs from "node:fs";

const SRC = process.env.SRC || "maskot adexto.png";
const OUT = process.env.OUT || "public/mascot";
const R = Number(process.env.R || 2);
const PAD = 2;
fs.mkdirSync(OUT, { recursive: true });

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const A = (x, y) => data[(y * W + x) * 4 + 3];

// 1. tubuh padat
const solid = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) solid[y * W + x] = A(x, y) >= 200 ? 1 : 0;

// 2. buang noda padat kecil (bukan bagian robot) lewat komponen terhubung
const label = new Int32Array(W * H).fill(-1);
const comps = [];
for (let i = 0; i < W * H; i++) {
  if (!solid[i] || label[i] !== -1) continue;
  const id = comps.length, stack = [i];
  let n = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
  label[i] = id;
  while (stack.length) {
    const p = stack.pop(), x = p % W, y = (p / W) | 0;
    n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const q = ny * W + nx;
      if (solid[q] && label[q] === -1) { label[q] = id; stack.push(q); }
    }
  }
  comps.push({ id, n, x0, y0, x1, y1 });
}
const big = comps.filter((c) => c.n > 400);
if (process.env.DEBUG) console.log(big.filter((c) => c.y0 > 700 && c.x0 > 1100).map((c) => `${c.x0}-${c.x1},${c.y0}-${c.y1} n=${c.n}`));

// 3. dilatasi masker tubuh (hanya komponen besar)
const keep = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const l = label[y * W + x];
  if (l < 0 || comps[l].n <= 400) continue;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < W && ny < H) keep[ny * W + nx] = 1;
  }
}
const clean = Buffer.from(data);
for (let i = 0; i < W * H; i++) if (!keep[i]) { clean[i * 4 + 3] = 0; clean[i * 4] = clean[i * 4 + 1] = clean[i * 4 + 2] = 0; }

// 4. kelompokkan komponen jadi figur (bbox yang berdekatan digabung)
const figs = big.map((c) => ({ ...c, ids: [c.id] }));
let merged = true;
while (merged) {
  merged = false;
  for (let i = 0; i < figs.length && !merged; i++) for (let j = i + 1; j < figs.length && !merged; j++) {
    const a = figs[i], b = figs[j], g = 6;
    if (Math.min(a.n, b.n) < 3000 && a.x0 - g <= b.x1 && b.x0 - g <= a.x1 && a.y0 - g <= b.y1 && b.y0 - g <= a.y1) {
      a.ids.push(...b.ids);
      a.x0 = Math.min(a.x0, b.x0); a.y0 = Math.min(a.y0, b.y0);
      a.x1 = Math.max(a.x1, b.x1); a.y1 = Math.max(a.y1, b.y1); a.n += b.n;
      figs.splice(j, 1); merged = true;
    }
  }
}
figs.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
const rows = { top: [], mid: [], bot: [] };
for (const f of figs) (f.y0 < 300 ? rows.top : f.y0 < 700 ? rows.mid : rows.bot).push(f);
for (const k of Object.keys(rows)) rows[k].sort((a, b) => a.x0 - b.x0);
console.log("rows:", Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.map((f) => `${f.x0},${f.y0} ${f.x1 - f.x0 + 1}x${f.y1 - f.y0 + 1}`)])));

const poses = {
  front: rows.top[0], threequarter: rows.top[4],
  idle: rows.bot[0], wave: rows.bot[1], point: rows.bot[2], think: rows.bot[3],
  celebrate: rows.bot[4], run: rows.bot[5], jump: rows.bot[6], sit: rows.bot[7],
};
const dims = {};
for (const [name, f] of Object.entries(poses)) {
  if (!f) { console.log("MISSING", name); continue; }
  const left = Math.max(0, f.x0 - PAD - R), top = Math.max(0, f.y0 - PAD - R);
  const width = Math.min(W, f.x1 + PAD + R + 1) - left, height = Math.min(H, f.y1 + PAD + R + 1) - top;
  const own = new Set(f.ids);
  const buf = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = x + left, sy = y + top;
    let hit = false;
    for (let dy = -R; dy <= R && !hit; dy++) for (let dx = -R; dx <= R && !hit; dx++) {
      const nx = sx + dx, ny = sy + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && own.has(label[ny * W + nx])) hit = true;
    }
    if (!hit) continue;
    const si = (sy * W + sx) * 4, di = (y * width + x) * 4;
    data.copy(buf, di, si, si + 4);
  }
  await sharp(buf, { raw: { width, height, channels: 4 } })
    .webp({ quality: 90, alphaQuality: 100, effort: 6 })
    .toFile(`${OUT}/${name}.webp`);
  dims[name] = [width, height];
}
console.log(JSON.stringify(dims));
