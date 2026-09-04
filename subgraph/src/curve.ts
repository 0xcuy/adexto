import {
  AutoBuybackExecuted,
  CreatorFeesClaimed,
  CurveInitialized,
  Swap as SwapEvent,
} from "../generated/templates/SovereignCurve/SovereignCurve";
import { BuybackBurn, CreatorFeeClaim, Curve, Swap } from "../generated/schema";
import { ONE, ZERO, dayData, eventId, floorPrice, globalStats, priceFrom, WAD } from "./shared";

/**
 * Keadaan kurva, dipelihara sepenuhnya dari aliran event.
 *
 * `SovereignCurve.Swap` memancarkan `nativeReserveAfter` dan `tokenReserveAfter`,
 * jadi reserve tidak perlu dihitung ulang maupun dibaca dari chain. Itu yang
 * membuat subgraph ini bisa berjalan di atas RPC 0G yang pruned.
 */
export function handleSwap(event: SwapEvent): void {
  const curveId = event.address.toHexString();
  const curve = Curve.load(curveId);
  // Kurva selalu dibuat oleh handler factory sebelum template ini hidup, jadi
  // absennya berarti ada yang salah secara mendasar — lebih baik berhenti diam
  // daripada menulis entitas separuh jadi yang nanti dibaca sebagai data.
  if (curve == null) return;

  const priceAfter = priceFrom(event.params.nativeReserveAfter, event.params.tokenReserveAfter);

  // ── Catat swap-nya ───────────────────────────────────────────────────────
  const swap = new Swap(eventId(event));
  swap.curve = curveId;
  swap.project = curve.project;
  swap.trader = event.params.trader;
  swap.recipient = event.params.recipient;
  swap.isBuy = event.params.isBuy;
  swap.amountIn = event.params.amountIn;
  swap.amountOut = event.params.amountOut;
  swap.depthFee = event.params.depthFee;
  swap.creatorFee = event.params.creatorFee;
  swap.treasuryFee = event.params.treasuryFee;
  swap.reserveNativeAfter = event.params.nativeReserveAfter;
  swap.reserveTokenAfter = event.params.tokenReserveAfter;
  swap.priceNativeAfter = priceAfter;
  swap.blockNumber = event.block.number;
  swap.timestamp = event.block.timestamp;
  swap.txHash = event.transaction.hash;
  swap.logIndex = event.logIndex;
  swap.save();

  // ── Keadaan kurva ────────────────────────────────────────────────────────
  curve.reserveNative = event.params.nativeReserveAfter;
  curve.reserveToken = event.params.tokenReserveAfter;
  curve.tokensSold = curve.curveTokens.minus(event.params.tokenReserveAfter);
  curve.spotPriceNative = priceAfter;

  curve.totalDepthFees = curve.totalDepthFees.plus(event.params.depthFee);
  curve.totalCreatorFees = curve.totalCreatorFees.plus(event.params.creatorFee);
  curve.totalTreasuryFees = curve.totalTreasuryFees.plus(event.params.treasuryFee);
  curve.floorPriceNative = floorPrice(curve.virtualNative, curve.totalDepthFees, curve.curveTokens);

  // Volume dicatat dalam native di KEDUA arah: `amountIn` adalah native pada
  // pembelian tetapi token pada penjualan, jadi memakainya begitu saja akan
  // menjumlahkan dua satuan yang berbeda menjadi satu angka tak bermakna.
  const volumeNative = event.params.isBuy ? event.params.amountIn : event.params.amountOut;
  curve.volumeNative = curve.volumeNative.plus(volumeNative);
  curve.swapCount = curve.swapCount.plus(ONE);
  if (event.params.isBuy) {
    curve.buyCount = curve.buyCount.plus(ONE);
  } else {
    curve.sellCount = curve.sellCount.plus(ONE);
  }
  curve.lastSwapTimestamp = event.block.timestamp;
  curve.save();

  // ── Ember harian ─────────────────────────────────────────────────────────
  const d = dayData(curve, event, priceAfter);
  d.volumeNative = d.volumeNative.plus(volumeNative);
  d.swapCount = d.swapCount.plus(ONE);
  d.depthFees = d.depthFees.plus(event.params.depthFee);
  d.creatorFees = d.creatorFees.plus(event.params.creatorFee);
  d.treasuryFees = d.treasuryFees.plus(event.params.treasuryFee);
  d.save();

  const g = globalStats();
  g.totalSwaps = g.totalSwaps.plus(ONE);
  g.totalVolumeNative = g.totalVolumeNative.plus(volumeNative);
  g.totalDepthFees = g.totalDepthFees.plus(event.params.depthFee);
  g.totalCreatorFees = g.totalCreatorFees.plus(event.params.creatorFee);
  g.totalTreasuryFees = g.totalTreasuryFees.plus(event.params.treasuryFee);
  g.lastUpdatedTimestamp = event.block.timestamp;
  g.save();
}

