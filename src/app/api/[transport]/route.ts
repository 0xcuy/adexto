/**
 * MCP server for ADEXTO — the x402 cross-chain buy, spoken in MCP.
 *
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 *
 * It is an ADAPTER. Every tool below forwards to something that already runs and is already
 * proven with real money: the x402 gateway at `x402.adexto.xyz`, the market registry at
 * `/api/graphql`, and the Envio indexer at `/api/indexer/graphql`.
 *
 * It does NOT reimplement x402. No signing, no settlement, no payment verification lives in
 * this file. That is a deliberate refusal: a second implementation of the payment contract
 * means two definitions of what a valid payment is, and the one that drifts is the one nobody
 * is testing. This project has already been bitten by exactly that shape — the consistency
 * guard kept its own copy of every RPC URL and therefore measured an endpoint the app had
 * stopped using.
 *
 * So the 402 challenge an agent receives here is byte-for-byte the challenge the gateway
 * issues, and the `X-PAYMENT` header is passed through untouched.
 *
 * WHY MCP AT ALL
 *
 * The gateway already speaks HTTP 402, which any program can use. What it does not do is
 * announce itself. An agent has to be told the URL, the path shape, and the ticker before it
 * can find anything. MCP is a discovery protocol: `tools/list` hands over the whole surface
 * with schemas, so an agent can find the markets, quote one, and pay for it without a human
 * pasting a curl command first.
 *
 * FOUR TRAPS TAKEN FROM A SIBLING IMPLEMENTATION'S POSTMORTEMS
 *
 *   1. No header mismatch. Its server reads `payment-signature` while its own SDK and README
 *      send `x-payment`, a mismatch still live over there. Here MCP always sends `X-PAYMENT`,
 *      and the gateway reads both `X-PAYMENT` and `PAYMENT-SIGNATURE` (the x402 v2 name) with
 *      either payload envelope, so a correctly signed payment is never ignored for its header
 *      name. Two different payments in the two headers are refused before verification.
 *   2. No default market. The gateway answers `400 symbol_required` on a missing ticker on
 *      purpose: a default would let a mistyped path bill someone for a token they never asked
 *      for. Every tool here therefore requires `symbol` and none supplies a fallback.
 *   3. Refuse before charging. `quote_buy` exists so an agent can read the price without
 *      paying, and the gateway's own refusals — unknown market, not tradable, out of
 *      inventory — all happen before an authorization is spent.
 *   4. Never swallow the gateway's status. A 402, 404, 409 or 503 is returned as structured
 *      content with the original body, because an agent that cannot tell "you must pay" from
 *      "this market does not exist" will retry the wrong one forever.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createMcpHandler } from "mcp-handler";
import { ethers } from "ethers";
/**
 * zod 4 lewat alias `zod-v4` (npm:zod@4.6.5), bukan `zod` root.
 *
 * SDK MCP v2 menuntut skema Standard Schema dengan `~standard.jsonSchema` (zod >= 4.2). zod root
 * TETAP 3.25.76: beberapa paket (abitype 0.7.1 di bawah graph-cli, hardhat, cdp-sdk) memegang
 * peer opsional zod ^3, dan begitu root naik ke 4, npm 10 di image Docker (node:20) menolak
 * lockfile yang ditulis npm 11 ("Missing: zod@3.25.76 from lock file") sementara npm 11 menghapus
 * salinan bersarang yang diminta npm 10. Dengan alias, kedua versi npm sepakat dan hanya berkas ini
 * yang memakai zod 4.
 */
import { z } from "zod-v4";
import { ADEXTO_CONTRACTS } from "@/config/contracts";
import { listProjects, type ProjectRecord } from "@/lib/registry";
import { resolveChainOrDefault } from "@/lib/chains";
import { readOnChainSwaps } from "@/lib/onchain-trades";
import { envioServes, readEnvioSwaps } from "@/lib/envio-indexer";
import { clientIp, rateLimit, rateLimitHeaders, secretEquals } from "@/lib/rate-limit";
import { BodyTooLargeError, IMAGE_JSON_BODY_BYTES, readTextBody } from "@/lib/body-limit";
import { AGENT_ACCESS_MAX_AGE_MS, agentAccessMessage, stakeForMarket, type MarketStake } from "@/config/market-stakes";
import { computeStakeForMarket, HUB_COMPUTE_SHARE_BPS } from "@/config/agent-compute";
import { MARKET_CATEGORIES } from "@/lib/categories";
import { prepareLaunch, registerLaunch, type IpHeaders } from "@/lib/agent-launch";
import { prepareClaim, prepareStake } from "@/lib/agent-tx";
import { MCP_OUTPUTS } from "@/lib/mcp-outputs";
// Versi server SATU sumber dengan entri MCP Registry dan kartu server, supaya ketiganya tidak berpisah.
import serverMeta from "../../../../server.json";

/**
 * Gateway x402, dari konstanta yang SAMA dengan yang dipakai UI.
 *
 * Sengaja BUKAN dari `NEXT_PUBLIC_EDGE_GATEWAY`. Variabel itu punya tiga nilai berbeda di
 * repo ini — `edge.adexto.xyz` di .env.example, sebuah URL workers.dev yang sudah mati di
 * .env.local, dan `x402.adexto.xyz` di kode — dan tidak ada satu pun berkas yang
 * membacanya. Route ini sempat membacanya dan langsung "fetch failed": env yang basi
 * mengalahkan nilai yang benar. Satu sumber, dan sumbernya yang diuji.
 */
const GATEWAY = ADEXTO_CONTRACTS.edgeX402Gateway.replace(/\/$/, "");
/** Hanya untuk menyebut endpoint publik di dalam jawaban, bukan untuk memanggil apa pun. */
const SITE = "https://adexto.xyz";

/**
 * Header per-permintaan, dibawa ke dalam callback alat.
 *
 * `registerTool` tidak menerima `Request`, jadi tanpa ini sebuah alat tidak punya cara
 * mengetahui siapa yang memanggilnya. Dipakai HANYA oleh `pay_and_buy`, satu-satunya alat
 * yang membelanjakan uang, supaya ia bisa menolak pemanggil yang tidak membawa kunci.
 *
 * `AsyncLocalStorage` dan bukan variabel modul: variabel modul akan bocor antar permintaan
 * yang tumpang tindih, dan yang bocor di sini adalah izin membelanjakan.
 */
const requestContext = new AsyncLocalStorage<{ agentKey: string | null; ipHeaders: IpHeaders }>();

/**
 * Header identitas jaringan pemanggil, diteruskan apa adanya ke tahap `prepare` Studio yang
 * dipanggil `prepare_launch` di dalam proses. Tanpa ini semua agen berbagi satu ember batas laju
 * (milik server sendiri); dengan ini setiap agen dibatasi persis seperti pengunjung Studio dari
 * IP yang sama. `clientIp` yang menilai mana yang boleh dipercaya, bukan berkas ini.
 */
const IP_HEADERS = ["x-peer-ip", "x-real-ip", "cf-connecting-ip", "x-forwarded-for"] as const;
function ipHeadersOf(request: Request): IpHeaders {
  const out: IpHeaders = {};
  for (const name of IP_HEADERS) {
    const value = request.headers.get(name);
    if (value) out[name] = value;
  }
  return out;
}

/**
 * Kunci keranjang pemanggil dari dalam callback alat, yang tidak menerima `Request`.
 * `clientIp` tetap satu-satunya yang menilai header mana yang boleh dipercaya.
 */
function callerIp(): string {
  const ctx = requestContext.getStore();
  return clientIp(new Request("http://mcp.internal/", { headers: ctx?.ipHeaders ?? {} }));
}

/**
 * Ticker menjadi slug gateway: huruf kecil, hanya `a-z0-9` — aturan yang sama dengan slug
 * registry (`symbol.toLowerCase().replace(/[^a-z0-9]/g, "")`).
 *
 * Sebelumnya ticker disisipkan mentah ke jalur URL gateway. `SYMBOL` hanya `z.string().min(1)`,
 * jadi `../../x?y=` diselesaikan `new URL()` menjadi jalur mana pun di host gateway, dan isi
 * jawabannya dikembalikan sebagai `challenge`. Host-nya tidak bisa berubah, tetapi alat
 * "kuotasi" tidak semestinya menjadi proxy ke jalur gateway yang lain.
 */
