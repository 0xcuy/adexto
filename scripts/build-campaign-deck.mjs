#!/usr/bin/env node
/**
 * Rakit dek campaign Galxe dari kerangka dek Founder House.
 *
 * APA ISINYA — DAN APA YANG SENGAJA TIDAK ADA
 *
 * Dek ini adalah campaign-nya: produk, task, hadiah, bukti, tautan. Bahan yang dipakai
 * sebagai pertimbangan internal — kenapa satu task dibuang, berapa stok x402, batas rate
 * di endpoint mana, biaya restock — TIDAK masuk ke sini. Alasan internal bukan campaign,
 * dan penyelenggara tidak memintanya. Semua itu tinggal di
 * `build/campaign/galxe-campaign.md`.
 *
 * KENAPA MEMINJAM KERANGKANYA, BUKAN MENULIS ULANG
 *
 * `public/founder-house/index.html` sudah memuat CSS cetak yang terbukti: tiap `.slide`
 * menjadi tepat satu halaman lanskap, penskalaan 1280x720 identik antara yang
 * dipresentasikan dan yang dicetak, dan dua bug pemusatan sudah diperbaiki di sana —
 * margin negatif yang melebarkan halaman, dan dua transform di satu elemen. Menulis ulang
 * CSS itu berarti membayar ulang kedua bug.
 *
 * KENAPA KELUARANNYA DI `public/campaign/`, DAN JALURNYA RELATIF
 *
 * Disajikan di `campaign.adexto.xyz`, mengikuti pola `day2.adexto.xyz` -> dek Founder House:
 * berkas statis di `public/`, dipetakan oleh `src/middleware.ts`. Bukan halaman React, sebab
 * dek ini tidak punya state, tidak memanggil satu pun API, dan ikut dicetak jadi PDF oleh
 * headless Chrome — hidrasi dan CSS bersama hanya menambah yang harus dijinakkan saat cetak.
 *
 * Rujukan aset — gambar latar dan PDF — ditulis RELATIF (`art/cover.jpg`), bukan absolut
 * (`/campaign/art/cover.jpg`), dan itu keputusan, bukan kelalaian. `scripts/render-deck.mjs`
 * membuka dek lewat `file://`, jadi jalur absolut akan dicari di akar filesystem dan PDF-nya
 * keluar tanpa satu pun latar. Konsekuensinya middleware harus memetakan SELURUH path
 * subdomain ke `/campaign/...`, bukan hanya `/` — lihat catatan di sana.
 *
 *   node scripts/build-campaign-deck.mjs
 *   node scripts/render-deck.mjs public/campaign/index.html
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const SRC = "public/founder-house/index.html";
const OUT_DIR = "public/campaign";
const OUT = `${OUT_DIR}/index.html`;
const PDF_NAME = "adexto-galxe-campaign.pdf";

const src = readFileSync(SRC, "utf8");

const trackOpen = src.indexOf('<div class="track" id="track">');
const trackClose = src.indexOf("</div><!-- /track -->");
if (trackOpen < 0 || trackClose < 0) {
  throw new Error("build-campaign-deck: track markers moved in the source deck; fix this script");
}

let head = src.slice(0, trackOpen + '<div class="track" id="track">'.length);
let tail = src.slice(trackClose);

/**
 * CSS tambahan untuk kelas yang TIDAK ada di dek sumber.
 *
 * Diperiksa, bukan diasumsikan: `.tbl` dan `.card.ok` nol kemunculan di
 * `public/founder-house/index.html`. Tanpa blok ini tabel task dan tabel angka keluar
 * sebagai tabel HTML mentah tanpa gaya di tengah dek bercorak.
 */
