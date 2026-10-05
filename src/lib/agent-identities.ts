/**
 * Agen ERC-8004 yang DIOPERASIKAN ADEXTO, dan alamat-alamat milik kami.
 *
 * Dua daftar, dua kegunaan:
 *
 *   - `OPERATED_AGENTS`: agen yang dompetnya kami pegang. Dipakai `/.well-known/agent-registration.json`
 *     (bukti domain ERC-8004: domain ini menyatakan agen-agen ini miliknya) dan kartu per agen
 *     di `/api/agents/card`. Setiap entri DIPERIKSA ke chain saat dilayani — `ownerOf(agentId)`
 *     harus salah satu alamat kami — jadi agen yang berpindah tangan berhenti diklaim tanpa
 *     menyunting berkas ini.
 *   - `OUR_ADDRESSES`: alamat operasional kami. Agent Score dan direktori `/agents` memakainya
 *     untuk memisahkan pedagang LUAR dari transaksi kami sendiri. Tanpa daftar ini setiap uji
 *     coba kami terhitung sebagai permintaan pasar.
 *
 * Diisi dari pembacaan chain 2 Okt 2026 (`ownerOf` dan `tokenURI` tiap id, `agentBound`/`agentId`
 * tiap token), bukan dari ingatan.
 */
import { ethers } from "ethers";
import { X402_RELAYER } from "@/config/contracts";
import { AGENT_REGISTRY_ADDRESS, IDENTITY_REGISTRY_ABI } from "@/lib/dex";
import { readProvider, resolveChain } from "@/lib/chains";
import { isHiddenMarket } from "@/config/hidden-markets";

/** Alamat operasional ADEXTO. Huruf campur (checksum) di sini; bandingkan selalu dalam huruf kecil. */
export const OUR_ADDRESSES = {
  deployer: "0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D",
  /** Dompet creator demo; pemilik tiga agen SAi dan creator tiga pasar $SAI. */
  agentA: "0x42478Ed9A429eC320d243469Fa5d6595BCc8daa5",
  /** Dompet pembeli demo (agen MCP di rekaman demo). */
  agentB: "0x150ca9B520dE1fCBAD992322C798E547f0b9E803",
  /** Relayer gateway x402: pengirim setiap pengantaran lintas chain. */
  relayer: X402_RELAYER,
  treasury: "0x24268Fffc119ec5550F68e80D94476fD64daE967",
} as const;

const OURS = new Set(Object.values(OUR_ADDRESSES).map((a) => a.toLowerCase()));

/** True bila alamat ini salah satu dompet operasional kami. */
export function isOurAddress(address: string | null | undefined): boolean {
  return Boolean(address) && OURS.has(String(address).toLowerCase());
}

export interface OperatedAgent {
  chainId: number;
  /** Desimal: id ERC-8004 adalah uint256 dan agen 0 adalah agen sungguhan. */
  agentId: string;
  /** Nama di berkas registrasinya saat ini. */
  name: string;
  operator: keyof typeof OUR_ADDRESSES;
  /** Pasar yang tokennya terikat ke agen ini, dibaca dari kontrak token. Null bila tidak ada. */
  market: { symbol: string; token: string } | null;
  /**
   * Nama dan gambar di kartunya, bila bukan bawaan ("<SYMBOL> Market Agent" dan mark ADEXTO). Dipakai
   * Loop Agent: ia mendaftarkan dirinya sendiri dengan nama itu di film MCP, dan logonya logo pasarnya.
   */
  cardFace?: { name?: string; image?: string };
}

