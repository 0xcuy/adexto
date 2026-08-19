"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import {
  Cpu, RefreshCw, Sparkles, ShieldCheck, Globe, Send, Bot, ChevronDown,
  Lock, CheckCircle2, AlertTriangle, Wand2, Dices, XCircle, Info, Droplets, Fingerprint,
} from "lucide-react";
import dynamic from "next/dynamic";

import { useWallet } from "@/context/WalletContext";
import { FormattedMarkdown } from "@/components/FormattedMarkdown";
import { CHAIN_LIST, type ChainInfo } from "@/lib/chains";
import { FACTORY_V3_ABI, describeTxError, ensureWalletChain } from "@/lib/dex";
import { getActiveEip1193 } from "@/lib/wallet-provider";
import { formatSmallNumber } from "@/lib/pricing";
import { OPENING_MARKET_CAP_USD, openingVirtualNative } from "@/lib/native-price";

/**
 * `@worldcoin/idkit` menarik Tailwind sebagai dependensi runtime, jadi ia dimuat
 * dinamis dan tanpa SSR: chunk-nya baru diunduh ketika gerbang World ID memang
 * menyala di deployment ini.
 */
const WorldIdVerifyButton = dynamic(() => import("@/components/WorldIdVerifyButton"), { ssr: false });

/**
 * Launch console.
 *
 * Rebuilt around four audit findings:
 *   1. `/api/deploy` invented the token address with `Math.random()`. The address is
 *      now read from the `TrinityProjectDeployed` receipt event and verified
 *      server-side before the project is registered.
 *   2. A rejected on-chain transaction was swallowed by `console.warn` and the UI
 *      still printed "Deployment Succeeded" with a fake address. Failures are now
 *      surfaced per chain and never produce a success screen on their own.
 *   3. The button claimed "Deploy across 4 Chains" while `factoryAddress` was a
 *      two-way ternary, so Base and Monad were never touched. Each selected chain
 *      now gets its own transaction, and chains without a v2 factory are shown as
 *      unavailable instead of being silently skipped.
 *   4. The "World ID Proof of Humanity" gate was a plain `personal_sign` with no
 *      server verification. It is now labelled as address attestation and the
 *      signature is verified server-side.
 */

type DeployStatus = "pending" | "signing" | "confirming" | "registering" | "success" | "failed" | "skipped";

interface ChainResult {
  chainKey: string;
  chainName: string;
  chainId: number;
  status: DeployStatus;
  message?: string;
  txHash?: string;
  tokenAddress?: string;
  poolAddress?: string;
  explorerTx?: string;
}

interface TickerChainState {
  chainId: number;
  chainKey: string | null;
  available: boolean;
  reason: string | null;
}

interface TickerState {
  checking: boolean;
  available: boolean | null;
  reason: string | null;
  perChain: TickerChainState[];
}

const MODELS = [
  { id: "glm-5.2", label: "0G: GLM-5.2" },
  { id: "0gm-1.0-35b-a3b", label: "0G: 0GM-1.0 35B" },
  { id: "0gm-1.0-35b-a3b-sia", label: "0G: 0GM-1.0 SIA" },
];