function gatewaySlug(symbol: unknown): string {
  return String(symbol).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Kunci yang harus dibawa pemanggil untuk memakai alat berbayar. Kosong = alat mati. */
const AGENT_DEMO_KEY = process.env.AGENT_DEMO_KEY ?? "";
/**
 * Kunci penanda tangan untuk `pay_and_buy`, dan ia SENGAJA TIDAK jatuh ke kunci deployer.
 *
 * Dulu baris ini `process.env.PRIVATE_KEY || process.env.OG_PRIVATE_KEY`, yaitu kunci
 * deployer. Itu bertentangan dengan keputusan yang sudah diambil untuk relayer x402: relayer
 * memakai operator terpisah `0xDe1f…C627` justru supaya blast radius-nya kecil, dan kunci
 * deployer sengaja tidak pernah ditaruh di Worker. Endpoint ini publik dan anonim kecuali
 * satu header, jadi ia adalah permukaan yang LEBIH terbuka daripada Worker, dan ia memegang
 * kunci yang lebih berharga.
 *
 * Apa yang sebenarnya bisa hilang: batas keras di bawah mengikat APA yang ditandatangani,
 * jadi bahkan kunci yang bocor hanya bisa menandatangani otorisasi EIP-3009 USDC ke treasury
 * kami sendiri. Yang tidak diikatnya adalah BERAPA KALI. Jadi kerugian maksimumnya adalah
 * seluruh saldo USDC dompet penanda tangan, terkuras 0,20 sekali jalan. Dengan kunci deployer
 * itu berarti saldo USDC dompet yang juga `creator` pasar-pasar hidup dan pemilik setiap
 * agent ERC-8004 kami. Dengan dompet khusus, kerugiannya adalah isi dompet itu saja.
 *
 * KOREKSI, DAN ANGKANYA DIUKUR BUKAN DIKIRA
 *
 * Revisi sebelum ini MEWAJIBKAN `AGENT_DEMO_PRIVATE_KEY` dan menolak jatuh ke kunci
 * deployer, dengan alasan "blast radius". Lalu paparannya diukur, dan alasan itu tidak
 * sebanding dengan harganya.
 *
 * Saldo USDC deployer di Base: **1,76 USDC**. Itulah seluruh plafon kerugiannya, karena alat
 * ini hanya bisa menghasilkan otorisasi EIP-3009 untuk USDC di Base, maksimum 0,20, ke
 * treasury kami sendiri — cocok dengan `PAY_LIMITS` di atas atau pembelian dibatalkan.
 * Kuncinya sendiri tidak pernah terpapar, dan tidak ada jalan dari sini ke posisi `creator`
 * pasar mana pun atau ke agent ERC-8004 kami. Pesan commit yang memperkenalkan perubahan itu
 * menyebut "seluruh saldo USDC dompet penanda tangan" lalu menambahkan bahwa dompet itu juga
 * creator dan pemilik agent — benar secara harfiah, tetapi menyusunnya begitu membuatnya
 * terbaca seolah kekuasaan itu ikut terancam. Tidak.
 *
 * Yang benar-benar mengunci risiko ini adalah `PAY_CALL_LIMIT` di bawah, bukan dompet mana
 * yang menandatangani: 10 panggilan per jam x 0,20 USDC = maksimum 2 USDC per jam, di bawah
 * saldo yang ada. Menukar dompet hanya menambah lapisan di atas batas itu, dan harganya
 * adalah fitur yang tadinya berjalan menjadi mati sampai dompet baru diisi.
 *
 * Jadi kunci deployer dipakai lagi — itu keputusan yang sudah diambil pemilik repo ini
 * dengan sadar ("pakai dompet yang sudah ada"), dan menimpanya tanpa bertanya adalah
 * kesalahan terpisah dari soal keamanannya.
 *
 * `AGENT_DEMO_PRIVATE_KEY` TETAP DIDAHULUKAN kalau diset, jadi pindah ke dompet khusus nanti
 * hanya perlu mengisi satu variabel env dan mendanainya — tanpa menyentuh kode ini lagi.
 */
const SIGNER_KEY =
  process.env.AGENT_DEMO_PRIVATE_KEY || process.env.PRIVATE_KEY || process.env.OG_PRIVATE_KEY || "";
/**
 * Batas JUMLAH panggilan, pelengkap `PAY_LIMITS` yang membatasi besarnya.
 *
 * `PAY_LIMITS` memastikan satu pembelian tidak bisa lebih dari 0,20 USDC dan uangnya hanya
 * bisa ke treasury kami. Ia tidak berkata apa pun soal seribu pembelian berturut-turut.
 * Dibatasi secara GLOBAL, bukan per IP: yang dijaga di sini adalah saldo dompet, dan saldo
 * itu satu untuk semua pemanggil — pembatasan per IP akan dilewati begitu saja dengan
 * berpindah IP.
 */
const PAY_CALL_LIMIT = 10;
const PAY_CALL_WINDOW_MS = 60 * 60 * 1000;

/**
 * Batas keras untuk `pay_and_buy`. Bukan saran — diperiksa terhadap kutipan gerbang, dan
 * satu ketidakcocokan membatalkan pembelian.
 *
 * Ini yang membuat alat itu aman diberikan kepada sebuah LLM. Agent tidak memilih penerima,
 * tidak memilih aset, dan tidak memilih jumlah; ketiganya dibaca dari kutipan gerbang lalu
 * dicocokkan dengan konstanta di bawah. Yang bisa dilakukan agent — bahkan agent yang
 * sepenuhnya dibajak lewat prompt injection — hanyalah membeli salah satu pasar KAMI
 * SENDIRI dengan maksimum 0,20 USDC, dan uangnya hanya bisa mendarat di treasury kami.
 */
const PAY_LIMITS = {
  /** USDC di Base. Aset lain ditolak. */
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".toLowerCase(),
  network: "base",
  /** Treasury protokol, dari `X402_PAYEE` di worker. TIDAK PERNAH dari masukan agent. */
  payTo: "0x24268Fffc119ec5550F68e80D94476fD64daE967".toLowerCase(),
  /** 0,20 USDC dalam satuan terkecil. Harga gerbang 0,10; ini memberi ruang satu kenaikan. */
  maxAtomic: 200_000n,
  chainId: 8453,
} as const;

/**
 * Teks JSON untuk klien lama, plus `structuredContent` untuk klien yang membaca `outputSchema`.
 *
 * `structuredContent` adalah round-trip JSON dari teks yang SAMA, bukan objek aslinya: dua
 * bentuk jawaban tidak boleh bisa berbeda, dan JSON sudah membuang `undefined` serta mengubah
 * NaN/Infinity menjadi null. Setiap alat punya `outputSchema` (src/lib/mcp-outputs.ts), dan SDK
 * memvalidasi `structuredContent` terhadapnya sebelum menjawab.
 */
const jsonResult = (value: unknown) => {
  const text = JSON.stringify(value, null, 2);
  const structured: unknown = JSON.parse(text);
  return {
    content: [{ type: "text" as const, text }],
    ...(structured && typeof structured === "object" && !Array.isArray(structured)
      ? { structuredContent: structured as Record<string, unknown> }
      : {}),
  };
};

/**
 * Ambil dari endpoint kita sendiri dan SELALU laporkan status aslinya.
 *
 * Membungkus 402/404/409/503 menjadi satu "gagal" adalah cara tercepat membuat agent
 * mengulang hal yang salah: "harus bayar" dan "pasar tidak ada" menuntut tindakan yang
 * berbeda sepenuhnya.
 */
async function passthrough(
  url: string,
  init?: RequestInit
): Promise<{ status: number; ok: boolean; body: unknown; raw: string }> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await res.text();
  let body: unknown = raw;
  try {
    body = JSON.parse(raw);
  } catch {
    // Biarkan sebagai teks: gateway pernah menjawab non-JSON pada jalur galat, dan
    // memaksanya menjadi objek akan menyembunyikan pesan aslinya.
  }
  return { status: res.status, ok: res.ok, body, raw };
}

/**
 * Baca registry LANGSUNG sebagai pustaka, bukan lewat HTTP ke `/api/graphql`.
 *
 * Versi pertama route ini memanggil situsnya sendiri lewat `NEXT_PUBLIC_APP_URL`. Itu
 * membuat server melakukan perjalanan keluar-masuk internet untuk data yang sudah ada di
 * dalam prosesnya, dan menambah satu env lagi yang bisa basi — persis kegagalan yang baru
 * saja terjadi pada URL gateway. `listProjects()` sinkron, jadi tidak ada yang hilang.
 */
function registryProjects(): ProjectRecord[] {
  return listProjects();
}

/**
 * Identitas agent ERC-8004 dalam bentuk yang ditulis ERC-8004 sendiri:
 * `agentRegistry = eip155:<chainId>:<registry>`, ditambah `agentId`. Sebuah id hanya unik
 * bersama chain dan registry-nya, jadi id tanpa keduanya tidak bisa dicari siapa pun.
 */
function agentIdentityOut(
  chainId: number,
  identity: { agentId: string; registry: string } | null | undefined,
  source: "token-contract" | "registry-copy" = "registry-copy"
) {
  if (!identity) return null;
  return {
    standard: "ERC-8004",
    agentId: identity.agentId,
    agentRegistry: `eip155:${chainId}:${identity.registry}`,
    source,
  };
}

/**
 * Apa yang dibuka stake sebuah pasar. Pasar yang terdaftar sebagai sumber Agent Compute juga
 * membuka kunci compute; sisanya hanya `ask_agent`.
 */
function stakeUnlocks(chainId: number, symbol: string, kind: MarketStake["kind"] = "dedicated"): string {
  if (kind === "hub") {
    return (
      `ask_agent, and an Agent Compute API key at https://adexto.xyz/agent-compute whose allowance is funded by this market's ` +
      `own trading: ${HUB_COMPUTE_SHARE_BPS / 100}% of the protocol fee its trades pay, shared by stake`
    );
  }
  return computeStakeForMarket(chainId, symbol)?.contract
    ? "ask_agent, and an Agent Compute API key at https://adexto.xyz/agent-compute"
    : "ask_agent";
}

/** Kontrak stake sebuah pasar, untuk `get_market`. Pasar tanpa kontrak sendiri memakai hub chain-nya. */
function stakeSummary(p: ProjectRecord) {
  const s = stakeForMarket(p);
  if (!s) return null;
  return {
    contract: s.contract,
    kind: s.kind ?? "dedicated",
    minStake: s.minStake,
    token: s.token,
    ...(s.kind === "hub" ? { howToStake: `approve ${s.contract} for the token, then call stake(${s.token}, amount)`, minimumRule: "0.001% of current supply" } : {}),
    unlocks: stakeUnlocks(p.chainId, p.symbol, s.kind),
    lock: "none: unstake works at any time",
  };
}

/** Provider baca untuk chain sebuah pasar, tanpa batch (relai dan Base menolaknya). */
function marketProvider(chainId: number): ethers.JsonRpcProvider {
  const chain = resolveChainOrDefault(chainId);
  return new ethers.JsonRpcProvider(chain.rpcUrl, chain.chainId, { staticNetwork: true, batchMaxCount: 1 });
}

