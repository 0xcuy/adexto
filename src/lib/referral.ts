/**
 * Program referral (P2.5), sisi server. Antarmuka bersama README rencana §4: Plan 1 (gateway x402)
 * memanggil `POST /api/referral/record` dengan header `x-referral-secret`.
 *
 * APA YANG DIHITUNG
 *
 * Satu catatan per tx `buy`/`sell` yang diverifikasi di chain, ke kurva pasar ADEXTO di registry:
 *
 * - `source: "ui"`: tx dikirim langsung oleh trader. Perujuknya dibaca dari ekor calldata yang ikut
 *   ditandatangani trader (`src/lib/referral-tag.ts`), dan harus sama dengan kode yang dikirim. Siapa
 *   pun boleh mengirim hash tx itu; tanpa ekor yang cocok, tidak ada yang tercatat.
 * - `source: "x402" | "mcp"`: beli lewat relayer. Header rahasia wajib, `tx.from` harus relayer, dan
 *   umur tx paling lama 24 jam.
 *
 * Yang ditolak: perujuk = wallet trader atau penerima (self-referral), wallet trader milik kita, dan
 * perujuk milik kita (`isOurAddress`). Satu level saja. Satu catatan per tx: catatan pertama menang
 * dan tidak bisa ditimpa.
 *
 * Volume dan fee dicatat dari event `Swap` kurva itu sendiri: `amountIn` (beli, bruto) atau
 * `amountOut` (jual, neto), dan `protocolFee` persis seperti dibayar. Kurs USD dibekukan saat dicatat.
 */
import { ethers } from "ethers";
import { chainFromId, logReadProvider } from "@/lib/chains";
import { listProjects } from "@/lib/registry";
import { readJson, writeJson } from "@/lib/server-store";
import { SWAP_TOPICS, swapIfaceForTopic } from "@/lib/onchain-trades";
import { isOurAddress } from "@/lib/agent-identities";
import { X402_RELAYER } from "@/config/contracts";
import { nativePrices } from "@/lib/native-price";
import { STABLE_PRICES, assetPriceUsd } from "@/lib/pricing";
import { REFERRAL_TERMS } from "@/config/growth-programs";
import {
  BUY_ARG_BYTES,
  BUY_SELECTOR,
  SELL_ARG_BYTES,
  SELL_SELECTOR,
  handleRegistrationMessage,
  isAddressCode,
  normalizeRefCode,
  readReferralTag,
  weekLabel,
  weekStart,
} from "@/lib/referral-tag";

const HANDLES_FILE = "referral-handles.json";
const RECORDS_FILE = "referral-records.json";
const RELAYED_MAX_AGE_S = 24 * 60 * 60;
const HANDLE_SIGNATURE_MAX_AGE_MS = 10 * 60 * 1000;
/** Handle yang tidak boleh didaftarkan siapa pun, supaya tidak terbaca sebagai akun resmi. */
const RESERVED_HANDLES = new Set(["adexto", "admin", "team", "official", "support", "treasury", "deployer", "relayer", "x402", "mcp"]);

export type ReferralSource = "ui" | "x402" | "mcp";

export interface ReferralRecord {
  id: string;
  chainId: number;
  txHash: string;
  blockNumber: number;
  /** Unix detik blok. */
  time: number;
  /** Awal minggu program (Senin 00:00 UTC), `YYYY-MM-DD`. */
  week: string;
  curve: string;
  token: string;
  symbol: string;
  isBuy: boolean;
  /** Wallet yang dirujuk: penerima untuk beli, trader untuk jual (sama dengan `tradeWallet`). */
  wallet: string;
  trader: string;
  recipient: string;
  /** Native yang masuk (beli, bruto) atau keluar (jual, neto), wei. */
  volumeNative: string;
  protocolFeeNative: string;
  nativeSymbol: string;
  nativeUsd: number;
  volumeUsd: number;
  protocolFeeUsd: number;
  ref: string;
  referrer: string;
  source: ReferralSource;
  recordedAt: number;
}

interface RecordsFile {
  version: 1;
  records: ReferralRecord[];
}
interface HandlesFile {
  version: 1;
  handles: Record<string, { address: string; registeredAt: number }>;
}

function loadRecords(): RecordsFile {
  const f = readJson<RecordsFile>(RECORDS_FILE, { version: 1, records: [] });
  return Array.isArray(f?.records) ? f : { version: 1, records: [] };
}
function loadHandles(): HandlesFile {
  const f = readJson<HandlesFile>(HANDLES_FILE, { version: 1, handles: {} });
  return f && typeof f.handles === "object" ? f : { version: 1, handles: {} };
}

