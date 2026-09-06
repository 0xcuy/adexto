import { BigDecimal, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  AgentBinding,
  BuybackBurn,
  CreatorFeeClaim,
  Curve,
  CurveDayData,
  GlobalStats,
  Project,
  ProtocolFeeClaim,
  Swap,
} from "../generated/schema";

/**
 * Pembantu bersama untuk kedua mapping.
 *
 * ATURAN YANG MENGIKAT SELURUH BERKAS DI DIREKTORI INI
 *
 * Tidak ada `.bind()` dan tidak ada `try_*` di mapping mana pun. RPC publik 0G
 * berjalan pruned — `eth_getBalance` gagal dengan `missing trie node` bahkan
 * 1.000 blok ke belakang — jadi setiap panggilan fungsi view akan mati begitu
 * subgraph mengejar dari startBlock. Semua yang dibutuhkan sudah dipancarkan oleh
 * event, jadi ini bukan pengorbanan; ia hanya harus dijaga.
 */

export const ZERO = BigInt.fromI32(0);
export const ONE = BigInt.fromI32(1);
export const ZERO_DEC = BigDecimal.fromString("0");
/** 1e18, untuk menyatakan harga dalam skala yang sama seperti kontrak. */
export const WAD = BigInt.fromString("1000000000000000000");
export const DAY = BigInt.fromI32(86400);

/**
 * Harga = reserveNative / reserveToken, sebagai BigDecimal.
 *
 * Pembagian dilakukan di BigDecimal, bukan BigInt: harga token di kurva ini
 * rutin berada di orde 1e-9 native, dan pembagian bilangan bulat akan
 * membulatkannya menjadi nol — yang berarti setiap grafik menjadi garis datar di
 * nol tanpa satu pun galat muncul.
 */
export function priceFrom(reserveNative: BigInt, reserveToken: BigInt): BigDecimal {
  if (reserveToken.equals(ZERO)) return ZERO_DEC;
  return reserveNative.toBigDecimal().div(reserveToken.toBigDecimal());
}

/**
 * Lantai harga: harga yang tercapai bila SETIAP token beredar dijual kembali,
 * yaitu (virtualNative + fee depth terkumpul) / curveTokens.
 *
 * Ini properti yang membedakan kurva ini — lantainya naik monoton seiring volume
 * karena irisan depth mengendap di dalam. Dihitung di sini supaya setiap klien
 * tidak perlu mengulang rumusnya dan tidak ada yang salah menuliskannya.
 */
export function floorPrice(virtualNative: BigInt, depthFees: BigInt, curveTokens: BigInt): BigDecimal {
  if (curveTokens.equals(ZERO)) return ZERO_DEC;
  return virtualNative.plus(depthFees).toBigDecimal().div(curveTokens.toBigDecimal());
}

export function globalStats(): GlobalStats {
  let g = GlobalStats.load("global");
  if (g == null) {
    g = new GlobalStats("global");
    g.totalProjects = ZERO;
    g.totalCurves = ZERO;
    g.totalSwaps = ZERO;
    g.totalVolumeNative = ZERO;
    g.totalDepthFees = ZERO;
    g.totalCreatorFees = ZERO;
    g.totalTreasuryFees = ZERO;
    g.totalProtocolFees = ZERO;
    g.totalTokensBurned = ZERO;
    g.lastUpdatedTimestamp = ZERO;
  }
  return g as GlobalStats;
}

/** VERSION kontrak per generasi, supaya string-nya hanya ditulis sekali. */
export const V_0_10_0 = "0.10.0";
export const V_0_11_0 = "0.11.0";

/**
 * Ember harian untuk satu kurva.
 *
 * `open` hanya ditulis saat ember dibuat, `high`/`low` diperluas, `close` selalu
 * ditimpa. Itu membuat lilinnya konsisten dengan urutan swap sesungguhnya alih-alih
 * dengan urutan pembacaan klien.
 */
