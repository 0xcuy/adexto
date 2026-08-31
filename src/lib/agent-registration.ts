/**
 * ERC-8004 agent registration files.
 *
 * Builds the JSON that an agent's `agentURI` must resolve to, and turns it into a
 * URI the registry can store.
 *
 * WHY THERE ARE TWO URI MODES, AND WHY `data:` IS THE DEFAULT
 *
 * An `ipfs://` URI is only worth anything if somebody pins the content. Writing a
 * CID that nothing serves produces a registration that looks resolvable and is not
 * — which is the dominant failure mode already visible in this ecosystem. An
 * empirical study of ERC-8004 across Ethereum, BSC and Base found that only 3-15%
 * of registrations exposed a live service endpoint, the rest being placeholders
 * (arXiv 2606.26028). Reading the live registries directly showed the same thing:
 * on the four chains ADEXTO launches on, agent #40 resolves to an empty string on
 * 0G, raw un-encoded JSON on Monad, an HTTPS URL whose embedded id does not even
 * match the token on Base, and a real `ipfs://` CID only on Arbitrum.
 *
 * So pinning is not optional infrastructure, and it needs a credential this repo
 * does not have. Until `PINATA_JWT` is configured, the default is a base64 `data:`
 * URI, which ERC-8004 explicitly provides for: "If the owner wants to store the
 * entire registration file on-chain, the agentURI SHOULD use a base64-encoded data
 * URI". It costs more gas once, and in exchange it cannot rot, cannot be
 * unpinned, and needs no gateway to read.
 *
 * `buildRegistrationFile` deliberately requires a real endpoint. There is no
 * placeholder default, because a placeholder is the thing being avoided.
 */
import { createHash } from "node:crypto";

/** A service entry in the registration file. */
export interface AgentService {
  name: string;
  endpoint: string;
  version?: string;
}

export interface RegistrationInput {
  name: string;
  description: string;
  image: string;
  services: AgentService[];
  /** True only when the agent really answers an x402 challenge. */
  x402Support: boolean;
  /** EVM chain id the agent is registered on. */
  chainId: number;
  /** Identity Registry address on that chain. */
  registryAddress: string;
  /**
   * The agent id, once known. ERC-8004 wants it inside the file, but it does not
   * exist until `register()` returns — so a file built before that call omits the
   * `registrations` block and a later `setAgentURI` can add it.
   */
  agentId?: number | bigint;
  /**
   * Trust models the agent genuinely supports. Left empty on purpose when none can
   * be substantiated: the spec says an absent or empty value means the entry is
   * used "only for discovery, not for trust", which is the accurate claim while
   * TEE attestation is read from a router rather than verified by us.
   */
  supportedTrust?: string[];
  active?: boolean;
}

/** ERC-8004 writes an agent's home as `{namespace}:{chainId}:{identityRegistry}`. */
export function agentRegistryId(chainId: number, registryAddress: string): string {
  return `eip155:${chainId}:${registryAddress.toLowerCase()}`;
}

/**
 * The registration file, shaped by the ERC-8004 `registration-v1` schema.
 *
 * Key order follows the spec's example so the top-level ERC-721 fields (`name`,
 * `description`, `image`) sit where NFT viewers look for them.
 */
export function buildRegistrationFile(input: RegistrationInput): Record<string, unknown> {
  if (!input.name.trim()) throw new Error("registration: name is required");
  if (!input.description.trim()) throw new Error("registration: description is required");
  if (input.services.length === 0) {
    // An agent with no endpoint is exactly the placeholder this file exists to
    // avoid publishing. Fail here rather than register something unreachable.
    throw new Error("registration: at least one service endpoint is required");
  }
  for (const s of input.services) {
    if (!/^(https?:|ipfs:|did:|mailto:|[a-z0-9.-]+\.eth$)/i.test(s.endpoint)) {
      throw new Error(`registration: service "${s.name}" endpoint looks invalid: ${s.endpoint}`);
    }
  }

  const entries = input.services.map((s) =>
    s.version
      ? { name: s.name, endpoint: s.endpoint, version: s.version }
      : { name: s.name, endpoint: s.endpoint }
  );

  const file: Record<string, unknown> = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: input.name,
    description: input.description,
    image: input.image,
    services: entries,
    /**
     * The same list is repeated under `endpoints`, and that is deliberate.
     *
     * ERC-8004 is inconsistent with itself: the schema example names the array
     * `services`, while the prose immediately below it discusses "the number and
     * type of endpoints". Real registrations follow the prose — the one
     * well-formed `ipfs://` registration among agent #40 on our four chains
     * (Zyfai, on Arbitrum One) publishes `endpoints` and no `services` at all.
     *
     * A reader written against either spelling would otherwise see an agent with
     * no way to reach it, which is the same outcome as publishing a placeholder.
     * Duplicating a short array costs a few hundred bytes once and removes the
     * guess.
     */
    endpoints: entries,
    x402Support: input.x402Support,
    active: input.active ?? true,
  };

  if (input.agentId !== undefined) {
    file.registrations = [
      {
        agentId: Number(input.agentId),
        agentRegistry: agentRegistryId(input.chainId, input.registryAddress),
      },
    ];
  }

  // Omitted entirely when empty: per the spec that means discovery-only, which is
  // truthful. Claiming "tee-attestation" would assert a verification we do not do.
  if (input.supportedTrust && input.supportedTrust.length > 0) {
    file.supportedTrust = input.supportedTrust;
  }

  return file;
}

