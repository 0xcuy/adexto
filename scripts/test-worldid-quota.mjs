/**
 * Bukti kuota mode ketat: satu manusia satu TOKEN, bukan satu confirm.
 *
 * KENAPA TERPISAH DARI audit_worldid_gate.mjs
 *
 * Harness HTTP itu hanya menjalankan tahap `prepare`. Kuota baru tercatat di tahap
 * `confirm`, yang menuntut transaksi on-chain sungguhan. Akibatnya asersi
 * "empat chain dengan ticker sama lolos" di sana LOLOS SECARA PALSU: daftar ticker
 * masih kosong, jadi mode ketat tidak pernah aktif dan tidak ada yang diuji.
 *
 * Berkas ini memanggil fungsinya langsung, jadi kuotanya benar-benar terisi lalu
 * diperiksa. Yang dibuktikan:
 *
 *   1. Ticker yang SAMA tetap lolos setelah dicatat — chain ke-2..4 dari satu
 *      peluncuran tidak boleh diblokir. Ini bug yang pernah ada: kuota dulu berupa
 *      penghitung yang dinaikkan tiap confirm, sehingga mode ketat memblokir fitur
 *      utama produk alih-alih memblokir Sybil.
 *   2. Ticker BARU ditolak — itulah gunanya mode ketat.
 *   3. Nullifier beda kapitalisasi tetap orang yang sama.
 *
 * Pakai: node --experimental-strip-types scripts/test-worldid-quota.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adexto-worldid-quota-"));
process.env.ADEXTO_DATA_DIR = dir;
process.env.WORLD_ID_TOKEN_SECRET = "quota-test-secret-0123456789";
process.env.NEXT_PUBLIC_WORLD_ID_APP_ID = "app_test";
process.env.NEXT_PUBLIC_WORLD_ID_ACTION = "launch-token";
process.env.WORLD_ID_RP_ID = "rp_test";
process.env.WORLD_ID_SIGNING_KEY = "0x" + "11".repeat(32);
process.env.WORLD_ID_ONE_LAUNCH_PER_HUMAN = "true";

const { issueWorldIdToken, verifyWorldIdToken, recordLaunch, normalizeNullifier } = await import(
  "../src/lib/worldid.ts"
);

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "LULUS" : "GAGAL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const address = "0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D";
const rawNullifier = "0xAbCdEf00112233";
const nullifier = normalizeNullifier(rawNullifier);

// Entri harus ada di simpanan sebelum token bisa dipakai; itu yang dilakukan
// jalur verifikasi sungguhan. Di sini ditulis langsung supaya tidak perlu
// memanggil layanan World.
fs.writeFileSync(
  path.join(dir, "worldid-nullifiers.json"),
  JSON.stringify({ [nullifier]: { address: address.toLowerCase(), firstSeen: new Date().toISOString(), symbols: [] } })
);

const token = issueWorldIdToken(address, nullifier);
check("token diterbitkan", typeof token === "string");

console.log("\n1) SEBELUM ada launch tercatat");
check("ticker apa pun boleh", verifyWorldIdToken(token, address, "AAA").ok);

console.log("\n2) SETELAH ticker AAA dicatat (meniru confirm chain pertama)");
recordLaunch(nullifier, "AAA");
const same = verifyWorldIdToken(token, address, "AAA");
check("ticker SAMA masih lolos (chain ke-2..4 satu peluncuran)", same.ok, same.ok ? "" : same.code);

// Empat chain berurutan: tiap confirm mencatat ulang ticker yang sama.
let allFour = true;
for (let i = 0; i < 4; i++) {
  if (!verifyWorldIdToken(token, address, "AAA").ok) allFour = false;
  recordLaunch(nullifier, "AAA");
}
check("empat confirm berurutan ticker sama semuanya lolos", allFour);

const store = JSON.parse(fs.readFileSync(path.join(dir, "worldid-nullifiers.json"), "utf8"));
check("tercatat sebagai SATU ticker, bukan lima", store[nullifier].symbols.length === 1, JSON.stringify(store[nullifier].symbols));

console.log("\n3) TICKER BARU harus ditolak — inilah gunanya mode ketat");
const other = verifyWorldIdToken(token, address, "BBB");
check("ticker baru ditolak", !other.ok, other.ok ? "LOLOS padahal harus ditolak" : other.code);
check("kodenya WORLDID_ALREADY_LAUNCHED", !other.ok && other.code === "WORLDID_ALREADY_LAUNCHED");

console.log("\n4) NORMALISASI nullifier");
check("huruf besar/kecil menghasilkan kunci sama", normalizeNullifier(rawNullifier.toLowerCase()) === nullifier);
check("tanpa awalan 0x sama", normalizeNullifier(rawNullifier.slice(2)) === nullifier);
check("nol di depan sama", normalizeNullifier("0x0000" + rawNullifier.slice(2)) === nullifier);

console.log(`\n  ${pass} LULUS / ${fail} GAGAL`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
