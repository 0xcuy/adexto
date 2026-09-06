/**
 * Adaptor untuk AdextoFactory 0.11.0.
 *
 * Data source kedua, DITAMBAHKAN di samping yang 0.10.0 dan bukan menggantikannya.
 * Kedua factory hidup permanen: bytecode tidak bisa diubah, jadi pasar yang sudah
 * lahir dari factory lama tetap lahir dari sana selamanya dan tetap harus terindeks.
 *
 * `TrinityProjectDeployed` dan `AgentBound` sengaja dibuat bertanda tangan IDENTIK
 * dengan 0.10.0 di kontraknya, jadi handler-nya bisa membongkar field yang sama. Yang
 * benar-benar berbeda hanya `Swap` di kurvanya, ditangani di `curve-v11.ts`.
 *
 * Kaki protokol TIDAK ikut di event factory — ia konstanta di factory dan immutable
 * di tiap kurva. Menambahkannya ke event akan mengubah tanda tangannya dan membuat
 * setiap mapping subgraph yang sudah ada berhenti cocok, ditukar dengan mengulang
 * nilai yang sudah bisa dibaca. Jadi nilainya ditulis di sini, bersumber dari
 * `PROTOCOL_FEE_BPS` di kontrak.
 */
import { BigInt } from "@graphprotocol/graph-ts";
import { AgentBound, TrinityProjectDeployed } from "../generated/AdextoFactory/AdextoFactory";
import { AdextoCurve as AdextoCurveTemplate } from "../generated/templates";
import { V_0_11_0, applyAgentBound, applyLaunch, applyProject } from "./shared";

/**
 * `PROTOCOL_FEE_BPS` di AdextoFactory 0.11.0.
 *
 * Ditulis sebagai konstanta, bukan dibaca lewat `.bind()`, karena aturan direktori
 * ini melarang panggilan view: RPC publik 0G berjalan pruned dan setiap eth_call
 * akan mati begitu subgraph mengejar dari startBlock. Ia konstanta `public constant`
 * di kontrak, jadi tidak ada keadaan yang bisa membuatnya berbeda per kurva —
 * dan `scripts/verify-subgraph.ts` membandingkannya dengan chain.
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
    V_0_11_0,
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
