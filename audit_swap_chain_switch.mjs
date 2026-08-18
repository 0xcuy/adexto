/**
 * Regresi: mengubah dropdown chain di /swap HARUS mengubah seluruh panel.
 *
 * Bug yang ditangkap: dropdown chain hanya menyaring daftar market, sementara
 * market terpilih tidak pernah direset. Memilih chain tanpa market meninggalkan
 * header, biaya, harga dan panel trading pada market chain SEBELUMNYA — terlihat
 * seperti "ganti chain tidak berpengaruh" dan menampilkan token 0G padahal
 * dropdown sudah Base.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "LULUS" : "GAGAL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

/** Membaca keadaan panel: header, teks chain market, opsi chain, daftar market. */
const readPanel = (page) =>
  page.evaluate(() => {
    const selects = [...document.querySelectorAll("select")];
    const chainSel = selects.find((s) => [...s.options].some((o) => o.value === "all"));
    const marketSel = selects.find((s) =>
      [...s.options].some((o) => (o.textContent || "").trim().startsWith("$") || /No markets/i.test(o.textContent || ""))
    );
    const body = document.body.innerText;
    return {
      chainFilter: chainSel?.value ?? null,
      chainOptions: chainSel ? [...chainSel.options].map((o) => ({ value: o.value, label: o.textContent.trim() })) : [],
      marketKey: marketSel?.value ?? null,
      marketOptions: marketSel ? [...marketSel.options].map((o) => o.value).filter(Boolean) : [],
      headerName: document.querySelector(".glass-panel .truncate")?.textContent?.trim() ?? null,
      noMarketsCopy: /No market on .* yet/i.test(body),
      chainLabelShown: (body.match(/(0G|Arbitrum|Base|Monad)[^\n]*\(\d+\)/g) || []).slice(0, 4),
    };
  });

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 140)));

await page.goto(`${BASE}/swap`, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(5000);

const start = await readPanel(page);
console.log(`  awal: filter=${start.chainFilter} market=${start.marketKey} header="${start.headerName}"`);
// "All chains" bersama market mana pun tidak bertentangan; yang dilarang adalah
// filter menunjuk SATU chain sementara market terpilih berasal dari chain lain.
check(
  "saat muat, filter chain tidak bertentangan dengan market terpilih",
  Boolean(start.marketKey) &&
    (start.chainFilter === "all" || start.chainFilter === start.marketKey.split(":")[0]),
  `filter=${start.chainFilter} vs market=${start.marketKey}`
);
check("daftar market tidak disaring diam-diam saat muat", start.marketOptions.length > 1, `${start.marketOptions.length} market`);

const chainIds = start.chainOptions.filter((o) => o.value !== "all").map((o) => o.value);
console.log(`  chain tersedia: ${chainIds.join(", ")}\n`);

for (const cid of chainIds) {
  const label = start.chainOptions.find((o) => o.value === cid)?.label ?? cid;
  const chainSelector = 'select[aria-label="Filter markets by chain"]';
  await page.selectOption(chainSelector, cid);
  await page.waitForTimeout(2200);
  const s = await readPanel(page);

  const marketsOnChain = s.marketOptions.filter((k) => k.startsWith(`${cid}:`));
  const hasMarkets = marketsOnChain.length > 0;

  console.log(`  [${label}] market=${s.marketKey ?? "(kosong)"} header="${s.headerName}" opsi=${s.marketOptions.length}`);

  if (hasMarkets) {
    // Market terpilih WAJIB berada di chain yang dipilih.
    check(
      `${label}: market terpilih ikut pindah ke chain ini`,
      Boolean(s.marketKey && s.marketKey.startsWith(`${cid}:`)),
      String(s.marketKey)
    );
    check(
      `${label}: header bukan "Select a market"`,
      s.headerName !== "Select a market" && Boolean(s.headerName),
      String(s.headerName)
    );
  } else {
    // Tidak ada market: panel harus jujur kosong, BUKAN menahan market chain lain.
    check(
      `${label}: tidak ada market -> pilihan dikosongkan (tidak menahan chain lain)`,
      s.marketKey === "" || s.marketKey === null,
      `marketKey=${JSON.stringify(s.marketKey)}`
    );
    check(
      `${label}: header menjadi "Select a market"`,
      s.headerName === "Select a market",
      String(s.headerName)
    );
    check(`${label}: alasan kosong dijelaskan ke user`, s.noMarketsCopy);
  }
}

// Pemakuan lewat URL harus memilih market yang TEPAT. Regresi yang pernah terjadi:
// efek sinkronisasi filter berjalan di commit yang sama dengan praseleksi memakai
// state lama, sehingga ?token=CSENT berakhir memilih QNOVA (sesama chain, tapi
// token yang salah).
console.log("\n  pemakuan lewat URL (?token= dan ?chain=)");
await page.selectOption('select[aria-label="Filter markets by chain"]', "all");
await page.waitForTimeout(1500);
const allMarkets = (await readPanel(page)).marketOptions;
for (const key of allMarkets) {
  const [cid, symbol] = key.split(":");

  // Dengan ?chain= : market yang terpilih harus TEPAT market itu.
  await page.goto(`${BASE}/swap?token=${symbol}&chain=${cid}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3200);
  let s = await readPanel(page);
  check(`?token=${symbol}&chain=${cid} memilih ${key}`, s.marketKey === key, `dapat ${s.marketKey}`);
  check(
    `?token=${symbol}&chain=${cid} tetap menampilkan semua market`,
    s.marketOptions.length === allMarkets.length,
    `${s.marketOptions.length}/${allMarkets.length}`
  );

  // Tanpa ?chain= : symbol yang menentukan. Satu ticker bisa hidup di beberapa
  // chain, jadi yang wajib benar adalah SYMBOL-nya — chain mana yang dipilih
  // ditentukan aturan fallback (tradable dulu), bukan oleh URL.
  await page.goto(`${BASE}/swap?token=${symbol}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3200);
  s = await readPanel(page);
  check(
    `?token=${symbol} memilih market ber-symbol $${symbol}`,
    Boolean(s.marketKey?.endsWith(`:${symbol}`)),
    `dapat ${s.marketKey}`
  );
}

// ?chain= yang tidak cocok tidak boleh menyeret ke token lain.
if (allMarkets.length > 0) {
  const [, sym0] = allMarkets[0].split(":");
  await page.goto(`${BASE}/swap?token=${sym0}&chain=999999`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3200);
  const s = await readPanel(page);
  check(
    `?chain= tak dikenal tetap memilih $${sym0}`,
    Boolean(s.marketKey?.endsWith(`:${sym0}`)),
    String(s.marketKey)
  );
}

console.log("\n  kembali ke All chains");
await page.goto(`${BASE}/swap`, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(3000);
await page.selectOption('select[aria-label="Filter markets by chain"]', "all");
await page.waitForTimeout(2200);
const all = await readPanel(page);
check(
  "All chains memilih kembali sebuah market",
  Boolean(all.marketKey),
  `${all.marketKey} · "${all.headerName}"`
);
check("semua market kembali terdaftar", all.marketOptions.length >= start.marketOptions.length, `${all.marketOptions.length} market`);
check("tidak ada page error", errs.length === 0, errs.join(" | "));

console.log(`\n  ${pass} LULUS / ${fail} GAGAL`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