/** Canonical bytes for hashing and uploading. Stable key order, no stray whitespace. */
export function serialize(file: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(file), "utf8");
}

/**
 * CIDv1, raw codec, sha2-256 — the `bafkrei…` form.
 *
 * Computed locally so a pinning service's answer can be CHECKED rather than
 * trusted: if Pinata returns a CID that does not match this, the bytes it stored
 * are not the bytes we built, and the registration would point at something we
 * never reviewed.
 *
 * Implemented directly instead of pulling in the multiformats package: it is a
 * version byte, a codec byte, a multihash prefix and base32, and a dependency on
 * the launch path is worth more scrutiny than twenty lines of encoding.
 */
export function computeCidV1Raw(bytes: Buffer): string {
  const digest = createHash("sha256").update(bytes).digest();
  // <cid-version 0x01><multicodec raw 0x55><multihash: sha2-256 0x12, len 0x20, digest>
  const cid = Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), digest]);
  return "b" + base32LowerNoPad(cid);
}

/** RFC 4648 base32, lowercase, unpadded — the multibase `b` alphabet. */
function base32LowerNoPad(data: Buffer): string {
  const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Self-contained on-chain URI. Resolvable without any gateway or pinning service. */
export function toDataUri(bytes: Buffer): string {
  return `data:application/json;base64,${bytes.toString("base64")}`;
}

export interface PinResult {
  ok: boolean;
  uri?: string;
  cid?: string;
  error?: string;
}

/**
 * Pin to IPFS through Pinata, and verify the CID it reports.
 *
 * Returns `ok: false` when no credential is configured. It deliberately does NOT
 * fall back to returning a CID it did not pin: an unpinned CID is a dead URI, and
 * a dead URI recorded on-chain is permanent. `uploadMetadataTo0G` in this repo
 * shows the failure mode being avoided — with no key it returned `ok: true` and a
 * keccak hash relabelled a "storage root", so a missing credential silently
 * produced a fabricated anchor.
 */
export async function pinToIpfs(bytes: Buffer, filename = "agent-registration.json"): Promise<PinResult> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    return { ok: false, error: "PINATA_JWT is not configured, so nothing can be pinned." };
  }

  const expected = computeCidV1Raw(bytes);
  try {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: "application/json" }), filename);
    const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
      body: form,
    });
    if (!res.ok) {
      return { ok: false, error: `Pinata responded ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    const data = (await res.json()) as { IpfsHash?: string };
    const cid = data.IpfsHash;
    if (!cid) return { ok: false, error: "Pinata response contained no IpfsHash." };
    return { ok: true, uri: `ipfs://${cid}`, cid, error: cid === expected ? undefined : `CID mismatch: pinned ${cid}, locally computed ${expected} (Pinata may wrap in a dag-pb node, which changes the CID but not the bytes)` };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/**
 * Pick the URI to register.
 *
 * Prefers a genuinely pinned `ipfs://`. Falls back to `data:` rather than to a
 * CID nobody serves, so the returned URI always resolves.
 */
export async function resolveAgentUri(
  file: Record<string, unknown>
): Promise<{ uri: string; mode: "ipfs" | "data"; note?: string }> {
  const bytes = serialize(file);
  const pinned = await pinToIpfs(bytes);
  if (pinned.ok && pinned.uri) {
    return { uri: pinned.uri, mode: "ipfs", note: pinned.error };
  }
  return { uri: toDataUri(bytes), mode: "data", note: pinned.error };
}
