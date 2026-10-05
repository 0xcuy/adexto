/**
 * Pembantu bersama untuk seluruh handler.
 *
 * ATURAN YANG MENGIKAT SETIAP BERKAS DI DIREKTORI INI
 *
 * Tidak ada satu pun panggilan fungsi view (`eth_call`) di sini, dan itu bukan sekadar
 * gaya. Indexer ini ada justru karena Monad membatasi `eth_getLogs` pada jendela 100
 * blok; menyandarkan satu field saja pada RPC berarti mengembalikan batas yang sama
 * lewat pintu lain, dan ia akan runtuh tepat saat indexer mengejar riwayat dari
 * `start_block`. Semua yang dibutuhkan sudah dipancarkan oleh event.
 *
 * Aturan kedua: entity yang dikembalikan Envio bersifat `readonly`. Memutasinya tidak
 * akan memunculkan galat, ia hanya tidak tersimpan. Jadi setiap perubahan di berkas ini
 * membangun objek baru lewat spread lalu memanggil `.set()` sekali.
 */
import { BigDecimal, type EvmOnEventContext } from "envio";
import type { Curve, CurveDayData, GlobalStats, Project } from "envio";

/**
 * Presisi pembagian BigDecimal, disetel eksplisit.
 *
 * Harga token di kurva ini rutin berada di orde 1e-12 native, sementara bignumber.js
 * membawa bawaan 20 tempat desimal untuk `div` — yang hanya menyisakan delapan angka
 * berarti pada harga sekecil itu. Angka 60 menaruhnya jauh di luar apa pun yang bisa
 * dibaca manusia atau digambar grafik.
 *
 * `EXPONENTIAL_AT` dinaikkan supaya `toString()` TIDAK pernah beralih ke notasi
 * eksponensial. Kolomnya `NUMERIC` di Postgres dan menerima keduanya, jadi ini soal
 * sisi klien: subgraph yang melayani tiga chain lain memancarkan desimal polos, dan
 * satu chain yang menjawab "5.4e-12" akan memaksa UI menebak format per jaringan.
 */
BigDecimal.set({ DECIMAL_PLACES: 60, EXPONENTIAL_AT: 1e9 });

export const ZERO = 0n;
export const ONE = 1n;
export const ZERO_DEC = new BigDecimal(0);
export const DAY = 86400n;

/**
 * VERSION kurva yang diindeks, ditentukan oleh FACTORY yang meluncurkannya, bukan oleh chain.
 *
 * Dulu setiap chain di `config.yaml` memuat tepat satu factory, jadi chain cukup untuk
 * menentukan generasinya. Sejak ADEXTO v1 diindeks di Monad, chain itu memuat dua factory
 * yang hidup berdampingan, dan versi per chain akan menulis "0.11.0" pada pasar v1 tanpa satu
 * pun galat. Versinya karena itu dibaca dari `event.srcAddress` di handler
 * `TrinityProjectDeployed`: hanya event factory yang tahu factory mana yang meluncurkan kurva.
 *
 *   Monad     143   0x5800…76A3  AdextoFactory 0.11.0
 *                   0x3dFc…6056  AdextoFactory 1.0.0 (ADEXTO v1)
 *                   (0.10.0 di 0xbC72…Ac39 tidak pernah punya peluncuran; 0.12.0 di 0xcA9c…39B9
 *                   hanya meluncurkan pasar uji $VOLT, jadi keduanya tidak diindeks)
 *   Robinhood 4663  0x8e63…7D7D  AdextoFactory 1.0.0, generasi pertama di sana
 *
 * Factory baru WAJIB ditambahkan di sini DAN di `config.yaml`; factory yang tidak dikenal
 * menghentikan indexer alih-alih menerbitkan versi tebakan.
 */