/**
 * Buyback: native dari vault dibelanjakan di kurva, token yang dibeli dibakar.
 *
 * `executeBuyback` menggerakkan reserve tetapi TIDAK memancarkan `Swap`, jadi
 * handler inilah satu-satunya tempat perubahan itu bisa dicatat. Dulu itu masalah
 * besar karena event-nya hanya membawa `(amountIn, tokensBurned)`: reserve harus
 * diturunkan sendiri dengan aritmetika, dan `depthFee` yang ikut mengendap sama
 * sekali tidak bisa diketahui. Akibatnya `totalDepthFees` sengaja dilewati, dan
 * karena lantai harga = (virtualNative + totalDepthFees) / curveTokens, lantai yang
 * ditampilkan akan permanen lebih rendah dari kenyataan dan makin melenceng tiap
 * buyback.
 *
 * Kontraknya sekarang memancarkan `depthFee`, `nativeReserveAfter`, dan
 * `tokenReserveAfter`. Jadi handler ini berhenti menurunkan apa pun dan membaca
 * semuanya langsung dari log, sama seperti `handleSwap` — tidak ada lagi jalan
 * untuk melenceng dari kontrak karena pembulatan, dan lantai harganya benar.
 */
export function handleAutoBuybackExecuted(event: AutoBuybackExecuted): void {
  const curveId = event.address.toHexString();
  const curve = Curve.load(curveId);
  if (curve == null) return;

  const burn = new BuybackBurn(eventId(event));
  burn.curve = curveId;
  burn.amountInNative = event.params.amountIn;
  burn.tokensBurned = event.params.tokensBurned;
  burn.blockNumber = event.block.number;
  burn.timestamp = event.block.timestamp;
  burn.txHash = event.transaction.hash;
  burn.save();

  // Dibaca dari event, bukan dihitung. Persis seperti handleSwap.
  curve.reserveNative = event.params.nativeReserveAfter;
  curve.reserveToken = event.params.tokenReserveAfter;
  curve.tokensSold = curve.curveTokens.minus(event.params.tokenReserveAfter);
  curve.spotPriceNative = priceFrom(
    event.params.nativeReserveAfter,
    event.params.tokenReserveAfter,
  );
  curve.tokensBurned = curve.tokensBurned.plus(event.params.tokensBurned);

  // Fee depth dari pembelian buyback mengendap di kurva seperti fee depth swap
  // biasa, jadi ia mengangkat lantai harga dengan cara yang sama.
  curve.totalDepthFees = curve.totalDepthFees.plus(event.params.depthFee);
  curve.floorPriceNative = floorPrice(curve.virtualNative, curve.totalDepthFees, curve.curveTokens);

  // Kontrak menaikkan swapCount pada buyback, jadi subgraph ikut — kalau tidak,
  // swapCount on-chain dan swapCount di sini akan berbeda selamanya.
  curve.swapCount = curve.swapCount.plus(ONE);
  curve.save();

  const g = globalStats();
  g.totalTokensBurned = g.totalTokensBurned.plus(event.params.tokensBurned);
  g.totalDepthFees = g.totalDepthFees.plus(event.params.depthFee);
  g.totalSwaps = g.totalSwaps.plus(ONE);
  g.lastUpdatedTimestamp = event.block.timestamp;
  g.save();
}

