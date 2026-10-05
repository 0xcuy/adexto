/**
 * Canonical on-chain addresses for the ADEXTO Protocol.
 *
 * Alamat factory dibaca dari environment, supaya sebuah broadcast tidak menuntut
 * perubahan kode:
 *
 *   NEXT_PUBLIC_CURVE_FACTORY_0G / _ARBITRUM / _BASE / _MONAD   AdextoCurveFactory
 *
 * BUG YANG DITUTUP DI SINI
 *
 * `NEXT_PUBLIC_CURVE_FACTORY_*` sebelumnya TIDAK PERNAH DIBACA di berkas ini.
 * Studio menyuruh pengguna menyetel `NEXT_PUBLIC_FACTORY_V3_0G` saat peluncuran
 * mati, dan tidak ada satu baris kode pun yang membacanya — satu-satunya jalur
 * yang benar-benar bekerja adalah `NEXT_PUBLIC_CHAIN_OVERRIDES`, yang justru
 * WAJIB kosong di produksi (§3 runbook). Akibatnya: mem-broadcast factory ke
 * mainnet lalu menyetel variabel yang disarankan UI tidak akan mengaktifkan
 * apa pun, dan penyebabnya tidak akan terlihat di mana pun.
 *
 * `sovereignHookAddress` is the legacy v1 hook. It has no `receive()` and no swap
 * entrypoint, so it cannot settle trades — the UI treats a chain without a
 * factory as "DEX not live yet" instead of sending doomed transactions.
 */

/**
 * BACAAN ENV HARUS STATIS, DAN INI KEMBARAN DARI BUG YANG SUDAH DICATAT DI ATAS
 *
 * Versi sebelumnya berbunyi `env("NEXT_PUBLIC_CURVE_FACTORY_0G")` dengan
 * `const env = (key: string) => process.env[key]`. Itu memperbaiki keluhan lama
 * ("variabelnya tidak pernah dibaca") tanpa memperbaiki akibatnya, karena Next.js
 * hanya bisa mengganti `process.env.NEXT_PUBLIC_FOO` yang ditulis sebagai akses
 * anggota STATIS. Dengan key berupa variabel, penggantinya tidak pernah terjadi:
 * bundel klien berisi STRING NAMA variabelnya, bukan nilainya.
 *
 * Akibatnya persis seperti kalau variabelnya tidak diset — `curveFactoryAddress`
 * jadi `undefined` di peramban, `dexLive` false di keempat chain, dan studio tetap
 * berkata "Launching is disabled" SETELAH factory-nya benar-benar di-broadcast ke
 * mainnet. Terbukti dengan menggeledah `.next/static`: alamatnya tidak ada di sana,
 * nama variabelnya ada.
 *
 * Karena itu setiap variabel dituliskan penuh di bawah. Membosankan, dan itulah
 * satu-satunya bentuk yang benar-benar di-inline.
 */
const clean = (value: string | undefined): string | null =>
  value && /^0x[a-fA-F0-9]{40}$/.test(value) ? value : null;

const CURVE_FACTORY = {
  og: clean(process.env.NEXT_PUBLIC_CURVE_FACTORY_0G),
  arbitrum: clean(process.env.NEXT_PUBLIC_CURVE_FACTORY_ARBITRUM),
  base: clean(process.env.NEXT_PUBLIC_CURVE_FACTORY_BASE),
  monad: clean(process.env.NEXT_PUBLIC_CURVE_FACTORY_MONAD),
  robinhood: clean(process.env.NEXT_PUBLIC_CURVE_FACTORY_ROBINHOOD),
  // Kosong sampai factory Arc di-broadcast. Selama kosong, Arc tidak muncul di daftar chain
  // mana pun (lihat `CHAIN_LIST` di src/lib/chains.ts).
  arc: clean(process.env.NEXT_PUBLIC_CURVE_FACTORY_ARC),
} as const;

