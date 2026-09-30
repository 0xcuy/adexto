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

Three factory generations are on chain at once, and every market keeps the one it was born with.
`AdextoFactory` `0.12.0` is the generation the site has launched with since 2026-09-29, on all four
mainnets. `AdextoFactory` `0.11.0` is still deployed beside it and **seven launches reference its
bytecode**: the six listed markets and one delisted test market. The `0.10.0` `AdextoCurveFactory`
and its curves are still deployed and still reachable too. Every fee rate in a curve is
`immutable`, there is no proxy, no upgrade path and no admin. So a fix to the source cannot reach a
market that already exists — it can only produce a new factory generation, and the existing
markets keep the code they were born with permanently.

That is not a hypothetical. It has already happened twice. Markets created by the superseded
`0.10.0` factory pay no protocol fee and never will, because their rates are immutable. And the
`0.11.0` curves, which include every listed market, will never get the one-hour buyback cooldown
that `0.12.0` added: on chain, `BUYBACK_COOLDOWN()` reverts on a `0.11.0` curve and returns 3600
on a `0.12.0` one.

Measured when this document was first written, so the size of the constraint is clear rather than
asserted: adding **one comment line** to `AdextoFactory.sol` changed the runtime bytecode keccak from
`0x34b45bafad29b726d176bc2e15672a64be9ac16deeec85b501417fe60cb4fd66` to
`0x7dd9e6d7f73631e01dd42c29ce33a9655fc5cd579bda55942750014de8e9d3ea`. Length stayed 21,281 bytes in
both cases, so **length is not evidence of sameness**. There is no `metadata: { bytecodeHash: "none" }`
in the compile settings, and the metadata carries a hash of the source.

The practical consequence for a review: findings that require a code change are still worth
reporting, and we want them. But they land as "the next generation must fix this", and a finding
that can be mitigated operationally on live markets is worth flagging as such, because that is the
only kind that can help the markets that exist today.

## In scope

