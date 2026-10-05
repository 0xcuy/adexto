/**
 * Berkas registrasi ERC-8004 untuk IDENTITAS UMUM agen (halaman `/agents/identity`), bukan agen satu pasar.
 *
 * Bedanya dengan `/api/agent/register` (Studio): di sana berkasnya menamai satu pasar ("Market agent for $SYM") dan
 * menunjuk endpoint x402 pasar itu. Identitas di sini dibuat SEBELUM ada pasar, lalu dipakai untuk peluncuran-peluncuran
 * berikutnya di chain yang sama (factory hanya memeriksa `ownerOf == msg.sender`, tanpa keunikan).
 *
 * LAYANAN BAWAAN: `did:pkh:eip155:<chainId>:<owner>`
 *
 * `buildRegistrationFile` wajib punya minimal satu endpoint, dan itu disengaja (placeholder adalah hal yang dihindari).
 * Endpoint yang kami tahu benar untuk agen yang baru lahir hanya wallet pemiliknya: DID `pkh` menamai akun itu tanpa
 * host siapa pun. Menulis MCP atau x402 milik ADEXTO di sini akan mengklaim agen ini bisa dihubungi di sana, padahal
 * tidak. Website hanya ditambahkan kalau pemilik mengisinya.
 *
 * Isi bebas (nama, deskripsi) adalah teks pemilik agen, dicatat apa adanya dalam batas panjang. Teks yang KAMI tulis ke
 * berkas (tidak ada, selain kunci skema) tetap English sesuai aturan bahasa.
 */
import { getAddress } from "ethers";
import { buildRegistrationFile, type AgentService } from "@/lib/agent-registration";

export const IDENTITY_NAME_MAX = 64;
export const IDENTITY_DESCRIPTION_MAX = 400;
export const IDENTITY_WEBSITE_MAX = 200;

export interface IdentityInput {
  chainId: number;
  registryAddress: string;
  owner: string;
  name: string;
  description: string;
  /** `ipfs://…` gambar yang sudah di-pin, atau "" bila tanpa gambar. */
  image: string;
  website?: string;
}

export type IdentityCheck = { ok: true; value: { owner: string; name: string; description: string; website: string | null } } | { ok: false; code: string; error: string };

/** Validasi isian pemilik. Dipakai server (dan cocok dengan batas di form). */
export function checkIdentityFields(raw: { owner?: unknown; name?: unknown; description?: unknown; website?: unknown }): IdentityCheck {
  let owner: string;
  try {
    owner = getAddress(String(raw.owner ?? "").trim());
  } catch {
    return { ok: false, code: "BAD_OWNER", error: "Connect the wallet that will own the agent." };
  }
  const name = String(raw.name ?? "").replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, code: "BAD_NAME", error: "Give the agent a name." };
  if (name.length > IDENTITY_NAME_MAX) return { ok: false, code: "BAD_NAME", error: `The name is longer than ${IDENTITY_NAME_MAX} characters.` };
  const description = String(raw.description ?? "").replace(/\s+/g, " ").trim();
  if (!description) return { ok: false, code: "BAD_DESCRIPTION", error: "Describe what the agent does in a sentence." };
  if (description.length > IDENTITY_DESCRIPTION_MAX) {
    return { ok: false, code: "BAD_DESCRIPTION", error: `The description is longer than ${IDENTITY_DESCRIPTION_MAX} characters.` };
  }
  const site = String(raw.website ?? "").trim();
  let website: string | null = null;
  if (site) {
    let u: URL;
    try {
      u = new URL(site);
    } catch {
      return { ok: false, code: "BAD_WEBSITE", error: "The website must be a full https:// address." };
    }
    if (u.protocol !== "https:" || site.length > IDENTITY_WEBSITE_MAX || u.username || u.password) {
      return { ok: false, code: "BAD_WEBSITE", error: "The website must be a full https:// address." };
    }
    website = u.toString();
  }
  return { ok: true, value: { owner, name, description, website } };
}

export function buildIdentityFile(input: IdentityInput): Record<string, unknown> {
  const services: AgentService[] = [];
  if (input.website) services.push({ name: "web", endpoint: input.website });
  services.push({ name: "DID", endpoint: `did:pkh:eip155:${input.chainId}:${input.owner}` });
  return buildRegistrationFile({
    name: input.name,
    description: input.description,
    image: input.image,
    services,
    x402Support: false,
    chainId: input.chainId,
    registryAddress: input.registryAddress,
  });
}

/**
 * Gateway publik untuk MENAMPILKAN `ipfs://`. Yang ditulis on-chain tetap `ipfs://`.
 *
 * Pinata dulu: berkas kartu di-pin di sana, jadi gateway-nya punya isinya tanpa mencari ke jaringan. ipfs.io dan dweb.link
 * menjawab 429 ke permintaan beruntun dari satu IP (diukur 5 Okt), jadi hanya cadangan.
 */
export const IPFS_GATEWAYS = ["https://gateway.pinata.cloud/ipfs/", "https://ipfs.io/ipfs/"] as const;
export function ipfsToHttp(uri: string, gateway: string = IPFS_GATEWAYS[0]): string {
  return uri.startsWith("ipfs://") ? `${gateway}${uri.slice("ipfs://".length).replace(/^ipfs\//, "")}` : uri;
}
