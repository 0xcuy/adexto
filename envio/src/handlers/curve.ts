/**
 * AdextoCurve 0.11.0 (Monad) dan 1.0.0 (Monad, Robinhood, Arc), event yang sama. Kontraknya didaftarkan dinamis oleh `factory.ts`, jadi tidak ada satu
 * pun alamat kurva di `config.yaml`.
 *
 * Perhatikan bahwa setiap field dibongkar memakai NAMA, bukan posisi. Di kurva 0.10.0 kedua
 * reserve adalah parameter ke-9 dan ke-10; di 0.11.0 mereka ke-10 dan ke-11 karena
 * `protocolFee` menyelip di depannya. Pembongkaran berbasis nama membuat pergeseran itu
 * tidak bisa menyebabkan `protocolFee` terbaca sebagai reserve — kesalahan yang tidak akan
 * memunculkan galat, hanya harga yang meleset beberapa orde besaran.
 *
 * Id kurva adalah `chainScopedId(event.chainId, event.srcAddress)`, bentuk yang sama dengan
 * `Project.curve_id` yang ditulis handler factory. Alamat saja tidak cukup: kurva di Arc dan di
 * Robinhood Chain bisa beralamat sama (lihat `chainScopedId` di `shared.ts`).
 */
import { indexer } from "envio";
import {
  applyBuyback,
  applyCreatorClaim,
  applyCurveInitialized,
  applyProtocolClaim,
  applySwap,
  chainScopedId,
  metaOf,
} from "../shared";

indexer.onEvent(
  { contract: "AdextoCurve", event: "CurveInitialized" },
  async ({ event, context }) => {
    await applyCurveInitialized(context, {
      curveId: chainScopedId(event.chainId, event.srcAddress),
      curveAddress: event.srcAddress,
      virtualNative: event.params.virtualNative,
      curveTokens: event.params.curveTokens,
      // `event.params.openingPrice` SENGAJA tidak dipakai: ia wei per 1e18-token, satuan
      // yang berbeda 1e18 dari field harga di skema. Nilainya diturunkan di `shared.ts`.
      blockNumber: BigInt(event.block.number),
      chainId: event.chainId,
    });
  },
);

indexer.onEvent({ contract: "AdextoCurve", event: "Swap" }, async ({ event, context }) => {
  await applySwap(context, {
    curveId: chainScopedId(event.chainId, event.srcAddress),
    meta: metaOf(event),
    trader: event.params.trader,
    recipient: event.params.recipient,
    isBuy: event.params.isBuy,
    amountIn: event.params.amountIn,
    amountOut: event.params.amountOut,
    depthFee: event.params.depthFee,
    creatorFee: event.params.creatorFee,
    treasuryFee: event.params.treasuryFee,
    protocolFee: event.params.protocolFee,
    nativeReserveAfter: event.params.nativeReserveAfter,
    tokenReserveAfter: event.params.tokenReserveAfter,
  });
});

indexer.onEvent(
  { contract: "AdextoCurve", event: "AutoBuybackExecuted" },
  async ({ event, context }) => {
    await applyBuyback(context, {
      curveId: chainScopedId(event.chainId, event.srcAddress),
      meta: metaOf(event),
      amountIn: event.params.amountIn,
      tokensBurned: event.params.tokensBurned,
      depthFee: event.params.depthFee,
      nativeReserveAfter: event.params.nativeReserveAfter,
      tokenReserveAfter: event.params.tokenReserveAfter,
    });
  },
);

indexer.onEvent(
  { contract: "AdextoCurve", event: "CreatorFeesClaimed" },
  async ({ event, context }) => {
    await applyCreatorClaim(context, {
      curveId: chainScopedId(event.chainId, event.srcAddress),
      meta: metaOf(event),
      to: event.params.to,
      amount: event.params.amount,
    });
  },
);

/**
 * Hanya ada di generasi 0.11.0. Tanpa handler ini `totalProtocolFees` akan terus naik
 * sementara `totalProtocolFeesClaimed` tetap nol — jadi situs akan melaporkan fee yang
 * belum ditarik padahal sudah masuk ke treasury.
 */
indexer.onEvent(
  { contract: "AdextoCurve", event: "ProtocolFeesClaimed" },
  async ({ event, context }) => {
    await applyProtocolClaim(context, {
      curveId: chainScopedId(event.chainId, event.srcAddress),
      meta: metaOf(event),
      to: event.params.to,
      amount: event.params.amount,
    });
  },
);
