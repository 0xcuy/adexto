# Adexto on Monad — Envio HyperIndex

Indexes `AdextoFactory` 0.11.0 and every bonding curve it deploys on Monad mainnet
(chain 143): launches, swaps, buyback burns, fee claims, and ERC-8004 agent bindings.

## Why this exists as its own indexer

The rest of Adexto is served by a subgraph. Monad cannot be: checked against
`graphprotocol/networks-registry`, `monad` is listed **without** Subgraphs support — only
Firehose and Substreams — so Studio will not accept it no matter how the manifest is
written. The alternatives were running our own Graph Node for Monad or using an indexer
that actually serves the chain. The second one does not ask us to maintain tens of GB of
chain state.

What makes this more than a port: reading Monad directly is capped at a 100-block
`eth_getLogs` window, so the trading terminal could only see about eight minutes into the
past, and trade history had to be persisted through a telemetry store to survive at all.
This indexer removes the reason that store exists.

## Data source

HyperSync, and Monad mainnet is supported — probed rather than assumed:

```
$ curl -s https://143.hypersync.xyz/height
{"height":104504070}
```

`rpc` in `config.yaml` is therefore a **fallback only**. Putting RPC first would reinstate
exactly the limit this indexer exists to remove: 1.92M blocks since the factory was
deployed, divided by Monad's 100-block window, is about 19,200 `eth_getLogs` calls.

HyperSync requires a free API token (`ENVIO_API_TOKEN`). Without it the indexer stops on
the first fetch — it does not silently fall back to RPC.

## Query it without installing anything

The indexer is live, and its data is readable anonymously:

```bash
curl -s -X POST https://adexto.xyz/api/indexer/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ Curve { id swapCount volumeNative totalProtocolFees } Swap_aggregate { aggregate { count } } }"}'
```

`GET` the same URL for the entity list, the live sync position, and a copy-paste query.
Introspection is enabled, so any GraphQL client can explore the schema.

**Read-only is enforced by Hasura's permission system, not by the proxy.** Unauthenticated
requests map to a role holding `select` permissions only, so the schema exposed to the public
has no mutation root at all — a `mutation` fails with `no mutations exist` rather than being
pattern-matched away. Hasura itself is never exposed: `/v1/metadata` and `/v2/query` can
change schemas and run raw SQL, and neither is reachable through this route.

One query worth running, because it checks our numbers against the chain without trusting us:

```
totalVolumeNative() / 1000 == totalProtocolFees
```

The protocol leg is 10 bps of gross volume, so those two must agree on every curve. Call
`swapCount()` on either curve address and compare it with `swapCount` above while you are
there.

## Run your own copy

```bash
npm install
cp .env.example .env          # then paste your ENVIO_API_TOKEN
npx envio local docker up     # Postgres + Hasura
npx envio start
```

GraphQL lands on `http://localhost:8080/v1/graphql` (admin secret `testing`).

For the production shape — indexer, Postgres and Hasura as long-running services with no
published ports — see `docker-compose.yml` in this directory. It is deliberately separate from
the site's compose file: the site rebuilds on every code change, while the indexer has to stay
up and track the chain head.

## What the schema is careful about

These are the places where a plausible-looking implementation reports the wrong number
without raising an error.

- **`openingPriceNative` is derived, never copied from `CurveInitialized.openingPrice`.**
  That event parameter is the raw contract value, wei per 1e18-token. Copying it would put
  three fields whose names all end in `PriceNative` into two units that differ by 1e18.
- **`protocolFee` is not added to `totalDepthFees`.** The depth slice settles inside the
  curve and is what lifts the price floor; the protocol slice leaves the curve. Summing
  both reports a floor higher than the curve can actually pay.
- **Volume is recorded in native in both directions**, `isBuy ? amountIn : amountOut`.
  `amountIn` is native on a buy but tokens on a sell, so using it as-is adds two different
  units into one meaningless figure.
- **`agentBound` is stored explicitly, not derived from `agentId != 0`.** Agent id 0 is a
  real agent owned by someone on all four mainnets. The contract had this wrong at exactly
  this point and it was fixed before broadcast.
- **`AgentBinding` is its own entity.** The factory emits `AgentBound` *before*
  `TrinityProjectDeployed`, so `Project` does not exist yet when the binding arrives.
- **A buyback increments `swapCount`.** The contract does too; not following it would make
  on-chain and indexed counters differ forever. Its `depthFee` lifts the floor like any
  other fill.
- **Zero is never accepted as a candle low.** A zero price only means the token reserve is
  empty; letting it through drops every candle to zero.
- **A creator claim only increases `totalCreatorFeesClaimed`** and never reduces
  `totalCreatorFees`. The difference is what is still claimable.
- **`ProtocolFeeClaim` stores both `to` and `caller`.** `claimProtocolFees()` is
  permissionless, so anyone can trigger it; storing both is the only way to show the
  destination cannot be hijacked by the caller.

No handler makes a contract call. Everything needed is already in the events, and an
`eth_call` would reintroduce a per-block dependency on RPC — the thing this indexer is here
to get away from.

## Deliberately not indexed

| Item | Why |
| --- | --- |
| `AdextoCurveFactory` 0.10.0 on Monad (`0xbC72FE919F85E679e7d95e2b471AaDA3c7c3Ac39`) | `totalProjectsCount()` is 0. Its `Swap` has a different signature, so indexing it means a second ABI and handler guarding zero rows. |
| `TrinityProjectCreated` | Emitted on the same path as `TrinityProjectDeployed` but carries only some fields. Two sources for one launch, with nothing to say about which wins. |
| `TreasuryFeeCollected` | Its value is already carried by `Swap.treasuryFee` on the same fill, so it would double-count one slice. |
