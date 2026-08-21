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
 * Buyback agen: native dari vault dibelanjakan di kurva, token yang dibeli dibakar.
 *
 * INI JEBAKAN PALING HALUS DI SELURUH SUBGRAPH INI.
 *
 * `executeBuyback` menggerakkan reserve tetapi TIDAK memancarkan `Swap` — ia hanya
 * memancarkan `AutoBuybackExecuted(amountIn, tokensBurned)`, yang tidak membawa
 * reserve sesudahnya. Jadi kalau handler ini hanya mencatat pembakarannya, reserve
 * dan harga kurva akan basi sampai swap berikutnya lewat, dan grafik akan
 * memperlihatkan lompatan harga yang tidak pernah terjadi.
 *
 * Perubahannya bisa diturunkan tepat dari kontrak:
 *   treasuryNative -= nativeAmount;  _curveNative += nativeAmount
 *      -> reserveNative bertambah `amountIn`
 *   _tokensSold += tokensOut
 *      -> reserveToken berkurang `tokensBurned`, tokensSold bertambah segitu
 *
 * Fee depth dari pembelian itu juga mengendap, tetapi `AutoBuybackExecuted` tidak
 * memancarkannya, jadi `totalDepthFees` sengaja TIDAK disentuh di sini. Menebaknya
 * akan membuat lantai harga bergeser tanpa dasar; membiarkannya berarti lantai
 * yang dilaporkan sedikit konservatif, dan itu arah galat yang benar.
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

  curve.reserveNative = curve.reserveNative.plus(event.params.amountIn);
  curve.reserveToken = curve.reserveToken.minus(event.params.tokensBurned);
  curve.tokensSold = curve.tokensSold.plus(event.params.tokensBurned);
  curve.spotPriceNative = priceFrom(curve.reserveNative, curve.reserveToken);
  curve.tokensBurned = curve.tokensBurned.plus(event.params.tokensBurned);
  curve.save();

  const g = globalStats();
  g.totalTokensBurned = g.totalTokensBurned.plus(event.params.tokensBurned);
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
  curve.openingPriceNative = event.params.openingPrice;
  curve.reserveNative = event.params.virtualNative;
  curve.reserveToken = event.params.curveTokens;
  curve.spotPriceNative = priceFrom(event.params.virtualNative, event.params.curveTokens);
  curve.floorPriceNative = floorPrice(event.params.virtualNative, curve.totalDepthFees, event.params.curveTokens);
  curve.initialized = true;
  curve.save();
}