/**
 * FACTORY YANG DIGANTIKAN — hanya untuk verifikasi, TIDAK untuk meluncurkan.
 *
 * Sampai 0.11.0 setiap chain hanya punya satu factory, jadi satu variabel per chain
 * cukup. Sekarang tidak: bytecode factory tidak bisa diubah, jadi pasar yang sudah
 * dibuat factory sebelumnya tetap hidup dan tetap dibuat oleh alamat itu selamanya.
 * Kalau alamat lamanya hilang dari konfigurasi, halaman verifikasi berhenti menyebut
 * kontrak yang benar-benar melahirkan pasar-pasar itu — situsnya jadi kurang jujur
 * justru karena ada versi baru.
 *
 * DIPISAHKAN DENGAN SENGAJA dari `CURVE_FACTORY`. `dexLive`, filter `deployable` di
 * /api/deploy, dan tombol launch di studio HANYA boleh melihat `CURVE_FACTORY`. Itu
 * persis pelajaran dari `factoryV2Address` yang baru dibuang: field kedua yang ikut
 * dihitung sebagai "bisa meluncurkan" membuat chain diiklankan siap padahal transaksi
 * launch tidak pernah dibangun darinya.
 */
const PREV_CURVE_FACTORY = {
  og: clean(process.env.NEXT_PUBLIC_CURVE_FACTORY_PREV_0G),
  arbitrum: clean(process.env.NEXT_PUBLIC_CURVE_FACTORY_PREV_ARBITRUM),
  base: clean(process.env.NEXT_PUBLIC_CURVE_FACTORY_PREV_BASE),
  monad: clean(process.env.NEXT_PUBLIC_CURVE_FACTORY_PREV_MONAD),
} as const;

/**
 * Nama kontrak dan VERSION dari generasi factory yang sedang dipakai meluncurkan.
 *
 * Ada di sini karena sebelumnya dua halaman menuliskannya sebagai teks mati —
 * `/security` berkata "AdextoCurveFactory 0.10.0" di kepala tabel dan
 * VerifiedDeploymentCard berkata "launches tokens · v0.10.0" di lencana. Keduanya
 * hanya benar selama env-nya menunjuk factory itu, dan tidak ada apa pun yang
 * memaksa keduanya ikut berubah saat alamatnya ditukar. Menukar alamat tanpa
 * menyunting dua string itu membuat situs mengiklankan versi yang salah untuk
 * kontrak yang benar — jenis kesalahan yang paling sulit dilihat, karena semuanya
 * tetap berfungsi.
 *
 * `audit_consistency.mjs` membaca `VERSION()` dari setiap alamat factory di chain
 * dan membandingkannya dengan nilai di sini, jadi kalau keduanya berpisah auditnya
 * gagal alih-alih halamannya diam-diam salah.
 */
/**
 * The x402 gateway's relayer: the address that sends every cross-chain delivery.
 *
 * A delivery is an ordinary `buy` on the curve with the payer as `recipient`, so on an explorer
 * the transaction's sender is this relayer while the tokens land at the payer's own address.
 * The trade feed uses this to label those fills instead of leaving the two addresses to look
 * like a contradiction. The same address on every chain.
 */
export const X402_RELAYER = "0xDe1f5e5505c01aC6C847146fF76E0e067A49C627";

export const CURVE_FACTORY_GENERATION = {
  contract: "AdextoFactory",
  version: "1.0.0",
} as const;

/**
 * Generasi yang digantikan. Labelnya baru terpakai begitu
 * `NEXT_PUBLIC_CURVE_FACTORY_PREV_*` terisi, yaitu setelah factory penerusnya
 * di-broadcast — dan nilainya sudah benar sejak sekarang supaya penukarannya tidak
 * perlu mengubah dua tempat sekaligus.
 */
export const SUPERSEDED_CURVE_FACTORY_GENERATION = {
  contract: "AdextoFactory",
  version: "0.11.0",
} as const;