/**
 * Creator menarik fee yang sudah terakumulasi.
 *
 * `totalCreatorFees` (yang pernah diperoleh) dibiarkan apa adanya dan hanya
 * `totalCreatorFeesClaimed` yang bertambah. Keduanya berbeda: selisihnya adalah
 * yang masih bisa diklaim, dan itulah angka yang ingin dilihat creator.
 */
export function handleCreatorFeesClaimed(event: CreatorFeesClaimed): void {
  const curveId = event.address.toHexString();
  const curve = Curve.load(curveId);
  if (curve == null) return;

  const claim = new CreatorFeeClaim(eventId(event));
  claim.curve = curveId;
  claim.to = event.params.to;
  claim.amount = event.params.amount;
  claim.blockNumber = event.block.number;
  claim.timestamp = event.block.timestamp;
  claim.txHash = event.transaction.hash;
  claim.save();

  curve.totalCreatorFeesClaimed = curve.totalCreatorFeesClaimed.plus(event.params.amount);
  curve.save();
}

/**
 * Penguat yang idempoten, bukan sumber utama.
 *
 * `CurveInitialized` dipancarkan di dalam `deployTrinity` SEBELUM factory
 * memancarkan `TrinityProjectDeployed`, jadi ia terjadi sebelum template data
 * source untuk kurva ini dibuat dan biasanya tidak akan tertangkap sama sekali.
 * Keadaan pembuka karena itu diisi oleh handler factory, yang memang membawa
 * `virtualNative` dan `curveTokens` di event-nya sendiri.
 *
 * Handler ini tetap ada supaya kurva yang di-deploy lewat jalur lain — atau
 * ditangkap oleh graph-node yang memproses blok yang sama — tidak terlewat.
 * Ia hanya menulis bila nilainya belum ada, sehingga tidak pernah menimpa
 * keadaan yang sudah benar.
 */
export function handleCurveInitialized(event: CurveInitialized): void {
  const curveId = event.address.toHexString();
  let curve = Curve.load(curveId);
  if (curve == null) {
    curve = new Curve(curveId);
    curve.tokensSold = ZERO;
    curve.depthFeeBps = ZERO;
    curve.creatorFeeBps = ZERO;
    curve.treasuryBuybackBps = ZERO;
    curve.totalDepthFees = ZERO;
    curve.totalCreatorFees = ZERO;
    curve.totalTreasuryFees = ZERO;
    curve.totalCreatorFeesClaimed = ZERO;
    curve.volumeNative = ZERO;
    curve.swapCount = ZERO;
    curve.buyCount = ZERO;
    curve.sellCount = ZERO;
    curve.tokensBurned = ZERO;
    curve.createdAtBlock = event.block.number;
  } else if (curve.initialized) {
    // Sudah lengkap dari handler factory; jangan sentuh.
    return;
  }
  curve.virtualNative = event.params.virtualNative;
  curve.curveTokens = event.params.curveTokens;
  /**
   * Diturunkan, bukan disalin dari `event.params.openingPrice`.
   *
   * Parameter event itu nilai mentah kontrak — wei per 1e18-token — sedangkan
   * field ini kini berupa desimal native-utuh-per-token-utuh, sama seperti
   * `spotPriceNative` di bawahnya. Menyalinnya langsung adalah setengah dari
   * ketidakcocokan satuan 1e18 yang diperbaiki di sini; separuh lainnya ada di
   * handler factory.
   */
  curve.openingPriceNative = priceFrom(event.params.virtualNative, event.params.curveTokens);
  curve.reserveNative = event.params.virtualNative;
  curve.reserveToken = event.params.curveTokens;
  curve.spotPriceNative = priceFrom(event.params.virtualNative, event.params.curveTokens);
  curve.floorPriceNative = floorPrice(event.params.virtualNative, curve.totalDepthFees, event.params.curveTokens);
  curve.initialized = true;
  curve.save();
}