/** Alamat di balik kode: alamat itu sendiri, atau pemilik handle. Null bila handle belum terdaftar. */
export function resolveRefCode(raw: string | null | undefined): { code: string; address: string } | null {
  const code = normalizeRefCode(raw);
  if (!code) return null;
  if (isAddressCode(code)) return { code, address: code };
  const hit = loadHandles().handles[code];
  return hit ? { code, address: hit.address } : null;
}

export function handlesOf(address: string): string[] {
  const a = address.toLowerCase();
  return Object.entries(loadHandles().handles)
    .filter(([, v]) => v.address === a)
    .map(([h]) => h);
}

export type HandleResult = { ok: true; handle: string; address: string } | { ok: false; status: number; code: string; error: string };

/**
 * Daftarkan handle untuk sebuah alamat, dibuktikan dengan tanda tangan alamat itu. Satu handle per
 * alamat: handle lama alamat itu dilepas. Handle milik alamat lain tidak bisa diambil.
 */
export function registerHandle(input: { handle: unknown; address: unknown; issuedAt: unknown; signature: unknown }): HandleResult {
  const handle = normalizeRefCode(String(input.handle ?? ""));
  if (!handle || isAddressCode(handle)) {
    return { ok: false, status: 400, code: "BAD_HANDLE", error: "Use 3 to 20 characters: a-z, 0-9 and underscore." };
  }
  if (RESERVED_HANDLES.has(handle)) return { ok: false, status: 409, code: "RESERVED", error: "That handle is reserved." };
  if (typeof input.address !== "string" || !ethers.isAddress(input.address)) {
    return { ok: false, status: 400, code: "BAD_ADDRESS", error: "A wallet address is required." };
  }
  const address = input.address.toLowerCase();
  if (isOurAddress(address)) return { ok: false, status: 403, code: "TEAM_WALLET", error: "ADEXTO team wallets cannot join the referral program." };
  const issuedAt = Number(input.issuedAt);
  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > HANDLE_SIGNATURE_MAX_AGE_MS) {
    return { ok: false, status: 400, code: "STALE_SIGNATURE", error: "The signature is older than ten minutes; sign again." };
  }
  if (typeof input.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(input.signature)) {
    return { ok: false, status: 400, code: "BAD_SIGNATURE", error: "A 65-byte signature is required." };
  }
  let signer: string;
  try {
    signer = ethers.verifyMessage(handleRegistrationMessage({ handle, address, issuedAt }), input.signature).toLowerCase();
  } catch {
    return { ok: false, status: 400, code: "BAD_SIGNATURE", error: "The signature does not verify." };
  }
  if (signer !== address) return { ok: false, status: 403, code: "NOT_OWNER", error: "The signature is not from this address." };

  const file = loadHandles();
  const existing = file.handles[handle];
  if (existing && existing.address !== address) return { ok: false, status: 409, code: "TAKEN", error: "That handle belongs to another address." };
  for (const [h, v] of Object.entries(file.handles)) if (v.address === address && h !== handle) delete file.handles[h];
  file.handles[handle] = { address, registeredAt: Math.floor(Date.now() / 1000) };
  if (!writeJson(HANDLES_FILE, file)) return { ok: false, status: 500, code: "STORE_FAILED", error: "Could not save the handle." };
  return { ok: true, handle, address };
}

export type RecordResult =
  | { ok: true; record: ReferralRecord; duplicate: boolean }
  | { ok: false; status: number; code: string; error: string };

const reject = (status: number, code: string, error: string): RecordResult => ({ ok: false, status, code, error });