/**
 * GENERASI 0.10.0 BERHENTI DISEBUT DI SINI, DAN ITU PILIHAN YANG DIAMBIL SADAR.
 *
 * Sejak 0.12.0 hidup ada TIGA generasi factory di chain sekaligus:
 *
 *   0.10.0  AdextoCurveFactory  0xaA85bc0c… (0G) dan tiga lainnya — pasarnya masih trading
 *   0.11.0  AdextoFactory       0x51c41682… (0G) dan tiga lainnya — enam pasar hidup
 *   0.12.0  AdextoFactory       0x06C80fD2… (0G) dan tiga lainnya — melayani peluncuran baru
 *
 * Konfigurasi ini hanya punya dua tempat: satu yang sedang dipakai meluncurkan, satu yang
 * digantikan. Jadi 0.10.0 tidak lagi muncul di halaman verifikasi, sementara pasar-pasarnya
 * TETAP hidup, tetap bisa diperdagangkan, dan tetap membayar tarifnya sendiri selamanya.
 *
 * Yang hilang bukan pasarnya, hanya penyebutan factory yang melahirkannya. Kalau suatu saat
 * itu dianggap terlalu mahal untuk kejujuran halaman verifikasi, yang dibutuhkan adalah
 * DAFTAR generasi, bukan slot ketiga — karena masalah yang sama akan terulang di 0.13.0.
 *
 * Alamat 0.10.0 sengaja ditulis di komentar ini supaya tidak hilang dari repo begitu env-nya
 * ditimpa: 0G 0xaA85bc0cceB35B524b6BB730612540Fb88df0f8e, Base
 * 0x2674654D4a8B79f84c1daC4Cf254EA066e59bC56, Monad 0xbC72FE919F85E679e7d95e2b471AaDA3c7c3Ac39,
 * Arbitrum 0x8F3948902c48489fc9E7287590E7eb8A8E915A64.
 */

/**
 * ADEXTO v1 (AdextoFactory 1.0.0), broadcast 2026-10-01 from source commit 71b5adf. Every
 * read-back passed: VERSION 1.0.0, protocolTreasury 0x24268Fff…, runtime equal to the artifact
 * with the treasury in its immutable slot, and every reserved ticker unclaimable.
 *
 *   0G         16661   0xEBbE0fB112859b57A0ad1afbeD4978e43dC96c5D   block 45793987
 *   Base        8453   0xF5f904ca7763Fc6755bbCe5466a9DBd4C15c2708   block 52008858
 *   Arbitrum   42161   0x79DF3671e7e7456832C84a34c2bC0DB7871C0E0E   block 510474755
 *   Monad        143   0x3dFcBEd7dd889F465cC9f75c430B43Ef873b6056   block 109440540
 *   Robinhood   4663   0x8e63e117E71A80Cfc10fDF375F079e2e29cd7D7D   block 76864198
 *
 * The six live markets stay on their 0.11.0 factories (`NEXT_PUBLIC_CURVE_FACTORY_PREV_*`).
 * The 0.12.0 factories below are no longer read by the app; their only market is a test
 * launch. Robinhood Chain has no earlier generation.
 *
 * On Robinhood the factory sits at the deployer's nonce-0 address, which on Base and Monad
 * holds the unrelated legacy `factoryAddress` below. Same address, different chains,
 * different contracts: always pair an address with its chain id.
 */