export function dayData(curve: Curve, event: ethereum.Event, priceAfter: BigDecimal): CurveDayData {
  const dayStart = event.block.timestamp.div(DAY).times(DAY);
  const id = curve.id + "-" + dayStart.toString();

  let d = CurveDayData.load(id);
  if (d == null) {
    d = new CurveDayData(id);
    d.curve = curve.id;
    d.dayStartTimestamp = dayStart;
    d.volumeNative = ZERO;
    d.swapCount = ZERO;
    d.openPriceNative = priceAfter;
    d.highPriceNative = priceAfter;
    d.lowPriceNative = priceAfter;
    d.depthFees = ZERO;
    d.creatorFees = ZERO;
    d.treasuryFees = ZERO;
    d.protocolFees = ZERO;
  }
  if (priceAfter.gt(d.highPriceNative)) d.highPriceNative = priceAfter;
  // Nol bukan harga; ia hanya berarti reserve token kosong. Membiarkannya masuk
  // sebagai `low` akan menjatuhkan setiap lilin ke nol.
  if (priceAfter.gt(ZERO_DEC) && (d.lowPriceNative.equals(ZERO_DEC) || priceAfter.lt(d.lowPriceNative))) {
    d.lowPriceNative = priceAfter;
  }
  d.closePriceNative = priceAfter;
  return d as CurveDayData;
}

/** Id log yang stabil: satu tx bisa memuat beberapa swap. */
export function eventId(event: ethereum.Event): string {
  return event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
}

export function toBytes(value: Bytes): Bytes {
  return value;
}

/**
 * ─── SATU IMPLEMENTASI UNTUK DUA GENERASI ────────────────────────────────────
 *
 * Kurva 0.10.0 dan 0.11.0 hidup berdampingan. Yang kedua menambah satu kaki fee,
 * sehingga `Swap`-nya punya field tambahan dan karena itu tanda tangan serta
 * `topic0` yang berbeda. graph-node memerlukan dua data source dengan dua ABI dan
 * dua handler; tidak ada cara menghindari itu.
 *
 * Yang BISA dihindari adalah dua salinan logikanya. Tipe event yang dihasilkan
 * codegen berbeda kelas, jadi handler-nya tidak bisa berbagi tanda tangan — tetapi
 * begitu parameternya dibongkar menjadi nilai biasa, sisanya identik. Fungsi di
 * bawah memegang logika itu satu kali, dan tiap handler hanya menjadi adaptor tipis
 * yang membongkar event-nya lalu memanggil ke sini.
 *
 * Alasannya bukan keindahan. Dua salinan berarti perbaikan yang hanya diterapkan di
 * salah satunya, dan bug seperti itu tidak menimbulkan galat — ia hanya membuat satu
 * generasi pasar melaporkan angka yang sedikit berbeda dari generasi lainnya, tanpa
 * ada yang tahu mana yang benar.
 */