const EXTRA_CSS = `
<style>
  .tbl {
    width: 100%;
    border-collapse: collapse;
    margin-top: 6px;
    font-size: 15px;
  }
  .tbl thead th {
    text-align: left;
    padding: 8px 12px;
    border-bottom: 2px solid var(--line);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: .1em;
    text-transform: uppercase;
    color: var(--ink-faint);
    white-space: nowrap;
  }
  .tbl tbody td {
    padding: 9px 12px;
    border-bottom: 1px solid rgba(221,208,187,.55);
    vertical-align: top;
    color: var(--ink-soft);
    line-height: 1.45;
  }
  .tbl tbody td b { color: var(--ink); }
  .tbl tbody tr:last-child td { border-bottom: none; }
  .tbl code { font-size: .88em; }
  .tbl td.n { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .card.ok .h { color: var(--ok); }
  .card.ok .dot { background: var(--ok); }

  /*
    Tautan yang BENAR-BENAR bisa diklik, di layar maupun di PDF.
    Sebelumnya URL ditulis di dalam <code>, jadi terlihat seperti tautan tapi mati — orang
    harus menyalinnya dengan tangan. Chromium membawa anchor asli ke dalam PDF, jadi satu
    perubahan ini membuat dek cetaknya bisa diklik juga.
  */
  a.lnk {
    color: var(--accent);
    text-decoration: none;
    border-bottom: 1px solid rgba(124,58,237,.35);
    font-family: var(--mono, ui-monospace, monospace);
    font-size: .92em;
    word-break: break-all;
  }
  a.lnk:hover { border-bottom-color: var(--accent); }
  a.lnk.plain { font-family: inherit; font-size: inherit; word-break: normal; }

  /*
    LATAR COVER
    Gambarnya berlatar krem terang, sementara cover-nya ungu. Ditempel apa adanya ia jadi
    kotak putih besar yang menabrak gradien. "mix-blend-mode: luminosity" membuatnya
    mengambil warna dari gradien di belakangnya dan hanya menyumbang terang-gelapnya, jadi
    robotnya menjadi ungu dan terlihat memang bagian dari slide.

    Mask-nya memudarkan gambar dari kiri supaya judul tetap duduk di bidang bersih. Nilai
    38% dipilih karena di bawah itu tepi gambar mulai memotong huruf terakhir judul pada
    1280 px.

    Konten cover dinaikkan ke z-index 1 secara eksplisit. Tanpa itu urutan lukisnya
    bergantung pada kebetulan: anak statik memang menang atas z-index negatif, tapi
    menuliskannya berarti tidak ada yang perlu mengingat aturan itu.

    PERHATIAN pada .meta: HANYA z-index yang boleh ditambahkan padanya. Dek sumber
    menempelkannya ke dasar slide dengan "position: absolute; bottom: 54px", jadi menulis
    "position: relative" di sini — yang sempat saya lakukan — melepasnya kembali ke aliran
    normal dan membuatnya menabrak subjudul. Ia sudah positioned, jadi z-index berlaku
    tanpa perlu menyentuh position-nya.
  */
  .cover { overflow: hidden; }
  .cover .art {
    position: absolute;
    top: 0; right: 0; bottom: 0;
    width: 62%;
    background-image: url("art/cover.jpg");
    background-size: cover;
    background-position: 62% center;
    mix-blend-mode: luminosity;
    opacity: .5;
    -webkit-mask-image: linear-gradient(to right, transparent 0%, rgba(0,0,0,.85) 38%, #000 70%);
    mask-image: linear-gradient(to right, transparent 0%, rgba(0,0,0,.85) 38%, #000 70%);
    z-index: 0;
  }
  .cover .mark, .cover h1, .cover .sub { position: relative; z-index: 1; }
  .cover .meta { z-index: 1; }
  /*
    LATAR SLIDE ISI

    Slide isi berlatar krem dengan teks gelap, jadi persoalannya berbeda dari cover: bukan
    soal menyatukan warna, tapi soal tidak merusak keterbacaan. Karena itu opacity 0,14 —
    cukup untuk terlihat sebagai bentuk, tidak cukup untuk bersaing dengan huruf. Mask
    mengosongkan kiri, tempat kicker, judul dan paragraf duduk.

    KENAPA "isolation: isolate" DAN z-index NEGATIF, BUKAN MENAIKKAN KONTEN

    Menaikkan konten menuntut aturan seperti ".slide > *" yang memaksa "position: relative"
    ke SEMUA anak — dan dua di antaranya, ".foot" dan ".meta", sudah "position: absolute"
    untuk menempel di dasar slide. Itu persis bug yang baru saja terjadi di cover: footernya
    naik menabrak subjudul.

    z-index negatif menghindari itu tanpa menyentuh konten sama sekali, tapi hanya aman
    kalau slide-nya benar-benar stacking context. ".slide" punya "position: relative" dengan
    z-index auto, jadi bukan — dan anak z-index -1 akan lolos ke ancestor lalu tertutup
    total oleh latar krem slide yang opak. "isolation: isolate" menjadikan slide stacking
    context, sehingga -1 berhenti di dalamnya: di atas latar krem, di bawah seluruh konten.
  */
  .slide:not(.cover) { isolation: isolate; }
  .slide:not(.cover) .art {
    position: absolute;
    inset: 0;
    z-index: -1;
    background-repeat: no-repeat;
    background-size: cover;
    background-position: right center;
    opacity: .14;
    -webkit-mask-image: linear-gradient(to right, transparent 0%, rgba(0,0,0,.35) 34%, #000 72%);
    mask-image: linear-gradient(to right, transparent 0%, rgba(0,0,0,.35) 34%, #000 72%);
  }

  @media print {
    .cover .art, .slide:not(.cover) .art {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style>`;