/**
 * RIWAYAT PENUKARAN — 0.12.0 SUDAH DI-BROADCAST DAN DITUKAR (2026-09-29).
 *
 * Ditinggalkan sebagai catatan urutan, bukan sebagai instruksi yang menunggu dikerjakan.
 * Langkah 1 sampai 3 selesai; alamat 0.12.0 ada di tabel di bawah.
 *
 * Ditulis di sini dan bukan di runbook karena kedua konstanta di atas adalah yang harus
 * berubah, dan siapa pun yang menyuntingnya akan membaca baris ini lebih dulu.
 *
 * Sumber dan bytecode sekarang SEJALAN di 0.12.0, jadi celah yang dulu dinyatakan di
 * `audit/README.md` sudah tertutup — `AdextoFactory.VERSION` dan `AdextoCurve.VERSION`
 * menyatakan 0.12.0, dan keempat alamat produksi menjawab hal yang sama. Terverifikasi:
 * bytecode runtime IDENTIK di keempat chain, keccak
 * `0xc0841d5a2193f21df6b7f685bbe39fd5ee6411cbf89bf76e1b99d867174d8f0f`, 21.403 byte.
 *
 * ATURAN YANG TETAP BERLAKU UNTUK 0.13.0: jangan menaikkan label di sini lebih dulu.
 * `audit_consistency.mjs` membaca `VERSION()` dari setiap alamat factory di chain dan
 * membandingkannya dengan `CURVE_FACTORY_GENERATION`, jadi menaikkannya sebelum broadcast
 * membuat situs mengiklankan versi yang tidak ada di alamat mana pun — dan auditnya gagal,
 * yang justru perilaku yang benar.
 *
 *   1. Broadcast AdextoFactory 0.12.0 ke KEEMPAT chain (0G, Base, Arbitrum, Monad).
 *      Serentak, bukan bertahap: `/api/deploy` menolak peluncuran ke campuran generasi
 *      karena satu `lpFeeBps` tidak bisa benar untuk factory aditif dan carve-out
 *      sekaligus, jadi rollout bertahap mematikan peluncuran multi-chain selama jendelanya.
 *   2. Pindahkan alamat: `NEXT_PUBLIC_CURVE_FACTORY_PREV_*` diisi alamat 0.11.0 yang
 *      sekarang ada di `NEXT_PUBLIC_CURVE_FACTORY_*`, lalu yang belakangan diisi alamat
 *      0.12.0 yang baru. Dua env per chain, delapan seluruhnya.
 *   3. Baru setelah itu: `CURVE_FACTORY_GENERATION` -> AdextoFactory 0.12.0, dan
 *      `SUPERSEDED_CURVE_FACTORY_GENERATION` -> AdextoFactory 0.11.0.
 *   4. Copy publik yang menyatakan model ADITIF harus ikut di langkah 3, tidak lebih awal.
 *      Sekarang ia BENAR untuk yang hidup, jadi menyuntingnya lebih dulu akan membuat situs
 *      salah selama jendela sebelum broadcast, bukan sesudahnya. Kalimat yang harus dicari
 *      adalah "charged on top", "added on top", dan angka 0.30% / 0.40% / 0.15%:
 *
 *        src/app/page.tsx                  ~123, 139-140, 630-632
 *        src/app/whitepaper/page.tsx       ~77-78, 193-194, 207
 *        src/app/_pitch/page.tsx           ~83, 143-144
 *        src/components/PillarCards.tsx    ~133-134, 144
 *        src/components/swap-parts.tsx     ~321, 365
 *
 *      Nilai barunya: trader membayar 1.00% dan tidak ada apa pun di atasnya — creator
 *      0.70%, depth 0.10%, buyback 0.10%, protokol 0.10%.
 *
 *      `swap-parts.tsx` KHUSUS: ia menggambar rincian fee untuk pasar yang SEDANG dibuka,
 *      dan pasar 0.11.0 akan tetap ada setelah broadcast. Label di sana harus mengikuti
 *      `protocolFeeBps` kurva itu sendiri, bukan diganti jadi teks 0.12.0 — kalau tidak,
 *      pasar lama akan dilabeli dengan model yang tidak berlaku untuknya.
 *
 * ALAMAT 0.12.0 YANG DI-BROADCAST 2026-09-29, dicatat di sumber supaya tidak hanya hidup di
 * env. Keempatnya diverifikasi: VERSION 0.12.0, PROTOCOL_FEE_BPS 10, protocolTreasury
 * `0x24268Fff…`, `SYMBOL_RESERVED` `address(1)`, dan 16/16 ticker terkunci termasuk yang
 * huruf kecil:
 *
 *   0G       16661   0x06C80fD2d5d9365C20aC468c15874DBE748877e2   blok 45602744
 *   Base      8453   0xe5B9555fbbcE72A5739dD29c3939A23fd230136F   blok 51922828
 *   Arbitrum 42161   0x75EeDEd196D2BE283d815D52F617eB70bCe865bC   blok 509845969
 *   Monad      143   0xcA9c77f050CD1e0685b03D0236579966DA9B39B9   blok 108871845
 *
 * SATU FACTORY TERBUANG DI BASE, dan dicatat supaya tidak membingungkan pembaca explorer:
 * `0x5a2f13f1efb86bd1e1814a5212690a2b765c85c8`. Ia sah dan lengkap, tetapi tidak dipakai —
 * deployment pertama gagal di pemeriksaan cadangan karena `base-rpc.publicnode.com`
 * membatasi laju pada `eth_call` ketiga, yang terbaca seperti kontraknya revert. Penyebabnya
 * sudah diperbaiki di `scripts/deploy-factory.mjs` (jeda 150 ms per pembacaan, dan
 * galat baca sekarang berhenti dengan pesan alih-alih dihitung sebagai ticker bebas).
 * JANGAN memasukkan alamat itu ke konfigurasi mana pun.
 */