export const V_0_11_0 = "0.11.0";
export const V_1_0_0 = "1.0.0";
const CURVE_VERSION_BY_FACTORY: Record<string, string> = {
  "143:0x5800e9715a47a598fce9bc3b65a95fd6bebf76a3": V_0_11_0,
  "143:0x3dfcbed7dd889f465cc9f75c430b43ef873b6056": V_1_0_0,
  "4663:0x8e63e117e71a80cfc10fdf375f079e2e29cd7d7d": V_1_0_0,
};
export function curveVersionFor(chainId: number, factory: string): string {
  const v = CURVE_VERSION_BY_FACTORY[`${chainId}:${factory.toLowerCase()}`];
  if (v === undefined) {
    throw new Error(`No curve version is configured for factory ${factory} on chain ${chainId}.`);
  }
  return v;
}

/**
 * Versi SEMENTARA untuk `applyCurveInitialized`, yang tidak tahu factory-nya: `srcAddress`
 * event itu alamat kurva.
 *
 * Nilai ini tidak pernah bertahan. Kurva hanya bisa terdaftar lewat `TrinityProjectDeployed`,
 * jadi `applyLaunch` selalu menyusul di transaksi yang sama dan menimpa seluruh baris,
 * termasuk `curveVersion`, dengan versi factory yang sebenarnya. Yang dipilih generasi terbaru
 * di chain itu, supaya baris setengah jadi pun tidak menyebut generasi lama.
 */
const PROVISIONAL_VERSION_BY_CHAIN: Record<number, string> = { 143: V_1_0_0, 4663: V_1_0_0 };
export function provisionalCurveVersion(chainId: number): string {
  const v = PROVISIONAL_VERSION_BY_CHAIN[chainId];
  if (v === undefined) throw new Error(`No curve version is configured for chain ${chainId}.`);
  return v;
}

/**
 * `PROTOCOL_FEE_BPS` di AdextoFactory 0.11.0 dan 1.0.0, sama-sama 10.
 *
 * Konstanta, bukan hasil `eth_call`. Ia `public constant` di kontrak, jadi tidak ada
 * keadaan yang bisa membuatnya berbeda antar kurva, dan `scripts/verify-subgraph.mts`
 * sudah membandingkan angka ini dengan factory kedua generasi di chain.
 *
 * Kaki protokol TIDAK ikut di event factory: menambahkannya akan mengubah tanda tangan
 * `TrinityProjectDeployed` dan membuat setiap mapping yang sudah ada berhenti cocok,
 * ditukar dengan mengulang nilai yang sudah diketahui.
 */
export const PROTOCOL_FEE_BPS = 10n;

export type Ctx = EvmOnEventContext;

/** Field event yang dipakai setiap entity, dibongkar sekali supaya tipenya tidak menular. */
export type EventMeta = {
  readonly chainId: number;
  readonly blockNumber: bigint;
  readonly timestamp: bigint;
  readonly txHash: string;
  readonly txFrom: string;
  readonly logIndex: bigint;
};

/**
 * Bentuk minimum sebuah event EVM. Ditulis struktural, bukan memakai tipe event hasil
 * codegen, supaya satu fungsi melayani keenam event tanpa generic.
 */
type RawEvent = {
  readonly chainId: number;
  readonly block: { readonly number: number; readonly timestamp: number };
  readonly transaction: { readonly hash: string; readonly from: string | undefined };
  readonly logIndex: number;
};

/**
 * Alamat nol sebagai fallback `transaction.from`.
 *
 * Tipe hasil codegen menandai `from` opsional. Di EVM tidak ada log tanpa transaksi,
 * jadi cabang ini tidak pernah diambil — ia ada supaya tipenya tetap jujur alih-alih
 * dipaksa dengan `!`, yang akan menukar galat tipe dengan `undefined` di kolom non-null.
 */
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function metaOf(event: RawEvent): EventMeta {
  return {
    chainId: event.chainId,
    // `block.number` dan `block.timestamp` datang sebagai `number` dari Envio, sedangkan
    // skema menyimpannya `BigInt`. Konversinya di sini, satu kali.
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
    txFrom: event.transaction.from ?? ZERO_ADDRESS,
    logIndex: BigInt(event.logIndex),
  };
}

/** Id log yang stabil: satu transaksi bisa memuat beberapa swap. */
export function eventId(meta: EventMeta): string {
  return `${meta.txHash}-${meta.logIndex}`;
}

