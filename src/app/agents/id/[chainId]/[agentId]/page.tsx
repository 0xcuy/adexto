/**
 * /agents/id/[chainId]/[agentId] — kartu publik satu agen ERC-8004 (tujuan QR di kartu identitas).
 *
 * Berlaku untuk agen SIAPA PUN di Identity Registry chain itu, bukan hanya yang dibuat lewat `/agents/identity`.
 * Dibaca saat render: `ownerOf` dan `tokenURI` dari registry, lalu berkas registrasinya, lalu pasar ADEXTO yang tokennya
 * terikat ke agen ini (dari kontrak token, `readBinding`) beserta Agent Score-nya.
 *
 * KEAMANAN: `tokenURI` ditulis pemilik agen, siapa pun dia. Server hanya membaca `data:` dan `ipfs://` (lewat satu gateway
 * tetap), tidak pernah mengambil URL https sembarang dari server (itu SSRF ke jaringan internal). URL https ditampilkan
 * sebagai tautan saja. Gambar https dimuat browser pengunjung, bukan server. Teks English.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ethers } from "ethers";
import { IdCard, Rocket } from "lucide-react";
import { CHAIN_LIST, explorerAddressUrl, explorerNftUrl, readProvider, type ChainInfo } from "@/lib/chains";
import { AGENT_REGISTRY_ADDRESS, IDENTITY_REGISTRY_ABI } from "@/lib/dex";
import { listPublicProjects } from "@/lib/registry";
import { computeAgentScore, readBinding, type AgentScore } from "@/lib/agent-score";
import { isOurAddress } from "@/lib/agent-identities";
import { agentCard } from "@/lib/agent-card";
import { IPFS_GATEWAYS, ipfsToHttp } from "@/lib/agent-identity-file";
import PageHeader from "@/components/ui/PageHeader";
import AgentsNav from "@/components/agents/AgentsNav";
import IdentityCard from "@/components/agents/IdentityCard";
import { short } from "@/components/agents/format";

export const dynamic = "force-dynamic";

const REGISTRY_CHAINS = CHAIN_LIST.filter((c) => c.dexLive && c.curveFactoryAddress);
const MAX_FILE_BYTES = 64 * 1024;

interface Resolved {
  mode: "data" | "ipfs" | "https" | "other" | "empty";
  link: string | null;
  file: Record<string, unknown> | null;
  note: string | null;
}

/** Baca berkas registrasi tanpa pernah mengambil URL https buatan orang dari server. */
async function resolveFile(uri: string): Promise<Resolved> {
  if (!uri) return { mode: "empty", link: null, file: null, note: "This agent has no registration file." };
  if (uri.startsWith("data:")) {
    const m = /^data:application\/json(;charset=[^;,]+)?(;base64)?,(.*)$/s.exec(uri);
    if (!m) return { mode: "data", link: null, file: null, note: "The on-chain file is not JSON." };
    try {
      const text = m[2] ? Buffer.from(m[3], "base64").toString("utf8") : decodeURIComponent(m[3]);
      if (text.length > MAX_FILE_BYTES) return { mode: "data", link: null, file: null, note: "The on-chain file is too large to show." };
      return { mode: "data", link: null, file: JSON.parse(text), note: null };
    } catch {
      return { mode: "data", link: null, file: null, note: "The on-chain file could not be parsed." };
    }
  }
  if (uri.startsWith("ipfs://")) {
    const link = ipfsToHttp(uri);
    let note = "The file could not be read from IPFS right now.";
    for (const gw of IPFS_GATEWAYS) {
      try {
        const res = await fetch(ipfsToHttp(uri, gw), { signal: AbortSignal.timeout(6000), cache: "no-store" });
        if (!res.ok) {
          note = `The IPFS gateway answered ${res.status}.`;
          continue;
        }
        const text = await res.text();
        if (text.length > MAX_FILE_BYTES) return { mode: "ipfs", link, file: null, note: "The file is too large to show." };
        return { mode: "ipfs", link, file: JSON.parse(text), note: null };
      } catch {
        // gateway berikutnya
      }
    }
    return { mode: "ipfs", link, file: null, note };
  }
  // Kartu yang kami host sendiri dibaca langsung dari sumbernya, tanpa permintaan jaringan.
  const own = /^https:\/\/adexto\.xyz\/agents\/(\d+)\/(\d+)\/registration\.json$/.exec(uri);
  if (own) {
    const r = await agentCard(Number(own[1]), own[2]);
    return r.ok ? { mode: "https", link: uri, file: r.card, note: null } : { mode: "https", link: uri, file: null, note: r.detail };
  }
  if (/^https:\/\//i.test(uri)) return { mode: "https", link: uri, file: null, note: "The file is hosted on a website; open it to read it." };
  return { mode: "other", link: null, file: null, note: "The file uses an address this page does not read." };
}

/** Gambar yang boleh ditampilkan: ipfs (gateway), https, atau data URI raster. */
function displayImage(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  if (v.startsWith("ipfs://")) return ipfsToHttp(v);
  if (/^https:\/\//i.test(v) && v.length < 2048) return v;
  if (/^data:image\/(png|jpeg|webp);base64,/.test(v) && v.length < 300_000) return v;
  return null;
}

async function load(chainIdRaw: string, agentIdRaw: string) {
  const chain: ChainInfo | undefined = REGISTRY_CHAINS.find((c) => c.chainId === Number(chainIdRaw));
  if (!chain || !/^\d{1,78}$/.test(agentIdRaw)) return null;
  const agentId = agentIdRaw.replace(/^0+(?=\d)/, "");
  const registry = new ethers.Contract(AGENT_REGISTRY_ADDRESS, IDENTITY_REGISTRY_ABI, readProvider(chain));
  let owner: string | null = null;
  let readError: string | null = null;
  try {
    owner = String(await registry.ownerOf(agentId));
  } catch (e) {
    // Revert = id belum pernah dibuat di chain ini. Galat lain = RPC; halaman tetap tampil dan mengatakannya.
    if ((e as { code?: string }).code === "CALL_EXCEPTION") return { chain, agentId, missing: true as const };
    readError = "The Identity Registry could not be read right now.";
  }
  let uri = "";
  if (owner) {
    try {
      uri = String(await registry.tokenURI(agentId));
    } catch {
      readError = "The registration file address could not be read right now.";
    }
  }
  const resolved = owner ? await resolveFile(uri) : null;
  const projects = listPublicProjects().filter((p) => p.chainId === chain.chainId);
  const bound = (await Promise.all(projects.map(async (p) => ((await readBinding(p))?.agentId === agentId ? p : null)))).filter(
    (p): p is NonNullable<typeof p> => p !== null
  );
  const markets: AgentScore[] = await Promise.all(bound.map((p) => computeAgentScore(p)));
  markets.sort((a, b) => b.score - a.score);
  return { chain, agentId, missing: false as const, owner, uri, resolved, markets, readError };
}

type Params = { params: Promise<{ chainId: string; agentId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { chainId, agentId } = await params;
  const chain = REGISTRY_CHAINS.find((c) => c.chainId === Number(chainId));
  return {
    title: `Agent #${agentId}${chain ? ` on ${chain.name}` : ""} — ADEXTO`,
    description: "An ERC-8004 agent identity, its owner and registration file read from the chain, and the ADEXTO markets bound to it.",
  };
}

export default async function AgentIdPage({ params }: Params) {
  const { chainId, agentId } = await params;
  const d = await load(chainId, agentId);
  if (!d) notFound();
  const { chain } = d;

  if (d.missing) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <AgentsNav current="/agents/identity" />
        <PageHeader kicker="Agents · identity" kickerIcon={IdCard} title={`No agent #${d.agentId} on ${chain.name}`} subtitle="The Identity Registry on this chain has no agent with this id. Agent ids are per chain: the same number can belong to another agent, or to nobody, on a different chain." className="mb-8" />
        <Link href="/agents/identity" className="font-semibold text-accent hover:underline">Create an agent ID</Link>
      </div>
    );
  }

  const file = d.resolved?.file ?? null;
  const name = typeof file?.name === "string" ? file.name.slice(0, 64) : "";
  const description = typeof file?.description === "string" ? file.description.slice(0, 400) : "";
  const services = Array.isArray(file?.services) ? (file!.services as Array<Record<string, unknown>>).slice(0, 8) : [];
  const ownerIsUs = isOurAddress(d.owner);
  const card = {
    chainId: chain.chainId,
    chainName: chain.name,
    name: name || `Agent #${d.agentId}`,
    description,
    image: displayImage(file?.image),
    agentId: d.agentId,
    owner: d.owner,
    ownerNote: ownerIsUs ? "ADEXTO wallet" : null,
    registry: AGENT_REGISTRY_ADDRESS,
    markets: d.markets.map((m) => ({ symbol: m.symbol, score: m.score })),
    cardUrl: `https://adexto.xyz/agents/id/${chain.chainId}/${d.agentId}`,
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
      <AgentsNav current="/agents/identity" />
      <PageHeader
        kicker={`Agents · identity · ${chain.name}`}
        kickerIcon={IdCard}
        title={name || `Agent #${d.agentId}`}
        subtitle={`ERC-8004 (draft) agent #${d.agentId} on ${chain.name}. Owner and registration file are read from the Identity Registry when this page loads.`}
        className="mb-8"
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="space-y-3">
          <IdentityCard data={card} />
          {d.readError && <p className="text-[13px] text-warn">{d.readError}</p>}
        </div>
        <div className="space-y-5 min-w-0">
          <dl className="space-y-3 text-[14px]">
            <div>
              <dt className="text-[12px] uppercase tracking-wider text-ink-faint">Owner</dt>
              <dd>
                {d.owner ? (
                  <a href={explorerAddressUrl(chain, d.owner)} target="_blank" rel="noreferrer" className="inline-flex min-h-[32px] items-center font-mono text-ink hover:text-accent">{short(d.owner)}</a>
                ) : (
                  <span className="text-ink-faint">not readable</span>
                )}
                {ownerIsUs && <span className="text-ink-faint"> · ADEXTO wallet</span>}
              </dd>
            </div>
            <div>
              <dt className="text-[12px] uppercase tracking-wider text-ink-faint">Identity Registry</dt>
              <dd>
                <a href={explorerNftUrl(chain, AGENT_REGISTRY_ADDRESS, d.agentId)} target="_blank" rel="noreferrer" className="inline-flex min-h-[32px] items-center font-mono text-ink hover:text-accent">
                  eip155:{chain.chainId}:{short(AGENT_REGISTRY_ADDRESS)}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-[12px] uppercase tracking-wider text-ink-faint">Registration file</dt>
              <dd className="text-ink-soft">
                {d.resolved?.mode === "data" ? "Stored on-chain in the agent URI" : d.resolved?.mode === "ipfs" ? "IPFS" : d.resolved?.mode === "https" ? "A website" : "—"}
                {d.resolved?.link && (
                  <>
                    {" · "}
                    <a href={d.resolved.link} target="_blank" rel="noreferrer" className="inline-flex min-h-[32px] items-center text-accent hover:underline">open</a>
                  </>
                )}
                {d.resolved?.note && <div className="text-[12px] text-ink-faint">{d.resolved.note}</div>}
              </dd>
            </div>
            {services.length > 0 && (
              <div>
                <dt className="text-[12px] uppercase tracking-wider text-ink-faint">Services in the file</dt>
                <dd>
                  <ul className="space-y-1">
                    {services.map((s, i) => (
                      <li key={i} className="text-[13px] text-ink-soft break-all">
                        <span className="font-semibold text-ink">{String(s.name ?? "service").slice(0, 24)}</span>{" "}
                        <span className="font-mono">{String(s.endpoint ?? "").slice(0, 200)}</span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
          </dl>
          <p className="text-[12px] leading-relaxed text-ink-faint">
            The name, description and image come from the registration file, which the holder of this agent can update. A token that
            recorded this agent at launch keeps it for good.
          </p>
        </div>
      </div>

      <section className="section-block mt-10 space-y-4" id="markets">
        <h2 className="text-[20px] font-semibold text-ink tracking-tight">Markets launched with this agent</h2>
        {d.markets.length === 0 ? (
          <div className="space-y-3 text-[14px] text-ink-soft">
            <p>No listed ADEXTO market on {chain.name} is bound to this agent yet.</p>
            <Link href={`/agents?chain=${chain.chainId}&agentId=${d.agentId}#launch`} className="inline-flex items-center gap-1.5 font-semibold text-accent hover:underline">
              <Rocket className="h-4 w-4" aria-hidden="true" /> Launch a market with this agent
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-card border border-line">
            <table className="w-full text-left text-[13px] [&_td]:whitespace-nowrap">
              <thead className="bg-cream-2 text-[12px] uppercase tracking-wider text-ink-faint">
                <tr>
                  <th scope="col" className="px-3 py-2">Market</th>
                  <th scope="col" className="px-3 py-2">Agent Score</th>
                  <th scope="col" className="px-3 py-2">Outside traders</th>
                  <th scope="col" className="px-3 py-2">Outside holders</th>
                </tr>
              </thead>
              <tbody>
                {d.markets.map((m) => (
                  <tr key={m.token} className="border-t border-line">
                    <td className="px-3 py-2">
                      <Link href={`/token/${m.symbol.toLowerCase()}?chain=${m.chainId}`} className="inline-flex min-h-[32px] items-center font-semibold text-ink hover:text-accent">${m.symbol}</Link>
                    </td>
                    <td className="px-3 py-2"><span className="font-semibold text-ink" data-numeric>{m.score}</span><span className="text-ink-faint">/100</span></td>
                    <td className="px-3 py-2" data-numeric>{m.evidence.outsideTraders}</td>
                    <td className="px-3 py-2" data-numeric>{m.evidence.outsideHolders}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[12px] text-ink-faint">
          Agent Score is per market, from on-chain evidence, with ADEXTO&apos;s own wallets excluded. It measures adoption and launch
          facts, not quality. <Link href="/agents/markets#score" className="text-accent hover:underline">How it is computed</Link>
        </p>
      </section>
    </div>
  );
}
