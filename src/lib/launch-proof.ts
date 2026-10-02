/**
 * Bukti launch bersih untuk satu pasar, dibaca dari chain.
 *
 * Antarmuka bersama (README rencana §4): Plan 1 memakai `readLaunchProof`/`getLaunchProof` untuk
 * faktor "launch" di Agent Score, halaman token memakainya untuk panel "Clean launch", dan kartu
 * bagikan bukti memakainya untuk gambarnya. Satu pembaca, supaya ketiganya tidak bisa menyebut
 * fakta berbeda tentang peluncuran yang sama.
 *
 * YANG DIBUKTIKAN, DAN DARI MANA
 *
 * Semua dari chain, tidak ada yang dari registry selain hash tx peluncuran (dan hash itu sendiri
 * diperiksa: receipt-nya harus memuat `TrinityProjectDeployed` dari factory pasar ini untuk token ini).
 *
 * - Saldo creator sesudah tx peluncuran, dari log `Transfer` di receipt. Token belum ada sebelum tx
 *   itu, jadi jumlah bersih Transfer ke creator di dalamnya ADALAH saldonya saat launch. Tidak butuh
 *   node arsip: `balanceOf(creator, blockTag)` ditolak RPC publik Arbitrum, Robinhood dan Base.
 * - Seluruh suplai masuk kurva dan factory memegang nol sesudahnya, dari receipt yang sama.
 * - Wallet yang dikecualikan dari batas launch. Tidak ada getter untuknya (`_launcher` private), jadi
 *   daftarnya berasal dari kode generasi itu, dan yang DIBACA adalah keterkaitannya: factory pasar ini
 *   adalah factory ADEXTO yang dikenal untuk chain ini, `VERSION()` cocok, `curveOf(token)` adalah kurva
 *   ini, dan `sovereignDexHook()` token menunjuk kurva yang sama.
 * - Jendela launch dan batasnya, dari konstanta dan immutable token.
 * - Pembagian fee, dari immutable kurva.
 * - Tidak ada owner: `owner()` revert di token, kurva dan factory. Tidak ada proxy: slot EIP-1967
 *   kosong dan kodenya bukan minimal proxy EIP-1167.
 * - Apakah creator membeli selama jendela launch, dari event `Swap` kurva dengan creator sebagai
 *   trader atau penerima. Ini fakta tambahan di luar bentuk antarmuka; creator yang membeli lewat
 *   wallet lain tidak terlihat oleh pemeriksaan apa pun, dan teks UI tidak mengklaim sebaliknya.
 *
 * DUA GENERASI, DAN YANG TIDAK DIKLAIM
 *
 * `1.0.0` (v1): jendela 180 detik, tiap penerima maksimal 1% suplai; pengecualian hanya alamat nol,
 * kurva dan factory. `0.11.0`: 5 blok, tiap TRANSFER maksimal 1%; pengecualian hanya factory. Di
 * Arbitrum dan Robinhood `block.number` di Solidity adalah nomor blok Ethereum L1, jadi "5 blok" di
 * sana berarti lima blok Ethereum (sekitar satu menit) — terukur: `launchBlock()` WOMBO sama dengan
 * `l1BlockNumber` blok peluncurannya, bukan nomor blok L2-nya. Generasi lain (0.10.0, 0.12.0, factory
 * yang tidak dikenal) mendapat `supported: false` dan tidak ada klaim sama sekali.
 */
import { Contract, Interface, ethers, type JsonRpcProvider } from "ethers";
import { chainFromId, logReadProvider, readProvider, type ChainInfo } from "@/lib/chains";
import { findProject } from "@/lib/registry";
import { logSpanFor } from "@/lib/onchain-trades";

export const LAUNCH_PROOF_VERSION = 1 as const;

export type LaunchProofGeneration = "1.0.0" | "0.11.0";

export interface ExemptWallet {
  address: string;
  role: "burn" | "curve" | "factory";
}

export interface LaunchWindow {
  /** v1: batas saldo per wallet selama sekian detik. 0.11.0: batas per transfer selama sekian blok. */
  kind: "wallet-cap-seconds" | "tx-cap-blocks";
  seconds: number | null;
  blocks: number | null;
  /** Jam yang dipakai kontrak: timestamp blok, nomor blok chain itu, atau nomor blok Ethereum L1. */
  clock: "timestamp" | "chain-blocks" | "ethereum-blocks";
  /** Batasnya dalam bps suplai (100 = 1%). */
  capBps: number;
  /** Batasnya dalam unit terkecil token, desimal. */
  capAmount: string;
  /** Unix detik saat jendela berakhir (v1), atau null bila jendelanya dihitung dalam blok. */
  endsAt: number | null;
}

