/**
 * Adaptor untuk AdextoFactory 1.0.0 (ADEXTO v1).
 *
 * Data source ketiga, DITAMBAHKAN di samping 0.10.0 dan 0.11.0, bukan menggantikannya.
 * Ketiga factory hidup permanen: bytecode tidak bisa diubah, jadi pasar yang lahir dari
 * factory lama tetap lahir dari sana selamanya dan tetap harus terindeks.
 *
 * Event v1 identik dengan 0.11.0, di factory maupun di kurva: `TrinityProjectDeployed`,
 * `AgentBound`, dan di kurva `Swap` sebelas field, `AutoBuybackExecuted`, kedua klaim
 * fee dan `CurveInitialized`. Karena itu data source ini memakai ABI 0.11.0 dan template
 * `AdextoCurve` yang sama. Satu-satunya yang berbeda di sini adalah `curveVersion`.
 *
 * Yang berubah di v1 adalah ARTI fee, bukan bentuk event-nya: kaki protokol diambil dari
 * dalam total, bukan ditambahkan di atasnya. Factory menghitung
 * `depthFeeBps = swapFeeBps - creatorShareBps - treasuryShareBps - PROTOCOL_FEE_BPS`
 * dan memancarkan nilai yang sudah dipotong itu, jadi ketiga field event tetap bisa
 * dipakai apa adanya, sama seperti 0.11.0.
 */
import { BigInt } from "@graphprotocol/graph-ts";
import { AgentBound, TrinityProjectDeployed } from "../generated/AdextoFactoryV1/AdextoFactory";
import { AdextoCurve as AdextoCurveTemplate } from "../generated/templates";
import { V_1_0_0, applyAgentBound, applyLaunch, applyProject } from "./shared";

/**
 * `PROTOCOL_FEE_BPS` di AdextoFactory 1.0.0, `public constant` di kontrak.
 *
 * Konstanta, bukan `.bind()`, karena aturan direktori ini melarang panggilan view.
 * `scripts/verify-subgraph.mts` membandingkannya dengan factory v1 di chain.
 */
const PROTOCOL_FEE_BPS = BigInt.fromI32(10);

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
    V_1_0_0,
    event.params.virtualNative,
    event.params.curveTokens,
    event.params.depthFeeBps,
    event.params.creatorFeeBps,
    event.params.treasuryBuybackBps,
    PROTOCOL_FEE_BPS,
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

  AdextoCurveTemplate.create(event.params.curve);
}
