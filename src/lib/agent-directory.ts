/**
 * Direktori ekonomi agen di ADEXTO: setiap pasar yang tokennya terikat ke agen ERC-8004, dengan
 * Agent Score-nya, plus agen yang kami operasikan dan aktivitas terbaru.
 *
 * Satu sumber untuk halaman `/agents` dan `GET /api/agents`, supaya angka di halaman dan di API
 * tidak pernah berbeda. Pengikatan dibaca dari kontrak token (bukan dari salinan registry, yang
 * kosong untuk pasar lama), jadi pasar yang diluncurkan siapa pun dengan agen terikat muncul di
 * sini tanpa langkah tambahan.
 */
import { listProjects, type ProjectRecord } from "@/lib/registry";
import { computeAgentScore, readBinding, recentActivity, SCORE_METHOD, type ActivityRow, type AgentScore } from "@/lib/agent-score";
import { OPERATED_AGENTS, agentOwner, isOurAddress, type OperatedAgent } from "@/lib/agent-identities";
import { resolveChainOrDefault, explorerNftUrl } from "@/lib/chains";
import { AGENT_REGISTRY_ADDRESS } from "@/lib/dex";

export interface DirectoryAgent extends OperatedAgent {
  owner: string | null;
  ownedByAdexto: boolean;
  chain: string;
  explorer: string;
  card: string;
}

export interface AgentDirectory {
  markets: AgentScore[];
  /** Pasar yang pengikatannya tidak terbaca saat ini (RPC), jadi tidak bisa dipastikan. */
  unreadable: Array<{ symbol: string; chainId: number }>;
  operatedAgents: DirectoryAgent[];
  activity: ActivityRow[];
  method: string;
  generatedAt: string;
}

export async function agentDirectory(): Promise<AgentDirectory> {
  const projects = listProjects();
  const bindings = await Promise.all(projects.map(async (p) => [p, await readBinding(p)] as const));
  const bound: ProjectRecord[] = [];
  const unreadable: Array<{ symbol: string; chainId: number }> = [];
  for (const [p, b] of bindings) {
    if (b) bound.push(p);
    else if (b === null) unreadable.push({ symbol: p.symbol, chainId: p.chainId });
  }

  const [markets, operatedAgents, activity] = await Promise.all([
    Promise.all(bound.map((p) => computeAgentScore(p))),
    Promise.all(
      OPERATED_AGENTS.map(async (a) => {
        const owner = await agentOwner(a.chainId, a.agentId);
        return {
          ...a,
          owner,
          ownedByAdexto: isOurAddress(owner),
          chain: resolveChainOrDefault(a.chainId).name,
          explorer: explorerNftUrl(a.chainId, AGENT_REGISTRY_ADDRESS, a.agentId),
          card: `https://adexto.xyz/api/agents/card?chainId=${a.chainId}&agentId=${a.agentId}`,
        };
      })
    ),
    recentActivity(bound, 20),
  ]);

  markets.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  return { markets, unreadable, operatedAgents, activity, method: SCORE_METHOD, generatedAt: new Date().toISOString() };
}
