"use client";

/**
 * `/agents/identity`: buat kartu identitas agen ERC-8004 dari wallet sendiri.
 *
 * Form di kiri, kartu di kanan yang terisi saat mengetik (kanvas kosong → kartu). Register = `register(uri)` dikirim
 * wallet pengguna ke Identity Registry chain yang dipilih; id dibaca dari event mint (bukan `totalSupply`, lihat
 * Studio `handleCreateAgent`). Sesudah itu kartu memuat barcode `chainId:agentId` dan QR ke kartu publik.
 *
 * Identitas berlaku PER CHAIN (registry sama alamatnya di lima chain, state terpisah) dan hanya bisa dipakai untuk
 * peluncuran BERIKUTNYA: binding di token yang sudah ada tidak bisa diubah. Teks English (aturan bahasa repo).
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { CheckCircle2, ExternalLink, ImagePlus, Loader2, Rocket, Sparkles, Trash2 } from "lucide-react";
import { CHAIN_LIST, explorerTxUrl, type ChainInfo } from "@/lib/chains";
import { AGENT_REGISTRY_ADDRESS, describeTxError, ensureWalletChain } from "@/lib/dex";
import { getActiveEip1193 } from "@/lib/wallet-provider";
import { useWallet } from "@/context/WalletContext";
import { readSquareLogoFile } from "@/lib/logo-upload";
import { ACCEPT_ATTR, LOGO_PX } from "@/lib/logo-image";
import Button from "@/components/ui/Button";
import IdentityCard from "@/components/agents/IdentityCard";

const REGISTRY_CHAINS = CHAIN_LIST.filter((c) => c.dexLive && c.curveFactoryAddress);
const NAME_MAX = 64;
const DESCRIPTION_MAX = 400;

const fieldClass =
  "mt-1 block w-full min-h-[40px] rounded-lg border border-line bg-surface px-3 text-[14px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none";

type Step = "idle" | "preparing" | "signing" | "mining";
interface Registered {
  chainId: number;
  agentId: string;
  txHash: string;
  owner: string;
  uriMode: "ipfs" | "data";
}

/** Gambar apa pun (PNG/JPEG/WebP/SVG data URI) → PNG persegi LOGO_PX, supaya yang di-pin selalu raster kecil. */
async function toSquarePng(src: string): Promise<string> {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = LOGO_PX;
  c.height = LOGO_PX;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, LOGO_PX, LOGO_PX);
  return c.toDataURL("image/png");
}

