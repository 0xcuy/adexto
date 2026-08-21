import { TrinityProjectDeployed } from "../generated/AdextoCurveFactory/AdextoCurveFactory";
import { SovereignCurve as SovereignCurveTemplate } from "../generated/templates";
import { Curve, Project } from "../generated/schema";
import { ONE, ZERO, floorPrice, globalStats, priceFrom, WAD } from "./shared";

/**
 * Satu peluncuran: token + kurva, dari satu transaksi.
 *
 * KENAPA KEADAAN PEMBUKA KURVA DIISI DI SINI, BUKAN DI `CurveInitialized`
 *
 * Ini yang paling mudah salah. Urutan di dalam `deployTrinity` adalah: kurva
 * di-deploy, token di-deploy, `bindToken`, lalu `initializeCurve` — yang
 * memancarkan `CurveInitialized` — dan baru SETELAH itu factory memancarkan
 * `TrinityProjectDeployed`.
 *
 * Artinya `CurveInitialized` sudah terjadi sebelum handler ini berjalan, dan
 * template data source untuk kurva itu belum ada saat event tersebut lewat. Jadi
 * menggantungkan keadaan pembuka pada `CurveInitialized` berarti setiap kurva
 * lahir dengan reserve nol, harga nol, dan grafik datar — tanpa satu pun galat.
 *
 * Untungnya `TrinityProjectDeployed` sendiri sudah membawa semua yang diperlukan:
 * `virtualNative`, `curveTokens`, dan ketiga irisan fee. Jadi kurva dibangun utuh
 * di sini, dan handler `CurveInitialized` hanya bertindak sebagai penguat yang
 * idempoten kalau ternyata ia memang tertangkap.
 */
export function handleTrinityProjectDeployed(event: TrinityProjectDeployed): void {
  const curveId = event.params.curve.toHexString();
  const tokenId = event.params.token.toHexString();

  // ── Kurva ────────────────────────────────────────────────────────────────
  let curve = Curve.load(curveId);
  if (curve == null) {
    curve = new Curve(curveId);
  }
  curve.virtualNative = event.params.virtualNative;
  curve.curveTokens = event.params.curveTokens;
  // Rumus yang sama seperti kontrak: virtualNative * 1e18 / curveTokens.
  curve.openingPriceNative = event.params.curveTokens.equals(ZERO)
    ? ZERO
    : event.params.virtualNative.times(WAD).div(event.params.curveTokens);

  // Native nyata mulai dari nol; sisi native kurva SELURUHNYA virtual di
  // pembukaan. Itulah alasan sebuah peluncuran tidak butuh setoran.
  curve.reserveNative = event.params.virtualNative;
  curve.reserveToken = event.params.curveTokens;
  curve.tokensSold = ZERO;
  curve.spotPriceNative = priceFrom(event.params.virtualNative, event.params.curveTokens);

  curve.depthFeeBps = event.params.depthFeeBps;
  curve.creatorFeeBps = event.params.creatorFeeBps;
  curve.treasuryBuybackBps = event.params.treasuryBuybackBps;

  curve.totalDepthFees = ZERO;
  curve.totalCreatorFees = ZERO;
  curve.totalTreasuryFees = ZERO;
  curve.totalCreatorFeesClaimed = ZERO;
  curve.volumeNative = ZERO;
  curve.swapCount = ZERO;
  curve.buyCount = ZERO;
  curve.sellCount = ZERO;
  curve.tokensBurned = ZERO;
  curve.floorPriceNative = floorPrice(event.params.virtualNative, ZERO, event.params.curveTokens);

  curve.initialized = true;
  curve.createdAtBlock = event.block.number;
  curve.project = tokenId;
  curve.save();

  // ── Proyek ───────────────────────────────────────────────────────────────
  let project = Project.load(tokenId);
  if (project == null) {
    project = new Project(tokenId);
  }
  project.token = event.params.token;
  project.curve = curveId;
  project.creator = event.params.creator;
  project.name = event.params.name;
  project.symbol = event.params.symbol;
  project.initialSupply = event.params.initialSupply;
  project.curveTokens = event.params.curveTokens;
  // Bukan `teeAttestationRoot`: nilainya root penyimpanan 0G DA dari metadata
  // launch, sebuah hash konten — bukan laporan attestation hardware.
  project.metadataRoot = event.params.metadataRoot;
  project.createdAtBlock = event.block.number;
  project.createdAtTimestamp = event.block.timestamp;
  project.createdAtTx = event.transaction.hash;
  project.save();

  // ── Mulai indeks kurva ini ───────────────────────────────────────────────
  // Template, bukan dataSource statis: alamatnya baru diketahui sekarang. Setiap
  // kurva yang diluncurkan sesudah subgraph ini hidup akan terindeks sendiri.
  SovereignCurveTemplate.create(event.params.curve);

  const g = globalStats();
  g.totalProjects = g.totalProjects.plus(ONE);
  g.totalCurves = g.totalCurves.plus(ONE);
  g.lastUpdatedTimestamp = event.block.timestamp;
  g.save();
}