export interface FeeSplit {
  totalBps: number;
  creatorBps: number;
  depthBps: number;
  buybackBps: number;
  protocolBps: number;
  /** v1 memotong kaki protokol DARI total yang dipilih creator; 0.11.0 menambahkannya di atasnya. */
  protocolLeg: "included" | "on-top";
}

export interface CreatorWindowActivity {
  /** Pembelian dengan creator sebagai `trader` atau `recipient` di dalam jendela launch. */
  buys: number;
  /** Token yang diterima dari pembelian itu, unit terkecil. */
  tokensBought: string;
  /** Hash tx pembelian itu (paling banyak sepuluh), supaya bisa diperiksa di explorer. */
  txs: string[];
  /** False selama jendelanya masih berjalan atau belum terpindai sampai akhir. */
  complete: boolean;
}

export type LaunchProofCheckId =
  | "creator-zero"
  | "supply-in-curve"
  | "no-exemptions"
  | "launch-window"
  | "creator-window"
  | "fees-fixed"
  | "no-owner";

export interface LaunchProofCheck {
  id: LaunchProofCheckId;
  /**
   * Fakta yang diungkapkan tapi tidak ikut menentukan `clean`. Hanya "creator-window": creator
   * tunduk pada batas launch yang sama dengan semua orang (tidak dikecualikan), jadi pembelian
   * kecilnya di jendela itu diungkap apa adanya, bukan dihitung sebagai hak istimewa.
   */
  informational?: boolean;
  /** null = belum bisa diputuskan (jendela masih berjalan). */
  ok: boolean | null;
  label: string;
  detail: string;
}

export interface LaunchProof {
  version: typeof LAUNCH_PROOF_VERSION;
  supported: true;
  chainId: number;
  token: string;
  curve: string;
  factory: string;
  generation: LaunchProofGeneration;
  decimals: number;
  launch: {
    txHash: string;
    /** Nomor blok chain ini (bukan `launchBlock()` token, yang di Arbitrum/Robinhood adalah blok L1). */
    blockNumber: number;
    timestamp: number;
    creator: string;
    /** `from` tx peluncuran. */
    sender: string;
  };
  /** Saldo creator sesudah tx peluncuran, unit terkecil. "0" untuk peluncuran bersih. */
  creatorHeldAtLaunch: string;
  /** Suplai yang di-mint di tx peluncuran, dan bagian yang berakhir di kurva. */
  mintedAtLaunch: string;
  curveReceivedAtLaunch: string;
  /** Saldo factory sesudah tx peluncuran (kontraknya me-revert bila bukan nol). */
  factoryHeldAfterLaunch: string;
  creatorWindow: CreatorWindowActivity;
  exemptWallets: ExemptWallet[];
  /** Panjang jendela dalam detik; null untuk 0.11.0, yang jendelanya dihitung dalam blok. */
  launchWindowSeconds: number | null;
  launchWindow: LaunchWindow;
  feeSplit: FeeSplit;
  /** Selalu null untuk pasar yang didukung; diisi alamat bila `owner()` ternyata menjawab. */
  owner: string | null;
  /** Tidak ada owner, tidak ada proxy, dan generasinya tidak punya setter. */
  immutable: boolean;
  checks: LaunchProofCheck[];
  /** Semua pemeriksaan yang tidak `informational` bernilai `ok === true`. */
  clean: boolean;
  /** True bila tidak ada lagi yang bisa berubah (jendela sudah lewat dan terpindai); aman di-cache selamanya. */
  final: boolean;
  computedAt: number;
}

export interface LaunchProofUnsupported {
  version: typeof LAUNCH_PROOF_VERSION;
  supported: false;
  chainId: number;
  token: string;
  generation: string | null;
  reason: string;
  computedAt: number;
}

export type LaunchProofResult = LaunchProof | LaunchProofUnsupported;

