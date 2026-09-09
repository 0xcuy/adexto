# Metropolis — Submission Runbook

> Hackathon: **Monad Metropolis** · Repo: `/home/cucu/Coder/Work/adexto` · Demo: `adexto.xyz`
> Build window: **1 Sep 2026 → 13 Oct 2026** · Judging: 14–27 Oct · Winners: 3 Nov

This file exists so nothing about the submission has to be remembered. Anything claimed to
a judge, a mentor, or the project profile is written down here with the evidence that backs
it. Where something is **not** built, it says so — the same rule the rest of this repo runs
on, because a claim that cannot survive a click costs more than a shorter list.

Written in English on purpose: most of it is text that gets pasted into a public profile or
read by mentors, so keeping it in one language removes a translation step where claims drift.

---

## 0. What is being submitted

| Field | Value |
| --- | --- |
| Project name | `Adexto` |
| Primary track | **01 — Onchain Finance & Trading** (`SELECTED`) |
| One-line description | `Every launch opens a bonding-curve market on Monad with no liquidity deposit, tradable from the first block and fillable with USDC from another chain.` |
| Demo URL | `https://adexto.xyz` (x402 reference: `https://adexto.xyz/x402`) |
| Code | `https://github.com/0xcuy/adexto` |

### Why Track 01 and not Track 04

Track 01 asks for "new asset primitives, market structures, and trading experiences enabled
by fast, cheap settlement." The curve is a market structure: it opens against a virtual
reserve so no liquidity deposit is needed, it never graduates to an external pool, it has no
owner and no withdrawal function, and the creator is paid out of swap flow instead of holding
an allocation. The strongest evidence in this repo is also financial — real transactions and
measured round-trip economics — which is the language this track is judged in.

Track 04 was rejected deliberately. Its core is "trust, provenance, and user-owned data
primitives", and this project does not do provenance. The 0G router's Intel TDX attestation
is **read as a declaration and never verified** by us, which is exactly why
`audit_claims.mjs` bans the phrase `Hardware Attested`. Entering Track 04 would invite
claims that this repo's own guardrails forbid.

---

## 1. Sponsor bounties

Selection rule: a bounty is worth adding only when it rides on work the project needs
anyway. Anything else is a tax on the core submission, and every added bounty is a promise
that gets checked.

### Added

| Bounty | Sponsor | Award | Why it fits |
| --- | --- | --- | --- |
| Bring Any-Chain Liquidity to Monad | Aurora Intents | $5,000 | "Any-chain deposits, swaps, or deposit-and-execute" is the submission itself |
| Best use of Nansen | Nansen AI | $5,000 pool | Agent has no market-intelligence input today; Nansen covers Monad |
| Best Agent Wallet Plugin | MetaMask | $2,500 | The x402 endpoint is already an agent trading capability |
| Best Use of Envio | Envio | $1,000 | Monad is not indexed at all yet; this is required work regardless |
| Best Projects using Alchemy | Alchemy | $1,000 credits | Fixes the real Base RPC rate-limit problem behind the relay |

Note on Nansen: the award reads "$5,000 **total prize pool**", unlike the others which read
"$5,000 USD". Expect it to be split. Also note Nansen **already ships its own MCP server**,
so the integration must consume it — building a wrapper around a sponsor's own product would
count against the submission.

### Deliberately not added

| Bounty | Reason |
| --- | --- |
| Bring New Assets and Markets to Kuru ($5,000) | Closest fit of any bounty, but listing on an order book is graduation, and "the curve is the permanent venue, no graduation" is a documented design claim. Needs a conscious reversal, not a grab for prize money. |
| Best workflow with CRE, Chainlink ($3,000) | CRE is not CCIP, but `audit_claims.mjs` bans the word `Chainlink` with a written reason. Taking this means retracting that stance on purpose. |
| Best Builds Powered by KIMI ($3,000 credits) | No honest job for it. The agent already runs on the 0G Compute Router, and swapping or bolting on a second model would be cosmetic — the bounty asks for "genuinely powered by". |
| Agora Mobile Trading App ($10,000) | Needs a mobile app plus Mera plus AUSD plus Perpl. Three detours. |
| Perpl API / Perpl Analytics | Perps, not this venue. |
| Privy, Mera-as-account-layer | Would replace a wallet layer built deliberately on EIP-6963 discovery. |
| Agora Cross-Border, Cleanverse, Hunyuan, Qwen | Locked to tracks other than 01. Not eligible. |