/**
 * Harga = reserveNative / reserveToken.
 *
 * Pembagian dilakukan di BigDecimal, bukan BigInt. Harga di kurva ini berada di orde
 * 1e-12 native, dan pembagian bilangan bulat akan membulatkannya menjadi nol — yang
 * berarti setiap grafik menjadi garis datar di nol tanpa satu pun galat muncul.
 */
export function priceFrom(reserveNative: bigint, reserveToken: bigint): BigDecimal {
  if (reserveToken === ZERO) return ZERO_DEC;
  return new BigDecimal(reserveNative.toString()).div(new BigDecimal(reserveToken.toString()));
}

/**
 * Lantai harga: harga yang tercapai bila SETIAP token beredar dijual kembali, yaitu
 * (virtualNative + fee depth terkumpul) / curveTokens.
 *
 * Ini properti yang membedakan kurva ini — lantainya naik monoton seiring volume karena
 * irisan depth mengendap di dalam. Dihitung di sini supaya tidak ada klien yang perlu
 * mengulang rumusnya dan salah menuliskannya.
 */
export function floorPrice(
  virtualNative: bigint,
  depthFees: bigint,
  curveTokens: bigint,
): BigDecimal {
  if (curveTokens === ZERO) return ZERO_DEC;
  return new BigDecimal((virtualNative + depthFees).toString()).div(
    new BigDecimal(curveTokens.toString()),
  );
}

/**
 * Id baris agregat per chain.
 *
 * SATU baris per chain, bukan satu untuk semua: `totalVolumeNative` di Monad dalam MON dan di
 * Robinhood dalam ETH, dan menjumlahkan keduanya menghasilkan angka tanpa satuan. Monad tetap
 * `"global"` supaya kueri yang sudah ada tidak berubah artinya.
 */
export function globalStatsId(chainId: number): string {
  return chainId === 143 ? "global" : `global-${chainId}`;
}

/** Baris agregat sebuah chain, dibuat saat pertama kali disentuh. */
export async function getGlobalStats(context: Ctx, chainId: number): Promise<GlobalStats> {
  const id = globalStatsId(chainId);
  const existing = await context.GlobalStats.get(id);
  if (existing !== undefined) return existing;
  return {
    id,
    totalProjects: ZERO,
    totalCurves: ZERO,
    totalSwaps: ZERO,
    totalVolumeNative: ZERO,
    totalDepthFees: ZERO,
    totalCreatorFees: ZERO,
    totalTreasuryFees: ZERO,
    totalProtocolFees: ZERO,
    totalTokensBurned: ZERO,
    lastUpdatedTimestamp: ZERO,
  };
}

/**
 * Ember harian untuk satu kurva, sudah diperbarui bagian harganya.
 *
 * `open` hanya ditulis saat ember dibuat, `high`/`low` diperluas, `close` selalu
 * ditimpa. Itu membuat lilinnya konsisten dengan urutan swap sesungguhnya alih-alih
 * dengan urutan pembacaan klien.
 */
async function dayBucket(
  context: Ctx,
  curveId: string,
  timestamp: bigint,
  priceAfter: BigDecimal,
): Promise<CurveDayData> {
  const dayStart = (timestamp / DAY) * DAY;
  const id = `${curveId}-${dayStart}`;

  const existing = await context.CurveDayData.get(id);
  if (existing === undefined) {
    return {
      id,
      curve_id: curveId,
      dayStartTimestamp: dayStart,
      volumeNative: ZERO,
      swapCount: ZERO,
      openPriceNative: priceAfter,
      highPriceNative: priceAfter,
      lowPriceNative: priceAfter,
      closePriceNative: priceAfter,
      depthFees: ZERO,
      creatorFees: ZERO,
      treasuryFees: ZERO,
      protocolFees: ZERO,
    };
  }

  return {
    ...existing,
    highPriceNative: priceAfter.gt(existing.highPriceNative)
      ? priceAfter
      : existing.highPriceNative,
    // Nol bukan harga; ia hanya berarti reserve token kosong. Membiarkannya masuk
    // sebagai `low` akan menjatuhkan setiap lilin ke nol.
    lowPriceNative:
      priceAfter.gt(ZERO_DEC) &&
      (existing.lowPriceNative.eq(ZERO_DEC) || priceAfter.lt(existing.lowPriceNative))
        ? priceAfter
        : existing.lowPriceNative,
    closePriceNative: priceAfter,
  };
}