/** Verifikasi tx di chain lalu simpan satu catatan referral. `trusted` = header rahasia sudah cocok. */
export async function recordReferral(input: {
  txHash: unknown;
  chainId: unknown;
  ref: unknown;
  source: unknown;
  trusted: boolean;
}): Promise<RecordResult> {
  const txHash = String(input.txHash ?? "");
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return reject(400, "BAD_TX", "txHash must be a 32-byte hex hash.");
  const chain = chainFromId(Number(input.chainId));
  if (!chain) return reject(400, "BAD_CHAIN", "Unknown chainId.");
  const source = input.source;
  if (source !== "ui" && source !== "x402" && source !== "mcp") return reject(400, "BAD_SOURCE", 'source must be "ui", "x402" or "mcp".');
  if (source !== "ui" && !input.trusted) return reject(401, "SECRET_REQUIRED", "Relayed sources need the x-referral-secret header.");
  const resolved = resolveRefCode(String(input.ref ?? ""));
  if (!resolved) return reject(400, "BAD_REF", "Unknown referral code.");

  const id = `${chain.chainId}:${txHash.toLowerCase()}`;
  const prior = loadRecords().records.find((r) => r.id === id);
  if (prior) return { ok: true, record: prior, duplicate: true };

  const provider = logReadProvider(chain);
  const [tx, receipt] = await Promise.all([provider.getTransaction(txHash), provider.getTransactionReceipt(txHash)]);
  if (!tx || !receipt) return reject(404, "TX_NOT_FOUND", "The transaction is not on chain yet.");
  if (receipt.status !== 1) return reject(422, "TX_FAILED", "The transaction reverted.");
  const to = (tx.to ?? "").toLowerCase();
  const project = listProjects().find((p) => p.chainId === chain.chainId && (p.poolAddress ?? "").toLowerCase() === to);
  if (!project || !project.poolAddress) return reject(422, "NOT_A_CURVE", "The transaction is not a trade on an ADEXTO curve.");

  const log = receipt.logs.find((l) => l.address.toLowerCase() === to && SWAP_TOPICS.includes(l.topics[0]));
  const iface = log ? swapIfaceForTopic(log.topics[0]) : null;
  const parsed = log && iface ? iface.parseLog({ topics: [...log.topics], data: log.data }) : null;
  if (!parsed) return reject(422, "NO_SWAP", "No Swap event from the curve in this transaction.");
  const trader = String(parsed.args.trader).toLowerCase();
  const recipient = String(parsed.args.recipient).toLowerCase();
  const isBuy = Boolean(parsed.args.isBuy);
  const wallet = isBuy ? recipient : trader;
  const referrer = resolved.address.toLowerCase();

  if (source === "ui") {
    const selector = tx.data.slice(0, 10).toLowerCase();
    if (selector !== (isBuy ? BUY_SELECTOR : SELL_SELECTOR)) return reject(422, "NOT_DIRECT", "Only direct buy/sell calls carry a referral tag.");
    const tag = readReferralTag(tx.data, isBuy ? BUY_ARG_BYTES : SELL_ARG_BYTES);
    if (!tag) return reject(422, "NO_TAG", "This trade was not sent with a referral tag.");
    if (tag !== referrer) return reject(422, "TAG_MISMATCH", "The referral tag in the transaction names a different referrer.");
    if (tx.from.toLowerCase() !== trader) return reject(422, "NOT_TRADER", "The sender is not the trader in the Swap event.");
  } else if (tx.from.toLowerCase() !== X402_RELAYER.toLowerCase()) {
    return reject(422, "NOT_RELAYER", "Relayed records must come from the ADEXTO relayer.");
  }

  if (referrer === wallet || referrer === trader || referrer === recipient) return reject(422, "SELF_REFERRAL", "A wallet cannot refer itself.");
  if (isOurAddress(wallet)) return reject(422, "TEAM_WALLET", "Trades by ADEXTO team wallets are not counted.");
  if (isOurAddress(referrer)) return reject(422, "TEAM_REFERRER", "ADEXTO team wallets cannot earn referrals.");

  const block = await provider.getBlock(receipt.blockNumber);
  const time = Number(block?.timestamp ?? Math.floor(Date.now() / 1000));
  if (source !== "ui" && Date.now() / 1000 - time > RELAYED_MAX_AGE_S) return reject(422, "TOO_OLD", "Relayed trades must be recorded within 24 hours.");

  const volume = BigInt(isBuy ? parsed.args.amountIn : parsed.args.amountOut);
  let protocolFee = 0n;
  try {
    protocolFee = BigInt(parsed.args.protocolFee);
  } catch {
    protocolFee = 0n; // generasi tanpa leg protokol
  }
  let nativeUsd = 0;
  try {
    const live = await nativePrices();
    nativeUsd = assetPriceUsd(chain.nativeSymbol, { ...STABLE_PRICES, ...live.prices });
  } catch {
    nativeUsd = assetPriceUsd(chain.nativeSymbol, STABLE_PRICES);
  }
  const toNum = (wei: bigint) => Number(ethers.formatEther(wei));
  const record: ReferralRecord = {
    id,
    chainId: chain.chainId,
    txHash: receipt.hash.toLowerCase(),
    blockNumber: receipt.blockNumber,
    time,
    week: weekLabel(weekStart(time)),
    curve: to,
    token: project.tokenAddress.toLowerCase(),
    symbol: project.symbol,
    isBuy,
    wallet,
    trader,
    recipient,
    volumeNative: volume.toString(),
    protocolFeeNative: protocolFee.toString(),
    nativeSymbol: chain.nativeSymbol,
    nativeUsd,
    volumeUsd: toNum(volume) * nativeUsd,
    protocolFeeUsd: toNum(protocolFee) * nativeUsd,
    ref: resolved.code,
    referrer,
    source,
    recordedAt: Math.floor(Date.now() / 1000),
  };
  // Baca ulang tepat sebelum menulis: pembacaan chain di atas makan waktu, dan catatan lain bisa masuk.
  const file = loadRecords();
  const raced = file.records.find((r) => r.id === id);
  if (raced) return { ok: true, record: raced, duplicate: true };
  file.records.push(record);
  if (!writeJson(RECORDS_FILE, file, { compact: true })) return reject(500, "STORE_FAILED", "Could not save the record.");
  return { ok: true, record, duplicate: false };
}

