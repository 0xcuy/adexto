# ADEXTO — Technical Runbook
> Repo: `/home/cucu/Coder/Work/adexto` · Domain: `adexto.xyz` · Terakhir diperbarui: Agustus 2026 (pasca audit + remediasi)

Dokumen operasional ADEXTO. Status di sini ditulis apa adanya: yang sudah terverifikasi ditandai jelas, yang belum juga ditandai jelas.

---

## 1. Status ringkas

| Komponen | Status | Bukti |
|---|---|---|
| `SovereignHook` AMM (buy/sell/receive/quote/buyback) | **Kode selesai, 24/24 uji lulus di devchain** | `node scripts/test-sovereign-dex.mjs` |
| `AdextoTrinityFactoryV2` (token + pool atomic) | **Kode selesai, 17.38 KiB** | idem |
| **Uji di 5 jaringan nyata** | **LULUS SEMUA di kelimanya** (lihat §1a) | `TEST_RPC=<rpc> TEST_SEED=<n> node scripts/test-sovereign-dex.mjs` |
| **Peluncuran multi-chain 1–4 chain** | **BERFUNGSI** — 50/0 di 4 testnet (lihat §1b) | `node audit_multichain_flow.mjs` |
| **Kompatibilitas tautan lama** | 5/0 — `?token=` menang atas `?chain=` basi | `node audit_link_compat.mjs` |
| **Ganti chain di `/swap` mengubah panel** | 47/0 (dataset 4 chain), 31/0 (mainnet) | `node audit_swap_chain_switch.mjs` |
| **Pilih / ganti wallet & akun saat trading** | 16/0, termasuk bukti tx lewat wallet terpilih | `node audit_wallet_picker.mjs` |
| Token ber-supply tunggal lintas chain (bridged) | **TIDAK MUNGKIN sekarang** — 0G & Monad tanpa CCIP/LayerZero | `node audit_ccip_0g.mjs`, `node audit_bridge_probe2.mjs` |
| Kompatibilitas opcode (PUSH0/MCOPY/TSTORE) | **Terverifikasi didukung** di 4 chain mainnet | `node audit_opcode_compat.mjs` |
| Broadcast FactoryV2 ke mainnet (0G/Arbitrum/Base/Monad) | **BELUM** — perlu keputusan & gas | `scripts/deploy-sovereign-dex.mjs` siap |
| Web app (studio → explorer → DEX → chart) | **Selesai, 66/66 E2E lulus** | `node audit_e2e_flow.mjs` |
| Trading di mainnet | **BELUM AKTIF** sampai FactoryV2 dibroadcast | UI menampilkan alasan & mengunci tombol |
| 0G Compute AI router (`/api/chat`) | Live | streaming `glm-5.2` |
| Cloudflare Workers x402 edge | Live | `https://adexto-x402-edge.cucuvirtual.workers.dev` |
| Kontrak lama v1 (factory & hook) | Ada di chain tapi **tidak bisa settle swap** | lihat §6 |

**Yang penting dipahami:** kontrak v1 yang selama ini dipakai UI (`SovereignHook` `0x592c…98d8` dkk) tidak punya `receive()` maupun entrypoint swap. Setiap transfer native ke sana pasti revert. Karena itu seluruh fitur beli/jual sebelumnya tidak pernah bisa berhasil. Kontrak v2 di repo ini memperbaiki hal tersebut, tapi **belum dibroadcast**.

## 1a. Matriks uji lintas jaringan

Bytecode yang **identik** dengan kandidat mainnet diuji di lima EVM berbeda. Setiap baris menjalankan suite penuh: deploy factory, launch atomic (token + pool + seed), distribusi supply, resolusi `poolOf`/`tokenOf` on-chain, window anti-sniper, BUY, cek slippage & deadline, SELL lewat approve+transferFrom, `receive()`, buyback, dan proteksi symbol duplikat.

| Jaringan | chainId | Karakter EVM | Hasil |
|---|---|---|---|
| Devchain (Hardhat) | 31337 | referensi lokal | **LULUS SEMUA** |
| 0G Testnet | 16602 | target utama | **LULUS SEMUA** |
| Arbitrum Sepolia | 421614 | rollup Nitro, `block.number` = L1 | **LULUS SEMUA** |
| Base Sepolia | 84532 | OP-stack, ada L1 data fee | **LULUS SEMUA** |
| Monad Testnet | 10143 | eksekusi paralel | **LULUS SEMUA** |
| Ethereum Sepolia | 11155111 | L1 vanilla | **LULUS SEMUA** |

Ditambah **66/66** asersi E2E UI penuh (`node audit_e2e_flow.mjs`) di devchain, termasuk BUY dan SELL nyata lewat antarmuka.

Tiga kegagalan yang muncul selama proses ini semuanya **asumsi harness, bukan cacat kontrak**, dan sudah diperbaiki:

1. **Arbitrum**: `block.number` di Solidity mengembalikan nomor blok **L1**, jadi window anti-sniper `launchBlock + 5` ≈ 60 detik waktu nyata, bukan 5 blok L2. Suite tidak lagi menebak — ia mem-*probe* perilaku aktual lalu menunggu window berakhir.
2. **Base (OP-stack)**: ada **L1 data fee** di luar `gasUsed × gasPrice`. Rekonsiliasi saldo kini membaca `l1Fee` dari receipt mentah.
3. **0G Testnet**: blok terbit ~1 detik sehingga window anti-sniper bisa sudah lewat sebelum probe pertama dijalankan.

## 1b. Model multi-chain: apa yang benar-benar terjadi

Kata **"omnichain" sudah dihapus dari UI** karena menyesatkan. Yang berjalan adalah **peluncuran multi-chain**: satu alur, 1–4 chain, dan **setiap chain mendapat token serta pool sendiri**. Supply, likuiditas dan harga terpisah per chain. Tidak ada bridging.

Diuji lewat UI di empat testnet (factory dengan bytecode identik kandidat mainnet):

| Bagian | Hasil |
|---|---|
| Pilih 4 chain → `live on 4 of 4` | 4 market terdaftar, 4 alamat token berbeda, semuanya tradable |
| Explorer | 4 kartu, badge `+3 chain`, tautan `?chain=` per market |
| Halaman token | badge `4 chains`, switcher 4 tautan, berpindah chain memuat pool chain itu |
| Beli & jual | berhasil di dua chain berbeda (Monad dan Base Sepolia) |
| Pilih 2 chain | tepat 2 market, tombol menyebut `0G + Base` |
| Pilih 1 chain | tepat 1 market, `deployedChainCount = 1` |
| Ticker sudah dipakai di suatu chain | chain itu dilewati, chain lain tetap jalan |

Hasil setelah Base Sepolia diisi ulang: **50 lulus / 0 gagal**, nol page error.

Matriks lengkap pengujian ulang:

| Suite | Cakupan | Hasil |
|---|---|---|
| `scripts/test-sovereign-dex.mjs` | kontrak, 5 jaringan (devchain, 0G Testnet, Arb Sepolia, Base Sepolia, Monad Testnet) | LULUS SEMUA di kelimanya |
| `audit_multichain_flow.mjs` | UI 1–4 chain di 4 testnet | 50 / 0 |
| `audit_studio_testnet_flow.mjs` | studio → explorer → swap → terminal di 0G Testnet | 40 / 0 |
| `audit_e2e_flow.mjs` | E2E devchain | 66 / 0 |
| `audit_link_compat.mjs` | kompatibilitas tautan lama | 5 / 0 |
| `audit_hydration.mjs` | 8 rute, error hidrasi React | 0 rute bermasalah |
| `audit_opcode_compat.mjs` | PUSH0/MCOPY/TSTORE di 4 chain mainnet | didukung semua |

Tiga asersi yang dulu gagal ternyata dua sebab berbeda, dan keduanya sudah dituntaskan:

1. **Dana Base Sepolia habis** — sudah diisi ulang, dua asersi itu kini lulus.
2. **Asersi jual memang salah.** Yang lama menuntut *saldo native penjual naik*. Itu keliru: di Monad gas 202 gwei bisa **melebihi** hasil jual posisi kecil, jadi saldo wajar turun meski penjualan sukses. Asersinya sekarang mengukur di sisi pool dan menutup akuntansinya: `hasil (pembayaran pool) − gas = perubahan saldo penjual`. Terbukti di dua chain dengan hasil identik 0,0000176357 tetapi gas Monad 0,0208 versus Base 0,00000085 — sekitar 24.000x. Ini juga memperkuat bahwa matematika AMM-nya deterministik lintas chain.

Factory testnet yang dipakai:

| Chain uji | chainId | Factory |
|---|---|---|
| 0G Testnet | 16602 | `0x6394E3820d62a9Ab901128bEf5A04860b71A535c` |
| Arbitrum Sepolia | 421614 | `0x75EeDEd196D2BE283d815D52F617eB70bCe865bC` |
| Base Sepolia | 84532 | `0x5A2F13f1eFB86bD1e1814A5212690A2B765c85C8` |
| Monad Testnet | 10143 | `0x33811F9c53da5071A130F18D844f64999dBD43bA` |

Untuk menjalankan pengujian ini, keempat slot chain produksi diarahkan ke testnet lewat satu env var (`NEXT_PUBLIC_CHAIN_OVERRIDES`, JSON per ChainKey). Variabel itu **tidak diset di produksi**, jadi tidak berpengaruh apa pun di sana.

### Biaya sebenarnya per chain: seed, bukan gas

Ini sering disalahpahami. Contoh terukur di Base Sepolia (gas 0,011 gwei):

| Item | Gas | Biaya |
|---|---|---|
| deploy factory (sekali per chain) | 3.821.825 | 0,0000420 ETH |
| launch token + pool | 2.819.449 | 0,0000310 ETH |
| beli | 120.000 | 0,0000013 ETH |
| approve + jual | 176.000 | 0,0000019 ETH |
| **seed likuiditas per launch** | — | **0,0005 ETH — terkunci permanen** |

Seed itu **16x lebih besar** dari gas launch. Jadi ketika saldo Base 0,005 ETH cepat habis, dananya tidak terbakar jadi gas — dana itu ada di dalam pool-pool yang dibuat (sekitar 9 launch uji) dan tidak bisa ditarik, sesuai desain rug-proof. Total per launch di Base ≈ 0,000531 ETH, jadi 0,005 ETH cukup untuk ~9 launch.

Konsekuensi operasional: yang perlu disiapkan di setiap chain adalah **aset native chain itu** — ETH di Base dan Arbitrum, MON di Monad, 0G di 0G. Chain yang saldonya kurang akan gagal sendiri tanpa mengganggu chain lain, dan pra-simulasi memastikan kegagalan itu tidak membakar gas.

## 1c. Kenapa "bayar sekali di 0G untuk 4 chain" belum bisa

Desainnya sendiri masuk akal: kirim pesan CCIP dari 0G, receiver di chain tujuan memanggil factory lokal. Yang menghalangi adalah ketersediaan infrastruktur, diverifikasi langsung:

| Chain | CCIP Router | LayerZero |
|---|---|---|
| 0G Mainnet | **tidak ada** (Chainlink tidak mempublikasikan router untuk 0G) | endpoint tidak berfungsi (`chainId()` revert) |
| Monad Mainnet | **tidak ada** | endpoint tidak berfungsi |
| Arbitrum One | `Router 1.2.0` berfungsi | V2 berfungsi (`eid` 30110) |
| Base Mainnet | `Router 1.2.0` berfungsi | V2 berfungsi (`eid` 30184) |

0G tidak bisa menjadi chain **pengirim**: tidak ada Router untuk `ccipSend`, dan lane CCIP hanya bisa dibuka oleh Chainlink — bukan sesuatu yang bisa kita deploy sendiri.

**Kontrak CCIP yang runbook lama klaim "LIVE" ternyata tidak berfungsi.** Dibaca dari `router()` masing-masing receiver yang sudah ter-deploy:

| Chain | `router()` menunjuk ke | Kondisi |
|---|---|---|
| 0G `0xaD0C7BFF…` | `0x8a3c7524…ee7D` | itu wallet deployer, bukan router |
| Arbitrum `0x5800e971…` | `0x141F05786FFb…` | tidak ada kontrak (salah ketik dari `0x141fa059…`) |
| Base `0x1eE8701D…` | `0x881e3A65…` | benar, Router 1.2.0 asli |
| Monad `0x1eE8701D…` | `0x0000…0000` | alamat nol |

Tiga dari empat tidak akan pernah bisa menerima pesan CCIP. Klaim CCIP di UI sudah dikoreksi.

Jalan menuju UX "bayar sekali di 0G" tanpa CCIP: **relayer sendiri** — user mengirim satu transaksi di 0G, backend memantau event lalu mengeksekusi launch di chain lain memakai treasury sendiri, dan menahan fee 0G sebagai penggantinya. Hambatannya bukan pesan lintas-chain, melainkan **treasury**: pool di Base butuh ETH dan pool di Monad butuh MON, dan 0G tidak bisa berubah jadi ETH tanpa ada yang menjembatani nilainya. Ditunda sampai dana treasury tersedia.

### Verifikasi produksi terakhir

Container `adexto-production` sehat (healthcheck lulus), `/app/data` writable oleh uid 1001, volume `adexto_adexto-data` terpasang. Semua rute balas 200 kecuali `/token/tidakada` yang benar-benar 404. `/api/graphql` melaporkan `registry.durable: true`, `tradableProjects: 0`, `verifiedProjects: 1`, dan harga tersimpan sebagai `priceNative` + `nativeSymbol` (AEGIS 0,0184 0G · QNOVA 0,00018 ETH · CSENT 0,00008 ETH · MQUANT 0,0015 MON). `POST /api/agent/telemetry` menolak tanpa token (401) dan dengan token salah (403). UI menampilkan alasan pool belum tradable di `/studio`, `/swap`, `/explorer` dan `/token/*`, dan tombol trading dikunci. Nol error konsol/halaman.

---

## 1e. Akses git & push ke GitHub

Remote: `https://github.com/0xcuy/adexto.git` (HTTPS, jadi butuh token — bukan SSH).

**Kredensial tidak disimpan di repo ini.** Tidak ada credential helper git yang terpasang, `gh` CLI tidak ada, dan tidak ada variabel token di `.env.local`. Personal Access Token klasik (`ghp_…`) milik akun `0xcuy` berada di:

```
/home/cucu/Coder/Work/token github 0xcuy
```

File itu di luar repo, satu baris, hanya berisi token. **Jangan pernah menuliskan nilainya ke runbook, `.env.example`, atau berkas apa pun di dalam repo** — runbook ini ikut ter-commit, dan itu persis kesalahan `OG_ROUTER_API_KEY` yang sudah terjadi (§7). Catat lokasinya saja.

Cara push tanpa membocorkan token ke riwayat perintah maupun keluaran terminal — buat helper askpass sekali pakai, lalu hapus:

```bash
cat > /tmp/askpass.sh <<'SH'
#!/bin/sh
case "$1" in
  *[Uu]sername*) printf '0xcuy' ;;
  *) tr -d '\r\n' < '/home/cucu/Coder/Work/token github 0xcuy' ;;
esac
SH
chmod +x /tmp/askpass.sh
GIT_ASKPASS=/tmp/askpass.sh GIT_TERMINAL_PROMPT=0 git push -u origin <branch>
rm -f /tmp/askpass.sh
```

Menaruh token langsung di URL (`https://TOKEN@github.com/...`) akan menyimpannya di `.git/config` dan di riwayat shell. Jangan.

**Kebijakan branch.** Push selalu ke branch baru, tidak langsung ke `main`. Branch pertama dari pekerjaan ini: `feat/sovereign-curve-plan-and-ui-overhaul` (6 commit). Merge dilakukan pemilik proyek lewat pull request:

```
https://github.com/0xcuy/adexto/pull/new/feat/sovereign-curve-plan-and-ui-overhaul
```

Sebelum setiap push, periksa diff tidak memuat rahasia:

```bash
git diff origin/main..HEAD --name-only | grep -iE '\.env|secret|key'
git diff origin/main..HEAD | grep -cE 'ghp_|github_pat_|sk-[a-f0-9]{8}'
```

Catatan: satu kemunculan `sk-9c741a02…` memang ada di diff branch ini, tetapi sebagai baris **yang dihapus** (`-`). Kunci itu tetap ada di riwayat git lama. **Tidak dirotasi atas keputusan pemilik proyek** karena budget kunci sudah dibatasi — lihat §3.

## 2. Akses VPS produksi

```bash
# SSH
ssh -i ~/.ssh/id_ed25519 root@168.144.249.185
```

**Fail2ban agresif.** Selalu gabungkan perintah dalam 1–2 koneksi. Jika kena `Connection refused`, tunggu 60–90 detik.

Topologi: Caddy (80/443) → `docker-proxy` 3000 → container `adexto-production`.

### Deploy

```bash
# 1. Sync repo. Daftar exclude ada di .rsyncignore (node_modules, .next, .env.local, dll).
#    Pakai --exclude-from, bukan rangkaian --exclude di baris terpisah: pernah terjadi
#    argumennya tidak terpakai sehingga node_modules ikut terkirim dan transfer mati
#    sebelum src/ tersalin.
rsync -rlptvz --exclude-from=.rsyncignore \
  -e "ssh -i /home/cucu/.ssh/id_ed25519" \
  /home/cucu/Coder/Work/adexto/ root@168.144.249.185:/root/adexto/

# 2. Build & jalankan (satu batch)
ssh -i ~/.ssh/id_ed25519 root@168.144.249.185 \
  "cd /root/adexto && set -a && . ./.env.local && set +a && \
   docker compose down && docker compose build && docker compose up -d"

# 3. Cek
ssh -i ~/.ssh/id_ed25519 root@168.144.249.185 \
  "docker ps --filter name=adexto-production && docker logs --tail 40 adexto-production"
```