/** Keadaan pembuka sebuah kurva, dari event factory-nya. */
export async function applyLaunch(
  context: Ctx,
  args: {
    curveId: string;
    tokenId: string;
    virtualNative: bigint;
    curveTokens: bigint;
    depthFeeBps: bigint;
    creatorFeeBps: bigint;
    treasuryBuybackBps: bigint;
    blockNumber: bigint;
    chainId: number;
    /** Alamat factory yang memancarkan `TrinityProjectDeployed` (`event.srcAddress`). */
    factory: string;
  },
): Promise<void> {
  const openingPrice = priceFrom(args.virtualNative, args.curveTokens);

  const curve: Curve = {
    id: args.curveId,
    project_id: args.tokenId,
    curveVersion: curveVersionFor(args.chainId, args.factory),
    virtualNative: args.virtualNative,
    curveTokens: args.curveTokens,
    /**
     * Diturunkan, TIDAK disalin dari `CurveInitialized.openingPrice`. Parameter event
     * itu nilai mentah kontrak — wei per 1e18-token — dan menyalinnya akan menaruh tiga
     * field harga dalam dua satuan yang selisihnya 1e18, dengan nama yang sama-sama
     * berakhiran `PriceNative`.
     */
    openingPriceNative: openingPrice,

    // Native nyata mulai dari nol; sisi native kurva SELURUHNYA virtual di pembukaan.
    // Itulah alasan sebuah peluncuran tidak menuntut setoran.
    reserveNative: args.virtualNative,
    reserveToken: args.curveTokens,
    tokensSold: ZERO,
    spotPriceNative: openingPrice,

    depthFeeBps: args.depthFeeBps,
    creatorFeeBps: args.creatorFeeBps,
    treasuryBuybackBps: args.treasuryBuybackBps,
    protocolFeeBps: PROTOCOL_FEE_BPS,

    totalDepthFees: ZERO,
    totalCreatorFees: ZERO,
    totalTreasuryFees: ZERO,
    totalCreatorFeesClaimed: ZERO,
    totalProtocolFees: ZERO,
    totalProtocolFeesClaimed: ZERO,
    volumeNative: ZERO,
    swapCount: ZERO,
    buyCount: ZERO,
    sellCount: ZERO,
    tokensBurned: ZERO,
    floorPriceNative: floorPrice(args.virtualNative, ZERO, args.curveTokens),

    initialized: true,
    createdAtBlock: args.blockNumber,
    lastSwapTimestamp: undefined,
  };

  context.Curve.set(curve);
}

/**
 * Satu fill.
 *
 * `protocolFee` DENGAN SENGAJA tidak ikut ke `totalDepthFees`. Irisan depth mengendap di
 * kurva dan karena itu mengangkat lantai harga; irisan protokol meninggalkan kurva.
 * Menjumlahkan keduanya akan melaporkan lantai yang lebih tinggi daripada yang benar-benar
 * bisa dibayar kurva — bohong yang paling halus, karena angkanya tetap masuk akal.
 */