const TOKEN_ABI = [
  "function sovereignDexHook() view returns (address)",
  "function decimals() view returns (uint8)",
  "function ANTI_SNIPE_WINDOW() view returns (uint256)",
  "function maxWalletAmount() view returns (uint256)",
  "function launchTime() view returns (uint256)",
  "function ANTI_SNIPE_BLOCKS() view returns (uint256)",
  "function maxTxAmount() view returns (uint256)",
  "function launchBlock() view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];
const CURVE_ABI = [
  "function VERSION() view returns (string)",
  "function factory() view returns (address)",
  "function creator() view returns (address)",
  "function targetToken() view returns (address)",
  "function depthFeeBps() view returns (uint256)",
  "function creatorFeeBps() view returns (uint256)",
  "function treasuryBuybackBps() view returns (uint256)",
  "function protocolFeeBps() view returns (uint256)",
  "function totalFeeBps() view returns (uint256)",
  // Sama untuk 0.11.0 dan 1.0.0: sebelas field. 0.10.0 punya sepuluh, dan tidak didukung di sini.
  "event Swap(address indexed trader, address indexed recipient, bool isBuy, uint256 amountIn, uint256 amountOut, uint256 depthFee, uint256 creatorFee, uint256 treasuryFee, uint256 protocolFee, uint256 nativeReserveAfter, uint256 tokenReserveAfter)",
];
const FACTORY_ABI = [
  "function VERSION() view returns (string)",
  "function curveOf(address token) view returns (address)",
  "event TrinityProjectDeployed(address indexed token, address indexed curve, address indexed creator, string name, string symbol, uint256 initialSupply, uint256 curveTokens, uint256 virtualNative, uint256 depthFeeBps, uint256 creatorFeeBps, uint256 treasuryBuybackBps, bytes32 metadataRoot)",
];

const TOKEN_IFACE = new Interface(TOKEN_ABI);
const CURVE_IFACE = new Interface(CURVE_ABI);
const FACTORY_IFACE = new Interface(FACTORY_ABI);
const TRANSFER_TOPIC = TOKEN_IFACE.getEvent("Transfer")!.topicHash;
const SWAP_TOPIC = CURVE_IFACE.getEvent("Swap")!.topicHash;
const DEPLOYED_TOPIC = FACTORY_IFACE.getEvent("TrinityProjectDeployed")!.topicHash;
const OWNER_SELECTOR = ethers.id("owner()").slice(0, 10);

const ZERO = ethers.ZeroAddress;
/** keccak("eip1967.proxy.implementation") - 1 dan keccak("eip1967.proxy.beacon") - 1. */
const EIP1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const EIP1967_BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582cfb5d6d50";
const EIP1167_PREFIX = "0x363d3d373d3d3d363d73";

/** Batas pemindaian jendela launch, supaya satu pembacaan tidak bisa berputar tanpa akhir. */
const WINDOW_CHUNK_BLOCKS = 1_000;
const MAX_WINDOW_CHUNKS = 24;

const lower = (a: string) => a.toLowerCase();
const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && lower(a) === lower(b));
const topicAddress = (a: string) => ethers.zeroPadValue(lower(a), 32);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

function unsupported(chainId: number, token: string, generation: string | null, reason: string): LaunchProofUnsupported {
  return { version: LAUNCH_PROOF_VERSION, supported: false, chainId, token, generation, reason, computedAt: Math.floor(Date.now() / 1000) };
}

function isRevert(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "CALL_EXCEPTION";
}

/** `fn()` yang revert menjadi null; kegagalan jaringan tetap dilempar, supaya tidak terbaca sebagai "tidak ada". */
async function optional<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    if (isRevert(error)) return null;
    throw error;
  }
}

/** Alamat yang dijawab `owner()`, atau null bila kontraknya tidak punya fungsi itu. */
async function ownerOf(provider: JsonRpcProvider, address: string): Promise<string | null> {
  const data = await optional(() => provider.call({ to: address, data: OWNER_SELECTOR }));
  if (!data || data === "0x" || data.length < 66) return null;
  return ethers.getAddress(ethers.dataSlice(data, 12, 32));
}

async function isProxy(provider: JsonRpcProvider, address: string): Promise<boolean> {
  const [impl, beacon, code] = await Promise.all([
    provider.getStorage(address, EIP1967_IMPLEMENTATION_SLOT),
    provider.getStorage(address, EIP1967_BEACON_SLOT),
    provider.getCode(address),
  ]);
  return BigInt(impl) !== 0n || BigInt(beacon) !== 0n || lower(code).startsWith(EIP1167_PREFIX);
}

interface RawBlock {
  number: number;
  timestamp: number;
  /** Nomor blok Ethereum L1 di chain Arbitrum (termasuk Orbit); null di chain lain. */
  l1BlockNumber: number | null;
}

async function rawBlock(provider: JsonRpcProvider, n: number): Promise<RawBlock> {
  const b = await provider.send("eth_getBlockByNumber", [ethers.toQuantity(n), false]);
  if (!b) throw new Error(`block ${n} not available`);
  return {
    number: Number(b.number),
    timestamp: Number(b.timestamp),
    l1BlockNumber: b.l1BlockNumber ? Number(b.l1BlockNumber) : null,
  };
}

