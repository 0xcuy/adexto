/**
 * Subgraph read configuration.
 *
 * WHAT WAS WRONG WITH THE PREVIOUS REVISION
 *
 * It exported a single `GRAPH_STUDIO_CONFIG` describing a published subgraph as
 * though it were a working data source. Three things about it were false, all
 * verified on-chain and over IPFS on 2026-08-21:
 *
 *  1. `httpEndpoint` was
 *       https://gateway.thegraph.com/api/deploy-key/subgraphs/id/DdSBjB19...
 *     The path segment `deploy-key` is a placeholder that was never replaced with
 *     an API key. Queried live it answers
 *       {"errors":[{"message":"auth error: malformed API key"}]}
 *     Nothing in the app called it, so it never surfaced as a bug -- it just sat
 *     in the config looking like a data source.
 *
 *  2. The published deployment (0x13cf02a5..., IPFS QmPfyY62aJs1cVUA1CkLgbfsnx...)
 *     declares `network: mainnet` -- Ethereum -- while its `address` is
 *     0xe8E9Cf43f88D065892c35c4aDa002C7B8b11F3e0, which has 0 bytes of code on
 *     Ethereum and 7216 bytes on 0G. It scanned Ethereum from block 1 for a
 *     contract that only exists on 0G, and had therefore indexed nothing, ever.
 *
 *  3. `version: "v1.0.0"` and `monitoredFactory` pointed at the v1 factory, whose
 *     only handled event is `TrinityProjectCreated`. Curves, swaps and buyback
 *     burns had no place in that schema, while /docs claimed the subgraph indexed
 *     all three.
 *
 * ONE SUBGRAPH PER CHAIN, AND WHY THERE IS NO SINGLE URL
 *
 * A subgraph is always single-network: graph-node rejects a manifest whose
 * templates declare a different `network` than its dataSources. Four chains
 * therefore means four deployments behind four URLs, and each can be down,
 * behind, or absent independently. `src/lib/subgraph.ts` treats each one as
 * separately failable for exactly that reason.
 *
 * Two of the four cannot be served by The Graph at all. Against
 * graphprotocol/networks-registry v0.7.111: Base and Arbitrum have Subgraphs
 * support; Monad is listed without it; 0G is absent from the registry entirely.
 * So Base and Arbitrum go to Studio and the decentralized network, while 0G and
 * Monad are served by the Graph Node in subgraph/docker-compose.yml.
 */
import type { ChainKey } from "@/lib/chains";

/**
 * The published subgraph NFT on Arbitrum One.
 *
 * Kept because the NFT is real and reusable: publishing a new version to the same
 * token id preserves the id, and therefore the query URL. Its curation signal was
 * withdrawn on 2026-08-21 (21.39438708 GRT out, `burnSignal`, nSignal now 0), and
 * `disabled` is still false, so the id remains available for a new version.
 *
 * `indexes` is deliberately explicit. It is the honest answer to "what does this
 * currently serve", and the answer is nothing.
 */
export const PUBLISHED_SUBGRAPH = {
  /** Token id of the subgraph NFT, base58. Survives version changes. */
  subgraphId: "DdSBjB19RrovZJbpcbXwgTRtDUTRppTWwMsVznjARjQv",
  explorerUrl:
    "https://thegraph.com/explorer/subgraphs/DdSBjB19RrovZJbpcbXwgTRtDUTRppTWwMsVznjARjQv?view=Query&chain=arbitrum-one",
  studioUrl: "https://thegraph.com/studio/subgraph/adexto-protocol",
  /** Owner of the NFT. Publishing a new version requires this wallet. */
  owner: "0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D",
  /**
   * What the currently published version actually indexes. Read from the
   * deployment manifest on IPFS, not from a dashboard.
   */
  indexes: {
    deploymentId: "0x13cf02a5f959d78b99a9c72be5138cb55bd0dee10a178062c4a3f4d63ca6b541",
    ipfs: "QmPfyY62aJs1cVUA1CkLgbfsnxyN3JLdGD2V15q263DQxp",
    network: "mainnet",
    address: "0xe8E9Cf43f88D065892c35c4aDa002C7B8b11F3e0",
    /** Zero rows, and no possible future rows: wrong chain for that address. */
    servesData: false,
  },
  /** Signal withdrawn; the NFT itself is intact and can take a new version. */
  curationSignalGrt: 0,
} as const;

/**
 * Per-chain query endpoints, server-side only.
 *
 * Not prefixed NEXT_PUBLIC_: a gateway URL embeds an API key, and inlining that
 * into the client bundle would publish it. `/api/graphql` reads the subgraph on
 * the server and returns merged data, so the browser never needs the URL.
 *
 * Values look like:
 *   Studio / decentralized network
 *     https://gateway.thegraph.com/api/<API_KEY>/subgraphs/id/<SUBGRAPH_ID>
 *   Self-hosted Graph Node (subgraph/docker-compose.yml)
 *     http://graph-node:8000/subgraphs/name/adexto/0g-testnet
 *
 * `graph-node` resolves inside the shared `adexto-net` docker network, which is
 * why the indexer needs no published host port.
 */
const ENDPOINT_ENV: Record<ChainKey, string> = {
  "0G": "SUBGRAPH_URL_0G",
  Arbitrum: "SUBGRAPH_URL_ARBITRUM",
  Base: "SUBGRAPH_URL_BASE",
  Monad: "SUBGRAPH_URL_MONAD",
  Devchain: "SUBGRAPH_URL_DEVCHAIN",
};

/** An endpoint must be an absolute http(s) URL or it is ignored. */
function readEndpoint(key: ChainKey): string | null {
  const raw = process.env[ENDPOINT_ENV[key]]?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // A gateway URL with the placeholder still in it is worse than no URL: it
    // produces an auth error on every request and looks like an outage. This is
    // the exact shape that shipped in the previous revision.
    if (/\/api\/(deploy-key|api-key|\{[^}]*\})\//.test(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

export const SUBGRAPH_ENDPOINTS: Record<ChainKey, string | null> = {
  "0G": readEndpoint("0G"),
  Arbitrum: readEndpoint("Arbitrum"),
  Base: readEndpoint("Base"),
  Monad: readEndpoint("Monad"),
  Devchain: readEndpoint("Devchain"),
};

export const SUBGRAPH_ENV_NAMES = ENDPOINT_ENV;

/** True when at least one chain has a usable endpoint. */
export const ANY_SUBGRAPH_CONFIGURED = Object.values(SUBGRAPH_ENDPOINTS).some(Boolean);

/**
 * Request budget for a single chain.
 *
 * Short on purpose. The registry has already produced a complete answer by the
 * time these run, so a slow indexer must cost the response a little latency and
 * nothing else. Overridable because a cold self-hosted node answers slower than
 * a warm gateway.
 */
export const SUBGRAPH_TIMEOUT_MS = Number(process.env.SUBGRAPH_TIMEOUT_MS || 2500);

/** Cache window for merged curve stats, in milliseconds. */
export const SUBGRAPH_CACHE_MS = Number(process.env.SUBGRAPH_CACHE_MS || 10_000);