export async function applySwap(
  context: Ctx,
  args: {
    curveId: string;
    meta: EventMeta;
    trader: string;
    recipient: string;
    isBuy: boolean;
    amountIn: bigint;
    amountOut: bigint;
    depthFee: bigint;
    creatorFee: bigint;
    treasuryFee: bigint;
    protocolFee: bigint;
    nativeReserveAfter: bigint;
    tokenReserveAfter: bigint;
  },
): Promise<void> {
  const curve = await context.Curve.get(args.curveId);
  // Kurva selalu ditulis oleh handler factory sebelum kurvanya bisa diperdagangkan, jadi
  // absennya berarti ada yang salah secara mendasar. Lebih baik berhenti dengan berisik
  // daripada menulis entity separuh jadi yang nanti dibaca sebagai data.
  if (curve === undefined) {
    context.log.error(
      `Swap pada kurva tak dikenal ${args.curveId} di tx ${args.meta.txHash}; dilewati.`,
    );
    return;
  }

  const priceAfter = priceFrom(args.nativeReserveAfter, args.tokenReserveAfter);

  context.Swap.set({
    id: eventId(args.meta),
    curve_id: args.curveId,
    project_id: curve.project_id,
    trader: args.trader,
    recipient: args.recipient,
    isBuy: args.isBuy,
    amountIn: args.amountIn,
    amountOut: args.amountOut,
    depthFee: args.depthFee,
    creatorFee: args.creatorFee,
    treasuryFee: args.treasuryFee,
    protocolFee: args.protocolFee,
    reserveNativeAfter: args.nativeReserveAfter,
    reserveTokenAfter: args.tokenReserveAfter,
    priceNativeAfter: priceAfter,
    blockNumber: args.meta.blockNumber,
    timestamp: args.meta.timestamp,
    txHash: args.meta.txHash,
    logIndex: args.meta.logIndex,
  });

  /**
   * Volume dicatat dalam native di KEDUA arah, dan KOTOR di kedua arah.
   *
   * Bagian pertama jelas: `amountIn` adalah native pada pembelian tetapi token pada
   * penjualan, jadi memakainya begitu saja akan menjumlahkan dua satuan berbeda menjadi
   * satu angka tak bermakna.
   *
   * Bagian kedua yang halus. Pada penjualan, `amountOut` adalah native yang benar-benar
   * sampai ke penjual — SESUDAH fee dipotong — sedangkan `buy()` di kontrak menghitung
   * `msg.value`, yang kotor. Memakai `amountOut` apa adanya membuat perdagangan berukuran
   * sama tercatat sebagai dua volume berbeda tergantung arahnya, dan indexer lalu
   * melaporkan volume lebih kecil daripada `totalVolumeNative` milik kurva.
   *
   * Kontraknya sendiri pernah salah di titik ini dan sudah dibetulkan — lihat komentar di
   * `AdextoCurve.sol` pada `totalVolumeNative += leaving + depthFee`. Rumus di bawah
   * merakit ulang `leaving + depthFee` dari field event.
   *
   * Bisa diperiksa tanpa mempercayai penjelasan ini: kaki protokol 10 bps dipungut atas
   * volume KOTOR, jadi `totalVolumeNative / 1000` di chain sama dengan
   * `totalProtocolFees`. Dicocokkan di kedua pasar Monad.
   */
  const volumeNative = args.isBuy
    ? args.amountIn
    : args.amountOut + args.depthFee + args.creatorFee + args.treasuryFee + args.protocolFee;
  const totalDepthFees = curve.totalDepthFees + args.depthFee;

  context.Curve.set({
    ...curve,
    reserveNative: args.nativeReserveAfter,
    reserveToken: args.tokenReserveAfter,
    tokensSold: curve.curveTokens - args.tokenReserveAfter,
    spotPriceNative: priceAfter,

    totalDepthFees,
    totalCreatorFees: curve.totalCreatorFees + args.creatorFee,
    totalTreasuryFees: curve.totalTreasuryFees + args.treasuryFee,
    totalProtocolFees: curve.totalProtocolFees + args.protocolFee,
    floorPriceNative: floorPrice(curve.virtualNative, totalDepthFees, curve.curveTokens),

    volumeNative: curve.volumeNative + volumeNative,
    swapCount: curve.swapCount + ONE,
    buyCount: args.isBuy ? curve.buyCount + ONE : curve.buyCount,
    sellCount: args.isBuy ? curve.sellCount : curve.sellCount + ONE,
    lastSwapTimestamp: args.meta.timestamp,
  });

  const day = await dayBucket(context, args.curveId, args.meta.timestamp, priceAfter);
  context.CurveDayData.set({
    ...day,
    volumeNative: day.volumeNative + volumeNative,
    swapCount: day.swapCount + ONE,
    depthFees: day.depthFees + args.depthFee,
    creatorFees: day.creatorFees + args.creatorFee,
    treasuryFees: day.treasuryFees + args.treasuryFee,
    protocolFees: day.protocolFees + args.protocolFee,
  });

  const g = await getGlobalStats(context, args.meta.chainId);
  context.GlobalStats.set({
    ...g,
    totalSwaps: g.totalSwaps + ONE,
    totalVolumeNative: g.totalVolumeNative + volumeNative,
    totalDepthFees: g.totalDepthFees + args.depthFee,
    totalCreatorFees: g.totalCreatorFees + args.creatorFee,
    totalTreasuryFees: g.totalTreasuryFees + args.treasuryFee,
    totalProtocolFees: g.totalProtocolFees + args.protocolFee,
    lastUpdatedTimestamp: args.meta.timestamp,
  });
}

