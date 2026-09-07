# ADEXTO Protocol (`adexto.xyz`)

> **Autonomous Decentralized EXchange & Token Orchestrator**
> Launch an agent-bound ERC-20 on its own bonding curve with no liquidity deposit — gas only — on 0G, Base, Arbitrum or Monad.

[![Website](https://img.shields.io/badge/Website-adexto.xyz-7C3AED?style=for-the-badge&logo=google-chrome&logoColor=white)](https://adexto.xyz)
[![Version](https://img.shields.io/badge/Contracts-v0.11.0-6D28D9?style=for-the-badge&logo=solidity&logoColor=white)](contracts/)
[![ERC-8004](https://img.shields.io/badge/ERC--8004_agent_binding-WORKS-10B981?style=for-the-badge&logo=ethereum&logoColor=white)](#erc-8004-agent-identity)
[![Chains](https://img.shields.io/badge/Mainnets-0G_·_Base_·_Arbitrum_·_Monad-10B981?style=for-the-badge&logo=ethereum&logoColor=white)](#-mainnet-deployments)
[![x402](https://img.shields.io/badge/x402_Edge-QUOTES_ONLY-F59E0B?style=for-the-badge&logo=cloudflare&logoColor=white)](https://adexto-x402-edge.cucuvirtual.workers.dev/v1/x402/adexto)

---

## What this is

A creator launches a token and it opens **inside a bonding curve against a virtual reserve**. There is nothing to seed, so a launch costs gas and nothing else. 100% of supply enters the curve, so the creator holds no allocation to sell. Income arrives instead as 0.10% of every swap, and that 0.10% comes out of the 0.30% the creator already set — paying the creator does not make the trade more expensive. The protocol's own 0.10% is the one leg that is added on top, which is why a trader pays 0.40%. Full breakdown in [Fee split](#fee-split).

The curve is the permanent venue. There is **no graduation step** and no migration into an external pool, which is where most launchpad exploits have historically happened. There is also no withdrawal function anywhere in the curve, so no one — including us — can drain a market.

That is a statement about the protocol, not a restriction on the token. `AdextoToken` enforces a 1%-of-supply per-transaction cap only while `block.number <= launchBlock + 5`; after that `_update` adds no condition at all, and there is no blacklist, no pause, no `Ownable` and no permanent transfer hook. It is a plain ERC-20. So **anyone can list one of these tokens on any external AMM without our permission, and we could not stop it** — a second market with its own price can exist alongside the curve. The guarantee is narrower than "one market": *we* never migrate, and nobody can withdraw the curve's reserves.

### Fee split

The creator configures a total — 0.30% on the default preset — which the curve divides three ways on-chain. The protocol's own share is charged **on top of** that total rather than carved out of it, so a trader on the default preset pays **0.40%** and the creator still keeps the full 0.10%.

| Share | Bps | Comes from | Goes to |
|---|---|---|---|
| Depth | 0.15% | inside the creator's 0.30% | stays in the curve, raising the price floor as volume accumulates |
| Creator | 0.10% | inside the creator's 0.30% | streamed to the creator's wallet on every swap |
| Buyback | 0.05% | inside the creator's 0.30% | accrues on the curve as `treasuryNative`; a buyback call spends it on the curve and burns what it bought |
| Protocol | 0.10% | **added on top** | `protocolOwed`, claimable only to the factory's immutable `protocolTreasury` |
| **Trader pays** | **0.40%** | | |

Read `totalFeeBps()` on the curve instead of adding these up. It is the contract's own answer to what a trade costs.

The protocol leg is a `public constant PROTOCOL_FEE_BPS` on the factory and an `immutable protocolFeeBps` on each curve, with **no setter in either**. A setter would make the contracts owned, which is the opposite of what `/security` claims about them. So: **markets created by the previous factory can never pay it.** Their rates are immutable too. That is permanent, not a migration waiting to happen.

`claimProtocolFees()` is permissionless — anyone may call it, and the native always lands at the immutable treasury. No key is needed to collect the fee. The treasury's key is only needed by its owner, later, to move the money elsewhere.

The studio's three presets (0.10% / 0.30% / 0.50%) are UI only. The contract accepts any split subject to `swapFeeBps + PROTOCOL_FEE_BPS <= 500`; the protocol leg is inside that comparison because the 5% cap applies to what a trader pays. Depth is the residual, not an input: the factory computes `swapFeeBps − creatorShareBps − treasuryShareBps`, and the curve re-checks the sum against its own ceiling.

The buyback does less than the word suggests. `executeBuyback` has no caller gate — only `nonReentrant` and `live` — so anyone may trigger it, capped at 1% of the native reserve per call. The native never leaves the contract: the call moves `treasuryNative` into the curve reserve and burns whatever that purchase bought. It reduces supply; it pays nobody. `agentTreasury` on the curve is a reference field and receives nothing, ever.

---

## ⚙️ What one launch creates

```mermaid
graph TD
    Creator([Creator]) -->|1 tx per chain, gas only<br/>deployTrinity is NOT payable| Factory[AdextoFactory v0.11.0]

    Registry[[ERC-8004 Identity Registry<br/>optional, off by default]] -.->|ownerOf agentId — launch reverts<br/>unless the caller owns that agent| Factory
    Meta[0G DA<br/>launch metadata anchored] -.->|metadataRoot in calldata| Factory

    subgraph "Deployed atomically in that transaction"
        Factory -->|1. deploys curve first,<br/>so the token can bind it immutably| Curve[AdextoCurve — own AMM<br/>virtual reserve, no deposit<br/>no owner, no withdraw/sweep/rescue]
        Factory -->|2. deploys token,<br/>mints 100% of supply to itself| Token[AdextoToken — plain ERC-20<br/>no owner, no pause, no blacklist<br/>1%-per-tx cap through launchBlock+5]
        Factory ==>|3. seeds 100% into the curve, then<br/>asserts its own balance is zero| Curve
    end

    Curve -->|0.15% depth| Depth[stays in the curve,<br/>raising the floor]
    Curve -->|0.10% creator| CreatorFee[claimCreatorFees →<br/>immutable creator address]
    Curve -->|0.05% buyback| Vault[treasuryNative —<br/>a balance on the curve,<br/>not a separate contract]
    Curve -->|0.10% protocol, charged ON TOP<br/>of the creator's 0.30%| Protocol[protocolOwed →<br/>claimProtocolFees is permissionless,<br/>destination is immutable]

    Vault -->|executeBuyback: no caller gate,<br/>max 1% of reserve per call| Burn[buys along the curve,<br/>burns what it bought]

    classDef live fill:#f5f3ff,stroke:#7c3aed,stroke-width:2px,color:#201810;
    classDef partial fill:#fffbeb,stroke:#f59e0b,stroke-width:2px,color:#201810;
    classDef ext fill:#eef2ff,stroke:#4338ca,stroke-width:2px,color:#201810;
    class Factory,Token,Curve,Depth,CreatorFee,Vault,Burn live;
    class Meta partial;
    class Registry ext;
```

Three things in that picture exist but are **not** part of `deployTrinity`:

- **`agentIdentity` is just an address.** It is required non-zero and stored immutably on both the token and the curve, and it may call `executeTreasuryBuyback` to burn tokens it holds itself. It is not automatically the 0G Compute agent — the studio passes the creator's own wallet by default.
- **The 0G Compute agent and the x402 edge are not wired into the curve.** The agent is an inference route; the x402 worker answers an HTTP 402 quote. Neither holds a key to anything on-chain, and neither can move the buyback balance. An earlier version of this diagram drew an arrow from the worker into the vault, which implied a settlement path that has never existed in the code.
- **The buyback burns, but nobody is in charge of it.** `executeBuyback` carries only `nonReentrant` and `live` — no caller gate — so anyone may trigger it, bounded to 1% of the reserve per call.

---

## 🏛️ Mainnet deployments

Every address below was confirmed to hold bytecode by a direct `eth_getCode` call against the chain's RPC. Testnet deployments are deliberately not listed here — they belong in the operator runbook, not in the public README.

`AdextoFactory` `0.11.0` is the current, executable generation: it deploys the token and its curve in one transaction, needs no liquidity deposit, can bind an ERC-8004 agent identity, and charges a 0.10% protocol fee on top of whatever the creator configures. Its runtime bytecode is **byte-identical across all four chains (21,281 bytes, keccak `0xcbb89e32ae973400723287f16f32e87f039efcef1c1f814c5805bd1a6fe3add8`)** and reproducible from source with `node scripts/compile-contracts.mjs --via-ir`.

Byte-identical is not automatic here. `protocolTreasury` is `immutable`, and Solidity puts immutables **inside** the runtime bytecode, so the hashes match only because the same treasury was used on every chain. One chain with a different treasury and the claim is false.

`0.10.0` and `0.9.0` are listed alongside it because they are **still deployed and still permissionless** — superseding a factory in the UI does not remove it from the chain, and the markets it already created keep trading. The three generations have different `deployTrinity` behaviour and, for `0.9.0`, a different selector, so they must not be confused. Each row below states its `VERSION` as read from the contract.

Markets created by `0.10.0` pay **no protocol fee and never will**, because every fee rate in `SovereignCurve` is `immutable`. That is a permanent property of those markets, not a migration that has not happened yet.

### 0G Mainnet · chain ID 16661

| Contract | Address | Notes |
|---|---|---|
| **AdextoFactory** | [`0x51c4168226463F7e5A141e1c6D30520734BC840a`](https://chainscan.0g.ai/address/0x51c4168226463F7e5A141e1c6D30520734BC840a) | **current** · `VERSION` `0.11.0` · 21,281 B · block 43704079 · `PROTOCOL_FEE_BPS` 10 |
| AdextoCurveFactory | [`0xaA85bc0cceB35B524b6BB730612540Fb88df0f8e`](https://chainscan.0g.ai/address/0xaA85bc0cceB35B524b6BB730612540Fb88df0f8e) | superseded · `VERSION` `0.10.0` · 20,054 B · block 43173642 · still live · its markets pay no protocol fee, permanently |
| AdextoCurveFactory | [`0x090a586Abfaad1eee258Fc15e8E4584B5c3B67d5`](https://chainscan.0g.ai/address/0x090a586Abfaad1eee258Fc15e8E4584B5c3B67d5) | superseded · `VERSION` `0.9.0` · 18,460 B · block 43164332 · still live |
| AdextoGovernor | [`0x5045b117dDF788078c535f37837fDB6384da034d`](https://chainscan.0g.ai/address/0x5045b117dDF788078c535f37837fDB6384da034d) | **not operational** · `governanceToken` points at the v1 hook, which has no `balanceOf` |
| ERC-8004 agent (ours) | [`3545431`](https://chainscan.0g.ai/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) | registered, owned by the deployer · id is chain-specific |
| AdextoTrinityFactory | [`0xe8E9Cf43f88D065892c35c4aDa002C7B8b11F3e0`](https://chainscan.0g.ai/address/0xe8E9Cf43f88D065892c35c4aDa002C7B8b11F3e0) | superseded v1 |
| SovereignHook | [`0x592c697aD1Fa712c6701C90991B96264aB2E98d8`](https://chainscan.0g.ai/address/0x592c697aD1Fa712c6701C90991B96264aB2E98d8) | superseded v1, cannot settle trades |

### Base Mainnet · chain ID 8453

| Contract | Address | Notes |
|---|---|---|
| **AdextoFactory** | [`0x216E7880D64D94335B583c539802d3e61958d4A2`](https://basescan.org/address/0x216E7880D64D94335B583c539802d3e61958d4A2) | **current** · `VERSION` `0.11.0` · 21,281 B · block 50971523 · `PROTOCOL_FEE_BPS` 10 |
| AdextoCurveFactory | [`0x2674654D4a8B79f84c1daC4Cf254EA066e59bC56`](https://basescan.org/address/0x2674654D4a8B79f84c1daC4Cf254EA066e59bC56) | superseded · `VERSION` `0.10.0` · 20,054 B · block 50712524 · still live · created no markets |
| AdextoCurveFactory | [`0xbC72FE919F85E679e7d95e2b471AaDA3c7c3Ac39`](https://basescan.org/address/0xbC72FE919F85E679e7d95e2b471AaDA3c7c3Ac39) | superseded · `VERSION` `0.9.0` · 18,460 B · block 50708028 · still live |
| AdextoGovernor | [`0x01b250a2db25561dB185f4628B93C72048D8bc1B`](https://basescan.org/address/0x01b250a2db25561dB185f4628B93C72048D8bc1B) | **not operational** · `governanceToken` is the zero address |
| ERC-8004 agent (ours) | [`84622`](https://basescan.org/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) | registered, owned by the deployer · id is chain-specific |
| AdextoTrinityFactory | [`0x8e63e117E71A80Cfc10fDF375F079e2e29cd7D7D`](https://basescan.org/address/0x8e63e117E71A80Cfc10fDF375F079e2e29cd7D7D) | superseded v1 |
| SovereignHook | [`0xb264D861264B0e4f8fb98A61B7694BA8a3B6BBe3`](https://basescan.org/address/0xb264D861264B0e4f8fb98A61B7694BA8a3B6BBe3) | superseded v1, cannot settle trades |

### Arbitrum One · chain ID 42161

| Contract | Address | Notes |
|---|---|---|
| **AdextoFactory** | [`0xE17f1027FC5f294327D701829baeD9d6519e922C`](https://arbiscan.io/address/0xE17f1027FC5f294327D701829baeD9d6519e922C) | **current** · `VERSION` `0.11.0` · 21,281 B · block 502476317 · `PROTOCOL_FEE_BPS` 10 |
| AdextoCurveFactory | [`0x8F3948902c48489fc9E7287590E7eb8A8E915A64`](https://arbiscan.io/address/0x8F3948902c48489fc9E7287590E7eb8A8E915A64) | superseded · `VERSION` `0.10.0` · 20,054 B · block 500429767 · still live · created no markets |
| AdextoCurveFactory | [`0x795D11BEAc025771e9e96Bb4489068b1eDC4b47a`](https://arbiscan.io/address/0x795D11BEAc025771e9e96Bb4489068b1eDC4b47a) | superseded · `VERSION` `0.9.0` · 18,460 B · block 500393825 · still live |
| AdextoGovernor | [`0x33811F9c53da5071A130F18D844f64999dBD43bA`](https://arbiscan.io/address/0x33811F9c53da5071A130F18D844f64999dBD43bA) | **not operational** · `governanceToken` points at the v1 hook, which has no `balanceOf` |
| ERC-8004 agent (ours) | [`1457`](https://arbiscan.io/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) | registered, owned by the deployer · id is chain-specific |
| AdextoTrinityFactory | [`0x2674654D4a8B79f84c1daC4Cf254EA066e59bC56`](https://arbiscan.io/address/0x2674654D4a8B79f84c1daC4Cf254EA066e59bC56) | superseded v1 |
| SovereignHook | [`0xbC72FE919F85E679e7d95e2b471AaDA3c7c3Ac39`](https://arbiscan.io/address/0xbC72FE919F85E679e7d95e2b471AaDA3c7c3Ac39) | superseded v1, cannot settle trades |

### Monad Mainnet · chain ID 143

| Contract | Address | Notes |
|---|---|---|
| **AdextoFactory** | [`0x5800e9715a47a598fce9bc3B65a95FD6BeBf76A3`](https://monadvision.com/address/0x5800e9715a47a598fce9bc3B65a95FD6BeBf76A3) | **current** · `VERSION` `0.11.0` · 21,281 B · block 102583076 · `PROTOCOL_FEE_BPS` 10 |
| AdextoCurveFactory | [`0xbC72FE919F85E679e7d95e2b471AaDA3c7c3Ac39`](https://monadvision.com/address/0xbC72FE919F85E679e7d95e2b471AaDA3c7c3Ac39) | superseded · `VERSION` `0.10.0` · 20,054 B · block 100872196 · still live · created no markets |
| AdextoCurveFactory | [`0x05EFA7F066FcbefbE650EDd58583C107831A600B`](https://monadvision.com/address/0x05EFA7F066FcbefbE650EDd58583C107831A600B) | superseded · `VERSION` `0.9.0` · 18,460 B · block 100842422 · still live |
| AdextoGovernor | [`0x01b250a2db25561dB185f4628B93C72048D8bc1B`](https://monadvision.com/address/0x01b250a2db25561dB185f4628B93C72048D8bc1B) | **not operational** · `governanceToken` is the zero address |
| ERC-8004 agent (ours) | [`10247`](https://monadvision.com/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) | registered, owned by the deployer · id is chain-specific |
| AdextoTrinityFactory | [`0x8e63e117E71A80Cfc10fDF375F079e2e29cd7D7D`](https://monadvision.com/address/0x8e63e117E71A80Cfc10fDF375F079e2e29cd7D7D) | superseded v1 |
| SovereignHook | [`0xb264D861264B0e4f8fb98A61B7694BA8a3B6BBe3`](https://monadvision.com/address/0xb264D861264B0e4f8fb98A61B7694BA8a3B6BBe3) | superseded v1, cannot settle trades |

> Some addresses repeat across chains, and one repeats three times. That is expected, not a copy-paste error: `CREATE` derives an address from the deployer and its nonce, so the same deployer at the same nonce lands on the same address on every EVM chain. `0xbC72FE919F85E679e7d95e2b471AaDA3c7c3Ac39` is the **superseded 0.9.0 factory on Base**, the **superseded 0.10.0 factory on Monad**, and the **v1 hook on Arbitrum** — three different contracts at one address on three different chains, each confirmed by reading `VERSION` and the bytecode size from that chain. Always check the chain before trusting an address here.
>
> The `0.11.0` addresses do **not** repeat, and that is the same fact seen from the other side: by the time they were deployed the deployer's nonce differed per chain, so `CREATE` landed somewhere different on each.

**Deployer:** `0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D`

**Protocol treasury:** [`0x24268Fffc119ec5550F68e80D94476fD64daE967`](https://chainscan.0g.ai/address/0x24268Fffc119ec5550F68e80D94476fD64daE967) — the immutable destination of the 0.10% protocol leg on every `0.11.0` curve. Deliberately not the deployer: that key is online and is already the `creator` of live markets, which would make protocol revenue and creator revenue indistinguishable on-chain. It was a fresh address with no code, nonce 0 and no balance on all four mainnets when it was chosen.

---

## 📋 Honest status

| Component | Works? | Exactly what that means |
|---|---|---|
| `AdextoFactory` `0.11.0` on 4 mainnets | **Live** | Broadcast and read back on each chain: `VERSION` `0.11.0`, `PROTOCOL_FEE_BPS` 10, `protocolTreasury` equal to the address published above, `totalProjectsCount` 0 at deployment, and runtime bytecode byte-identical across all four (21,281 B). |
| Protocol fee revenue | **Live rate, zero earned** | The leg is charged and accrues on every `0.11.0` curve. Earnings so far are zero because earnings need volume. Markets created by `0.10.0` can never contribute: their fee rates are `immutable`. |
| `AdextoCurveFactory` `0.10.0` on 4 mainnets | **Live, superseded** | Still deployed and still permissionless. Superseded because `0.11.0` adds the protocol fee leg. The markets it created on 0G keep trading on their original three-way split and can never pay a protocol fee, since their rates are immutable. |
| `AdextoCurveFactory` `0.9.0` on 4 mainnets | **Live, superseded** | Still deployed and still permissionless. Superseded because `0.10.0` added the ERC-8004 binding, which changed the `deployTrinity` selector. All three generations are listed in the tables above so nobody mistakes one for another. |
| ERC-8004 agent binding | **Works. Off unless you ask for it** | Pass an agent id at launch and the factory calls `ownerOf(agentId)`, reverting unless you own that agent. Leave it out and the launch is one transaction with no agent. What is NOT used: the Reputation and Validation registries, and `supportsInterface`. So this integrates with one of the standard's three registries — it is not ERC-8004 compliance and this file does not call it that. [Details](#erc-8004-agent-identity). |
| Launching through the site | **Enabled** | All four `NEXT_PUBLIC_CURVE_FACTORY_*` are set to the `0.11.0` addresses above, so the studio launches on the current generation. `NEXT_PUBLIC_CURVE_FACTORY_PREV_*` carries the `0.10.0` addresses for verification only and is deliberately excluded from every "can this chain launch" check. |
| Live markets | **2, both on 0G** | `$ADEXTO` and `$ADT`. Every launch that exists on chain is recorded once in [`src/config/onchain-launches.json`](src/config/onchain-launches.json) with its status — live, superseded, or a throwaway test ticker from a demo recording — and `audit_consistency.mjs` fails the build if an on-chain launch appears that the file does not account for. `allProjects` is append-only with no delete, so the factories' raw counter can only rise; it is not a growth number and is not quoted as one. |
| Trading / swap | **Live on 0G** | Real fills exist on the 0G markets. The other three chains have factories but no markets yet. |
| Own AMM (`AdextoCurve`) | **Deployed per launch** | The curve ships with the factory. `SovereignCurve` is the previous generation's curve and still serves the markets it was deployed for. |
| Agent compute (0G) | **Works. Attestation is claimed, not checked** | Inference runs. The 0G router tells us each model is Intel TDX attested via dstack, and we print what it tells us. We never fetch the raw attestation quote and never verify it, so treat that label as the router's word, not our proof. |
| x402 edge gateway | **Quotes a price and checks who you are. Cannot collect** | Two of the three steps work. See [x402 edge](#x402-edge) for what each one does and what the third would take. No money has ever passed through it, so the 10% facilitation fee in the revenue model has nothing to take a share of. |
| 0G DA metadata anchoring | **Live** | Launch metadata is anchored and its storage root travels in calldata as `metadataRoot`. |
| The Graph indexing | **Live on Base and Arbitrum, absent on 0G and Monad** | `adexto-base` and `adexto-arbitrum` are live and `SUBGRAPH_URL_*` points at both, `hasIndexingErrors: false` on each. Both chains have factories but no markets, so those subgraphs correctly return nothing. **0G is where the markets actually are and it is not indexed at all** — `SUBGRAPH_URL_0G` is empty, and the app reads 0G trades straight from RPC logs instead. The manifest carries both factory generations as separate data sources, because the `Swap` signatures differ and pointing one data source at the new factory would drop every existing market. Not published to the decentralized network. See below. |
| Governance | **Does not work** | Not "nobody has voted yet" — nobody *can*. `castVote` weighs a ballot with `governanceToken.balanceOf(msg.sender)`, and that address is the zero address on Base and Monad, and the superseded v1 hook — which has no `balanceOf` — on 0G and Arbitrum. Every vote reverts. `proposalCount` is 0 on all four. |

### Why a bonding curve rather than a liquidity pool

The reason is the launch model, and it is checkable in the contracts rather than a matter of taste.

| | this curve | a standard liquidity pool |
|---|---|---|
| Capital to open a market | none — the native side starts entirely virtual, and `deployTrinity` is not `payable`, so it cannot accept a deposit | real liquidity must be deposited by someone |
| Creator's token position | none — the whole supply is minted to the factory and loaded into the curve in the same transaction, and the factory then requires its own balance to be zero before the launch can succeed | the creator must hold tokens to pair with liquidity |
| Can reserves be pulled out | no — there is no `withdraw`, `rescue`, `sweep`, `drain` or `emergency` function anywhere, no owner and no `onlyOwner`; native leaves through exactly two paths, a seller's payout and the creator's fee claim to an immutable address | yes, and correctly so: a provider may withdraw at any time |
| Migration step | none — the curve is the permanent venue | the usual launchpad pattern graduates a curve into a pool, and that step is where much of the historical exploit surface lives |
| Creator fee | 0.10% of every swap accrues on-chain inside the 0.30% the creator configures, so paying the creator costs the trader nothing extra | fees accrue to liquidity providers; paying a creator needs custom hook support the venue may not offer |
| Code paths across our four chains | one, byte-identical | whatever venue happens to exist per chain |

Row three carries the weight. A liquidity provider being able to withdraw is not a flaw — it is what an AMM is for — but it means the venue can be pulled out from under holders, and "we won't" is only a promise. Here the guarantee is the absence of code that could do it.

### ERC-8004 agent identity

**It works, and it is off unless you ask for it.** Pass an agent id at launch and `AdextoFactory` calls `ownerOf(agentId)` on the [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) Identity Registry, refusing the launch unless you own that agent — so a token cannot attach itself to somebody else's identity and inherit its reputation. Leave the id out and the launch is one transaction with no agent attached.

**It is not ERC-8004 compliance, and this file used to say it was.** The standard has three registries; this uses the Identity Registry and nothing else. `supportsInterface` is not implemented. Reputation and Validation are not touched.

| | |
|---|---|
| Identity Registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` — same address on all four mainnets, verified answering `ownerOf` |
| Our own agent | **registered on all four mainnets** — Base `84622`, Arbitrum One `1457`, 0G `3545431`, Monad `10247`, all owned by the deployer |
| Registry on testnets | **absent**, so the agent path can only be exercised on mainnet or a local devchain |
| Status of the standard | EIP-8004 is a **Draft**, so what we integrate against can still change. This is about the EIP, not about our code |
| Who controls the registry | **not us.** It is an upgradeable proxy owned by a third party, so its behaviour can change without our involvement or consent |
| Reputation / Validation registries | **not used** |
| Read on a token | `agentBound()`, then `agentId()` and `agentRegistry()` |

Four things that will bite you otherwise.

**An agent id means nothing without its chain.** The registry sits at one address on all four mainnets, which invites the assumption that an id is global. It is not — each registry keeps its own state, and `ownerOf(0)` returns three *different* owners across the four chains. Our own registrations came back `84622` on Base, `1457` on Arbitrum, `3545431` on 0G and `10247` on Monad for the same agent. Launching four chains with one id binds on the chain it came from and reverts on the rest with `Factory: agent not owned by caller`, after gas has been spent on each. Register once per chain and pass that chain's id.

**Binding is a separate step from launching.** ERC-8004 wants the registration file to contain its own `agentId`, and the id does not exist until `register()` returns — so a file pinned beforehand cannot contain it. The creator registers first and passes the id to the launch. Leaving the identity off keeps the launch at one transaction, which is why the gas-only property is unaffected.

**`agentBound()` is the flag to read, not `agentId()`.** Agent id 0 is a real agent with a real owner on 0G, Base, Arbitrum One and Monad, so zero cannot mean "no agent". An earlier revision of this used `agentId == 0` as that sentinel; testing against the live registries caught it before it was frozen into immutable bytecode.

**The registration file is `data:` until IPFS pinning is configured.** ERC-8004 permits a base64 `data:` URI for fully on-chain metadata, and that is the default here because an `ipfs://` CID that nobody pins is a dead link recorded permanently. Set `PINATA_JWT` to pin instead; the CID is recomputed locally and compared with what the service reports. This matters: an empirical study of ERC-8004 found most registrations are placeholders with no live endpoint ([arXiv 2606.26028](https://arxiv.org/html/2606.26028)), and reading agent #40 on our own four chains shows an empty string on 0G, un-encoded raw JSON on Monad, and an HTTPS URL whose embedded id does not match the token on Base.

The script reads the id out of the mint `Transfer` event rather than assuming ids are sequential, then calls `setAgentURI` with a rebuilt file that contains that id.

```bash
node scripts/register-agent-8004.mjs --chain base              # dry run, no gas
node scripts/register-agent-8004.mjs --chain base --broadcast   # registers, then sets the URI
node scripts/test-erc8004-binding.mjs                          # 24 assertions, local devchain
```

Registering on all four cost roughly $0.10 in total across eight transactions.

### x402 edge

**What is it for, if it cannot take money?** The x402 flow has three steps. Two of them are here and work; the third is not built. Naming them is the only way the answer is useful.

| Step | State | What actually happens |
|---|---|---|
| 1. Quote the price | **works** | An unpaid call gets HTTP 402, a `WWW-Authenticate: x402` header, and a machine-readable price list — `0.005 USDC` for an inference query, `0.010` for a quant signal, `0.020` for custom execution. A client discovers the terms without asking a human. |
| 2. Prove who is paying | **works** | Send an EIP-712 voucher and the signature is recovered and checked against the address you claim. Not a stub: sign with one key and claim a different address and it answers `401` with the address it actually recovered. |
| 3. Collect the money | **not built** | A correctly signed voucher gets `501 Not Implemented`. Nothing is transferred and no work is dispatched. |

So today it is a **priced, authenticated endpoint that never charges** — useful for an agent to discover terms and identify itself, useless for getting paid.

Two things about step 3 that are easy to gloss over, and shouldn't be:

- **The voucher is not a payment authorisation.** It is a custom `Voucher` type of our own — `agent`, `amount`, `nonce`. Verifying it proves the signer controls that address; it does **not** prove they hold USDC or authorise anyone to move it. Real settlement would sign USDC's own EIP-3009 `TransferWithAuthorization` instead, which is what a facilitator can actually submit on-chain.
- **Building step 3 needs a funded hot key in the Worker.** Someone has to submit that transfer and pay gas. `Env.SIGNER_PRIVATE_KEY` is already declared in `cloudflare-worker/src/index.ts` and **never read** — the slot for that key exists, unused, which is worth knowing before assuming settlement is a small change. It is a security decision, not a feature toggle.

The endpoint declares its own limit in its own response body: the 402 payload carries `settlementImplemented: false` and a note saying a voucher returns 501. An integrator learns the boundary from the first reply, not after building a payment client.

### The Graph

Deployed for Base and Arbitrum, and read by the site — `SUBGRAPH_URL_*` points at both. This section previously said "not yet read by this site", which stopped being true when those variables were set. The manifest and per-network config are generated from `subgraph/chains.json` plus `build/deployments.json` (`npm run networks` in `subgraph/`).

| Subgraph | Version | Endpoint |
|---|---|---|
| `adexto-base` | `v0.11.0` | `https://api.studio.thegraph.com/query/1757874/adexto-base/v0.11.0` |
| `adexto-arbitrum` | `v0.11.0` | `https://api.studio.thegraph.com/query/1757874/adexto-arbitrum/v0.11.0` |

**The useful thing to know: the markets are on 0G, and 0G is not indexed.** Base and Arbitrum have factories but no markets, so those two subgraphs correctly return nothing. The Graph does not serve 0G and the self-hosted node for it is not running, so `SUBGRAPH_URL_0G` is empty and the app reads 0G trades straight from RPC logs. The subgraph is real infrastructure aimed at the two chains with the least to say.

`v0.11.0` indexes **both curve generations side by side**, because the two `Swap` events are not the same event: `0.11.0` inserts `protocolFee` before both reserves, giving it eleven fields and a different `topic0`. One data source cannot match both, so repointing the existing one at the new factory would have dropped every market the old factory created — and reported itself healthy while doing it. There are two data sources and two templates, with the mapping logic held once in `src/shared.ts`.

`Curve.curveVersion` exists for the same reason: without it, `protocolFeeBps: 0` on an old curve is indistinguishable from a new curve that charges nothing, which would suggest the rate can change. It cannot — it is `immutable` per curve.

Earlier versions: `v0.10.1` fixed a 1e18 unit mismatch between `openingPriceNative` and `spotPriceNative`. `v0.10.2` removed "agent buyback burns" from the manifest description, since `executeBuyback` has no caller gate and attributing it to an agent overstated the contract.

Nothing is published to the decentralized network, and publishing alone would not make it serve queries: indexers are paid in proportion to curation signal, so a subgraph with token signal gives them no reason to index it. The Studio endpoints above answer queries today without that.

Two of the four chains cannot use Subgraph Studio. That is The Graph's coverage, not our choice:

| Chain | Target | Reason |
|---|---|---|
| Base, Arbitrum One | Subgraph Studio | Subgraphs served, indexing rewards enabled — **deployed, see above** |
| 0G Mainnet | Self-hosted Graph Node | absent from `graphprotocol/networks-registry` entirely |
| Monad Mainnet | Self-hosted Graph Node | listed, but served by Firehose and Substreams only — not Subgraphs |

Self-hosting runs from `subgraph/docker-compose.yml`. Public-RPC `eth_getLogs` ceilings are probed rather than assumed and recorded per chain in `subgraph/chains.json`: 2,000 blocks on 0G, and a hard 100 on Monad, which returns `-32614` above that.

---

## 🛠️ Local development

```bash
git clone https://github.com/0xcuy/adexto.git
cd adexto
npm install
cp .env.example .env.local
npm run dev          # http://localhost:3000
```

Contracts compile reproducibly, with no Hardhat run required:

```bash
node scripts/compile-contracts.mjs --via-ir     # -> build/artifacts/
node scripts/deploy-sovereign-curve.mjs --chain base            # dry run, no gas
node scripts/deploy-sovereign-curve.mjs --chain base --broadcast # spends gas
```

The dry run checks the RPC chain ID, the deployer balance and `estimateGas` before anything is sent, and refuses to broadcast if the balance cannot cover the deployment.

### A note on reserved tickers

`RESERVED_SYMBOLS` in `src/lib/registry.ts` blocks a set of tickers from being claimed through `/api/deploy`. This is an application-level guard only: `deployTrinity` on the factory has no access control, so the reservation cannot bind anyone who calls the contract directly. `ADEXTO_OFFICIAL_DEPLOYER` grants one address an exception so the protocol can launch its own reserved tickers; it is empty by default, which means nobody can.

---

## 📄 License

MIT © 2026 ADEXTO Core Contributors · [adexto.xyz](https://adexto.xyz)