/** Factory ADEXTO yang dikenal untuk generasi ini di chain ini, atau null. */
function knownFactory(chain: ChainInfo, generation: LaunchProofGeneration): string | null {
  return generation === "1.0.0" ? chain.curveFactoryAddress : chain.supersededCurveFactoryAddress;
}

export interface ReadLaunchProofInput {
  chain: ChainInfo;
  token: string;
  /** Hash tx peluncuran. Diverifikasi terhadap receipt-nya, bukan dipercaya. */
  launchTxHash: string;
}

/**
 * Baca bukti launch untuk satu pasar. Tidak menulis apa pun dan tidak memakai cache; pemanggil yang
 * butuh cache memakai `getLaunchProof`.
 *
 * Melempar bila RPC gagal. Mengembalikan `supported: false` bila pasar ini bukan generasi yang
 * aturannya kami ketahui, supaya tidak ada klaim yang tidak berlaku untuknya.
 */
export async function readLaunchProof(input: ReadLaunchProofInput): Promise<LaunchProofResult> {
  const { chain } = input;
  if (!ethers.isAddress(input.token)) return unsupported(chain.chainId, input.token, null, "Not a token address.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.launchTxHash)) {
    return unsupported(chain.chainId, input.token, null, "No launch transaction is known for this market.");
  }
  const token = ethers.getAddress(input.token);
  const calls = readProvider(chain);
  const logs = logReadProvider(chain);
  const tokenC = new Contract(token, TOKEN_ABI, calls);

  const curveAddr = await optional<string>(() => tokenC.sovereignDexHook());
  if (!curveAddr || curveAddr === ZERO) return unsupported(chain.chainId, token, null, "Not an ADEXTO curve token.");
  const curve = ethers.getAddress(curveAddr);
  const curveC = new Contract(curve, CURVE_ABI, calls);
  const version = await optional<string>(() => curveC.VERSION());
  if (version !== "1.0.0" && version !== "0.11.0") {
    return unsupported(
      chain.chainId,
      token,
      version,
      version
        ? `Curve generation ${version} is not covered by the clean-launch proof.`
        : "This curve predates VERSION() and is not covered by the clean-launch proof."
    );
  }
  const generation: LaunchProofGeneration = version;

  const [factoryAddr, creatorAddr, targetToken, depth, creatorFee, buyback, protocol, total] = await Promise.all([
    curveC.factory() as Promise<string>,
    curveC.creator() as Promise<string>,
    curveC.targetToken() as Promise<string>,
    curveC.depthFeeBps() as Promise<bigint>,
    curveC.creatorFeeBps() as Promise<bigint>,
    curveC.treasuryBuybackBps() as Promise<bigint>,
    curveC.protocolFeeBps() as Promise<bigint>,
    curveC.totalFeeBps() as Promise<bigint>,
  ]);
  const factory = ethers.getAddress(factoryAddr);
  const creator = ethers.getAddress(creatorAddr);
  const expectedFactory = knownFactory(chain, generation);
  if (!same(factory, expectedFactory)) {
    return unsupported(chain.chainId, token, generation, `The curve's factory ${factory} is not the ADEXTO ${generation} factory on ${chain.name}.`);
  }
  if (!same(targetToken, token)) return unsupported(chain.chainId, token, generation, "The curve is bound to a different token.");
  const factoryC = new Contract(factory, FACTORY_ABI, calls);
  const [factoryVersion, curveOf] = await Promise.all([
    factoryC.VERSION() as Promise<string>,
    factoryC.curveOf(token) as Promise<string>,
  ]);
  if (factoryVersion !== generation || !same(curveOf, curve)) {
    return unsupported(chain.chainId, token, generation, "The factory does not list this token with this curve.");
  }

  // Receipt peluncuran: harus berhasil, dari factory ini, untuk token dan kurva ini.
  const [receipt, tx] = await Promise.all([
    logs.getTransactionReceipt(input.launchTxHash),
    logs.getTransaction(input.launchTxHash),
  ]);
  if (!receipt || !tx || receipt.status !== 1) {
    return unsupported(chain.chainId, token, generation, "The recorded launch transaction was not found or did not succeed.");
  }
  const deployed = receipt.logs.find(
    (l) => same(l.address, factory) && l.topics[0] === DEPLOYED_TOPIC && same(ethers.dataSlice(l.topics[1], 12), token) && same(ethers.dataSlice(l.topics[2], 12), curve)
  );
  if (!deployed) {
    return unsupported(chain.chainId, token, generation, "The recorded transaction is not this market's launch.");
  }

  // Saldo bersih per alamat di dalam tx peluncuran. Token lahir di tx ini, jadi ini saldo sesudahnya.
  const net = new Map<string, bigint>();
  let minted = 0n;
  for (const l of receipt.logs) {
    if (!same(l.address, token) || l.topics[0] !== TRANSFER_TOPIC) continue;
    const from = lower(ethers.dataSlice(l.topics[1], 12));
    const to = lower(ethers.dataSlice(l.topics[2], 12));
    const value = BigInt(l.data);
    if (from === ZERO) minted += value;
    else net.set(from, (net.get(from) ?? 0n) - value);
    if (to !== ZERO) net.set(to, (net.get(to) ?? 0n) + value);
  }
  const creatorHeld = net.get(lower(creator)) ?? 0n;
  const curveReceived = net.get(lower(curve)) ?? 0n;
  const factoryHeld = net.get(lower(factory)) ?? 0n;

  const launchBlock = await rawBlock(logs, receipt.blockNumber);
  const decimals = Number(await tokenC.decimals());

  // Jendela launch, dari kode token generasi ini.
  let window: LaunchWindow;
  let exemptWallets: ExemptWallet[];
  /** `launchBlock()` token 0.11.0, dalam jam yang dipakai kontraknya. */
  let tokenLaunchClock: number | null = null;
  if (generation === "1.0.0") {
    const [seconds, cap, launchTime] = await Promise.all([
      tokenC.ANTI_SNIPE_WINDOW() as Promise<bigint>,
      tokenC.maxWalletAmount() as Promise<bigint>,
      tokenC.launchTime() as Promise<bigint>,
    ]);
    window = {
      kind: "wallet-cap-seconds",
      seconds: Number(seconds),
      blocks: null,
      clock: "timestamp",
      capBps: minted > 0n ? Number((cap * 10_000n) / minted) : 0,
      capAmount: cap.toString(),
      endsAt: Number(launchTime) + Number(seconds),
    };
    exemptWallets = [
      { address: ZERO, role: "burn" },
      { address: curve, role: "curve" },
      { address: factory, role: "factory" },
    ];
  } else {
    const [blocks, cap, tokenLaunchBlock] = await Promise.all([
      tokenC.ANTI_SNIPE_BLOCKS() as Promise<bigint>,
      tokenC.maxTxAmount() as Promise<bigint>,
      tokenC.launchBlock() as Promise<bigint>,
    ]);
    tokenLaunchClock = Number(tokenLaunchBlock);
    // `launchBlock()` sama dengan nomor blok chain di 0G/Base/Monad, dan sama dengan blok L1 di
    // Arbitrum. Dicocokkan, bukan diasumsikan dari chainId.
    const clock: LaunchWindow["clock"] =
      Number(tokenLaunchBlock) === receipt.blockNumber
        ? "chain-blocks"
        : launchBlock.l1BlockNumber !== null && Number(tokenLaunchBlock) === launchBlock.l1BlockNumber
        ? "ethereum-blocks"
        : "chain-blocks";
    window = {
      kind: "tx-cap-blocks",
      seconds: null,
      blocks: Number(blocks),
      clock,
      capBps: minted > 0n ? Number((cap * 10_000n) / minted) : 0,
      capAmount: cap.toString(),
      endsAt: null,
    };
    exemptWallets = [{ address: factory, role: "factory" }];
  }

  const [tokenOwner, curveOwner, factoryOwner, tokenProxy, curveProxy] = await Promise.all([
    ownerOf(calls, token),
    ownerOf(calls, curve),
    ownerOf(calls, factory),
    isProxy(calls, token),
    isProxy(calls, curve),
  ]);
  const owner = tokenOwner ?? curveOwner ?? factoryOwner;
  const immutable = owner === null && !tokenProxy && !curveProxy;

  const creatorWindow = await readCreatorWindow({
    chain,
    provider: logs,
    curve,
    creator,
    launch: launchBlock,
    window,
    tokenLaunchClock,
  });

  const feeSplit: FeeSplit = {
    totalBps: Number(total),
    creatorBps: Number(creatorFee),
    depthBps: Number(depth),
    buybackBps: Number(buyback),
    protocolBps: Number(protocol),
    protocolLeg: generation === "1.0.0" ? "included" : "on-top",
  };

  const checks = buildChecks({
    generation,
    creator,
    creatorHeld,
    minted,
    curveReceived,
    factoryHeld,
    window,
    creatorWindow,
    decimals,
    feeSplit,
    owner,
    tokenProxy,
    curveProxy,
  });
  const clean = checks.every((c) => c.informational || c.ok === true);
  return {
    version: LAUNCH_PROOF_VERSION,
    supported: true,
    chainId: chain.chainId,
    token,
    curve,
    factory,
    generation,
    decimals,
    launch: {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      timestamp: launchBlock.timestamp,
      creator,
      sender: ethers.getAddress(tx.from),
    },
    creatorHeldAtLaunch: creatorHeld.toString(),
    mintedAtLaunch: minted.toString(),
    curveReceivedAtLaunch: curveReceived.toString(),
    factoryHeldAfterLaunch: factoryHeld.toString(),
    creatorWindow,
    exemptWallets,
    launchWindowSeconds: window.seconds,
    launchWindow: window,
    feeSplit,
    owner,
    immutable,
    checks,
    clean,
    final: creatorWindow.complete,
    computedAt: Math.floor(Date.now() / 1000),
  };
}

