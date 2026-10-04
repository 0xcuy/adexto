"use client";

import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { Fingerprint } from "lucide-react";
import { explorerNftUrl, readProvider, type ChainInfo } from "@/lib/chains";

/**
 * Lencana identitas agent ERC-8004, dibaca dari KONTRAK TOKEN, bukan dari registry situs.
 *
 * KENAPA DARI CHAIN
 *
 * Pengikatan ini dibuat oleh factory saat peluncuran, setelah ia memeriksa
 * `ownerOf(agentId) == msg.sender` di Identity Registry, lalu ditulis immutable ke token:
 * `agentBound`, `agentId`, `agentRegistry`. Itulah sumber kebenarannya. Registry situs
 * hanya menyalinnya, jadi lencana yang membaca salinan akan tetap tampil kalau salinannya
 * salah — persis kelas klaim yang tidak boleh ada di halaman ini.
 *
 * `agentBound` DIBACA LEBIH DULU, karena agent id 0 adalah agent sungguhan di setiap chain
 * kami. `agentId() == 0` tidak berarti "tanpa agent".
 *
 * Kegagalan baca (RPC sibuk, atau token tanpa fungsi ini) membuat lencana TIDAK tampil.
 * Tidak ada keadaan "mungkin terikat": yang tidak terbaca tidak diklaim.
 */
const TOKEN_AGENT_ABI = [
  "function agentBound() view returns (bool)",
  "function agentId() view returns (uint256)",
  "function agentRegistry() view returns (address)",
];

type Binding = { agentId: string; registry: string };

export default function AgentIdentityBadge({ chain, tokenAddress }: { chain: ChainInfo; tokenAddress: string }) {
  const [binding, setBinding] = useState<Binding | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBinding(null);
    (async () => {
      try {
        const token = new ethers.Contract(tokenAddress, TOKEN_AGENT_ABI, readProvider(chain));
        const bound: boolean = await token.agentBound();
        if (!bound) return;
        const [id, registry] = await Promise.all([token.agentId(), token.agentRegistry()]);
        if (!cancelled) setBinding({ agentId: (id as bigint).toString(), registry: String(registry) });
      } catch {
        // Tidak terbaca berarti tidak diklaim. Lihat catatan di atas.
      }
    })();
    return () => {
      cancelled = true;
    };
    // `chain` dikunci lewat chainId + rpcUrl: objeknya bisa dibuat ulang tiap render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain.chainId, chain.rpcUrl, tokenAddress]);

  if (!binding) return null;
  return (
    <a
      href={explorerNftUrl(chain, binding.registry, binding.agentId)}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="agent-identity-badge"
      title={`Bound at launch to ERC-8004 agent ${binding.agentId} in the Identity Registry ${binding.registry} on ${chain.name}. The factory checked that the launcher owned this agent; the binding is immutable on the token contract.`}
      // Tinggi dalam px (rem situs 14 px): 32 px di bawah lg supaya bisa diketuk, 22 px di desktop.
      // Ukuran ini sama dengan slot yang dipesan TokenTerminal, jadi lencana yang datang belakangan
      // tidak menggeser apa pun.
      className="inline-flex h-[32px] items-center gap-1 whitespace-nowrap rounded-lg border border-ok/30 bg-ok/10 px-2.5 text-[12px] font-bold text-ok hover:underline lg:h-[22px] lg:rounded lg:px-2"
    >
      <Fingerprint className="h-3 w-3" aria-hidden="true" /> ERC-8004 agent #{binding.agentId}
    </a>
  );
}