/** Keadaan pembuka sebuah kurva, dari event factory-nya. */
export function applyLaunch(
  curveId: string,
  tokenId: string,
  curveVersion: string,
  virtualNative: BigInt,
  curveTokens: BigInt,
  depthFeeBps: BigInt,
  creatorFeeBps: BigInt,
  treasuryBuybackBps: BigInt,
  protocolFeeBps: BigInt,
  blockNumber: BigInt,
): void {
  let curve = Curve.load(curveId);
  if (curve == null) {
    curve = new Curve(curveId);
  }
  curve.curveVersion = curveVersion;
  curve.virtualNative = virtualNative;
  curve.curveTokens = curveTokens;
  curve.openingPriceNative = priceFrom(virtualNative, curveTokens);

  // Native nyata mulai dari nol; sisi native kurva SELURUHNYA virtual di
  // pembukaan. Itulah alasan sebuah peluncuran tidak butuh setoran.
  curve.reserveNative = virtualNative;
  curve.reserveToken = curveTokens;
  curve.tokensSold = ZERO;
  curve.spotPriceNative = priceFrom(virtualNative, curveTokens);

  curve.depthFeeBps = depthFeeBps;
  curve.creatorFeeBps = creatorFeeBps;
  curve.treasuryBuybackBps = treasuryBuybackBps;
  curve.protocolFeeBps = protocolFeeBps;

  curve.totalDepthFees = ZERO;
  curve.totalCreatorFees = ZERO;
  curve.totalTreasuryFees = ZERO;
  curve.totalCreatorFeesClaimed = ZERO;
  curve.totalProtocolFees = ZERO;
  curve.totalProtocolFeesClaimed = ZERO;
  curve.volumeNative = ZERO;
  curve.swapCount = ZERO;
  curve.buyCount = ZERO;
  curve.sellCount = ZERO;
  curve.tokensBurned = ZERO;
  curve.floorPriceNative = floorPrice(virtualNative, ZERO, curveTokens);

  curve.initialized = true;
  curve.createdAtBlock = blockNumber;
  curve.project = tokenId;
  curve.save();
}

/**
 * Satu fill.
 *
 * `protocolFee` DENGAN SENGAJA tidak ikut ke `totalDepthFees`. Irisan depth
 * mengendap di kurva dan karena itu mengangkat lantai harga; irisan protokol
 * meninggalkan kurva. Menjumlahkan keduanya akan melaporkan lantai yang lebih
 * tinggi daripada yang benar-benar bisa dibayar kurva — bohong yang paling halus,
 * karena angkanya tetap masuk akal.
 */
export function applySwap(
  curveId: string,
  event: ethereum.Event,
  trader: Bytes,
  recipient: Bytes,
  isBuy: boolean,
  amountIn: BigInt,
  amountOut: BigInt,
  depthFee: BigInt,
  creatorFee: BigInt,
  treasuryFee: BigInt,
  protocolFee: BigInt,
  nativeReserveAfter: BigInt,
  tokenReserveAfter: BigInt,
): void {
  const curve = Curve.load(curveId);
  // Kurva selalu dibuat oleh handler factory sebelum template ini hidup, jadi
  // absennya berarti ada yang salah secara mendasar — lebih baik berhenti diam
  // daripada menulis entitas separuh jadi yang nanti dibaca sebagai data.
  if (curve == null) return;

  const priceAfter = priceFrom(nativeReserveAfter, tokenReserveAfter);

  const swap = new Swap(eventId(event));
  swap.curve = curveId;
  swap.project = curve.project;
  swap.trader = trader;
  swap.recipient = recipient;
  swap.isBuy = isBuy;
  swap.amountIn = amountIn;
  swap.amountOut = amountOut;
  swap.depthFee = depthFee;
  swap.creatorFee = creatorFee;
  swap.treasuryFee = treasuryFee;
  swap.protocolFee = protocolFee;
  swap.reserveNativeAfter = nativeReserveAfter;
  swap.reserveTokenAfter = tokenReserveAfter;
  swap.priceNativeAfter = priceAfter;
  swap.blockNumber = event.block.number;
  swap.timestamp = event.block.timestamp;
  swap.txHash = event.transaction.hash;
  swap.logIndex = event.logIndex;
  swap.save();

  curve.reserveNative = nativeReserveAfter;
  curve.reserveToken = tokenReserveAfter;
  curve.tokensSold = curve.curveTokens.minus(tokenReserveAfter);
  curve.spotPriceNative = priceAfter;

  curve.totalDepthFees = curve.totalDepthFees.plus(depthFee);
  curve.totalCreatorFees = curve.totalCreatorFees.plus(creatorFee);
  curve.totalTreasuryFees = curve.totalTreasuryFees.plus(treasuryFee);
  curve.totalProtocolFees = curve.totalProtocolFees.plus(protocolFee);
  curve.floorPriceNative = floorPrice(curve.virtualNative, curve.totalDepthFees, curve.curveTokens);

  // Volume dicatat dalam native di KEDUA arah: `amountIn` adalah native pada
  // pembelian tetapi token pada penjualan, jadi memakainya begitu saja akan
  // menjumlahkan dua satuan yang berbeda menjadi satu angka tak bermakna.
  const volumeNative = isBuy ? amountIn : amountOut;
  curve.volumeNative = curve.volumeNative.plus(volumeNative);
  curve.swapCount = curve.swapCount.plus(ONE);
  if (isBuy) {
    curve.buyCount = curve.buyCount.plus(ONE);
  } else {
    curve.sellCount = curve.sellCount.plus(ONE);
  }
  curve.lastSwapTimestamp = event.block.timestamp;
  curve.save();

  const d = dayData(curve as Curve, event, priceAfter);
  d.volumeNative = d.volumeNative.plus(volumeNative);
  d.swapCount = d.swapCount.plus(ONE);
  d.depthFees = d.depthFees.plus(depthFee);
  d.creatorFees = d.creatorFees.plus(creatorFee);
  d.treasuryFees = d.treasuryFees.plus(treasuryFee);
  d.protocolFees = d.protocolFees.plus(protocolFee);
  d.save();

  const g = globalStats();
  g.totalSwaps = g.totalSwaps.plus(ONE);
  g.totalVolumeNative = g.totalVolumeNative.plus(volumeNative);
  g.totalDepthFees = g.totalDepthFees.plus(depthFee);
  g.totalCreatorFees = g.totalCreatorFees.plus(creatorFee);
  g.totalTreasuryFees = g.totalTreasuryFees.plus(treasuryFee);
  g.totalProtocolFees = g.totalProtocolFees.plus(protocolFee);
  g.lastUpdatedTimestamp = event.block.timestamp;
  g.save();
}