/** Buyback: native dari vault dibelanjakan di kurva, token yang dibeli dibakar. */
export async function applyBuyback(
  context: Ctx,
  args: {
    curveId: string;
    meta: EventMeta;
    amountIn: bigint;
    tokensBurned: bigint;
    depthFee: bigint;
    nativeReserveAfter: bigint;
    tokenReserveAfter: bigint;
  },
): Promise<void> {
  const curve = await context.Curve.get(args.curveId);
  if (curve === undefined) {
    context.log.error(
      `Buyback pada kurva tak dikenal ${args.curveId} di tx ${args.meta.txHash}; dilewati.`,
    );
    return;
  }

  context.BuybackBurn.set({
    id: eventId(args.meta),
    curve_id: args.curveId,
    amountInNative: args.amountIn,
    tokensBurned: args.tokensBurned,
    blockNumber: args.meta.blockNumber,
    timestamp: args.meta.timestamp,
    txHash: args.meta.txHash,
  });

  // Fee depth dari pembelian buyback mengendap di kurva seperti fee depth swap biasa,
  // jadi ia mengangkat lantai harga dengan cara yang sama.
  const totalDepthFees = curve.totalDepthFees + args.depthFee;

  context.Curve.set({
    ...curve,
    // Dibaca dari event, bukan dihitung.
    reserveNative: args.nativeReserveAfter,
    reserveToken: args.tokenReserveAfter,
    tokensSold: curve.curveTokens - args.tokenReserveAfter,
    spotPriceNative: priceFrom(args.nativeReserveAfter, args.tokenReserveAfter),
    tokensBurned: curve.tokensBurned + args.tokensBurned,
    totalDepthFees,
    floorPriceNative: floorPrice(curve.virtualNative, totalDepthFees, curve.curveTokens),
    // Kontrak menaikkan swapCount pada buyback, jadi indexer ikut — kalau tidak,
    // swapCount on-chain dan swapCount di sini akan berbeda selamanya.
    swapCount: curve.swapCount + ONE,
  });

  const g = await getGlobalStats(context, args.meta.chainId);
  context.GlobalStats.set({
    ...g,
    totalTokensBurned: g.totalTokensBurned + args.tokensBurned,
    totalDepthFees: g.totalDepthFees + args.depthFee,
    totalSwaps: g.totalSwaps + ONE,
    lastUpdatedTimestamp: args.meta.timestamp,
  });
}

/**
 * Creator menarik fee yang sudah terakumulasi.
 *
 * `totalCreatorFees` (yang pernah diperoleh) dibiarkan apa adanya dan hanya
 * `totalCreatorFeesClaimed` yang bertambah. Selisihnya adalah yang masih bisa diklaim,
 * dan itulah angka yang ingin dilihat creator.
 */
export async function applyCreatorClaim(
  context: Ctx,
  args: { curveId: string; meta: EventMeta; to: string; amount: bigint },
): Promise<void> {
  const curve = await context.Curve.get(args.curveId);
  if (curve === undefined) {
    context.log.error(
      `Klaim creator pada kurva tak dikenal ${args.curveId} di tx ${args.meta.txHash}; dilewati.`,
    );
    return;
  }

  context.CreatorFeeClaim.set({
    id: eventId(args.meta),
    curve_id: args.curveId,
    to: args.to,
    amount: args.amount,
    blockNumber: args.meta.blockNumber,
    timestamp: args.meta.timestamp,
    txHash: args.meta.txHash,
  });

  context.Curve.set({
    ...curve,
    totalCreatorFeesClaimed: curve.totalCreatorFeesClaimed + args.amount,
  });
}