The scope is the code behind the current generation, `0.12.0`, which runs byte-identical on all four
mainnets, plus `AdextoAgentStake`. A finding there can still become a fix, in the next generation.
The `0.10.0` files are still in `contracts/` but are
[not in scope](#in-the-repo-but-not-in-scope). Contracts that were off the launch path altogether
have been removed from the tree; see [what was removed](#what-was-removed-from-the-repo).

SLOC excludes blank lines and comment-only lines. Measured on 2026-09-30 with
`grep -vcE '^[[:space:]]*(//|\*|/\*|\*/)|^[[:space:]]*$'`, so a line of code carrying a trailing
comment counts as code.

| File | Role | Lines | SLOC |
| --- | --- | --- | --- |
| `contracts/AdextoCurve.sol` | curve deployed per launch by `0.12.0` | 866 | 366 |
| `contracts/AdextoFactory.sol` | current factory, `0.12.0`, live on four mainnets | 503 | 203 |
| `contracts/AdextoAgentStake.sol` | holds staked $ADEXTO; gates compute quota | 179 | 66 |
| `contracts/AdextoToken.sol` | plain ERC-20 minted per launch | 175 | 54 |
| `contracts/IIdentityRegistry.sol` | interface for the ERC-8004 ownership check | 45 | 5 |
| **Total** | | **1,768** | **694** |

The first version of this table covered all eight files in `contracts/`, 2,753 lines and 1,207
SLOC, with `AdextoFactory.sol` at 431 and 197. That count was taken while the `0.12.0` changes in
items 5 and 6 below were still being written, and it matches no committed version of the file; the
committed file is the one above. The scope was narrowed to `0.12.0` on 2026-09-30, for the reason
given under [in the repo but not in scope](#in-the-repo-but-not-in-scope).

**If you price on raw lines rather than SLOC, say so before quoting.** The ratio here is unusual:
1,768 lines against 694 SLOC. 930 of the lines (53%) are comments explaining why the code is shaped
the way it is, and 144 are blank. That is deliberate and we are not asking you to review the prose,
but it will more than double a line-based estimate.

Excluded from the figures above, and from any quote, because they are test fixtures that never
reach a chain: `contracts/echidna/EchidnaAdextoCurve.sol` (84), `contracts/echidna/EchidnaCurve.sol`
(74), `contracts/test/MockEIP3009Token.sol` (70), `contracts/test/MockIdentityRegistry.sol` (27), all
in SLOC. They stay in the repo because the suites need
them — `MockIdentityRegistry` in particular has its runtime code injected at the ERC-8004 constant
address, which is the only way the agent-binding path is reachable off mainnet.

`AdextoAgentStake` is in scope because it holds other people's tokens. Read on 0G on 2026-09-30:
`minStake` 5,000 ADEXTO, `totalStaked` 10,000 ADEXTO across 1 staker, and `accounting()` returning
held 10,000 / accounted 10,000 / surplus 0. It is the one contract here whose failure mode
is a direct loss of principal rather than a mispriced trade.

Also in scope, because they can move money: the x402 edge worker in `cloudflare-worker/`, the API
routes under `src/app/api/`, and the MCP server at `/api/mcp` including `pay_and_buy`.

### In the repo but not in scope

| File | Role | Lines | SLOC |
| --- | --- | --- | --- |
| `contracts/SovereignCurve.sol` | curve of the `0.10.0` generation | 631 | 324 |
| `contracts/AdextoCurveFactory.sol` | superseded factory, `0.10.0`, still deployed and permissionless | 390 | 184 |
| `contracts/ISovereignLegacy.sol` | interface `SovereignCurve` imports | 36 | 11 |
| **Total** | | **1,057** | **519** |

The `0.10.0` generation is still deployed and still reachable by anyone — superseding a factory in
our UI does not remove it from a chain — but a finding in it cannot be fixed: its bytecode is
frozen, and none of the listed markets run it. These files are also not byte-for-byte the deployed
`0.10.0` code, because they carry fixes made after that deployment. They stay in the repo because
the test suites use them: the carve-out property compares a `0.12.0` curve against a `0.10.0` one,
and one of the two Echidna harnesses runs against `SovereignCurve`. If a finding in `0.12.0` also applies to
`0.10.0`, we will say so, and the only remedy there is operational.

### Deployed addresses

`AdextoFactory` `0.12.0`, the generation the site launches with. Runtime bytecode byte-identical
across all four, 21,403 bytes, keccak
`0xc0841d5a2193f21df6b7f685bbe39fd5ee6411cbf89bf76e1b99d867174d8f0f`, `VERSION` `0.12.0`, confirmed
by `eth_getCode` against each chain on 2026-09-30:

| Chain | Address |
| --- | --- |
| 0G Mainnet · 16661 | `0x06C80fD2d5d9365C20aC468c15874DBE748877e2` |
| Base · 8453 | `0xe5B9555fbbcE72A5739dD29c3939A23fd230136F` |
| Arbitrum One · 42161 | `0x75EeDEd196D2BE283d815D52F617eB70bCe865bC` |
| Monad · 143 | `0xcA9c77f050CD1e0685b03D0236579966DA9B39B9` |

One market exists on it so far, `$VOLT` on Monad, opened directly against the factory to prove the
published curve ABI and deliberately not listed.

`AdextoFactory` `0.11.0`, superseded for new launches and still holding its seven. Also
byte-identical across all four, 21,281 bytes, keccak
`0xcbb89e32ae973400723287f16f32e87f039efcef1c1f814c5805bd1a6fe3add8`, `VERSION` `0.11.0`, confirmed
the same way:

| Chain | Address |
| --- | --- |
| 0G Mainnet · 16661 | `0x51c4168226463F7e5A141e1c6D30520734BC840a` |
| Base · 8453 | `0x216E7880D64D94335B583c539802d3e61958d4A2` |
| Arbitrum One · 42161 | `0xE17f1027FC5f294327D701829baeD9d6519e922C` |
| Monad · 143 | `0x5800e9715a47a598fce9bc3B65a95FD6BeBf76A3` |

The compiled artefact hashes differently from all eight, and that is expected rather than a
discrepancy: immutables live inside runtime bytecode and are still zero in the artefact. Compare
on-chain code against on-chain code, or blank the immutable slots first, which is what the verify
checklist at [adexto.xyz/security](https://adexto.xyz/security) does for `0.12.0`.

`AdextoAgentStake`, 0G Mainnet only, `0x5b44AEA7AC49C7a6DA8f700D991852A2970b9231`, 2,424 bytes of
runtime code, deployed in block 45225259. Constructor arguments are readable on chain:
`stakeToken` `0xA1358C17004469C7CA5365AbafD294F9b2c11DF7` ($ADEXTO) and `minStake` 5,000e18.

Full address tables including superseded generations are in the
[README](../README.md#-mainnet-deployments).

### Which source matches which bytecode

`AdextoFactory.sol` and `AdextoCurve.sol` both declare `VERSION = "0.12.0"`, and so do the four
`0.12.0` factories above. The eight contract files in `contracts/` are unchanged since commit
[`1f1cbfc5ce97b417aa926e122e564738d4389e55`](https://github.com/0xcuy/adexto/commit/1f1cbfc5ce97b417aa926e122e564738d4389e55);
the only addition since is a test harness under `contracts/echidna/`.
Compiled from that commit with `node scripts/compile-contracts.mjs --via-ir`, the factory's runtime
matches the code on all four chains apart from two 20-byte slots, both holding the immutable
`protocolTreasury`; with those zeroed, chain code and artefact both hash to
`0x83adf2725ca03af986bf18a15a4b675eeba4e288b0515bbd370342d1de3dac3f`. The factory's runtime carries
the creation code of the curve and the token it deploys, so that one comparison covers all three
files. **What you review is the code behind the `0.12.0` addresses.**

A shallow clone does not contain that commit, so `git checkout 1f1cbfc` finds nothing there. Fetch
it by its full hash:

```bash
git fetch --depth 1 origin 1f1cbfc5ce97b417aa926e122e564738d4389e55
git checkout FETCH_HEAD
```

The code in `contracts/` is not byte-for-byte the code behind the older generations, and that
changes what a finding means:

- The `0.11.0` bytecode, which every listed market runs, was compiled from an earlier revision.
  Three differences are known and matter here: the protocol leg was added on top of the fee
  instead of carved out of it (item 5), tickers were not reserved at construction (item 6), and
  the curves have no buyback cooldown (item 8).
- The `0.10.0` files carry fixes made after that generation was deployed, the same cooldown among
  them, and the deployed `0.10.0` code cannot get them. They are out of scope for that reason.

So a finding in `contracts/` applies to `0.12.0` markets. Whether it also applies to the older ones
depends on whether the relevant lines changed between the generations, and we will answer that per
finding rather than in advance. The frozen-bytecode constraint at the top of this document applies
either way.

## Out of scope, and why

- **The ERC-8004 Identity Registry** at `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`. It is an
  upgradeable proxy owned by a third party, on all four chains. Its behaviour can change without our
  involvement. See the question about it below, which is in scope — the registry itself is not.
- **The 0G Compute router.** Inference runs through it and we print the attestation label it
  reports, attributed to it, because we do not fetch or verify the raw quote. That is a disclosure,
  not an integration to review.
- **Public RPC endpoints.** Theirs, and they change their limits without notice. Three such changes
  were measured in one day.
- **The `0.10.0` generation.** Still in the repo, for the test suites; see
  [in the repo but not in scope](#in-the-repo-but-not-in-scope).
- **The `0.11.0` bytecode** behind every listed market. It was compiled from an earlier revision
  that is not in this tree. Where its logic is shared with `0.12.0`, a finding in scope tells us
  about it too, and the remedy there is operational.
- **The v1-generation contracts.** Removed from the repo entirely; see the next section.

## What was removed from the repo

Five contracts were deleted so that `contracts/` contains only what is live and reachable. They are
named here rather than quietly dropped, because four of the five are still deployed and the site
still lists their addresses.

| Contract | SLOC | Deployed | Why it is not reviewable work |
| --- | --- | --- | --- |
| `SovereignHook.sol` | 271 | 4 mainnets, 1,495 bytes | v1 venue. Cannot settle a trade: no `receive()`, no `buy`/`sell` in the deployed bytecode, and a native transfer reverts on all four chains |
| `AdextoGovernor.sol` | 92 | 4 mainnets, 4,133 bytes | Deployed but inert. No Governor ABI exists anywhere in `src/`; no `propose`, `castVote` or `execute` is ever built |
| `AdextoCCIPTreasuryRouter.sol` | 72 | never, on any chain | No address in any config, env or deployment record |
| `AdextoTrinityFactory.sol` | 63 | 4 mainnets, 7,216 bytes | v1 factory, superseded by `AdextoFactory`. No ABI, no transaction is built against it |
| `AdextoCCIPReceiver.sol` | 53 | 4 mainnets, 1,318 bytes | Deployed but unreferenced. The address appears in config and nowhere else |
| **Total** | **551** | | ~31% of the previous `contracts/` SLOC |

Checked before deleting, because "unused" is a claim about the present and balances are not:
**`eth_getBalance` returns 0 for all four deployed contracts on all four chains**, 16 reads. Nothing
is stranded in them right now.

The Chainlink lane was not abandoned by preference. Chainlink publishes no CCIP router for 0G or
Monad, so two of the four chains could never be reached, and a bridge that works on half a
deployment is not a bridge.

The source remains readable at commit
[`fa4200b`](https://github.com/0xcuy/adexto/tree/fa4200b5c93b94df6f40a9234bdd802eb307a738/contracts)
for anyone verifying the deployed bytecode at those addresses. Deleting a file does not remove it
from history, and the addresses stay in the contract registry on the site, labelled superseded,
because the contracts do exist — removing them from the page would be the dishonest half of this
change.

## What has already been found

Do not spend time re-deriving these. The published scan and its triage are at `/security`.

**Admitted, real, unfixable by design:** native sent to the four v1-generation bridge receivers
would be locked permanently — they hold nothing today, but the hazard is live because the addresses
are on chain and anyone can send to them. They have no withdraw, sweep or transfer. Repairing them
would mean adding the withdrawal path this protocol's central guarantee says does not exist, which is why the cross-chain
path was dropped rather than patched. All four are off the launch path.

**Triaged with reasons**, on the launch path:

| Finding | Why it is not exploitable |
| --- | --- |
| `divide-before-multiply` in `getSellQuote` | Fees are a percentage *of* `grossOut`, so `grossOut` must exist first; it cannot be reordered without changing what the fee means. Truncation floors, so the remainder stays with the curve, and `testFuzz_roundTripNeverProfitable` fails on either curve if that direction ever inverts. `testFuzz_buyRoundsInFavourOfCurve` checks the same on the `0.10.0` curve only |
| `incorrect-equality` in `deployTrinity` | The strict comparison is `require(balanceOf(address(this)) == 0)`. Exactness is the point: it is the proof the creator holds no allocation. Relaxing it to `<=` permits leftover supply in the factory |
| Reentrancy in the curves: Slither `reentrancy-no-eth` (4, `sell` and `receive` on both curves) and Aderyn "state change after external call" (6, inside `sell` on both curves) | `sell` carries `nonReentrant`, and `receive` takes the same `_locked` guard inline. The only external callee on those paths is `AdextoToken`, whose `_update` calls nothing but `super._update` — no hooks, no callbacks |
| ETH transferred without address checks | Destinations are `immutable` and validated at construction: `AdextoCurve.sol` lines 343 and 349 |
| `nonReentrant` is not the first modifier | Order is `onlyFactory nonReentrant`; `onlyFactory` only compares `msg.sender` and makes no external call |
| Aderyn "state change after external call" in `deployTrinity` (2, one per factory) | The external call is `ownerOf` on the ERC-8004 registry, which `IIdentityRegistry` declares `view`, so it compiles to `STATICCALL`: any state change, event or value transfer inside it reverts, and it cannot re-enter `deployTrinity`. What a hostile registry can still do — revert, burn the gas, or report the wrong owner — is item 7 below |

Counts as published at `/security`, from the scan of 2026-09-30 on a clean checkout of commit
`946c2fa`, whose eight contract files are identical to `1f1cbfc`. Slither: 67 findings, none High,
30 of them on the launch path (13 Medium, 11 Low, 6 Informational), 34 in the two Echidna harnesses
and 3 in `AdextoAgentStake`. Aderyn, which skips the harnesses: 1 High kind across the 8 instances
above, all on the launch path, and 5 Low kinds across 30 instances.

## Properties already proven, and how

Stating these so a reviewer can attack the *assumptions* rather than re-run the same checks.
Foundry fuzz at 4,096 runs each, invariants at 512 runs × 64 random actions, Echidna at 50,000
calls per harness.

Not every property runs against the code in scope, so each list says which curve it drives.

Invariants against the `0.12.0` curve, `AdextoCurve`:

```
invariant_curveAlwaysSolventWithProtocolLeg    invariant_supplyNeverGrows
invariant_floorNeverFalls                      invariant_tokensSoldWithinCurve
invariant_creatorHoldsNoTokens                 invariant_inventoryMatchesBalance
invariant_protocolFeesConserved                invariant_totalProtocolPaidNeverFalls
invariant_treasuryBalanceMatchesPaid
```

The `0.10.0` curve has its own suite with `invariant_curveAlwaysSolvent` and five of the names above.

Echidna, independently, with one harness per curve generation. `EchidnaAdextoCurve` launches through
the `0.12.0` factory with the production fee split and checks five properties: `echidna_solvent`
(with `protocolOwed` as a term), `echidna_tokensSoldWithinCurve`, `echidna_supplyNeverGrows`,
`echidna_inventoryMatchesBalance` and `echidna_treasuryBalanceMatchesPaid`. Echidna advances time
between calls, so unlike the Foundry handler it also reaches buybacks after the cooldown.
`EchidnaCurve` checks the first four on the `0.10.0` curve. Last run: 9 of 9 passing, 100,219 calls.

Fuzz properties worth knowing about because they encode economic claims, all against the `0.12.0`
curve: `testFuzz_roundTripNeverProfitable`, `testFuzz_buyRoundsInFavourOfCurve` (against the exact
rational value, by cross-multiplication), `testFuzz_fourLegsNeverExceedInput`,
`testFuzz_protocolFeeIsCarvedOutNotAdditive` (named `testFuzz_protocolFeeIsAdditiveNotCarvedOut`
until 0.12.0 inverted it), `testFuzz_creatorFeesOnlyReachCreator`,
`testFuzz_protocolFeesOnlyReachTreasury`, `testFuzz_cannotSellMoreThanOutstanding` and
`testFuzz_buybackCappedAtOnePercent`. Four of those were ported from the `0.10.0` suite on
2026-09-30, which keeps its own copies. The buyback cooldown has its own `0.12.0` suite, including
`test_buybackCannotBeLoopedInOneTransaction` and `test_treasuryCannotBeDrainedInOneBlock`.

There is also `test_handlerCanActuallyPerformEveryAction`, in both invariant suites, which exists
because an invariant suite whose handler silently fails every action passes while testing nothing.

## What we most want reviewed

Ranked by what we cannot settle ourselves. Fuzzing found no counterexample, which is not the same
as there being none.

1. **Rounding direction across every reachable state.** The claim is that truncation always favours
   the curve, never the trader, in buys, sells, and buybacks. Fuzzing supports it; it is not a proof.
2. **Whether `_assertSolvent` checks the right quantity.** It runs after every mutation. If the
   predicate itself is incomplete, every invariant above is built on the same idea and they all pass
   together.
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
5. **Four fee legs, with the protocol leg carved out of the total rather than added to it.** This
   reversed in 0.12.0 and it is the single largest behavioural difference between the two live
   `AdextoFactory` generations, so it is worth stating precisely.

   The launch model is 100 bps split creator 70 / depth 10 / buyback 10 / protocol 10, and
   `swapFeeBps` is now the whole fee a trader pays. `depthFeeBps` is the remainder after the three
   named legs, so the four sum to exactly `swapFeeBps`. The ceiling is `swapFeeBps <= 500` — the
   protocol leg is inside it, where in 0.11.0 the check was `swapFeeBps + PROTOCOL_FEE_BPS <= 500`.

   Two things we want attacked. First, an edge case where the legs exceed the input. Second, the
   underflow guard: `depthFeeBps` is computed by subtraction, and the only thing preventing it from
   underflowing is `require(creatorShareBps + treasuryShareBps + PROTOCOL_FEE_BPS <= swapFeeBps)`.
   We believe that require is exactly sufficient and that depth reaching zero is legitimate rather
   than a failure, but a zero-depth market has a floor that never rises, which is a weakening of the
   property the curve's solvency argument leans on.

   Note also that the truncation now happens across four legs instead of three, each rounding down
   independently. `testFuzz_protocolFeeIsCarvedOutNotAdditive` proves the total differs from a
   same-total 0.10.0 curve by at most 1 wei and always in the trader's favour. We would like that
   bound checked rather than trusted.
6. **Ticker reservation in the constructor.** `symbolRegistry` is per-factory state, not a global
    list, so a new factory generation is born with an empty book and every name used by an earlier
    generation becomes claimable again. Measured against the four live `0.11.0` factories before this
    was added: `ETH`, `USDC` and `BTC` were free on all four chains, and `ADEXTO` was free on Base,
    Arbitrum and Monad. The off-chain reserved list does not close that, and cannot —
    `deployTrinity` has no access control at all, so it only gates registration on the site while the
    market is still born on chain.

    `0.12.0` therefore seeds 16 tickers into `symbolRegistry` in the constructor, writing the
    sentinel `SYMBOL_RESERVED = address(1)` so the existing
    `require(symbolRegistry[key] == address(0))` rejects them. There is no `reserve()` function and
    no address that can extend the list afterwards, which is deliberate: such a function would need a
    privileged caller who could then reserve somebody else's name. There is still no way to release
    anything.

    What we want assessed: whether a non-zero sentinel in a mapping typed as token addresses can be
    misread anywhere we have not thought of, and whether reserving at construction is genuinely
    preferable to a shared registry contract consulted by every generation. We chose the constructor
    because it needs no trusted party; a shared registry would be one more contract that all future
    factories depend on.
7. **The ERC-8004 call.** The factory calls `ownerOf(agentId)` on a third-party upgradeable proxy
   during `deployTrinity`. If that proxy becomes hostile, what is the worst it can do to a launch —
   revert only, or more?
8. **`executeBuyback` having no caller gate.** Bounded to 1% of reserve per call, and it burns what
   it buys. A report showed that the per-call cap alone let one transaction loop until the buyback
   bucket was empty, so the `0.12.0` curve also enforces `BUYBACK_COOLDOWN`, one call per hour. The
   deployed `0.10.0` and `0.11.0` curves have the per-call cap only. We want it assessed as a
   permissionless primitive, including repeated calls: with the cooldown for `0.12.0`, and without
   it for what the older curves, every listed market among them, can still be made to do.
9. **The x402 delivery path.** The relayer is a customer of the curve, holding no privileged
   position, and delivery runs before the charge so a failed fill costs us. We want the griefing
   economics of that ordering.
10. **`AdextoAgentStake` accounting under a hostile token.** The contract is small and has no owner,
   no pause and no path that moves another address's stake, so the interesting question is not access
   control. It is that `stakeToken` is fixed at construction and the contract checks the boolean
   return of `transfer`/`transferFrom` but performs no balance-delta check. Bound to `AdextoToken`
   that is sound, because `_update` calls nothing but `super._update`. We want the consequences
   assessed for a deployment bound to a fee-on-transfer or rebasing token, where `totalStaked` would
   drift from the balance actually held, and whether `accounting()` surfacing the surplus is
   sufficient disclosure of that.

## Reproducing everything here

```bash
node scripts/compile-contracts.mjs --via-ir     # -> build/artifacts/
~/.foundry/bin/forge test                        # fuzz + invariants
node scripts/security-scan.mjs                   # all eight engines -> src/config/security-report.json
node scripts/test-erc8004-binding.mjs            # 24 assertions, local devchain
```

Expected, so a different result is recognisable as a difference rather than assumed to be normal:
`compile-contracts.mjs` reports 10 sources and writes 38 artefacts, and `forge test` reports
**55 tests passed, 0 failed** across 6 suites (run on 2026-09-30). In both invariant runs `buyback`
reverts on most calls: 5,526 of 6,575 for `AdextoCurve` and 7,232 of 8,239 for `SovereignCurve` in
the last run. That is `BUYBACK_COOLDOWN` doing its job, not a broken handler. The handler already
bounds every amount to the 1% cap and never advances time, so after the first buyback in a run
every later one lands inside the cooldown. `test_handlerCanActuallyPerformEveryAction` exists to
prove the other actions are not silently failing the same way.

`scripts/security-scan.mjs` resolves `forge` from `~/.foundry/bin`, `solhint` from
`node_modules/.bin` and Echidna from the `ghcr.io/crytic/echidna` image. Checking for those with
`command -v` reports them missing, because a non-login shell does not load the user profile.

## Reporting

Through [private vulnerability reporting](https://github.com/0xcuy/adexto/security/advisories/new).
Terms, response commitments and the absence of a bounty programme are in
[`SECURITY.md`](../SECURITY.md).