head = head.replace("</head>", `${EXTRA_CSS}\n</head>`);

// ── Slide ────────────────────────────────────────────────────────────────────
//
// Setiap angka di bawah diukur, bukan diingat:
//   kuota 0.1 0G -> ADEXTO   -> getBuyQuote di kurva 0xc80e...2B60, chain 16661
//   harga 0G dalam USD       -> /api/prices
//   jumlah pasar dan chain   -> POST /api/graphql produksi, 6 pasar di 4 chain
//   pengakuan pihak ketiga   -> /recognition, tiap butir bertaut ke sumbernya
// Kalau sebuah angka berubah, ukur ulang dulu sebelum mengubah slide.
//
// ERC-8004 SENGAJA TIDAK DISEBUT DI DEK — bukan karena salah, tapi karena tidak relevan bagi
// pembaca campaign. Nomor id agent tidak membuat siapa pun mau ikut; yang menjual adalah
// "agen bisa dagang sendiri". Status sebenarnya sudah diukur dan tercatat di runbook §4:
// $PARCEL di Monad terikat agent id 10251, sementara $ADEXTO dan $ADT di 0G tidak terikat dan
// tidak bisa diikat lagi. Kalau nanti ada yang menanyakannya, jawabannya ada di runbook,
// tidak perlu masuk slide.

/**
 * URL target task 3, ditulis SEKALI.
 *
 * Muncul di tiga slide. `tf=60` ikut dibawa karena itu yang membuka terminal pada interval
 * satu menit, bukan default-nya — peserta yang baru pertama kali datang melihat grafik yang
 * sudah terbentuk, bukan bidang kosong. Diperiksa hari ini: menjawab HTTP 200.
 */
const BUY_URL = "https://adexto.xyz/token/adexto?chain=16661&tf=60";

/**
 * Satu baris latar per slide.
 *
 * Berkasnya dihasilkan `scripts/gen-campaign-art.mjs` lewat 0G Compute (z-image-turbo) dan
 * tinggal di `build/campaign/art/`. Dipanggil lewat helper, bukan ditulis inline di tiap
 * slide, supaya kalau nanti nama berkasnya berubah cuma ada satu tempat yang salah.
 */
const art = (name) => `<div class="art" style="background-image:url('art/${name}.jpg')"></div>`;

const foot = (n, total) =>
  `<div class="foot"><div class="l"><svg viewBox="74 77 364 364" fill="#8b7d92"><use href="#adexto-mark"/></svg><span>ADEXTO</span></div><div>${n} / ${total}</div></div>`;

const TOTAL = 8;
const slides = [];

slides.push(`
<section class="slide cover">
  <div class="art"></div>
  <div class="mark"><svg viewBox="74 77 364 364" fill="#fff"><use href="#adexto-mark"/></svg></div>
  <h1>Open a market,<br/>not just a token.</h1>
  <p class="sub">A market that trades from block one. No liquidity deposit, no founder allocation. Live on 0G, Base, Arbitrum One and Monad.</p>
  <div class="meta">
    <div>Galxe campaign · ADEXTO</div>
    <div><b>adexto.xyz</b></div>
  </div>
</section>`);

slides.push(`
<section class="slide">
  ${art("product")}
  <div class="kicker">The product</div>
  <h2 class="title">One transaction, and the market is already trading.</h2>
  <p class="lede">Most launchpads hand you a token and a page, then you wait for a listing. ADEXTO skips the wait because there is nothing to wait for.</p>
  <div class="grid g3">
    <div class="card">
      <div class="h"><span class="dot"></span>No liquidity to deposit</div>
      <div class="b">A bonding curve is the market. The first buyer trades against it in the same block it was created, so nobody has to seed a pool or find a counterparty.</div>
    </div>
    <div class="card">
      <div class="h"><span class="dot"></span>No founder allocation</div>
      <div class="b"><strong>100% of the supply enters the curve at genesis.</strong> The creator holds none. There is no unlock schedule to read and no insider bag to front-run.</div>
    </div>
    <div class="card">
      <div class="h"><span class="dot"></span>No application, no gatekeeper</div>
      <div class="b">Anyone can open one, on any of the four mainnets, and a market behaves the same wherever it lives. Nobody reviews it and nothing has to be approved first.</div>
    </div>
  </div>
  ${foot(2, TOTAL)}
</section>`);

