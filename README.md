<p align="center">
  <img src="Banner/banner 1.png" alt="ADEXTO Protocol Banner" width="100%" />
</p>

# ADEXTO Protocol (`adexto.xyz`)
> **Autonomous Decentralized EXchange & Token Orchestrator**  
> *Production Web3 Infrastructure binding ERC-8004 Agent Tokens, Uniswap v4 Sovereign Hooks, 0G TEE Compute, and Cloudflare Workers x402 Edge Monetization.*

[![Website](https://img.shields.io/badge/Website-adexto.xyz-00F5FF?style=for-the-badge&logo=google-chrome&logoColor=black)](https://adexto.xyz)
[![0G Mainnet](https://img.shields.io/badge/0G_Mainnet-Chain_16661-7C3AED?style=for-the-badge&logo=ethereum&logoColor=white)](https://chainscan.0g.ai)
[![The Graph Studio](https://img.shields.io/badge/The_Graph-Studio_Live_v1.0.0-EC4899?style=for-the-badge&logo=graphql&logoColor=white)](https://thegraph.com/studio/subgraph/adexto-protocol)
[![Edge x402](https://img.shields.io/badge/Cloudflare_Edge-x402_Active-F97316?style=for-the-badge&logo=cloudflare&logoColor=white)](https://adexto-x402-edge.cucuvirtual.workers.dev)

---

## ⚡ Architecture & Real-Time Flow

```mermaid
graph TD
    User([👤 Creator / Human]) -->|1. ZKP Proof of Humanity| WorldID[🛡️ World ID Anti-Sybil Gate]
    WorldID -->|2. Verified 1-Click Launch| Factory[🏭 AdextoTrinityFactory.sol<br/>0xe8E9Cf43f88D065892c35c4aDa002C7B8b11F3e0]
    
    subgraph "Atomic Trinity Lifecycle"
        Factory -->|Deploy Token| Token[🪙 ERC-8004 Token<br/>Anti-Sniper Protected]
        Factory -->|Deploy AMM| Hook[🦄 SovereignHook.sol<br/>0x592c697aD1Fa712c6701C90991B96264aB2E98d8]
        Factory -->|Spawn Enclave| Enclave[🤖 0G TEE Agent Enclave<br/>AMD SEV-SNP Isolated]
    end
    
    subgraph "Sovereign Liquidity & Revenue Mesh"
        Hook -->|0.20% Swap Fee| LP[💧 Liquidity Providers]
        Hook -->|0.10% Swap Cut| Treasury[🏦 Agent Buyback Vault]
        ExternalClient([💻 External Machine / Bot]) -->|HTTP 402 / EIP-712| Edge[⚡ Cloudflare Workers x402<br/>Sub-35ms Global Gateway]
        Edge -->|Micropayment Inflow| Treasury
        Treasury -->|Automated Market Buyback| Token
    end
    
    subgraph "Verifiable Indexing & Storage"
        Factory -.->|Live Event Indexing| Subgraph[📊 The Graph Subgraph v1.0.0<br/>GraphQL Studio Decentralized]
        Enclave -.->|Attestation Anchoring| 0GDA[📦 0G DA Storage Turbo<br/>Root: 0xeaa56a... / Tx: 0xcfac6cd4...]
    end

    subgraph "Phase 2 Governance & Cross-Chain"
        Token -->|Voting Weight| Gov[🏛️ AdextoGovernor.sol<br/>0x5045b117dDF788078c535f37837fDB6384da034d]
        Treasury -.->|CCIP Cross-Chain Signals| CCIP[🌐 Chainlink CCIP Mesh<br/>Base 8453 ↔ 0G 16661 ↔ Arb 42161]
    end

    classDef primary fill:#070b16,stroke:#00F5FF,stroke-width:2px,color:#fff;
    classDef hook fill:#140826,stroke:#9333EA,stroke-width:2px,color:#fff;
    classDef edge fill:#1e0d04,stroke:#F97316,stroke-width:2px,color:#fff;
    classDef success fill:#041a12,stroke:#10B981,stroke-width:2px,color:#fff;
    
    class Factory,Token primary;
    class Hook,Gov hook;
    class Edge edge;
    class Subgraph,0GDA success;
```

---

<p align="center">
  <img src="Banner/banner 2.png" alt="ADEXTO Full Ecosystem" width="100%" />
</p>

---

## 🏛️ Verified On-Chain Deployments (0G Mainnet - Chain ID 16661)

| Smart Contract / Service | Verified Address / Endpoint | Status |
|---|---|---|
| **AdextoTrinityFactory** | [`0xe8E9Cf43f88D065892c35c4aDa002C7B8b11F3e0`](https://chainscan.0g.ai/address/0xe8E9Cf43f88D065892c35c4aDa002C7B8b11F3e0) | ✅ Live On-Chain |
| **SovereignHook (Uniswap v4)** | [`0x592c697aD1Fa712c6701C90991B96264aB2E98d8`](https://chainscan.0g.ai/address/0x592c697aD1Fa712c6701C90991B96264aB2E98d8) | ✅ Live On-Chain |
| **AdextoGovernor (DAO Phase 2)** | [`0x5045b117dDF788078c535f37837fDB6384da034d`](https://chainscan.0g.ai/address/0x5045b117dDF788078c535f37837fDB6384da034d) | ✅ Live On-Chain |
| **AdextoCCIPReceiver (Mesh)** | [`0xaD0C7BFF5aDfeb01C3DaF2bF8C85414FE4D47Ab4`](https://chainscan.0g.ai/address/0xaD0C7BFF5aDfeb01C3DaF2bF8C85414FE4D47Ab4) | ✅ Live On-Chain |
| **0G DA Storage Turbo** | Root: `0xeaa56a1fe9b216f0f58cc0957c8d4793451c69a423c5a73ad6e420749eb4509d`<br>Tx: [`0xcfac6cd4...`](https://chainscan.0g.ai/tx/0xcfac6cd412f69cefeb2d509edf5dbdeef5dc0fb4613932223b99a4ce535b8c55) | ✅ Anchored |
| **The Graph Network** | Published on Arbitrum One Mainnet (ID: `DdSBjB...RjQv`)<br>[`Explorer Link`](https://thegraph.com/explorer/subgraphs/DdSBjB19RrovZJbpcbXwgTRtDUTRppTWwMsVznjARjQv?view=Query&chain=arbitrum-one) | ✅ Published to Decentralized Network |
| **Cloudflare Worker x402** | [`https://adexto-x402-edge.cucuvirtual.workers.dev`](https://adexto-x402-edge.cucuvirtual.workers.dev) | ✅ Edge Active (<35ms) |
| **Official Signer Wallet** | `0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D` | ✅ Hardware Attested |

---

## 🚀 Key Value Propositions

1. **1-Click Atomic Trinity**: In a single transaction, launch an ERC-8004 token, Uniswap v4 Sovereign Hook AMM, and 24/7 0G TEE Agent Enclave.
2. **0% Protocol Rent-Seeking**: 100% of trading fees remain in the creator ecosystem (0.20% LP Rewards / 0.10% Buyback Vault).
3. **Hardware-Enforced Anti-Rug**: Agent logic and keys run strictly within AMD SEV-SNP enclaves on 0G Compute.
4. **Machine-to-Machine Micro-billing**: Cloudflare Workers x402 edge paywall monetizes API queries, continuously feeding the buyback loop.
5. **Anti-Sybil Proof of Humanity**: World ID ZKP integration prevents bot snipers during initial curve launches.

---

## 🛠️ Local Development & Quickstart

```bash
# 1. Clone repository
git clone https://github.com/0xcuy/adexto.git
cd adexto

# 2. Install dependencies
npm install

# 3. Setup environment
cp .env.example .env.local

# 4. Start local development server
npm run dev
# Open http://localhost:3000
```

---

## 📄 License
MIT License © 2026 ADEXTO Core Contributors (`adexto.xyz`).
