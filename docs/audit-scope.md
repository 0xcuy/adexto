# Audit scope

For a reviewer quoting on, or carrying out, a third-party review of the ADEXTO contracts.

There has been no human review. Eight analysers and fuzzers run against these contracts and their
output is published with every finding triaged at [adexto.xyz/security](https://adexto.xyz/security),
which is a different thing and is not offered as a substitute. This document exists so a reviewer
starts from what is already known rather than rediscovering it, and so the parts we cannot judge
ourselves are named rather than left for them to guess at.

## Read this first: the deployed bytecode is frozen

This is the constraint that changes what a recommendation is worth here, so it comes before the
scope rather than after it.

`AdextoFactory` `0.11.0` is live on four mainnets and **six markets reference its bytecode**. Every
fee rate in a curve is `immutable`, there is no proxy, no upgrade path and no admin. So a fix to
the source cannot reach a market that already exists — it can only produce a new factory
generation, and the existing markets keep the code they were born with permanently.

That is not a hypothetical. It already happened once: markets created by the superseded `0.10.0`
factory pay no protocol fee and never will, because their rates are immutable.

Measured, so the size of the constraint is clear rather than asserted: adding **one comment line**
to `AdextoFactory.sol` changes the runtime bytecode keccak from
`0x34b45bafad29b726d176bc2e15672a64be9ac16deeec85b501417fe60cb4fd66` to
`0x7dd9e6d7f73631e01dd42c29ce33a9655fc5cd579bda55942750014de8e9d3ea`. Length stays 21,281 bytes in
both cases, so **length is not evidence of sameness**. There is no `metadata: { bytecodeHash: "none" }`
in the compile settings, and the metadata carries a hash of the source.

The practical consequence for a review: findings that require a code change are still worth
reporting, and we want them. But they land as "the next generation must fix this", and a finding
that can be mitigated operationally on live markets is worth flagging as such, because that is the
only kind that can help the markets that exist today.

## In scope

The launch path. These six are what a launch actually executes:

| File | Role |
| --- | --- |
| `contracts/AdextoFactory.sol` | current factory, `0.11.0` |
| `contracts/AdextoCurve.sol` | curve deployed per launch by `0.11.0` |
| `contracts/AdextoToken.sol` | plain ERC-20 minted per launch |
| `contracts/AdextoCurveFactory.sol` | superseded factory, `0.10.0`, still deployed and permissionless |
| `contracts/SovereignCurve.sol` | curve of the `0.10.0` generation, still serving its markets |
| `contracts/IIdentityRegistry.sol` | interface for the ERC-8004 ownership check |

Both generations are in scope because both are still live and still reachable by anyone. Superseding
a factory in our UI does not remove it from a chain.

Also in scope, because they can move money: the x402 edge worker in `cloudflare-worker/`, the API
routes under `src/app/api/`, and the MCP server at `/api/mcp` including `pay_and_buy`.

### Deployed addresses

`AdextoFactory` `0.11.0`, runtime bytecode byte-identical across all four, 21,281 bytes, keccak
`0xcbb89e32ae973400723287f16f32e87f039efcef1c1f814c5805bd1a6fe3add8`, confirmed by `eth_getCode`
against each chain:

| Chain | Address |
| --- | --- |
| 0G Mainnet · 16661 | `0x51c4168226463F7e5A141e1c6D30520734BC840a` |
| Base · 8453 | `0x216E7880D64D94335B583c539802d3e61958d4A2` |
| Arbitrum One · 42161 | `0xE17f1027FC5f294327D701829baeD9d6519e922C` |
| Monad · 143 | `0x5800e9715a47a598fce9bc3B65a95FD6BeBf76A3` |

The compiled artefact hashes differently from all four, and that is expected rather than a
discrepancy: immutables live inside runtime bytecode and are still zero in the artefact. Compare
on-chain code against on-chain code.

Full address tables including superseded generations are in the
[README](../README.md#-mainnet-deployments).

## Out of scope, and why

- **The ERC-8004 Identity Registry** at `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`. It is an
  upgradeable proxy owned by a third party, on all four chains. Its behaviour can change without our
  involvement. See the question about it below, which is in scope — the registry itself is not.
- **The 0G Compute router.** Inference runs through it and we print the attestation label it
  reports, attributed to it, because we do not fetch or verify the raw quote. That is a disclosure,
  not an integration to review.
- **Public RPC endpoints.** Theirs, and they change their limits without notice. Three such changes
  were measured in one day.
- **The four v1-generation contracts** — `AdextoTrinityFactory.sol`, `SovereignHook.sol`,
  `AdextoCCIPReceiver.sol`, `AdextoCCIPTreasuryRouter.sol`. They are superseded and off the launch
  path. One real finding is already admitted about them, below.

## What has already been found

Do not spend time re-deriving these. All are published with reasoning at `/security`.

**Admitted, real, unfixable by design:** native sent to the four v1-generation bridge receivers is
locked permanently. They have no withdraw, sweep or transfer. Repairing them would mean adding the
withdrawal path this protocol's central guarantee says does not exist, which is why the cross-chain
path was dropped rather than patched. All four are off the launch path.

**Triaged with reasons**, on the launch path:

| Finding | Why it is not exploitable |
| --- | --- |
| `divide-before-multiply` in `getSellQuote` | Fees are a percentage *of* `grossOut`, so `grossOut` must exist first; it cannot be reordered without changing what the fee means. Truncation floors, so the remainder stays with the curve, and two fuzz properties fail if that direction ever inverts |
| `incorrect-equality` in `deployTrinity` | The strict comparison is `require(balanceOf(address(this)) == 0)`. Exactness is the point: it is the proof the creator holds no allocation. Relaxing it to `<=` permits leftover supply in the factory |
| `reentrancy-no-eth`, 22 instances | Every flagged function carries `nonReentrant`, and the only external callee on those paths is `AdextoToken`, whose `_update` calls nothing but `super._update` — no hooks, no callbacks |
| ETH transferred without address checks | Destinations are `immutable` and validated at construction: `AdextoCurve.sol` lines 313 and 319 |
| `nonReentrant` is not the first modifier | Order is `onlyFactory nonReentrant`; `onlyFactory` only compares `msg.sender` and makes no external call |

Counts as reported, scanned at commit `c14c6244`: Slither 77 findings, 0 High on the launch path.
Aderyn 4 High kinds across 39 instances, 27 of them on the launch path, 22 of which are the single
reentrancy pattern above.

## Properties already proven, and how

Stating these so a reviewer can attack the *assumptions* rather than re-run the same checks.
Foundry fuzz at 4,096 runs each, invariants at 512 runs × 64 random actions, Echidna at 50,000
calls.

Invariants:

```
invariant_curveAlwaysSolvent            invariant_curveAlwaysSolventWithProtocolLeg
invariant_supplyNeverGrows              invariant_floorNeverFalls
invariant_tokensSoldWithinCurve         invariant_creatorHoldsNoTokens
invariant_protocolFeesConserved         invariant_totalProtocolPaidNeverFalls
invariant_treasuryBalanceMatchesPaid    invariant_inventoryMatchesBalance
```

Echidna, independently: `echidna_solvent`, `echidna_tokensSoldWithinCurve`,
`echidna_supplyNeverGrows`, `echidna_inventoryMatchesBalance`.

Fuzz properties worth knowing about because they encode economic claims:
`testFuzz_roundTripNeverProfitable`, `testFuzz_buyRoundsInFavourOfCurve`,
`testFuzz_fourLegsNeverExceedInput`, `testFuzz_protocolFeeIsAdditiveNotCarvedOut`,
`testFuzz_creatorFeesOnlyReachCreator`, `testFuzz_protocolFeesOnlyReachTreasury`,
`testFuzz_cannotSellMoreThanOutstanding`, `testFuzz_buybackCappedAtOnePercent`.

There is also `test_handlerCanActuallyPerformEveryAction`, which exists because an invariant suite
whose handler silently fails every action passes while testing nothing.

## What we most want reviewed

Ranked by what we cannot settle ourselves. Fuzzing found no counterexample, which is not the same
as there being none.

1. **Rounding direction across every reachable state.** The claim is that truncation always favours
   the curve, never the trader, in buys, sells, and buybacks. Fuzzing supports it; it is not a proof.
2. **Whether `_assertSolvent` checks the right quantity.** It runs after every mutation. If the
   predicate itself is incomplete, ten invariants built on the same idea all pass together.
3. **The anti-sniper window and its exemption.** `AdextoToken._update` applies
   `require(value <= maxTxAmount)` only while `block.number <= launchBlock + ANTI_SNIPE_BLOCKS`,
   where `ANTI_SNIPE_BLOCKS` is a `constant` equal to `5`. After that `_update` adds no condition at
   all. Two things we want assessed rather than the cap's arithmetic. `maxTxAmount` is derived from a
   **configurable** bps at construction — `(initialSupply * 10 ** decimals() * _maxTxPercentBps) / 10000`
   — not a hard 1%, so a launch can choose a window that constrains nothing. And **`_launcher` is
   exempt on both sides of a transfer**, which is required because the launch moves the entire supply
   into the curve in that same transaction; we want the consequences of that exemption examined,
   since it is an address for which the cap does not exist.
4. **`receive()` routing into `_buy`.** A plain native transfer with empty calldata executes a market
   buy. Verified working on mainnet. We want the paths into it that we have not thought of.
5. **Four fee legs with the protocol leg additive rather than carved out.** The ceiling is
   `swapFeeBps + PROTOCOL_FEE_BPS <= 500`, checked in two places. We want an edge case where the
   legs exceed the input.
6. **The ERC-8004 call.** The factory calls `ownerOf(agentId)` on a third-party upgradeable proxy
   during `deployTrinity`. If that proxy becomes hostile, what is the worst it can do to a launch —
   revert only, or more?
7. **`executeBuyback` having no caller gate.** Bounded to 1% of reserve per call and it burns what
   it buys. We want it assessed as a permissionless primitive, including repeated calls.
8. **The x402 delivery path.** The relayer is a customer of the curve, holding no privileged
   position, and delivery runs before the charge so a failed fill costs us. We want the griefing
   economics of that ordering.

## Reproducing everything here

```bash
node scripts/compile-contracts.mjs --via-ir     # -> build/artifacts/
~/.foundry/bin/forge test                        # fuzz + invariants
node scripts/security-scan.mjs                   # all eight engines -> src/config/security-report.json
node scripts/test-erc8004-binding.mjs            # 24 assertions, local devchain
```

`scripts/security-scan.mjs` resolves `forge` from `~/.foundry/bin`, `solhint` from
`node_modules/.bin` and Echidna from the `ghcr.io/crytic/echidna` image. Checking for those with
`command -v` reports them missing, because a non-login shell does not load the user profile.

## Reporting

Through [private vulnerability reporting](https://github.com/0xcuy/adexto/security/advisories/new).
Terms, response commitments and the absence of a bounty programme are in
[`SECURITY.md`](../SECURITY.md).