slides.push(`
<section class="slide">
  ${art("arrives")}
  <div class="kicker">What arrives with the market</div>
  <h2 class="title">Three things a new market normally has to wait years for.</h2>
  <div class="grid g3">
    <div class="card">
      <div class="h"><span class="dot"></span>A terminal built for minutes-old assets</div>
      <div class="b">Candles from one second upward, an order book and a live trade feed. A chart on a one-minute interval is useless when the asset is four minutes old, so the terminal does not start there.</div>
    </div>
    <div class="card">
      <div class="h"><span class="dot"></span>A buyer on another chain can pay</div>
      <div class="b">Holding only USDC somewhere else is enough. The price is payable over plain HTTP — no bridge, no swap, and the buyer never has to hold the market's gas token.</div>
    </div>
    <div class="card">
      <div class="h"><span class="dot"></span>An agent can trade it unattended</div>
      <div class="b">An MCP server ships with the venue, so an AI agent can list markets, pull a quote and execute a buy on its own — no scraping, and no custom integration for each new market.</div>
    </div>
  </div>
  <p class="lede" style="margin-top:18px">This campaign is for people who want to try that before it has a crowd.</p>
  ${foot(3, TOTAL)}
</section>`);

slides.push(`
<section class="slide">
  ${art("tasks")}
  <div class="kicker">The campaign</div>
  <h2 class="title">Four tasks. One of them is the product.</h2>
  <table class="tbl">
    <thead><tr><th>#</th><th>Task</th><th>Verified by</th></tr></thead>
    <tbody>
      <tr><td class="n">1</td><td><b>Follow @adexto_ on X</b></td><td>Galxe native credential</td></tr>
      <tr><td class="n">2</td><td><b>Join the ADEXTO Telegram group</b> — <a class="lnk" href="https://t.me/adexto">t.me/adexto</a></td><td>Galxe native credential</td></tr>
      <tr><td class="n">3</td><td><b>Buy at least 0.1 0G of \$ADEXTO</b> on 0G mainnet<br/><a class="lnk" href="${BUY_URL}">${BUY_URL.replace("https://", "")}</a></td><td>The curve's on-chain <code>Swap</code> event</td></tr>
      <tr><td class="n">4</td><td><b>Still hold at least 500 \$ADEXTO when you claim</b></td><td>Galxe native ERC-20 balance check</td></tr>
    </tbody>
  </table>
  <p class="lede" style="margin-top:14px">Tasks three and four are one idea split in two: buy, and still be holding. The activity lands on 0G mainnet, so it stays inside the ecosystem hosting the campaign.</p>
  ${foot(4, TOTAL)}
</section>`);

slides.push(`
<section class="slide">
  ${art("price")}
  <div class="kicker">Task 3, exactly</div>
  <h2 class="title">Two and a half cents, quoted from the contract.</h2>
  <table class="tbl">
    <thead><tr><th>Field</th><th>Value</th></tr></thead>
    <tbody>
      <tr><td>Market</td><td><b>\$ADEXTO</b> on 0G Mainnet, chain id <code>16661</code></td></tr>
      <tr><td>Curve contract</td><td><code>0xc80e0659D2Fc29e62605C9DF6182a85372652B60</code></td></tr>
      <tr><td>Token contract</td><td><code>0xA1358C17004469C7CA5365AbafD294F9b2c11DF7</code></td></tr>
      <tr><td>Minimum spend</td><td class="n"><b>0.1 0G</b>, and more is fine</td></tr>
      <tr><td>What 0.1 0G buys</td><td class="n"><b>4,943.78 \$ADEXTO</b> — <code>getBuyQuote</code>, read from the live curve</td></tr>
      <tr><td>Cost in USD</td><td class="n"><b>≈ \$0.0235</b> at 0G = \$0.234516</td></tr>
      <tr><td>Gas for the buy</td><td class="n">≈ 0.0004 0G, so budget ~0.101 0G in total</td></tr>
      <tr><td>Where to buy</td><td><a class="lnk" href="${BUY_URL}">${BUY_URL.replace("https://", "")}</a></td></tr>
    </tbody>
  </table>
  <p class="lede" style="margin-top:14px">The hold threshold is 500, not 4,943, because a curve gets more expensive as it is bought. A late participant spending the same 0.1 0G receives fewer tokens and must still pass.</p>
  ${foot(5, TOTAL)}
</section>`);

