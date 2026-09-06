/**
 * Adaptor untuk AdextoCurve 0.11.0.
 *
 * SATU-SATUNYA alasan berkas ini terpisah dari `curve.ts`: `Swap` di sini punya
 * sebelas field karena `protocolFee` masuk, sehingga `topic0`-nya berbeda dan
 * graph-node memerlukan ABI serta handler sendiri. Logikanya sama dan ada di
 * `shared.ts`.
 *
 * Perhatikan posisi kedua reserve. Di 0.10.0 mereka field ke-9 dan ke-10; di sini
 * ke-10 dan ke-11, karena `protocolFee` menyelip di depan mereka. Pembongkaran di
 * bawah memakai NAMA field, jadi pergeseran itu tidak bisa menyebabkan `protocolFee`
 * terbaca sebagai reserve — kesalahan yang tidak akan memunculkan galat, hanya harga
 * yang meleset beberapa orde besaran.
 */
import {
  AutoBuybackExecuted,
  CreatorFeesClaimed,
  CurveInitialized,
  ProtocolFeesClaimed,
  Swap as SwapEvent,
} from "../generated/templates/AdextoCurve/AdextoCurve";
import {
  V_0_11_0,
  applyBuyback,
  applyCreatorClaim,
  applyCurveInitialized,
  applyProtocolClaim,
  applySwap,
} from "./shared";

export function handleSwap(event: SwapEvent): void {
  applySwap(
    event.address.toHexString(),
    event,
    event.params.trader,
    event.params.recipient,
    event.params.isBuy,
    event.params.amountIn,
    event.params.amountOut,
    event.params.depthFee,
    event.params.creatorFee,
    event.params.treasuryFee,
    event.params.protocolFee,
    event.params.nativeReserveAfter,
    event.params.tokenReserveAfter,
  );
}

export function handleAutoBuybackExecuted(event: AutoBuybackExecuted): void {
  applyBuyback(
    event.address.toHexString(),
    event,
    event.params.amountIn,
    event.params.tokensBurned,
    event.params.depthFee,
    event.params.nativeReserveAfter,
    event.params.tokenReserveAfter,
  );
}

export function handleCreatorFeesClaimed(event: CreatorFeesClaimed): void {
  applyCreatorClaim(event.address.toHexString(), event, event.params.to, event.params.amount);
}

/**
 * Hanya ada di generasi ini. Tanpa handler ini, `totalProtocolFees` akan terus naik
 * sementara `totalProtocolFeesClaimed` tetap nol — jadi situs akan melaporkan fee
 * yang belum ditarik padahal sudah masuk ke treasury.
 */
export function handleProtocolFeesClaimed(event: ProtocolFeesClaimed): void {
  applyProtocolClaim(event.address.toHexString(), event, event.params.to, event.params.amount);
}

export function handleCurveInitialized(event: CurveInitialized): void {
  applyCurveInitialized(
    event.address.toHexString(),
    V_0_11_0,
    event.params.virtualNative,
    event.params.curveTokens,
    event.block.number,
  );
}
