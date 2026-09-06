# ADEXTO Protocol (`adexto.xyz`)

> **Autonomous Decentralized EXchange & Token Orchestrator**
> Launch an agent-bound ERC-20 on its own bonding curve with no liquidity deposit — gas only — on 0G, Base, Arbitrum or Monad.

[![Website](https://img.shields.io/badge/Website-adexto.xyz-7C3AED?style=for-the-badge&logo=google-chrome&logoColor=white)](https://adexto.xyz)
[![Version](https://img.shields.io/badge/Contracts-v0.11.0-6D28D9?style=for-the-badge&logo=solidity&logoColor=white)](contracts/)
[![ERC-8004](https://img.shields.io/badge/ERC--8004-identity_only_·_draft-F59E0B?style=for-the-badge&logo=ethereum&logoColor=white)](#erc-8004-agent-identity)
[![Chains](https://img.shields.io/badge/Mainnets-0G_·_Base_·_Arbitrum_·_Monad-10B981?style=for-the-badge&logo=ethereum&logoColor=white)](#-mainnet-deployments)
[![x402](https://img.shields.io/badge/x402_Edge-discovery_only-F59E0B?style=for-the-badge&logo=cloudflare&logoColor=white)](https://adexto-x402-edge.cucuvirtual.workers.dev/v1/x402/adexto)

---

## What this is

A creator launches a token and it opens **inside a bonding curve against a virtual reserve**. There is nothing to seed, so a launch costs gas and nothing else. 100% of supply enters the curve, so the creator holds no allocation to sell. Income arrives instead as a share of every swap, taken from inside the existing fee rather than added on top of it.

The curve is the permanent venue. There is **no graduation step** and no migration into an external pool, which is where most launchpad exploits have historically happened. There is also no withdrawal function anywhere in the curve, so no one — including us — can drain a market.

To be precise about what that does and does not mean: it describes what the protocol does, not a restriction on the token. `AdextoToken` enforces a 1%-of-supply per-transaction cap only while `block.number <= launchBlock + 5`; after that window `_update` adds no condition at all, and there is no blacklist, no pause, no `Ownable` and no permanent transfer hook. It is a plain ERC-20. So **anyone can list one of these tokens on any external AMM, without our permission, and we could not stop it.** A second market with its own price could therefore exist alongside the curve. What the protocol guarantees is narrower and worth stating plainly: *we* never migrate the market, and nobody can withdraw the curve's own reserves.

### Fee split

The creator configures a total — 0.30% on the default preset — which the curve divides three ways on-chain. The protocol's own share is charged **on top of** that total rather than carved out of it, so a trader on the default preset pays **0.40%** and the creator still keeps the full 0.10%.

| Share | Bps | Comes from | Goes to |
|---|---|---|---|
| Depth | 0.15% | inside the creator's 0.30% | stays in the curve, raising the price floor as volume accumulates |
| Creator | 0.10% | inside the creator's 0.30% | streamed to the creator's wallet on every swap |
| Buyback | 0.05% | inside the creator's 0.30% | accrues on the curve as `treasuryNative`; a buyback call spends it on the curve and burns what it bought |
| Protocol | 0.10% | **added on top** | `protocolOwed`, claimable only to the factory's immutable `protocolTreasury` |
| **Trader pays** | **0.40%** | | |

Read `totalFeeBps()` on a curve rather than adding these up. It is the contract's own answer to what a trade costs, and it exists so that no caller can quietly disagree with the curve about the total.

The protocol leg is a `public constant PROTOCOL_FEE_BPS` on the factory and an `immutable protocolFeeBps` on each curve, with **no setter in either**. That is deliberate: a setter would make the contracts owned, which contradicts what `/security` says about them, and a timelock only means something if something is mutable. The consequence is worth stating plainly — **markets created by the previous factory can never pay it.** Their fee rates are immutable too, so that is permanent rather than a migration that has not happened yet.

`claimProtocolFees()` is permissionless. Anyone may call it and the native always lands at the immutable treasury, so no key is ever required to collect the fee. The treasury's own key is only needed by its owner, later, to move the funds elsewhere.

The studio offers three presets (0.10% / 0.30% / 0.50% of the creator-configured total) and the table shows the 0.30% standard one, but the preset list is UI only — the contract accepts any split subject to `swapFeeBps + PROTOCOL_FEE_BPS <= 500`. The protocol leg sits inside that comparison because the 5% cap applies to what a trader actually pays. Depth is the residual, not an input: the factory computes `swapFeeBps − creatorShareBps − treasuryShareBps` and the curve re-checks the sum against its own ceiling, so the shares cannot exceed the total.

Two details about the buyback share, because "buyback" usually implies more than this one does. It is **permissionless** — `executeBuyback` carries only `nonReentrant` and `live`, so any address may call it, capped at 1% of the native reserve per call. And the native never leaves the contract: the call moves `treasuryNative` into the curve reserve and burns the tokens that purchase bought, so the effect is a permanent supply reduction rather than a payment to anyone. `agentTreasury` on the curve is a reference field and receives nothing, ever.

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

Three things in that picture are worth separating from the launch path, because they are real but they are not part of `deployTrinity`:

- **`agentIdentity` is just an address.** It is required non-zero and stored immutably on both the token and the curve, and it may call `executeTreasuryBuyback` to burn tokens it holds itself. It is not automatically the 0G Compute agent — the studio passes the creator's own wallet by default.
- **The 0G Compute agent and the x402 edge are not wired into the curve.** The agent is an inference route; the x402 worker answers an HTTP 402 quote. Neither holds a key to anything on-chain, and neither can move the buyback balance. An earlier version of this diagram drew an arrow from the worker into the vault, which implied a settlement path that has never existed in the code.
- **The buyback burns, but nobody is in charge of it.** `executeBuyback` carries only `nonReentrant` and `live` — no caller gate — so anyone may trigger it, bounded to 1% of the reserve per call.

---

## 🏛️ Mainnet deployments

Every address below was confirmed to hold bytecode by a direct `eth_getCode` call against the chain's RPC. Testnet deployments are deliberately not listed here — they belong in the operator runbook, not in the public README.

`AdextoFactory` `0.11.0` is the current, executable generation: it deploys the token and its curve in one transaction, needs no liquidity deposit, can bind an ERC-8004 agent identity, and charges a 0.10% protocol fee on top of whatever the creator configures. Its runtime bytecode is **byte-identical across all four chains (21,281 bytes, keccak `0xcbb89e32ae973400723287f16f32e87f039efcef1c1f814c5805bd1a6fe3add8`)** and reproducible from source with `node scripts/compile-contracts.mjs --via-ir`.

That the four are byte-identical is worth one sentence of explanation, because it is not automatic: `protocolTreasury` is `immutable` and Solidity places immutables **inside** the runtime bytecode. The hashes match only because the same treasury address was used on every chain. Deploy one chain with a different treasury and this claim stops being true.

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

The point of this table is that nothing above it should be read as more finished than it is.

| Component | State | What that means precisely |
|---|---|---|
| `AdextoFactory` `0.11.0` on 4 mainnets | **Live** | Broadcast and read back on each chain: `VERSION` `0.11.0`, `PROTOCOL_FEE_BPS` 10, `protocolTreasury` equal to the address published above, `totalProjectsCount` 0 at deployment, and runtime bytecode byte-identical across all four (21,281 B). |
| Protocol fee revenue | **Live rate, zero earned** | The leg is charged and accrues on every `0.11.0` curve. Earnings so far are zero because earnings need volume. Markets created by `0.10.0` can never contribute: their fee rates are `immutable`. |
| `AdextoCurveFactory` `0.10.0` on 4 mainnets | **Live, superseded** | Still deployed and still permissionless. Superseded because `0.11.0` adds the protocol fee leg. The markets it created on 0G keep trading on their original three-way split and can never pay a protocol fee, since their rates are immutable. |
| `AdextoCurveFactory` `0.9.0` on 4 mainnets | **Live, superseded** | Still deployed and still permissionless. Superseded because `0.10.0` added the ERC-8004 binding, which changed the `deployTrinity` selector. All three generations are listed in the tables above so nobody mistakes one for another. |
| ERC-8004 agent identity | **Optional, verified on-chain** | See [below](#erc-8004-agent-identity). Identity registry only; reputation and validation are not used. |
| Launching through the site | **Enabled** | All four `NEXT_PUBLIC_CURVE_FACTORY_*` are set to the `0.11.0` addresses above, so the studio launches on the current generation. `NEXT_PUBLIC_CURVE_FACTORY_PREV_*` carries the `0.10.0` addresses for verification only and is deliberately excluded from every "can this chain launch" check. |
| Live markets | **2, both on 0G** | `$ADEXTO` and `$ADT`. Every launch that exists on chain is recorded once in [`src/config/onchain-launches.json`](src/config/onchain-launches.json) with its status — live, superseded, or a throwaway test ticker from a demo recording — and `audit_consistency.mjs` fails the build if an on-chain launch appears that the file does not account for. `allProjects` is append-only with no delete, so the factories' raw counter can only rise; it is not a growth number and is not quoted as one. |
| Trading / swap | **Live on 0G** | Real fills exist on the 0G markets. The other three chains have factories but no markets yet. |
| Own AMM (`AdextoCurve`) | **Deployed per launch** | The curve ships with the factory. `SovereignCurve` is the previous generation's curve and still serves the markets it was deployed for. |
| Agent compute (0G) | **Live, partially attested** | The 0G router reports Intel TDX attestation via dstack for each model we call. We read that declaration; we do **not** fetch or verify the raw quote. |
| x402 edge gateway | **Discovery only** | The HTTP 402 challenge, price and settlement vault are live and real. EIP-712 voucher settlement and revenue routing into the vault are **not built** — a signed voucher returns 501. |
| 0G DA metadata anchoring | **Live** | Launch metadata is anchored and its storage root travels in calldata as `metadataRoot`. |
| The Graph indexing | **Live on Base and Arbitrum, absent on 0G and Monad** | `adexto-base` and `adexto-arbitrum` are live and `SUBGRAPH_URL_*` points at both, `hasIndexingErrors: false` on each. Both chains have factories but no markets, so those subgraphs correctly return nothing. **0G is where the markets actually are and it is not indexed at all** — `SUBGRAPH_URL_0G` is empty, and the app reads 0G trades straight from RPC logs instead. The manifest carries both factory generations as separate data sources, because the `Swap` signatures differ and pointing one data source at the new factory would drop every existing market. Not published to the decentralized network. See below. |
| Governance | **Deployed, NOT operational** | Stronger than "unexercised": it cannot be exercised. `castVote` weighs a ballot with `governanceToken.balanceOf(msg.sender)`, and that address is the zero address on Base and Monad, and the superseded v1 hook — which has no `balanceOf` — on 0G and Arbitrum. Every vote would revert. `proposalCount` is 0 on all four. |

### A claim this file used to make

One claim was carried in this README for a long time and was not true when it was written. It is recorded here rather than quietly deleted, because a corrected file that hides its corrections asks to be trusted on nothing but its current wording.

- **~~ERC-8004 compliance.~~** This was false and is now partly true; see [ERC-8004 agent identity](#erc-8004-agent-identity) below for exactly how far it goes. Until factory `0.10.0`, `AdextoToken` was `ERC20` and nothing more, carrying one `address immutable agentIdentity` and touching no registry — so the claim was unsupportable and the source called it "ERC-8004 style", an analogy. A launch can now bind a real agent id, verified on-chain. The reputation and validation registries are still not used.

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

The third row is the substantive one. That a liquidity provider can withdraw is not a flaw — it is what an AMM is for. But it means the venue can be removed from under holders, and "we won't" is a promise. Here the same guarantee comes from the absence of code that could do it.

### ERC-8004 agent identity

Optional, off by default, and real when switched on. A launch may bind the token to an agent registered in the [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) Identity Registry, and `AdextoFactory` calls `ownerOf(agentId)` and refuses the launch unless the caller owns that agent — so a token cannot attach itself to somebody else's identity and inherit its reputation.

| | |
|---|---|
| Identity Registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` — same address on all four mainnets, verified answering `ownerOf` |
| Our own agent | **registered on all four mainnets** — Base `84622`, Arbitrum One `1457`, 0G `3545431`, Monad `10247`, all owned by the deployer |
| Registry on testnets | **absent**, so the agent path can only be exercised on mainnet or a local devchain |
| Standard status | **Draft**. The registry proxy is upgradeable and controlled by a third party |
| Reputation / Validation registries | **not used** |
| Read on a token | `agentBound()`, then `agentId()` and `agentRegistry()` |

Four things worth knowing before relying on it.

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

### The Graph

Deployed for two chains, and **not yet read by this site**. The manifest and per-network config are generated from `subgraph/chains.json` plus `build/deployments.json` (`npm run networks` in `subgraph/`).

| Subgraph | Version | Endpoint |
|---|---|---|
| `adexto-base` | `v0.11.0` | `https://api.studio.thegraph.com/query/1757874/adexto-base/v0.11.0` |
| `adexto-arbitrum` | `v0.11.0` | `https://api.studio.thegraph.com/query/1757874/adexto-arbitrum/v0.11.0` |

`v0.10.1` fixed a unit mismatch where `openingPriceNative` was a 1e18-scaled `BigInt` beside a decimal `spotPriceNative`. `v0.10.2` corrects the manifest description, which claimed "agent buyback burns" — `executeBuyback` has no caller gate at all, so anyone may trigger it and attributing it to an agent overstated what the contract enforces. The same version also stopped omitting the ERC-8004 `AgentBound` binding, which the subgraph indexes and the description had never mentioned.

`v0.11.0` indexes **both curve generations side by side**, and the reason it has to is worth stating: the two `Swap` events are not the same event. `0.11.0` inserts `protocolFee` before both reserves, making it eleven fields with a different `topic0`, so one data source physically cannot match both. Repointing the existing data source at the new factory would therefore have dropped every market the old factory created — a subgraph that answers with fewer markets than the chain holds, while reporting itself healthy. There are now two data sources and two templates, with the mapping logic held once in `src/shared.ts` and four thin adapters over it.

The schema gained `Curve.curveVersion` for the same reason. Without it, `protocolFeeBps: 0` on an old curve is indistinguishable from a new curve that happens to charge nothing, and a reader would reasonably conclude the rate can change. It cannot: it is `immutable` per curve.

**A limitation to be plain about: the markets are on 0G, and 0G is not indexed at all.** Base and Arbitrum have factories but no markets, so those two subgraphs correctly return nothing — they are exercised, not useful. `SUBGRAPH_URL_0G` is empty because The Graph does not serve 0G and the self-hosted node for it is not running; the app reads 0G trades directly from RPC logs instead. So the subgraph is real infrastructure pointed at the chains that have the least to say.

`SUBGRAPH_URL_*` **is now set** for both. It was held back on the reasoning that pointing the app at an endpoint which had never indexed a launch would replace direct chain reads with an indexer that has nothing to say. That reasoning was wrong about this codebase: `src/app/api/graphql/route.ts` treats the registry as the primary source and the indexer as additive, so an empty or unreachable indexer only leaves `live` null. Wiring it early also means the indexer path is exercised before a demo instead of during one.

One consequence worth knowing: the route asks an indexer only about curves the registry already knows, so with an empty registry no query is issued at all and `chainsReachable` reads `0/0`. Reachability was therefore proven separately, by adding two throwaway registry rows locally to force the request — Base answered at block 50,862,947 in 334 ms and Arbitrum at 501,625,052 in 405 ms, both with `hasIndexingErrors: false` and zero curves, which is the correct answer for addresses that do not exist.

Nothing is published to the decentralized network. That is a separate decision, and publishing alone would not make the subgraph serve queries: issuance is distributed to indexers in proportion to curation signal, so a subgraph with a token amount of signal gives an indexer no reason to index it. The Graph's own recent GIPs state that the signal required and the indexing response it produces are unpredictable, which is why they are building direct indexing agreements. The Studio endpoints above serve queries today without any of that.

Two of the four chains cannot use Subgraph Studio at all, which is a property of The Graph and not a choice:

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
