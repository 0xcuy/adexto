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
| `contracts/AdextoAgentStake.sol` | holds staked $ADEXTO; gates compute quota | 179 | 66 |
| `contracts/AdextoToken.sol` | fixed-supply ERC-20 per launch, with the launch window | 161 | 61 |
| `contracts/IIdentityRegistry.sol` | interface for the ERC-8004 ownership check | 45 | 5 |
| **Total** | | **1,426** | **701** |

**If you price on raw lines rather than SLOC, say so before quoting.** 573 of the 1,426 lines are
comments explaining why the code is shaped the way it is, and 152 are blank. That is deliberate and
we are not asking you to review the prose, but it roughly doubles a line-based estimate.

Excluded from the figures above, and from any quote, because they never reach a chain:
`contracts/echidna/EchidnaAdextoCurve.sol` (88 SLOC), `contracts/test/MockEIP3009Token.sol` (70) and
`contracts/test/MockIdentityRegistry.sol` (27). The mock registry has its runtime code injected at
the ERC-8004 constant address on a local devchain, which is the only way the agent-binding path is
reachable off mainnet.

`AdextoAgentStake` is in scope because it holds other people's tokens. It is the one contract here
whose failure mode is a direct loss of principal rather than a mispriced trade.

Also in scope, because they can move money: the x402 edge worker in `cloudflare-worker/`, the API
routes under `src/app/api/`, and the MCP server at `/api/mcp` including `pay_and_buy`.

### Deployed addresses

Listed here once v1 is broadcast, with each chain's deployment transaction. The factory's runtime
bytecode is expected to be byte-identical on every chain, because its only immutable is the
protocol treasury, which is the same address everywhere. Reserved tickers live in storage, so a
chain-specific reserved list does not change the runtime code.

Earlier pre-release versions remain deployed on chain. They are not in this repository and are not
in scope.

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

**Slither**: 39 findings, none High. 17 are on the launch path (7 Medium, 6 Low, 4 Informational),
19 are in the Echidna harness and 3 in `AdextoAgentStake`.
**Aderyn** (harness excluded): 1 High kind in 4 instances, all triaged below, and 5 Low kinds in 21
instances. Solhint: 0 errors. Semgrep (general ruleset): 0 findings.

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

## Reproducing everything here

```bash
node scripts/compile-contracts.mjs --via-ir     # solc 0.8.37 -> build/artifacts/
~/.foundry/bin/forge test                        # fuzz, invariants, launch window, cooldown, stake
node scripts/security-scan.mjs                   # every engine -> src/config/security-report.json
node scripts/test-erc8004-binding.mjs            # 24 assertions against a local devchain
```

Expected, so a different result is recognisable as a difference rather than assumed to be normal:
`compile-contracts.mjs` reports 7 sources and writes 33 artefacts, and `forge test` reports
**55 tests passed, 0 failed** across 5 suites. In the invariant run `buyback` reverts on most calls,
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