/** Posisi stake satu alamat, dibaca dari kontraknya saat ini juga. Hub: setiap panggilan menyebut token. */
async function readStake(stake: MarketStake, address: string) {
  const hub = stake.kind === "hub";
  const c = new ethers.Contract(
    stake.contract,
    hub
      ? [
          "function stakedOf(address,address) view returns (uint256)",
          "function minStakeOf(address) view returns (uint256)",
          "function isActive(address,address) view returns (bool)",
          "function totalStaked(address) view returns (uint256)",
          "function stakerCount(address) view returns (uint256)",
        ]
      : [
          "function stakedOf(address) view returns (uint256)",
          "function minStake() view returns (uint256)",
          "function isActive(address) view returns (bool)",
          "function totalStaked() view returns (uint256)",
          "function stakerCount() view returns (uint256)",
        ],
    marketProvider(stake.chainId)
  );
  const [staked, min, active, total, count] = await Promise.all(
    hub
      ? [c.stakedOf(stake.token, address), c.minStakeOf(stake.token), c.isActive(stake.token, address), c.totalStaked(stake.token), c.stakerCount(stake.token)]
      : [c.stakedOf(address), c.minStake(), c.isActive(address), c.totalStaked(), c.stakerCount()]
  );
  const fmt = (v: bigint) => ethers.formatUnits(v, stake.decimals);
  return {
    stakeContract: stake.contract,
    kind: stake.kind ?? "dedicated",
    address: ethers.getAddress(address),
    staked: fmt(staked),
    minStake: fmt(min),
    active: Boolean(active),
    totalStaked: fmt(total),
    stakers: Number(count),
    lock: "none: unstake works at any time",
  };
}

/**
 * Fakta yang boleh dipakai agent pasar dalam `ask_agent`, dibaca dari chain untuk jawaban ini.
 * Setiap pembacaan berdiri sendiri: yang gagal dilaporkan null, bukan ditebak.
 */
async function marketFacts(p: ProjectRecord) {
  const provider = marketProvider(p.chainId);
  const curve = new ethers.Contract(
    String(p.poolAddress),
    [
      "function depthFeeBps() view returns (uint256)",
      "function creatorFeeBps() view returns (uint256)",
      "function treasuryBuybackBps() view returns (uint256)",
      "function protocolFeeBps() view returns (uint256)",
      "function creator() view returns (address)",
      "function swapCount() view returns (uint256)",
      "function getReserves() view returns (uint256,uint256)",
      "function totalTokensBurned() view returns (uint256)",
    ],
    provider
  );
  const read = async <T,>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch {
      return null;
    }
  };
  const [depth, creatorFee, buyback, protocol, creator, swaps, reserves, burned] = await Promise.all([
    read(() => curve.depthFeeBps()),
    read(() => curve.creatorFeeBps()),
    read(() => curve.treasuryBuybackBps()),
    read(() => curve.protocolFeeBps()),
    read(() => curve.creator()),
    read(() => curve.swapCount()),
    read(() => curve.getReserves()),
    read(() => curve.totalTokensBurned()),
  ]);
  const bps = (v: unknown) => (v === null ? null : `${(Number(v) / 100).toFixed(2)}%`);
  const chain = resolveChainOrDefault(p.chainId);
  const stake = stakeForMarket(p);
  return {
    market: `$${p.symbol} (${p.name}) on ${p.chainLabel}`,
    token: p.tokenAddress,
    curve: p.poolAddress,
    venue: "AdextoCurve bonding curve, constant product over a virtual native reserve; 100% of supply was placed in the curve at launch",
    feePerTradeSplit: { depthKeptInCurve: bps(depth), creator: bps(creatorFee), buybackAndBurn: bps(buyback), protocol: bps(protocol) },
    creator,
    swaps: swaps === null ? null : Number(swaps),
    priceNative:
      reserves === null
        ? null
        : `${(Number(ethers.formatEther((reserves as [bigint, bigint])[0])) / Number(ethers.formatUnits((reserves as [bigint, bigint])[1], 18))).toPrecision(4)} ${chain.nativeSymbol} per token`,
    tokensBurnedByBuyback: burned === null ? null : ethers.formatUnits(burned as bigint, 18),
    agentIdentity: await readAgentIdentity(p),
    stake: stake
      ? { contract: stake.contract, kind: stake.kind ?? "dedicated", minStake: stake.minStake, unlocks: stakeUnlocks(p.chainId, p.symbol, stake.kind), lock: "none" }
      : null,
    readAt: new Date().toISOString(),
  };
}

/**
 * Dibaca LANGSUNG dari kontrak token, karena `get_market` adalah alat untuk satu pasar dan
 * tiga `eth_call` di sini murah. `agentBound` dibaca dulu: agent 0 adalah agent sungguhan.
 * Gagal baca jatuh ke salinan registry, dan `source` menyebut yang mana yang dipakai.
 */
async function readAgentIdentity(p: ProjectRecord) {
  try {
    const chain = resolveChainOrDefault(p.chainId);
    const provider = new ethers.JsonRpcProvider(chain.rpcUrl, chain.chainId, { staticNetwork: true, batchMaxCount: 1 });
    const token = new ethers.Contract(
      p.tokenAddress,
      [
        "function agentBound() view returns (bool)",
        "function agentId() view returns (uint256)",
        "function agentRegistry() view returns (address)",
      ],
      provider
    );
    if (!(await token.agentBound())) return null;
    const [id, registry] = await Promise.all([token.agentId(), token.agentRegistry()]);
    return agentIdentityOut(
      p.chainId,
      { agentId: (id as bigint).toString(), registry: ethers.getAddress(String(registry)) },
      "token-contract"
    );
  } catch {
    return agentIdentityOut(p.chainId, p.agentIdentity, "registry-copy");
  }
}

/**
 * Market dipilih dengan ticker DAN, bila diberikan, chain.
 *
 * Satu ticker boleh hidup di beberapa chain milik creator yang sama (`$SAI` di Robinhood Chain
 * dan di Arbitrum). Tanpa `chainId` yang dipakai tetap deployment TERLAMA — sama dengan
 * `findProject` dan gateway — supaya pemanggil lama tidak berubah perilakunya.
 */
function pickMarket(projects: ProjectRecord[], symbol: string, chainId?: number): ProjectRecord | undefined {
  const want = String(symbol).toUpperCase();
  const group = projects
    .filter((p) => String(p.symbol).toUpperCase() === want)
    .sort((a, b) => a.deployedAt - b.deployedAt);
  if (chainId !== undefined && chainId !== null) return group.find((p) => Number(p.chainId) === Number(chainId));
  return group.find((p) => p.poolLive) ?? group[0];
}

const CHAIN_ID = z
  .number()
  .int()
  .positive()
  .optional()
  .describe(
    "Chain id of the market, for a ticker that trades on more than one chain (list_markets shows chainId). " +
      "Without it the oldest market for that ticker is used."
  );

const SYMBOL = z
  .string()
  .min(1)
  .describe(
    "Market ticker, for example PARCEL or ADEXTO. Required and has no default: the gateway " +
      "refuses a missing ticker rather than quoting one, so a typo can never bill you for a " +
      "token you did not ask for. Call list_markets first if you do not know it."
  );

/**
 * Anotasi alat (`ToolAnnotations` MCP). Direktori MCP memeriksanya, dan klien memakainya untuk
 * memutuskan alat mana yang perlu konfirmasi pengguna. Ditulis seketat kenyataannya: dua alat yang
 * memindahkan uang ditandai destruktif karena pembayarannya tidak bisa ditarik kembali, dan
 * `prepare_launch` bukan read-only karena langkah keduanya meng-anchor metadata ke 0G DA.
 */
const READ_LOCAL = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const READ_CHAIN = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const SPENDS_MONEY = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } as const;

const ADDRESS = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "a 20-byte hex address");

/**
 * `serverInfo` lengkap (`Implementation` MCP 2025-11-25): judul, deskripsi, situs dan ikon,
 * semuanya dari `server.json` supaya registry dan server tidak bisa berselisih. Direktori seperti
 * Smithery membaca ikon dari sini; tanpa ini mereka menebak favicon domain.
 *
 * Konstanta, bukan literal di opsi: tipe `serverInfo` di mcp-handler hanya menyebut `name` dan
 * `version`, sementara `McpServer` di bawahnya menerima bidang `Implementation` selengkapnya.
 * `name` tetap `adexto-x402` karena klien yang sudah ada mengenali server dengan nama itu.
 */
const SERVER_INFO = {
  name: "adexto-x402",
  title: serverMeta.title,
  version: serverMeta.version,
  description: serverMeta.description,
  websiteUrl: serverMeta.websiteUrl,
  icons: serverMeta.icons,
};

