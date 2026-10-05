/**
 * Peluncuran pasar oleh agen, TANPA menitipkan kunci (pola Flaunch): server menyiapkan
 * transaksi, agen menandatanganinya dengan kuncinya sendiri.
 *
 * TIDAK ADA jalur peluncuran kedua di sini. Tahap `prepare` dan `confirm` adalah tahap yang
 * SAMA dengan Studio, dipanggil di dalam proses lewat `POST` dari `src/app/api/deploy/route.ts`.
 * Berkas itu milik Plan 2 dan hanya dipanggil, tidak diubah; perubahan bentuknya dicatat di
 * `.kiro/plans/LOG.md` lebih dulu. Yang dikerjakan berkas ini hanya bagian yang di Studio
 * dikerjakan peramban: menyusun pesan attestation, menyusun calldata `deployTrinity`,
 * menyimulasikannya, lalu membaca event dari receipt.
 *
 * Konsekuensinya: semua aturan Studio berlaku sama persis — ticker terpesan, kuota 10 ticker
 * per alamat, batas fee, harga buka dari harga native live, batas laju `prepare` per IP (IP
 * pemanggil MCP diteruskan, jadi setiap agen punya ember sendiri).
 */
import { ethers } from "ethers";
import { POST as deployPOST } from "@/app/api/deploy/route";
import { CHAIN_LIST, resolveChain, readProvider, type ChainInfo } from "@/lib/chains";
import { CURVE_FACTORY_ABI, checkAgentOwnership } from "@/lib/dex";
import {
  checkSymbolAvailable,
  creatorQuota,
  creatorTickers,
  findProject,
  isOfficialCreator,
  markLaunchedVia,
  type LaunchVia,
} from "@/lib/registry";
import { checkLaunchContent } from "@/lib/launch-content";
import { sanitizeName, sanitizeSymbol } from "@/lib/studio-prefill";
import { LAUNCH_GAS_UNITS } from "@/lib/launch-cost";
import { TERMS_ACCEPTANCE_LINE, TERMS_VERSION } from "@/config/terms";
import { launchAttestationMessage } from "@/lib/launch-attestation";

/**
 * Tier "Standard" Studio, persis: total 1,00%, creator 0,70%, buyback 0,10%. Kaki protokol
 * 0,10% dipotong dari dalam total oleh factory v1, sehingga depth = 0,10%. Agen tidak memilih
 * fee: satu preset berarti satu bentuk pasar yang bisa dibandingkan di seluruh situs.
 */
export const AGENT_LAUNCH_FEES = { swapFee: 1.0, creatorCut: 0.7, treasuryCut: 0.1 } as const;
const SWAP_FEE_BPS = 100n;
const CREATOR_BPS = 70n;

/** Sama dengan Studio dan registry. */
const DEFAULT_SUPPLY = 1_000_000_000;
const PERSONA = "Answers questions about this market: its curve, its fees and its depth.";
const MODEL = "glm-5.3";

/** Server menolak attestation lebih tua dari 30 menit (`verifyLaunchAttestation`). */
const ATTESTATION_MAX_AGE_MS = 30 * 60_000;

/** Metadata yang dititipkan di `prepare_launch` sampai `register_launch` memakainya. */
const PENDING_TTL_MS = 6 * 60 * 60_000;

export type IpHeaders = Record<string, string>;

/** Template yang SAMA dengan `signAttestation` di Studio, baris demi baris. */
export { launchAttestationMessage };

function launchableChains() {
  return CHAIN_LIST.filter((c) => c.dexLive && c.curveFactoryAddress).map((c) => ({ chainId: c.chainId, chain: c.name }));
}

/** Chain yang bisa meluncurkan, atau null. Testnet alias tidak diterima: hanya chain yang id-nya tepat. */
function launchChain(chainId: number): ChainInfo | null {
  const chain = resolveChain(Number(chainId));
  if (!chain || chain.chainId !== Number(chainId) || !chain.dexLive || !chain.curveFactoryAddress) return null;
  return chain;
}