> **Kenapa `set -a && . ./.env.local`:** `env_file` di compose hanya mengisi environment *runtime container*, bukan build arg. Interpolasi `${NEXT_PUBLIC_FACTORY_V2_0G}` di `docker-compose.yml` dibaca dari environment shell (atau file `.env`). Karena `NEXT_PUBLIC_*` di-inline ke bundle klien saat build, nilainya harus ada di shell saat `docker compose build`. Konsekuensinya: **mengubah alamat factory wajib rebuild, bukan cuma restart.**

---

## 2b. Deploy ke produksi — SATU perintah, wajib tiap kali

```bash
bash scripts/deploy-vps.sh
```

**Aturannya: begitu perbaikan lulus uji di lokal, langsung deploy.** Jangan menumpuk perubahan. Berulang kali sebelumnya bug yang "sudah diperbaiki" masih terlihat pengguna di adexto.xyz karena produksi menyajikan build lama — bukan karena perbaikannya salah, tapi karena tidak pernah sampai ke server.

Skrip itu melakukan empat langkah dan **memverifikasi hasilnya**, bukan hanya menjalankan perintah:

1. `rsync` sesuai `.rsyncignore`
2. `docker compose build`
3. `docker compose up -d` lalu tampilkan status kontainer
4. Tunggu kontainer benar-benar melayani, cek 8 rute publik harus 200, dan pastikan kosakata generasi lama tidak tersaji

Yang perlu diingat:

- **`.env.local` TIDAK dikirim** (ada di `.rsyncignore`). Env produksi hidup di VPS dan sengaja tidak ditimpa dari mesin pengembang.
- **Mengubah env di VPS wajib diikuti build ulang**, bukan sekadar restart. Nilai `NEXT_PUBLIC_*` ter-inline saat `next build`, dan build terjadi di dalam image.
- Host/kunci/URL bisa ditimpa lewat `ADEXTO_VPS_HOST`, `ADEXTO_VPS_KEY`, `ADEXTO_VPS_DIR`, `ADEXTO_PUBLIC_URL`.
- Skrip ini menyalin apa adanya; ia tidak menilai benar atau salah. Jalankan setelah uji lokal lulus.

**Keadaan produksi saat tulisan ini dibuat** (terverifikasi setelah deploy): 8 rute 200 · nol kosakata usang · gerbang World ID `wallet-signature-only` karena env-nya kosong (jujur, bukan diam-diam) · `/api/chat` 200 · `/` lewat IP server 200, membuktikan perbaikan middleware ikut terpasang.

**Jebakan di skrip ini yang sempat menipu:** dengan `set -e` dan `pipefail`, `grep` yang tidak menemukan apa pun keluar berstatus 1 dan mematikan skrip — artinya kasus **copy bersih** justru dilaporkan sebagai deploy gagal. Karena itu ada `|| true` pada pemeriksaan copy. Jangan dihapus.

## 3. Variabel lingkungan

Semua rahasia hanya di `.env.local` (tidak pernah di-commit). Template: `.env.example`.

| Variabel | Wajib | Fungsi |
|---|---|---|
| `OG_ROUTER_URL`, `OG_ROUTER_API_KEY`, `OG_MODEL` | ya | 0G Compute untuk `/api/chat` & `/api/generate-logo` |
| `OG_RPC_URL`, `OG_STORAGE_INDEXER` | ya | RPC 0G & indexer DA |
| `OG_PRIVATE_KEY` / `PRIVATE_KEY` | opsional | Anchor metadata ke 0G DA. **Kalau diisi, tiap launch melakukan upload on-chain berbiaya gas.** Kalau kosong, root DA jadi hash deterministik (tanpa biaya) dan launch tetap jalan. |
| `ADEXTO_DATA_DIR` | ya di Docker | Lokasi registry proyek + telemetry. Di container `= /app/data`. Volume bernama **`adexto_adexto-data`** (compose menambah prefiks proyek) — `docker volume inspect adexto-data` akan gagal, pakai nama lengkapnya untuk backup. Persistensi sudah diuji: penanda ditulis ke `/app/data`, `docker compose up -d --force-recreate`, penanda tetap ada. |
| `NEXT_PUBLIC_CHAIN_OVERRIDES` | **tidak** di produksi | Hanya untuk pengujian (§1b). Bila diset, ia mengarahkan slot chain produksi ke testnet. Pastikan tetap kosong di `.env.local` VPS — sudah diverifikasi 0 kemunculan. |
| `ADEXTO_TELEMETRY_SECRET` | ya untuk ingest | Bearer token `POST /api/agent/telemetry`. Minimal 16 karakter. Tanpa ini endpoint menolak semua tulisan (fail closed). |
| `NEXT_PUBLIC_FACTORY_V2_0G` / `_ARBITRUM` / `_BASE` / `_MONAD` | untuk mengaktifkan DEX | Alamat `AdextoTrinityFactoryV2`. Kosong = chain itu ditandai "DEX belum live", launching & trading dikunci. |
| `NEXT_PUBLIC_WORLD_ID_APP_ID` | opsional | Kalau diisi, gate studio bisa diupgrade ke World ID ZKP. Selama kosong, gate = attestation tanda tangan alamat (lihat §7). |
| `NEXT_PUBLIC_DEVCHAIN_RPC`, `NEXT_PUBLIC_FACTORY_V2_DEVCHAIN` | hanya lokal | Mengaktifkan chain uji 31337. **Jangan diset di produksi.** |

> **`OG_ROUTER_API_KEY` — risiko diterima, jangan diangkat lagi.** Kunci ini pernah tertulis plaintext di `docker-compose.yml` yang ter-track git, jadi nilainya harus dianggap bocor dan masih ada di riwayat git. **Pemilik proyek sudah memasang batas budget pada kunci tersebut**, sehingga kerugian maksimum kalau dipakai orang lain sudah terkurung di angka itu. Keputusan: **tidak dirotasi**, dan ini bukan lagi item terbuka. Jangan mengusulkan rotasi di laporan berikutnya.
>
> Yang tetap berlaku: fallback kunci di dalam sumber sudah dihapus dan `/api/chat` fail-closed 503 tanpa env, jadi tidak ada kunci baru yang ikut ter-commit. Kalau suatu saat batas budget dinaikkan atau kunci dipakai untuk layanan berbayar lain, keputusan ini perlu ditinjau ulang.

---

## 4. Arsitektur alur (setelah perbaikan)

```
[ Creator ]
    │  1. tanda tangan attestation (diverifikasi server: ethers.verifyMessage)
    ▼
[ POST /api/deploy stage=prepare ]
    │  cek ticker (reserved/duplikat) + anchor metadata ke 0G DA → attestationRoot
    ▼
[ AdextoTrinityFactoryV2.deployTrinityProject(...) payable ]   ← satu tx per chain
    │  simulasi staticCall dulu (revert = 0 gas)
    ├─► deploy SovereignHook (pool)
    ├─► deploy AdextoToken (ERC-8004), bind ke pool
    ├─► approve + initializePool{value: seed}
    └─► sisa supply → wallet creator
    │
    │  emit TrinityProjectDeployed(token, pool, creator, …)
    ▼
[ POST /api/deploy stage=confirm ]
    │  ambil receipt on-chain → parse event → getCode(token) → baca reserve pool
    ▼
[ Registry (ADEXTO_DATA_DIR/projects.json) ]
    │
    ├─► /explorer          harga native → USD via /api/prices, badge verified & pool live
    ├─► /swap?token=SYM    quote constant-product, slippage, chain guard
    ├─► /token/<slug>      terminal: chart + depth + feed + buy/sell
    └─► /api/agent/telemetry  candle OHLC dari event Swap on-chain
```

Beli: `pool.buy(minTokensOut, to, deadline){value}`.
Jual: `token.approve(pool, amount)` → `pool.sell(amountIn, minNativeOut, to, deadline)`. Tidak ada native yang keluar dari wallet selain gas.

---

## 1d. Keputusan pool: dari seed wajib ke bonding curve virtual

### Riwayat, supaya jelas siapa memutuskan apa

**v1 tidak punya pool sama sekali.** Grep `initializePool` di `AdextoTrinityFactory.sol` (v1) tidak menghasilkan apa pun. Seluruh supply di-mint ke factory dan tersangkut di sana, dan "Sovereign DEX" hasil launch tidak ada wujudnya on-chain. Ini tercatat di komentar header `AdextoTrinityFactoryV2`.

**Pool berseed adalah keputusan saya (agen), bukan permintaan pemilik proyek.** Saat memperbaiki v1, saya menulis `SovereignHook` eksekutabel + `AdextoTrinityFactoryV2` dengan `require(msg.value > 0, "Factory: native liquidity required")`. Konsekuensinya, dua elemen UI berikut juga saya yang tambahkan:

- field **"Seed liquidity (native, required)"** di studio — ada karena factory saya mewajibkan `msg.value`;
- slider **"Supply into pool / sisanya ke wallet"** (`poolTokenBps`, default 80) — ada karena factory saya membagi supply antara pool dan creator.

Tier fee **0,10% / 0,30% / 0,50%** sudah ada sebelumnya dan bukan buatan saya.

**Kesalahan yang perlu dicatat:** saat menawarkan pilihan, saya hanya menyajikan dua opsi — seed terkunci permanen versus LP shares — dan **tidak pernah menawarkan bonding curve virtual**. Saya mengoptimalkan untuk "AMM yang paling lurus dibuktikan benar dan diuji di enam jaringan", bukan untuk kemudahan adopsi. Untuk sebuah launchpad itu framing yang salah: seed adalah **16x biaya gas** dan terkunci permanen, dan untuk 4 chain creator harus punya aset native di keempatnya. Itu penghalang adopsi terbesar, dan bertentangan dengan pengumuman publik yang menjanjikan tanpa setoran modal.

### Desain yang disetujui

Kurva produk-konstan dengan reserve **virtual**, tanpa graduation.

```
V = reserve native virtual (hanya angka di storage, bukan uang)
T = token di kurva
R = native nyata dari pembeli (mulai 0)
S = token terjual
harga = (V + R) / (T − S)
```

- **Creator setor nol.** Hanya gas: 0G ~$0,02 · Base ~$0,09 · Monad ~$0,03 · Arbitrum ~$0,34.
- **Tanpa graduation.** Migrasi kurva → pool AMM adalah tempat sebagian besar eksploit launchpad terjadi. Kurva permanen juga konsisten dengan prinsip "tidak ada fungsi penarikan".
- **Solvensi terbukti dari konstruksi.** Karena `k/(T−S) ≥ k/T = V`, maka `R ≥ 0` selalu. Kontrak tidak bisa membayar lebih dari yang pernah diterimanya — dijamin bentuk rumus, bukan pengecekan `if` yang bisa salah tulis. `R` mencapai titik terendah tepat saat semua token kembali (`S = 0`), dan di titik itu `R` masih berisi akumulasi fee.
- **Lantai harga naik seiring volume.** Fee depth mengendap di `R`, jadi saat `S = 0` harga = `(V + fee terkumpul) / T`, naik monoton dari `V/T`. Lantai dibangun oleh aktivitas pasar, bukan oleh kantong creator. Pump.fun tidak punya properti ini.

**Parameter `V`.** Karena 100% supply masuk kurva (`T` = supply), maka `V` **sama dengan market cap pembukaan dalam aset native**. Target ~$3.000 ekuivalen per chain:

| Chain | `V` | Market cap pembukaan |
|---|---|---|
| 0G | 1.500 0G | ~$3.150 |
| Base / Arbitrum | 1 ETH | ~$3.000 |
| Monad | 60.000 MON | ~$3.000 |

Perilaku dengan supply 1 miliar dan `V` = 1 ETH: beli $100 → 32,1 juta token (3,2% supply), harga +6,7%; beli $3.000 → 500 juta token (50% supply), harga +100%.

### Pendapatan creator: dari fee, bukan dari alokasi token

Creator mendapat **nol token gratis** — inilah yang menghapus bahan dump. Penghasilannya dua jalur:

1. **Irisan fee swap.** Fee dibelah menjadi tiga di dalam total yang sudah ada, sehingga trader tidak dibebani tambahan. Untuk tier Standard 0,30%: depth 0,15% (mengendap di kurva) · **creator 0,10%** (streaming ke wallet creator tiap swap) · buyback 0,05% (agent vault). Creator menerima sepertiga fee. Pada volume kumulatif $1 juta, creator terima $1.000 tanpa klaim manual.
2. **x402 edge API.** Pemanggil eksternal bayar EIP-712 micropayment lewat header `X-Creator-Vault`, settle USDC langsung ke wallet creator. Tidak bergantung volume trading sama sekali.

Alamat creator dikunci saat launch di `SovereignCurve` sehingga tidak bisa dialihkan setelahnya.

### Perbandingan dengan platform pembanding