slides.push(`
<section class="slide">
  ${art("reward")}
  <div class="kicker">The reward</div>
  <h2 class="title">An OAT called <em>ADEXTO — Block One</em>.</h2>
  <p class="lede">The reward is the record itself, and we say that up front. Every market's supply goes to the curve at genesis — that fairness is the product, and it is why the OAT is what a participant walks away holding.</p>
  <div class="grid g2">
    <div class="card ok">
      <div class="h"><span class="dot"></span>What the holder gets</div>
      <div class="b">A permanent on-chain record that they bought into an ADEXTO market while it was still new — one transaction had created it, it was already trading, and they were among the first through the door.</div>
    </div>
    <div class="card">
      <div class="h"><span class="dot"></span>Who it attracts</div>
      <div class="b">People who came to use the venue, not to wait for a snapshot. That is the audience worth having at this stage, and it is the audience an honest reward description brings in. A hundred people who open the terminal beat ten thousand who never do.</div>
    </div>
  </div>
  ${foot(6, TOTAL)}
</section>`);

slides.push(`
<section class="slide">
  ${art("traction")}
  <div class="kicker">Why this is worth your audience's time</div>
  <h2 class="title">It is shipped, and other people have already checked.</h2>
  <div class="grid g2">
    <div class="card">
      <div class="h"><span class="dot"></span>Live, not a testnet demo</div>
      <div class="b">Four mainnets — <strong>0G, Base, Arbitrum One, Monad</strong> — with six markets open and trading today. Anyone can open the terminal right now and watch a real chart, and the docs are at <code>docs.adexto.xyz</code>.</div>
    </div>
    <div class="card">
      <div class="h"><span class="dot"></span>Named by 0G already</div>
      <div class="b">ADEXTO is one of the eight projects in the <strong>0G Atlas Founder House Demo Day</strong> line-up, 18 September 2026, and appears in 0G's own A2A economy landscape — live on 0G mainnet, tagged Base, Arb and Monad. Sources are linked at <code>adexto.xyz/recognition</code>.</div>
    </div>
  </div>
  <p class="lede" style="margin-top:18px">The venue is built and running. What this campaign adds is its first wave of traders.</p>
  ${foot(7, TOTAL)}
</section>`);

slides.push(`
<section class="slide">
  ${art("links")}
  <div class="kicker">Links</div>
  <h2 class="title">Everything a participant needs.</h2>
  <table class="tbl">
    <thead><tr><th>Label</th><th>URL</th></tr></thead>
    <tbody>
      <tr><td><b>Buy \$ADEXTO</b> (task 3)</td><td><a class="lnk" href="${BUY_URL}">${BUY_URL.replace("https://", "")}</a></td></tr>
      <tr><td>Open your own market</td><td><a class="lnk" href="https://adexto.xyz/studio">adexto.xyz/studio</a></td></tr>
      <tr><td>Browse live markets</td><td><a class="lnk" href="https://adexto.xyz/explorer">adexto.xyz/explorer</a></td></tr>
      <tr><td>Docs</td><td><a class="lnk" href="https://docs.adexto.xyz">docs.adexto.xyz</a></td></tr>
      <tr><td>Recognition and sources</td><td><a class="lnk" href="https://adexto.xyz/recognition">adexto.xyz/recognition</a></td></tr>
      <tr><td>X</td><td><a class="lnk" href="https://x.com/adexto_">x.com/adexto_</a></td></tr>
      <tr><td>Telegram</td><td><a class="lnk" href="https://t.me/adexto">t.me/adexto</a></td></tr>
    </tbody>
  </table>
  <p class="lede" style="margin-top:14px">Run: <strong>two weeks, closing as TOKEN2049 opens in Singapore on 7 October 2026</strong>. Everything above is ready to configure today.</p>
  ${foot(8, TOTAL)}
</section>`);

// ── Sesuaikan kerangka ───────────────────────────────────────────────────────
head = head
  .replace(
    "<title>ADEXTO — 0G Atlas Founder House</title>",
    "<title>ADEXTO — Galxe campaign</title>",
  )
  .replace(
    /Dek untuk 0G Atlas Founder House office hours\./,
    "Dek campaign Galxe, tersaji di campaign.adexto.xyz. Dirakit oleh\n  scripts/build-campaign-deck.mjs dari kerangka dek Founder House — JANGAN sunting berkas\n  ini, suntingannya akan hilang pada perakitan berikutnya. Sunting skripnya.",
  );

tail = tail
  .replace(/\/founder-house\/adexto-0g-founder-house\.pdf/g, PDF_NAME)
  .replace(/1 \/ 8/g, `1 / ${TOTAL}`);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, `${head}\n${slides.join("\n")}\n${tail}`);

console.log(`wrote ${OUT}`);
console.log(`  slides ${slides.length}`);
console.log(`  next:  node scripts/render-deck.mjs ${OUT}`);