/**
 * `deployTargets[].virtualNative` dikirim server sebagai `String(number)`. Bilangan desimal biasa
 * diberikan ke `parseEther` apa adanya (sama dengan Studio); notasi eksponen, yang akan membuat
 * `parseEther` melempar, diubah lebih dulu.
 */
function toWei(value: unknown): bigint {
  const s = String(value ?? "").trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const [whole, frac = ""] = s.split(".");
    return ethers.parseEther(frac.length > 18 ? `${whole}.${frac.slice(0, 18)}` : s);
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`virtualNative is not a positive number: ${s}`);
  return ethers.parseEther(n.toFixed(18));
}

function revertReason(error: unknown): string {
  const e = error as { shortMessage?: string; reason?: string; message?: string };
  return String(e?.reason ?? e?.shortMessage ?? e?.message ?? error).slice(0, 240);
}

/** Panggil route deploy di dalam proses. Status dan badan aslinya selalu dikembalikan. */
async function callDeploy(body: Record<string, unknown>, ipHeaders: IpHeaders): Promise<{ status: number; data: any }> {
  const res = await deployPOST(
    new Request("http://127.0.0.1/api/deploy", {
      method: "POST",
      headers: { "content-type": "application/json", ...ipHeaders },
      body: JSON.stringify(body),
    })
  );
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

// ── metadata titipan ────────────────────────────────────────────────────────

interface PendingLaunch {
  description: string | null;
  website: string | null;
  x: string | null;
  github: string | null;
  docs: string | null;
  image: string | null;
  category: string | null;
  attestationRoot: string;
  daStorageTx: string | null;
  expires: number;
}

declare global {
  var __ADEXTO_AGENT_LAUNCHES__: Map<string, PendingLaunch> | undefined;
}

function pending(): Map<string, PendingLaunch> {
  if (!globalThis.__ADEXTO_AGENT_LAUNCHES__) globalThis.__ADEXTO_AGENT_LAUNCHES__ = new Map();
  const map = globalThis.__ADEXTO_AGENT_LAUNCHES__;
  const now = Date.now();
  for (const [k, v] of map) if (v.expires < now) map.delete(k);
  return map;
}

const pendingKey = (chainId: number, symbol: string, creator: string) =>
  `${chainId}:${symbol.toUpperCase()}:${creator.toLowerCase()}`;

// ── prepare_launch ──────────────────────────────────────────────────────────

export interface PrepareLaunchInput {
  chainId: number;
  name: string;
  symbol: string;
  deployer: string;
  agentId?: string;
  description?: string;
  website?: string;
  x?: string;
  github?: string;
  docs?: string;
  image?: string;
  category?: string;
  attestationMessage?: string;
  attestationSignature?: string;
}

/**
 * Dua langkah, karena tahap `prepare` Studio menuntut tanda tangan attestation SEBELUM apa pun:
 *
 *   1. tanpa tanda tangan → pemeriksaan murah (chain, ticker di registry dan di factory, kuota,
 *      kepemilikan agen) lalu pesan attestation yang harus ditandatangani deployer;
 *   2. dengan tanda tangan → tanda tangan diverifikasi di sini dulu, lalu tahap `prepare`
 *      Studio (yang meng-anchor metadata ke 0G DA atas biaya kami), lalu calldata
 *      `deployTrinity` disusun, disimulasikan dari alamat deployer, dan diestimasi gasnya.
 *
 * Pemeriksaan langkah 1 diulang di langkah 2 karena keadaan bisa berubah di antaranya.
 */
export async function prepareLaunch(input: PrepareLaunchInput, ipHeaders: IpHeaders): Promise<Record<string, unknown>> {
  const chain = launchChain(input.chainId);
  if (!chain) {
    return {
      error: "unsupported_chain",
      detail: `Chain ${input.chainId} has no ADEXTO launch factory.`,
      launchableChains: launchableChains(),
    };
  }

  let deployer: string;
  try {
    deployer = ethers.getAddress(String(input.deployer).trim());
  } catch {
    return { error: "invalid_deployer", detail: "deployer must be a 20-byte hex address." };
  }

  const symbol = sanitizeSymbol(String(input.symbol ?? ""));
  if (symbol !== String(input.symbol ?? "").trim().toUpperCase() || symbol.length < 2) {
    return { error: "invalid_symbol", detail: "symbol must be 2 to 12 characters, letters A-Z and digits only." };
  }
  const name = sanitizeName(String(input.name ?? ""));
  if (!name) return { error: "invalid_name", detail: "name is required (up to 64 bytes)." };

  const registryCheck = checkSymbolAvailable(symbol, chain.chainId, deployer);
  if (!registryCheck.available) return { error: "symbol_unavailable", detail: registryCheck.reason };

  // /acceptable-use, di langkah pertama: agen tahu sebelum menandatangani apa pun.
  const content = checkLaunchContent(
    {
      name,
      symbol,
      description: input.description ?? null,
      links: { website: input.website ?? null, github: input.github ?? null, docs: input.docs ?? null },
    },
    isOfficialCreator(deployer)
  );
  if (!content.ok) return { error: "content_refused", detail: content.reason, rule: content.rule };

  const quota = creatorQuota(deployer);
  if (!creatorTickers(deployer).has(symbol) && quota.remaining === 0) {
    return {
      error: "creator_ticker_limit",
      detail: `This address has listed ${quota.used} tickers, the limit of ${quota.max} per address.`,
      quota,
    };
  }

  const provider = readProvider(chain);
  const factoryAddress = chain.curveFactoryAddress as string;
  const factory = new ethers.Contract(factoryAddress, CURVE_FACTORY_ABI, provider);
  const freeOnChain: boolean | null = await factory.isSymbolAvailable(symbol).catch(() => null);
  if (freeOnChain === false) {
    return {
      error: "symbol_taken_onchain",
      detail: `The ${chain.name} factory already holds ticker ${symbol}. Tickers are permanent on chain; choose another.`,
    };
  }

  let agentId: bigint | null = null;
  if (input.agentId !== undefined && String(input.agentId).trim() !== "") {
    if (!/^\d{1,78}$/.test(String(input.agentId).trim())) {
      return { error: "invalid_agent_id", detail: "agentId must be a decimal ERC-8004 agent id." };
    }
    agentId = BigInt(String(input.agentId).trim());
    const own = await checkAgentOwnership(chain.rpcUrl, agentId, deployer);
    if (own.state !== "owned") {
      return {
        error: "agent_not_owned",
        detail:
          own.state === "not-owned"
            ? `ERC-8004 agent ${agentId} on ${chain.name} is owned by ${own.owner}, not by the deployer. The factory would revert.`
            : own.state === "missing"
              ? `There is no ERC-8004 Identity Registry on ${chain.name}.`
              : `Could not read agent ${agentId} on ${chain.name}: ${own.detail}`,
      };
    }
  }

  const checks = {
    tickerFreeInRegistry: true,
    tickerFreeOnChain: freeOnChain,
    agentId: agentId === null ? null : agentId.toString(),
  };

  // ── langkah 1 ──
  if (!input.attestationMessage || !input.attestationSignature) {
    return {
      step: "sign_attestation",
      chainId: chain.chainId,
      chain: chain.name,
      symbol,
      name,
      deployer,
      attestationMessage: launchAttestationMessage(deployer, symbol),
      signWith: "personal_sign (EIP-191) from the deployer address",
      validForSeconds: ATTESTATION_MAX_AGE_MS / 1000,
      checks,
      terms: {
        version: TERMS_VERSION,
        url: "https://adexto.xyz/terms",
        acceptableUse: "https://adexto.xyz/acceptable-use",
        note: "The last line of attestationMessage accepts these terms. Signing it is the deployer's acceptance.",
      },
      next:
        "Sign attestationMessage exactly as given, then call prepare_launch again with the same arguments plus " +
        "attestationMessage and attestationSignature. That call returns the unsigned launch transaction.",
    };
  }

  // ── langkah 2: verifikasi lokal dulu, supaya galatnya jelas dan 0G DA tidak dibayar sia-sia ──
  const message = String(input.attestationMessage);
  const signature = String(input.attestationSignature).trim();
  if (!message.includes(`Deployer: ${deployer}`)) {
    return {
      error: "attestation_mismatch",
      detail: `attestationMessage must contain the line "Deployer: ${deployer}" exactly (checksummed). Use the message prepare_launch returned.`,
    };
  }
  if (!message.split("\n").includes(TERMS_ACCEPTANCE_LINE)) {
    return {
      error: "attestation_mismatch",
      detail: `attestationMessage must end with the line "${TERMS_ACCEPTANCE_LINE}". Call prepare_launch without a signature for a current message.`,
    };
  }
  const ticker = /Ticker:\s*([A-Z0-9]+)/.exec(message)?.[1];
  if (ticker !== symbol) {
    return { error: "attestation_mismatch", detail: `attestationMessage names ticker ${ticker ?? "(none)"}, not ${symbol}.` };
  }
  const stamp = Number(/Timestamp:\s*(\d+)/.exec(message)?.[1] ?? NaN);
  const age = Date.now() - stamp;
  if (!Number.isFinite(stamp) || age < -60_000 || age > ATTESTATION_MAX_AGE_MS) {
    return { error: "attestation_expired", detail: "The attestation is older than 30 minutes. Call prepare_launch without a signature for a fresh message." };
  }
  let signer: string;
  try {
    signer = ethers.verifyMessage(message, signature);
  } catch {
    return { error: "attestation_invalid", detail: "attestationSignature is not a valid EIP-191 signature of attestationMessage." };
  }
  if (signer.toLowerCase() !== deployer.toLowerCase()) {
    return { error: "attestation_invalid", detail: `The signature recovers ${signer}, not the deployer ${deployer}.` };
  }

  const prep = await callDeploy(
    {
      stage: "prepare",
      name,
      symbol,
      supply: String(DEFAULT_SUPPLY),
      ...AGENT_LAUNCH_FEES,
      model: MODEL,
      persona: PERSONA,
      bindAgent: agentId !== null,
      agentIds: agentId !== null ? { [chain.chainId]: agentId.toString() } : null,
      deployer,
      targetChains: [chain.chainId],
      attestationSignature: signature,
      attestationMessage: message,
    },
    ipHeaders
  );
  if (prep.status !== 200 || !prep.data?.success) {
    return {
      error: "prepare_failed",
      status: prep.status,
      code: prep.data?.code ?? null,
      detail: prep.data?.error ?? "The launch preparation stage did not succeed.",
      ...(prep.data?.retryAfter ? { retryAfterSeconds: prep.data.retryAfter } : {}),
    };
  }
  const target = (prep.data.deployTargets ?? []).find((t: any) => Number(t?.chainId) === chain.chainId);
  if (!target?.virtualNative || !/^0x[a-fA-F0-9]{64}$/.test(String(prep.data.attestationRoot ?? ""))) {
    return {
      error: "prepare_failed",
      detail: "The preparation stage returned no opening reserve or metadata root for this chain.",
      unavailableChains: prep.data.unavailableChains ?? [],
    };
  }

  const treasuryBuybackBps = BigInt(Number(prep.data.treasuryBuybackBps));
  const args = [
    name,
    symbol,
    BigInt(DEFAULT_SUPPLY),
    // `agentIdentity`: alamat operasional yang dicatat token dan kurva. Studio memakai dompet
    // creator sendiri, dan factory menuntutnya bukan nol.
    deployer,
    toWei(target.virtualNative),
    SWAP_FEE_BPS,
    CREATOR_BPS,
    treasuryBuybackBps,
    prep.data.attestationRoot,
    agentId !== null,
    agentId ?? 0n,
  ] as const;
  const data = new ethers.Interface(CURVE_FACTORY_ABI).encodeFunctionData("deployTrinity", args);

  // Simulasi dari alamat deployer: `msg.sender` menentukan creator dan pemeriksaan agen.
  let simulation: { ok: boolean; revert: string | null } = { ok: true, revert: null };
  try {
    await provider.call({ from: deployer, to: factoryAddress, data });
  } catch (error) {
    simulation = { ok: false, revert: revertReason(error) };
  }

  let gas: bigint;
  let gasSource: "estimateGas" | "measured";
  try {
    gas = await provider.estimateGas({ from: deployer, to: factoryAddress, data });
    gasSource = "estimateGas";
  } catch {
    gas = BigInt(LAUNCH_GAS_UNITS[chain.key] ?? 3_400_000);
    gasSource = "measured";
  }
  /**
   * Margin gas limit di atas estimasi, PER CHAIN.
   *
   * Di kebanyakan chain sisa gas dikembalikan, jadi margin 20% gratis dan tetap dipakai. Monad
   * menagih SELURUH gas limit, bukan gas terpakai: setiap receipt di sana melaporkan `gasUsed` sama
   * dengan limit. Margin 20% di Monad karena itu biaya nyata, dan terukur: launch $LOOP
   * (2026-10-03) membayar 666.030 gas di atas estimasinya, 0,068 MON.
   *
   * Monad mendapat 5%, dan hanya bila angkanya dari `estimateGas` untuk calldata ini. Untuk satu
   * launch hampir tidak ada yang bisa berubah antara estimasi dan inklusi: semua slot yang ditulis
   * baru (token, kurva, entri registry ticker), jadi biayanya sama di blok mana pun. 5% dari
   * ±3,3 juta gas masih ±166.000 gas cadangan. Bila `estimateGas` gagal dan angkanya dari
   * pengukuran (`LAUNCH_GAS_UNITS`), margin penuh tetap dipakai, karena panjang metadata ikut
   * menentukan gas dan angka terukur itu milik calldata lain.
   */
  const MARGIN_PCT_BY_CHAIN: Record<number, bigint> = { 143: 5n };
  const marginPct = gasSource === "estimateGas" ? (MARGIN_PCT_BY_CHAIN[chain.chainId] ?? 20n) : 20n;
  const gasLimit = (gas * (100n + marginPct)) / 100n;
  /** Chain yang menagih gas limit, bukan gas terpakai. */
  const billsGasLimit = chain.chainId === 143;
  const [balance, feeData] = await Promise.all([
    provider.getBalance(deployer).catch(() => null),
    provider.getFeeData().catch(() => null),
  ]);
  const price = feeData?.maxFeePerGas ?? feeData?.gasPrice ?? null;
  // Di Monad yang dibayar adalah limit, jadi perkiraan biaya memakai limit juga.
  const estimatedCostWei = price ? (billsGasLimit ? gasLimit : gas) * price : null;
  // Node menolak transaksi bila saldo < gasLimit × harga, di chain mana pun.
  const requiredWei = price ? gasLimit * price : null;

  pending().set(pendingKey(chain.chainId, symbol, deployer), {
    description: input.description?.trim() || null,
    website: input.website?.trim() || null,
    x: input.x?.trim() || null,
    github: input.github?.trim() || null,
    docs: input.docs?.trim() || null,
    image: input.image?.trim() || null,
    category: input.category?.trim() || null,
    attestationRoot: prep.data.attestationRoot,
    daStorageTx: prep.data.daStorageTx ?? null,
    expires: Date.now() + PENDING_TTL_MS,
  });

  return {
    step: "sign_and_send",
    chainId: chain.chainId,
    chain: chain.name,
    symbol,
    name,
    deployer,
    transaction: {
      from: deployer,
      to: factoryAddress,
      data,
      value: "0",
      chainId: chain.chainId,
      gas: gasLimit.toString(),
    },
    gasEstimate: gas.toString(),
    gasSource,
    gasPriceWei: price?.toString() ?? null,
    estimatedCostWei: estimatedCostWei?.toString() ?? null,
    deployerBalanceWei: balance?.toString() ?? null,
    fundsSufficient: balance !== null && requiredWei !== null ? balance >= requiredWei : null,
    nativeSymbol: chain.nativeSymbol,
    simulation,
    market: {
      supply: DEFAULT_SUPPLY,
      allSupplyInCurve: true,
      creatorAllocation: 0,
      feePerTradeBps: { total: 100, creator: 70, depth: Number(prep.data.lpFeeBps), buybackAndBurn: Number(treasuryBuybackBps), protocol: Number(prep.data.protocolFeeBps) },
      openingMarketCapUsd: prep.data.openingMarketCapUsd ?? null,
      agentId: agentId === null ? null : agentId.toString(),
    },
    attestationRoot: prep.data.attestationRoot,
    metadataAnchoredTo0G: Boolean(prep.data.daStorageOk),
    next:
      `Sign and send transaction from ${deployer} on ${chain.name} (value 0, gas only). When it is mined, call ` +
      "register_launch with chainId and txHash: that lists the market on adexto.xyz, in list_markets and on the x402 gateway.",
  };
}

// ── register_launch ─────────────────────────────────────────────────────────

/**
 * Daftarkan peluncuran yang sudah mined lewat tahap `confirm` Studio.
 *
 * Dua pemeriksaan ditambahkan DI SINI, sebelum `confirm`: receipt-nya harus berisi
 * `TrinityProjectDeployed` yang dipancarkan oleh factory ADEXTO chain itu sendiri (bukan kontrak
 * lain yang meniru tanda tangan event-nya), dan nilai yang dikirim ke `confirm` diambil dari
 * event itu, bukan dari masukan pemanggil. Pemanggil hanya memberi chain dan hash.
 */
export async function registerLaunch(
  input: { chainId: number; txHash: string },
  ipHeaders: IpHeaders,
  /** Alat agen yang memanggil: `register_launch` MCP atau REST `/api/agents/launch/register`. */
  via: LaunchVia = "mcp"
): Promise<Record<string, unknown>> {
  const chain = launchChain(input.chainId);
  if (!chain) return { error: "unsupported_chain", detail: `Chain ${input.chainId} has no ADEXTO launch factory.`, launchableChains: launchableChains() };
  const txHash = String(input.txHash ?? "").trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) return { error: "invalid_tx_hash", detail: "txHash must be a 32-byte hex hash." };

  const provider = readProvider(chain);
  const receipt = await provider.getTransactionReceipt(txHash).catch(() => null);
  if (!receipt) {
    return { error: "not_mined_yet", detail: `No receipt for ${txHash} on ${chain.name} yet. Wait until it is mined, then call register_launch again.` };
  }
  if (receipt.status !== 1) return { error: "reverted", detail: "The launch transaction reverted, so no market exists." };

  /**
   * Event dari factory yang SEDANG meluncurkan, atau dari generasi sebelumnya di chain itu. Yang
   * kedua hanya untuk menjawab "sudah terdaftar"; pasar lama yang belum terdaftar (peluncuran uji)
   * tidak didaftarkan lewat alat ini.
   */
  const current = String(chain.curveFactoryAddress).toLowerCase();
  const superseded = chain.supersededCurveFactoryAddress?.toLowerCase() ?? null;
  const iface = new ethers.Interface(CURVE_FACTORY_ABI);
  let event: ethers.LogDescription | null = null;
  let fromCurrent = false;
  for (const log of receipt.logs) {
    const emitter = log.address.toLowerCase();
    if (emitter !== current && emitter !== superseded) continue;
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === "TrinityProjectDeployed") {
        event = parsed;
        fromCurrent = emitter === current;
        break;
      }
    } catch {
      // bukan event factory
    }
  }
  if (!event) {
    return {
      error: "not_an_adexto_launch",
      detail: `This transaction has no TrinityProjectDeployed event from the ADEXTO factory ${chain.curveFactoryAddress} on ${chain.name}.`,
    };
  }

  const token = ethers.getAddress(String(event.args.token));
  const curve = ethers.getAddress(String(event.args.curve));
  const creator = ethers.getAddress(String(event.args.creator));
  const symbol = String(event.args.symbol).toUpperCase();
  const slug = symbol.toLowerCase();
  const links = {
    page: `https://adexto.xyz/token/${slug}?chain=${chain.chainId}`,
    buyResource: `https://x402.adexto.xyz/v1/x402/buy/${slug}?chain=${chain.chainId}`,
  };

  // Dengan chainId: alamat token yang sama bisa sudah terdaftar di chain lain ($SAI 4663 = $ARCTEST 5042).
  const existing = findProject(token, chain.chainId);
  if (existing) {
    return { registered: true, alreadyRegistered: true, symbol, chainId: chain.chainId, token, curve, creator, ...links };
  }
  if (!fromCurrent) {
    return {
      error: "superseded_factory",
      detail: `This launch came from the superseded ${chain.name} factory and is not listed; only launches from the current factory ${chain.curveFactoryAddress} are registered here.`,
    };
  }

  const key = pendingKey(chain.chainId, symbol, creator);
  const meta = pending().get(key) ?? null;
  const res = await callDeploy(
    {
      stage: "confirm",
      chainId: chain.chainId,
      txHash,
      name: String(event.args.name),
      symbol,
      supply: (event.args.initialSupply as bigint).toString(),
      lpFeeBps: Number(event.args.depthFeeBps),
      treasuryBuybackBps: Number(event.args.treasuryBuybackBps),
      creator,
      persona: PERSONA,
      agentModel: `0G Router (${MODEL})`,
      attestationRoot: String(event.args.teeAttestationRoot),
      daStorageTx: meta?.daStorageTx ?? null,
      category: meta?.category ?? undefined,
      description: meta?.description ?? null,
      website: meta?.website ?? null,
      x: meta?.x ?? null,
      github: meta?.github ?? null,
      docs: meta?.docs ?? null,
      image: meta?.image ?? undefined,
      targetChainIds: [chain.chainId],
    },
    ipHeaders
  );
  if (res.status !== 200 || !res.data?.success) {
    return {
      error: "confirm_failed",
      status: res.status,
      code: res.data?.code ?? null,
      detail: res.data?.error ?? "The registration stage did not succeed.",
      note: "The market exists on chain regardless; only the listing on adexto.xyz is affected.",
      symbol,
      token,
      curve,
    };
  }
  pending().delete(key);
  // Sesudah pendaftaran berhasil, di dalam proses: inilah satu-satunya penulis `launchedVia`.
  markLaunchedVia(token, via, chain.chainId);
  return {
    registered: true,
    alreadyRegistered: false,
    symbol,
    name: String(event.args.name),
    chainId: chain.chainId,
    chain: chain.name,
    token,
    curve,
    creator,
    agentIdentity: res.data.deployment?.token?.agentIdentity ?? null,
    explorerTx: res.data.deployment?.explorerTx ?? null,
    metadataApplied: meta !== null,
    ...links,
    next: "get_market reads it back; prepare_stake opens its agent to stakers; prepare_claim collects the creator fee.",
  };
}
