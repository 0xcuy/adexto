# Audit scope

For a reviewer quoting on, or carrying out, a third-party review of the ADEXTO v1 contracts.

There has been no human review. Several analysers and fuzzers run against these contracts, and their
output is published with every finding triaged at [adexto.xyz/security](https://adexto.xyz/security).
That is a different thing and is not offered as a substitute. This document exists so a reviewer
starts from what is already known rather than rediscovering it, and so the parts we cannot judge
ourselves are named rather than left for them to guess at.

## Read this first: deployed bytecode is permanent

ADEXTO v1 has no owner, no proxy, no upgrade path and no admin. Every fee rate in a curve is
`immutable`. Once v1 is deployed, nobody can change it, including us. A fix to the source therefore
cannot reach a market that already exists: it can only become a new version at a new factory
address, while every v1 market keeps the code it was born with.

The practical consequence for a review: findings that need a code change are still worth reporting,
and we want them, but they land as "the next version must fix this". A finding that can be mitigated
operationally on live markets is worth flagging as such, because that is the only kind that helps
the markets that exist.

Length is not evidence that two bytecodes are the same. The compiler embeds a hash of the source,
comments included, so one changed comment line changes the runtime keccak while the length stays
identical. Compare hashes, never sizes.

## In scope

The ADEXTO v1 contracts, compiled with solc 0.8.37, via-IR, optimizer 200 runs, EVM version
`cancun`, by `node scripts/compile-contracts.mjs --via-ir`. SLOC excludes blank lines and
comment-only lines, measured with `grep -vcE '^[[:space:]]*(//|\*|/\*|\*/)|^[[:space:]]*$'`, so a
line of code with a trailing comment counts as code.

| File | Role | Lines | SLOC |
| --- | --- | --- | --- |
| `contracts/AdextoCurve.sol` | bonding curve deployed per launch | 653 | 366 |
| `contracts/AdextoFactory.sol` | factory: token + curve in one transaction, ticker book, agent check | 388 | 203 |
| `contracts/AdextoAgentStake.sol` | holds one token's stake ($ADEXTO on 0G, `$SAI` on three chains); gates compute quota | 179 | 66 |
| `contracts/AdextoStakeHub.sol` | one per chain: holds the stakes of every other market, keyed by token | 257 | 124 |
| `contracts/AdextoToken.sol` | fixed-supply ERC-20 per launch, with the launch window | 161 | 61 |
| `contracts/IIdentityRegistry.sol` | interface for the ERC-8004 ownership check | 45 | 5 |
| **Total** | | **1,683** | **825** |

**If you price on raw lines rather than SLOC, say so before quoting.** 666 of the 1,683 lines are
comments explaining why the code is shaped the way it is, and 192 are blank. That is deliberate and
we are not asking you to review the prose, but it roughly doubles a line-based estimate.

Excluded from the figures above, and from any quote, because they never reach a chain:
`contracts/echidna/EchidnaAdextoCurve.sol` (88 SLOC), `contracts/test/MockEIP3009Token.sol` (70) and
`contracts/test/MockIdentityRegistry.sol` (27). The mock registry has its runtime code injected at
the ERC-8004 constant address on a local devchain, which is the only way the agent-binding path is
reachable off mainnet.

`AdextoAgentStake` and `AdextoStakeHub` are in scope because they hold other people's tokens. They
are the two contracts here whose failure mode is a direct loss of principal rather than a mispriced
trade, and the hub holds every market's stakes on its chain in one contract, so a flaw in it is
shared by all of them. Neither is on the launch path: a launch never calls them.

Also in scope, because they can move money: the x402 edge worker in `cloudflare-worker/`, the API
routes under `src/app/api/`, and the MCP server at `/api/mcp` including `pay_and_buy`.

### Deployed addresses

`AdextoFactory` `1.0.0`, broadcast on 2026-10-01 from commit
[`71b5adf`](https://github.com/0xcuy/adexto/commit/71b5adfe774ed7a93f9fe589b4430c8122febb1f) by
`scripts/deploy-factory.mjs`. Each factory creates its markets' `AdextoToken` and `AdextoCurve`
with `new`, so the creation code of both is part of the factory's runtime and every market it will
ever create runs that code.

| Chain | Chain ID | Factory | Block | Creation transaction | Reserved tickers |
| --- | --- | --- | --- | --- | --- |
| 0G | 16661 | `0xEBbE0fB112859b57A0ad1afbeD4978e43dC96c5D` | 45793987 | `0xb9b2f592784abd532021c9a09d810a784782741dd6d2575fef31015541337bd7` | 16 |
| Base | 8453 | `0xF5f904ca7763Fc6755bbCe5466a9DBd4C15c2708` | 52008858 | `0xd30f5c751e10101a8efc4e7a914fd4610fdcc477372f1e177486d296a33005c0` | 16 |
| Arbitrum One | 42161 | `0x79DF3671e7e7456832C84a34c2bC0DB7871C0E0E` | 510474755 | `0xf78fb444c72d5f2a150392a4ea4991e0caf0a11c060107d0a9f2d46f7b72ddf9` | 16 |
| Monad | 143 | `0x3dFcBEd7dd889F465cC9f75c430B43Ef873b6056` | 109440540 | `0x3c7f6259a4b47ffe03489e4fcf976e38e4930907758f2bc8fca649941462cc67` | 16 |
| Robinhood Chain | 4663 | `0x8e63e117E71A80Cfc10fDF375F079e2e29cd7D7D` | 76864198 | `0x2a8f8a0c8ef6ff11ec907e13979788c927bd810b8efb8d250895be54705334c9` | 212 |

The runtime bytecode is byte-identical on all five chains: 21,806 bytes, keccak
`0x1ca02ca53a3b2a2082f9e5dab6924e1339110e3037608f750981699678881fd4`. Its only immutable is the
protocol treasury `0x24268Fffc119ec5550F68e80D94476fD64daE967`, the same address everywhere; with
its two slots zeroed the code hashes to the artifact's
`0x0e70cb93fbb10b66109cc71d547329cb48b4c3953791c2c4609519ff92221d62`. Reserved tickers live in
storage, so Robinhood Chain's longer list (`scripts/reserved-symbols.json`) does not change the code.
Sourcify reports an exact match, creation and runtime, on all five.

`AdextoStakeHub` `1.0.0`, broadcast on 2026-10-01 from commit
[`f8328ab`](https://github.com/0xcuy/adexto/commit/f8328ab43375c8a785ccf86fb4dfe39c83c2986f) by
`scripts/deploy-stake-hub.mjs`. At that commit `contracts/` is the tree above plus
`AdextoStakeHub.sol`. A token is accepted when one of the hub's factories returns a non-zero
`curveOf(token)`; the tokens in the last column have their own `AdextoAgentStake` and are refused.

| Chain | Chain ID | Hub | Block | Creation transaction | Factories | Refused |
| --- | --- | --- | --- | --- | --- | --- |
| 0G | 16661 | `0x440B89416A3a907a7016F20A29DA18665269A52f` | 45891788 | `0xc063a01575ae753f746cca27a23a12ec76af26d95dc720fd5cef3ee830652550` | v1, `0.11.0` | $ADEXTO |
| Base | 8453 | `0x2ba1EcffCD624Dc18044531F3999F0445014240D` | 52052214 | `0xd081572c266bd73481b7998dc15c17ba29131596dd0def14af4d49085d936e25` | v1, `0.11.0` | none |
| Arbitrum One | 42161 | `0xdf8891bA9fd8e3DC2E7D0A0ccae279247cd2ddf3` | 510798163 | `0x447f42419e2e7cb81353fc6ad9e7791946c1151d49f7c55d935ee9d388ea741a` | v1, `0.11.0` | `$SAI` |
| Monad | 143 | `0xb89d17F7308Ac007b106EB400eB2A8CB51cf887A` | 109727181 | `0x4af6f26be4307364ec6e34fb2a8a9096e0e5abfcb7baaba962f1be2c7d43d66d` | v1, `0.11.0` | `$SAI` |
| Robinhood Chain | 4663 | `0x05EFA7F066FcbefbE650EDd58583C107831A600B` | 77733726 | `0x5470dcd6025c7b4a4989b37fc7c2cffcd07a9adb16043de971735c1c698647e9` | v1 | `$SAI` |

The hub's runtime is byte-identical on all five chains: 4,278 bytes, keccak
`0x88247303e4851282bbf22dd4f23e753b08a6862ea40f32d9c0464e92730b081a`. It has no immutables: both
lists are storage written once by the constructor, with no setter. Sourcify reports an exact match,
creation and runtime, on all five. The `0.12.0` factories below are deliberately not accepted.

Earlier pre-release versions remain deployed on chain. They are not in this repository and are not
in scope. The six markets listed on the site were created by the `0.11.0` factories, compiled from
commit `98ffb1c`. One generation is retired with no listed market, and is named here once so an
address found on an explorer can be placed:

| Retired, no listed markets | 0G | Base | Arbitrum One | Monad |
| --- | --- | --- | --- | --- |
| `AdextoFactory` `0.12.0` (source `1f1cbfc`) | `0x06C80fD2d5d9365C20aC468c15874DBE748877e2` | `0xe5B9555fbbcE72A5739dD29c3939A23fd230136F` | `0x75EeDEd196D2BE283d815D52F617eB70bCe865bC` | `0xcA9c77f050CD1e0685b03D0236579966DA9B39B9` |

## Out of scope, and why

- **The ERC-8004 Identity Registry** at `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`. It is an
  upgradeable proxy owned by a third party, and its behaviour can change without our involvement.
  The question about how it can affect a launch is in scope; the registry itself is not.
- **The 0G Compute router.** Inference runs through it and we print the attestation label it
  reports, attributed to it, because we do not fetch or verify the raw quote ourselves.
- **Public RPC endpoints.** Theirs, and their limits change without notice.

## What has already been found

Do not spend time re-deriving these. The published scan and its triage are at `/security`. Counts
below are from the scan of this tree (commit recorded in `src/config/security-report.json`).

**Slither**: 43 findings. 17 are on the launch path (7 Medium, 6 Low, 4 Informational, none High),
19 are in the Echidna harness, 3 in `AdextoAgentStake` (all Low) and 4 in `AdextoStakeHub` (1 High,
1 Medium, 2 Low). The launch-path and hub findings are triaged below.
**Aderyn** (harness excluded): 1 High kind in 5 instances (4 on the launch path, 1 in the hub), all
triaged below, and 7 Low kinds in 28 instances. Solhint: 0 errors. Semgrep (general ruleset): 0
findings.

| Finding | Why it is not exploitable |
| --- | --- |
| `divide-before-multiply` in `getSellQuote` | Fees are a percentage *of* `grossOut`, so `grossOut` must exist first; it cannot be reordered without changing what the fee means. Truncation floors, so the remainder stays with the curve, and `testFuzz_roundTripNeverProfitable` fails if that direction ever inverts |
| `incorrect-equality` in `deployTrinity` | The strict comparison is `require(balanceOf(address(this)) == 0)`. Exactness is the point: it is the proof the creator holds no allocation. Relaxing it to `<=` would permit leftover supply in the factory |
| Reentrancy in `sell`: Slither `reentrancy-no-eth` and Aderyn "state change after external call" (3 instances at `AdextoCurve.sol` lines 454, 458 and 467) | `sell` carries `nonReentrant`, and `receive` takes the same `_locked` guard inline. The only external callee on that path is `AdextoToken`, whose `_update` calls nothing external: it adds a balance comparison during the launch window and otherwise defers to `super._update` |
| Aderyn "state change after external call" in `deployTrinity` (`AdextoFactory.sol` line 251) | The call is `ownerOf` on the ERC-8004 registry, which `IIdentityRegistry` declares `view`, so it compiles to STATICCALL: any state change, event or value transfer inside it reverts, and it cannot re-enter `deployTrinity`. What a hostile registry can still do, revert or report the wrong owner, is question 7 below |
| `timestamp` in `AdextoToken._update` and the curve | The launch window (180 s) and the buyback cooldown (1 h) are measured in seconds on purpose. A block producer can shift `block.timestamp` by seconds, which moves the edge of a window by the same seconds and nothing more |
| `missing-zero-check` on `sell`'s recipient | `to == address(0)` is replaced by `msg.sender` on the line that sets `recipient`, so a zero recipient cannot be paid |
| `reentrancy-events` / `reentrancy-benign` in `_buy`, `sell` and `deployTrinity` | Events are emitted after the external calls to the token, which has no hooks and calls nothing back. The curve functions are `nonReentrant`; `deployTrinity` writes the ticker before the calls, so a re-entrant launch of the same ticker fails |
| `low-level-calls` in `sell`, `claimCreatorFees` and `claimProtocolFees` | The native payouts. Each checks the returned `success`. The two claim destinations are `immutable` and validated at construction, and are re-checked before the transfer |
| `missing-inheritance`: `AdextoToken` should inherit `IAdextoBurnable` | Informational. The curve declares that one-function interface locally so it names exactly what it calls |
| `reentrancy-balance` (Slither High) and Aderyn "state change after external call" in `AdextoStakeHub.stake` | The balance read before `transferFrom` and compared after it is the balance-delta check itself: a position is credited only with what arrived. `stake`, `unstake` and `unstakeAll` all take the same `nonReentrant` guard, which Slither does not model, and the call ahead of the state changes is `balanceOf`, declared `view`, so STATICCALL. The only accepted tokens are ADEXTO market tokens (v1 and `0.11.0`), whose `_update` calls nothing external. Positions are kept per token, so a token lying about its own balance could only misreport positions in itself |
| `incorrect-equality` in `AdextoStakeHub.stake` | The comparison is `balanceOf(hub) == before + amount`. Exactness is the point: a token that delivers a different amount, such as a fee-on-transfer token, is refused rather than credited. Both reads are inside one guarded call |
| `calls-loop` in `AdextoStakeHub._madeByAdexto` | At most four factories (`MAX_FACTORIES`), fixed in the constructor, each asked inside `try` so a reverting one counts as no. The factories have no owner and no upgrade path |

## Properties already proven, and how

Stated so a reviewer can attack the *assumptions* rather than re-run the same checks. Foundry fuzz
at 4,096 runs per property, invariants at 512 runs × 64 random actions, Echidna at 50,000 calls.

Invariants, stateful, against a market launched through the factory with the production fee split:

```
invariant_curveAlwaysSolventWithProtocolLeg    invariant_supplyNeverGrows
invariant_floorNeverFalls                      invariant_tokensSoldWithinCurve
invariant_creatorHoldsNoTokens                 invariant_inventoryMatchesBalance
invariant_protocolFeesConserved                invariant_totalProtocolPaidNeverFalls
invariant_treasuryBalanceMatchesPaid
```

Echidna, independently, with its own harness: `echidna_solvent` (with `protocolOwed` as a term),
`echidna_tokensSoldWithinCurve`, `echidna_supplyNeverGrows`, `echidna_inventoryMatchesBalance`,
`echidna_treasuryBalanceMatchesPaid` and `echidna_walletLimitDuringWindow`. Echidna advances time
between calls, so unlike the Foundry handler it also reaches buybacks after the cooldown. Last run:
6 of 6 passing over 50,093 calls.

Fuzz properties that encode economic claims: `testFuzz_roundTripNeverProfitable`,
`testFuzz_buyRoundsInFavourOfCurve` (against the exact rational value, by cross-multiplication),
`testFuzz_fourLegsNeverExceedInput`, `testFuzz_protocolFeeIsCarvedOutOnBuy` and `…OnSell` (the four
legs never exceed the quoted total, differ from it by at most three wei of rounding, and are always
below what an additive protocol leg would charge), `testFuzz_creatorFeesOnlyReachCreator`,
`testFuzz_protocolFeesOnlyReachTreasury`, `testFuzz_cannotSellMoreThanOutstanding` and
`testFuzz_buybackCappedAtOnePercent`.

The launch window has its own suite, `test/AdextoTokenLaunchWindowFuzz.t.sol`: a single buy above
the limit reverts, two buys that are each under it cannot add up past it, transfers cannot collect
tokens into one wallet past it, sells and buyback burns still work inside the window, the limit ends
exactly when the window does, and a fuzzed sequence of buys never leaves a wallet above the limit.

The buyback cooldown has its own suite too, including `test_buybackCannotBeLoopedInOneTransaction`
and `test_treasuryCannotBeDrainedInOneBlock`.

So does the stake hub, `test/AdextoStakeHub.t.sol` (25 tests): the constructor's rules, eligibility
for tokens from either factory, an excluded token and a token from nowhere, the minimum as a share
of supply, fee-on-transfer, soft-failing and re-entrant tokens refused through a stand-in factory,
the launch window applied to the hub's balance, and `testFuzz_totalEqualsSumOfPositions`. It has no
stateful invariant suite.

`test_handlerCanActuallyPerformEveryAction` exists because an invariant suite whose handler silently
fails every action passes while testing nothing.

## What we most want reviewed

Ranked by what we cannot settle ourselves. Fuzzing found no counterexample, which is not the same as
there being none.

1. **Rounding direction across every reachable state.** The claim is that truncation always favours
   the curve, never the trader, in buys, sells and buybacks. Fuzzing supports it; it is not a proof.
2. **Whether `_assertSolvent` checks the right quantity.** It runs after every mutation. If the
   predicate itself is incomplete, every invariant above is built on the same idea and they all pass
   together.
3. **The launch window.** For `ANTI_SNIPE_WINDOW` (180 s) after deployment, `AdextoToken._update`
   requires the recipient's balance after the transfer to be at most `maxWalletAmount` (1% of
   supply). Three recipients are exempt: the curve, so holders can sell; `address(0)`, so buyback
   burns work; and the launcher, which is the factory that receives the mint. We want the
   consequences of each exemption examined, and whether any path moves tokens into a wallet without
   passing the recipient check. A limit per wallet does not stop one person using many wallets; that
   is known and accepted, and each wallet pays its own gas and a rising price.
4. **`receive()` routing into `_buy`.** A plain native transfer with empty calldata executes a market
   buy with no slippage bound. We want the paths into it that we have not thought of.
5. **Four fee legs, with the protocol leg carved out of the total.** `swapFeeBps` is the whole fee a
   trader pays; `depthFeeBps` is the remainder after the creator, buyback and protocol legs. The only
   thing preventing that subtraction from underflowing is
   `require(creatorShareBps + treasuryShareBps + PROTOCOL_FEE_BPS <= swapFeeBps)`. We believe it is
   exactly sufficient and that depth reaching zero is legitimate, but a zero-depth market has a floor
   that never rises, which weakens the property the solvency argument leans on. Each leg rounds down
   independently; we would like the three-wei bound checked rather than trusted.
6. **Ticker reservation in the constructor.** `symbolRegistry` is per-factory state, so a new factory
   starts with an empty book. v1 seeds its reserved tickers in the constructor, writing the sentinel
   `SYMBOL_RESERVED = address(1)` so the existing `require(symbolRegistry[key] == address(0))`
   rejects them. There is no `reserve()` function and no way to release anything. We want to know
   whether a non-zero sentinel in a mapping typed as token addresses can be misread anywhere, and
   whether reserving at construction is preferable to a shared registry every version consults.
7. **The ERC-8004 call.** The factory calls `ownerOf(agentId)` on a third-party upgradeable proxy
   during `deployTrinity`. If that proxy becomes hostile, what is the worst it can do to a launch:
   revert only, or more?
8. **`executeBuyback` having no caller gate.** It is bounded to 1% of the reserve per call and to one
   call per `BUYBACK_COOLDOWN` (one hour), and it burns what it buys. We want it assessed as a
   permissionless primitive, including repeated calls across cooldowns.
9. **The x402 delivery path.** The relayer is a customer of the curve with no privileged position,
   and delivery runs before the charge, so a failed fill costs us. We want the griefing economics of
   that ordering.
10. **`AdextoAgentStake` accounting under a hostile token.** The contract has no owner, no pause and
    no path that moves another address's stake. It checks the boolean return of
    `transfer`/`transferFrom` but performs no balance-delta check. Bound to `AdextoToken` that is
    sound, because `_update` makes no external call. We want the consequences assessed for a
    deployment bound to a fee-on-transfer or rebasing token, and whether `accounting()` surfacing
    the surplus is sufficient disclosure.
11. **`AdextoStakeHub` eligibility and per-token accounting.** Eligibility rests on one claim: an
    accepted factory returns a non-zero `curveOf(token)` only for a token it created itself in
    `deployTrinity`. We want that checked against both factory versions the hubs accept. Positions
    are keyed by token while one address holds every token's balance, so we want to know whether
    any sequence of calls can move or misreport one token's positions through another's. `stake`
    checks the balance delta, so a fee-on-transfer token is refused; `unstake` and `unstakeAll` do
    not, which is sound for `AdextoToken`. The minimum is 0.001% of the token's current
    `totalSupply`, which buyback burns lower, so a position that met it keeps meeting it, and the
    remainder rule on a partial `unstake` reads the same figure. During a v1 token's launch window
    the hub is one wallet under the 1% cap, so every staker of that token shares the cap.

## Reproducing everything here

```bash
node scripts/compile-contracts.mjs --via-ir     # solc 0.8.37 -> build/artifacts/
~/.foundry/bin/forge test                        # fuzz, invariants, launch window, cooldown, stakes
node scripts/security-scan.mjs                   # every engine -> src/config/security-report.json
node scripts/test-erc8004-binding.mjs            # 24 assertions against a local devchain
```

Expected, so a different result is recognisable as a difference rather than assumed to be normal:
`compile-contracts.mjs` reports 8 sources and writes 36 artefacts, and `forge test` reports
**80 tests passed, 0 failed** across 6 suites. In the invariant run `buyback` reverts on most calls,
because the handler never advances time and every buyback after the first lands inside the
cooldown. `test_handlerCanActuallyPerformEveryAction` proves the other actions are not failing the
same way.

Foundry must find solc 0.8.37. If `forge` reports that no compiler matches `=0.8.37`, its bundled
release list predates that version: install the binary from
`https://binaries.soliditylang.org/linux-amd64/` into `~/.local/share/svm/0.8.37/solc-0.8.37` and
check it against the published sha256. `scripts/security-scan.mjs` resolves `forge` from
`~/.foundry/bin`, `solhint` from `node_modules/.bin` and Echidna from the `ghcr.io/crytic/echidna`
image, and mounts the local solc installs into that image.

`test-erc8004-binding.mjs` needs a fresh devchain (`anvil --port 8545`), because one case binds
agent id 0, which only the first registration receives.

## Reporting

Through [private vulnerability reporting](https://github.com/0xcuy/adexto/security/advisories/new).
Terms, response commitments and the absence of a bounty programme are in
[`SECURITY.md`](../SECURITY.md).