const mcp = createMcpHandler(
  (server) => {
    // ── FREE: discovery ────────────────────────────────────────────────────────
    server.registerTool(
      "list_markets",
      {
        title: "List every tradable ADEXTO market",
        annotations: { title: "List every tradable ADEXTO market", ...READ_LOCAL },
        description:
          "Every bonding-curve market this gateway can sell, across all chains it serves, with its ticker, chain, curve address and whether it is currently tradable. Free. Start here: the buy tools require a ticker and deliberately have no default.",
        inputSchema: {},
        outputSchema: MCP_OUTPUTS.list_markets,
      },
      async () => {
        const projects = registryProjects();
        return jsonResult({
          count: projects.length,
          markets: projects.map((p) => ({
            symbol: p.symbol,
            name: p.name,
            chainId: p.chainId,
            chain: p.chainLabel,
            nativeSymbol: p.nativeSymbol,
            token: p.tokenAddress,
            curve: p.poolAddress,
            tradable: p.poolLive && Boolean(p.poolAddress),
            priceNative: p.priceNative,
            historySource: envioServes(p.chainId) ? "indexer" : "rpc-logs",
            agentIdentity: agentIdentityOut(p.chainId, p.agentIdentity),
          })),
          note:
            "Pay with USDC on Base; the curve on the market's own chain sends the tokens straight to your address. " +
            "We never hold them. agentIdentity is the ERC-8004 agent the token was bound to at launch, copied from " +
            "the token contract when the launch was confirmed; null means unbound or not recorded. get_market reads " +
            "it from the token itself.",
        });
      }
    );

    server.registerTool(
      "get_market",
      {
        title: "One market in detail",
        annotations: { title: "One market in detail", ...READ_CHAIN },
        description:
          "Full detail for a single market: chain, curve address, supply, fee rates, current price in the chain's native asset, and which read path serves its trade history. Free.",
        inputSchema: { symbol: SYMBOL, chainId: CHAIN_ID },
        outputSchema: MCP_OUTPUTS.get_market,
      },
      async ({ symbol, chainId }) => {
        const projects = registryProjects();
        const want = String(symbol).toUpperCase();
        const found = pickMarket(projects, want, chainId);
        if (!found) {
          return jsonResult({
            error: "unknown_market",
            symbol: want,
            known: projects.map((p) => p.symbol),
            detail: "That ticker is not served here. list_markets returns everything that is.",
          });
        }
        return jsonResult({
          symbol: found.symbol,
          name: found.name,
          slug: found.slug,
          chainId: found.chainId,
          chain: found.chainLabel,
          nativeSymbol: found.nativeSymbol,
          token: found.tokenAddress,
          curve: found.poolAddress,
          tradable: found.poolLive && Boolean(found.poolAddress),
          priceNative: found.priceNative,
          supply: found.supply,
          lpFeeBps: found.lpFeeBps,
          treasuryBuybackBps: found.treasuryBuybackBps,
          creator: found.creator,
          launchTx: found.txHash,
          launchBlock: found.blockNumber,
          /**
           * Sumbernya, bukan klaim kelengkapan. Lengkap atau tidak hanya diketahui SESUDAH
           * dibaca — `trade_history` yang menyatakannya per panggilan lewat `complete`.
           */
          historySource: envioServes(found.chainId) ? "indexer" : "rpc-logs",
          buyResource: `${GATEWAY}/v1/x402/buy/${found.slug}?chain=${found.chainId}`,
          agentIdentity: await readAgentIdentity(found),
          staking: stakeSummary(found),
        });
      }
    );

    // ── FREE: price discovery WITHOUT paying ───────────────────────────────────
    server.registerTool(
      "quote_buy",
      {
        title: "Quote a cross-chain buy without paying",
        annotations: { title: "Quote a cross-chain buy without paying", ...READ_CHAIN },
        description:
          "Reads the gateway's HTTP 402 challenge for a market and returns the quote and payment requirements without spending anything. The challenge carries the exact amount, the asset, the payTo address and the EIP-3009 domain, so an agent can decide before it signs. Free. This is the tool to call before buy_token.",
        inputSchema: {
          symbol: SYMBOL,
          chainId: CHAIN_ID,
          to: z
            .string()
            .optional()
            .describe("Recipient address for the tokens. Optional for a quote; the curve delivers straight to it on a real buy."),
        },
        outputSchema: MCP_OUTPUTS.quote_buy,
      },
      async ({ symbol, chainId, to }) => {
        const slug = gatewaySlug(symbol);
        if (!slug) return jsonResult({ error: "bad_symbol", detail: "symbol must contain letters or digits, for example PARCEL." });
        const url = new URL(`${GATEWAY}/v1/x402/buy/${slug}`);
        if (chainId) url.searchParams.set("chain", String(chainId));
        if (to) url.searchParams.set("to", to);
        const r = await passthrough(url.toString());
        /**
         * 402 di sini adalah HASIL YANG BENAR, bukan galat.
         *
         * Itulah bentuk kuotasinya: gateway menjawab tagihan beserta syarat pembayaran.
         * Melaporkannya sebagai kegagalan akan membuat agent mengira pasarnya rusak.
         */
        return jsonResult({
          httpStatus: r.status,
          quoted: r.status === 402,
          resource: url.toString(),
          challenge: r.body,
          next:
            r.status === 402
              ? "Sign the EIP-3009 transferWithAuthorization described in accepts[0], base64-encode the x402 payload, and call buy_token with it as xPayment."
              : "Not a quote. Read httpStatus and challenge: 404 unknown market, 409 not tradable, 503 out of inventory. None of these spend anything.",
        });
      }
    );

    server.registerTool(
      "how_to_pay",
      {
        title: "How to pay this gateway",
        annotations: { title: "How to pay this gateway", ...READ_LOCAL },
        description:
          "The exact steps to turn a 402 challenge into a settled cross-chain buy: what to sign, which chain settles, and which header carries the payment. Free. Read this if you have never paid an x402 endpoint before.",
        inputSchema: {},
        outputSchema: MCP_OUTPUTS.how_to_pay,
      },
      async () =>
        jsonResult({
          protocol: "x402, version 2",
          settlementChain: "Base",
          settlementAsset: "USDC",
          scheme: "exact, EIP-3009 transferWithAuthorization",
          header: "X-PAYMENT",
          headerNote:
            "buy_token sends xPayment in the X-PAYMENT header. Called directly, the gateway also reads PAYMENT-SIGNATURE, the x402 v2 name, and accepts either payload envelope in either header. A request that carries two different payments in the two headers is refused before anything is verified or charged.",
          steps: [
            "Call quote_buy to get the 402 challenge.",
            "Take accepts[0]: it carries network, asset, maxAmountRequired, payTo, and extra.name / extra.version for the EIP-712 domain.",
            "Sign transferWithAuthorization for that amount to that payTo, with a random bytes32 nonce.",
            "Base64-encode the x402 payment payload and pass it to buy_token as xPayment.",
          ],
          youNeverNeed: [
            "Native gas on the destination chain — the curve is called by our relayer.",
            "A bridge — the asset you pay with never leaves Base.",
            "An account with us — there is no signup and no API key.",
          ],
          orderOfOperations:
            "Delivery runs BEFORE the charge. A failed fill costs us, never you, and refusals (unknown market, not tradable, out of inventory) all happen before your authorization is spent.",
          replayProtection:
            "EIP-3009 authorizationState(from, nonce) is checked before settling and enforced by the token contract, so one signed authorization can never be spent twice.",
        })
    );

    // ── PAID ACTION: the real cross-chain buy ─────────────────────────────────
    server.registerTool(
      "buy_token",
      {
        title: "Buy a market cross-chain with USDC on Base",
        annotations: { title: "Buy a market cross-chain with USDC on Base", ...SPENDS_MONEY },
        description:
          "Executes the buy. Called without xPayment it returns the HTTP 402 challenge, which is the correct first response and not an error. Called with a signed x402 payload in xPayment it settles on Base and the curve on the destination chain sends the tokens straight to `to`. You never need native gas on the destination chain and never need to bridge.",
        inputSchema: {
          symbol: SYMBOL,
          chainId: CHAIN_ID,
          to: z
            .string()
            .describe("Address that receives the tokens. The curve sends them here directly; we never custody them."),
          xPayment: z
            .string()
            .optional()
            .describe(
              "Base64-encoded x402 payment payload containing the signed EIP-3009 authorization. Omit it to receive the 402 challenge first."
            ),
        },
        outputSchema: MCP_OUTPUTS.buy_token,
      },
      async ({ symbol, chainId, to, xPayment }) => {
        const slug = gatewaySlug(symbol);
        if (!slug) return jsonResult({ error: "bad_symbol", detail: "symbol must contain letters or digits, for example PARCEL." });
        const url = new URL(`${GATEWAY}/v1/x402/buy/${slug}`);
        if (chainId) url.searchParams.set("chain", String(chainId));
        url.searchParams.set("to", to);

        const r = await passthrough(url.toString(), {
          method: "GET",
          // Diteruskan APA ADANYA. Header ini adalah pembayarannya; menyentuhnya berarti
          // membangun definisi kedua tentang apa yang sah.
          headers: xPayment ? { "X-PAYMENT": xPayment } : {},
        });

        if (r.status === 402) {
          return jsonResult({
            httpStatus: 402,
            settled: false,
            paymentRequired: true,
            challenge: r.body,
            next: "Sign accepts[0] and call buy_token again with xPayment. Nothing was spent.",
          });
        }
        return jsonResult({
          httpStatus: r.status,
          settled: r.ok,
          result: r.body,
          next: r.ok
            ? "Settled. The result carries the delivery and settlement transaction hashes; read them from the chains rather than trusting this response."
            : "Not settled, and nothing was charged: refusals happen before payment. Read httpStatus and result for which refusal it was.",
        });
      }
    );

    // ── PAID, AND GATED: the agent signs through us ────────────────────────────
    /**
     * KENAPA ALAT INI ADA, DAN APA YANG IA BUKAN
     *
     * `buy_token` menuntut `xPayment`, yaitu otorisasi EIP-3009 yang sudah ditandatangani.
     * Sebuah LLM tidak bisa menandatangani apa pun, jadi tanpa alat ini seorang agent bisa
     * menemukan pasar, menghargainya, membaca riwayatnya, dan berhenti tepat sebelum
     * membeli. Alat ini menutup langkah terakhir itu.
     *
     * YANG HARUS DINYATAKAN JUJUR: ini BUKAN "agent dengan dompet sendiri". Yang menandatangani
     * adalah kunci operator di server ini. Jadi klaim yang benar adalah "agent memutuskan apa
     * yang dibeli dan mengeksekusi pembeliannya", bukan "agent membayar dari dananya sendiri".
     * Deskripsi alat di bawah menyatakannya, supaya model itu sendiri tidak salah menyebutnya.
     *
     * KENAPA AMAN MEMBERIKAN INI KEPADA SEBUAH LLM
     *
     * Agent tidak memilih penerima, aset, maupun jumlah. Ketiganya dibaca dari kutipan
     * gerbang lalu DICOCOKKAN dengan konstanta `PAY_LIMITS`, dan satu ketidakcocokan
     * membatalkan. Alamat pengiriman juga tidak diekspos: token selalu dikirim ke
     * penanda tangan. Jadi kemampuan maksimum agent — termasuk agent yang sepenuhnya
     * dibajak prompt injection — adalah membeli salah satu pasar kami sendiri dengan
     * maksimum 0,20 USDC, dengan uang yang hanya bisa mendarat di treasury kami.
     *
     * KENAPA BERKUNCI HEADER
     *
     * Endpoint MCP ini publik dan anonim. Tanpa gerbang, siapa pun di internet bisa
     * menghabiskan saldo USDC kami satu panggilan demi satu panggilan. Kuncinya dibawa
     * sebagai HEADER, bukan argumen alat: argumen alat terlihat oleh model, dan yang
     * terlihat model bisa ikut tercetak di transkrip.
     */
    server.registerTool(
      "pay_and_buy",
      {
        title: "Execute a buy end to end (operator-signed, capped)",
        annotations: { title: "Execute a buy end to end (operator-signed, capped)", ...SPENDS_MONEY },
        description:
          "Buys a market for real, completing the step an LLM cannot do alone: signing the EIP-3009 USDC authorisation. IMPORTANT for honest reporting — the signature is made by the operator's wallet on the server, not by a wallet you control, so describe the result as 'executed the purchase', not 'paid from my own funds'. Refuses unless the caller carries the agent key, and refuses any quote whose asset, network, recipient or amount does not match the hard-coded limits. Delivery always goes to the signer.",
        inputSchema: { symbol: SYMBOL, chainId: CHAIN_ID },
        outputSchema: MCP_OUTPUTS.pay_and_buy,
      },
      async ({ symbol, chainId }) => {
        const ctx = requestContext.getStore();
        if (!AGENT_DEMO_KEY) {
          return jsonResult({
            error: "not_configured",
            detail: "AGENT_DEMO_KEY is not set on this server, so the paid tool is switched off.",
          });
        }
        // `secretEquals`, bukan `!==`: yang terakhir keluar pada karakter pertama yang beda,
        // jadi lama jawabannya membocorkan panjang prefiks yang benar. Lewat HTTP itu nyaris
        // tak bisa dieksploitasi, tapi biaya memperbaikinya nol.
        if (!ctx?.agentKey || !secretEquals(ctx.agentKey, AGENT_DEMO_KEY)) {
          return jsonResult({
            error: "not_authorised",
            detail:
              "This tool spends real money and requires the agent key in the x-agent-key header. Every other tool on this server is free and open; use quote_buy to price a market instead.",
          });
        }
        if (!SIGNER_KEY) {
          return jsonResult({
            error: "no_signer",
            detail:
              "No signing key is configured on this server. Set AGENT_DEMO_PRIVATE_KEY for a dedicated signing wallet, or PRIVATE_KEY to use the operator wallet.",
          });
        }
        /**
         * Batas dihitung SESUDAH kunci diperiksa, dan itu urutan yang disengaja.
         *
         * Kalau dihitung lebih dulu, pemanggil anonim tanpa kunci bisa menghabiskan kuota
         * jam itu dan mengunci pemakai yang sah — pembatas laju yang berubah menjadi alat
         * denial-of-service terhadap pemiliknya sendiri.
         */
        // `pinned`: kunci global ini tidak boleh ikut tergusur ketika Map keranjang per-IP
        // penuh. Tanpanya, membanjiri pembatas dengan kunci baru mengosongkan batas ini.
        const payGate = rateLimit("pay_and_buy", PAY_CALL_LIMIT, PAY_CALL_WINDOW_MS, { pinned: true });
        if (!payGate.ok) {
          return jsonResult({
            error: "rate_limited",
            retryAfterSeconds: payGate.retryAfter,
            detail: `This tool is capped at ${PAY_CALL_LIMIT} purchases per hour across all callers, because the per-purchase limit bounds the size of a buy and not the number of them.`,
          });
        }

        const want = String(symbol).toUpperCase();
        const market = pickMarket(registryProjects(), want, chainId);
        if (!market) {
          return jsonResult({ error: "unknown_market", symbol: want, known: registryProjects().map((p) => p.symbol) });
        }

        // 1. Tantangan diambil dari GERBANG, bukan dibangun di sini. Yang ditandatangani
        //    harus berasal dari pihak yang akan memverifikasinya. Chain selalu disebut, supaya
        //    tagihan dan pengirimannya untuk market yang sama dengan yang dipilih di atas.
        const slug = market.slug;
        const challenge = await passthrough(`${GATEWAY}/v1/x402/buy/${slug}?chain=${market.chainId}`);
        if (challenge.status !== 402) {
          return jsonResult({
            error: "no_challenge",
            httpStatus: challenge.status,
            detail: "The gateway did not answer with a payment challenge, so there is nothing to sign.",
            body: challenge.body,
          });
        }
        const accept = (challenge.body as any)?.accepts?.[0];
        if (!accept) {
          return jsonResult({ error: "no_accepts", detail: "The challenge carried no payment terms." });
        }

        // 2. Batas diperiksa SEBELUM menandatangani. Tanda tangan yang sudah keluar tidak
        //    bisa ditarik kembali, jadi setiap pemeriksaan harus mendahuluinya.
        const amount = BigInt(String(accept.maxAmountRequired ?? "0"));
        const checks: string[] = [];
        if (String(accept.network).toLowerCase() !== PAY_LIMITS.network) checks.push(`network ${accept.network}`);
        if (String(accept.asset).toLowerCase() !== PAY_LIMITS.asset) checks.push(`asset ${accept.asset}`);
        if (String(accept.payTo).toLowerCase() !== PAY_LIMITS.payTo) checks.push(`payTo ${accept.payTo}`);
        if (amount <= 0n || amount > PAY_LIMITS.maxAtomic) checks.push(`amount ${amount}`);
        if (checks.length > 0) {
          return jsonResult({
            error: "refused_by_limits",
            detail: `The quote does not match this tool's hard limits, so nothing was signed. Mismatched: ${checks.join(", ")}.`,
            limits: {
              network: PAY_LIMITS.network,
              asset: PAY_LIMITS.asset,
              payTo: PAY_LIMITS.payTo,
              maxAtomic: PAY_LIMITS.maxAtomic.toString(),
            },
          });
        }

        // 3. Tanda tangan. Nonce acak; `validBefore` pendek supaya otorisasi yang tidak
        //    terpakai tidak menganggur lama sebagai izin yang masih hidup.
        const wallet = new ethers.Wallet(SIGNER_KEY);
        const authorization = {
          from: wallet.address,
          to: accept.payTo as string,
          value: amount,
          validAfter: 0n,
          validBefore: BigInt(Math.floor(Date.now() / 1000) + 600),
          nonce: ethers.hexlify(ethers.randomBytes(32)),
        };
        const signature = await wallet.signTypedData(
          {
            name: accept.extra?.name ?? "USD Coin",
            version: accept.extra?.version ?? "2",
            chainId: PAY_LIMITS.chainId,
            verifyingContract: accept.asset as string,
          },
          {
            TransferWithAuthorization: [
              { name: "from", type: "address" },
              { name: "to", type: "address" },
              { name: "value", type: "uint256" },
              { name: "validAfter", type: "uint256" },
              { name: "validBefore", type: "uint256" },
              { name: "nonce", type: "bytes32" },
            ],
          },
          authorization
        );

        const header = Buffer.from(
          JSON.stringify({
            x402Version: 2,
            scheme: "exact",
            network: PAY_LIMITS.network,
            payload: {
              signature,
              authorization: {
                from: authorization.from,
                to: authorization.to,
                value: authorization.value.toString(),
                validAfter: authorization.validAfter.toString(),
                validBefore: authorization.validBefore.toString(),
                nonce: authorization.nonce,
              },
            },
          }),
          "utf8"
        ).toString("base64");

        // 4. Bayar. Status gerbang diteruskan apa adanya, termasuk 503 out_of_inventory —
        //    agent harus bisa membedakan "tidak ada stok" dari "pembelian gagal".
        const paid = await passthrough(`${GATEWAY}/v1/x402/buy/${slug}?chain=${market.chainId}`, {
          method: "POST",
          headers: { "content-type": "application/json", "X-PAYMENT": header },
        });
        const body = paid.body as any;
        return jsonResult({
          symbol: want,
          chain: market.chainLabel,
          httpStatus: paid.status,
          settled: paid.status === 200 && body?.settlement?.success === true,
          paidBy: wallet.address,
          signedBy: "operator wallet on the ADEXTO server, not a wallet held by the agent",
          amountUsdc: (Number(amount) / 1e6).toFixed(2),
          delivery: body?.delivery ?? null,
          settlement: body?.settlement ?? null,
          buyback: body?.buyback ?? null,
          ...(paid.status !== 200 ? { gatewayError: body } : {}),
          terminal: `${SITE}/token/${slug}?chain=${market.chainId}`,
        });
      }
    );

    // ── FREE: history ─────────────────────────────────────────────────────────
    /**
     * KELENGKAPAN DIUKUR, BUKAN DIASUMSIKAN DARI CHAIN.
     *
     * Versi pertama alat ini MENOLAK setiap chain selain Monad, dengan alasan yang ditulis
     * di dalam pesan galatnya sendiri: "pemindaian RPC di chain ini hanya menjangkau jendela
     * pendek". Alasan itu salah untuk 0G, dan angkanya sudah ada di repo ini sejak awal.
     *
     * Petak `eth_getLogs` 0G adalah 500.000 blok dengan anggaran 16 panggilan, sedangkan
     * jarak dari blok peluncuran $ADEXTO ke kepala rantai 715.692 blok. Jadi riwayat penuh
     * 0G terjangkau dalam DUA panggilan, dan produksi memang sudah menyajikannya:
     * `reachedLaunch: true`, `truncated: false`, `calls: 2`, 20 fill untuk $ADEXTO dan 1
     * untuk $ADT. Alat ini menolak data yang sudah dipajang halaman token di sebelahnya.
     *
     * Yang sebenarnya ingin dicegah tetap benar: riwayat terpotong tidak boleh terlihat
     * seperti pasar yang tidak pernah diperdagangkan. Tapi penjaganya bukan daftar chain —
     * penjaganya `coverage.reachedLaunch`, yang menyatakan penelusuran berhenti karena
     * riwayatnya HABIS, bukan karena anggarannya habis. Base masih akan dilaporkan tidak
     * lengkap kalau memang tidak lengkap: petaknya 2.000 blok, jadi 16 panggilan hanya
     * menjangkau 32.000 blok.
     *
     * Keduanya memakai pustaka yang SAMA dengan yang dipakai terminal token
     * (`readEnvioSwaps`, `readOnChainSwaps`). Versi pertama menyalin ulang kueri GraphQL
     * Envio ke dalam berkas ini — persis "definisi kedua" yang dijanjikan tidak akan dibuat
     * di komentar kepala berkas. Sekarang tidak ada kueri swap di sini sama sekali.
     */
    server.registerTool(
      "trade_history",
      {
        title: "Every swap on a market, and how complete the answer is",
        annotations: { title: "Every swap on a market, and how complete the answer is", ...READ_CHAIN },
        description:
          "Trade history for a market, newest first, with an explicit statement of whether it reaches the launch block. Free. Monad is served by our Envio indexer, which has no lookback window; the other chains are served by a log scan whose reach is reported per call. When the scan cannot reach the launch block the answer says so instead of presenting a shortened list as the whole history.",
        inputSchema: {
          symbol: SYMBOL,
          chainId: CHAIN_ID,
          limit: z
            .number()
            .int()
            .min(1)
            .max(400)
            .optional()
            .describe("Rows to return, newest first. Default 50, maximum 400."),
        },
        outputSchema: MCP_OUTPUTS.trade_history,
      },
      async ({ symbol, chainId, limit }) => {
        const projects = registryProjects();
        const want = String(symbol).toUpperCase();
        const market = pickMarket(projects, want, chainId);
        if (!market) {
          return jsonResult({ error: "unknown_market", symbol: want, known: projects.map((p) => p.symbol) });
        }
        if (!market.poolAddress || !market.poolLive) {
          return jsonResult({
            error: "no_curve",
            symbol: want,
            detail: "This market has no live curve, so there are no swaps to report.",
          });
        }

        const rows = Math.min(400, Math.max(1, Number(limit ?? 50)));
        const chain = resolveChainOrDefault(market.chainId);
        const shape = (t: {
          txHash: string;
          type: string;
          amountToken: number;
          amountNative: number;
          priceNative: number;
          priceNativeAfter?: number | null;
          trader: string;
          timestamp: string;
          blockNumber: number | null;
        }) => ({
          txHash: t.txHash,
          side: t.type,
          amountToken: t.amountToken,
          amountNative: t.amountNative,
          nativeSymbol: chain.nativeSymbol,
          /** Yang benar-benar dibayar atau diterima, fee termasuk. Bukan harga pasar. */
          executionPriceNative: t.priceNative,
          /** Harga spot kurva sesudah fill ini. Ini yang harus diplot sebagai harga. */
          spotPriceAfter: t.priceNativeAfter ?? null,
          trader: t.trader,
          timestamp: t.timestamp,
          blockNumber: t.blockNumber,
        });

        // 1. Indexer lebih dulu bila ia melayani chain ini: lengkap sejak blok peluncuran
        //    tanpa satu pun panggilan `getLogs`.
        if (envioServes(market.chainId)) {
          const fromIndexer = await readEnvioSwaps(
            market.poolAddress,
            want,
            chain.nativeSymbol,
            market.chainId,
            rows
          );
          if (fromIndexer.trades.length > 0) {
            return jsonResult({
              symbol: want,
              chainId: market.chainId,
              chain: market.chainLabel,
              curve: market.poolAddress,
              source: "envio-hyperindex",
              complete: true,
              completeBecause:
                "The indexer stores every Swap since the factory's launch block, so this is the whole history rather than a window.",
              totalSwaps: fromIndexer.totalSwaps,
              returned: fromIndexer.trades.length,
              indexerSyncedToBlock: fromIndexer.syncedToBlock,
              swaps: fromIndexer.trades.map(shape),
              publicEndpoint: `${SITE}/api/indexer/graphql`,
            });
          }
          /**
           * Indexer yang gagal TIDAK mengembalikan daftar kosong: ia menyerahkan giliran ke
           * pemindaian di bawah, dan galatnya tetap dilaporkan. Indexer mati yang diam-diam
           * diganti sumber lebih sempit adalah tepat jenis kemunduran yang tidak boleh
           * tampil seperti keadaan normal.
           */
          if (fromIndexer.error) {
            const read = await readOnChainSwaps(chain, market.poolAddress, want, rows, market.blockNumber);
            return jsonResult({
              symbol: want,
              chainId: market.chainId,
              chain: market.chainLabel,
              curve: market.poolAddress,
              source: "rpc-logs",
              indexerError: fromIndexer.error,
              degraded: true,
              complete: read.coverage.reachedLaunch,
              coverage: read.coverage,
              returned: read.trades.length,
              swaps: read.trades.map(shape),
            });
          }
        }

        // 2. Pemindaian log. Untuk sebagian chain ini menjangkau blok peluncuran dan karena
        //    itu LENGKAP; untuk yang lain tidak, dan jawabannya menyatakan yang mana.
        const read = await readOnChainSwaps(chain, market.poolAddress, want, rows, market.blockNumber);
        if (read.coverage.error) {
          return jsonResult({
            error: "read_failed",
            symbol: want,
            chainId: market.chainId,
            detail: read.coverage.error,
            note: "This is an RPC failure, not an empty market. The two are reported separately on purpose.",
          });
        }
        return jsonResult({
          symbol: want,
          chainId: market.chainId,
          chain: market.chainLabel,
          curve: market.poolAddress,
          source: "rpc-logs",
          complete: read.coverage.reachedLaunch,
          ...(read.coverage.reachedLaunch
            ? {
                completeBecause: `The scan reached the launch block ${market.blockNumber}, and the curve was created in the same transaction as the token, so no swap can exist before it.`,
              }
            : {
                incompleteBecause:
                  "The scan ran out of its call budget before reaching the launch block, so older swaps exist that are not listed here. Treat an empty or short list as 'not seen', not as 'never traded'.",
              }),
          launchBlock: market.blockNumber,
          coverage: read.coverage,
          returned: read.trades.length,
          swaps: read.trades.map(shape),
        });
      }
    );

    // ── FREE: stake, read from the market's stake contract ──────────────────
    /**
     * Stake-to-access, in three tools: read a position, get the message to sign, ask.
     *
     * Every answer here is read from the stake contract on the market's own chain at call time,
     * never from a cache, because `ask_agent` gates on it: a stake that was withdrawn a block ago
     * must stop opening the agent a block ago. The contract has no lock, so "staked" is a fact of
     * this moment and nothing more.
     */
    server.registerTool(
      "check_stake",
      {
        title: "Read a wallet's stake in a market",
        annotations: { title: "Read a wallet's stake in a market", ...READ_CHAIN },
        description:
          "Free. Reads the market's stake contract on its own chain: its own AdextoAgentStake where it has one, otherwise the chain's AdextoStakeHub, which accepts every other market launched through ADEXTO from its first block. Returns how much an address has staked, the minimum, whether the position is active (at or above the minimum), and the totals. An active stake opens ask_agent for that market and an Agent Compute API key (see get_market staking.unlocks). There is no lock and no reward: unstake works at any time.",
        inputSchema: {
          symbol: SYMBOL,
          chainId: CHAIN_ID,
          address: z.string().describe("Wallet whose stake to read."),
        },
        outputSchema: MCP_OUTPUTS.check_stake,
      },
      async ({ symbol, chainId, address }) => {
        const market = pickMarket(registryProjects(), String(symbol), chainId);
        if (!market) return jsonResult({ error: "unknown_market", symbol: String(symbol).toUpperCase() });
        const stake = stakeForMarket(market);
        if (!stake) {
          return jsonResult({ staking: false, symbol: market.symbol, chainId: market.chainId, detail: "This market's chain has no stake contract for it." });
        }
        if (!ethers.isAddress(address)) return jsonResult({ error: "bad_address", address });
        try {
          return jsonResult({ staking: true, symbol: market.symbol, chainId: market.chainId, chain: market.chainLabel, ...(await readStake(stake, address)) });
        } catch (e) {
          return jsonResult({ error: "read_failed", detail: String((e as Error).message).slice(0, 160) });
        }
      }
    );

    server.registerTool(
      "access_message",
      {
        title: "The message to sign before ask_agent",
        annotations: { title: "The message to sign before ask_agent", ...READ_LOCAL },
        description:
          "Free. Returns the exact EIP-191 message an address signs (personal_sign) to prove it is the address asking. ask_agent accepts it for 10 minutes. Signing it moves nothing and costs nothing.",
        inputSchema: { symbol: SYMBOL, chainId: CHAIN_ID, address: z.string().describe("Wallet that will sign and ask.") },
        outputSchema: MCP_OUTPUTS.access_message,
      },
      async ({ symbol, chainId, address }) => {
        const market = pickMarket(registryProjects(), String(symbol), chainId);
        if (!market) return jsonResult({ error: "unknown_market", symbol: String(symbol).toUpperCase() });
        if (!ethers.isAddress(address)) return jsonResult({ error: "bad_address", address });
        const message = agentAccessMessage({
          symbol: market.symbol,
          chainId: market.chainId,
          address: ethers.getAddress(address),
          timestamp: Date.now(),
        });
        return jsonResult({
          message,
          sign: "personal_sign (EIP-191) with the key of this address",
          validForSeconds: AGENT_ACCESS_MAX_AGE_MS / 1000,
          next: "Call ask_agent with this exact message, the signature and your question.",
        });
      }
    );

    server.registerTool(
      "ask_agent",
      {
        title: "Ask the market's agent (stake required)",
        annotations: {
          title: "Ask the market's agent (stake required)",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
        description:
          "Asks the market's own agent a question about that market. Open to an address whose stake in the market's stake contract is active (check_stake), proven with a signed access_message. The answer comes from glm-5.3 on the 0G router and is limited to facts read on-chain for this call; the tool returns those facts next to the answer. Refused without an active stake, and nothing is charged either way.",
        inputSchema: {
          symbol: SYMBOL,
          chainId: CHAIN_ID,
          address: z.string().describe("The asking wallet. Must hold an active stake."),
          message: z.string().max(400).describe("The exact message from access_message."),
          signature: z.string().describe("personal_sign signature of message by address."),
          question: z.string().min(3).max(500).describe("What to ask the agent about this market."),
        },
        outputSchema: MCP_OUTPUTS.ask_agent,
      },
      async ({ symbol, chainId, address, message, signature, question }) => {
        const market = pickMarket(registryProjects(), String(symbol), chainId);
        if (!market) return jsonResult({ error: "unknown_market", symbol: String(symbol).toUpperCase() });
        const stake = stakeForMarket(market);
        if (!stake) return jsonResult({ answered: false, error: "no_stake_contract", detail: "This market's chain has no stake contract for it, so there is no agent access to open." });
        if (!ethers.isAddress(address)) return jsonResult({ answered: false, error: "bad_address" });
        const who = ethers.getAddress(address);

        // 0. Rate limited per caller IP BEFORE anything is verified or read. The per-address
        //    limit below needs a valid signature, but a fresh key signs for free, so on its own
        //    it let one caller mint unlimited limiter keys — and pay for 5 stake reads per
        //    fresh address — by rotating addresses.
        const ipGate = rateLimit(`ask_agent:ip:${callerIp()}`, 30, 10 * 60 * 1000);
        if (!ipGate.ok) return jsonResult({ answered: false, error: "rate_limited", retryAfterSeconds: ipGate.retryAfter });

        // 1. The address proves itself. The message is rebuilt here and must match byte for byte.
        const ts = Number((/Timestamp: (\d{10,16})/.exec(message) || [])[1]);
        const expected = Number.isFinite(ts)
          ? agentAccessMessage({ symbol: market.symbol, chainId: market.chainId, address: who, timestamp: ts })
          : "";
        let signer = "";
        try {
          signer = ethers.verifyMessage(message, signature);
        } catch {
          signer = "";
        }
        if (message !== expected || signer.toLowerCase() !== who.toLowerCase()) {
          return jsonResult({ answered: false, error: "bad_signature", detail: "Sign the exact message from access_message with the key of address." });
        }
        if (Date.now() - ts > AGENT_ACCESS_MAX_AGE_MS || ts - Date.now() > 60_000) {
          return jsonResult({ answered: false, error: "expired", detail: "The access message is older than 10 minutes. Get a new one from access_message." });
        }

        // 2. Rate limited per address, after the signature: an anonymous caller cannot spend
        //    somebody else's allowance.
        const gate = rateLimit(`ask_agent:${who.toLowerCase()}`, 6, 10 * 60 * 1000);
        if (!gate.ok) return jsonResult({ answered: false, error: "rate_limited", retryAfterSeconds: gate.retryAfter });

        // 3. The stake, read now.
        let position: Awaited<ReturnType<typeof readStake>>;
        try {
          position = await readStake(stake, who);
        } catch (e) {
          return jsonResult({ answered: false, error: "stake_read_failed", detail: String((e as Error).message).slice(0, 160) });
        }
        if (!position.active) {
          return jsonResult({
            answered: false,
            error: "stake_required",
            detail:
              stake.kind === "hub"
                ? `Stake at least ${stake.minStake.toLocaleString("en-US")} ${market.symbol} in the stake hub ${stake.contract} on chain ${market.chainId} to ask this agent. Approve the hub for the token, then call stake(${stake.token}, amount) from this address. Unstake works at any time.`
                : `Stake at least ${stake.minStake.toLocaleString("en-US")} ${market.symbol} in ${stake.contract} on chain ${market.chainId} to ask this agent. Approve the stake contract, then call stake(amount) from this address. Unstake works at any time.`,
            stake: position,
          });
        }

        // 4. The facts the agent may use, read on-chain for this call.
        const facts = await marketFacts(market);
        const key = process.env.OG_ROUTER_API_KEY || "";
        if (!key) return jsonResult({ answered: false, error: "not_configured", detail: "OG_ROUTER_API_KEY is not set on this server." });
        const system =
          `You are the agent of the market $${market.symbol} ("${market.name}") on ${market.chainLabel}, launched through ADEXTO. ` +
          `${market.agentPersona ? `Your mandate: ${market.agentPersona} ` : ""}` +
          `Answer in English, in at most 110 words, using only the facts below. If the question needs anything else, say you do not know. ` +
          `Never give investment advice and never predict prices.\n\nFacts read on-chain for this answer:\n${JSON.stringify(facts, null, 1)}`;
        try {
          const res = await fetch(`${process.env.OG_ROUTER_URL || "https://router-api.0g.ai/v1"}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify({
              model: "glm-5.3",
              reasoning_effort: "low",
              temperature: 0.3,
              max_tokens: 600,
              messages: [
                { role: "system", content: system },
                { role: "user", content: String(question).slice(0, 500) },
              ],
            }),
            signal: AbortSignal.timeout(40_000),
          });
          const j = await res.json().catch(() => ({}));
          const answer = String(j?.choices?.[0]?.message?.content ?? "").trim();
          if (!res.ok || !answer) {
            return jsonResult({ answered: false, error: "model_failed", httpStatus: res.status, detail: JSON.stringify(j).slice(0, 200) });
          }
          return jsonResult({
            answered: true,
            symbol: market.symbol,
            chainId: market.chainId,
            answer,
            answeredBy: "glm-5.3 on the 0G router, as this market's agent",
            stake: position,
            facts,
          });
        } catch (e) {
          return jsonResult({ answered: false, error: "model_failed", detail: String((e as Error).message).slice(0, 160) });
        }
      }
    );

    // ── LAUNCH, STAKE, CLAIM: unsigned transactions, signed by the caller's own key ─────────────
    //
    // Pola Flaunch: server menyusun, agen menandatangani. Tidak ada kunci di sini dan tidak ada
    // jalur peluncuran kedua — `prepare_launch`/`register_launch` memanggil tahap Studio yang sama
    // (src/lib/agent-launch.ts), `prepare_stake`/`prepare_claim` meniru panel situs (agent-tx.ts).
    server.registerTool(
      "prepare_launch",
      {
        title: "Prepare a market launch for your own key to sign",
        annotations: {
          title: "Prepare a market launch for your own key to sign",
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
        description:
          "Launch a new ADEXTO market without handing over a key. Call it once without a signature: it checks the " +
          "ticker, the chain and an optional ERC-8004 agent you own, and returns an attestation message for the " +
          "deployer to sign (EIP-191). Call it again with the same arguments plus attestationMessage and " +
          "attestationSignature: it anchors the launch metadata and returns the unsigned deployTrinity transaction " +
          "(value 0, gas only), simulated from your address, with a gas estimate. Fee preset: 1.00% per trade, 0.70% " +
          "to the creator. All supply goes into the curve; the creator gets no allocation. After the transaction is " +
          "mined, call register_launch.",
        inputSchema: {
          chainId: z
            .number()
            .int()
            .positive()
            .describe("Chain to launch on: 143 Monad, 42161 Arbitrum One, 4663 Robinhood Chain, 8453 Base, 16661 0G."),
          name: z.string().min(1).max(64).describe("Token name, up to 64 bytes."),
          symbol: z.string().min(2).max(12).describe("Ticker, 2 to 12 letters A-Z or digits. Permanent on chain."),
          deployer: ADDRESS.describe(
            "Address that signs the attestation and sends the launch transaction. It becomes the market's creator and receives the creator fee."
          ),
          agentId: z
            .string()
            .regex(/^\d{1,78}$/)
            .optional()
            .describe("ERC-8004 agent id on this chain to bind to the token, owned by the deployer. Omit to launch unbound."),
          description: z.string().max(280).optional().describe("One-line pitch shown on the market page."),
          website: z
            .string()
            .max(200)
            .optional()
            .describe("Project website URL, shown on the market page. https:// is assumed when no scheme is given."),
          x: z.string().max(200).optional().describe("X handle or URL."),
          github: z.string().max(200).optional().describe("GitHub URL of the project, shown on the market page."),
          docs: z.string().max(200).optional().describe("Documentation URL, shown on the market page."),
          image: z
            .string()
            .max(200_000)
            .optional()
            .describe("Logo as a base64 data URI (image/png, image/jpeg or image/webp). Omit for the default logo."),
          category: z
            .enum(MARKET_CATEGORIES.map((c) => c.key) as [string, ...string[]])
            .optional()
            .describe("Market category shown on the explorer."),
          attestationMessage: z.string().max(400).optional().describe("Second call only: the message the first call returned."),
          attestationSignature: z.string().max(200).optional().describe("Second call only: the deployer's EIP-191 signature of it."),
        },
        outputSchema: MCP_OUTPUTS.prepare_launch,
      },
      async (args) => {
        const ctx = requestContext.getStore();
        return jsonResult(await prepareLaunch(args, ctx?.ipHeaders ?? {}));
      }
    );

    server.registerTool(
      "register_launch",
      {
        title: "List a mined launch on ADEXTO",
        annotations: {
          title: "List a mined launch on ADEXTO",
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
        description:
          "After the prepare_launch transaction is mined, lists the new market on adexto.xyz, in list_markets and on " +
          "the x402 gateway. Reads the TrinityProjectDeployed event from the ADEXTO factory in the receipt; every " +
          "value it registers comes from that event, not from the caller. Calling it again for the same transaction " +
          "returns the existing listing.",
        inputSchema: {
          chainId: z.number().int().positive().describe("Chain the launch transaction was sent on."),
          txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).describe("Hash of the mined launch transaction."),
        },
        outputSchema: MCP_OUTPUTS.register_launch,
      },
      async ({ chainId, txHash }) => {
        const ctx = requestContext.getStore();
        return jsonResult(await registerLaunch({ chainId, txHash }, ctx?.ipHeaders ?? {}));
      }
    );

    server.registerTool(
      "prepare_stake",
      {
        title: "Prepare a stake for your own key to sign",
        annotations: { title: "Prepare a stake for your own key to sign", ...READ_CHAIN },
        description:
          "Unsigned transactions that stake a market's token in its stake contract or its chain's stake hub: an " +
          "approval for the exact amount (only if the allowance is short), then the stake. Checks balance, minimum " +
          "and hub eligibility first, so a stake that would revert is refused before any gas is spent. No lock: " +
          "unstake works at any time. A stake opens ask_agent for that market.",
        inputSchema: {
          symbol: SYMBOL,
          chainId: CHAIN_ID,
          address: ADDRESS.describe("Wallet that holds the tokens and will sign."),
          amount: z.string().regex(/^\d+(\.\d{1,18})?$/).describe("Whole tokens to stake, for example \"10000\"."),
        },
        outputSchema: MCP_OUTPUTS.prepare_stake,
      },
      async ({ symbol, chainId, address, amount }) => {
        const projects = registryProjects();
        const found = pickMarket(projects, symbol, chainId);
        if (!found) {
          return jsonResult({ error: "unknown_market", symbol: String(symbol).toUpperCase(), detail: "list_markets returns every market served here." });
        }
        return jsonResult(await prepareStake(found, address, amount));
      }
    );

    server.registerTool(
      "prepare_claim",
      {
        title: "Prepare a creator fee claim",
        annotations: { title: "Prepare a creator fee claim", ...READ_CHAIN },
        description:
          "Unsigned transactions that collect the creator fee owed to an address across its markets: one " +
          "claimCreatorFees() call per curve, or one Multicall3 batch per chain when several are owed. The curve " +
          "always pays its immutable creator, whoever sends the transaction.",
        inputSchema: {
          address: ADDRESS.describe("Creator address whose owed fees to collect."),
          chainId: z.number().int().positive().optional().describe("Only this chain. Omit for every chain."),
        },
        outputSchema: MCP_OUTPUTS.prepare_claim,
      },
      async ({ address, chainId }) => jsonResult(await prepareClaim(address, chainId))
    );
  },
  {
    instructions:
      "ADEXTO sells positions in bonding-curve markets across chains, paid for with USDC on Base over x402. " +
      "Call list_markets to see what exists, quote_buy to price one without paying, then buy_token with a signed " +
      "payment. You never need gas on the destination chain and never need to bridge. Every tool except buy_token " +
      "is free, and buy_token's first response is a 402 challenge, which is expected rather than a failure. " +
      "A ticker can trade on more than one chain: pass chainId from list_markets to pick one. Every market can be " +
      "staked, in its own stake contract or its chain's stake hub, and a stake opens its agent: check_stake, " +
      "access_message, then ask_agent. To launch your own market with your own key: prepare_launch (once for the " +
      "attestation message, once with its signature), send the unsigned transaction it returns, then register_launch. " +
      "prepare_stake and prepare_claim also return unsigned transactions; this server never holds your key.",
    capabilities: { tools: {} },
    /**
     * mcp-handler 2.x: SATU objek opsi (opsi server SDK + `serverInfo`/`verboseLogs`). `basePath`
     * dan `maxDuration` dari 1.x sudah tidak ada; path-nya dipilah `handler` di bawah. 2.x
     * melayani spesifikasi 2026-07-28 (tanpa sesi, tanpa `initialize`, `server/discover`) dan
     * klien 2025 lewat fallback stateless dari handler yang sama.
     */
    serverInfo: SERVER_INFO,
    verboseLogs: false,
  }
);

/**
 * Balas galat parse SEBELUM transport melihatnya.
 *
 * Diukur, bukan dikira: POST dengan badan kosong dan POST dengan JSON rusak TIDAK PERNAH
 * dijawab oleh transport streamable-HTTP — prosesnya tetap hidup, tapi permintaannya
 * menggantung sampai klien menyerah (terbukti: dua kali TimeoutError 8s pada probe lokal,
 * sementara `{"hello":"world"}` yang JSON-nya sah dijawab 400 dengan benar).
 *
 * Menggantung lebih buruk daripada galat. Klien MCP yang menunggu selamanya terlihat seperti
 * server mati, dan di belakang proxy ini muncul sebagai gateway timeout, bukan sebagai
 * pesan yang bisa dibaca. Implementasi sejenis pernah rontok pada masukan yang sama persis
 * — badan POST kosong mematikan prosesnya menjadi 502 — jadi jalur ini memang layak dijaga.
 *
 * Hanya POST yang diperiksa: GET (SSE) dan DELETE (penutupan sesi) tidak berbadan, dan
 * membaca badan mereka tidak ada gunanya.
 */
function parseError(message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message } }),
    { status: 400, headers: { "content-type": "application/json" } }
  );
}

/**
 * Batas per-IP untuk SELURUH endpoint, di atas batas per-alat yang sudah ada.
 *
 * KENAPA PERLU, padahal alat berbayar sudah dibatasi sendiri-sendiri
 *
 * Alat gratis tidak gratis bagi kami. `get_market` membaca identitas agent (3 eth_call),
 * `check_stake` dan `ask_agent` untuk alamat segar membaca stake (5 eth_call), `prepare_claim`
 * menyentuh setiap chain, `quote_buy` memanggil gateway. Tanpa batas endpoint, satu loop
 * memperbanyak setiap permintaan menjadi puluhan panggilan ke RPC publik — yang kemudian
 * membatasi IP origin kita, dan pembacaan di SELURUH situs ikut gagal. `ask_agent` juga
 * mencetak satu kunci pembatas per alamat bertanda tangan, jadi tanpa batas di sini satu IP
 * bisa membanjiri Map pembatas dengan alamat segar.
 *
 * 240 per menit sengaja longgar: klien MCP besar memanggil dari IP egress yang dipakai
 * bersama banyak pengguna, dan satu sesi agen yang wajar hanya belasan permintaan.
 */
const MCP_IP_LIMIT = 240;
const MCP_IP_WINDOW_MS = 60_000;

/**
 * Badan JSON-RPC terbesar yang sah adalah `prepare_launch` dengan logo data URI
 * (`MAX_IMAGE_DATA_URI_CHARS`, 200.000 karakter). Batasnya sama dengan rute yang membawa logo.
 */
const MCP_MAX_BODY_BYTES = IMAGE_JSON_BODY_BYTES;

function jsonRpcError(status: number, code: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/**
 * Hanya `/api/mcp`. Berkas ini ada di `src/app/api/[transport]/`, jadi Next mengirim ke sini
 * SETIAP `/api/<x>` yang tidak punya route sendiri. mcp-handler 1.x memilah path-nya sendiri
 * (`basePath`); 2.x melayani permintaan apa pun yang diberikan kepadanya, jadi pemilahannya
 * sekarang di sini. Transport HTTP+SSE lama (`/api/sse`, `/api/message`) sudah dicabut dari
 * spesifikasi dan dari 2.x, dan menjawab 404 seperti path lain yang tidak dikenal.
 */
function notMcp(): Response {
  return new Response(
    JSON.stringify({ error: "not_found", detail: "The MCP endpoint is /api/mcp (Streamable HTTP)." }),
    { status: 404, headers: { "content-type": "application/json" } }
  );
}

async function handler(request: Request): Promise<Response> {
  if (!/\/api\/mcp\/?$/.test(new URL(request.url).pathname)) return notMcp();

  const gate = rateLimit(`mcp:${clientIp(request)}`, MCP_IP_LIMIT, MCP_IP_WINDOW_MS);
  if (!gate.ok) {
    return jsonRpcError(
      429,
      -32000,
      `Rate limited: at most ${MCP_IP_LIMIT} requests per minute from one address. Retry after ${gate.retryAfter} s.`,
      rateLimitHeaders(gate)
    );
  }

  const ctx = { agentKey: request.headers.get("x-agent-key"), ipHeaders: ipHeadersOf(request) };
  if (request.method !== "POST") return requestContext.run(ctx, () => mcp(request));

  // Dibaca dengan batas: `request.text()` menampung badan sebesar apa pun di memori, lalu
  // badan itu disalin lagi oleh `JSON.parse` dan `new Request(...)` di bawah.
  let raw: string;
  try {
    raw = await readTextBody(request, MCP_MAX_BODY_BYTES);
  } catch (e) {
    if (e instanceof BodyTooLargeError) {
      return jsonRpcError(413, -32600, `Request body is larger than ${e.limit} bytes.`);
    }
    throw e;
  }
  if (!raw.trim()) {
    return parseError("Empty request body. Send a JSON-RPC 2.0 request, for example {\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}.");
  }
  try {
    JSON.parse(raw);
  } catch {
    return parseError("Request body is not valid JSON.");
  }

  // Badan sudah dikonsumsi oleh `.text()`, jadi permintaannya dirakit ulang dengan isi yang
  // sama. Header ikut apa adanya agar `X-PAYMENT`, accept dan content-length tetap utuh.
  const rebuilt = new Request(request.url, { method: "POST", headers: request.headers, body: raw });

  /**
   * Kunci agent dibaca DI SINI dan dibawa lewat AsyncLocalStorage.
   *
   * Callback `registerTool` tidak menerima `Request`, jadi ini satu-satunya tempat header
   * itu masih terlihat. Hanya `pay_and_buy` yang membacanya; alat lainnya gratis dan tidak
   * peduli siapa pemanggilnya.
   */
  return requestContext.run(ctx, () => mcp(rebuilt));
}

export { handler as GET, handler as POST, handler as DELETE };