export const ADEXTO_CONTRACTS = {
  og: {
    chainId: 16661,
    chainName: "0G Mainnet",
    nativeSymbol: "0G",
    rpcUrl: "https://evmrpc.0g.ai",
    blockExplorer: "https://chainscan.0g.ai",
    factoryAddress: "0xe8E9Cf43f88D065892c35c4aDa002C7B8b11F3e0",
    curveFactoryAddress: CURVE_FACTORY.og,
    supersededCurveFactoryAddress: PREV_CURVE_FACTORY.og,
    sovereignHookAddress: "0x592c697aD1Fa712c6701C90991B96264aB2E98d8",
    governorAddress: "0x5045b117dDF788078c535f37837fDB6384da034d",
    ccipReceiverAddress: "0xaD0C7BFF5aDfeb01C3DaF2bF8C85414FE4D47Ab4",
    status: "Live On-Chain",
  },
  arbitrum: {
    chainId: 42161,
    chainName: "Arbitrum One",
    nativeSymbol: "ETH",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    blockExplorer: "https://arbiscan.io",
    factoryAddress: "0x2674654D4a8B79f84c1daC4Cf254EA066e59bC56",
    curveFactoryAddress: CURVE_FACTORY.arbitrum,
    supersededCurveFactoryAddress: PREV_CURVE_FACTORY.arbitrum,
    sovereignHookAddress: "0xbC72FE919F85E679e7d95e2b471AaDA3c7c3Ac39",
    governorAddress: "0x33811F9c53da5071A130F18D844f64999dBD43bA",
    ccipReceiverAddress: "0x5800e9715a47a598fce9bc3B65a95FD6BeBf76A3",
    status: "Live On-Chain",
  },
  base: {
    chainId: 8453,
    chainName: "Base Mainnet",
    nativeSymbol: "ETH",
    /**
     * `base-rpc.publicnode.com`, BUKAN `mainnet.base.org`. Selisihnya seratus kali.
     *
     * Diukur dari mesin ini, sebelas `eth_call` tanpa penggabungan — beban yang persis sama
     * dengan satu `readPoolState`:
     *
     *   base-rpc.publicnode.com         208 ms   ok
     *   base.drpc.org                   299 ms   ok
     *   mainnet.base.org             21.377 ms   ok, tetapi dua puluh satu detik
     *   base.llamarpc.com                       525
     *   1rpc.io/base                            410 Gone
     *   base.blockpi.network                    521
     *
     * `mainnet.base.org` membatasi laju per permintaan, jadi begitu penggabungan JSON-RPC
     * dimatikan (lihat `readProvider` di lib/chains.ts) setiap panggilan mengantre di
     * backoff ethers. Terukur di produksi: `/api/pool?symbol=BLOOP` menjawab benar tetapi
     * rata-rata 36 detik, dengan puncak 56 detik.
     *
     * PENTING — INI BUKAN URL YANG SAMA DENGAN YANG DIPAKAI RELAI.
     *
     * `src/app/api/rpc/[chain]/route.ts` tetap mengutamakan `mainnet.base.org`, dan itu
     * benar: relai dipanggil dari Worker Cloudflare, dan dari IP egress Cloudflare
     * publicnode justru menjawab `-32005 rate limit` sementara mainnet.base.org melayani.
     * Endpoint terbaik berbeda menurut siapa yang menelepon, jadi keduanya sengaja tidak
     * disatukan.
     */
    rpcUrl: "https://base-rpc.publicnode.com",
    blockExplorer: "https://basescan.org",
    factoryAddress: "0x8e63e117E71A80Cfc10fDF375F079e2e29cd7D7D",
    curveFactoryAddress: CURVE_FACTORY.base,
    supersededCurveFactoryAddress: PREV_CURVE_FACTORY.base,
    sovereignHookAddress: "0xb264D861264B0e4f8fb98A61B7694BA8a3B6BBe3",
    governorAddress: "0x01b250a2db25561dB185f4628B93C72048D8bc1B",
    ccipReceiverAddress: "0x1eE8701Dd8CD8C456E71ef74bd3Dbf0b377B6D8d",
    status: "Live On-Chain",
  },
  monad: {
    chainId: 143,
    chainName: "Monad Mainnet",
    nativeSymbol: "MON",
    /**
     * Monad dibaca lewat ALCHEMY, bukan lewat `rpc.monad.xyz`.
     *
     * Monad mainnet dilayani beberapa penyedia di URL berbeda, dan batas `eth_getLogs`
     * mereka berbeda sampai empat orde besaran. Diukur langsung, bukan disalin dari
     * dokumentasi — dengan menaikkan rentang sampai ditolak lalu binary search:
     *
     *   rpc.monad.xyz   QuickNode          100 blok
     *   rpc3.monad.xyz  Ankr             ~968 blok
     *   rpc2.monad.xyz  Goldsky       ~20.000 blok
     *   rpc1.monad.xyz  Alchemy    >=1.000.000 blok
     *
     * Batas 100 blok itulah yang membentuk hampir setiap masalah Monad di proyek ini:
     * dengan anggaran 16 panggilan, riwayat yang terjangkau hanya 1.600 blok — sekitar
     * sepuluh menit — sehingga perdagangan menghilang dari chart begitu jendelanya lewat,
     * dan sebuah pasar tidak bisa melihat peluncurannya sendiri.
     *
     * Lewat Alchemy riwayat penuh $PARCEL, 763.423 blok, dijawab dalam SATU panggilan
     * 824 ms. Rentang yang sama lewat QuickNode menuntut 7.635 panggilan berurutan.
     *
     * Bahwa ini benar-benar Alchemy diperiksa, bukan dipercaya dari tabel dokumen Monad:
     * endpoint-nya mengenali `alchemy_getTokenBalances` — yang dijawab "Method not found"
     * oleh `rpc.monad.xyz` — dan membalas dengan header `x-alchemy-trace-id`.
     *
     * URL PUBLIK tanpa kunci, jadi aman ikut ke bundel peramban. Pembacaan sisi server
     * lebih memilih `ALCHEMY_MONAD_RPC` bila diset, supaya kuota kami sendiri yang dipakai
     * dan bukan endpoint bersama; lihat `rpcUrlForReads` di `src/lib/onchain-trades.ts`.
     */
    rpcUrl: "https://rpc1.monad.xyz",
    /**
     * Dulu `monadvision.com`, dan itu membalas HTTP 403 — bukan cuma dari satu IP,
     * tapi juga dengan User-Agent peramban sungguhan. Akibatnya setiap tautan
     * explorer Monad di situs ini DAN tujuh baris tabel alamat di README menuntun
     * pembaca ke penolakan. Ini kelas cacat yang paling mahal di halaman yang
     * seluruh gunanya adalah "silakan periksa sendiri": tautan verifikasi yang
     * tidak bisa dibuka lebih buruk daripada tidak ada tautan, karena pembaca
     * menyimpulkan alamatnya yang palsu, bukan explorer-nya yang menolak.
     */
    blockExplorer: "https://monadscan.com",
    factoryAddress: "0x8e63e117E71A80Cfc10fDF375F079e2e29cd7D7D",
    curveFactoryAddress: CURVE_FACTORY.monad,
    supersededCurveFactoryAddress: PREV_CURVE_FACTORY.monad,
    sovereignHookAddress: "0xb264D861264B0e4f8fb98A61B7694BA8a3B6BBe3",
    governorAddress: "0x01b250a2db25561dB185f4628B93C72048D8bc1B",
    ccipReceiverAddress: "0x1eE8701Dd8CD8C456E71ef74bd3Dbf0b377B6D8d",
    status: "Live On-Chain",
  },
  robinhood: {
    chainId: 4663,
    chainName: "Robinhood Chain",
    nativeSymbol: "ETH",
    /**
     * The public endpoint Robinhood publishes. It is rate-limited, and it is unreachable from
     * some networks (Indonesian ISPs time out on it), so server-side reads run from the VPS.
     */
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    /**
     * Peramban membaca chain ini lewat origin situs, bukan lewat `rpcUrl` di atas: ISP Indonesia
     * memblokir `*.robinhood.com`. Endpoint publik baca-saja; lihat `src/lib/public-rpc.ts` dan
     * `rpcUrlFor` di `src/lib/chains.ts`. Server tetap memakai `rpcUrl`.
     */
    browserRpcPath: "/api/public-rpc/robinhood",
    // The explorer Robinhood's own docs list; it imports Sourcify verifications.
    blockExplorer: "https://robinhoodchain.blockscout.com",
    // ADEXTO v1 is the first generation here: no legacy factory, hook or governor.
    factoryAddress: "",
    curveFactoryAddress: CURVE_FACTORY.robinhood,
    supersededCurveFactoryAddress: null,
    sovereignHookAddress: "",
    governorAddress: "",
    ccipReceiverAddress: "",
    status: "Live On-Chain",
  },
  /**
   * Arc, the Circle L1. Its native gas asset is USDC: 18 decimals at the native level, so
   * `msg.value` arithmetic in the curve is unchanged. The ERC-20 view of the same balance lives
   * at 0x3600…0000 with 6 decimals and is NOT a second asset (see `inputAssetsFor`).
   *
   * Diukur 2026-10-06 dari VPS: `rpc.mainnet.arc.io` 0,13 dtk, blok ~0,5 dtk, base fee 20 gwei.
   * IdentityRegistry ERC-8004, Multicall3 dan CREATE2 Arachnid ada di alamat yang sama dengan
   * chain lain (diperiksa dengan eth_getCode, bukan dipercaya dari dokumen).
   */
  arc: {
    chainId: 5042,
    chainName: "Arc",
    nativeSymbol: "USDC",
    rpcUrl: "https://rpc.mainnet.arc.io",
    // Blockscout. Imports Sourcify verifications like the Robinhood explorer.
    blockExplorer: "https://explorer.arc.io",
    // ADEXTO v1 is the first generation here: no legacy factory, hook or governor.
    factoryAddress: "",
    curveFactoryAddress: CURVE_FACTORY.arc,
    supersededCurveFactoryAddress: null,
    sovereignHookAddress: "",
    governorAddress: "",
    ccipReceiverAddress: "",
    status: "Live On-Chain",
  },

  // Shared infrastructure
  /**
   * ERC-8004 Identity Registry. A per-chain singleton at the same deterministic
   * address, which was checked rather than assumed: present and answering `ownerOf`
   * on 0G (16661), Base (8453), Arbitrum One (42161) and Monad (143) mainnet, and
   * absent on all four of our testnets. Mirrors
   * `AdextoCurveFactory.AGENT_REGISTRY`, which is the authority.
   */
  agentRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  deployer: "0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D",
  daStorageIndexer: "https://indexer-storage-turbo.0g.ai",
  computeRouter: "https://router-api.0g.ai/v1",
  edgeX402Gateway: "https://x402.adexto.xyz",

  // Fallback direct references for the 0G primary chain
  chainId: 16661,
  chainName: "0G Mainnet",
  nativeSymbol: "0G",
  rpcUrl: "https://evmrpc.0g.ai",
  blockExplorer: "https://chainscan.0g.ai",
  factoryAddress: "0xe8E9Cf43f88D065892c35c4aDa002C7B8b11F3e0",
  sovereignHookAddress: "0x592c697aD1Fa712c6701C90991B96264aB2E98d8",
  governorAddress: "0x5045b117dDF788078c535f37837fDB6384da034d",
  ccipReceiverAddress: "0xaD0C7BFF5aDfeb01C3DaF2bF8C85414FE4D47Ab4",
} as const;