---

## 2. What counts as in-window work

The rule that matters: *"what you show on 13 Oct should have been built during the six
weeks"*, and *"judges need to be able to verify what you built during the six weeks."*

The repo itself is younger than the hackathon by two weeks, so most of it qualifies — but
the boundary must be stated rather than blurred.

```
baseline (last commit before the window opened)
  084f1c268348af7033b1b1af1928b5030c1fa3c3
  084f1c2  2026-08-31 19:08  Perbaiki fee depth yang salah label + metadata launch basi

first commit inside the window
  a276194  2026-09-01 00:56  ui: move non-data text from monospace to sans

commit counts
  pre-window   66
  in-window   105
  total       171
```

The submission diff is therefore:

```bash
git diff 084f1c2..HEAD
git log --oneline 084f1c2..HEAD
```

### Built inside the window — claim these

| What | Evidence |
| --- | --- |
| Curve + factory **0.11.0**, additive protocol fee leg | `cebed46` 2026-09-07 |
| **0.11.0 broadcast to all four mainnets**, Monad included | `e5fa698` 2026-09-07 |
| x402 turned into a cross-chain buy product | `e095163` 2026-09-10 |
| Real EIP-3009 settlement path (`cloudflare-worker/src/x402.ts`) | same day, proven with funds below |
| Locked Base RPC relay (`src/app/api/rpc/base/route.ts`) | in-window |
| `/x402` integration reference page | `7f1ac4a` 2026-09-10 |

### Predates the window — do not claim as new

- The bonding-curve concept and its earlier factory generations (0.9.0, 0.10.0).
- The app shell: studio, explorer, swap, token terminal, wallet layer.
- Position these as existing infrastructure the new work builds on. Being explicit here is
  an asset: a judge who sees the boundary drawn honestly will trust the rest of the list.

---

## 3. Verified facts, read back from chain

Everything in this section was queried, not remembered. Re-verify before quoting it in a
submission, because on-chain state moves.

### Monad Mainnet (chainId 143)

```
AdextoFactory   0x5800e9715a47a598fce9bc3B65a95FD6BeBf76A3
  VERSION            0.11.0
  bytecode           21,281 bytes
  PROTOCOL_FEE_BPS   10
  MAX_SUPPLY         1_000_000_000_000   (whole tokens, NOT wei)
  ANTI_SNIPER_BPS    100
  AGENT_REGISTRY     0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
  protocolTreasury   0x24268Fffc119ec5550F68e80D94476fD64daE967
  totalProjectsCount 0        <-- no market exists on Monad yet
```

`deployTrinity` was simulated with `staticCall` and `estimateGas` — **no transaction was
broadcast**. It passes: roughly **3.16M gas**, about **0.32 MON** per launch at 102 gwei.
Deployer `0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D` holds **9.79 MON**, enough for
roughly 30 launches.

Two argument traps found while simulating, both of which revert if ignored:

- `initialSupply` is in **whole tokens**, not wei. `MAX_SUPPLY` is `1e12` whole tokens, so
  passing `parseEther(...)` reverts with `Factory: bad supply`.
- `agentIdentity` **must not be the zero address**, even when `bindAgent` is `false`.
  Otherwise: `Factory: zero agent`.

Other guards in `AdextoFactory.sol`: symbol 1–12 bytes, name 1–64 bytes, `virtualNative > 0`,
`swapFeeBps + PROTOCOL_FEE_BPS <= 500`, `creatorShareBps + treasuryShareBps <= swapFeeBps`,
symbol unique per chain, and `agentId` must be `0` unless `bindAgent` is set.

### Explorer