/** Buyback: native dari vault dibelanjakan di kurva, token yang dibeli dibakar. */
export function applyBuyback(
  curveId: string,
  event: ethereum.Event,
  amountIn: BigInt,
  tokensBurned: BigInt,
  depthFee: BigInt,
  nativeReserveAfter: BigInt,
  tokenReserveAfter: BigInt,
): void {
  const curve = Curve.load(curveId);
  if (curve == null) return;

  const burn = new BuybackBurn(eventId(event));
  burn.curve = curveId;
  burn.amountInNative = amountIn;
  burn.tokensBurned = tokensBurned;
  burn.blockNumber = event.block.number;
  burn.timestamp = event.block.timestamp;
  burn.txHash = event.transaction.hash;
  burn.save();

  // Dibaca dari event, bukan dihitung.
  curve.reserveNative = nativeReserveAfter;
  curve.reserveToken = tokenReserveAfter;
  curve.tokensSold = curve.curveTokens.minus(tokenReserveAfter);
  curve.spotPriceNative = priceFrom(nativeReserveAfter, tokenReserveAfter);
  curve.tokensBurned = curve.tokensBurned.plus(tokensBurned);

  // Fee depth dari pembelian buyback mengendap di kurva seperti fee depth swap
  // biasa, jadi ia mengangkat lantai harga dengan cara yang sama.
  curve.totalDepthFees = curve.totalDepthFees.plus(depthFee);
  curve.floorPriceNative = floorPrice(curve.virtualNative, curve.totalDepthFees, curve.curveTokens);

  // Kontrak menaikkan swapCount pada buyback, jadi subgraph ikut — kalau tidak,
  // swapCount on-chain dan swapCount di sini akan berbeda selamanya.
  curve.swapCount = curve.swapCount.plus(ONE);
  curve.save();

  const g = globalStats();
  g.totalTokensBurned = g.totalTokensBurned.plus(tokensBurned);
  g.totalDepthFees = g.totalDepthFees.plus(depthFee);
  g.totalSwaps = g.totalSwaps.plus(ONE);
  g.lastUpdatedTimestamp = event.block.timestamp;
  g.save();
}