export const OPERATED_AGENTS: readonly OperatedAgent[] = [
  { chainId: 16661, agentId: "3545431", name: "ADEXTO Protocol Agent", operator: "deployer", market: null },
  { chainId: 8453, agentId: "84622", name: "ADEXTO Protocol Agent", operator: "deployer", market: null },
  { chainId: 42161, agentId: "1457", name: "ADEXTO Protocol Agent", operator: "deployer", market: null },
  { chainId: 143, agentId: "10247", name: "ADEXTO Protocol Agent", operator: "deployer", market: null },
  // Arc, 2026-10-06: scripts/register-agent-8004.mjs --chain arc (tx 0x801c46fb…3b9a), pinned ipfs:// file.
  { chainId: 5042, agentId: "1422", name: "ADEXTO Protocol Agent", operator: "deployer", market: null },
  {
    chainId: 143,
    agentId: "10251",
    name: "Curb Market Agent",
    operator: "deployer",
    market: { symbol: "PARCEL", token: "0xC0B02176D37C1a64A6B493335115dB5D6D645E1F" },
  },
  {
    chainId: 143,
    agentId: "10275",
    name: "SAi Monad Agent",
    operator: "agentA",
    market: { symbol: "SAI", token: "0xD873B033e2dffbF7E3107CD61E7156cE23B39f20" },
  },
  {
    chainId: 42161,
    agentId: "1566",
    name: "SAi Arbitrum Agent",
    operator: "agentA",
    market: { symbol: "SAI", token: "0xC4b5eA97bd4e3f8Bc047fFCc74Ca9c2B6b426cb3" },
  },
  {
    chainId: 4663,
    agentId: "6525",
    name: "SAi Robin Agent",
    operator: "agentA",
    market: { symbol: "SAI", token: "0x4C63223B883B3096bC1Bd24087b56951D1dAC82d" },
  },
  // Arc, 2026-10-06: registered by Agent A over MCP (tx 0x75452495…0391), bound to $SAI at launch
  // (tx 0x90a09e61…6a47). Keeps the name it registered under; its picture is the market's logo.
  {
    chainId: 5042,
    agentId: "1421",
    name: "SAi Arc Agent",
    operator: "agentA",
    market: { symbol: "SAI", token: "0x670062eDe99Fc9Ac946895dB146b88D54b01c76e" },
    cardFace: { name: "SAi Arc Agent", image: "/api/logo/5042-sai-f072e7fe.png" },
  },
  // Registered by Agent A itself over MCP on 2026-10-03 (tx 0xdee136e2…e009), then bound to $LOOP at
  // launch (tx 0x086de87c…a9c4). Keeps the name it registered under; its picture is $LOOP's logo.
  {
    chainId: 143,
    agentId: "10276",
    name: "Loop Agent",
    operator: "agentA",
    market: { symbol: "LOOP", token: "0x6AF1B9A42213e87B7f3b8a7Ac93447aEA7f615B2" },
    cardFace: { name: "Loop Agent", image: "/api/logo/143-loop-1203f178.png" },
  },
  // The same flow on Arbitrum One: registered by Agent A over MCP on 2026-10-03 (tx 0x42c937d2…8e46),
  // then bound to $LOOP at launch (tx 0x0f8e469c…030e). Same name, same logo as the Monad one.
  {
    chainId: 42161,
    agentId: "1578",
    name: "Loop Agent",
    operator: "agentA",
    market: { symbol: "LOOP", token: "0x2F4Ca22703B6440d434833315505a2281011B228" },
    cardFace: { name: "Loop Agent", image: "/api/logo/42161-loop-1203f178.png" },
  },
  // End-to-end test, 2026-10-05: registered by Agent A over MCP (tx 0xca55aec1…993f), bound to $ARBTTEST at
  // launch (tx 0x92208bc4…79dc). Its market is hidden (src/config/hidden-markets.ts), so this agent is left
  // out of /agents, /api/agents and the well-known registration; its own card still serves.
  {
    chainId: 42161,
    agentId: "1593",
    name: "ARBT Test Agent",
    operator: "agentA",
    market: { symbol: "ARBTTEST", token: "0xeEe33340Db68A03Ece66970F34aa9ec46304e151" },
    cardFace: { name: "ARBT Test Agent", image: "/api/logo/42161-arbttest-9674f4a9.png" },
  },
];

/** `eip155:<chainId>:<registry>` dalam huruf kecil, bentuk yang dipakai berkas registrasi kami. */
export function agentRegistryOf(chainId: number): string {
  return `eip155:${chainId}:${AGENT_REGISTRY_ADDRESS.toLowerCase()}`;
}

interface OwnerCheck {
  owner: string | null;
  checkedAt: number;
}

declare global {
  var __ADEXTO_AGENT_OWNERS__: Map<string, OwnerCheck> | undefined;
}

const OWNER_TTL_MS = 10 * 60_000;

function ownerCache(): Map<string, OwnerCheck> {
  if (!globalThis.__ADEXTO_AGENT_OWNERS__) globalThis.__ADEXTO_AGENT_OWNERS__ = new Map();
  return globalThis.__ADEXTO_AGENT_OWNERS__;
}

/**
 * Pemilik agen dibaca dari Identity Registry, dengan cache 10 menit.
 *
 * Gagal baca TIDAK menghapus hasil terakhir yang berhasil: kalau tidak, RPC yang sesekali
 * gagal akan membuat bukti domain berkedip-kedip. Yang belum pernah terbaca dianggap belum
 * terbukti (null), bukan dianggap milik kami.
 */
export async function agentOwner(chainId: number, agentId: string): Promise<string | null> {
  const key = `${chainId}:${agentId}`;
  const cached = ownerCache().get(key);
  if (cached && Date.now() - cached.checkedAt < OWNER_TTL_MS) return cached.owner;
  const chain = resolveChain(chainId);
  if (!chain || chain.chainId !== chainId) return cached?.owner ?? null;
  try {
    const registry = new ethers.Contract(AGENT_REGISTRY_ADDRESS, IDENTITY_REGISTRY_ABI, readProvider(chain));
    const owner = ethers.getAddress(String(await registry.ownerOf(BigInt(agentId))));
    ownerCache().set(key, { owner, checkedAt: Date.now() });
    return owner;
  } catch {
    return cached?.owner ?? null;
  }
}

/**
 * Agen yang boleh dipajang: tanpa agen yang pasarnya tersembunyi (`src/config/hidden-markets.ts`).
 * Sumbernya satu, pasar yang disembunyikan, jadi agen dan pasarnya tidak bisa berbeda status.
 * Kartu per agen (`agentCard`) tetap memakai `OPERATED_AGENTS` penuh: kartunya harus tetap terbaca
 * oleh Identity Registry dan 8004scan.
 */
export function publicOperatedAgents(): readonly OperatedAgent[] {
  return OPERATED_AGENTS.filter((a) => !a.market || !isHiddenMarket(a.chainId, a.market.symbol));
}

/** Agen kami yang pemiliknya terbukti salah satu alamat kami saat ini (hanya yang dipajang). */
export async function verifiedOperatedAgents(): Promise<Array<OperatedAgent & { owner: string }>> {
  const rows = await Promise.all(
    publicOperatedAgents().map(async (a) => {
      const owner = await agentOwner(a.chainId, a.agentId);
      return owner && isOurAddress(owner) ? { ...a, owner } : null;
    })
  );
  return rows.filter((r): r is OperatedAgent & { owner: string } => r !== null);
}