export interface ReferrerWeek {
  week: string;
  referrer: string;
  handles: string[];
  trades: number;
  wallets: number;
  volumeUsd: number;
  protocolFeeUsd: number;
  /** Bagian perujuk menurut `REFERRAL_TERMS`; hanya estimasi sampai owner membayar. */
  rewardUsd: number;
  meetsMinimum: boolean;
}

function summarize(records: ReferralRecord[]): ReferrerWeek[] {
  const groups = new Map<string, ReferralRecord[]>();
  for (const r of records) {
    const key = `${r.week}|${r.referrer}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const handles = loadHandles().handles;
  const handlesFor = (a: string) => Object.entries(handles).filter(([, v]) => v.address === a).map(([h]) => h);
  return [...groups.entries()]
    .map(([key, rs]) => {
      const [week, referrer] = key.split("|");
      const protocolFeeUsd = rs.reduce((s, r) => s + r.protocolFeeUsd, 0);
      const rewardUsd = (protocolFeeUsd * REFERRAL_TERMS.sharePctOfProtocolFee) / 100;
      return {
        week,
        referrer,
        handles: handlesFor(referrer),
        trades: rs.length,
        wallets: new Set(rs.map((r) => r.wallet)).size,
        volumeUsd: rs.reduce((s, r) => s + r.volumeUsd, 0),
        protocolFeeUsd,
        rewardUsd,
        meetsMinimum: rewardUsd >= REFERRAL_TERMS.minPayoutUsd,
      };
    })
    .sort((a, b) => (a.week === b.week ? b.volumeUsd - a.volumeUsd : a.week < b.week ? 1 : -1));
}

/** Ringkasan per minggu dan catatan terbaru untuk satu perujuk. */
export function referrerStats(address: string) {
  const a = address.toLowerCase();
  const mine = loadRecords().records.filter((r) => r.referrer === a);
  return {
    address: a,
    handles: handlesOf(a),
    weeks: summarize(mine),
    totals: {
      trades: mine.length,
      wallets: new Set(mine.map((r) => r.wallet)).size,
      volumeUsd: mine.reduce((s, r) => s + r.volumeUsd, 0),
      protocolFeeUsd: mine.reduce((s, r) => s + r.protocolFeeUsd, 0),
    },
    recent: mine
      .slice()
      .sort((x, y) => y.time - x.time)
      .slice(0, 25)
      .map((r) => ({ chainId: r.chainId, txHash: r.txHash, time: r.time, symbol: r.symbol, isBuy: r.isBuy, wallet: r.wallet, volumeUsd: r.volumeUsd, source: r.source })),
  };
}

/** Angka program secara keseluruhan, untuk halaman publik: tidak ada alamat di dalamnya. */
export function programTotals() {
  const all = loadRecords().records;
  return {
    referrers: new Set(all.map((r) => r.referrer)).size,
    wallets: new Set(all.map((r) => r.wallet)).size,
    trades: all.length,
    volumeUsd: all.reduce((s, r) => s + r.volumeUsd, 0),
  };
}

/** Baris CSV untuk owner yang membayar, satu per perujuk untuk minggu `week` (`YYYY-MM-DD`). */
export function weekCsv(week: string): string {
  const rows = summarize(loadRecords().records.filter((r) => r.week === week));
  const head = "week,referrer,handles,trades,unique_wallets,volume_usd,protocol_fee_usd,reward_usd,meets_minimum";
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const body = rows.map((r) =>
    [r.week, r.referrer, esc(r.handles.join(" ")), r.trades, r.wallets, r.volumeUsd.toFixed(4), r.protocolFeeUsd.toFixed(6), r.rewardUsd.toFixed(6), r.meetsMinimum].join(",")
  );
  return [head, ...body].join("\n") + "\n";
}

/** Minggu yang punya catatan, terbaru dulu. */
export function recordedWeeks(): string[] {
  return [...new Set(loadRecords().records.map((r) => r.week))].sort().reverse();
}