/**
 * Pembelian creator selama jendela launch: event `Swap` kurva dengan creator sebagai `trader`
 * (msg.sender) atau `recipient`, dari blok peluncuran sampai blok pertama yang sudah di luar jendela.
 * Dua kueri satu-nilai, bukan satu kueri dengan dua posisi: RPC Robinhood memangkas rentang filter
 * bernilai banyak (lihat `logSpanFor`).
 */
async function readCreatorWindow(p: {
  chain: ChainInfo;
  provider: JsonRpcProvider;
  curve: string;
  creator: string;
  launch: RawBlock;
  window: LaunchWindow;
  tokenLaunchClock: number | null;
}): Promise<CreatorWindowActivity> {
  const { provider, window } = p;
  const head = await provider.getBlockNumber();
  const chunk = Math.max(1, Math.min(WINDOW_CHUNK_BLOCKS, logSpanFor(p.chain.chainId)));

  // Apakah blok `b` masih di dalam jendela, menurut jam yang dipakai kontrak.
  const inside = (b: RawBlock): boolean => {
    if (window.kind === "wallet-cap-seconds") return b.timestamp < (window.endsAt ?? 0);
    const last = (p.tokenLaunchClock ?? p.launch.number) + (window.blocks ?? 0);
    if (window.clock === "ethereum-blocks") return (b.l1BlockNumber ?? Number.POSITIVE_INFINITY) <= last;
    return b.number <= last;
  };

  const matches: Array<{ blockNumber: number; txHash: string; isBuy: boolean; amountOut: bigint }> = [];
  const seen = new Set<string>();
  let from = p.launch.number;
  let complete = false;
  for (let i = 0; i < MAX_WINDOW_CHUNKS && from <= head; i++) {
    // Jendela berbasis blok chain diketahui ujungnya tanpa membaca header.
    const blockBound = window.kind === "tx-cap-blocks" && window.clock === "chain-blocks" ? p.launch.number + (window.blocks ?? 0) : null;
    const to = Math.min(head, from + chunk - 1, blockBound ?? Number.POSITIVE_INFINITY);
    for (const position of [1, 2] as const) {
      const topics: Array<string | null> = [SWAP_TOPIC, null, null];
      topics[position] = topicAddress(p.creator);
      const found = await provider.getLogs({ address: p.curve, topics, fromBlock: from, toBlock: to });
      for (const l of found) {
        const key = `${l.transactionHash}_${l.index}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const parsed = CURVE_IFACE.parseLog({ topics: [...l.topics], data: l.data });
        if (!parsed) continue;
        matches.push({ blockNumber: l.blockNumber, txHash: l.transactionHash, isBuy: Boolean(parsed.args.isBuy), amountOut: BigInt(parsed.args.amountOut) });
      }
    }
    if (blockBound !== null && to >= blockBound) {
      complete = true;
      break;
    }
    const end = await rawBlock(provider, to);
    if (!inside(end)) {
      complete = true;
      break;
    }
    from = to + 1;
  }

  // Hanya pembelian yang bloknya benar-benar di dalam jendela.
  let buys = 0;
  let tokensBought = 0n;
  const txs: string[] = [];
  const blocks = new Map<number, RawBlock>();
  for (const m of matches) {
    if (!m.isBuy) continue;
    let b = blocks.get(m.blockNumber);
    if (!b) {
      b = await rawBlock(provider, m.blockNumber);
      blocks.set(m.blockNumber, b);
    }
    if (!inside(b)) continue;
    buys += 1;
    tokensBought += m.amountOut;
    if (txs.length < 10 && !txs.includes(m.txHash)) txs.push(m.txHash);
  }
  return { buys, tokensBought: tokensBought.toString(), txs, complete };
}

/** Bagian suplai sebagai persen yang terbaca: "<0.01%" alih-alih "0.00%" untuk jumlah kecil yang bukan nol. */
function shareOf(amount: bigint, supply: bigint): string {
  if (supply === 0n || amount === 0n) return "0%";
  const bps100 = Number((amount * 1_000_000n) / supply) / 10_000; // persen, empat desimal
  return bps100 < 0.01 ? "<0.01%" : `${bps100.toFixed(2)}%`;
}

function tokens(amount: bigint, decimals: number): string {
  const whole = Number(ethers.formatUnits(amount, decimals));
  return whole.toLocaleString("en-US", { maximumFractionDigits: whole < 1 ? 6 : 0 });
}

function buildChecks(p: {
  generation: LaunchProofGeneration;
  creator: string;
  creatorHeld: bigint;
  minted: bigint;
  curveReceived: bigint;
  factoryHeld: bigint;
  window: LaunchWindow;
  creatorWindow: CreatorWindowActivity;
  decimals: number;
  feeSplit: FeeSplit;
  owner: string | null;
  tokenProxy: boolean;
  curveProxy: boolean;
}): LaunchProofCheck[] {
  const w = p.window;
  const cap = pct(w.capBps);
  const windowLabel =
    w.kind === "wallet-cap-seconds"
      ? `${w.seconds}-second launch window: no wallet above ${cap} of supply`
      : `First ${w.blocks} ${w.clock === "ethereum-blocks" ? "Ethereum blocks" : "blocks"}: no transfer above ${cap} of supply`;
  const windowDetail =
    w.kind === "wallet-cap-seconds"
      ? `During the first ${w.seconds} seconds every receiving wallet must end each transfer holding at most ${cap} of supply.`
      : w.clock === "ethereum-blocks"
      ? `For ${w.blocks} Ethereum L1 blocks after launch (about a minute; the token reads block.number, which is the L1 block here) every transfer was capped at ${cap} of supply. The cap was per transfer, not per wallet.`
      : `For ${w.blocks} blocks after launch every transfer was capped at ${cap} of supply. The cap was per transfer, not per wallet.`;

  const f = p.feeSplit;
  const legs = `creator ${pct(f.creatorBps)} · depth ${pct(f.depthBps)} · buyback & burn ${pct(f.buybackBps)} · protocol ${pct(f.protocolBps)}`;
  const feeDetail =
    f.protocolLeg === "included"
      ? `${legs}. The protocol leg is part of the total. Every rate is immutable on the curve; there is no setter.`
      : `${legs}. The protocol leg is charged on top of the ${pct(f.totalBps - f.protocolBps)} the creator set. Every rate is immutable on the curve; there is no setter.`;

  const cw = p.creatorWindow;
  const creatorWindowCheck: LaunchProofCheck = !cw.complete
    ? {
        id: "creator-window",
        ok: null,
        informational: true,
        label: "Creator buys during the launch window: still open",
        detail: "The launch window has not been fully scanned yet. This line settles once it has passed.",
      }
    : cw.buys === 0
    ? {
        id: "creator-window",
        ok: true,
        informational: true,
        label: "Creator did not buy during the launch window",
        detail: `No swap on the curve during the launch window had the creator ${short(p.creator)} as buyer or recipient. A buy from another wallet would not show here.`,
      }
    : {
        id: "creator-window",
        ok: false,
        informational: true,
        label: `Creator bought ${shareOf(BigInt(cw.tokensBought), p.minted)} of supply during the launch window`,
        detail: `${cw.buys} buy${cw.buys === 1 ? "" : "s"} by or to the creator ${short(p.creator)} in the window, ${tokens(BigInt(cw.tokensBought), p.decimals)} tokens. The creator is not exempt: the same launch limit applied to these buys as to everyone else's.`,
      };

  const exemptDetail =
    p.generation === "1.0.0"
      ? `Only three addresses skip the wallet limit: the burn address, the curve and the factory. The factory held ${tokens(p.factoryHeld, p.decimals)} tokens after the launch transaction, and the contract has no function that gives it more.`
      : `Only the factory skips the transfer cap, so it could move the supply into the curve. It held ${tokens(p.factoryHeld, p.decimals)} tokens after the launch transaction.`;

  return [
    {
      id: "creator-zero",
      ok: p.creatorHeld === 0n,
      label: p.creatorHeld === 0n ? "Creator held 0 tokens at launch" : "Creator received tokens at launch",
      detail:
        p.creatorHeld === 0n
          ? `No Transfer in the launch transaction reached the creator ${short(p.creator)}. The token did not exist before it, so that is the creator's balance at launch.`
          : `The launch transaction left the creator ${short(p.creator)} with ${tokens(p.creatorHeld, p.decimals)} tokens.`,
    },
    {
      id: "supply-in-curve",
      ok: p.minted > 0n && p.curveReceived === p.minted && p.factoryHeld === 0n,
      label: p.curveReceived === p.minted ? "100% of supply went into the curve" : "Not all supply went into the curve",
      detail: `${tokens(p.minted, p.decimals)} tokens minted and ${tokens(p.curveReceived, p.decimals)} credited to the curve in the launch transaction.`,
    },
    {
      id: "no-exemptions",
      ok: p.factoryHeld === 0n,
      // Bukan "no wallet is exempt": tiga alamat memang dikecualikan, dan detailnya menyebut mereka.
      label: p.generation === "1.0.0" ? "Only contracts are exempt from the launch limit" : "Only the factory is exempt from the launch cap",
      detail: exemptDetail,
    },
    { id: "launch-window", ok: true, label: windowLabel, detail: windowDetail },
    creatorWindowCheck,
    { id: "fees-fixed", ok: true, label: `Fees fixed forever: ${pct(f.totalBps)} per swap`, detail: feeDetail },
    {
      id: "no-owner",
      ok: p.owner === null && !p.tokenProxy && !p.curveProxy,
      label: p.owner === null ? "No owner, no proxy" : `Owned by ${short(p.owner)}`,
      detail:
        p.owner === null && !p.tokenProxy && !p.curveProxy
          ? "owner() reverts on the token, the curve and the factory, and neither the token nor the curve is a proxy. Nobody can change these rules."
          : `owner() answered ${p.owner ?? "nothing"}; token proxy: ${p.tokenProxy}; curve proxy: ${p.curveProxy}.`,
    },
  ];
}

interface Slot {
  value: LaunchProofResult | null;
  at: number;
  running: Promise<LaunchProofResult> | null;
}

declare global {
  var __ADEXTO_LAUNCH_PROOF__: Map<string, Slot> | undefined;
}

function slots(): Map<string, Slot> {
  if (!globalThis.__ADEXTO_LAUNCH_PROOF__) globalThis.__ADEXTO_LAUNCH_PROOF__ = new Map();
  return globalThis.__ADEXTO_LAUNCH_PROOF__;
}

/** Hasil yang belum final (jendela masih berjalan) dibaca ulang paling cepat sekali per ini. */
const OPEN_TTL_MS = 15_000;
/** `supported: false` bisa berubah hanya bila registry berubah; dibaca ulang sesekali. */
const UNSUPPORTED_TTL_MS = 10 * 60_000;

/**
 * `readLaunchProof` untuk pasar di registry, dengan cache di memori. Bukti yang `final` tidak
 * pernah dibaca ulang: semua isinya adalah fakta tx peluncuran dan immutable kontrak.
 */
export async function getLaunchProof(chainId: number, tokenOrSlug: string): Promise<LaunchProofResult> {
  const chain = chainFromId(chainId);
  if (!chain) return unsupported(chainId, tokenOrSlug, null, "Unknown chain.");
  const project = findProject(tokenOrSlug, chainId);
  if (!project || project.chainId !== chain.chainId) {
    return unsupported(chain.chainId, tokenOrSlug, null, "Not an ADEXTO market on this chain.");
  }
  const key = `${chain.chainId}:${lower(project.tokenAddress)}`;
  let slot = slots().get(key);
  if (!slot) {
    slot = { value: null, at: 0, running: null };
    slots().set(key, slot);
  }
  const v = slot.value;
  const fresh =
    v &&
    ((v.supported && v.final) ||
      (v.supported && Date.now() - slot.at < OPEN_TTL_MS) ||
      (!v.supported && Date.now() - slot.at < UNSUPPORTED_TTL_MS));
  if (fresh && v) return v;
  if (!slot.running) {
    const current = slot;
    current.running = readLaunchProof({ chain, token: project.tokenAddress, launchTxHash: project.txHash ?? "" })
      .then((result) => {
        current.value = result;
        current.at = Date.now();
        return result;
      })
      .finally(() => {
        current.running = null;
      });
  }
  return slot.running!;
}