/**
 * Creator menarik fee yang sudah terakumulasi.
 *
 * `totalCreatorFees` (yang pernah diperoleh) dibiarkan apa adanya dan hanya
 * `totalCreatorFeesClaimed` yang bertambah. Selisihnya adalah yang masih bisa
 * diklaim, dan itulah angka yang ingin dilihat creator.
 */
export function applyCreatorClaim(
  curveId: string,
  event: ethereum.Event,
  to: Bytes,
  amount: BigInt,
): void {
  const curve = Curve.load(curveId);
  if (curve == null) return;

  const claim = new CreatorFeeClaim(eventId(event));
  claim.curve = curveId;
  claim.to = to;
  claim.amount = amount;
  claim.blockNumber = event.block.number;
  claim.timestamp = event.block.timestamp;
  claim.txHash = event.transaction.hash;
  claim.save();

  curve.totalCreatorFeesClaimed = curve.totalCreatorFeesClaimed.plus(amount);
  curve.save();
}

/**
 * Penarikan fee protokol. Hanya ada di 0.11.0.
 *
 * `caller` disimpan di samping `to` karena `claimProtocolFees()` tanpa izin:
 * keduanya boleh berbeda, dan menyimpan keduanya adalah satu-satunya cara
 * memperlihatkan bahwa tujuannya tidak bisa dibajak oleh pemanggilnya.
 */
export function applyProtocolClaim(
  curveId: string,
  event: ethereum.Event,
  to: Bytes,
  amount: BigInt,
): void {
  const curve = Curve.load(curveId);
  if (curve == null) return;

  const claim = new ProtocolFeeClaim(eventId(event));
  claim.curve = curveId;
  claim.to = to;
  claim.caller = event.transaction.from;
  claim.amount = amount;
  claim.blockNumber = event.block.number;
  claim.timestamp = event.block.timestamp;
  claim.txHash = event.transaction.hash;
  claim.save();

  curve.totalProtocolFeesClaimed = curve.totalProtocolFeesClaimed.plus(amount);
  curve.save();
}

/**
 * Penguat yang idempoten untuk `CurveInitialized`, bukan sumber utama.
 *
 * Event itu dipancarkan di dalam `deployTrinity` SEBELUM factory memancarkan
 * `TrinityProjectDeployed`, jadi ia terjadi sebelum template data source kurva ini
 * dibuat dan biasanya tidak tertangkap sama sekali. Keadaan pembuka karena itu
 * diisi oleh handler factory, yang memang membawa `virtualNative` dan `curveTokens`
 * di event-nya sendiri. Fungsi ini hanya menutup kasus kurva yang lahir dari jalur
 * lain, dan tidak pernah menimpa keadaan yang sudah lengkap.
 */