/**
 * Penarikan fee protokol.
 *
 * `caller` disimpan di samping `to` karena `claimProtocolFees()` tanpa izin: keduanya
 * boleh berbeda, dan menyimpan keduanya adalah satu-satunya cara memperlihatkan bahwa
 * tujuannya tidak bisa dibajak oleh pemanggilnya.
 */
export async function applyProtocolClaim(
  context: Ctx,
  args: { curveId: string; meta: EventMeta; to: string; amount: bigint },
): Promise<void> {
  const curve = await context.Curve.get(args.curveId);
  if (curve === undefined) {
    context.log.error(
      `Klaim protokol pada kurva tak dikenal ${args.curveId} di tx ${args.meta.txHash}; dilewati.`,
    );
    return;
  }

  context.ProtocolFeeClaim.set({
    id: eventId(args.meta),
    curve_id: args.curveId,
    to: args.to,
    caller: args.meta.txFrom,
    amount: args.amount,
    blockNumber: args.meta.blockNumber,
    timestamp: args.meta.timestamp,
    txHash: args.meta.txHash,
  });

  context.Curve.set({
    ...curve,
    totalProtocolFeesClaimed: curve.totalProtocolFeesClaimed + args.amount,
  });
}

/**
 * `CurveInitialized`, ditangani sebagai penguat yang idempoten dan BUKAN sumber utama.
 *
 * Urutannya berbeda dari subgraph, dan perbedaan itu yang membuat fungsi ini penting di
 * sini. Kontrak memancarkan `CurveInitialized` di dalam `deployTrinity` SEBELUM factory
 * memancarkan `TrinityProjectDeployed`, jadi di graph-node — yang baru mulai memantau
 * template setelah blok pendaftarannya — event ini biasanya lolos sama sekali. Envio
 * mendaftarkan kontrak dinamis untuk seluruh batch sebelum handler berjalan, sehingga log
 * dengan `logIndex` LEBIH KECIL di blok yang sama TETAP tertangkap.
 *
 * Akibatnya handler ini bisa berjalan sebelum `applyLaunch`, dan urutannya tidak boleh
 * mengubah hasil. Karena itu ia menulis kurva yang lengkap (setiap kolom non-null terisi)
 * bila belum ada, dan tidak menyentuh apa pun bila keadaan lengkap sudah ditulis factory.
 */
export async function applyCurveInitialized(
  context: Ctx,
  args: { curveId: string; virtualNative: bigint; curveTokens: bigint; blockNumber: bigint; chainId: number },
): Promise<void> {
  const existing = await context.Curve.get(args.curveId);

  // Sudah lengkap dari handler factory. Menyentuhnya hanya bisa merusak: `virtualNative`
  // dan `curveTokens` di sana berasal dari event yang sama persis.
  if (existing !== undefined && existing.initialized) return;

  const openingPrice = priceFrom(args.virtualNative, args.curveTokens);
  const depthFees = existing?.totalDepthFees ?? ZERO;

  const base: Curve = existing ?? {
    id: args.curveId,
    project_id: undefined,
    curveVersion: provisionalCurveVersion(args.chainId),
    virtualNative: ZERO,
    curveTokens: ZERO,
    openingPriceNative: ZERO_DEC,
    reserveNative: ZERO,
    reserveToken: ZERO,
    tokensSold: ZERO,
    spotPriceNative: ZERO_DEC,
    // Bps dibiarkan nol: nilainya hanya dibawa event factory, dan `applyLaunch` yang
    // menyusul di transaksi yang sama akan menuliskannya. Menebak di sini berarti
    // menerbitkan tarif fee yang tidak pernah dipancarkan kontrak.
    depthFeeBps: ZERO,
    creatorFeeBps: ZERO,
    treasuryBuybackBps: ZERO,
    protocolFeeBps: PROTOCOL_FEE_BPS,
    totalDepthFees: ZERO,
    totalCreatorFees: ZERO,
    totalTreasuryFees: ZERO,
    totalCreatorFeesClaimed: ZERO,
    totalProtocolFees: ZERO,
    totalProtocolFeesClaimed: ZERO,
    volumeNative: ZERO,
    swapCount: ZERO,
    buyCount: ZERO,
    sellCount: ZERO,
    tokensBurned: ZERO,
    floorPriceNative: ZERO_DEC,
    initialized: false,
    createdAtBlock: args.blockNumber,
    lastSwapTimestamp: undefined,
  };

  context.Curve.set({
    ...base,
    virtualNative: args.virtualNative,
    curveTokens: args.curveTokens,
    openingPriceNative: openingPrice,
    reserveNative: args.virtualNative,
    reserveToken: args.curveTokens,
    spotPriceNative: openingPrice,
    floorPriceNative: floorPrice(args.virtualNative, depthFees, args.curveTokens),
    initialized: true,
  });
}