`monadvision.com` answers **HTTP 403**, including with a real browser User-Agent. It was
replaced with `monadscan.com` across `README.md` (7 links), `src/config/contracts.ts`, and
two scripts. Caveat worth keeping in mind: `monadscan.com` is a single-page app that returns
200 for any path, so a 200 proves the domain serves rather than that the address has data.
Confirm one link visually in a browser.

### The cross-chain buy, proven with real funds

Currently pointed at 0G, not Monad. One request produced both legs; round trip 16.2s.

```
payment   Base    0x65a79f7b35fb755aee92da2bb11703df1045955188df352ab4dcfc9b18a62190
delivery  0G      0x7a1583a34e7abd49347b2686bf7c63cf0344f39ec565d85df73ffb502e6d7daf
```

An earlier settlement-only test, plus the replay refusal, on mainnet USDC:

```
settle    Base    0x470494bd9b1401cd7e9a9ede88dc54011d96ea8d2e06624445d7b216d75049d2
replay            refused with invalid_transaction_state (nonce already used)
```

Live endpoint and its current terms:

```
GET https://adexto-x402-edge.cucuvirtual.workers.dev/v1/x402/buy/adexto
  x402Version        2
  scheme / network   exact / base
  asset              0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913   (USDC on Base)
  payTo              0x24268Fffc119ec5550F68e80D94476fD64daE967
  maxAmountRequired  100000        (0.10 USDC, 6 decimals)
  spread / slippage  300 bps / 150 bps
```

---

## 4. Open work, in order

1. **Launch the first bonding-curve market on Monad.** The path is simulated and passing but
   has never actually run: `totalProjectsCount` is `0`. Real mainnet transaction, ~0.32 MON,
   irreversible — needs an explicit go-ahead.
2. **Make the x402 worker multi-chain.** `cloudflare-worker/wrangler.toml` only carries
   `OG_RPC`, so 0G is the sole delivery target. Monad has to become one before any
   cross-chain fill can land there.
3. **Route the incoming USDC into the curve's buyback-and-burn vault.** The vault and its
   burn path are on-chain and anyone can trigger a burn, but the endpoint does not feed it.
   This is currently disclosed as a gap on `/x402` and in `/docs`.
4. **Index Monad** (Envio bounty). The subgraph covers Base and Arbitrum only.
5. **Feed Nansen intelligence into an actual decision**, not a dashboard — inventory
   rebalancing is the natural consumer.

### Housekeeping that affects credibility

- `contracts/AdextoCCIPReceiver.sol` and `contracts/AdextoCCIPTreasuryRouter.sol` are still
  in the tree while `audit_claims.mjs` bans the word `CCIP`. Either delete them or add a
  header stating they are inert. Ambiguity here reads worse than either choice.
- The market registry advertises `mcpTools: ["Signet","Sentinel","Helm","x402"]`, and
  `/docs` says the MCP tool suite is not live. Consuming Nansen's MCP does **not** settle
  that claim; exposing our own MCP tools would. Do not conflate the two in a write-up.

---

## 5. Progress updates posted

The platform's Progress Updates tab is private to the team, organizers and mentors, and at
least one update is required to unlock mentor support. Keep entries small and dated: they
are corroborating evidence that work happened inside the window, alongside the git history.

Rule learned the hard way: **a Monad submission update must lead with a Monad link.** The
first draft of update #1 carried three links, all of them to Base and 0G explorers, and read
as though Monad were an afterthought.

| # | Date | Status | Summary |
| --- | --- | --- | --- |
| 1 | _to post_ | On track | AdextoFactory 0.11.0 live on Monad, broadcast inside the window |

---

## 6. Checks to run before any submission edit

```bash
# types
rm -rf .next/types && ./node_modules/.bin/tsc --noEmit -p tsconfig.json

# claims: rendered copy vs what is defensible (needs the site running at BASE_URL)
BASE_URL=https://adexto.xyz node audit_claims.mjs

# internal consistency: prose vs chain vs config
node audit_consistency.mjs
```

Commit messages must be English. `audit_claims.mjs` reads rendered web copy only — it never
reads commit messages, code comments, or GitHub metadata, so those stay a manual check.
