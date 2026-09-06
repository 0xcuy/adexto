/**
 * Adaptor untuk AdextoCurveFactory 0.10.0.
 *
 * Berkas ini dulu memegang seluruh logikanya. Sekarang logikanya ada satu kali di
 * `shared.ts` dan di sini tinggal pembongkaran event — sebab generasi 0.11.0 butuh
 * data source dan ABI sendiri (tanda tangan `Swap`-nya berbeda), dan dua salinan
 * logika berarti perbaikan yang hanya sampai ke salah satunya.
 *
 * Yang membuat berkas ini tetap harus ada: factory 0.10.0 sudah di chain di empat
 * mainnet dan membuat pasar yang masih diperdagangkan. Bytecode-nya tidak bisa
 * diubah, jadi indexnya harus terus berjalan apa pun yang terjadi pada generasi
 * berikutnya.
 *
 * URUTAN EVENT DI FACTORY INI BERLAWANAN DENGAN DUGAAN
 *
 * `AgentBound` dipancarkan SEBELUM `TrinityProjectDeployed`, dan `CurveInitialized`
 * bahkan lebih dulu lagi — di dalam `deployTrinity`, sebelum template data source
 * kurvanya ada. Jadi keadaan pembuka kurva diisi dari event factory, bukan dari
 * `CurveInitialized`; kalau tidak, setiap kurva lahir dengan reserve nol dan grafik
 * datar tanpa satu pun galat. Dua kali sudah terbukti, jadi urutan di factory ini
 * memang layak dicurigai, bukan diasumsikan.
 */
import {
  AgentBound,
  TrinityProjectDeployed,
} from "../generated/AdextoCurveFactory/AdextoCurveFactory";
import { SovereignCurve as SovereignCurveTemplate } from "../generated/templates";
import { ZERO, V_0_10_0, applyAgentBound, applyLaunch, applyProject } from "./shared";

export function handleAgentBound(event: AgentBound): void {
  applyAgentBound(
    event.params.token,
    event.params.agentId,
    event.params.agentRegistry,
    event.params.owner,
    event,
  );
}

export function handleTrinityProjectDeployed(event: TrinityProjectDeployed): void {
  const curveId = event.params.curve.toHexString();
  const tokenId = event.params.token.toHexString();

  applyLaunch(
    curveId,
    tokenId,
    V_0_10_0,
    event.params.virtualNative,
    event.params.curveTokens,
    event.params.depthFeeBps,
    event.params.creatorFeeBps,
    event.params.treasuryBuybackBps,
    // Generasi ini tidak punya kaki protokol, dan tidak akan pernah punya: tarifnya
    // immutable per kurva. Nol di sini adalah fakta, bukan nilai bawaan.
    ZERO,
    event.block.number,
  );

  applyProject(
    tokenId,
    curveId,
    event,
    event.params.token,
    event.params.creator,
    event.params.name,
    event.params.symbol,
    event.params.initialSupply,
    event.params.curveTokens,
    event.params.metadataRoot,
  );

  // Template, bukan dataSource statis: alamatnya baru diketahui sekarang.
  SovereignCurveTemplate.create(event.params.curve);
}