- **pump.fun** memberi creator bagian fee trading dibayar SOL real-time — mulai 0,05% sebagai 50% pendapatan PumpSwap ([The Defiant](https://thedefiant.io/news/defi/pumpfun-kicks-off-revenue-sharing)), lalu naik ke 0,3% untuk token di bonding curve ([Smithii](https://smithii.io/en/project-ascend-update/)). Motifnya sama dengan kita: dulu satu-satunya cara dev untung adalah menjual token sendiri, dan itu melahirkan rug pull berulang ([KuCoin](https://www.kucoin.com/news/articles/how-pump-fun-fee-sharing-reshapes-memecoin-economics-in-2026)). Catatan penting: bagian creator itu didanai fee **tambahan** yang dibebankan ke pengguna, bukan dipotong dari pendapatan yang sudah ada ([SolanaFloor](https://solanafloor.com/news/pump-fun-s-creator-revenue-sharing-reality-vs-hype)) — dan mereka dikritik karenanya. ADEXTO membelah fee yang sudah ada, tidak menambah beban.
- **Virtuals Protocol** mewajibkan creator membayar 100 $VIRTUAL untuk membuat kurva ([whitepaper](https://whitepaper.virtuals.io/builders-hub/genesis-launch/modes)), dengan pembagian fee 30% creator / 70% Agent Wallet dan Subdao ([whitepaper](https://whitepaper.virtuals.io/info-hub/builders-hub/more-on-standard-launch)).

*Ringkasan dua butir di atas diparafrasekan untuk mematuhi ketentuan lisensi sumber.*

### Yang akan dibangun

1. `contracts/SovereignCurve.sol` — kurva virtual; mempertahankan yang sudah lulus uji: window anti-sniper 1%, `receive()` sebagai market buy, buyback agent, tanpa fungsi penarikan. Tambahan `creatorFeeBps` + alamat creator terkunci.
2. `contracts/AdextoCurveFactory.sol` — token + kurva atomik, `msg.value` tidak lagi diwajibkan, 100% supply ke kurva.
3. Studio: field seed dan slider supply **dihapus**; sisa form hanya nama, ticker, supply, tier fee, pilihan chain.
4. Uji: devchain lebih dulu, termasuk skenario **semua pembeli menjual habis** untuk membuktikan penjual terakhir tetap terbayar dan saldo tidak pernah minus, plus pembulatan yang selalu berpihak ke pool. Lalu 4 testnet memakai harness yang sudah ada.

### Status: kontrak sudah ditulis dan divalidasi

`contracts/SovereignCurve.sol` (8,72 KiB) dan `contracts/AdextoCurveFactory.sol` (18,24 KiB) sudah ada dan terkompilasi dengan `node scripts/compile-contracts.mjs --via-ir`. Uji: `node scripts/test-sovereign-curve.mjs`.

**LULUS SEMUA di lima jaringan:** devchain 31337, 0G Testnet 16602, Arbitrum Sepolia 421614, Base Sepolia 84532, Monad Testnet 10143.

Yang dibuktikan pengujian, bukan diklaim:

| Yang diuji | Hasil terukur (devchain, V = 1, supply 1 M) |
|---|---|
| Launch tanpa modal | native yang keluar **tepat sama** dengan gas; tidak ada seed |
| Supply | 100% di kurva, creator **nol token**, factory tidak menyimpan sisa |
| Harga buka | `V/T` = 1,0e-9 native/token, sesuai rumus |
| Beli 0,05 | 47.482.973 token, harga naik ke 1,1022e-9 |
| **Jual habis semuanya** | butuh 0,032644 sementara kurva punya 0,03279 → **penjual terakhir tetap terbayar, tanpa revert** |
| Native kurva setelah jual habis | 0,000145 — **tidak pernah minus** |
| Lantai harga | naik dari 1,000000000e-9 ke **1,000149781e-9** |
| Harga setelah semua menjual | 1,000145405e-9, **tidak pernah di bawah harga buka** |
| Fee creator | terakumulasi lalu terbayar penuh; klaim kedua tanpa saldo ditolak |
| Buyback agent | token terbakar, total supply berkurang |
| Invarian solvensi | `saldo ≥ kurva + utang creator + vault` diperiksa **setelah setiap mutasi**, selisih selalu 0 |

Penjagaan yang terbukti menolak: jual melebihi token beredar, `minTokensOut` mustahil, deadline lampau, inisialisasi ulang, dan symbol duplikat.

**Catatan harness.** Perhitungan "berapa yang saya terima" wajib memakai `txCost()`, bukan `gasUsed * gasPrice`. Di chain OP-stack seperti Base, receipt mentah punya `l1Fee` yang juga dipotong dari saldo; mengabaikannya membuat klaim fee tampak nol padahal pembayarannya berhasil. Kesalahan ini sempat memunculkan 3 kegagalan palsu di Base Sepolia.

### Sisi aplikasi sudah menyusul kontrak

Mengubah kontrak tanpa mengubah UI berarti perubahan setengah jadi, jadi keduanya kini sejalan. Uji: `node audit_curve_ui_flow.mjs` (devchain) — **23 LULUS / 0 GAGAL**.

- `src/lib/dex.ts`: `SOVEREIGN_CURVE_ABI` + `CURVE_FACTORY_ABI`. `PoolState` bertambah `isCurve`, `creatorFeeBps`, `virtualNative`, `realNative`, `creatorOwed`, `creator`, `floorPriceNative`. Pembacaan khusus kurva dibungkus `try`: pada `SovereignHook` lama panggilan itu revert, jadi satu jalur kode melayani kedua generasi tanpa perlu flag dari pemanggil. `Quote` bertambah `creatorFee`, dan matematika kuotasi lokal ikut memotongnya — kalau tidak, setiap kuotasi akan kelebihan sebesar fee creator dan hasil on-chain tidak cocok dengan yang dilihat user.
- `src/lib/chains.ts`: `factoryV3Address`, `launchGeneration` (v3 menang bila keduanya ada), dan `defaultVirtualNative` per chain — 0G 1.500 · Base/Arbitrum 1 · Monad 60.000, semuanya menyasar ~$3k market cap pembukaan. Satu angka bersama akan menilai launch 0G beberapa dolar dan launch Base ribuan dolar.
- **Studio:** field *Seed liquidity* dan slider *Supply into pool* **dihapus**. Tier fee jadi tiga irisan (depth · creator · buyback) di dalam total yang sama. Tombol berbunyi `Launch on … · gas only`. Calldata `deployTrinity` dibangun **per chain** karena `virtualNative` berbeda tiap chain.
- **`/swap` & terminal:** baris fee menampilkan tiga irisan, termasuk porsi creator.
- **Terminal:** panel *Your creator revenue* dengan tombol Claim, hanya tampil bagi alamat creator yang terkunci di kurva.
- `/api/deploy`: membaca event v3 (`curve`, `virtualNative`, `curveTokens`) dan tetap menerima nama field v2, sehingga registry lama tetap terbaca.

Terverifikasi lewat UI: `/api/deploy` melaporkan `gen=v3`, launch memakan **gas saja** (0,00524 di devchain), 100% supply di kurva, creator memegang **nol** token, pembelian menaikkan native nyata kurva, dan klaim fee creator membawa `creatorOwed` ke nol.

**Jebakan yang sempat membuang waktu:** sebuah `next-server` lama berumur 1,75 jam masih menahan port 3100, sehingga build baru tidak pernah tersaji dan hasil verifikasi terlihat seperti kode belum berubah. Periksa `ss -ltnp | grep :3100` sebelum menyimpulkan build tidak berlaku.

### 1e-2. Curve factory lulus ujung-ke-ujung di 4 testnet

Curve factory dideploy ke keempat testnet — **gas saja, tanpa setoran apa pun**. `projects=0` saat deploy, ticker `ADEXTO` masih tersedia di keempatnya.

Angka bytecode di revisi ini pernah tertulis 18.568 byte, dan itu bytecode PRA-RENAME yang sudah tidak berlaku. Setelah deploy ulang 2026-08-21 (lihat §1e-3) bytecode-nya 18,05 KiB dan runtime on-chain 18.460 byte, identik dengan artifact di repo — diperiksa oleh `audit_testnet_buyback.mjs`.

| Chain | chainId | AdextoCurveFactory |
|---|---|---|
| 0G Testnet | 16602 | `0x99CBfE5d33542b3611639C4fDC664d99F541D96D` — diganti 2026-08-21, sebelumnya `0xeaC93b76…` |
| Arbitrum Sepolia | 421614 | `0x4c337FD1a65fEAaC248b138E47C0C40B84CF3f1f` — diganti 2026-08-21, sebelumnya `0xb89d17F7…` |
| Base Sepolia | 84532 | `0xe21e5b875B9F6B99a8151166EF079C1F9E1c092e` — diganti 2026-08-21, sebelumnya `0x921E0328…` |
| Monad Testnet | 10143 | `0x213494Bff0962AbFCcD73364de7616f5a5517E47` — diganti 2026-08-21, sebelumnya `0x516D0053…` |
| devchain | 31337 | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |

Gas deploy 4.054.815 (Monad 4.086.015). Tercatat di `build/deployments.json`.

Hasil harness setelah seluruhnya disesuaikan ke alur kurva:

| Suite | Cakupan | Hasil |
|---|---|---|
| `scripts/test-sovereign-curve.mjs` | kontrak kurva di devchain, termasuk skenario jual-habis | LULUS SEMUA |
| `audit_e2e_flow.mjs` | E2E devchain, launch + beli + jual + chart | **75 / 0** |
| `audit_curve_ui_flow.mjs` | alur kurva devchain + klaim fee creator | **23 / 0** |
| `audit_studio_testnet_flow.mjs` | studio → explorer → swap → terminal di 0G Testnet | **54 / 0** |
| `audit_multichain_flow.mjs` | UI 1–4 chain di 4 testnet | **62 / 0** |
| `audit_swap_chain_switch.mjs` | pemilihan market & pindah chain | 56 / 0 |
| `audit_wallet_picker.mjs` | kontrol wallet | 19 / 0 |
| `audit_hydration.mjs` | error hidrasi React | 0 rute bermasalah |
| `audit_visual_sweep.mjs` | desktop + mobile, 9 rute | 0 temuan |

Asersi baru yang penting: harness kini membuktikan **kebalikan** dari model lama — `realNative === 0` saat launch, reserve native awal sama dengan reserve virtual, creator memegang **nol** token, 100% supply di kurva, dan biaya launch diukur dari saldo native (`< 0,05`) untuk memastikan benar-benar hanya gas. Di `audit_multichain_flow.mjs` pemeriksaan itu dilakukan **per chain**, supaya satu chain yang diam-diam masih memakai generasi berseed tidak bisa lolos.

**Dua bug produk ditemukan justru oleh harness yang sudah diperbaiki:**

1. **Chart dan trade feed kosong untuk semua pool kurva.** `SovereignCurve.Swap` memecah fee menjadi `depthFee, creatorFee, treasuryFee`, satu parameter lebih banyak daripada `SovereignHook.Swap`. Parameter tambahan mengubah `topic0`, jadi filter log yang hanya memakai ABI hook **tidak pernah cocok**: `source=empty`, nol fill, chart garis datar — padahal swap benar-benar terjadi. `src/lib/onchain-trades.ts` sekarang meng-query dengan `topic0` berupa daftar (OR) lalu memilih interface sesuai `topic0` tiap log.
2. **`parseSwapOut` diam-diam melaporkan angka simulasi.** Fungsi itu hanya diberi interface hook, sehingga untuk pool kurva `parseLog` selalu gagal dan pemanggil jatuh ke hasil `staticCall`. Angkanya kebetulan sama sehingga kegagalannya tak terlihat, tapi yang ditampilkan bukan lagi hasil terkonfirmasi. Kini kedua interface dicoba.

**Copy UI yang masih menyebut model lama juga dibereskan** (studio, `/swap`, terminal token, explorer, docs, halaman not-found, `/api/pool`, `use-sovereign-swap`, hero landing): tidak ada lagi "seed liquidity", "LP rewards", "SovereignHook pool", atau "AdextoTrinityFactoryV2" di permukaan yang dilihat pengguna. Tooltip chain di studio juga berhenti menampilkan `factoryV2Address` yang bernilai `null` di chain kurva.

**Satu cacat layout diperbaiki:** catatan attestation di studio memakai `<p className="flex">` dengan `<strong>` dan `<code>` inline. Karena induknya flex container, setiap potongan teks menjadi item flex terpisah dan tersusun **menyamping**, sehingga kalimatnya terbaca menyilang antar kolom. Teks sekarang dibungkus satu `<span>`. Terlihat jelas di frame video sebelum/sesudah.

### 1e-3. Video demo testnet

`node record_demo_testnet.mjs` → `public/adexto_testnet_demo.mp4` (**360 detik, 1920×1080**) + `.webm`. Direkam di 0G Testnet dengan transaksi nyata: launch tanpa setoran, beli dari terminal, beli dari `/swap`, jual dengan approve, lalu **klaim penghasilan creator** hingga `creatorOwed` nol. `page errors: 0`.

Adegan 8a sengaja ditambahkan karena itu inti model ekonominya: creator dibayar dari fee, bukan dari alokasi token. Verifikasi tidak berhenti di exit code — frame diekstrak dengan `ffmpeg` dan diperiksa satu per satu; dua putaran perekaman dibuang karena frame masih memperlihatkan copy lama dan cacat layout di atas.

## 1h. World ID: proof of personhood sebagai gerbang peluncuran

Sebelum ini gerbangnya hanya tanda tangan wallet. Itu membuktikan seseorang menguasai **sebuah alamat** — dan alamat baru bisa dibuat tanpa batas, jadi tidak ada hambatan Sybil sama sekali. Sekarang ada lapisan kedua yang sesungguhnya.

**Aliran:** studio membaca status gerbang dari `GET /api/worldid/verify` → widget IDKit menghasilkan proof → `POST /api/worldid/verify` memverifikasi di **server** → server menerbitkan token ber-HMAC terikat alamat → `/api/deploy` menolak launch tanpa token itu.

| Berkas | Peran |
|---|---|
| `src/lib/worldid.ts` | Verifikasi proof, penyimpanan nullifier, terbit/periksa token |
| `src/app/api/worldid/verify/route.ts` | `GET` status gerbang · `POST` verifikasi proof |
| `src/components/WorldIdVerifyButton.tsx` | Widget IDKit, dimuat dinamis |
| `audit_worldid_gate.mjs` | Harness dua mode dengan stub verifier lokal |

**Keputusan yang perlu diketahui:**

- **Verifikasi WAJIB di server.** Proof yang divalidasi di browser tidak bernilai apa pun: penyerang tinggal memanggil `/api/deploy` langsung tanpa membuka UI.
- **Ditegakkan di DUA tahap** `/api/deploy`: `prepare` dan `confirm`. Tahap `confirm`-lah yang menulis ke registry dan ia bisa dipanggil langsung, jadi memeriksa hanya di `prepare` menyisakan pintu samping yang lebar.
- **Dipakai helper resmi `verifyCloudProof`** dari `@worldcoin/idkit-core/backend`, bukan HTTP rakitan sendiri. Helper itu yang menghitung `signal_hash` dengan `hashToField` — cara hashing yang sama seperti sisi klien. Merakit body sendiri berarti menebak detail itu, dan salah hash membuat **setiap proof yang sah ditolak**. Helper itu juga menerima override endpoint, yang dipakai harness.
- **`signal` = alamat wallet.** Mengikat proof ke pemohon, sehingga proof sah tidak bisa dipotong dari lalu lintas lalu dipakai wallet lain.
- **Nullifier diikat ke satu wallet**, bukan satu-launch-selamanya. Pengikatan itulah yang menutup celah utama — memanen wallet baru tanpa batas. Mode ketat tersedia: `WORLD_ID_ONE_LAUNCH_PER_HUMAN=true`. Ditolak sebagai bawaan karena akan memblokir pengujian dan peluncuran $ADEXTO milik proyek sendiri.
- **`recordLaunch` dipanggil SETELAH registry tercatat**, bukan saat verifikasi. Kalau dicatat lebih awal, tx yang revert atau RPC yang putus akan menghanguskan hak launch seseorang tanpa dia mendapat apa pun.
- **Fail-closed:** tanpa `WORLD_ID_TOKEN_SECRET` (minimal 16 karakter) tidak ada token yang diterbitkan maupun diterima. Tanpa rahasia, token bisa dipalsukan siapa saja dan seluruh gerbang jadi hiasan. Jatuh ke `ADEXTO_TELEMETRY_SECRET` bila tidak diisi.
- **Nullifier tidak dikembalikan utuh ke klien** — itu pengenal stabil per manusia, menyiarkannya mempermudah korelasi antar layanan. Hanya prefiks yang dikirim.

**Hasil uji** (`node audit_worldid_gate.mjs`, stub verifier lokal di port 3199):

| Mode | Hasil | Yang dibuktikan |
|---|---|---|
| Gerbang aktif | **22 / 0** | Launch tanpa token ditolak · proof palsu tidak menghasilkan token · proof sah meloloskan prepare · token wallet lain ditolak · nullifier yang sama di wallet lain ditolak (409) · HMAC dirusak / bentuk salah / kedaluwarsa ditolak · tombol launch di UI terkunci walau attestation sudah ada |
| Gerbang mati | **7 / 0** | Server melaporkan `wallet-signature-only` · `appId` tidak dibocorkan · launch tidak menuntut token · studio menandai **NOT CONFIGURED** dan tidak menawarkan tombol yang mustahil |

Stub-nya juga menolak permintaan yang tidak menyertakan `action` dan `signal_hash`, jadi kedua field itu terbukti benar-benar dikirim server.

**Yang masih perlu Anda lakukan:** buat app di [Worldcoin Developer Portal](https://developer.worldcoin.org), buat **Incognito Action**, lalu isi `NEXT_PUBLIC_WORLD_ID_APP_ID`, `NEXT_PUBLIC_WORLD_ID_ACTION`, dan `WORLD_ID_TOKEN_SECRET` di `.env.local` VPS, lalu **rebuild** (nilai `NEXT_PUBLIC_*` ter-inline saat build). Selama kosong, gerbang tetap mati dan studio menyatakannya apa adanya. Nama action harus **sama persis** dengan di portal: `nullifier_hash` bersifat per-action, jadi salah nama berarti keunikan dihitung terhadap ruang yang berbeda.

**Jebakan yang sempat menipu saat menguji:** asersi "tombol launch terkunci" mula-mula lolos karena alasan yang salah — dengan konfigurasi produksi tidak ada chain berfactory, jadi tombolnya **tidak dirender sama sekali** dan pemeriksaan `isDisabled()` dilewati. Harness kini mewajibkan tombolnya ada lebih dulu, dan servernya dijalankan dengan override chain testnet.

## 1f. Rencana peluncuran $ADEXTO di mainnet

Token milik proyek sendiri, dipakai sekaligus sebagai demo mainnet.

| Butir | Nilai |
|---|---|
| Ticker | `$ADEXTO` |
| Chain | keempatnya: 0G, Base, Arbitrum, Monad |
| Subdomain | `token.adexto.xyz` / `app.adexto.xyz` |
| Supply ke kurva | 100% (tidak ada alokasi untuk deployer) |
| Setoran likuiditas | **nol** — kurva virtual |

**Biaya sebenarnya, gas saja** (harga gas saat pengukuran, gas unit dari hasil uji):

| Chain | Launch | Beli + jual |
|---|---|---|
| 0G | ~$0,02 | ~$0,003 |
| Base | ~$0,09 | ~$0,01 |
| Monad | ~$0,03 | ~$0,003 |
| Arbitrum | ~$0,34 | ~$0,04 |
| **Total 4 chain** | **~$0,48** | ~$0,06 |

Catatan penting untuk materi promosi: dengan v3, klaim "deploy ~$0,6" akhirnya **bisa dipertahankan** sebagai total gas keempat chain. Yang tetap **tidak** benar adalah "bayar sekali di 0G untuk 4 chain" — itu empat transaksi terpisah dengan aset native masing-masing chain, karena tidak ada lapisan pesan lintas chain di 0G dan Monad (§1c).

Untuk video demo mainnet dengan uang asli: beli kecil lalu jual kembali kehilangan **~0,6%** (fee dua sisi), tidak bergantung besar order — terukur, lihat §4d. Jadi demo bisa dilakukan dengan beberapa dolar.

**Prasyarat sebelum $ADEXTO dibuat:** urutan di §1g harus selesai lebih dulu, terutama v3 lulus di 4 testnet lewat UI. Jangan meluncurkan ticker `$ADEXTO` di mainnet sebagai percobaan — `symbolRegistry` di factory bersifat permanen per chain, jadi nama itu tidak bisa dipakai ulang kalau salah.

## 1g. Urutan pekerjaan berikutnya

1. ~~**Deploy curve factory ke 4 testnet.**~~ **SELESAI** — lihat §1e-2.
2. ~~**Perbaiki perekam video dan tiga harness UI.**~~ **SELESAI** — keempatnya kini menguji alur kurva.
3. ~~**Jalankan harness di 4 testnet.**~~ **SELESAI** — 0G 54/0, multi-chain 62/0, devchain 75/0 + 23/0.
4. ~~**Rekam video testnet.**~~ **SELESAI** — lihat §1e-3.
5. ~~**Deploy UI kurva terbaru ke VPS.**~~ **SELESAI** — produksi sinkron, lihat §2b.
6. **Broadcast curve factory ke mainnet** — menunggu instruksi eksplisit pemilik proyek, lalu set `NEXT_PUBLIC_CURVE_FACTORY_*` di `.env.local` VPS dan **rebuild** (nilai `NEXT_PUBLIC_*` ikut ter-inline ke bundel).
7. **Luncurkan $ADEXTO** dan rekam demo mainnet.

## 4b. Jebakan saat menguji (sudah pernah menyesatkan)

- **Jangan jalankan `next dev` sementara `next start` menyajikan build yang sama.** Keduanya memakai `.next` yang sama, sehingga dev menimpa artefak produksi dan server yang sedang jalan mulai menyajikan bundel campur. Gejalanya menipu: wallet mock gagal tersambung, tombol launch tidak pernah muncul, dan **error hidrasi React #418** yang tampak seperti bug aplikasi. Terbukti bukan: setelah `rm -rf .next` + build ulang, E2E kembali 66/0 dengan nol page error dan 8 rute bersih dari masalah hidrasi. Kalau perlu mode dev bersamaan, pakai direktori terpisah (`distDir`) atau hentikan server produksi lebih dulu.
- **Ulangi hanya pembacaan, jangan pengiriman.** RPC testnet publik kadang timeout di tengah alur (pernah mematikan satu run di langkah jual Monad). Harness kini memberi tenggat 60 detik dan mengulang 4x **khusus pembacaan** saldo/reserve; pengiriman transaksi tidak pernah diulang supaya tidak terjadi dobel launch atau dobel beli.
- **Suite dengan premis berbeda tidak boleh dijalankan pada server yang sama.** `audit_studio_testnet_flow.mjs` menguji alur satu chain; kalau dijalankan pada server yang keempat slotnya diarahkan ke testnet, ia bisa meluncur ke lebih dari satu chain dan headline-nya jadi `1 of 4`. Skrip kini mematikan chain lain secara eksplisit dan memverifikasi label tombol sebelum mengirim.
- **`source scripts/testnet-multichain-env.sh` mengosongkan `OG_PRIVATE_KEY`/`PRIVATE_KEY`** untuk proses server (agar upload 0G DA tersimulasi, nol biaya). Nilai itu menempel di shell. Sebelum menjalankan skrip audit di shell yang sama, jalankan `unset OG_PRIVATE_KEY PRIVATE_KEY` supaya audit membacanya kembali dari `.env.local`.
- **`NEXT_PUBLIC_CURVE_FACTORY_*` harus diteruskan sebagai BUILD ARG, bukan cuma env runtime.** `contracts.ts` membacanya, tapi `Dockerfile` dan `docker-compose.yml` sempat hanya meneruskan `NEXT_PUBLIC_FACTORY_V2_*`. Nilai `NEXT_PUBLIC_*` ter-inline saat `next build`, dan build terjadi DI DALAM image — jadi bundle klien meng-inline `null` untuk setiap curve factory walau env di host sudah benar. Keduanya sudah diperbaiki; kalau menambah `NEXT_PUBLIC_*` baru, tambahkan di TIGA tempat: `.env.example`, `Dockerfile` (ARG + ENV), dan `docker-compose.yml` (`args:`).

- **Cache di `globalThis` bertahan melewati perubahan bentuknya.** `??=` tidak menggantinya karena nilainya bukan nullish, jadi cache bentuk lama yang tertinggal membuat tiap request balas HTTP 500 `cache.get is not a function`. Ini bukan cuma soal hot-reload dev: deploy yang mengubah bentuk cache sementara proses tetap jalan akan mengulang persis ini. Validasi BENTUKNYA (`instanceof Map`), bukan cuma nullish-nya. Lihat `src/lib/subgraph.ts`.

- **Jangan cache kegagalan indexer.** Versi pertama `src/lib/subgraph.ts` menyimpan hasil fetch tanpa memeriksa berhasil atau tidak, sehingga blip 200ms berubah jadi 10 detik penuh "tidak ada data" walau indexer sudah pulih, tanpa keterangan apa pun. Cache sekarang per-chain dan hanya menyimpan yang `reachable`.

- **`page.reload({waitUntil:"networkidle"})` tidak bisa diandalkan di harness Playwright.** Halaman token mengirim 45 request dalam 20 detik dengan celah idle terpanjang 9,9 DETIK — jadi jaringannya jelas pernah senggang — tapi `networkidle` tetap timeout 30s. Playwright sendiri sudah tidak menganjurkannya. Pakai `domcontentloaded` + `waitForSelector` pada elemen yang memang dibutuhkan langkahnya: lebih deterministik DAN lebih ketat, karena gagal kalau UI-nya tidak muncul alih-alih kalau jaringannya ramai.

- **Verifikasi lewat field yang benar.** `/api/deploy` mengembalikan `factoryV2`, bukan `factoryV2Address`. Skrip pemeriksa yang salah nama field akan melaporkan "belum ada factory" pada konfigurasi yang sebetulnya benar. Penanda yang bisa dipercaya adalah `dexLive`.
- **Variabel env menempel antar perintah, dan `NEXT_PUBLIC_*` ikut ter-inline saat build.** Kalau shell pernah memuat `scripts/devchain-env.sh`, lalu dipakai membangun lingkungan testnet, `NEXT_PUBLIC_DEVCHAIN_RPC` masih ada sehingga chain 31337 tetap aktif: tombol berbunyi `Launch on 0G + Devchain`, asersi "1 of 1" gagal, dan token uji ikut ter-deploy ke chain lokal. Kedua skrip env kini **saling meng-`unset`** (`testnet-multichain-env.sh` membuang variabel devchain, `devchain-env.sh` membuang `NEXT_PUBLIC_CHAIN_OVERRIDES`). Jangan berasumsi shell-nya bersih — nyatakan.
- **`ADEXTO_DATA_DIR` dari `.env.local` mengalahkan default uji.** Skrip env di-source **setelah** `. ./.env.local`, jadi bentuk `${ADEXTO_DATA_DIR:-/tmp/...}` tidak pernah berlaku dan registry uji menulis ke jalur produksi `/app/data`. Kedua skrip sekarang menyetelnya tanpa syarat; untuk mengarahkan ke tempat lain pakai `ADEXTO_TEST_DATA_DIR` atau `ADEXTO_DEVCHAIN_DATA_DIR`.
- **Curve factory memakai `curveOf(address)`, bukan `poolOf(address)`.** Memanggil `poolOf` pada curve factory menghasilkan `execution reverted (no data present)` yang mudah disalahartikan sebagai gangguan RPC.
- **Jangan pakai alamat `0x5FbDB2315678afecb367f032d93F642f64180aa3` sebagai bukti kebocoran env.** Alamat deploy pertama Hardhat itu juga tertanam di definisi chain `otimDevnet` milik **viem**, jadi selalu muncul di bundel klien apa pun konfigurasinya. Cara memeriksa yang benar: baca `/proc/<pid>/environ` dari proses server, atau cek HTML rutenya.
- **`npx next lint` pernah menggantung lebih dari 15 menit** tanpa keluaran. Gerbang yang bisa diandalkan: `npx tsc --noEmit`, lalu `npx next build`.
- **Perekaman video harus diverifikasi per frame.** Exit code nol tidak membuktikan apa pun soal tampilan: dua rekaman sempat "berhasil" padahal frame-nya masih memperlihatkan copy generasi berseed dan satu paragraf yang tersusun menyamping. Ekstrak frame dengan `ffmpeg -ss <detik> -frames:v 1` lalu benar-benar lihat gambarnya. Perbesar dengan `crop`+`scale` sebelum menyimpulkan sebuah angka salah — "9 of 13" pernah saya baca sebagai "0 of 13" dan hampir "diperbaiki" padahal benar.

## 4c. Merekam video demo UI (testnet)

`node record_demo_testnet.mjs` merekam alur penuh **dengan transaksi sungguhan** di 0G Testnet: studio (buat token, tanpa setoran likuiditas) → explorer → terminal (chart + curve depth ladder) → beli dari terminal → beli dari `/swap` → jual → **klaim penghasilan creator** → beberapa fill tambahan → chart penutup. Hasil: `public/adexto_testnet_demo.mp4` (H.264, 1920x1080, 30 fps, ~360 detik) dan `.webm`.

Server harus disiapkan lebih dulu, dan **build** harus memakai env testnet karena `NEXT_PUBLIC_*` ter-inline saat build:

```bash
set -a && . ./.env.local && set +a && source scripts/testnet-multichain-env.sh && npx next build
# lalu di terminal lain, dengan env yang sama:
set -a && . ./.env.local && set +a && source scripts/testnet-multichain-env.sh && npx next start -p 3100
set -a && . ./.env.local && set +a && node record_demo_testnet.mjs
```

Jalankan dengan server uji yang slot chain-nya diarahkan ke testnet:

```bash
source scripts/testnet-multichain-env.sh && npx next start -p 3100     # terminal 1
unset OG_PRIVATE_KEY PRIVATE_KEY && node record_demo_testnet.mjs        # terminal 2
```

Env opsional: `DEMO_TICKER`, `DEMO_NAME`, `DEMO_SEED` (default 0,05), `DEMO_BUY` (0,01), `DEMO_PACE` (0,62 — kecilkan untuk video lebih cepat).

Dua kesalahan rekaman lama yang tidak boleh terulang:

1. **Wallet tidak tersambung.** `record_crisp.mjs` tidak pernah menyuntik `window.ethereum`, sehingga seluruh UI tertutup gate "Connect wallet" dan tak satu pun aksi bisa jalan — videonya hanya memperlihatkan halaman terkunci. Skrip baru menyuntik shim wallet sebelum navigasi pertama (baca diteruskan ke RPC nyata, tanda tangan dan pengiriman pakai kunci asli), lalu **memverifikasi alamat benar-benar muncul di UI** dan membatalkan rekaman bila tidak — lebih baik gagal daripada menghasilkan video cacat.
2. **Tidak ada overlay.** Tidak ada banner, caption, atau kursor palsu yang digambar di atas UI. Yang terekam adalah antarmuka apa adanya.

Catatan alur: window anti-sniper ditunggu **di latar** sambil adegan explorer dan terminal direkam, supaya video tidak berisi gambar statis. Adegan penutup memakai `scrollIntoView` ke panel trade feed; menggulir dengan jarak tetap pernah kebablasan sampai footer sehingga video ditutup ruang kosong.

Adegan chat agent ada dua: co-pilot 0G di studio (sebelum token dibuat) dan agent token sebagai **finale** (setelah ada fill on-chain, jadi jawabannya memakai angka nyata). Urutan ini penting — dulu chat direkam sebelum adegan penutup yang me-`reload`, sehingga jawaban agent terhapus dan hanya tampil sekejap. Skrip juga menunggu balasan **selesai** (panjang teks berhenti bertambah dan indikator "Reasoning on 0G…" hilang), bukan hanya token pertama, supaya video tidak berakhir di tengah kalimat.

Prasyarat yang mudah terlewat: **`next start` di sini tidak memuat `.env.local` sendiri** (log menunjukkan `injected env (0)`), jadi `/api/chat` akan balas 500. Jalankan dengan env dimuat eksplisit:

```bash
set -a && . ./.env.local && set +a && source scripts/testnet-multichain-env.sh && npx next start -p 3100
```

Skrip juga meninggalkan token demo di testnet yang bisa dipakai lagi (contoh terakhir: `$NOVA525` di 0G Testnet, token `0xc5cD7724AdC5e5055f37be01263Db7bb539ffbAB`, pool `0xD8672f905011497083FF2b36968c7e11af95aFFd`). Untuk demo mainnet nanti, alurnya identik — cukup arahkan ke factory mainnet setelah broadcast, tanpa mengubah skrip.

## 4c-bis. Pass keindahan UI & format harga

`node audit_visual_sweep.mjs` memotret setiap rute pada 1600px dan 390px, lalu melaporkan cacat yang bisa dideteksi mesin: overflow horizontal, teks terpotong, **notasi eksponensial yang lolos ke layar**, sisa bahasa Indonesia (dicocokkan tanpa peduli huruf besar — "MARKET TERPISAH PER CHAIN" pernah lolos dari daftar case-sensitive), dan kontras teks terlalu rendah. Hasil terakhir: **0 temuan** di 9 rute × 2 lebar, termasuk di produksi.

Yang diperbaiki pada pass ini:

- **Harga tidak terbaca.** `toFixed(9)` membuat harga 1,12e-10 tayang sebagai `0.000000000` (informasi hilang total) dan `toExponential()` membuatnya `$9.37e-12` (terbaca seperti pesan galat). Sekarang `formatSmallNumber()` di `src/lib/pricing.ts` memakai notasi subscript ala DEX arus utama: `0.0₉1121`, `$0.0₁₀1637`. Dipakai di header token, panel swap, order book, kartu explorer, chart, dan harga pembukaan di studio.
- **Bahasa Indonesia di UI berbahasa Inggris** — panel penjelasan multi-chain di studio, teks chain terlewat, empty-state `/swap`, dan header matriks chain. Semua sudah Inggris; panel penjelasan dirombak jadi tiga kolom (one market per chain · no bridging · per-chain funding).
- **Terminal token tidak bisa pindah chain.** Panel switcher dulu hanya muncul bila token ada di >1 chain, jadi pada token satu-chain tidak ada cara berpindah dan tidak terlihat bahwa chain lain memang belum punya market. Sekarang panel **selalu** tampil dan menampilkan **keempat** chain: yang ada market bisa diklik (dengan harga dan status pool), yang tidak ada ditandai `NOT LAUNCHED` dan tidak bisa diklik.
- **Tiga CTA "Connect wallet" bertumpuk** di satu layar (navbar + strip wallet + tombol utama). Strip wallet sekarang hanya muncul setelah tersambung — yaitu saat fungsinya memang dibutuhkan untuk berganti wallet tanpa meninggalkan halaman trading.
- **Badge "LIVE ON-CHAIN" pada registry kontrak** padahal `/api/deploy` melaporkan `dexLive: false` di semua chain. Alamat di sana adalah generasi **v1**; factory v2 yang eksekutabel belum di-broadcast. Badge diubah menjadi `<chain> factory · v1` / `<chain> hook · v1`, judul jadi "Deployed contract registry", dan disebutkan eksplisit bahwa launching serta trading tetap terkunci sampai v2 di-broadcast.

## 4c-ter. Sistem warna cream — aturan yang harus dipatuhi saat mengubah UI

Palet hidup di `src/app/globals.css` (token) dan diberi nama di `tailwind.config.ts`.
**Jangan menulis hex di komponen.** Pembalikan tema sebelumnya menyentuh ~1.270
tempat; itu hanya bisa dikerjakan sekali karena warnanya diberi NAMA.

| Token | Nilai | Untuk |
|---|---|---|
| `--cream` / `cream-2` / `cream-3` | `#f4efe4` / `#fbf8f1` / `#efe8da` | permukaan; yang lebih PUTIH lebih menonjol |
| `--ink` / `ink-soft` / `ink-faint` | `#201810` / `#6b5c48` / `#736550` | teks, tiga tingkat |
| `--line` / `line-strong` | `#e7dcc7` / `#d9cbb0` | garis, bukan teks |
| `--accent` / `accent-strong` | `#7c3aed` / `#6d28d9` | **satu-satunya** aksen |
| `--ok` / `--warn` / `--danger` | `#146c34` / `#9a4408` / `#b91c1c` | **hanya keadaan sungguhan** |

**Empat aturan:**

1. **Satu aksen.** Dulu ada enam warna hiasan, akibatnya tidak ada warna tersisa
   untuk menandakan status. `ok`/`warn`/`danger` dipesan untuk keadaan: pool belum
   executable, chain wallet tidak cocok, price impact >5%, showcase entry, lane CCIP
   belum dibuka. **Nama fitur bukan keadaan** — "Cloudflare Workers x402" pernah
   tampil dengan warna peringatan di enam halaman karena pemetaan mekanis
   mengirim setiap oranye ke `warn`.

2. **Warna disimpan sebagai kanal RGB berpasangan dengan hex.** Tailwind v3 hanya
   bisa menerapkan modifier opasitas (`border-line/30`, `bg-ok/10`) bila warnanya
   `rgb(var(--x) / <alpha-value>)`. Kalau variabelnya hex, setiap modifier
   menghasilkan CSS tidak valid dan warnanya hilang **tanpa error**.

3. **Isian pekat butuh `text-white`, bukan `text-ink`.** `bg-accent` + `text-ink`
   adalah sekitar 2:1. Keadaan nonaktif jangan pakai `opacity-40` pada tombol yang
   tulisannya menjelaskan apa yang kurang — pakai `disabled:bg-cream-3
   disabled:text-ink-soft`.

4. **Kontras diukur terhadap `--cream-3`, permukaan tergelap tempat teks berdiri.**
   Bukan terhadap putih. Versi pertama palet ini disetel dengan mata dan hasilnya
   3,6:1–4,4:1 pada token yang justru dipakai untuk tulisan terkecil di seluruh
   situs. `audit_visual_sweep.mjs` menjaganya dan melaporkan warna depan, warna
   latar, serta ukuran huruf. Catatan: pemeriksa lamanya menguji `luminance < 78`
   pada warna teks — benar untuk tema gelap, **salah arah** setelah palet dibalik.

**Ticker stack (`src/components/StackMarquee.tsx`).** Sebuah nama hanya masuk kalau
ADEXTO benar-benar berjalan di atasnya, dan labelnya menyebut pemakaiannya secara
harfiah. Uniswap **tidak boleh masuk** meski diminta: integrasinya nol (§6), jadi
logonya adalah klaim yang bisa dibantah dengan satu pencarian di repo. Chainlink
masuk dengan label apa adanya: `receiver deployed · lanes idle`. Nama chain dibaca
dari `CHAINS`, bukan ditulis ulang, supaya ticker ikut berkata "0G Testnet" bila
`NEXT_PUBLIC_CHAIN_OVERRIDES` aktif.

**Skrip pemetaan tersimpan**, bukan riwayat shell: `scripts/repalette-to-cream.sh`
(pemetaan nilai kelas) dan `scripts/repalette-contrast-fix.sh` (dua cacat yang
tidak bisa ditangkap pemetaan per token: tombol aksen penuh, dan titik status yang
menjadi 10% sehingga tak terlihat). Keduanya idempoten.

**Jebakan build yang sempat menipu:** satu build lokal memanggang
`NEXT_PUBLIC_CHAIN_OVERRIDES` yang **bocor dari shell IDE**, dan ticker jujur
melaporkannya — halaman depan produksi-uji berbunyi "0G Testnet · 16602". Nilai
`NEXT_PUBLIC_*` ter-inline saat build, jadi build rilis lokal harus dijalankan
dengan `env -u NEXT_PUBLIC_CHAIN_OVERRIDES -u NEXT_PUBLIC_DEVCHAIN_RPC`. Periksa
`env | grep NEXT_PUBLIC` sebelum menyimpulkan kode salah. Produksi tidak
terpengaruh: `deploy-vps.sh` membangun di dalam image dengan `.env.local` milik VPS.

**Latar.** `Live3DBackground` (swarm 180 titik three.js) sudah **dihapus**. Di atas
cream ia corat-coret di belakang teks, dan di halaman trading bersaing dengan grafik
lilin — satu-satunya gambar di layar yang membawa data. Penggantinya satu gradasi
cream di `globals.css`. Efek samping: three.js keluar dari bundel bersama, First
Load JS turun 116 kB → 103 kB di setiap rute.

## 4c-quater. Audit klaim UI — apa yang boleh ditulis di permukaan

Satu putaran audit di domain live menemukan bahwa masalah terbesar situs ini bukan
tampilan, melainkan **dua halaman yang menampilkan data karangan** dan satu klaim
inti yang tidak pernah diverifikasi. Semuanya sudah diperbaiki; bagian ini ada
supaya tidak kembali.

**Penjaga:** `node audit_claims.mjs` (butuh `BASE_URL`). Ia mengambil teks yang
benar-benar TERLIHAT di sembilan rute — memakai peramban, karena separuh permukaan
situs dirender setelah hidrasi — lalu:

1. menolak 16 frasa terlarang, masing-masing beserta alasannya;
2. mendeteksi **pasangan pernyataan yang tidak mungkin keduanya benar** dalam satu
   halaman (kelas cacat yang paling mudah lolos);
3. membuktikan `/agent/demo` benar-benar melakukan permintaan jaringan dan
   menampilkan status HTTP yang sesungguhnya.

`node audit_copy_review.mjs` menarik teks tiap rute ke berkas untuk ditinjau
manusia. `node audit_governance_truth.mjs` membaca keempat Governor dari chain.

### Aturan yang tidak boleh dilanggar

- **Jangan pernah menampilkan data yang ditulis tangan sebagai keadaan langsung.**
  `/governance` dulu memuat tiga proposal dengan perolehan suara sebagai array
  konstan di berkas komponen, di bawah judul "ON-CHAIN DAO GOVERNANCE", sementara
  `proposalCount` on-chain **nol di keempat chain**. Tombol "Vote FOR"-nya mengirim
  transaksi sungguhan untuk proposal yang tidak ada. `/agent/demo` dulu nol
  permintaan jaringan: `setTimeout` mencetak log tetap lalu menampilkan objek
  "attestation proof" karangan, di halaman berjudul "Live … in real-time".
- **Kalau pembacaan gagal, katakan gagal.** Halaman governance lama menjatuhkan
  "Your Voting Power" ke `"100,000.00"` saat RPC error.
- **TEE: dibaca, bukan diklaim — dan hardware-nya Intel TDX, bukan AMD SEV-SNP.**
  Ini pernah salah **dua kali, ke arah berlawanan**, dan keduanya perlu dicatat.

  Mula-mula situs menulis "Hardware Attested", "AMD SEV-SNP ACTIVE", dan
  "Attestation Protocol: Remote Quote SEV-SNP" tanpa satu pun pemeriksaan. Saat
  audit menemukannya, saya menghapus klaim TEE seluruhnya — dan itu juga salah.

  Fakta, dari probe langsung ke router (`GET /v1/models`, 29 model):

  | field | nilai untuk model kita |
  |---|---|
  | `verifiability` | `TeeML` |
  | `tee_attested` | `true` |
  | `tee_type` | **`TDX`** (Intel, bukan AMD SEV-SNP) |
  | `tee_verifier` | `dstack` |

  Ketiga model yang dipakai app — `glm-5.2`, `0gm-1.0-35b-a3b`,
  `0gm-1.0-35b-a3b-sia` — semuanya `TeeML`. Bedanya penting dan 0G sendiri yang
  menariknya: **TeeML** = model dan enklave milik 0G, inferensinya ter-attestasi di
  dalam; **TeeTLS** = bobot dijalankan pihak lain dan 0G meng-attestasi
  transportnya, jadi yang terbukti adalah jalur routing, bukan inferensinya.
  Diparafrasekan dari [blog 0G](https://0g.ai/blog/deepseek-v4-pro-live-on-0g-private-computer).

  Router yang sama juga menyajikan model **tanpa** field TEE sama sekali (`claude-*`,
  `gpt-*`), jadi menambah model ke studio tanpa memeriksa field itu akan diam-diam
  menghilangkan properti ini.

  Karena itu `src/lib/og-attestation.ts` MEMBACA deklarasi tersebut, `/api/tee`
  menyajikannya mentah (`curl -s https://adexto.xyz/api/tee`), dan `/docs`
  menampilkannya sebagai tabel yang dirender dari pembacaan itu. Kalau router mati,
  hasilnya `live: false` dan UI berkata "tidak diketahui" — bukan "aman".

  **Batas yang tetap berlaku:** tidak ada quote TDX mentah yang bisa kita ambil.
  Sudah diperiksa — `/v1/attestation`, `/v1/tee/report`, `/v1/quote` dan sejenisnya
  semuanya 404, dan badan respons chat completion nol kemunculan "tee", "attest",
  "quote", "signature". Yang ikut per respons: header `x-provider` berisi alamat
  on-chain penyedia dan `x_0g_trace.request_id`. Jadi boleh menulis "router
  melaporkan attestation TDX via dstack"; **tidak boleh** menulis "kami
  memverifikasi quote-nya". Verifikasi sungguhan butuh verifier dstack.

  Perhatikan juga: parameter `teeAttestationRoot` di calldata factory sebenarnya
  **root penyimpanan 0G DA** — namanya terpaku di kontrak yang sudah ter-deploy.
- **Token tata kelola tidak ada.** "ADAI" hanya muncul sebagai komentar pada dua
  konstanta di `AdextoGovernor.sol`. `governanceToken` menunjuk SovereignHook v1 di
  0G dan Arbitrum, dan alamat nol di Base dan Monad — jadi `castVote` **pasti
  revert** di keempat chain.
- **ERC-8004 tidak dipenuhi.** `AdextoToken` hanya menyimpan satu
  `address immutable agentIdentity`; tidak ada `supportsInterface`, tidak ada
  registry. Cap 1%/5-blok ada di `AdextoToken._update` dan tidak berhubungan dengan
  standar mana pun.
- **World ID: "proof of personhood", bukan "one launch per human".** Produksi
  menjalankan `WORLD_ID_ONE_LAUNCH_PER_HUMAN=false`; yang ditegakkan adalah
  nullifier terikat satu wallet.
- **Jangan menuduh pesaing soal hal yang mereka kerjakan.** "Pump.fun creators
  receive 0%" SALAH — mereka membayar bagian fee trading (§1d, dengan sumber).
  Perbedaan yang nyata: bagian itu dibiayai fee **tambahan** ke trader, sementara
  kita memotong dari total yang sudah ada.
- **Kurvanya produk-konstan (x·y=k), bukan eksponensial.**
- **Satu angka latensi, atau tidak ada.** Halaman depan pernah menyebut "sub-50ms"
  dan "<35ms" sekaligus; keduanya mengutip jaringan Cloudflare, bukan ukuran kita.
- **x402 hari ini = separuh PENEMUAN saja.** Tantangan 402 hidup dan benar.
  Verifikasi voucher membalas **501**; penyelesaian on-chain, dispatch agen, dan
  penyaluran ke vault buyback belum dibangun. Worker-nya dulu membalas 200 dengan
  "AMD SEV-SNP Quote Valid" untuk header berisi `{}`.
- **`edge.adexto.xyz` belum dipasang** (HTTP 525). URL gerbang yang benar:
  `https://adexto-x402-edge.cucuvirtual.workers.dev/v1/x402/<agent>`.
- **Empat tool MCP tidak ada.** `signet_generate_brand`,
  `sentinel_verify_calldata`, `helm_register_cron`, `notary_anchor_receipt` hanya
  muncul di halaman docs. Seksinya berjudul "Specified, not shipped".
- **Subgraph tidak menyajikan apa pun.** Masih mengindeks factory v1; explorer
  membaca registry sisi-server.
- **`0x8a3c…ee7D` adalah dompet deployer**, bukan "enclave key".
- **Jangan menulis "Zero central points of failure".** Satu kontainer, satu VPS,
  satu berkas registry, satu kunci router, satu Worker. Yang memang tanpa titik
  pusat kegagalan adalah kontraknya.
- **Satuan keuangan harus benar.** "$185k/mo ARR" pernah tayang; ARR itu tahunan.

### Kelas cacat yang paling merugikan: halaman yang membantah dirinya sendiri

Ticker landing menandai Base/Arbitrum/Monad "launch + curve" **dua inci di bawah**
catatan hero "launch factory pending broadcast", dan footer memperkuat yang salah
dengan "Live" di keempat chain. Pembaca akan memercayai yang lebih berani, lalu
membuka studio dan menemukan tombolnya terkunci — dan sesudah itu tidak ada angka
lain di situs yang masih dia percaya. `audit_claims.mjs` sekarang memeriksa
pasangan pernyataan semacam ini secara eksplisit.

## 4c-quinquies. Dari klaim yang dicabut menjadi fitur yang berjalan

Audit klaim mencabut delapan hal karena tidak benar. Pertanyaan berikutnya bukan
"bagaimana menulisnya lebih halus" tetapi **bagaimana membuatnya benar**. Bagian
ini menjawab itu satu per satu, dengan kelayakan yang sudah diperiksa — bukan
ditebak — beserta rekomendasi jujur mana yang layak dikerjakan dan mana yang tidak.

Urutan di bawah adalah urutan **leverage**, bukan urutan kesulitan.

---

### 1. `WORLD_ID_ONE_LAUNCH_PER_HUMAN` — env, bukan kode. ~5 menit

**Kodenya sudah lengkap.** `src/lib/worldid.ts` sudah menegakkannya di dua tempat
(`:270` saat verifikasi, `:334` saat prepare) dan mengembalikan
`WORLDID_ALREADY_LAUNCHED`. Yang kurang hanya satu baris env di VPS:

```bash
# di /root/adexto/.env.local pada VPS
WORLD_ID_ONE_LAUNCH_PER_HUMAN=true
# lalu WAJIB rebuild, bukan restart
bash scripts/deploy-vps.sh
```

**Dua hal yang harus disadari sebelum menyalakannya:**

- Penegakannya ada di **store kita**, dikunci per `nullifier` di
  `ADEXTO_DATA_DIR`. Jadi ia per-deployment, bukan global. Lapisan kedua yang
  benar-benar global adalah `max_verifications` pada action di portal World —
  set ke `1` di sana kalau ingin World sendiri yang menolak.
- **Ini akan memblokir peluncuran $ADEXTO milik proyek sendiri** (§1f) kalau
  wallet Anda sudah memakai World ID yang sama untuk uji. Itulah alasan ia tidak
  dijadikan bawaan. Luncurkan $ADEXTO **dulu**, nyalakan flag sesudahnya.

Sesudah menyala, ticker landing boleh kembali berbunyi "one launch per human".
Jangan mengubah teksnya sebelum `curl -s https://adexto.xyz/api/worldid/verify`
melaporkan `"oneLaunchPerHuman":true`.

**PEMUTAKHIRAN:** gerbang World ID sudah AKTIF di produksi. `WORLD_ID_ONE_LAUNCH_PER_HUMAN`
dibiarkan kosong dengan sengaja, jadi `/api/worldid/verify` melaporkan
`oneLaunchPerHuman:false`: satu manusia terikat ke satu wallet tapi boleh
meluncurkan lebih dari sekali. Pengikatan itulah yang menutup celah utama —
memanen wallet baru tanpa batas. Harness: `node audit_worldid_gate.mjs`.

---

### 1e-3. Audit pra-mainnet 2026-08-21 — kontrak diperbaiki lalu di-deploy ulang

**Kenapa deploy ulang wajib, terlepas dari temuan apa pun.** Keempat factory
testnet yang lama menjalankan bytecode PRA-RENAME (18.568 byte, tanpa
`VERSION()`), sementara repo sudah di 18.05 KiB. Jadi klaim "lulus ujung-ke-ujung
di 4 testnet" berlaku untuk bytecode yang BUKAN yang akan dikirim ke mainnet, dan
`AdextoCurveFactory` versi sekarang baru pernah jalan di hardhat. Karena deploy
ulang sudah pasti, memasukkan perbaikan kontrak di bawah tidak menambah biaya.

**Gate-nya: `node audit_preflight_immutable.mjs`** — `exit 1` selama masih ada
temuan TINGGI. Jalankan sebelum broadcast ke chain mana pun. Turun dari 4 TINGGI
ke 1 TINGGI setelah perbaikan ini.

**Yang diubah di kontrak:**

`SovereignCurve.sol`
- `AutoBuybackExecuted` dari 2 jadi 5 field: `+depthFee, +nativeReserveAfter,
  +tokenReserveAfter`. **topic0 BERUBAH.** Tanpa `depthFee`, indexer tidak mungkin
  tahu angka itu padahal `executeBuyback` menaikkan `totalDepthFeesRetained`, dan
  karena `floorPrice = (virtualNative + totalDepthFees) / curveTokens`, lantai
  harga di explorer akan permanen lebih rendah dari kenyataan dan makin melenceng
  tiap buyback.
- `initializeCurve` dapat `onlyFactory`. `bindToken` sudah punya, ini tidak.
  Tidak bisa dieksploitasi pada alur factory sekarang (atomik dalam satu tx), tapi
  tidak bisa ditambahkan lagi setelah broadcast.
- **`executeBuyback` TANPA IZIN**, `modifier onlyAgent` dihapus seluruhnya,
  diganti batas ukuran: `require(nativeAmount * 100 <= virtualNative + _curveNative)`.
- `TreasuryFeeCollected` dibungkus `if (treasuryFee > 0)`. Dulu dipancarkan setiap
  swap walau nilainya nol, ~1.100 gas yang dibayar setiap pedagang.
- `sell()`: `totalVolumeNative += leaving + depthFee` (bruto). Dulu `quotedOut`
  (neto), sehingga beli dihitung bruto dan jual neto — ukuran perdagangan yang
  sama tercatat sebagai dua volume berbeda tergantung arahnya.

`AdextoToken.sol`
- `Ownable` DIBUANG, bersama `disableAntiSnipe()`, `antiSnipeActive`, dan
  `AntiSnipeToggled`. `Ownable(msg.sender)` membuat `owner()` adalah factory pada
  setiap token, dan factory tidak punya fungsi yang memakainya — jadi
  `disableAntiSnipe()` tidak pernah bisa dipanggil siapa pun dan `antiSnipeActive`
  terkunci `true` selamanya. Setiap transfer membayar SLOAD untuk flag yang tidak
  bisa berubah, dan setiap explorer serta pemindai honeypot melaporkan token ini
  punya "Owner" — menyiratkan tuas admin yang sebetulnya tidak ada.
- **JEBAKAN:** `_update` memakai `owner()` sebagai pengecualian anti-sniper.
  Factory memindahkan 100% supply ke kurva dalam satu transfer yang per definisi
  jauh di atas batas 1%, jadi menghapus `Ownable` tanpa mengganti pemeriksaan itu
  akan menggagalkan SETIAP peluncuran. Diganti `address private immutable _launcher`.
- `ANTI_SNIPE_BLOCKS = 5` jadi konstanta publik, `launchBlock` jadi `immutable`.

Konstruktor `AdextoToken` TIDAK berubah tanda tangannya, jadi ketiga factory (v1,
V2, Curve) tetap kompilasi. `VERSION` TETAP `0.9.0` — tidak dibumping, karena
`0.9.0` belum pernah terpakai di chain mana pun.

**Kenapa buyback tanpa izin, dan kenapa plafonnya yang membuatnya aman.**

`onlyAgent` berarti `agentTreasury || factory`. Studio mengirim dompet creator
sebagai `agentIdentity`, dan factory tidak punya fungsi yang memanggil buyback —
jadi satu-satunya pemanggil yang mungkin adalah creator, manual. Di seluruh kurva
testnet, `AutoBuybackExecuted` terhitung NOL KALI. Sementara `treasuryNative`
terakumulasi dari setiap swap dan hanya bisa keluar lewat fungsi itu; tidak ada
withdraw sama sekali. Creator yang menganggur berarti irisan buyback setiap
perdagangan mengendap selamanya.

Membukanya untuk siapa pun tidak cukup sendiri. Pemanggil memilih `nativeAmount`
DAN `minTokensBurned`, jadi versi tanpa batas bisa disandwich: beli besar, picu
buyback dengan `minTokensBurned = 0` supaya ia terisi di harga yang dipompa dan
membakar token lebih sedikit dari yang treasury bayar, lalu jual. Solvensi kurva
tetap utuh; yang hancur adalah daya beli treasury, dan kerugiannya jatuh ke
pemegang token.

Apakah itu menguntungkan bergantung pada besaran, jadi diukur terhadap kurva
testnet sungguhan (depth 15bps, creator 10bps, treasury 5bps, virtualNative 1500).
Di volume rendah `treasuryNative` sekitar 0,03% reserve, jadi buyback menggerakkan
harga ~3bps melawan biaya bolak-balik 60bps — serangannya RUGI. Tapi
`treasuryNative` tumbuh seiring volume kumulatif sementara reserve tidak mengejar,
sehingga begitu volume kumulatif mencapai ~100x reserve, treasury jadi ~5% darinya
dan satu buyback tanpa batas menggerakkan harga ~5%. Serangannya jadi
menguntungkan tepat di pasar yang berhasil.

Karena itu plafonnya 1% reserve per panggilan: menahan plafon untung sandwich di
sekitar biaya 60bps-nya, dan setiap percobaan lanjutan harus menunggu treasury
terisi lagi dari volume nyata. Pembatas sesungguhnya adalah ukuran per panggilan,
bukan identitas pemanggil — jadi begitu ukurannya dibatasi, izin tidak membeli apa
pun dan justru mencabut satu-satunya pemanggil yang bekerja.

**Alamat factory setelah deploy ulang (bytecode identik dengan repo):**

| chain | alamat | startBlock |
|---|---|---|
| 0g-testnet | `0x99CBfE5d33542b3611639C4fDC664d99F541D96D` | 52316951 |
| arbitrum-sepolia | `0x4c337FD1a65fEAaC248b138E47C0C40B84CF3f1f` | 303848988 |
| base-sepolia | `0xe21e5b875B9F6B99a8151166EF079C1F9E1c092e` | 46193936 |
| monad-testnet | `0x213494Bff0962AbFCcD73364de7616f5a5517E47` | 58419649 |

`scripts/testnet-multichain-env.sh` sekarang MEMBACA `build/deployments.json`.
Sebelumnya keempat alamat ditulis tangan di sana dan jadi basi persis saat
kontraknya di-deploy ulang: skrip mengarahkan UI ke factory lama sementara
deployments.json sudah menunjuk yang baru, dan tidak ada yang gagal
terang-terangan — peluncuran cuma memakai kontrak yang salah.

**Harness baru:**

- `node audit_buyback_flow.mjs` (devchain, 29/0) — jalur yang sebelumnya nol kali
  pernah dieksekusi. Membuktikan: alamat ACAK berhasil memicu buyback; plafon 1%
  presisi sampai satu wei (tepat di plafon DITERIMA, +1 wei DITOLAK, seluruh
  treasury DITOLAK); kelima field event cocok persis dengan `getReserves()` dan
  `totalDepthFeesRetained()`; `totalSupply` benar-benar turun dan cocok
  `tokensBurned`; lantai harga naik dan rumus subgraph == rumus kontrak; solvensi
  utuh; pemanggil tidak menerima native apa pun; `totalVolumeNative` kontrak sama
  dengan jumlah bruto dari event.
- `node audit_testnet_buyback.mjs` (0G testnet, 20/0) — ulangi di EVM REMOTE,
  tempat jendela anti-sniper harus DITUNGGU, bukan dilompati `hardhat_mine`.
- `node audit_preflight_immutable.mjs` — gate pra-broadcast.

**JEBAKAN HARNESS yang ditemukan sambil menulisnya:**

- **JANGAN pasang nonce manual di harness ethers.** Justru itu yang MENYEBABKAN
  "Nonce too low": variabelnya dibaca sekali dengan `"latest"` lalu basi begitu
  transaksi berikutnya terkirim. Pakai `ethers.NonceManager` — tapi ingat ia tidak
  mengekspos `.address` secara sinkron, jadi simpan alamatnya dari `Wallet` asli.
- `provider.getBlockNumber()` di-cache ethers, jadi angka yang dicetak setelah
  menambang blok terlihat basi padahal penambangannya berhasil.
- Jendela anti-sniper harus dilewati sebelum membeli. Pembelian pertama di harness
  ini memang DITOLAK, dan itu bukti proteksinya bekerja, bukan bug.
- **Pembagian fee untuk uji plafon harus menyisakan depth > 0.** `depthFeeBps`
  dihitung kontrak sebagai `swapFee - creatorShare - treasuryShare`. Percobaan
  pertama memakai total 500 dengan treasury 500, yang membuat depth = 0 — lantai
  harga jadi tidak pernah naik, dan pemeriksaan "depthFee cocok delta" lolos
  secara HAMPA karena kedua sisinya nol. Pakai treasury 450 supaya depth 50 bps.
- **Uji plafon harus dijalankan SEBELUM buyback**, karena buyback itu sendiri
  menghabiskan treasury sampai di bawah plafon dan yang menolak jadi
  `bad buyback amount`, bukan plafonnya.
- Artifact di repo ini menyimpan `deployedBytecode` sebagai STRING, bukan objek
  bergaya hardhat `{ object }`. Membaca hanya `.object` menghasilkan 0 byte.

**JEBAKAN DETEKTOR: audit yang melaporkan perbaikannya sendiri sebagai temuan.**
Tiga pemeriksaan di `audit_preflight_immutable.mjs` sempat salah dan sudah
dibetulkan. Regex `TreasuryFeeCollected` hanya mencari baris `emit`, sehingga tetap
melapor setelah guard `if (treasuryFee > 0)` dipasang. Pemeriksaan
`agentTreasury == creator` hanya membandingkan dua alamat tanpa memeriksa apakah
gerbangnya masih ada, sehingga tetap melapor TINGGI setelah buyback dibuat tanpa
izin. Dan factory dengan 0 project dilewati DIAM-DIAM, sehingga audit melaporkan
lebih sedikit temuan semata karena factory-nya masih kosong.

**SISA 1 TEMUAN TINGGI, dan ini tidak bisa diperbaiki dengan kode:**

`symbolRegistry` first-come-first-served dan permanen; tidak ada fungsi untuk
mencadangkan atau melepas. `deployTrinity` juga sama sekali tanpa access control,
jadi gerbang World ID itu MURNI frontend dan `RESERVED_SYMBOLS` di
`src/lib/registry.ts` hanya berlaku untuk peluncuran yang lewat `/api/deploy`.
Siapa pun bisa memanggil factory langsung dan mengklaim `ADEXTO`, `AEGIS`, atau
`USDC` on-chain, permanen. Peluncuran hanya berbiaya gas, jadi menyerobot ticker
itu murah.

Menambahkan `reserveSymbol` berarti factory punya fungsi admin, dan itu
bertentangan dengan properti "no rug lever" yang dipilih proyek. Jalan yang tidak
melanggarnya bersifat OPERASIONAL: **klaim `ADEXTO`, `AEGIS`, `QNOVA`, `CSENT`,
`MQUANT` di keempat mainnet SEGERA setelah broadcast**, biayanya cuma gas per
peluncuran. Masukkan ini ke daftar langkah broadcast mainnet, bukan ke daftar
perbaikan kode.

### 2. Subgraph — SELESAI, dengan dua chain di infrastruktur sendiri

Dikerjakan 2026-08-21. Yang berlaku sekarang:

**Kelayakan diperiksa ulang terhadap `graphprotocol/networks-registry` v0.7.111, dan
hasilnya berbeda dari catatan sebelumnya di dokumen ini.** Catatan lama menyebut
Base/Arbitrum/Monad didukung The Graph. Monad TIDAK: ia terdaftar tanpa dukungan
Subgraphs (hanya Firehose + Substreams), mainnet maupun testnet. 0G tidak ada di
registry sama sekali.

| chain | Subgraphs di The Graph | tujuan deploy |
|---|---|---|
| `base`, `base-sepolia` | ya | Subgraph Studio |
| `arbitrum-one`, `arbitrum-sepolia` | ya | Subgraph Studio |
| `monad`, `monad-testnet` | **tidak** | Graph Node sendiri |
| `0g`, `0g-testnet` | **tidak ada di registry** | Graph Node sendiri |

Jadi Graph Node sendiri bukan masalah khusus 0G dan bukan masalah khusus testnet.

**Berkas.** `subgraph/chains.json` satu-satunya yang ditulis tangan. `networks.json`
dan `graph-node.toml` DIHASILKAN oleh `python3 scripts/gen-subgraph-networks.py`
(alias `npm run networks`) dari `chains.json` + `build/deployments.json`. Entri
mainnet sudah lengkap dan tinggal menunggu alamat — broadcast factory lalu jalankan
generator, nama mainnet muncul sendiri tanpa satu baris kode pun berubah.

**Perintah.** Tidak ada lagi skrip per-chain. Satu pintu:

```
cd subgraph
npm run list                    # chain, alamat, dan tujuan deploy masing-masing
npm run networks                # regenerasi setelah broadcast factory
node graph-ops.mjs build <net>
node graph-ops.mjs deploy <net> # Studio atau node sendiri, diputuskan chains.json
npm run deploy:studio           # semua yang bertarget Studio
npm run deploy:self-hosted      # semua yang bertarget node sendiri
```

**JEBAKAN: `graph build --network X` MENULIS ULANG `subgraph.yaml` DI TEMPAT.**
graph-cli menyalin `address` dan `startBlock` dari `networks.json` ke manifest
sumber yang ter-track, bukan hanya ke `build/`, DAN menghapus seluruh komentarnya
saat menulis ulang. Dibiarkan begitu, manifest terpaku ke chain yang terakhir
di-build dan `git status` kotor setelah tiap build. Karena itu ada
`subgraph/reset-manifest.mjs`, dan tiap perintah graph-cli di `graph-ops.mjs`
selalu memanggilnya lewat `finally`. Sumber kebenarannya `networks.json`.

**ATURAN MENGIKAT: nol `.bind()` dan nol `try_*` di seluruh mapping.** RPC 0G
berjalan pruned, bukan archive (`eth_getBalance` blok lama gagal `missing trie
node`), dan tidak menyediakan `trace_block` maupun `debug_traceBlockByNumber`
(keduanya `-32601`). Seluruh keadaan kurva diturunkan dari payload event: `Swap`
memancarkan `nativeReserveAfter` dan `tokenReserveAfter`. Begitu satu panggilan
view masuk, kebutuhannya berubah dari satu kontainer menjadi node archive.

**Batas RPC, diprobe langsung bukan ditebak (2026-08-18):**

| chain | client | `eth_getLogs` |
|---|---|---|
| 0G mainnet + testnet | Geth v1.15.11 | span 10.000 blok lolos, dipakai 2.000 |
| Monad mainnet + testnet | Monad 0.15.1 / 0.16.0 | **plafon keras 100 blok**, di atas itu HTTP 413 `-32614 "eth_getLogs is limited to a 100 range"` |

Beda dua orde inilah alasan `graph-node.toml` memakai `max_block_range_size`
per-chain. `GRAPH_ETHEREUM_MAX_BLOCK_RANGE_SIZE` itu env var GLOBAL: disetel 100
untuk Monad, backfill 0G jadi 20x lebih banyak request; dibiarkan default, tiap
request Monad gagal.

**Graph Node.** `subgraph/docker-compose.yml`, image `graphprotocol/graph-node:v0.45.0`
(spec max 1.5.0, api max 0.0.10 — manifest kita 1.0.0/0.0.9, aman). Semua port
di-bind ke `127.0.0.1`: port 8020 dan 5001 TIDAK berautentikasi, siapa pun yang
menjangkaunya bisa deploy subgraph atau pin data sembarang. App menjangkau node
lewat nama service `graph-node` di jaringan docker `adexto-net` yang dibagi
bersama, jadi indexer tidak perlu port host sama sekali.

**JEBAKAN: `BLOCK_INGESTOR` harus sama dengan `node_id`.** `docker/start` di image
itu menyetel `DISABLE_BLOCK_INGESTOR=true` setiap kali `node_id != BLOCK_INGESTOR`.
Kalau lupa, node naik bersih, menjawab query, log-nya tidak mencurigakan, dan
tidak pernah mengingest satu blok pun — subgraph diam di 0% selamanya.

**JEBAKAN: image graph-node TIDAK punya `wget` maupun `curl`.** Healthcheck versi
pertama memakai `wget` ke 8030 dan karena itu melaporkan node `unhealthy`
selamanya, padahal ia sedang mengingest dua chain dan menjawab query — persis
jenis "salah diam-diam" yang berbahaya di VPS bila ada orkestrasi yang me-restart
kontainer unhealthy. Yang tersedia di image: `bash` (dengan `/dev/tcp` berfungsi),
`nc`, dan `graphman`. Healthcheck sekarang membuka soket ke 8030 lewat
`bash -c 'exec 3<>/dev/tcp/127.0.0.1/8030'`.

Stack ini SENGAJA tidak ikut `docker-compose.yml` utama dan tidak dijalankan
`scripts/deploy-vps.sh`. Indexer memegang puluhan GB state chain; mengikatnya ke
deploy web berarti membangunnya ulang tiap kali copy diubah.

**Terbukti bekerja 2026-08-31 di mesin lokal.** Stack dinyalakan, kedua chain
self-hosted (0g-testnet, monad-testnet) ingest dan sync ke chain head dengan
`hasIndexingErrors: false`, dan Monad menghormati cap `eth_getLogs` 100-blok tanpa
HTTP 413. Data 0G dibandingkan field-demi-field dengan fungsi view kontrak untuk
3 kurva: **27 COCOK / 0 BEDA**, termasuk `floorPriceNative` yang terangkat oleh
`depthFee` buyback — pembuktian bahwa perbaikan 5-field `AutoBuybackExecuted`
benar. Untuk mengulang: `docker network create adexto-net` (kalau web compose
belum jalan), `cp .env.example .env`, `docker compose up -d`, lalu
`node graph-ops.mjs deploy 0g-testnet`.

**Jalur baca kedua sudah terpasang.** `/api/graphql` membaca registry lebih dulu
dan registry sendirian menentukan pasar mana yang ada. Subgraph hanya menempelkan
objek `live` per project; ia tidak bisa menambah, menghapus, mengganti nama, atau
mengalihkan pasar. Satu-satunya pengecualian: `priceNative` yang bernilai 0 di
registry diisi dari `spotPriceNative` indexer, dan `priceSource` menyatakan mana
yang dipakai. Env: `SUBGRAPH_URL_0G` / `_ARBITRUM` / `_BASE` / `_MONAD` /
`_DEVCHAIN`, tanpa prefiks `NEXT_PUBLIC_` karena URL gateway memuat API key.
Semuanya boleh kosong — `live` jadi null dan explorer jalan seperti biasa.

Harness: `node audit_subgraph_readpath.mjs` (18/0 saat indexer sehat, 14/0 di
masing-masing tiga mode gagal: HTTP 500, error GraphQL, dan menggantung).

**Signal GRT.** NFT subgraph `DdSBjB19RrovZJbpcbXwgTRtDUTRppTWwMsVznjARjQv` di
Arbitrum One masih hidup (`disabled: false`) dan bisa menerima versi baru. Versi
yang dipublish sekarang mendeklarasikan `network: mainnet` (Ethereum) untuk alamat
`0xe8E9Cf43…` yang punya 0 byte bytecode di Ethereum dan 7.216 byte di 0G — ia
memindai chain yang salah sejak blok 1 dan sudah mengindeks nol baris. Signal
21,39438708 GRT ditarik 2026-08-21 lewat `burnSignal` di L2GNS
`0xec9A7fb6CbC2E41926127929c2dcE6e9c5D33Bec`; pokoknya keluar utuh karena kurva
kurasi di Arbitrum rata 1:1 dan pajak 1% dipungut saat SETOR, bukan saat tarik.
Untuk memakainya lagi: publish versi baru ke NFT yang sama (owner tax 0% sejak
GIP-0059), jangan `deprecateSubgraph` — fungsi itu memanggil `_burnNFT` dan ID-nya
hilang permanen.

**Testnet tidak bisa dipublish ke decentralized network.** Deploy `base-sepolia` /
`arbitrum-sepolia` berhenti di Studio. Supaya signal GRT terpakai, subgraph harus
mengindeks chain mainnet yang The Graph layani, yaitu `base` atau `arbitrum-one`.

### 3. ERC-8004 — paling banyak leverage, dan paling selaras. ~3–5 hari

Ini yang paling menarik: standarnya **sudah masuk `ethereum/ERCs` master**
(status *Draft*, dibuat 2025-08-13), dan bentuknya bukan "field alamat" seperti
yang kita klaim — melainkan tiga registry per-chain singleton:

| registry | isinya | pas dengan apa yang SUDAH kita punya |
|---|---|---|
| **Identity** | ERC-721 + URIStorage; `agentId` = `tokenId`; `agentURI` menunjuk berkas registrasi | metadata launch sudah kita unggah ke 0G DA |
| **Reputation** | sinyal umpan balik ber-`agentId`; spec menyebut **bukti pembayaran x402** bisa memperkayanya | gerbang x402 kita sudah ada |
| **Validation** | hook untuk validator independen, **eksplisit menyebut TEE oracle** | router 0G melaporkan attestation TDX (§4c-quater) |

Identitas agen global berbentuk `eip155:{chainId}:{identityRegistry}` +
`agentId`. Berkas registrasinya punya struktur wajib dengan array `services[]`
yang menampung endpoint `web`, `A2A`, dan `MCP`.
*Diringkas dari <https://github.com/ethereum/ERCs/blob/master/ERCS/erc-8004.md>;
isi sumber diparafrasekan untuk mematuhi ketentuan lisensi.*

Kenapa ini leverage terbesar: **satu pekerjaan ini menyalakan empat klaim
sekaligus** — ERC-8004 jadi benar, endpoint x402 dapat tujuan yang sesuai
standar, attestation TDX dapat tempat untuk dicatat, dan berkas registrasi
memberi alasan nyata bagi unggahan 0G DA yang saat ini hanya menghasilkan hash.

Langkahnya:

1. `contracts/AdextoIdentityRegistry.sol` — ERC-721 + URIStorage. Deploy sebagai
   singleton per chain. Catat: kita **memenuhi antarmukanya**, bukan memakai
   registry kanonik bersama, dan itu harus dinyatakan apa adanya di /docs.
2. `AdextoCurveFactory` tidak bisa diubah. Jadi pendaftarannya dilakukan
   **setelah** launch, dari `/api/deploy` tahap `confirm`, memakai alamat agen
   yang sudah terkunci di token.
3. Berkas registrasi disajikan di `https://{ticker}.adexto.xyz/agent.json` —
   middleware subdomain sudah ada. `services[]` memuat endpoint x402 yang nyata.
4. Validation Registry: catat apa yang **benar-benar** kita punya, yaitu
   deklarasi attestation router 0G (`/api/tee`) — bukan quote TDX mentah. Kalau
   suatu hari quote bisa diambil, di situlah tempatnya.

**Peringatan:** statusnya *Draft*. Menulis "ERC-8004 compliant" untuk standar yang
masih berubah berisiko basi. Yang aman: "mendaftarkan agen ke Identity Registry
ERC-8004 (draft)" beserta tautan ke ERC-nya.

---

### 4. Kunci yang benar-benar di dalam enclave. ~1 minggu, dan ada prasyarat

`0x8a3c…ee7D` adalah EOA deployer. Untuk membuat frasa "kunci agen tidak pernah
meninggalkan hardware" benar, kuncinya harus **dibuat di dalam** enclave dan tidak
pernah diekspor:

1. Jalankan agen sebagai aplikasi dstack/0G Tapp, bukan sebagai proses di VPS.
2. Bangkitkan keypair **di dalam** CVM; ekspor hanya alamat publiknya.
3. Alamat itulah yang dipakai sebagai `agentIdentity` saat launch.
4. Ambil quote attestation dari runtime, verifikasi dengan verifier dstack,
   simpan hasilnya — dan barulah kalimat "kami memverifikasi" boleh ditulis.

**Prasyarat yang menentukan:** ini butuh CVM yang kita kendalikan. Kalau agen
hanya memanggil `router-api.0g.ai`, kunci apa pun tetap ada di sisi kita.
Jadi item ini sesungguhnya "pindahkan runner agen ke TEE", bukan "perbaiki teks".
Lihat `scripts/agent-autonomous-runner.ts` sebagai titik awal.

---

### 5. "Zero central points of failure" — sebagian bisa, seluruhnya tidak. ~2–3 hari

Yang bisa dihapus sebagai titik pusat kegagalan:

| titik pusat sekarang | pengganti | catatan |
|---|---|---|
| registry `projects.json` di satu volume | 0G Storage + subgraph sebagai pembaca | butuh item 2 |
| satu kontainer di satu VPS | dua region di belakang DNS gagal-alih | biaya naik |
| satu kunci router 0G | beberapa penyedia, atau bayar per panggilan on-chain | 0G punya `provider_count` per model |
| satu Cloudflare Worker | Worker sudah multi-region secara bawaan | sebenarnya bukan titik pusat |

Yang **tidak** bisa dihilangkan: domain, sertifikat, dan build pipeline. Karena itu
klaim yang jujur setelah semua ini pun bukan "zero", melainkan sesuatu seperti
"tidak ada satu pun titik yang bisa membekukan perdagangan" — dan itu memang sudah
benar hari ini, karena kurvanya tanpa fungsi penarikan dan tanpa pemilik.
Rekomendasi: **jangan kejar frasa "zero"**. Kejar "kalau situs kami mati, pasar
Anda tetap bisa ditransaksikan langsung ke kontrak" — lalu buktikan dengan
menerbitkan cuplikan cara swap lewat `cast`/ethers tanpa UI.

---

### 6. Empat tool MCP. ~1 minggu untuk SATU, bukan empat

Rekomendasi jelas: **jangan bangun empat.** Bangun satu yang benar-benar dipakai
produk ini, lalu daftarkan sebagai `services[].MCP` di berkas registrasi ERC-8004
(item 3) — sehingga ia punya tempat, bukan sekadar ada.

Kandidat terkuat: **Sentinel** (memeriksa calldata sebelum agen menandatangani).
Alasannya, itu satu-satunya dari empat yang melindungi hal bernilai, dan agen kita
memang akan menandatangani transaksi buyback. Signet (generator logo) sudah
tergantikan `/api/generate-logo`; Helm (cron) tidak butuh MCP; Notary hanya berarti
setelah item 4 selesai.

---

### 7. "1-Click" — saran saya: jangan dikejar

Empat langkah itu ada karena alasan yang bagus: sambung dompet, tanda tangan
attestation, proof World ID, lalu satu transaksi per chain. Menghapus salah
satunya berarti melemahkan gerbang yang justru baru kita bangun.

Yang **bisa** dipangkas tanpa kehilangan apa pun: tanda tangan attestation
terpisah sebenarnya redundan — pengirim transaksi launch sudah membuktikan
penguasaan alamat. Menghapusnya membuatnya **tiga** langkah dan menghilangkan satu
dialog wallet. Itu perbaikan nyata.

Yang **tidak bisa**: satu transaksi untuk empat chain. Tidak ada lapisan pesan di
0G maupun Monad (§1c), dan EIP-5792 `wallet_sendCalls` hanya membundel dalam satu
chain. Satu-satunya jalan adalah relayer bertreasuri (§1c), dan itu keputusan
pendanaan, bukan keputusan teknis.

Rekomendasi copy: berhenti menghitung klik. "Satu transaksi per chain, gas saja"
lebih kuat **dan** benar.

---

### Urutan yang saya sarankan

1. **Item 1** (env World ID) — 5 menit, tapi luncurkan $ADEXTO lebih dulu.
2. **Item 3** (ERC-8004) — leverage tertinggi; menyalakan empat klaim sekaligus.
3. **Item 2** (subgraph) — dibutuhkan item 5, dan memperbaiki explorer.
4. **Item 6** (satu MCP) — hanya sesudah item 3 memberinya tempat.
5. **Item 4** (kunci di enclave) — pekerjaan infrastruktur, bukan copy.
6. **Item 5 dan 7** — jangan dikejar sebagai frasa; kejar propertinya.

## 4d. Ekonomi beli-jual dengan uang asli

Diukur dengan **transaksi sungguhan** di pool nyata (`audit_roundtrip_econ.mjs`), bukan perkiraan:

| Ukuran beli | Porsi pool | Kembali setelah langsung dijual |
|---|---|---|
| 0,001 native | 1,5% reserve | **99,404%** (rugi 0,596%) |
| 0,010 native | 15% reserve | **99,427%** (rugi 0,573%) |

Teori fee dua sisi `(1 − 0,003)² = 99,4009%`. Cocok.

Yang penting dipahami: **rugi pulang-balik tidak bergantung ukuran order.** Slippage yang tampak besar di layar (misal −13% untuk beli 15% pool) hampir seluruhnya **kembali** saat dijual, karena kurva bergerak naik lalu turun lagi. Yang benar-benar hilang hanya fee 0,3% per sisi ditambah gas. Slippage baru jadi kerugian nyata kalau tokennya **ditahan** dan pool tidak pernah lebih dalam.

Catatan: versi pertama skrip ini pernah melaporkan rugi 23% untuk beli 0,01. Itu salah — ia mengutip `getSellQuote` pada state pool **sebelum** pembelian, sehingga slippage terhitung dua kali. Jangan memakai dua kuotasi berurutan pada state yang sama untuk menghitung pulang-balik.

Biaya gas mainnet (harga gas saat pengukuran, gas unit dari hasil uji):

| Chain | Gas | beli+approve+jual | launch token+pool |
|---|---|---|---|
| 0G Mainnet | 4 gwei | 0,001184 0G (~$0,003) | 0,011278 0G (~$0,02) |
| Arbitrum One | 0,04 gwei | 0,0000118 ETH (~$0,04) | 0,000113 ETH (~$0,34) |
| Base Mainnet | 0,011 gwei | 0,0000033 ETH (~$0,01) | 0,000031 ETH (~$0,09) |
| Monad Mainnet | 202 gwei | 0,059792 MON (~$0,003) | 0,569529 MON (~$0,03) |

Kesimpulan operasional: **gas dan fee bukan penghalang** untuk uji beli-jual kecil di mainnet. Biaya sesungguhnya tetap **seed likuiditas yang terkunci permanen** (§1b). Untuk demo mainnet, beli sekecil apa pun bisa dijual kembali dengan kehilangan ~0,6% plus gas di bawah $0,05 per chain.

## 5. Perintah operasional

```bash
# Kontrak
node scripts/compile-contracts.mjs --via-ir      # WAJIB --via-ir (tanpa itu: stack too deep)
node scripts/test-sovereign-dex.mjs              # 24 asersi, butuh devchain jalan

# Devchain lokal (workspace ESM terpisah supaya app Next tetap CJS)
cd devchain && npx hardhat node                  # chainId 31337, port 8545

# Deploy factory
node scripts/deploy-sovereign-dex.mjs --chain devchain --broadcast
node scripts/deploy-sovereign-dex.mjs --chain 0g              # dry run, tanpa tx
node scripts/deploy-sovereign-dex.mjs --chain 0g --broadcast  # kirim, pakai gas

# Web
npm run build
npx tsc --noEmit

# E2E penuh (butuh devchain + factory devchain + next start dengan env devchain)
node audit_e2e_flow.mjs

# Probe read-only mainnet (gratis, tanpa tx)
node audit_onchain_probe.mjs
```

### Menjalankan E2E dari nol

```bash
cd devchain && npx hardhat node &                       # terminal 1
node scripts/compile-contracts.mjs --via-ir
node scripts/deploy-sovereign-dex.mjs --chain devchain --broadcast   # catat alamatnya
OG_PRIVATE_KEY= PRIVATE_KEY= \
ADEXTO_DATA_DIR=/tmp/adexto-e2e-data \
NEXT_PUBLIC_DEVCHAIN_RPC=http://127.0.0.1:8545 \
NEXT_PUBLIC_FACTORY_V2_DEVCHAIN=<alamat> \
  npm run build && npx next start -p 3100 &             # terminal 2
node audit_e2e_flow.mjs                                 # terminal 3
```

`OG_PRIVATE_KEY=` dan `PRIVATE_KEY=` dikosongkan supaya upload 0G DA tersimulasi → nol biaya.

---

## 6. Alamat on-chain

### v2 (perlu broadcast)

| Chain | `AdextoTrinityFactoryV2` |
|---|---|
| 0G Mainnet (16661) | *belum* — set `NEXT_PUBLIC_FACTORY_V2_0G` setelah deploy |
| Arbitrum One (42161) | *belum* |
| Base Mainnet (8453) | *belum* |
| Monad Mainnet (143) | *belum* |
| Devchain (31337) | `0x9A676e781A523b5d0C0e43731313A708CB607508` (ephemeral) |

### v1 (ada di chain, tidak bisa settle swap)

Diverifikasi lewat `eth_getCode` + `estimateGas` (read-only, tanpa tx):

| Chain | Factory v1 | Hook v1 | Terima native? |
|---|---|---|---|
| 0G 16661 | `0xe8E9Cf43f88D065892c35c4aDa002C7B8b11F3e0` | `0x592c697aD1Fa712c6701C90991B96264aB2E98d8` | **revert** |
| Arbitrum 42161 | `0x2674654D4a8B79f84c1daC4Cf254EA066e59bC56` | `0xbC72FE919F85E679e7d95e2b471AaDA3c7c3Ac39` | **revert** |
| Base 8453 | `0x8e63e117E71A80Cfc10fDF375F079e2e29cd7D7D` | `0xb264D861264B0e4f8fb98A61B7694BA8a3B6BBe3` | **revert** |
| Monad 143 | `0x8e63e117E71A80Cfc10fDF375F079e2e29cd7D7D` | `0xb264D861264B0e4f8fb98A61B7694BA8a3B6BBe3` | **revert** |

Governor — **keempatnya ada di mainnet**, masing-masing 4.133 byte (diverifikasi `eth_getCode`, lihat `scripts/check-integrations-live.mjs`):

| Chain | Governor |
|---|---|
| 0G 16661 | `0x5045b117dDF788078c535f37837fDB6384da034d` |
| Arbitrum 42161 | `0x33811F9c53da5071A130F18D844f64999dBD43bA` |
| Base 8453 | `0x01b250a2db25561dB185f4628B93C72048D8bc1B` |
| Monad 143 | `0x01b250a2db25561dB185f4628B93C72048D8bc1B` |

Base dan Monad memakai alamat yang sama karena dideploy dari nonce deployer yang sama di kedua chain. Catatan lama di runbook ini hanya menyebut 0G dan Arbitrum, sehingga badge "4 Chains Live" di `/governance` sempat saya curigai berlebihan — ternyata **klaim UI-nya benar** dan runbook-lah yang kurang lengkap.

### Status tiga integrasi yang sering dipertanyakan

Dijawab dengan `eth_getCode`, bukan ingatan. Jalankan `node --experimental-strip-types scripts/check-integrations-live.mjs` untuk mengulang pemeriksaan.

| Integrasi | Status sebenarnya | Bukti |
|---|---|---|
| **Uniswap v4** | **Tidak pernah ada.** Bukan "mati", memang tidak dibangun. | Nol dependency Uniswap di `package.json`. `SovereignHook.sol` mendeklarasikan `IPoolManager` **buatan sendiri** dan punya `afterSwap` bertanda tangan `(address, PoolKey, int128, int128, bytes)` — beda dari `afterSwap` Uniswap v4 yang sesungguhnya, jadi `PoolManager` asli tidak akan pernah memanggilnya. Tidak mewarisi `BaseHook`, tidak ada alamat `PoolManager`, dan bit izin hook tidak di-mine. `SovereignCurve.sol` (generasi v3 yang dipakai sekarang) **nol** singgungan Uniswap. |
| **Chainlink CCIP** | Kontrak **ter-deploy**, jalurnya **mati**. | `ccipReceiver` ada di keempat mainnet (1.318 byte). Tapi Chainlink tidak menerbitkan router untuk 0G maupun Monad, jadi lane tidak bisa dibuka. Aplikasi **tidak pernah** memanggil `ccipReceiverAddress` — alamatnya hanya tercatat di config dan tampil di registry kontrak. |
| **World ID / ZKP** | **TERPASANG** (lihat §1h). Menyala begitu `NEXT_PUBLIC_WORLD_ID_APP_ID` dan `NEXT_PUBLIC_WORLD_ID_ACTION` terisi. | Sebelumnya nol paket dan nol verifikasi — kini `@worldcoin/idkit` terpasang, proof diverifikasi di server lewat `verifyCloudProof`, dan `/api/deploy` menolak launch tanpa token. Uji: `audit_worldid_gate.mjs` — **22/0** saat aktif, **7/0** saat mati. |

Catatan tambahan: `sovereignHook` yang ter-deploy di keempat mainnet berukuran **1.495 byte** — itu generasi **v1** yang belum punya `buy`/`sell`/`receive`, konsisten dengan kolom "Terima native? → **revert**" di tabel atas. Jadi walau alamat hook ada di mainnet, tidak ada perdagangan yang bisa settle di sana.

Temuan kecil di `SovereignHook.afterSwap`: fungsi itu `external` **tanpa kontrol akses**, dan menaikkan `totalTreasuryFeesCollected` dari angka yang dikirim pemanggil. Siapa pun bisa menggelembungkan penghitung itu. Dampaknya terbatas — tidak ada dana yang berpindah dan aplikasi tidak pernah membaca `totalTreasuryFeesCollected` (sudah dicek) — tapi jangan pernah menampilkan angka itu sebagai statistik. Di `SovereignCurve` masalah ini tidak ada karena tidak ada callback semacam itu.
Deployer: `0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D` (0G ≈ 8.9, Arbitrum ≈ 0.000138).

**Catatan data:** `AdextoTrinityFactory.totalProjectsCount()` = **1** di 0G dan **0** di Arbitrum. Artinya QNOVA, CSENT dan MQUANT tidak pernah dibuat lewat factory. Di registry mereka ditandai `verified: false` / `poolLive: false` dan tampil sebagai *showcase entry*, bukan pasar yang bisa ditradingkan. AEGIS (`0xb5A8…0dEd`) kontraknya memang ada di 0G (`verified: true`) tapi tanpa pool v2 juga belum tradable.

Storage 0G DA genesis: tx `0xcfac6cd4…8c55`, root `0xeaa56a1f…509d`.

---

## 7. Bug yang ditutup pada pass ini

Semua nomor merujuk temuan audit E2E sebelumnya. Semuanya diverifikasi ulang oleh `audit_e2e_flow.mjs` (66/66) atau `scripts/test-sovereign-dex.mjs` (24/24).

### CRITICAL

1. **SELL mengirim native coin** — `handleExecuteTrade` memakai `value: parseEther(payAmount)` untuk buy *dan* sell, jadi mengisi `50000` di kolom jual meminta wallet mengirim 50.000 coin. Sekarang jual = `approve` + `pool.sell(...)`, nol native keluar selain gas. *Uji: saldo token turun, saldo native naik +0,372623 ETH.*
2. **Trade tanpa calldata** — semua tx dulu transfer native kosong ke alamat kontrak. Sekarang lewat `buy()`/`sell()` dengan `minAmountOut` + `deadline`, plus `staticCall` preflight sehingga trade yang akan revert tidak menghabiskan gas. *Uji: percobaan yang kena limit anti-sniper ditolak tanpa perubahan saldo native.*
3. **Alamat token dari `Math.random()`** — sekarang dibaca dari event `TrinityProjectDeployed` di receipt dan diverifikasi server (`getTransactionReceipt` + `getCode`) sebelum masuk registry. *Uji: alamat token & pool hasil launch benar-benar punya bytecode di chain.*
4. **"Deployment Succeeded" walau tx ditolak** — hasil dilaporkan per chain (`success` / `failed` + alasan). Tidak ada layar sukses tanpa receipt yang valid.
5. **Tidak ada chain guard** — `ensureWalletChain()` memaksa `wallet_switchEthereumChain` (atau `wallet_addEthereumChain`) sebelum tx dibangun; UI memblokir trading dan menampilkan tombol switch bila wallet beda chain.
6. **Symbol squatting** — ticker kurasi masuk `RESERVED_SYMBOLS`, duplikat ditolak, entri kurasi selalu menang di `listProjects()`, dan `prepare` butuh attestation bertanda tangan. *Uji: klaim `AEGIS` **dengan attestation sah** → 409 "Ticker AEGIS is reserved"; `prepare` tanpa tanda tangan → 401.* Catatan: attestation diperiksa **sebelum** aturan symbol, jadi uji lama yang mengirim tanpa tanda tangan berhenti di 401 dan sebenarnya tidak pernah membuktikan proteksi ticker. Harness sudah dikoreksi agar menandatangani lebih dulu.
7. **Telemetry tanpa auth** — `POST /api/agent/telemetry` butuh `Authorization: Bearer $ADEXTO_TELEMETRY_SECRET`, fail-closed 503 bila secret belum diset, validasi skema, dan **append-only** (dulu satu POST mengganti seluruh feed). Penyimpanan pindah ke `ADEXTO_DATA_DIR` dengan volume Docker; sebelumnya `/app/public` tidak writable oleh uid 1001 sehingga registry hilang setiap restart dan POST balas 500. *Uji: tanpa token → 401, token salah → 403, feed tidak terkontaminasi.*
8. **Harga campur satuan dipakai sebagai USD** — record menyimpan `priceNative` (angka) + `nativeSymbol`; USD selalu diturunkan lewat `/api/prices`. *Uji: QNOVA `priceNative` = 0,00018 dalam ETH, bukan 0,00018 USD.*

### HIGH

- `tokenPriceUSD = priceUSD < 0.1 ? priceUSD : 0.00015` dihapus; harga header dan harga yang dipakai menghitung output sama-sama dari reserve pool.
- Chart tidak lagi memanggil `series.update()` dengan timestamp lama (yang dulu melempar dan ditelan `catch{}`); sekarang `setData` dengan candle terurut naik dari `buildCandles()`. *Uji: 48 candle monotonic, `source=onchain`.*
- Candle datar hilang: OHLC dibangun dari event `Swap` on-chain; kalau memang belum ada fill, UI menyatakannya (`genesis seed` / `no fills`) alih-alih menggambar garis palsu.
- `chain.includes("Arbitrum")` diganti `resolveChain()` di `src/lib/chains.ts` (prioritas chainId eksplisit → nama chain pertama yang muncul). Label omnichain tidak lagi membelokkan explorer/RPC/mata uang ke Arbitrum.
- `payCurrency` stale hilang: aset bayar diturunkan dari chain market dan dikunci ke native asset pool.
- World ID palsu → sekarang jujur bernama **deployer address attestation**, tanda tangan diverifikasi server. Disclaimer di UI menyebut eksplisit bahwa ini bukan ZKP dan tidak menjamin 1-human-1-launch.
- Omnichain 1 tx → loop per chain, dan chain tanpa FactoryV2 ditampilkan terkunci beserta alasan, bukan dilewati diam-diam.
- **Kunci API 0G tertulis langsung di sumber.** `src/app/api/chat/route.ts` dan `scripts/deploy-real-agent-0g.ts` memakai kunci asli sebagai fallback (`process.env.X || "sk-…"`), dan itu ikut ter-commit. Akibatnya rotasi env **tidak** mencabut kunci lama: siapa pun yang membaca repo tetap bisa memakainya. Fallback sudah dihapus; endpoint chat kini fail-closed 503 bila `OG_ROUTER_API_KEY` tidak ada. Kunci lama masih ada di riwayat git, tetapi **sengaja tidak dirotasi**: pemilik proyek sudah membatasi budget kunci itu sehingga kerugian maksimumnya terkurung. Keputusan tercatat di §3 — jangan diangkat lagi sebagai temuan.
- **Chat agent menampilkan alur berpikir model, bukan jawaban.** glm-5.2 di router 0G mengirim `reasoning_content` dan `content` dalam satu delta; rute memakai `content || reasoning_content`, sehingga yang tampil adalah kalimat berpikir ("Let's write a concise review", "Drafting the Review"). Sekarang hanya `content` yang dialirkan, `reasoning` disimpan dan dipakai hanya bila model tak menghasilkan jawaban sama sekali. Sekalian diperbaiki: `controller.close()` dulu bisa terpanggil dua kali (jalur `[DONE]` + `finally`) dan melempar `TypeError`.
- **Panel agent menjanjikan "ask me about pool depth" tanpa data pool.** System prompt hanya memuat alamat dan fee, jadi agent menjawab *"once you provide reserves…"*. Sekarang state pool nyata (reserve native/token, spot price, saldo user, rumus buy/sell, sifat pulang-balik `(1-fee)²`) dikirim dari `swap.pool` — data yang memang sudah dibaca komponen dari chain.
- **Agent menuliskan aritmetika setengah jalan di layar.** Setelah punya angka, glm-5.2 menulis kerja hitungnya di kanal `content` ("Wait, let me just do it directly…"). Ditambahkan kontrak keluaran tegas (jawaban final saja, maksimal 4 poin satu baris, satu angka per poin, larangan "let me"/"wait") dan `temperature: 0.1`. Hasil sesudahnya: 4 poin bersih, nol aritmetika mentah.
- **Tidak ada cara memilih atau mengganti wallet saat trading** (dilaporkan user). UI hanya punya tombol "Connect" dan satu ikon logout kecil di navbar; halaman trading tidak punya kontrol wallet sama sekali. Lebih dalam dari itu, seluruh aplikasi membaca `window.ethereum` langsung, jadi kalau terpasang beberapa wallet (MetaMask, Rabby, OKX, Phantom) yang dipakai adalah pemenang lomba injeksi dan user tidak punya pilihan. Sekarang: wallet ditemukan lewat **EIP-6963** di `src/lib/wallet-provider.ts`, yang menjadi satu-satunya sumber provider; `use-sovereign-swap.ts` dan `studio/page.tsx` tidak lagi menyentuh `window.ethereum`, sehingga pilihan wallet **benar-benar menentukan pengirim transaksi**, bukan kosmetik. Komponen `WalletMenu` (navbar + panel `/swap` + panel terminal token) menyediakan pilih wallet, ganti wallet, **ganti akun** (`wallet_requestPermissions` — `eth_requestAccounts` tidak memberi kesempatan berganti akun), salin alamat, dan putuskan. *Uji: `audit_wallet_picker.mjs`.*
- **Aplikasi mengaku "tersambung" ke wallet yang tidak pernah dipilih.** Saat perbaikan di atas dibuat, urutan pemilihan provider masih jatuh ke `window.ethereum` ketika beberapa wallet terdeteksi tapi belum ada yang dipilih. Akibatnya UI langsung menampilkan akun dari wallet pemenang injeksi. Urutannya kini: wallet pilihan user → satu-satunya wallet EIP-6963 → `window.ethereum` **hanya bila tidak ada wallet EIP-6963** (menjaga wallet lama dan shim skrip audit/rekaman) → `null` bila banyak wallet tapi belum dipilih, supaya UI menanyakan dulu.
- **Dropdown chain di `/swap` tidak mengubah panel** (dilaporkan user, regresi dari refactor multi-chain). Filter chain hanya menyaring daftar market tanpa pernah mereset market terpilih, sehingga memilih Base Mainnet meninggalkan header, biaya, harga dan panel trading pada market 0G — terlihat seperti tampilan "hardcode ke 0G". Sekarang satu efek memiliki seluruh urusan pemilihan: bila chain yang dipilih punya market, pilihan pindah ke market chain itu; bila tidak ada, pilihan dikosongkan sehingga header menjadi "Select a market" dan muncul penjelasan "Belum ada market di <chain>" plus tombol kembali ke All chains. Filter default tetap `all` — memaksanya ke chain market terpilih akan menyembunyikan market chain lain tanpa alasan. *Uji: `audit_swap_chain_switch.mjs`.*
- **Praseleksi URL tertimpa oleh sinkronisasi filter.** Saat perbaikan di atas dibuat sebagai efek terpisah, efek kedua berjalan di commit yang SAMA memakai state lama dan menimpa pilihan dari URL: `?token=CSENT` berakhir memilih QNOVA (chain benar, token salah). Karena itu keduanya digabung dalam satu efek dengan `return` tegas setelah praseleksi. *Uji: matriks `?token=`/`?token=&chain=` untuk setiap market di `audit_swap_chain_switch.mjs`.*
- **`?chain=` yang tidak cocok memilih token yang SALAH** (ditemukan saat pengujian ulang). Di `/swap`, bila `?chain=` menunjuk chain yang tidak punya market untuk `?token=`, pemilihan jatuh ke "market tradable pertama" — token yang sama sekali lain. Tautan dengan chain id basi bisa membuat orang membeli token yang bukan dimaksud. Sekarang `?token=` menang atas `?chain=`: penurunan bertahap selalu **di dalam symbol yang sama** (chain diminta → tradable → pertama), dan hanya kalau symbol-nya tidak ada barulah jatuh ke market lain. Halaman token juga tidak lagi 404 untuk `?chain=` basi, tapi `findProject` DIBIARKAN ketat karena `/api/pool` dan `/api/agent/telemetry` memakainya — mengembalikan pool chain lain di sana akan menampilkan harga dan reserve yang salah. *Uji: `audit_link_compat.mjs`.*
- `/swap` state desync hilang: daftar market satu sumber (`/api/graphql`), dropdown chain jadi *filter*, chain eksekusi selalu dari market terpilih.
- `/token/<slug>` tak dikenal → **HTTP 404** asli (server component + `notFound()`), bukan halaman pasar palsu.
- Duplikat entri/`<option>` hilang lewat dedupe by symbol + address.

### MEDIUM

- Badge `+14.8%` hardcoded → dihitung dari candle.
- "Market Cap" yang menampilkan jumlah supply → sekarang `supply × harga` dalam USD, dengan kolom Supply terpisah.
- Tombol Swap di explorer membawa `?token=SYMBOL` (dan dikunci untuk market tanpa pool).
- `OG_ROUTER_API_KEY` plaintext dihapus dari `docker-compose.yml`.

### Perbaikan pra-deploy immutable (hal yang tidak bisa ditambal setelah broadcast)

Review khusus sebelum factory jadi permanen menemukan dua hal, keduanya sudah diperbaiki dan diuji ulang di kelima jaringan:

1. **`uint112` dengan cast eksplisit — potensi truncation senyap.** Reserve semula `uint112` supaya hemat satu slot, tetapi setiap pembaruan lewat `uint112(...)`. Di Solidity 0.8 konversi menyempit **tidak** revert saat overflow — ia memotong nilai secara senyap. Satu kali terjadi, invarian pool rusak permanen dan tidak ada cara memperbaiki kontrak immutable. Reserve kini `uint256` dan seluruh cast dihapus. Biayanya satu slot storage tambahan; imbalannya kelas kegagalan ini hilang sepenuhnya.

2. **Tidak ada resolusi token→pool yang trustless.** Frontend membaca alamat pool dari registry file. Kalau file itu hilang, tidak ada jalur on-chain langsung. Mapping tidak bisa ditambahkan setelah deploy, jadi `poolOf(token)` dan `tokenOf(pool)` kini ada di factory meski backend belum membutuhkannya.

Ukuran FactoryV2 setelah perubahan: **17,08 KiB** (batas EIP-170 24 KiB).

### Keputusan desain yang bersifat permanen

Hal-hal berikut **tidak bisa diubah** tanpa factory baru. Semuanya disengaja, tapi harus disadari:

- **Likuiditas seed terkunci permanen.** `initializePool` hanya bisa dipanggil sekali dan tidak ada `addLiquidity` / `removeLiquidity` maupun LP token. Native dan token yang di-seed tidak bisa ditarik siapa pun, termasuk creator. Untuk launchpad ini adalah fitur (rug-proof), tapi konsekuensinya: **tidak ada yang menerima "LP reward"**. Fee `lpFeeBps` tinggal di dalam reserve dan memperdalam pool. Label UI sudah dikoreksi dari "LP rewards" menjadi "Liquidity fee — stays in pool", dan studio menyatakan eksplisit bahwa seed terkunci. Kalau nanti fungsi tambah/tarik likuiditas dibutuhkan, itu butuh kontrak pool baru → factory baru.
- **`receive()` = market buy tanpa batas slippage.** Transfer native polos ke pool menghasilkan pembelian di harga pasar apa pun, jadi bisa di-sandwich. Alternatifnya adalah revert (dana kembali ke pengirim, lebih aman), tetapi requirement-nya memang agar transfer polos tidak revert. Jalur normal UI selalu memakai `buy()` dengan `minTokensOut`.
- **Kepemilikan token beku di factory.** `AdextoToken` memakai `Ownable(msg.sender)` dan yang men-deploy adalah factory, sehingga `owner()` selamanya factory. FactoryV2 tidak punya fungsi apa pun untuk memakai kepemilikan itu — termasuk `disableAntiSnipe()`. Efeknya tidak ada tuas rug sama sekali; anti-sniper juga kedaluwarsa sendiri setelah 5 blok.

### Catatan perilaku per-chain (penting saat operasi)

- **`block.number` tidak berarti sama di semua chain.** `AdextoToken` menutup window anti-sniper pada `launchBlock + 5`. Di Arbitrum, `block.number` di Solidity mengembalikan nomor blok **L1**, jadi 5 blok ≈ 60 detik waktu nyata, bukan 5 blok L2 (L2 maju ~4 blok/detik). Di 0G testnet blok terbit ~1 detik sehingga window bisa sudah lewat dalam hitungan detik. Konsekuensi operasional: pembelian di atas 1% supply akan revert selama window itu, dengan pesan yang sudah dijelaskan UI. Suite uji tidak lagi menebak — ia mem-*probe* perilaku aktual lalu menunggu window berakhir, sehingga valid di semua chain.
- **Kompatibilitas opcode.** Bytecode dikompilasi solc 0.8.26 dengan EVM target default (Cancun) dan memakai `PUSH0`, `MCOPY`, `TSTORE`. `audit_opcode_compat.mjs` menguji ketiganya langsung lewat `eth_call` di 0G, Arbitrum, Base dan Monad: **semuanya didukung**. Indikator header sempat menyesatkan (0G tampak Shanghai, Arbitrum tampak London) — yang menentukan adalah eksekusi opcode-nya, bukan field header.
- **Biaya `estimateGas` sebelum broadcast.** `deploy-sovereign-dex.mjs` selalu melakukan `estimateGas` di chain target dan menolak jalan bila saldo kurang, jadi konstruktor yang akan revert tidak akan menghabiskan gas.

### Perbaikan tambahan yang muncul saat kerja

- Factory v1 mencetak seluruh supply ke dirinya sendiri (`_mint(msg.sender)` di constructor token dipanggil dari factory), jadi creator tidak menerima apa pun dan supply terkunci permanen. FactoryV2 menyetor sebagian ke pool dan mengirim sisanya ke creator.
- Order book dulu sintetis dari harga dasar. Sekarang tangga harga dihitung dengan formula constant-product yang sama dengan kontrak, jadi harga yang tampil = harga yang akan didapat untuk ukuran itu.
- `tsconfig` target ES2017 → ES2020 (dibutuhkan literal BigInt).

---

## 8. Yang belum selesai

1. **Broadcast `AdextoTrinityFactoryV2` ke mainnet.** Tanpa ini semua pasar mainnet tetap `poolLive: false` dan trading dikunci by design.

   Sudah dibuktikan lebih dulu di dua jaringan remote nyata (0G Testnet 16602 dan Arbitrum Sepolia 421614): factory ter-deploy, token+pool terbit dari event receipt, buy dan sell benar-benar menggerakkan saldo, slippage/deadline/approve semuanya berperilaku benar. Bytecode yang akan dikirim ke mainnet **identik** dengan yang diuji.

   Biaya hasil dry-run:

   | Chain | Gas | Biaya | Saldo | Status |
   |---|---|---|---|---|
   | 0G 16661 | 3.951.269 | ~0,0158 0G | 8,908 0G | cukup |
   | Base 8453 | 3.919.249 | ~0,0000431 ETH | 0,00193 ETH | cukup |
   | Monad 143 | 3.917.221 | ~0,791 MON | 11,238 MON | cukup |
   | Arbitrum 42161 | 3.948.051 | ~0,0001586 ETH | 0,000138 ETH | kurang ~0,00002 ETH |

   ```bash
   node scripts/deploy-sovereign-dex.mjs --chain 0g               # dry run
   node scripts/deploy-sovereign-dex.mjs --chain 0g --broadcast    # kirim
   # lalu set NEXT_PUBLIC_FACTORY_V2_0G di .env.local dan REBUILD container
   ```

   **Kalau nanti factory perlu diganti lagi, kerugiannya terbatas:** alamat factory hanya sebuah env var, pool yang sudah dibuat tetap berfungsi dan tetap tradable (frontend membaca pool per-market dari registry, bukan dari factory), dan hanya launch baru yang memakai factory baru. Tidak ada migrasi likuiditas yang dipaksa.
2. ~~**Rotasi `OG_ROUTER_API_KEY`**~~ — **DITUTUP, risiko diterima.** Pemilik proyek sudah membatasi budget kunci itu, jadi eksposurnya terkurung dan rotasi tidak dikerjakan. Lihat catatan di §3 (tabel env).
3. **Migrasi pasar kurasi.** AEGIS/QNOVA/CSENT/MQUANT belum punya pool v2. Pilih: bikin pool baru lewat FactoryV2, atau biarkan sebagai showcase (status sekarang).
4. **World ID sungguhan** bila anti-Sybil memang jadi syarat: pasang IDKit + verifikasi proof di server, lalu set `NEXT_PUBLIC_WORLD_ID_APP_ID`.
4b. **Treasury relayer** bila ingin UX "bayar sekali di 0G, aktif di 4 chain" (§1c). Perlu keputusan berapa ETH di Arbitrum/Base dan MON di Monad yang siap diparkir, karena itulah yang membiayai seed pool di chain tujuan. Kontrak CCIP lama (`AdextoCCIPTreasuryRouter`, `AdextoCCIPReceiver`) sebaiknya dianggap tidak terpakai sampai Chainlink membuka lane untuk 0G.
5. **Audit kontrak eksternal** sebelum pool menampung dana signifikan. `SovereignHook` sudah punya reentrancy guard, slippage, deadline dan cap fee, tapi belum ditinjau pihak ketiga.
6. ~~**The Graph subgraph** masih mengindeks factory v1~~ **SELESAI** — lihat §2. Schema baru (`Project`, `Curve`, `Swap`, `BuybackBurn`, `CreatorFeeClaim`, `CurveDayData`, `GlobalStats`), handler `TrinityProjectDeployed` + template `SovereignCurve`, dan `/api/graphql` sebagai jalur baca kedua.
7. **Deploy `cloudflare-worker`** ke `edge.adexto.xyz` (`npx wrangler deploy`).

---

## 9. Direktori kode

* `src/app/` — halaman Next.js 15. `/` `/studio` `/swap` `/explorer` `/token/[token]` `/governance` `/agent/demo` `/pitch` `/whitepaper` `/docs`.
* `src/app/api/` — `chat`, `deploy` (prepare/confirm), `graphql` (registry), `pool` (state pool read-only), `agent/telemetry` (candle + ingest terautentikasi), `prices`, `generate-logo`.
* `src/lib/` — `chains.ts` (resolusi chain), `dex.ts` (ABI, quote, preflight, eksekusi, chain guard), `use-sovereign-swap.ts` (satu engine trading untuk /swap dan /token), `registry.ts`, `telemetry.ts`, `onchain-trades.ts` (event Swap → candle), `pricing.ts`, `server-store.ts`.
* `contracts/` — `SovereignHook.sol` (AMM v2), `AdextoTrinityFactoryV2.sol`, `AdextoToken.sol`, `AdextoTrinityFactory.sol` (v1, dipertahankan sebagai referensi), `AdextoGovernor.sol`, CCIP.
* `scripts/` — `compile-contracts.mjs`, `test-sovereign-dex.mjs`, `deploy-sovereign-dex.mjs`, dan skrip lama.
* `devchain/` — workspace ESM terpisah agar Hardhat 3 bisa menjalankan devchain tanpa memaksa app Next jadi ESM.
* `audit_e2e_flow.mjs` — E2E UI penuh terhadap devchain. `audit_onchain_probe.mjs` — probe mainnet read-only.
