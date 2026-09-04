import {
  AgentBound,
  TrinityProjectDeployed,
} from "../generated/AdextoCurveFactory/AdextoCurveFactory";
import { SovereignCurve as SovereignCurveTemplate } from "../generated/templates";
import { AgentBinding, Curve, Project } from "../generated/schema";
// WAD dilepas: satu-satunya pemakaiannya adalah rumus harga pembukaan mentah yang
// menyebabkan ketidakcocokan satuan 1e18, dan itu kini memakai `priceFrom`.
import { ONE, ZERO, floorPrice, globalStats, priceFrom } from "./shared";

/**
 * Pengikatan identitas agent ERC-8004.
 *
 * URUTANNYA BERLAWANAN DENGAN DUGAAN, DAN ITU MENENTUKAN BENTUK HANDLER INI
 *
 * `AgentBound` dipancarkan factory SEBELUM `TrinityProjectDeployed` — baris 330
 * dan 334 di AdextoCurveFactory.sol. Jadi ketika handler ini berjalan, entity
 * `Project` untuk token itu BELUM ADA. Membuatnya di sini secara sebagian akan
 * melanggar field non-null miliknya (name, symbol, curve, dan seterusnya), dan
 * kegagalan seperti itu menghentikan seluruh indexer.
 *
 * Karena itu pengikatannya ditulis ke entity sendiri, dan
 * `handleTrinityProjectDeployed` yang menggabungkannya beberapa log kemudian di
 * transaksi yang sama. Ini kembaran dari jebakan `CurveInitialized` yang
 * dijelaskan di bawah — dua kali sudah, jadi urutan event di factory ini memang
 * layak dicurigai, bukan diasumsikan.
 */
export function handleAgentBound(event: AgentBound): void {
  const id = event.params.token.toHexString();
  const binding = new AgentBinding(id);
  binding.token = event.params.token;
  binding.agentId = event.params.agentId;
  binding.agentRegistry = event.params.agentRegistry;
  binding.ownerAtLaunch = event.params.owner;
  binding.boundAtBlock = event.block.number;
  binding.boundAtTx = event.transaction.hash;
  binding.save();
}

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
  /**
   * Harga pembukaan memakai `priceFrom`, satuan yang sama dengan
   * `spotPriceNative` dan `floorPriceNative`.
   *
   * Sebelumnya di sini rumus mentah kontrak (`virtualNative * 1e18 / curveTokens`)
   * disimpan apa adanya sebagai BigInt — benar sebagai nilai kontrak, tapi itu
   * wei per 1e18-token, sementara dua field harga di sebelahnya berupa desimal
   * native-utuh-per-token-utuh. Selisihnya 1e18 di dalam satu entity.
   *
   * Pada t=0 reserve native kurva SELURUHNYA virtual dan belum ada token terjual,
   * jadi harga pembukaan memang persis sama dengan spot saat itu — memakai fungsi
   * yang sama membuat keduanya tidak bisa lagi berbeda satuan.
   */
  curve.openingPriceNative = priceFrom(event.params.virtualNative, event.params.curveTokens);

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

  /**
   * Gabungkan pengikatan ERC-8004, bila peluncuran ini punya.
   *
   * `handleAgentBound` sudah berjalan lebih dulu di transaksi yang SAMA — factory
   * memancarkan `AgentBound` sebelum `TrinityProjectDeployed` — jadi entity-nya
   * sudah ada bila memang ada. Tidak adanya entity berarti peluncuran ini tanpa
   * identitas agent, yang merupakan keadaan default.
   *
   * `agentBound` disimpan eksplisit, bukan diturunkan dari `agentId != 0`. Agent
   * id 0 adalah agent nyata yang dimiliki seseorang di keempat mainnet, dan
   * kontraknya pernah salah tepat di titik ini sebelum diperbaiki — jadi bentuk
   * datanya di sini tidak boleh mengulang kesalahan yang sama.
   */
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