export function applyCurveInitialized(
  curveId: string,
  curveVersion: string,
  virtualNative: BigInt,
  curveTokens: BigInt,
  blockNumber: BigInt,
): void {
  let curve = Curve.load(curveId);
  if (curve == null) {
    curve = new Curve(curveId);
    curve.curveVersion = curveVersion;
    curve.tokensSold = ZERO;
    curve.depthFeeBps = ZERO;
    curve.creatorFeeBps = ZERO;
    curve.treasuryBuybackBps = ZERO;
    curve.protocolFeeBps = ZERO;
    curve.totalDepthFees = ZERO;
    curve.totalCreatorFees = ZERO;
    curve.totalTreasuryFees = ZERO;
    curve.totalCreatorFeesClaimed = ZERO;
    curve.totalProtocolFees = ZERO;
    curve.totalProtocolFeesClaimed = ZERO;
    curve.volumeNative = ZERO;
    curve.swapCount = ZERO;
    curve.buyCount = ZERO;
    curve.sellCount = ZERO;
    curve.tokensBurned = ZERO;
    curve.createdAtBlock = blockNumber;
  } else if (curve.initialized) {
    // Sudah lengkap dari handler factory; jangan sentuh.
    return;
  }
  curve.virtualNative = virtualNative;
  curve.curveTokens = curveTokens;
  /**
   * Diturunkan, bukan disalin dari `event.params.openingPrice`. Parameter event itu
   * nilai mentah kontrak — wei per 1e18-token — sedangkan field ini berupa desimal
   * native-utuh-per-token-utuh, sama seperti `spotPriceNative`.
   */
  curve.openingPriceNative = priceFrom(virtualNative, curveTokens);
  curve.reserveNative = virtualNative;
  curve.reserveToken = curveTokens;
  curve.spotPriceNative = priceFrom(virtualNative, curveTokens);
  curve.floorPriceNative = floorPrice(virtualNative, curve.totalDepthFees, curveTokens);
  curve.initialized = true;
  curve.save();
}

/**
 * Bagian `Project` dari sebuah peluncuran, dan penggabungan pengikatan ERC-8004.
 *
 * `AgentBound` dipancarkan factory SEBELUM `TrinityProjectDeployed`, jadi entity
 * bindingnya sudah ada di sini bila peluncuran ini memang punya. Tidak adanya
 * berarti peluncuran tanpa identitas agent, yang merupakan keadaan default.
 *
 * `agentBound` disimpan eksplisit, bukan diturunkan dari `agentId != 0`. Agent id 0
 * adalah agent nyata yang dimiliki seseorang di keempat mainnet, dan kontraknya
 * pernah salah tepat di titik ini sebelum diperbaiki.
 */
export function applyProject(
  tokenId: string,
  curveId: string,
  event: ethereum.Event,
  token: Bytes,
  creator: Bytes,
  name: string,
  symbol: string,
  initialSupply: BigInt,
  curveTokens: BigInt,
  metadataRoot: Bytes,
): void {
  let project = Project.load(tokenId);
  if (project == null) {
    project = new Project(tokenId);
  }
  project.token = token;
  project.curve = curveId;
  project.creator = creator;
  project.name = name;
  project.symbol = symbol;
  project.initialSupply = initialSupply;
  project.curveTokens = curveTokens;
  // Bukan `teeAttestationRoot`: nilainya root penyimpanan 0G DA dari metadata
  // launch, sebuah hash konten — bukan laporan attestation hardware.
  project.metadataRoot = metadataRoot;
  project.createdAtBlock = event.block.number;
  project.createdAtTimestamp = event.block.timestamp;
  project.createdAtTx = event.transaction.hash;

  const binding = AgentBinding.load(tokenId);
  if (binding == null) {
    project.agentBound = false;
  } else {
    project.agentBound = true;
    project.agentId = binding.agentId;
    project.agentRegistry = binding.agentRegistry;
    project.agentOwnerAtLaunch = binding.ownerAtLaunch;
  }
  project.save();

  const g = globalStats();
  g.totalProjects = g.totalProjects.plus(ONE);
  g.totalCurves = g.totalCurves.plus(ONE);
  g.lastUpdatedTimestamp = event.block.timestamp;
  g.save();
}

/** Pengikatan identitas agent ERC-8004, ditulis ke entity sendiri. */
export function applyAgentBound(
  token: Bytes,
  agentId: BigInt,
  agentRegistry: Bytes,
  owner: Bytes,
  event: ethereum.Event,
): void {
  const binding = new AgentBinding(token.toHexString());
  binding.token = token;
  binding.agentId = agentId;
  binding.agentRegistry = agentRegistry;
  binding.ownerAtLaunch = owner;
  binding.boundAtBlock = event.block.number;
  binding.boundAtTx = event.transaction.hash;
  binding.save();
}
