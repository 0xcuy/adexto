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
export const CURVE_FACTORY_GENERATION = {
  contract: "AdextoFactory",
  version: "0.11.0",
} as const;

/**
 * Generasi yang digantikan. Labelnya baru terpakai begitu
 * `NEXT_PUBLIC_CURVE_FACTORY_PREV_*` terisi, yaitu setelah factory penerusnya
 * di-broadcast — dan nilainya sudah benar sejak sekarang supaya penukarannya tidak
 * perlu mengubah dua tempat sekaligus.
 */
export const SUPERSEDED_CURVE_FACTORY_GENERATION = {
  contract: "AdextoCurveFactory",
  version: "0.10.0",
} as const;


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
    rpcUrl: "https://mainnet.base.org",
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
    rpcUrl: "https://rpc.monad.xyz",
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
  edgeX402Gateway: "https://adexto-x402-edge.cucuvirtual.workers.dev",

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
