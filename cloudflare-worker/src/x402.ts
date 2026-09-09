import { ethers } from "ethers";

/**
 * Skema `exact` x402 v2 di Base, memakai EIP-3009 USDC. Ini facilitator-nya.
 *
 * KENAPA MODUL TERPISAH DARI WORKER
 *
 * Jalur pembayaran adalah bagian yang paling tidak boleh dikirim tanpa diuji, dan
 * menguji Worker berarti menjalankan wrangler, mengarahkannya ke RPC, lalu menebak
 * dari jawaban HTTP apa yang gagal di dalam. Logikanya di sini fungsi murni yang
 * menerima `provider`, jadi ia bisa diuji langsung terhadap fork Base berisi USDC
 * SUNGGUHAN — bytecode asli, validasi EIP-3009 asli, tanda tangan asli.
 *
 * KENAPA VOUCHER LAMA DICABUT
 *
 * Worker ini dulu memverifikasi `Voucher(agent string, amount string, nonce uint256)`
 * dengan `verifyingContract` diarahkan ke alamat vault. Tanda tangannya benar-benar
 * diperiksa, jadi bukan bohong — tetapi ia tidak memindahkan uang dan tidak mungkin
 * bisa. Menandatangani pernyataan bahwa Anda berutang 0,005 USDC tidak membuat USDC
 * berpindah; tidak ada kontrak yang pernah melihat tanda tangan itu. Yang membuat
 * pembayaran benar-benar terjadi adalah EIP-3009: pembayar menandatangani
 * `TransferWithAuthorization` yang DIKENALI kontrak USDC, lalu siapa pun boleh
 * mengirimkannya dan token berpindah.
 *
 * KENAPA KUNCI RELAYER DI SINI TIDAK BERBAHAYA
 *
 * `transferWithAuthorization` permissionless dan seluruh isinya sudah ditandatangani
 * pembayar — termasuk `to` dan `value`. Jadi kunci relayer tidak punya wewenang apa
 * pun: ia tidak bisa memindahkan uang siapa pun tanpa tanda tangan mereka, dan tidak
 * bisa mengubah tujuannya. Yang paling buruk yang bisa terjadi kalau kunci itu bocor
 * adalah gasnya terkuras. Sifat yang sama dengan `claimProtocolFees` di kurva.
 */

/** USDC Circle native di Base. Nilai domain diverifikasi terhadap kontraknya. */
export const USDC_BASE = {
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  decimals: 6,
  /** Dipakai sebagai domain EIP-712; `name`/`version` dibaca dari kontrak saat verifikasi. */
  eip712Name: "USD Coin",
  eip712Version: "2",
  chainId: 8453,
  network: "base",
} as const;

export const X402_VERSION = 2;

/** Tipe EIP-3009 persis seperti yang dipakai FiatTokenV2. */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  /** Jumlah dalam satuan terkecil aset. USDC 6 desimal, jadi 5000 = $0,005. */
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { name: string; version: string; transferMethod: "eip3009" };
}

export interface Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: { signature: string; authorization: Authorization };
}

/**
 * Kode `errorReason` yang baku di x402 v2. Dipakai apa adanya supaya klien yang
 * sudah ada bisa menanganinya tanpa mempelajari kosakata khusus kita.
 */
export type X402Error =
  | "insufficient_funds"
  | "invalid_exact_evm_payload_signature"
  | "invalid_exact_evm_payload_authorization_valid_before"
  | "invalid_exact_evm_payload_authorization_valid_after"
  | "invalid_exact_evm_payload_authorization_value_mismatch"
  | "invalid_exact_evm_payload_recipient_mismatch"
  | "invalid_payload"
  | "invalid_network"
  | "invalid_scheme"
  | "invalid_transaction_state"
  | "unexpected_settle_error"
  | "unexpected_verify_error";

export function buildPaymentRequirements(params: {
  resource: string;
  description: string;
  amountAtomic: bigint;
  payTo: string;
  maxTimeoutSeconds?: number;
  /**
   * Aset dan jaringan bisa diganti. Bawaannya USDC di Base.
   *
   * Ada supaya jalur pembayaran bisa diuji terhadap token EIP-3009 yang kita kendalikan
   * — tanpa ini pengujiannya harus memakai USDC mainnet, dan yang teruji hanya jalur yang
   * kebetulan bisa dijangkau. `extra.name`/`extra.version` tetap sekadar petunjuk bagi
   * klien; yang mengikat saat verifikasi adalah nilai yang dibaca dari kontraknya.
   */
  asset?: string;
  network?: string;
  assetName?: string;
  assetVersion?: string;
}): PaymentRequirements {
  return {
    scheme: "exact",
    network: params.network ?? USDC_BASE.network,
    maxAmountRequired: params.amountAtomic.toString(),
    resource: params.resource,
    description: params.description,
    mimeType: "application/json",
    payTo: params.payTo,
    maxTimeoutSeconds: params.maxTimeoutSeconds ?? 300,
    asset: params.asset ?? USDC_BASE.address,
    extra: {
      name: params.assetName ?? USDC_BASE.eip712Name,
      version: params.assetVersion ?? USDC_BASE.eip712Version,
      transferMethod: "eip3009",
    },
  };
}

