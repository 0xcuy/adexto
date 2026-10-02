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
}

export const OPERATED_AGENTS: readonly OperatedAgent[] = [
  { chainId: 16661, agentId: "3545431", name: "ADEXTO Protocol Agent", operator: "deployer", market: null },
  { chainId: 8453, agentId: "84622", name: "ADEXTO Protocol Agent", operator: "deployer", market: null },
  { chainId: 42161, agentId: "1457", name: "ADEXTO Protocol Agent", operator: "deployer", market: null },
  { chainId: 143, agentId: "10247", name: "ADEXTO Protocol Agent", operator: "deployer", market: null },
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

/** Agen kami yang pemiliknya terbukti salah satu alamat kami saat ini. */
export async function verifiedOperatedAgents(): Promise<Array<OperatedAgent & { owner: string }>> {
  const rows = await Promise.all(
    OPERATED_AGENTS.map(async (a) => {
      const owner = await agentOwner(a.chainId, a.agentId);
      return owner && isOurAddress(owner) ? { ...a, owner } : null;
    })
  );
  return rows.filter((r): r is OperatedAgent & { owner: string } => r !== null);
}