export default function IdentityStudio() {
  const { address, isConnected, connectWallet, walletChainId } = useWallet();
  const [chainId, setChainId] = useState<number>(REGISTRY_CHAINS[0]?.chainId ?? 143);
  const [touchedChain, setTouchedChain] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [imageSource, setImageSource] = useState<"generated" | "procedural" | "uploaded" | null>(null);
  const [imageBusy, setImageBusy] = useState<"generate" | "upload" | null>(null);
  const [imageNote, setImageNote] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Registered | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const chain: ChainInfo = REGISTRY_CHAINS.find((c) => c.chainId === chainId) ?? REGISTRY_CHAINS[0];

  // Ikut chain wallet sampai pengguna memilih sendiri.
  useEffect(() => {
    if (!touchedChain && walletChainId && REGISTRY_CHAINS.some((c) => c.chainId === walletChainId)) setChainId(walletChainId);
  }, [walletChainId, touchedChain]);

  // Isian berubah sesudah terdaftar → kartu kembali menjadi pratinjau identitas baru.
  const editing = useRef(false);
  useEffect(() => {
    if (editing.current && done) setDone(null);
    editing.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, description, website, image, chainId]);

  const ready = isConnected && Boolean(address) && name.trim().length > 0 && description.trim().length > 0 && !imageBusy;
  const busy = step !== "idle";

  async function generateImage() {
    setImageBusy("generate");
    setImageNote(null);
    setError(null);
    try {
      const res = await fetch("/api/generate-logo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenName: name.trim() || "AI agent", description: description.trim(), persona: description.trim() }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.imageUrl) throw new Error(j?.error || `Image generation did not answer (HTTP ${res.status}).`);
      setImage(await toSquarePng(j.imageUrl));
      setImageSource(j.generated ? "generated" : "procedural");
      if (!j.generated) setImageNote("The image model was unavailable, so a simple generated mark is used. You can upload your own.");
    } catch (e) {
      setImageNote((e as Error).message);
    } finally {
      setImageBusy(null);
    }
  }

  async function uploadImage(file: File | null) {
    if (!file) return;
    setImageBusy("upload");
    setImageNote(null);
    try {
      const r = await readSquareLogoFile(file);
      if (!r.ok) {
        setImageNote(r.reason);
        return;
      }
      setImage(await toSquarePng(r.value));
      setImageSource("uploaded");
    } finally {
      setImageBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function register() {
    if (!isConnected || !address) {
      await connectWallet();
      return;
    }
    setError(null);
    setStep("preparing");
    try {
      const res = await fetch("/api/agents/identity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chainId: chain.chainId, owner: address, name, description, website, image: image ?? "" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.uri) throw new Error(data?.error || `The identity file could not be prepared (HTTP ${res.status}).`);

      setStep("signing");
      const ethereum = getActiveEip1193();
      await ensureWalletChain(ethereum, chain);
      const signer = await new ethers.BrowserProvider(ethereum).getSigner();
      const from = await signer.getAddress();
      if (from.toLowerCase() !== address.toLowerCase()) throw new Error("The wallet's active account changed. Reconnect and try again.");
      const registry = new ethers.Contract(
        data.registry,
        ["function register(string agentURI) returns (uint256)", "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"],
        signer
      );
      const tx = await registry.register(data.uri);
      setStep("mining");
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) throw new Error("The registration transaction reverted.");
      const iface = new ethers.Interface(["event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"]);
      let id: bigint | null = null;
      for (const log of receipt.logs) {
        if (String(log.address).toLowerCase() !== String(data.registry).toLowerCase()) continue;
        try {
          const p = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (p?.name === "Transfer" && p.args.from === ethers.ZeroAddress && String(p.args.to).toLowerCase() === from.toLowerCase()) id = p.args.tokenId as bigint;
        } catch {
          // bukan event registry
        }
      }
      if (id === null) {
        // Transaksi sukses tapi id tidak terbaca: jangan menebak, id yang salah akan terikat permanen di peluncuran.
        throw new Error(`Registered in ${tx.hash}, but the new agent id could not be read. Open the transaction on ${chain.blockExplorer} to find it.`);
      }
      setDone({ chainId: chain.chainId, agentId: id.toString(), txHash: tx.hash, owner: from, uriMode: data.uriMode });
    } catch (e) {
      setError(describeTxError(e, chain));
    } finally {
      setStep("idle");
    }
  }

  // QR selalu menunjuk alamat kanonik, sama dengan kartu publik (bukan origin lokal saat uji).
  const origin = "https://adexto.xyz";
  const cardData = useMemo(
    () => ({
      chainId: chain.chainId,
      chainName: chain.name,
      name,
      description,
      image,
      agentId: done?.agentId ?? null,
      owner: done?.owner ?? address ?? null,
      ownerNote: address ? "your wallet" : null,
      registry: AGENT_REGISTRY_ADDRESS,
      markets: done ? [] : null,
      cardUrl: done ? `${origin}/agents/id/${done.chainId}/${done.agentId}` : null,
    }),
    [chain, name, description, image, done, address, origin]
  );

  const stepLabel: Record<Step, string> = {
    idle: "Register agent ID",
    preparing: "Preparing the identity file…",
    signing: "Confirm in your wallet…",
    mining: "Waiting for the block…",
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* Kartu: di atas pada ponsel, di kanan (lengket) pada desktop. */}
      <div className="order-first lg:order-last">
        <div className="lg:sticky lg:top-24 space-y-3">
          <IdentityCard data={cardData} preview />
          <p className="text-[12px] leading-relaxed text-ink-faint">
            Preview. The barcode encodes <span className="font-mono">chain:agent id</span> and the QR opens the public card; both
            appear once the agent is registered.
          </p>
        </div>
      </div>

      <form
        className="glass-panel rounded-card p-5 space-y-5"
        aria-label="Agent identity"
        onSubmit={(e) => {
          e.preventDefault();
          void register();
        }}
      >
        <div>
          <label htmlFor="id-chain" className="text-[13px] font-semibold text-ink">Chain</label>
          <select
            id="id-chain"
            className={fieldClass}
            value={chainId}
            onChange={(e) => {
              setTouchedChain(true);
              setChainId(Number(e.target.value));
            }}
          >
            {REGISTRY_CHAINS.map((c) => (
              <option key={c.chainId} value={c.chainId}>{c.name}</option>
            ))}
          </select>
          <p className="mt-1 text-[12px] text-ink-faint">An agent ID lives on one chain. Register again to use it on another chain.</p>
        </div>

        <div>
          <label htmlFor="id-name" className="text-[13px] font-semibold text-ink">Agent name</label>
          <input id="id-name" className={fieldClass} value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="Signal Desk" autoComplete="off" />
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="id-description" className="text-[13px] font-semibold text-ink">What it does</label>
            <span className="text-[12px] text-ink-faint" data-numeric>{description.length}/{DESCRIPTION_MAX}</span>
          </div>
          <textarea
            id="id-description"
            className={`${fieldClass} min-h-[96px] py-2`}
            value={description}
            maxLength={DESCRIPTION_MAX}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Reads on-chain flows and launches markets for the signals it trades."
          />
        </div>

        <div>
          <span className="text-[13px] font-semibold text-ink">Image</span>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => void generateImage()} disabled={imageBusy !== null || busy}>
              {imageBusy === "generate" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
              Generate
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={imageBusy !== null || busy}>
              {imageBusy === "upload" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
              Upload
            </Button>
            {image && (
              <Button type="button" variant="ghost" size="sm" onClick={() => { setImage(null); setImageSource(null); setImageNote(null); }} disabled={busy}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Remove
              </Button>
            )}
            <input ref={fileRef} type="file" accept={ACCEPT_ATTR} className="hidden" aria-label="Upload an agent image" onChange={(e) => void uploadImage(e.target.files?.[0] ?? null)} />
          </div>
          <p className="mt-1 text-[12px] text-ink-faint">
            {imageSource === "generated"
              ? `Generated on the 0G router from the name and description · ${LOGO_PX}×${LOGO_PX}`
              : imageSource === "uploaded"
                ? `Your image, resized to ${LOGO_PX}×${LOGO_PX}`
                : imageSource === "procedural"
                  ? "Simple generated mark"
                  : "Optional. Square PNG, JPEG or WebP. Stored on IPFS when you register."}
          </p>
          {imageNote && <p className="mt-1 text-[12px] text-warn">{imageNote}</p>}
        </div>

        <div>
          <label htmlFor="id-website" className="text-[13px] font-semibold text-ink">
            Website <span className="font-normal text-ink-faint">(optional)</span>
          </label>
          <input id="id-website" className={fieldClass} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" inputMode="url" autoComplete="off" spellCheck={false} />
        </div>

        <Button type="submit" variant="primary" fullWidth disabled={busy || (isConnected && !ready)}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {isConnected ? stepLabel[step] : "Connect wallet"}
        </Button>
        <p className="text-[12px] leading-relaxed text-ink-faint">
          Your wallet sends one transaction to the ERC-8004 (draft) Identity Registry on {chain.name} and pays the gas in{" "}
          {chain.nativeSymbol}. The agent ID is an NFT owned by that wallet; ADEXTO never holds it.
        </p>

        <div aria-live="polite" data-testid="identity-result">
          {error && <p className="text-[13px] text-danger">{error}</p>}
          {done && (
            <div className="space-y-3 rounded-xl border border-ok/40 bg-ok/10 p-4 text-[14px] text-ink">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-5 w-5 text-ok" aria-hidden="true" />
                Agent #{done.agentId} is registered on {chain.name}.
              </div>
              <ul className="space-y-1.5 text-[13px]">
                <li>
                  <Link href={`/agents/id/${done.chainId}/${done.agentId}`} className="font-semibold text-accent hover:underline">Open the public card</Link>
                </li>
                <li>
                  <a href={explorerTxUrl(chain, done.txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                    View the transaction <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </li>
                <li>
                  <Link href={`/agents?chain=${done.chainId}&agentId=${done.agentId}#launch`} className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
                    <Rocket className="h-3.5 w-3.5" aria-hidden="true" /> Launch a market with this ID
                  </Link>
                </li>
              </ul>
              <p className="text-[12px] text-ink-soft">
                Use agent id <span className="font-mono">{done.agentId}</span> on your next launches on {chain.name}, from this wallet. In
                Studio, turn on &ldquo;Bind an ERC-8004 agent identity&rdquo; and enter it. Markets that are already live cannot be
                bound afterwards.
              </p>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