/**
 * Bagian `Project` dari sebuah peluncuran, dan penggabungan pengikatan ERC-8004.
 *
 * `AgentBound` dipancarkan factory SEBELUM `TrinityProjectDeployed`, jadi entity
 * bindingnya sudah ada di sini bila peluncuran ini memang punya. Tidak adanya berarti
 * peluncuran tanpa identitas agent, yang merupakan keadaan default.
 *
 * `agentBound` disimpan eksplisit, bukan diturunkan dari `agentId != 0`. Agent id 0 adalah
 * agent nyata yang dimiliki seseorang di keempat mainnet, dan kontraknya pernah salah
 * tepat di titik ini sebelum di-broadcast.
 */
export async function applyProject(
  context: Ctx,
  args: {
    tokenId: string;
    curveId: string;
    meta: EventMeta;
    token: string;
    creator: string;
    name: string;
    symbol: string;
    initialSupply: bigint;
    curveTokens: bigint;
    metadataRoot: string;
  },
): Promise<void> {
  const existing = await context.Project.get(args.tokenId);
  const binding = await context.AgentBinding.get(args.tokenId);

  const project: Project = {
    id: args.tokenId,
    token: args.token,
    curve_id: args.curveId,
    creator: args.creator,
    name: args.name,
    symbol: args.symbol,
    initialSupply: args.initialSupply,
    curveTokens: args.curveTokens,
    // Bukan `teeAttestationRoot`: nilainya root penyimpanan 0G DA dari metadata launch,
    // sebuah hash konten — bukan laporan attestation hardware.
    metadataRoot: args.metadataRoot,
    agentBound: binding !== undefined,
    agentId: binding?.agentId,
    agentRegistry: binding?.agentRegistry,
    agentOwnerAtLaunch: binding?.ownerAtLaunch,
    createdAtBlock: args.meta.blockNumber,
    createdAtTimestamp: args.meta.timestamp,
    createdAtTx: args.meta.txHash,
  };

  context.Project.set(project);

  // Hitungan hanya naik saat baris Project-nya benar-benar baru. Tanpa penjagaan ini,
  // satu blok yang diproses ulang (reorg, atau resync sebagian) akan menghitung ganda
  // peluncuran yang sama, dan angkanya tidak akan pernah bisa dikoreksi turun.
  if (existing !== undefined) return;

  const g = await getGlobalStats(context, args.meta.chainId);
  context.GlobalStats.set({
    ...g,
    totalProjects: g.totalProjects + ONE,
    totalCurves: g.totalCurves + ONE,
    lastUpdatedTimestamp: args.meta.timestamp,
  });
}

/** Pengikatan identitas agent ERC-8004, ditulis ke entity sendiri. */
export function applyAgentBound(
  context: Ctx,
  args: {
    meta: EventMeta;
    token: string;
    agentId: bigint;
    agentRegistry: string;
    owner: string;
  },
): void {
  context.AgentBinding.set({
    id: args.token,
    token: args.token,
    agentId: args.agentId,
    agentRegistry: args.agentRegistry,
    ownerAtLaunch: args.owner,
    boundAtBlock: args.meta.blockNumber,
    boundAtTx: args.meta.txHash,
  });
}