/** Header `payment-signature` berisi JSON ter-base64. */
export function decodePaymentPayload(header: string): PaymentPayload | null {
  try {
    const raw = typeof atob === "function" ? atob(header) : Buffer.from(header, "base64").toString("utf8");
    const parsed = JSON.parse(raw);
    if (!parsed?.payload?.authorization || !parsed?.payload?.signature) return null;
    return parsed as PaymentPayload;
  } catch {
    return null;
  }
}

export function encodePaymentPayload(p: PaymentPayload): string {
  const raw = JSON.stringify(p);
  return typeof btoa === "function" ? btoa(raw) : Buffer.from(raw, "utf8").toString("base64");
}

export interface VerifyResult {
  isValid: boolean;
  invalidReason?: X402Error;
  detail?: string;
  payer?: string;
}

/**
 * Verifikasi TANPA memindahkan dana. Urutannya disengaja: bentuk dulu, lalu tanda
 * tangan, lalu ketentuan yang ditandatangani, baru keadaan on-chain — supaya kesalahan
 * paling murah dilaporkan lebih dulu dan alasan yang dikembalikan yang paling spesifik.
 */
export async function verifyPayment(params: {
  payload: PaymentPayload;
  requirements: PaymentRequirements;
  provider: ethers.Provider;
  /** Waktu acuan dalam detik. Bisa disuntik agar pengujian tidak bergantung jam. */
  nowSeconds?: number;
}): Promise<VerifyResult> {
  const { payload, requirements, provider } = params;
  const now = BigInt(params.nowSeconds ?? Math.floor(Date.now() / 1000));

  if (payload.scheme !== "exact") return { isValid: false, invalidReason: "invalid_scheme", detail: payload.scheme };
  if (payload.network !== requirements.network) {
    return { isValid: false, invalidReason: "invalid_network", detail: payload.network };
  }

  const a = payload.payload.authorization;
  for (const f of ["from", "to", "value", "validAfter", "validBefore", "nonce"] as const) {
    if (a[f] === undefined || a[f] === null || a[f] === "") {
      return { isValid: false, invalidReason: "invalid_payload", detail: `authorization.${f} kosong` };
    }
  }
  if (!ethers.isAddress(a.from) || !ethers.isAddress(a.to)) {
    return { isValid: false, invalidReason: "invalid_payload", detail: "from/to bukan alamat" };
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(a.nonce)) {
    return { isValid: false, invalidReason: "invalid_payload", detail: "nonce harus bytes32" };
  }

  /**
   * Domain dibaca dari KONTRAKNYA, bukan dari `extra` di permintaan.
   *
   * `extra.name`/`extra.version` datang dari sisi yang sama dengan tanda tangannya, jadi
   * memakainya untuk memverifikasi tanda tangan itu berarti membiarkan pembayar memilih
   * domain yang membuat tanda tangannya lolos. Nilai yang mengikat adalah yang dipakai
   * USDC sendiri saat mengeksekusi, jadi itu yang dibaca.
   */
  const token = new ethers.Contract(
    requirements.asset,
    [
      "function name() view returns (string)",
      "function version() view returns (string)",
      "function balanceOf(address) view returns (uint256)",
      "function authorizationState(address,bytes32) view returns (bool)",
    ],
    provider,
  );
  let domain: ethers.TypedDataDomain;
  try {
    const [name, version, net] = await Promise.all([token.name(), token.version(), provider.getNetwork()]);
    domain = { name, version, chainId: Number(net.chainId), verifyingContract: requirements.asset };
  } catch (e: any) {
    return { isValid: false, invalidReason: "unexpected_verify_error", detail: `domain token tidak terbaca: ${e?.message}` };
  }

  const value = {
    from: a.from,
    to: a.to,
    value: BigInt(a.value),
    validAfter: BigInt(a.validAfter),
    validBefore: BigInt(a.validBefore),
    nonce: a.nonce,
  };

  let recovered: string;
  try {
    recovered = ethers.verifyTypedData(domain, TRANSFER_WITH_AUTHORIZATION_TYPES as any, value, payload.payload.signature);
  } catch (e: any) {
    return { isValid: false, invalidReason: "invalid_exact_evm_payload_signature", detail: e?.message };
  }
  if (recovered.toLowerCase() !== a.from.toLowerCase()) {
    return {
      isValid: false,
      invalidReason: "invalid_exact_evm_payload_signature",
      detail: `ditandatangani ${recovered}, mengaku ${a.from}`,
    };
  }

  // Yang ditandatangani harus sama dengan yang kami iklankan, bukan sekadar sah.
  if (a.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
    return { isValid: false, invalidReason: "invalid_exact_evm_payload_recipient_mismatch", detail: a.to, payer: recovered };
  }
  if (BigInt(a.value) !== BigInt(requirements.maxAmountRequired)) {
    return {
      isValid: false,
      invalidReason: "invalid_exact_evm_payload_authorization_value_mismatch",
      detail: `ditandatangani ${a.value}, diminta ${requirements.maxAmountRequired}`,
      payer: recovered,
    };
  }

  // USDC menuntut now > validAfter DAN now < validBefore. Dicerminkan persis, supaya
  // penolakan terjadi di sini dengan alasan jelas, bukan sebagai revert saat settle.
  if (now <= BigInt(a.validAfter)) {
    return { isValid: false, invalidReason: "invalid_exact_evm_payload_authorization_valid_after", detail: a.validAfter, payer: recovered };
  }
  if (now >= BigInt(a.validBefore)) {
    return { isValid: false, invalidReason: "invalid_exact_evm_payload_authorization_valid_before", detail: a.validBefore, payer: recovered };
  }

  try {
    const [bal, used] = await Promise.all([token.balanceOf(a.from), token.authorizationState(a.from, a.nonce)]);
    if (used) {
      return { isValid: false, invalidReason: "invalid_transaction_state", detail: "nonce sudah terpakai", payer: recovered };
    }
    if (BigInt(bal) < BigInt(a.value)) {
      return {
        isValid: false,
        invalidReason: "insufficient_funds",
        detail: `saldo ${bal}, butuh ${a.value}`,
        payer: recovered,
      };
    }
  } catch (e: any) {
    return { isValid: false, invalidReason: "unexpected_verify_error", detail: e?.message, payer: recovered };
  }

  return { isValid: true, payer: recovered };
}

