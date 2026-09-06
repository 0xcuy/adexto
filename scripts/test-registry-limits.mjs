/**
 * Bukti bahwa dua batas registry benar-benar menutup — dan, yang lebih penting, bahwa
 * batas 500 TIDAK LAGI menggusur entri tertua.
 *
 * KENAPA MEMANGGIL FUNGSINYA LANGSUNG, BUKAN LEWAT HTTP
 *
 * Perilaku di batas 500 hanya muncul setelah ada 500 entri. Lewat HTTP itu berarti 500
 * transaksi mainnet yang benar-benar mined, karena stage confirm menuntut receipt asli.
 * Memanggil `registerProject` langsung membuat batasnya bisa diuji tanpa membakar gas
 * sepeser pun.
 *
 * Registry ditulis ke ADEXTO_DATA_DIR, jadi berkasnya diarahkan ke direktori sementara
 * dan data nyata tidak tersentuh.
 *
 * Pakai: node --experimental-strip-types scripts/test-registry-limits.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adexto-registry-limits-"));
process.env.ADEXTO_DATA_DIR = dir;
process.env.ADEXTO_MAX_TICKERS_PER_CREATOR = "3"; // dikecilkan supaya uji cepat

const { registerProject, creatorQuota, creatorTickers, listProjects, RegistryLimitError } = await import(
  "../src/lib/registry.ts"
);

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  LULUS  ${label}`);
  } else {
    fail++;
    console.log(`  GAGAL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";

let nonce = 0;
const addr = (p) => "0x" + p.toString(16).padStart(40, "0");
const hash = () => "0x" + (++nonce).toString(16).padStart(64, "0");

function launch(creator, symbol, chainId = 16601) {
  return registerProject({
    tokenAddress: addr(0xa0000 + ++nonce),
    poolAddress: addr(0xb0000 + nonce),
    creator,
    name: symbol,
    symbol,
    chainId,
    priceNative: 1e-9,
    supply: 1_000_000_000,
    lpFeeBps: 20,
    treasuryBuybackBps: 10,
    txHash: hash(),
    poolLive: true,
  });
}

function expectLimit(label, code, fn) {
  try {
    fn();
    check(label, false, "tidak melempar apa pun");
  } catch (error) {
    const isLimit = error instanceof RegistryLimitError;
    check(label, isLimit && error.code === code, `${error.name}/${error.code ?? "-"}: ${error.message.slice(0, 80)}`);
  }
}

console.log("\n1) BATAS TICKER PER ALAMAT (diset 3)");
launch(ALICE, "AAA");
launch(ALICE, "BBB");
launch(ALICE, "CCC");
check("3 ticker pertama diterima", creatorTickers(ALICE).size === 3, `${creatorTickers(ALICE).size}`);
expectLimit("ticker KEEMPAT ditolak", "CREATOR_TICKER_LIMIT", () => launch(ALICE, "DDD"));

console.log("\n2) PERLUASAN LINTAS-CHAIN TIDAK MENGHABISKAN KUOTA");
// Ticker yang SUDAH dimiliki harus tetap boleh mendarat di chain lain walau kuota penuh.
const before = listProjects().length;
launch(ALICE, "AAA", 42161);
check("AAA boleh menyusul ke chain kedua walau kuota penuh", listProjects().length === before + 1);
check("hitungan ticker tetap 3, bukan 4", creatorTickers(ALICE).size === 3, `${creatorTickers(ALICE).size}`);

console.log("\n3) KUOTA TERPISAH PER ALAMAT");
launch(BOB, "EEE");
check("alamat lain punya kuota sendiri", creatorTickers(BOB).size === 1);
const q = creatorQuota(BOB);
check("creatorQuota melaporkan sisa dengan benar", q.used === 1 && q.max === 3 && q.remaining === 2, JSON.stringify(q));

console.log("\n4) ENV TIDAK BISA MEMBUKA PINTU LEWAT NILAI TIDAK MASUK AKAL");
for (const bad of ["0", "-5", "abc", ""]) {
  process.env.ADEXTO_MAX_TICKERS_PER_CREATOR = bad;
  const max = creatorQuota(BOB).max;
  check(`ADEXTO_MAX_TICKERS_PER_CREATOR="${bad}" jatuh ke bawaan 10, bukan tanpa batas`, max === 10, `max=${max}`);
}
process.env.ADEXTO_MAX_TICKERS_PER_CREATOR = "3";

console.log("\n5) BATAS 500 MENOLAK, TIDAK MENGGUSUR — ini inti perbaikannya");
// Diisi sampai 500 memakai alamat berbeda-beda supaya batas per-alamat tidak ikut campur.
// Ini juga menunjukkan apa adanya bahwa memutar alamat memang melewati batas per-alamat.
const firstSymbol = listProjects()[listProjects().length - 1].symbol;
const firstAddress = listProjects()[listProjects().length - 1].tokenAddress.toLowerCase();
let filler = 0;
while (listProjects().length < 500) {
  launch(addr(0x100000 + ++filler), `F${filler}`);
}
check("registry terisi tepat 500", listProjects().length === 500, `${listProjects().length}`);
check(
  "entri TERTUA masih ada setelah registry penuh",
  listProjects().some((p) => p.tokenAddress.toLowerCase() === firstAddress),
  `mencari ${firstSymbol}`
);

expectLimit("entri ke-501 DITOLAK", "REGISTRY_FULL", () => launch(addr(0x900001), "OVERFLOW"));
check("masih 500 setelah penolakan, tidak ada yang tergusur", listProjects().length === 500, `${listProjects().length}`);
check(
  "entri tertua TETAP ada setelah penolakan ke-501",
  listProjects().some((p) => p.tokenAddress.toLowerCase() === firstAddress),
  "entri pertama hilang — inilah bug yang seharusnya sudah diperbaiki"
);
check(
  "OVERFLOW tidak pernah masuk registry",
  !listProjects().some((p) => p.symbol === "OVERFLOW")
);

fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n  ringkasan: ${pass} lulus · ${fail} gagal`);
process.exit(fail === 0 ? 0 : 1);
