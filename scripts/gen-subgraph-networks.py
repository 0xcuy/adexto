#!/usr/bin/env python3
"""
Regenerate the subgraph's two derived config files from one source of truth.

    build/deployments.json  +  subgraph/chains.json
        -> subgraph/networks.json     (graph-cli: address + startBlock)
        -> subgraph/graph-node.toml   (graph-node: per-chain RPC tuning)

Run it after every factory broadcast:

    npm run networks        (from subgraph/)
    python3 scripts/gen-subgraph-networks.py

WHY GENERATE THE TOML INSTEAD OF EDITING IT

The chain sections carry per-chain eth_getLogs ceilings that differ by two orders
of magnitude between 0G (2000) and Monad (100). Hand-maintaining that next to a
hand-maintained list of npm scripts is how a stack ends up indexing mainnet while
every name in it still says testnet. Add an address to deployments.json, run this,
and mainnet appears everywhere at once -- config, scripts, and node.

Only networks that have BOTH an entry in chains.json and a deployed curveFactory
address in deployments.json are emitted. A network with no factory is not a
failure; there is simply nothing to index yet.
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEPLOYMENTS = os.path.join(ROOT, "build", "deployments.json")
CHAINS = os.path.join(ROOT, "subgraph", "chains.json")
NETWORKS_OUT = os.path.join(ROOT, "subgraph", "networks.json")
TOML_OUT = os.path.join(ROOT, "subgraph", "graph-node.toml")

DATA_SOURCE = "AdextoCurveFactory"
NODE_ID = "adexto_index_0"

TOML_HEADER = '''# GENERATED FILE -- DO NOT EDIT BY HAND
#
# Written by scripts/gen-subgraph-networks.py from subgraph/chains.json and
# build/deployments.json. Edit chains.json and re-run `npm run networks`.
#
# WHY A TOML FILE INSTEAD OF THE `ethereum:` ENV VAR
#
# The chains indexed here have eth_getLogs ceilings that differ by two orders of
# magnitude (0G accepts a 2000-block span, Monad hard-caps at 100 and answers
# HTTP 413 above it). `GRAPH_ETHEREUM_MAX_BLOCK_RANGE_SIZE` is a single global
# env var: set it to 100 for Monad and the 0G backfill does 20x the requests it
# needs; leave it at the default and every Monad request fails. Per-chain
# `max_block_range_size` is the only way to serve both from one process.
#
# NO `traces` AND NO `archive` IN ANY features LIST
#
# No RPC here serves them, and 0G's is pruned rather than archive. Declaring a
# feature the provider lacks does not enable it -- it makes graph-node issue
# calls that fail and stall the subgraph. The mappings need neither: every curve
# value is derived from event payloads, with zero `.bind()` and zero `try_*`.
# Keep it that way. One contract call and this stack needs an archive node.
#
# Every chain below does support eth_getBlockReceipts, which graph-node probes
# for at startup and prefers over per-transaction receipt fetches.

[store]
[store.primary]
connection = "postgresql://graph:${POSTGRES_PASSWORD}@postgres:5432/graph"
pool_size = 10

[chains]
ingestor = "%s"
# Blocks kept cached from chain head. Must exceed the reorg threshold.
cache_size = 500
''' % NODE_ID

TOML_FOOTER = '''
[deployment]
[[deployment.rule]]
# No `match`, so every deployment lands here. Single node, single shard.
indexers = ["%s"]
''' % NODE_ID


def load(path):
    with io.open(path, encoding="utf-8") as fh:
        return json.load(fh)


def toml_chain(name, meta):
    """One [chains."<name>"] section. Name is always quoted: `0g` starts with a
    digit and every testnet name contains a hyphen."""
    probed = meta.get("probed", "")
    lines = ['[chains."%s"]' % name]
    lines.append("# %s, chainId %d." % (meta.get("label", name), meta["chainId"]))
    if probed:
        # Keep the probe evidence next to the numbers it justifies, wrapped.
        words, line = probed.split(), "#"
        for w in words:
            if len(line) + len(w) + 1 > 78:
                lines.append(line)
                line = "#"
            line += " " + w
        lines.append(line)
    lines.append('shard = "primary"')
    lines.append("polling_interval = %d" % meta["pollingInterval"])
    lines.append("max_block_range_size = %d" % meta["maxBlockRange"])
    lines.append("max_event_only_range = %d" % meta["maxBlockRange"])
    lines.append("block_batch_size = 5")
    lines.append("target_triggers_per_block_range = 100")
    lines.append("json_rpc_timeout = 120")
    lines.append("request_retries = 15")
    lines.append("# Default is 1000 concurrent receipt requests, which a small")
    lines.append("# public RPC answers with rate limits rather than data.")
    lines.append("block_ingestor_max_concurrent_json_rpc_calls = 16")
    lines.append(
        'provider = [\n  { label = "%s", url = "%s", features = [] },\n]'
        % (name, meta["rpc"])
    )
    return "\n".join(lines)


def main():
    deployments = load(DEPLOYMENTS)
    chains = load(CHAINS)

    networks = {}
    self_hosted = []
    studio = []
    pending = []

    for name, meta in chains.items():
        if name.startswith("_"):
            continue
        entry = deployments.get(meta["deploymentKey"]) or {}
        address = entry.get("curveFactory")
        if not address:
            pending.append((name, meta))
            continue

        start_block = entry.get("startBlock", entry.get("blockNumber", 0))
        networks[name] = {
            DATA_SOURCE: {"address": address, "startBlock": start_block}
        }
        row = (name, meta, address, start_block)
        (self_hosted if meta["target"] == "self-hosted" else studio).append(row)

    if not networks:
        sys.stderr.write(
            "no network has a deployed curveFactory; refusing to write empty config\n"
        )
        return 1

    with io.open(NETWORKS_OUT, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(networks, indent=2) + "\n")

    sections = [TOML_HEADER]
    for name, meta, _addr, _sb in self_hosted:
        sections.append(toml_chain(name, meta))
    sections.append(TOML_FOOTER)
    with io.open(TOML_OUT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(sections))

    print("subgraph/networks.json  %d network(s)" % len(networks))
    print("subgraph/graph-node.toml  %d self-hosted chain(s)" % len(self_hosted))
    print()
    print("Subgraph Studio (The Graph runs the infrastructure):")
    for name, meta, addr, sb in studio:
        print("  %-18s %s  startBlock=%-10s -> %s" % (name, addr, sb, meta["studioSlug"]))
    if not studio:
        print("  (none)")
    print()
    print("Self-hosted Graph Node (The Graph does not serve these chains):")
    for name, meta, addr, sb in self_hosted:
        print(
            "  %-18s %s  startBlock=%-10s getLogs<=%d"
            % (name, addr, sb, meta["maxBlockRange"])
        )
    if not self_hosted:
        print("  (none)")
    print()
    print("No factory deployed yet, nothing to index:")
    for name, meta in pending:
        print("  %-18s (%s, target=%s)" % (name, meta["label"], meta["target"]))
    if not pending:
        print("  (none)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
