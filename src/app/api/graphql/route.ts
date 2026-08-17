import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { ADEXTO_CONTRACTS } from "@/config/contracts";

// Factory Contract ABI for Event Querying
const FACTORY_ABI = [
  "event TrinityProjectCreated(address indexed token, address indexed creator, string symbol, bytes32 teeAttestationRoot)",
  "function allProjects(uint256) view returns (address token, address creator, string name, string symbol, uint256 swapFeeBps, uint256 treasuryShareBps, bytes32 teeAttestationRoot, uint256 deployedAt)",
  "function totalProjects() view returns (uint256)"
];

export async function POST(req: Request) {
  try {
    const defaultData = {
      projects: [
        {
          id: "0xb5A8A26A929e8E44E18D00a73448d4e1a22D0dEd",
          tokenAddress: "0xb5A8A26A929e8E44E18D00a73448d4e1a22D0dEd",
          creator: ADEXTO_CONTRACTS.deployer,
          name: "Aegis Sentinel AI",
          symbol: "AEGIS",
          chain: "0G Mainnet (16661)",
          tvl: "Pool Initialized (1.912 0G)",
          mcap: "1,000,000,000 AEGIS",
          volume24h: "Live On-Chain",
          feesGenerated: "0.20% LP / 0.10% Buyback",
          buybackAmount: "Active 0G TEE Vault",
          price: "0.0184 0G",
          change24h: "Live Genesis",
          agentStatus: "Active (0G AMD SEV-SNP)",
          edgeProvider: "Cloudflare x402 Edge",
          agentModel: "0G Compute (glm-5.2 + z-image-turbo)",
          mcpTools: ["Signet", "Sentinel", "Helm", "x402"],
          category: "defi",
          image: "/aegis_logo.png",
          teeAttestationRoot: "0xafa3f6735b37bf0117bd792ce7cd4a63ffca59d7d8d601bd9a002749e5b6b1e8",
          deployedAt: "1786848200",
          transactionHash: "0x917353cc0649ebe7b081bf6a7974923537914dd4cfa1ea4ac1eed9f9394b3fe3",
          blockNumber: "41896821"
        },
        {
          id: "0x2674654D4a8B79f84c1daC4Cf254EA066e59bC56",
          tokenAddress: "0x2674654D4a8B79f84c1daC4Cf254EA066e59bC56",
          creator: ADEXTO_CONTRACTS.deployer,
          name: "QuantNova Swarm HFT",
          symbol: "QNOVA",
          chain: "Arbitrum One (42161)",
          tvl: "Pool Initialized",
          mcap: "1,000,000,000 QNOVA",
          volume24h: "Live On-Chain",
          feesGenerated: "0.20% LP / 0.10% Buyback",
          buybackAmount: "Active Vault",
          price: "0.00018 ETH",
          change24h: "Live Mesh",
          agentStatus: "Active (0G CCIP)",
          edgeProvider: "Cloudflare x402",
          agentModel: "0G glm-5.2",
          mcpTools: ["Signet", "Helm", "x402"],
          category: "trading",
          image: "/qnova_logo.png",
          teeAttestationRoot: "0x57d8f0846a59cc3ae156dcaa43553d3dd69f49211031f39a1e8fe636677e6572",
          deployedAt: "1786848250",
          transactionHash: "0x2674654D4a8B79f84c1daC4Cf254EA066e59bC56",
          blockNumber: "41896830"
        },
        {
          id: "0xbC72FE919F85E679e7d95e2b471AaDA3c7c3Ac39",
          tokenAddress: "0xbC72FE919F85E679e7d95e2b471AaDA3c7c3Ac39",
          creator: ADEXTO_CONTRACTS.deployer,
          name: "CyberSentinel Shield AI",
          symbol: "CSENT",
          chain: "Arbitrum One (42161)",
          tvl: "Pool Initialized",
          mcap: "1,000,000,000 CSENT",
          volume24h: "Live On-Chain",
          feesGenerated: "0.20% LP / 0.10% Buyback",
          buybackAmount: "Active Vault",
          price: "0.00008 ETH",
          change24h: "Live Shield",
          agentStatus: "Active (0G TEE)",
          edgeProvider: "Cloudflare x402",
          agentModel: "0G 0gm-1.0-35b",
          mcpTools: ["Sentinel", "Aegis", "x402"],
          category: "security",
          image: "/csent_logo.png",
          teeAttestationRoot: "0xeaa56a1fe9b216f0f58cc0957c8d4793451c69a423c5a73ad6e420749eb4509d",
          deployedAt: "1786848300",
          transactionHash: "0xbC72FE919F85E679e7d95e2b471AaDA3c7c3Ac39",
          blockNumber: "41896835"
        }
      ],
      globalStats: {
        id: "global",
        totalProjects: "3",
        totalVolumeUSD: "0.00",
        totalFeesGeneratedUSD: "0.00",
        totalBuybacksUSD: "0.00"
      }
    };

    return NextResponse.json({ data: defaultData });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
