/**
 * AdextoFactory 0.11.0 di Monad mainnet.
 *
 * Dua tanggung jawab, dan urutan di antaranya penting:
 *
 * 1. `contractRegister` memberi tahu indexer bahwa alamat kurva yang baru lahir harus
 *    diikuti. Tanpa ini, seluruh `curve.ts` tidak akan pernah dipanggil — alamat kurva
 *    tidak diketahui saat `config.yaml` ditulis, jadi tidak ada yang bisa dicantumkan di
 *    sana.
 * 2. `onEvent` menulis keadaan pembuka pasar itu.
 *
 * Registrasi berjalan mendahului seluruh handler untuk batch yang sama, jadi ia menangkap
 * juga log dengan `logIndex` lebih kecil di blok yang sama. `CurveInitialized` dipancarkan
 * SEBELUM `TrinityProjectDeployed` di dalam `deployTrinity`, sehingga handler kurva bisa
 * berjalan lebih dulu daripada handler di berkas ini. Itu ditangani di `shared.ts`, yang
 * membuat kedua urutan menghasilkan baris yang sama.
 */
import { indexer } from "envio";
import { applyAgentBound, applyLaunch, applyProject, metaOf } from "../shared";

indexer.contractRegister(
  { contract: "AdextoFactory", event: "TrinityProjectDeployed" },
  // `async` meski tidak ada `await` di dalamnya: registrasi kontrak dituntut
  // mengembalikan Promise, dan tipenya menolak handler sinkron.
  async ({ event, context }) => {
    context.chain.AdextoCurve.add(event.params.curve);
  },
);

/**
 * Pengikatan identitas ERC-8004 untuk sebuah peluncuran.
 *
 * Ditulis ke `AgentBinding`, bukan langsung ke `Project`, karena factory memancarkan event
 * ini SEBELUM `TrinityProjectDeployed`. Saat handler ini berjalan, `Project` belum ada, dan
 * menulis Project separuh jadi akan melanggar kolom non-null miliknya.
 */
indexer.onEvent({ contract: "AdextoFactory", event: "AgentBound" }, async ({ event, context }) => {
  applyAgentBound(context, {
    meta: metaOf(event),
    token: event.params.token,
    agentId: event.params.agentId,
    agentRegistry: event.params.agentRegistry,
    owner: event.params.owner,
  });
});

indexer.onEvent(
  { contract: "AdextoFactory", event: "TrinityProjectDeployed" },
  async ({ event, context }) => {
    const meta = metaOf(event);
    const curveId = event.params.curve;
    const tokenId = event.params.token;

    await applyLaunch(context, {
      curveId,
      tokenId,
      virtualNative: event.params.virtualNative,
      curveTokens: event.params.curveTokens,
      depthFeeBps: event.params.depthFeeBps,
      creatorFeeBps: event.params.creatorFeeBps,
      treasuryBuybackBps: event.params.treasuryBuybackBps,
      blockNumber: meta.blockNumber,
    });

    await applyProject(context, {
      tokenId,
      curveId,
      meta,
      token: event.params.token,
      creator: event.params.creator,
      name: event.params.name,
      symbol: event.params.symbol,
      initialSupply: event.params.initialSupply,
      curveTokens: event.params.curveTokens,
      metadataRoot: event.params.metadataRoot,
    });
  },
);