export default function StudioPage() {
  const { address, isConnected, isConnecting, connectWallet, switchToChain } = useWallet();

  // ── form state ───────────────────────────────────────────────────────────
  const [tokenName, setTokenName] = useState("Aegis Quant AI");
  const [tokenTicker, setTokenTicker] = useState("AQUANT");
  const [tokenSupply, setTokenSupply] = useState("1,000,000,000");
  const [generatedLogo, setGeneratedLogo] = useState<string | null>("/logo.svg");
  const [isGeneratingLogo, setIsGeneratingLogo] = useState(false);

  const [feeTier, setFeeTier] = useState<"low" | "standard" | "meme">("standard");
  const [totalSwapFee, setTotalSwapFee] = useState(0.3);
  /** Streamed to the creator on every swap — the reason no free token allocation is needed. */
  const [creatorCut, setCreatorCut] = useState(0.1);
  const [treasuryCut, setTreasuryCut] = useState(0.05);
  /**
   * Gerbang World ID.
   *
   * `gate` diambil dari server, bukan dari `process.env` di klien, supaya UI tidak
   * pernah menawarkan verifikasi yang tidak bisa diselesaikan — dan tidak pernah
   * mengklaim proteksi yang sebenarnya mati. Tokennya diterbitkan server setelah
   * proof lolos; nilainya ikut dikirim di tahap prepare MAUPUN confirm.
   */
  const [worldIdGate, setWorldIdGate] = useState<{
    enabled: boolean;
    appId: string | null;
    action: string | null;
    allowLegacyProofs?: boolean;
  } | null>(null);
  const [worldIdToken, setWorldIdToken] = useState<string | null>(null);
  const [worldIdError, setWorldIdError] = useState<string | null>(null);
  const [worldIdBusy, setWorldIdBusy] = useState(false);
  /** Harga native USD, untuk menampilkan market cap buka yang sama di tiap chain. */
  const [nativeUsd, setNativeUsd] = useState<Record<string, number>>({});
  const [customSubdomain, setCustomSubdomain] = useState("aquant");
  const [agentPersona, setAgentPersona] = useState("24/7 quant market maker and liquidity rebalancer");
  const [selectedModel, setSelectedModel] = useState("glm-5.2");

  const liveChains = CHAIN_LIST.filter((c) => c.dexLive);
  const offlineChains = CHAIN_LIST.filter((c) => !c.dexLive);

  const [targetChainIds, setTargetChainIds] = useState<number[]>(liveChains.map((c) => c.chainId));

  // ── gating + results ─────────────────────────────────────────────────────
  const [ticker, setTicker] = useState<TickerState>({ checking: false, available: null, reason: null, perChain: [] });
  const [attestation, setAttestation] = useState<{ signature: string; message: string; signer: string } | null>(null);
  const [attesting, setAttesting] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [results, setResults] = useState<ChainResult[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const supplyNumber = Number(tokenSupply.replace(/[^0-9]/g, "")) || 0;
  /**
   * The fee is split three ways inside the same total, so traders are never
   * charged extra to pay the creator. Depth is whatever is left after the creator
   * and buyback shares.
   */
  const depthCut = Math.max(0, totalSwapFee - creatorCut - treasuryCut);

  /**
   * Jumlah native untuk market cap buka, HANYA untuk ilustrasi di layar.
   *
   * Angka yang benar-benar masuk calldata datang dari server saat prepare. Di
   * sini dipakai harga live yang sama supaya yang ditampilkan cocok dengan yang
   * akan terjadi; `defaultVirtualNative` dipakai kalau feed harga belum termuat,
   * dan itu memang cuma cadangan tampilan.
   */
  const virtualNativeFor = (chain: ChainInfo) => {
    const price = nativeUsd[chain.nativeSymbol];
    if (!price || price <= 0) return chain.defaultVirtualNative;
    return openingVirtualNative(price);
  };
  /**
   * Chain used for the illustrative opening price. Prefers the first chain that
   * will actually launch, so the number shown matches what the user is about to do.
   */
  const primaryChain: ChainInfo =
    liveChains.find((c) => targetChainIds.includes(c.chainId)) ?? liveChains[0] ?? CHAIN_LIST[0];

  // Attestation is bound to the address, so changing accounts invalidates it.
  useEffect(() => {
    if (attestation && attestation.signer.toLowerCase() !== (address ?? "").toLowerCase()) setAttestation(null);
  }, [address, attestation]);

  useEffect(() => {
    let alive = true;
    fetch("/api/prices")
      .then((r) => r.json())
      .then((d) => {
        if (alive && d?.prices) setNativeUsd(d.prices);
      })
      .catch(() => {
        // Ilustrasi jatuh ke defaultVirtualNative; calldata tetap menunggu server.
      });
    return () => {
      alive = false;
    };
  }, []);

  // Status gerbang dibaca dari server sekali per muat halaman.
  useEffect(() => {
    let alive = true;
    fetch("/api/worldid/verify")
      .then((r) => r.json())
      .then((d) => {
        if (alive)
          setWorldIdGate({
            enabled: Boolean(d?.enabled),
            appId: d?.appId ?? null,
            action: d?.action ?? null,
            allowLegacyProofs: Boolean(d?.allowLegacyProofs),
          });
      })
      .catch(() => {
        // Gagal membaca status BUKAN alasan untuk menganggap gerbang mati; itu
        // akan menyembunyikan tombol verifikasi padahal server tetap menolak
        // launch. Dibiarkan null sehingga UI menampilkan keadaan "memeriksa".
      });
    return () => {
      alive = false;
    };
  }, []);

  // Token World ID terikat ke alamat, jadi ganti akun membatalkannya — sama
  // seperti attestation di atas.
  useEffect(() => {
    setWorldIdToken(null);
    setWorldIdError(null);
  }, [address]);

  /** Kirim proof dari IDKit ke server; hanya server yang boleh memutuskan sah atau tidak. */
  const submitWorldIdProof = useCallback(
    async (proof: unknown) => {
      setWorldIdBusy(true);
      setWorldIdError(null);
      try {
        const res = await fetch("/api/worldid/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address, payload: proof }),
        });
        const data = await res.json();
        if (!res.ok || !data?.token) throw new Error(data?.error || `verification failed (${res.status})`);
        setWorldIdToken(data.token);
      } catch (error) {
        setWorldIdToken(null);
        setWorldIdError((error as Error).message);
      } finally {
        setWorldIdBusy(false);
      }
    },
    [address]
  );

  // ── ticker availability, evaluated per selected chain ────────────────────
  // A multi-chain launch needs per-chain availability: the same creator extending
  // their own ticker onto another chain is allowed, so a single global "taken"
  // answer would block the very flow this page exists for.
  useEffect(() => {
    const symbol = tokenTicker.trim().toUpperCase();
    if (!symbol) {
      setTicker({ checking: false, available: null, reason: null, perChain: [] });
      return;
    }
    setTicker((prev) => ({ ...prev, checking: true }));
    const handle = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ symbol });
        if (targetChainIds.length > 0) params.set("chainIds", targetChainIds.join(","));
        if (address) params.set("creator", address);
        const res = await fetch(`/api/deploy?${params.toString()}`);
        const data = await res.json();
        setTicker({
          checking: false,
          available: Boolean(data.available),
          reason: data.reason ?? null,
          perChain: Array.isArray(data.perChain) ? data.perChain : [],
        });
      } catch {
        setTicker({ checking: false, available: null, reason: "Could not check ticker availability.", perChain: [] });
      }
    }, 450);
    return () => clearTimeout(handle);
  }, [tokenTicker, targetChainIds, address]);

  const toggleChain = (chainId: number) => {
    setTargetChainIds((prev) => {
      const next = prev.includes(chainId) ? prev.filter((id) => id !== chainId) : [...prev, chainId];
      return next.length === 0 ? prev : next;
    });
  };

  const applyPreset = (type: "quant" | "meme" | "defi") => {
    if (type === "meme") {
      setTokenName("Cyber Doge AI");
      setTokenTicker("CDOGE");
      setCustomSubdomain("cdoge");
      setTokenSupply("1,000,000,000");
      setFeeTier("meme");
      setTotalSwapFee(0.5);
      setTreasuryCut(0.2);
      setAgentPersona("Viral meme quant bot with aggressive auto-buyback");
    } else if (type === "quant") {
      setTokenName("Aegis Quant AI");
      setTokenTicker("AQUANT");
      setCustomSubdomain("aquant");
      setTokenSupply("1,000,000,000");
      setFeeTier("standard");
      setTotalSwapFee(0.3);
      setTreasuryCut(0.1);
      setAgentPersona("24/7 quant market maker and liquidity rebalancer");
    } else {
      setTokenName("Nova Yield Protocol");
      setTokenTicker("NYIELD");
      setCustomSubdomain("novayield");
      setTokenSupply("500,000,000");
      setFeeTier("low");
      setTotalSwapFee(0.1);
      setTreasuryCut(0.02);
      setAgentPersona("Delta-neutral yield hedging and institutional LP routing");
    }
  };

  const handleAttest = async () => {
    if (!isConnected) {
      await connectWallet();
      return;
    }
    setAttesting(true);
    setGlobalError(null);
    try {
      const ethereum = getActiveEip1193();
      const provider = new ethers.BrowserProvider(ethereum);
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();
      const message =
        `ADEXTO launch attestation\n` +
        `Deployer: ${signerAddress}\n` +
        `Ticker: ${tokenTicker.trim().toUpperCase()}\n` +
        `Timestamp: ${Date.now()}`;
      const signature = await signer.signMessage(message);
      setAttestation({ signature, message, signer: signerAddress });
    } catch (error) {
      setGlobalError(describeTxError(error));
    } finally {
      setAttesting(false);
    }
  };

  const handleGenerateLogo = async () => {
    setIsGeneratingLogo(true);
    try {
      const res = await fetch("/api/generate-logo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenName,
          tokenSymbol: tokenTicker,
          prompt: `Minimalist cyberpunk vector emblem for AI agent ${tokenName} ($${tokenTicker}), neon cyan and purple glow on obsidian`,
        }),
      });
      const data = await res.json();
      if (data.imageUrl) setGeneratedLogo(data.imageUrl);
    } catch (error) {
      console.warn("[adexto] logo generation failed:", error);
    } finally {
      setIsGeneratingLogo(false);
    }
  };

  // ── deploy ───────────────────────────────────────────────────────────────
  const updateResult = useCallback((chainId: number, patch: Partial<ChainResult>) => {
    setResults((prev) => prev.map((r) => (r.chainId === chainId ? { ...r, ...patch } : r)));
  }, []);

  const handleDeploy = async () => {
    setGlobalError(null);
    if (!isConnected || !address) {
      await connectWallet();
      return;
    }
    if (!attestation) {
      setGlobalError("Sign the launch attestation first.");
      return;
    }
    if (supplyNumber <= 0) {
      setGlobalError("Supply must be greater than zero — the curve needs tokens to sell.");
      return;
    }
    if (supplyNumber <= 0) {
      setGlobalError("Supply must be greater than zero.");
      return;
    }

    // Launch only where the factory exists AND the ticker is free on that chain.
    // A chain whose ticker is taken is skipped rather than aborting the whole run.
    const selected = liveChains.filter((c) => targetChainIds.includes(c.chainId));
    if (selected.length === 0) {
      setGlobalError("No selected chain has a launch factory deployed, so no tradable curve can be created.");
      return;
    }

    const blockedIds = new Set(ticker.perChain.filter((p) => !p.available).map((p) => p.chainId));
    const chains = selected.filter((c) => !blockedIds.has(c.chainId));
    const skipped = selected.filter((c) => blockedIds.has(c.chainId));

    if (chains.length === 0) {
      setGlobalError(ticker.reason ?? `Ticker ${tokenTicker.toUpperCase()} is not available on any selected chain.`);
      return;
    }
    if (skipped.length > 0) {
      setGlobalError(
        `Skipping ${skipped.map((c) => c.key).join(", ")}: ticker already has a market there. Launching on ${chains
          .map((c) => c.key)
          .join(", ")}.`
      );
    }

    setDeploying(true);
    setResults(
      chains.map((c) => ({ chainKey: c.key, chainName: c.name, chainId: c.chainId, status: "pending" as DeployStatus }))
    );

    const symbol = tokenTicker.trim().toUpperCase();

    // Stage 1 — anchor metadata and get the attestation root that goes in calldata.
    let attestationRoot: string;
    let daStorageTx: string | null = null;
    let lpFeeBps = Math.round(depthCut * 100);
    let treasuryBuybackBps = Math.round(treasuryCut * 100);
    const serverVirtualNative: Record<number, string> = {};
    try {
      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "prepare",
          name: tokenName,
          symbol,
          supply: String(supplyNumber),
          swapFee: totalSwapFee,
          treasuryCut,
          model: selectedModel,
          persona: agentPersona,
          deployer: address,
          targetChains: chains.map((c) => c.chainId),
          attestationSignature: attestation.signature,
          attestationMessage: attestation.message,
          worldIdToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `prepare failed (${res.status})`);
      attestationRoot = data.attestationRoot;
      daStorageTx = data.daStorageTx ?? null;
      lpFeeBps = Number(data.lpFeeBps ?? lpFeeBps);
      treasuryBuybackBps = Number(data.treasuryBuybackBps ?? treasuryBuybackBps);
      // `virtualNative` DATANG DARI SERVER, dihitung dari harga native live agar
      // market cap buka sama di setiap chain. Angka di config hanya cadangan
      // tampilan; memakainya untuk calldata akan mengembalikan ketidaksetaraan
      // yang justru sedang diperbaiki.
      for (const t of (data.deployTargets ?? []) as Array<{ chainId: number; virtualNative: string }>) {
        if (t?.chainId && t?.virtualNative) serverVirtualNative[t.chainId] = t.virtualNative;
      }
      if (Object.keys(serverVirtualNative).length === 0) {
        throw new Error("server did not return an opening market cap for any chain");
      }
    } catch (error: any) {
      setGlobalError(`Preparation failed: ${error.message}`);
      setDeploying(false);
      setResults([]);
      return;
    }

    // Stage 2 — one transaction per chain. Each is independent and reported honestly.
    //
    // `virtualNative` berbeda per chain karena ia adalah market cap buka dalam aset
    // native chain itu. Nilainya diambil dari server, yang menghitungnya dari harga
    // live sehingga nilai USD-nya SAMA di keempat chain. Dulu angkanya dipaku per
    // chain, dan karena harga koin bergerak, satu ticker bisa membuka $212 di 0G
    // tapi $1.939 di Base — selisih yang tidak bisa diratakan arbitrase karena
    // tidak ada bridge.
    const argsFor = (chain: ChainInfo) =>
      [
        tokenName,
        symbol,
        BigInt(supplyNumber),
        address as string,
        ethers.parseEther(serverVirtualNative[chain.chainId]),
        BigInt(Math.round(totalSwapFee * 100)),
        BigInt(Math.round(creatorCut * 100)),
        BigInt(treasuryBuybackBps),
        attestationRoot,
      ] as const;

    const ethereum = getActiveEip1193();
    const iface = new ethers.Interface(FACTORY_V3_ABI);

    for (const chain of chains) {
      try {
        // Public RPCs drop reads occasionally, and in a four-chain launch one flaky
        // read would otherwise cost the user a chain. The pre-flight is retried; the
        // send never is, so a transaction can never be submitted twice.
        let factory: ethers.Contract | null = null;
        let preflightError: unknown = null;

        for (let attempt = 1; attempt <= 3 && !factory; attempt++) {
          try {
            updateResult(chain.chainId, {
              status: "signing",
              message: attempt === 1 ? `Switching wallet to ${chain.name}…` : `Retrying ${chain.name} (${attempt}/3)…`,
            });
            await ensureWalletChain(ethereum, chain);

            const provider = new ethers.BrowserProvider(ethereum);
            const signer = await provider.getSigner();
            const candidate = new ethers.Contract(chain.factoryV3Address as string, FACTORY_V3_ABI, signer);

            // Simulate first: a revert here costs nothing and gives the real reason.
            updateResult(chain.chainId, { message: "Simulating launch…" });
            await candidate.deployTrinity.staticCall(...argsFor(chain));
            factory = candidate;
          } catch (error) {
            preflightError = error;
            if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 3000));
          }
        }

        if (!factory) throw preflightError;

        updateResult(chain.chainId, { message: "Confirm in your wallet…" });
        // No `value`: a launch costs gas only.
        const tx = await factory.deployTrinity(...argsFor(chain));
        updateResult(chain.chainId, { status: "confirming", txHash: tx.hash, message: "Waiting for confirmation…" });

        const receipt = await tx.wait();
        if (!receipt || receipt.status !== 1) throw new Error("Transaction reverted on-chain.");

        // Read the real addresses out of the receipt.
        let tokenAddress: string | undefined;
        let poolAddress: string | undefined;
        for (const log of receipt.logs) {
          try {
            const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
            if (parsed?.name === "TrinityProjectDeployed") {
              tokenAddress = parsed.args.token;
              poolAddress = parsed.args.pool;
              break;
            }
          } catch {
            // not a factory event
          }
        }
        if (!tokenAddress) throw new Error("Receipt did not contain TrinityProjectDeployed.");

        updateResult(chain.chainId, {
          status: "registering",
          tokenAddress,
          poolAddress,
          message: "Verifying on-chain and registering…",
        });

        const confirmRes = await fetch("/api/deploy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stage: "confirm",
            chainId: chain.chainId,
            txHash: receipt.hash,
            name: tokenName,
            symbol,
            supply: String(supplyNumber),
            lpFeeBps,
            treasuryBuybackBps,
            creator: address,
            persona: agentPersona,
            agentModel: `0G Router (${selectedModel})`,
            image: generatedLogo ?? "/logo.svg",
            attestationRoot,
            daStorageTx,
            targetChainIds: chains.map((c) => c.chainId),
            worldIdToken,
          }),
        });
        const confirmData = await confirmRes.json();
        if (!confirmRes.ok) throw new Error(confirmData.error || `registration failed (${confirmRes.status})`);

        updateResult(chain.chainId, {
          status: "success",
          message: confirmData.message,
          explorerTx: confirmData.deployment?.explorerTx,
          poolAddress: confirmData.project?.poolAddress ?? poolAddress,
        });
      } catch (error) {
        // Keep the raw error in the console: the human-readable mapping is for the
        // UI, but diagnosing a chain-specific failure needs the original payload.
        console.error(`[adexto] launch failed on ${chain.name} (${chain.chainId}):`, error);
        updateResult(chain.chainId, { status: "failed", message: describeTxError(error) });
      }
    }

    setDeploying(false);
  };

  // ── AI co-pilot ──────────────────────────────────────────────────────────
  const [inputMessage, setInputMessage] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([
      {
        role: "assistant",
        content:
          `⚡ **ADEXTO Studio**\n\n` +
          `• Model: **0G Router (${selectedModel})**\n` +
          `• Factory: **AdextoTrinityFactoryV3** (token + bonding curve in one transaction, no liquidity deposit)\n` +
          `• Live chains: **${liveChains.length > 0 ? liveChains.map((c) => c.key).join(", ") : "none yet"}**\n\n` +
          `Describe your concept, or configure the launch on the left.`,
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, chatLoading]);

  const sendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!inputMessage.trim() || chatLoading) return;

    const next = [...messages, { role: "user" as const, content: inputMessage }];
    setMessages(next);
    setInputMessage("");
    setChatLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, model: selectedModel }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let reply = "";
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        reply += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: reply };
          return copy;
        });
      }
    } catch (error: any) {
      setMessages((prev) => [...prev, { role: "assistant", content: `0G Compute error: ${error.message}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  const successes = results.filter((r) => r.status === "success");
  const failures = results.filter((r) => r.status === "failed");
  const finished = results.length > 0 && !deploying;
  // Chains that will actually be launched on: factory present, selected, and the
  // ticker still free there.
  const blockedChainIds = new Set(ticker.perChain.filter((p) => !p.available).map((p) => p.chainId));
  const launchTargets = liveChains.filter((c) => targetChainIds.includes(c.chainId) && !blockedChainIds.has(c.chainId));
  const skippedTargets = liveChains.filter((c) => targetChainIds.includes(c.chainId) && blockedChainIds.has(c.chainId));

  // No seed to validate any more: a launch needs supply, a signed attestation and
  // at least one chain that is not already using this ticker. Bila gerbang World ID
  // menyala, proof-nya juga wajib — dan server menolak launch tanpa itu, jadi
  // mengunci tombol di sini hanya supaya kegagalannya tidak mengejutkan.
  const worldIdSatisfied = !worldIdGate?.enabled || Boolean(worldIdToken);
  const canDeploy =
    isConnected &&
    Boolean(attestation) &&
    worldIdSatisfied &&
    supplyNumber > 0 &&
    liveChains.length > 0 &&
    launchTargets.length > 0;

  return (
    <div className="min-h-[calc(100vh-4rem)] lg:h-[calc(100vh-4rem)] flex flex-col p-2 sm:p-4 max-w-[1560px] mx-auto w-full overflow-y-auto lg:overflow-hidden">
      {/* Top strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-4 pb-2.5 mb-2.5 border-b border-line/[0.08] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-ink flex items-center gap-1.5 font-mono">
            <Sparkles className="w-3.5 h-3.5 text-accent" /> ADEXTO STUDIO
          </span>
          <span className="text-ink-faint text-xs">/</span>
          {isConnected ? (
            <span className="text-ok font-mono text-xs font-medium flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-ok animate-pulse" />
              {address?.slice(0, 6)}…{address?.slice(-4)}
            </span>
          ) : (
            <button
              onClick={() => connectWallet()}
              disabled={isConnecting}
              className="text-warn hover:text-warn font-mono text-xs font-medium flex items-center gap-1.5 bg-warn/10 border border-warn/30 px-2 py-0.5 rounded"
            >
              <Lock className="w-3 h-3 text-warn" /> {isConnecting ? "Connecting…" : "Connect wallet"}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          {/* Tiga tombol ini mengisi SELURUH formulir sekaligus, tapi dulu berdiri
              sebagai tiga kata lepas — "Quant AI  Viral Meme  DeFi Yield" — tanpa
              petunjuk bahwa mengkliknya menimpa nama, ticker, tier fee, dan mandat
              agen. Sekarang bergaris dan berlabel.
              Kelas hover-nya juga dibuat statis. Sebelumnya `hover:${color}` disusun
              dari variabel, jadi pemindai Tailwind tidak bisa melihatnya; kelasnya
              hanya ada di CSS karena kebetulan dipakai berkas lain. */}
          <div className="hidden md:flex items-center gap-1 rounded-lg border border-line bg-white p-1">
            <span className="pl-1.5 pr-0.5 text-[10px] uppercase tracking-wider text-ink-faint">Presets</span>
            {(
              [
                ["quant", "Quant AI"],
                ["meme", "Viral Meme"],
                ["defi", "DeFi Yield"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                title={`Fill the whole form with the ${label} template`}
                className="rounded-md px-2.5 py-1 text-[11px] font-semibold text-ink-soft transition-colors hover:bg-cream-3 hover:text-ink"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="relative flex items-center bg-white rounded-lg px-2.5 py-1">
            <Cpu className="w-3.5 h-3.5 text-accent mr-1.5 shrink-0" />
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-transparent text-accent font-bold text-xs focus:outline-none cursor-pointer pr-4 appearance-none max-w-[150px] truncate"
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id} className="bg-white text-accent">
                  {m.label}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3 h-3 text-accent/60 absolute right-2 pointer-events-none" />
          </div>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3.5 min-h-0">
        {/* Left: launch control */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-line/[0.06] p-3 sm:p-4 flex flex-col shadow-xl lg:overflow-y-auto min-h-[520px]">
          {finished ? (
            <DeployReport
              results={results}
              symbol={tokenTicker.trim().toUpperCase()}
              onReset={() => {
                setResults([]);
                setGlobalError(null);
              }}
            />
          ) : (
            <div className="space-y-3">
              <StepRail
                steps={[
                  { id: "step-chains", label: "Chains", done: launchTargets.length > 0 },
                  {
                    id: "step-token",
                    label: "Token",
                    done: Boolean(tokenName.trim()) && Boolean(tokenTicker.trim()) && supplyNumber > 0 && ticker.available !== false,
                  },
                  { id: "step-curve", label: "Curve", done: totalSwapFee > 0 },
                  { id: "step-agent", label: "Agent", done: Boolean(agentPersona.trim()) },
                  { id: "step-verify", label: "Verify", done: Boolean(attestation) && worldIdSatisfied },
                ]}
              />

              {liveChains.length === 0 && (
                <div className="p-3 rounded-xl bg-warn/10 border border-warn/30 flex items-start gap-2 text-[11px] font-mono text-warn">
                  <AlertTriangle className="w-4 h-4 text-warn mt-0.5 shrink-0" />
                  <span>
                    <strong>Launching is disabled.</strong> No launch factory is deployed on any chain yet, so a launch
                    could not create a tradable curve. Broadcast it with{" "}
                    <code className="text-accent">node scripts/deploy-sovereign-curve.mjs --chain 0g --broadcast</code>{" "}
                    and set <code className="text-accent">NEXT_PUBLIC_FACTORY_V3_0G</code>.
                  </span>
                </div>
              )}

              {/* Chain matrix */}
              <div id="step-chains" className="scroll-mt-3 p-2.5 rounded-xl bg-accent-soft border border-accent/30 space-y-2">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-accent" />
                  <span className="text-xs font-mono font-bold text-ink uppercase tracking-wider">
                    1. Chains ({launchTargets.length}/{liveChains.length}) — one market per chain
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 font-mono text-[11px]">
                  {CHAIN_LIST.map((chain) => {
                    const selectable = chain.dexLive;
                    const selected = selectable && targetChainIds.includes(chain.chainId);
                    return (
                      <button
                        key={chain.chainId}
                        type="button"
                        disabled={!selectable}
                        onClick={() => toggleChain(chain.chainId)}
                        title={
                          !selectable
                            ? `No launch factory is deployed on ${chain.name} yet`
                            : blockedChainIds.has(chain.chainId)
                            ? `${chain.name} · this ticker already has a market here, it will be skipped`
                            : // Tampilkan factory yang BENAR-BENAR dipakai chain ini. Menampilkan
                              // factoryV2Address secara kaku memperlihatkan "null" di chain kurva.
                              `${chain.name} · factory ${chain.factoryV3Address ?? chain.factoryV2Address}`
                        }
                        className={`flex items-center justify-between p-2 rounded-lg border text-left transition-all ${
                          !selectable
                            ? "bg-cream-2 border-line text-ink-faint cursor-not-allowed"
                            : selected
                            ? "bg-accent-soft border-accent/30 text-accent"
                            : "bg-cream-2 border-line text-ink-soft"
                        }`}
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          {selectable ? (
                            selected ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-accent shrink-0" />
                            ) : (
                              <span className="w-3.5 h-3.5 rounded border border-line shrink-0" />
                            )
                          ) : (
                            <Lock className="w-3.5 h-3.5 shrink-0" />
                          )}
                          <span className="font-bold truncate">{chain.key}</span>
                        </span>
                        <span className="text-[9px] shrink-0">{chain.chainId}</span>
                      </button>
                    );
                  })}
                </div>

                {offlineChains.length > 0 && (
                  <p className="text-[10px] font-mono text-ink-faint flex items-start gap-1.5">
                    <Info className="w-3 h-3 mt-0.5 shrink-0" />
                    {offlineChains.map((c) => c.key).join(", ")} unavailable: no launch factory deployed, so a launch
                    there would produce a token with no curve.
                  </p>
                )}
              </div>

              {/* Token */}
              <Section id="step-token" title="2. Token">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <Field label="Name">
                    <input
                      value={tokenName}
                      onChange={(e) => setTokenName(e.target.value)}
                      className="w-full rounded-lg px-2.5 py-1.5 font-mono text-xs bg-cream-2 border border-line/[0.06] focus:border-accent/30 text-ink font-semibold focus:outline-none"
                    />
                  </Field>
                  <Field
                    label="Ticker"
                    hint={
                      ticker.checking
                        ? "checking…"
                        : ticker.available === true
                        ? `available on ${launchTargets.length || targetChainIds.length} chain(s)`
                        : launchTargets.length > 0
                        ? `available on ${launchTargets.map((c) => c.key).join(", ")}`
                        : ticker.available === false
                        ? ticker.reason ?? "unavailable"
                        : undefined
                    }
                    hintTone={
                      launchTargets.length > 0 ? "ok" : ticker.available === false ? "error" : "muted"
                    }
                  >
                    <input
                      value={tokenTicker}
                      onChange={(e) => {
                        const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
                        setTokenTicker(value);
                        setCustomSubdomain(value.toLowerCase());
                      }}
                      className={`w-full rounded-lg px-2.5 py-1.5 font-mono text-xs bg-cream-2 border text-accent font-bold focus:outline-none ${
                        ticker.available === false ? "border-danger/30" : "border-line/[0.06] focus:border-accent/30"
                      }`}
                    />
                  </Field>
                  <Field label="Supply (whole tokens)">
                    <input
                      value={tokenSupply}
                      onChange={(e) => setTokenSupply(e.target.value)}
                      className="w-full rounded-lg px-2.5 py-1.5 font-mono text-xs bg-cream-2 border border-line/[0.06] focus:border-accent/30 text-ink font-semibold focus:outline-none"
                    />
                  </Field>
                </div>

                <div className="p-2.5 rounded-xl bg-white border border-line flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl overflow-hidden bg-white border border-accent/30 p-1 flex items-center justify-center shrink-0">
                      <img src={generatedLogo ?? "/logo.svg"} alt="Logo" className="w-full h-full object-contain" />
                    </div>
                    <div>
                      <div className="text-[11px] font-bold text-ink font-mono">0G z-image-turbo</div>
                      <span className="text-[10px] text-ink-soft">Generate an emblem for the token</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleGenerateLogo}
                    disabled={isGeneratingLogo}
                    className="px-3 py-1.5 rounded-lg bg-accent-soft hover:bg-accent-soft text-accent border border-accent/30 text-xs font-mono font-bold flex items-center gap-1.5 shrink-0"
                  >
                    {isGeneratingLogo ? (
                      <>
                        <RefreshCw className="w-3 h-3 animate-spin" /> Rendering…
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-3 h-3" /> Generate
                      </>
                    )}
                  </button>
                </div>
              </Section>

              {/* Curve.
                  The seed-liquidity input and the supply-split slider used to live
                  here. Both are gone: the curve needs no native deposit, and 100%
                  of supply enters it, so there is nothing left to configure and
                  nothing for the creator to dump. */}
              <Section id="step-curve" title="3. Bonding curve">
                <div className="rounded-xl border border-ok/30 bg-ok/10 p-2.5 flex items-start gap-2 text-[10px] font-mono">
                  <Droplets className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />
                  <span className="text-ink-soft">
                    <strong className="text-ok">No liquidity deposit.</strong> The curve opens with a virtual
                    reserve, so you pay gas only — typically under $0.10 per chain. Every token is tradable from the
                    launch transaction onward.
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Row
                    label="Supply into curve"
                    value={`100% · ${supplyNumber > 0 ? supplyNumber.toLocaleString("en-US") : "—"}`}
                  />
                  <Row label="Your token allocation" value="0 — you earn from fees" />
                </div>

                <div className="p-2 rounded-xl bg-cream-2 flex items-start gap-2 text-[10px] font-mono text-ink-soft">
                  <Droplets className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
                  <span>
                    {/* USD didahulukan: itu satu-satunya angka yang berarti sama di
                        keempat chain. Jumlah native-nya berbeda per chain justru
                        AGAR nilai USD-nya sama. */}
                    Opening market cap{" "}
                    <strong className="text-accent">≈ ${OPENING_MARKET_CAP_USD.toLocaleString("en-US")}</strong> on
                    every chain you select
                    {virtualNativeFor(primaryChain) > 0 && (
                      <>
                        {" "}
                        — {formatSmallNumber(virtualNativeFor(primaryChain), 6)} {primaryChain.nativeSymbol} on{" "}
                        {primaryChain.key}
                      </>
                    )}
                    .{" "}
                    <span title={supplyNumber > 0 ? String(virtualNativeFor(primaryChain) / supplyNumber) : undefined}>
                      Opening price{" "}
                      {supplyNumber > 0 ? formatSmallNumber(virtualNativeFor(primaryChain) / supplyNumber) : "—"}{" "}
                      {primaryChain.nativeSymbol} per token.
                    </span>
                    <br />
                    <span className="text-warn/90">
                      The curve has no withdrawal function, so nobody can drain it — not you either. The depth share of
                      each fee stays in the curve, which raises the price floor as volume accumulates.
                    </span>
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                  {/* Three-way split: depth · creator · buyback. The creator slice
                      is what replaces a free token allocation, so there is nothing
                      for a creator to dump. */}
                  {(
                    [
                      ["low", 0.1, 0.04, 0.02, "0.10% Low"],
                      ["standard", 0.3, 0.1, 0.05, "0.30% Standard"],
                      ["meme", 0.5, 0.2, 0.1, "0.50% Meme"],
                    ] as const
                  ).map(([tier, fee, creator, cut, label]) => (
                    <button
                      key={tier}
                      onClick={() => {
                        setFeeTier(tier);
                        setTotalSwapFee(fee);
                        setCreatorCut(creator);
                        setTreasuryCut(cut);
                      }}
                      className={`p-2 rounded-xl text-left transition-all border ${
                        feeTier === tier
                          ? "bg-accent-soft text-ink border-accent/30"
                          : "bg-cream-2 text-ink-soft border-transparent hover:text-ink"
                      }`}
                    >
                      <span className="font-bold block text-[11px] text-accent">{label}</span>
                      <span className="text-[9px] text-ink-soft">
                        {(fee - creator - cut).toFixed(2)}% depth · {creator.toFixed(2)}% you · {cut.toFixed(2)}% buyback
                      </span>
                    </button>
                  ))}
                </div>

                <div className="p-2 rounded-xl bg-cream-2 space-y-1">
                  <div className="flex flex-wrap justify-between gap-x-3 text-[10px] font-mono">
                    <span className="text-accent font-medium">Curve depth: {depthCut.toFixed(2)}%</span>
                    <span className="text-ok font-medium">Your revenue: {creatorCut.toFixed(2)}%</span>
                    <span className="text-accent font-medium">Buyback: {treasuryCut.toFixed(2)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-cream-3/[0.05] overflow-hidden flex">
                    <div className="bg-accent-soft h-full" style={{ width: `${(depthCut / totalSwapFee) * 100}%` }} />
                    <div className="bg-ok/10 h-full" style={{ width: `${(creatorCut / totalSwapFee) * 100}%` }} />
                    <div className="bg-accent-soft h-full" style={{ width: `${(treasuryCut / totalSwapFee) * 100}%` }} />
                  </div>
                  <span className="block text-[9px] font-mono text-ok/80">
                    You earn {creatorCut.toFixed(2)}% of every swap, streamed to your wallet. You receive no free tokens,
                    so there is nothing you could dump.
                  </span>
                  <span className="text-[9px] font-mono text-ink-faint block">
                    Subdomain: {customSubdomain || "myswap"}.adexto.xyz
                  </span>
                </div>
              </Section>

              {/* Agent */}
              <Section id="step-agent" title="4. 0G TEE agent">
                <Field label="Mandate">
                  <input
                    value={agentPersona}
                    onChange={(e) => setAgentPersona(e.target.value)}
                    className="w-full rounded-lg px-2.5 py-1.5 font-mono text-xs bg-cream-2 border border-line/[0.06] focus:border-accent/30 text-ink focus:outline-none"
                  />
                </Field>
                <div className="flex items-center gap-1.5 font-mono text-[10px] flex-wrap">
                  <span
                    className="px-2 py-0.5 rounded bg-cream-3 text-ink-soft border border-line"
                    title="0G states inference runs in SEV-SNP enclaves. ADEXTO does not verify that attestation."
                  >
                    0G Compute router
                  </span>
                  {/* Amber dipesan untuk peringatan; ini nama fitur. */}
                  <span className="px-2 py-0.5 rounded bg-accent-soft text-accent border border-accent/30">
                    Cloudflare x402
                  </span>
                  <span className="px-2 py-0.5 rounded bg-accent-soft text-accent border border-accent/30">
                    0G DA metadata anchor
                  </span>
                </div>
              </Section>

              {/* Verifikasi — dua gerbang yang berbeda, dikelompokkan jadi satu langkah.
                  Sebelumnya keduanya berupa dua kotak lepas tanpa judul di antara
                  seksi bernomor, sehingga terbaca seperti catatan pinggir alih-alih
                  syarat yang menahan tombol launch. */}
              <div id="step-verify" className="scroll-mt-3 space-y-2">
              <span className="block text-xs font-mono font-bold uppercase tracking-wider text-ink">
                5. Verify
              </span>

              {/* Attestation */}
              <div className="p-3 rounded-xl bg-cream-2 border border-line space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <ShieldCheck className={`w-5 h-5 shrink-0 ${attestation ? "text-ok" : "text-ink-faint"}`} />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-ink flex items-center gap-1.5 flex-wrap">
                        <span>Deployer address attestation</span>
                        {attestation && (
                          <span className="text-[10px] px-1.5 rounded bg-ok/10 text-ok border border-ok/30 font-mono font-bold">
                            SIGNED
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-ink-soft">
                        Signature verified server-side and bound to your address
                      </span>
                    </div>
                  </div>

                  {attestation ? (
                    <span className="text-ok text-xs font-mono font-bold flex items-center gap-1 shrink-0">
                      <CheckCircle2 className="w-4 h-4" /> Ready
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleAttest}
                      disabled={attesting}
                      className="px-3 py-1.5 rounded-lg bg-cream-3 hover:bg-cream-3 text-ink font-mono text-[11px] font-bold border border-line flex items-center gap-1 shrink-0"
                    >
                      {attesting ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin text-accent" /> Signing…
                        </>
                      ) : (
                        "Sign attestation"
                      )}
                    </button>
                  )}
                </div>

                <p className="text-[10px] font-mono text-warn/90 flex items-start gap-1.5 pt-1 border-t border-line">
                  <Info className="w-3 h-3 mt-0.5 shrink-0" />
                  {/* Teks WAJIB dibungkus satu <span>. Induknya adalah flex container,
                      jadi tanpa pembungkus ini setiap potongan teks, <strong>, dan <code>
                      menjadi item flex tersendiri dan tersusun MENYAMPING — kalimatnya
                      terbaca menyilang antar kolom. */}
                  <span>
                    This proves control of an address, not that you are a distinct person. Wallets are free to create, so
                    Sybil resistance is a separate step below.
                  </span>
                </p>
              </div>

              {/* World ID — lapisan anti-Sybil yang sebenarnya */}
              <div className="p-3 rounded-xl bg-cream-2 border border-line space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Fingerprint
                      className={`w-5 h-5 shrink-0 ${worldIdToken ? "text-ok" : worldIdGate?.enabled ? "text-ink-soft" : "text-ink-faint"}`}
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-ink flex items-center gap-1.5 flex-wrap">
                        <span>World ID proof of personhood</span>
                        {worldIdToken && (
                          <span className="text-[10px] px-1.5 rounded bg-ok/10 text-ok border border-ok/30 font-mono font-bold">
                            VERIFIED
                          </span>
                        )}
                        {worldIdGate && !worldIdGate.enabled && (
                          <span className="text-[10px] px-1.5 rounded bg-warn/10 text-warn border border-warn/30 font-mono font-bold">
                            NOT CONFIGURED
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-ink-soft">
                        {worldIdGate === null
                          ? "Checking whether this deployment enforces World ID…"
                          : worldIdGate.enabled
                          ? "Zero-knowledge proof verified server-side, then bound to this wallet"
                          : "This deployment has no World ID app configured, so the launch gate is the wallet signature alone"}
                      </span>
                    </div>
                  </div>

                  {worldIdGate?.enabled && worldIdGate.appId && worldIdGate.action && !worldIdToken && (
                    <WorldIdVerifyButton
                      appId={worldIdGate.appId}
                      action={worldIdGate.action}
                      allowLegacyProofs={worldIdGate.allowLegacyProofs}
                      busy={worldIdBusy}
                      disabled={!isConnected}
                      onProof={submitWorldIdProof}
                    />
                  )}
                  {worldIdToken && (
                    <span className="text-ok text-xs font-mono font-bold flex items-center gap-1 shrink-0">
                      <CheckCircle2 className="w-4 h-4" /> Unique
                    </span>
                  )}
                </div>

                {worldIdError && (
                  <p className="text-[10px] font-mono text-danger flex items-start gap-1.5 pt-1 border-t border-line">
                    <XCircle className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>{worldIdError}</span>
                  </p>
                )}

                {worldIdGate?.enabled && (
                  <p className="text-[10px] font-mono text-ink-faint flex items-start gap-1.5 pt-1 border-t border-line">
                    <Info className="w-3 h-3 mt-0.5 shrink-0" />
                    {/* Aturan satu-peluncuran ditegakkan oleh World sendiri lewat
                        `max_verifications` pada action, bukan oleh kode kita. Dinyatakan
                        di sini supaya creator tahu sebelum mencoba, bukan menemukannya
                        sebagai pesan error setelah bolak-balik ke World App. */}
                    <span>
                      The proof is checked by the server, never trusted from the browser, and its nullifier is bound to
                      this wallet — so one person cannot farm fresh wallets to launch repeatedly. Each verified person
                      gets one launch, across as many chains as they select.
                    </span>
                  </p>
                )}

              </div>
              </div>
              {/* ↑ tutup #step-verify */}

              {globalError && (
                <div className="p-2.5 rounded-xl bg-danger/10 border border-danger/30 text-[11px] font-mono text-danger flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-danger mt-0.5 shrink-0" />
                  <span>{globalError}</span>
                </div>
              )}

              {deploying && results.length > 0 && (
                <div className="space-y-1.5">
                  {results.map((r) => (
                    <ResultRow key={r.chainId} result={r} />
                  ))}
                </div>
              )}

              <button
                onClick={handleDeploy}
                disabled={deploying || !canDeploy}
                /* Keadaan nonaktif tidak lagi memakai `opacity-40`. Ungu pekat yang
                   diredupkan sampai 40% dengan teks putih di atasnya menghasilkan
                   rasio kontras di bawah 2:1 — dan justru di keadaan inilah
                   tombolnya WAJIB terbaca, karena tulisannya adalah satu-satunya
                   tempat yang memberi tahu apa yang masih kurang. */
                className="w-full py-3 rounded-xl font-bold text-xs bg-accent hover:bg-accent-strong text-white transition-colors flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:bg-cream-3 disabled:text-ink-soft"
              >
                {deploying ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Deploying…
                  </>
                ) : liveChains.length === 0 ? (
                  <>
                    <Lock className="w-3.5 h-3.5" /> Factory not deployed yet
                  </>
                ) : !isConnected ? (
                  <>
                    <Lock className="w-3.5 h-3.5" /> Connect wallet
                  </>
                ) : !attestation ? (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5 text-warn" /> Sign attestation to unlock
                  </>
                ) : launchTargets.length === 0 ? (
                  <>
                    <XCircle className="w-3.5 h-3.5" /> Choose an available ticker
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" /> Launch on {launchTargets.map((c) => c.key).join(" + ")} · gas
                    only
                  </>
                )}
              </button>

              {skippedTargets.length > 0 && (
                <p className="text-[10px] font-mono text-warn/90 flex items-start gap-1.5">
                  <Info className="w-3 h-3 mt-0.5 shrink-0" />
                  {skippedTargets.map((c) => c.key).join(", ")} will be skipped: this ticker already has a market there.
                </p>
              )}

              <div className="rounded-xl border border-line bg-white overflow-hidden">
                <div className="flex items-center gap-2 border-b border-line bg-cream-3/[0.03] px-3 py-2">
                  <Info className="h-3 w-3 text-accent" />
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink">
                    How a multi-chain launch works
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-px bg-cream-3 sm:grid-cols-3">
                  <div className="bg-white p-3">
                    <p className="font-mono text-[9px] uppercase tracking-wider text-ink-faint">One market per chain</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
                      Each selected chain gets its own token and curve. Supply, depth and price are independent.
                    </p>
                  </div>
                  <div className="bg-white p-3">
                    <p className="font-mono text-[9px] uppercase tracking-wider text-ink-faint">No bridging</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
                      Nothing moves between chains, so the price on 0G and Base can differ. Arbitrage is up to the market.
                    </p>
                  </div>
                  <div className="bg-white p-3">
                    <p className="font-mono text-[9px] uppercase tracking-wider text-ink-faint">Per-chain cost</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
                      Gas only, usually under $0.10. You need a little of each chain&apos;s native asset to pay it —
                      <span className="text-ok"> no liquidity deposit</span>.
                    </p>
                  </div>
                </div>
                <p className="border-t border-line px-3 py-2 font-mono text-[10px] text-ink-faint">
                  A chain without enough gas is skipped on its own — the others still launch.
                </p>
              </div>

              <p className="text-[9px] font-mono text-ink-faint leading-relaxed">
                Each selected chain gets its own transaction to{" "}
                <code className="text-accent">deployTrinityProject</code>, simulated first so a revert costs no gas. The
                token and pool addresses come from the receipt event and are verified server-side before the market is
                registered.
              </p>
            </div>
          )}
        </div>

        {/* Right: co-pilot */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-line/[0.06] flex flex-col h-[480px] lg:h-full overflow-hidden shadow-xl">
          <div className="p-2.5 border-b border-line/[0.06] bg-cream-2 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-accent flex items-center justify-center text-white">
                <Bot className="w-3 h-3" />
              </div>
              <span className="font-bold text-ink text-xs">0G TEE Co-Pilot</span>
              <span className="text-[9px] font-mono text-accent bg-accent-soft px-1.5 py-0.5 rounded font-bold">
                {selectedModel}
              </span>
            </div>
            <button
              onClick={() => setMessages((prev) => prev.slice(0, 1))}
              className="p-1 text-ink-faint hover:text-ink"
              title="Reset chat"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>

          <div className="px-3 py-1 bg-cream-2 border-b border-line/[0.02] flex items-center justify-between text-[10px] font-mono text-ink-soft">
            <span>
              Target: <strong className="text-accent font-bold">{customSubdomain || "myswap"}.adexto.xyz</strong>
            </span>
            <span>
              Chains:{" "}
              <strong className="text-accent font-bold">
                {liveChains.length === 0
                  ? "none live"
                  : liveChains
                      .filter((c) => targetChainIds.includes(c.chainId))
                      .map((c) => c.key)
                      .join(", ") || "none selected"}
              </strong>
            </span>
          </div>

          <div ref={chatRef} className="flex-1 overflow-y-auto p-3 space-y-2.5 font-sans text-xs bg-cream-2">
            {messages.map((m, idx) => (
              <div key={idx} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "assistant" && (
                  <div className="w-5 h-5 rounded bg-accent-soft text-accent flex items-center justify-center shrink-0 mt-0.5">
                    <Cpu className="w-3 h-3" />
                  </div>
                )}
                <div
                  className={`max-w-[90%] rounded-xl p-2.5 leading-relaxed ${
                    m.role === "user"
                      ? "bg-accent-soft border border-accent/30 text-ink"
                      : "bg-white border border-line/[0.04] text-ink"
                  }`}
                >
                  <span className="text-[9px] font-mono font-bold block mb-1 uppercase tracking-wider text-ink-faint">
                    {m.role === "user" ? "You" : `0G TEE (${selectedModel})`}
                  </span>
                  <div className="text-xs">
                    {m.content ? (
                      <FormattedMarkdown text={m.content} />
                    ) : chatLoading && idx === messages.length - 1 ? (
                      <span className="flex items-center gap-1 text-accent font-mono text-xs">
                        <RefreshCw className="w-3 h-3 animate-spin" /> Reasoning on 0G…
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <form onSubmit={sendMessage} className="p-2 border-t border-line/[0.06] bg-cream-2 flex gap-2 shrink-0">
            <input
              type="text"
              placeholder="Ask the 0G co-pilot…"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              disabled={chatLoading}
              className="flex-1 rounded-lg px-2.5 py-1.5 text-ink font-sans text-xs bg-cream-2 border border-line/[0.06] focus:border-accent/30 focus:outline-none"
            />
            <button
              type="submit"
              disabled={chatLoading || !inputMessage.trim()}
              className="px-3 py-1.5 rounded-lg font-bold text-xs bg-accent hover:bg-accent-strong text-white disabled:opacity-50"
            >
              <Send className="w-3 h-3" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── presentational helpers ──────────────────────────────────────────────────

/**
 * Pembungkus satu langkah peluncuran.
 *
 * Prop `tone` dihapus. Ia dulu menerima "pink" | "purple" | "cyan" dan memilih
 * warna tepi serta judul — tetapi setelah palet disatukan menjadi satu aksen,
 * ketiga cabangnya mengembalikan kelas yang sama persis. Yang tertinggal hanyalah
 * ternary yang menyaran ada perbedaan padahal tidak ada, dan setiap pemanggil
 * harus memilih salah satu warna tanpa akibat apa pun.
 *
 * `id` ditambahkan supaya rel langkah di atas panel bisa menggulir ke sini.
 */
function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-3 space-y-2 rounded-xl border border-line bg-cream-2 p-3">
      <span className="text-xs font-mono font-bold uppercase tracking-wider text-ink">{title}</span>
      {children}
    </div>
  );
}

/**
 * Rel langkah.
 *
 * Sebelumnya panel kiri adalah satu kolom bergulir setinggi ~2.400 px berisi
 * spanduk peringatan, matriks chain, tiga seksi bernomor, dua kotak verifikasi,
 * tombol launch, lalu tabel penjelasan — tanpa satu pun penunjuk posisi. Efeknya:
 * tidak terlihat ada berapa langkah, di langkah mana kita berada, dan yang paling
 * merugikan, APA yang masih menahan tombol launch. Tombolnya sendiri hanya bisa
 * menyebut satu penghalang sekaligus ("Sign attestation to unlock"), jadi
 * penghalang berikutnya baru muncul setelah yang pertama beres.
 *
 * Rel ini murni pembacaan: setiap `done` dihitung dari state yang sudah ada dan
 * tidak ada nilai baru yang mengalir ke `canDeploy`, ke calldata, atau ke server.
 */
function StepRail({
  steps,
}: {
  steps: Array<{ id: string; label: string; done: boolean }>;
}) {
  return (
    <nav aria-label="Launch steps" className="sticky top-0 z-10 -mx-3 mb-1 bg-white/95 px-3 pb-2 pt-1 backdrop-blur sm:-mx-4 sm:px-4">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1.5 font-mono text-[10px]">
        {steps.map((step, i) => (
          <li key={step.id} className="flex items-center gap-1">
            <a
              href={`#${step.id}`}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors ${
                step.done
                  ? "border-ok/30 bg-ok/10 text-ok"
                  : "border-line bg-cream-2 text-ink-soft hover:text-ink"
              }`}
            >
              {step.done ? (
                <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-3 w-3 shrink-0 items-center justify-center rounded-full border border-current text-[7px] font-bold"
                >
                  {i + 1}
                </span>
              )}
              <span className="font-bold uppercase tracking-wider">{step.label}</span>
              <span className="sr-only">{step.done ? " — done" : " — not done yet"}</span>
            </a>
            {i < steps.length - 1 && (
              <span aria-hidden="true" className="h-px w-2 bg-line-strong" />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Field({
  label,
  hint,
  hintTone = "muted",
  children,
}: {
  label: string;
  hint?: string;
  hintTone?: "ok" | "error" | "muted";
  children: React.ReactNode;
}) {
  const hintColor = hintTone === "ok" ? "text-ok" : hintTone === "error" ? "text-danger" : "text-ink-faint";
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium text-ink-soft">{label}</span>
        {hint && <span className={`text-[9px] font-mono ${hintColor} truncate`}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function ResultRow({ result }: { result: ChainResult }) {
  const tone =
    result.status === "success"
      ? "bg-ok/10 border-ok/30 text-ok"
      : result.status === "failed"
      ? "bg-danger/10 border-danger/30 text-danger"
      : "bg-cream-3/[0.03] border-line text-ink-soft";

  return (
    <div className={`p-2 rounded-xl border flex items-center justify-between gap-2 font-mono text-[10px] ${tone}`}>
      <span className="font-bold shrink-0">{result.chainName}</span>
      <span className="flex items-center gap-1.5 min-w-0">
        {result.status === "success" ? (
          <CheckCircle2 className="w-3 h-3 text-ok shrink-0" />
        ) : result.status === "failed" ? (
          <XCircle className="w-3 h-3 text-danger shrink-0" />
        ) : (
          <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
        )}
        <span className="truncate">{result.message ?? result.status}</span>
      </span>
    </div>
  );
}

function DeployReport({
  results,
  symbol,
  onReset,
}: {
  results: ChainResult[];
  symbol: string;
  onReset: () => void;
}) {
  const successes = results.filter((r) => r.status === "success");
  const failures = results.filter((r) => r.status === "failed");
  const allFailed = successes.length === 0;

  return (
    <div className="space-y-4 my-auto">
      <div
        className={`p-4 rounded-2xl border space-y-1 ${
          allFailed ? "bg-danger/10 border-danger/30" : "bg-ok/10 border-ok/30"
        }`}
      >
        <div className={`flex items-center gap-2 font-bold text-sm ${allFailed ? "text-danger" : "text-ok"}`}>
          {allFailed ? <XCircle className="w-5 h-5 text-danger" /> : <CheckCircle2 className="w-5 h-5 text-ok" />}
          {allFailed
            ? `Launch failed on all ${results.length} chain(s)`
            : `${symbol} live on ${successes.length} of ${results.length} chain(s)`}
        </div>
        {failures.length > 0 && !allFailed && (
          <p className="text-[11px] font-mono text-warn">
            {failures.length} chain(s) failed — details below. Nothing was registered for those.
          </p>
        )}
      </div>

      <div className="space-y-2 font-mono text-xs">
        {results.map((r) => (
          <div
            key={r.chainId}
            className={`p-3 rounded-xl border space-y-1.5 ${
              r.status === "success" ? "bg-cream-2 border-ok/30" : "bg-cream-2 border-danger/30"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-ink">
                {r.chainName} <span className="text-ink-faint">({r.chainId})</span>
              </span>
              <span className={r.status === "success" ? "text-ok" : "text-danger"}>{r.status}</span>
            </div>

            {r.status === "success" ? (
              <div className="space-y-1 text-[11px]">
                <Row label="Token" value={r.tokenAddress ?? "—"} />
                <Row label="Pool" value={r.poolAddress ?? "—"} />
                {r.explorerTx && (
                  <a
                    href={r.explorerTx}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline block"
                  >
                    View launch transaction →
                  </a>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-danger leading-relaxed">{r.message}</p>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 pt-2 font-sans">
        <button
          onClick={onReset}
          className="flex-1 py-2.5 rounded-xl bg-cream-3 hover:bg-cream-3 text-ink font-semibold text-xs transition-all"
        >
          Launch another
        </button>
        {successes.length > 0 && (
          <Link
            href={`/token/${symbol.toLowerCase()}`}
            className="flex-1 py-2.5 rounded-xl bg-accent hover:bg-accent-strong text-white font-semibold text-xs text-center flex items-center justify-center gap-1"
          >
            Open ${symbol} terminal →
          </Link>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-ink-soft shrink-0">{label}:</span>
      <span className="text-accent font-bold truncate">{value}</span>
    </div>
  );
}