export interface SettleResult {
  success: boolean;
  errorReason?: X402Error;
  detail?: string;
  transaction?: string;
  network?: string;
  payer?: string;
}

/**
 * Kirim otorisasinya ke chain. Diverifikasi ulang lebih dulu — bukan paranoia:
 * `verifyPayment` bisa lolos lalu keadaan berubah sebelum settle, dan yang paling
 * mungkin berubah adalah `authorizationState`, yaitu tepatnya perlindungan
 * pengiriman-ganda.
 */
export async function settlePayment(params: {
  payload: PaymentPayload;
  requirements: PaymentRequirements;
  provider: ethers.Provider;
  relayerKey: string;
  nowSeconds?: number;
}): Promise<SettleResult> {
  const pre = await verifyPayment(params);
  if (!pre.isValid) {
    return { success: false, errorReason: pre.invalidReason, detail: pre.detail, payer: pre.payer };
  }

  const a = params.payload.payload.authorization;
  const sig = ethers.Signature.from(params.payload.payload.signature);
  try {
    const wallet = new ethers.Wallet(params.relayerKey, params.provider);
    const token = new ethers.Contract(
      params.requirements.asset,
      [
        "function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)",
      ],
      wallet,
    );
    const tx = await token.transferWithAuthorization(
      a.from,
      a.to,
      BigInt(a.value),
      BigInt(a.validAfter),
      BigInt(a.validBefore),
      a.nonce,
      sig.v,
      sig.r,
      sig.s,
    );
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      return { success: false, errorReason: "unexpected_settle_error", detail: `status ${receipt?.status}`, payer: pre.payer };
    }
    return {
      success: true,
      transaction: receipt.hash,
      network: params.requirements.network,
      payer: pre.payer,
    };
  } catch (e: any) {
    return {
      success: false,
      errorReason: "unexpected_settle_error",
      detail: String(e?.shortMessage ?? e?.message ?? e).slice(0, 200),
      payer: pre.payer,
    };
  }
}

/** Dipakai klien dan pengujian untuk membuat otorisasi yang bisa diselesaikan. */
export async function signAuthorization(params: {
  signer: ethers.Signer;
  requirements: PaymentRequirements;
  provider: ethers.Provider;
  validAfter?: bigint;
  validBefore?: bigint;
  nonce?: string;
}): Promise<PaymentPayload> {
  const token = new ethers.Contract(
    params.requirements.asset,
    ["function name() view returns (string)", "function version() view returns (string)"],
    params.provider,
  );
  const [name, version, net, from] = await Promise.all([
    token.name(),
    token.version(),
    params.provider.getNetwork(),
    params.signer.getAddress(),
  ]);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const authorization: Authorization = {
    from,
    to: params.requirements.payTo,
    value: params.requirements.maxAmountRequired,
    // Mundur satu menit: USDC menuntut `now > validAfter` secara ketat, jadi memakai
    // `now` membuat otorisasi gagal pada blok yang sama detiknya.
    validAfter: String(params.validAfter ?? now - 60n),
    validBefore: String(params.validBefore ?? now + BigInt(params.requirements.maxTimeoutSeconds)),
    nonce: params.nonce ?? ethers.hexlify(ethers.randomBytes(32)),
  };
  const signature = await (params.signer as any).signTypedData(
    { name, version, chainId: Number(net.chainId), verifyingContract: params.requirements.asset },
    TRANSFER_WITH_AUTHORIZATION_TYPES,
    {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  );
  return {
    x402Version: X402_VERSION,
    scheme: "exact",
    network: params.requirements.network,
    payload: { signature, authorization },
  };
}
