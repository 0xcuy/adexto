import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { keccak256, toHex } from "viem";
import { uploadMetadataTo0G } from "@/lib/upload-metadata-0g";
import { ADEXTO_CONTRACTS } from "@/config/contracts";
import { resolveChain, resolveChainOrDefault, CHAIN_LIST } from "@/lib/chains";
import { checkSymbolAvailable, findProjectGroup, registerProject, listProjects } from "@/lib/registry";
import { FACTORY_V3_ABI, SOVEREIGN_CURVE_ABI } from "@/lib/dex";
import { recordLaunch, verifyWorldIdToken, worldIdConfig } from "@/lib/worldid";
import { OPENING_MARKET_CAP_USD, nativePrices, openingVirtualNative } from "@/lib/native-price";

/**
 * Two-stage launch API.
 *
 * The previous single-stage version invented the token address with
 * `Math.random()` and persisted it unconditionally, so:
 *   - the address it displayed existed on no chain and every explorer link 404'd,
 *     even though the factory already returns the real address;
 *   - any anonymous caller could claim a reserved ticker such as AEGIS and take
 *     over the official /token/aegis page.
 *
 * Now:
 *   stage "prepare" — checks ticker availability and anchors the metadata to 0G DA,
 *                     returning the attestation root that goes into the calldata.
 *   stage "confirm" — verifies the mined transaction on-chain, reads token + pool
 *                     from the `TrinityProjectDeployed` event, reads the pool
 *                     reserves for the real opening price, then registers.
 *
 * Nothing is registered without a confirmed receipt.
 */
export const dynamic = "force-dynamic";

const AGENT_MODEL = "0G Router (glm-5.2 + AMD SEV-SNP)";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({
      factories: CHAIN_LIST.map((c) => ({
        chainKey: c.key,
        chainId: c.chainId,
        chainName: c.name,
        factoryV2: c.factoryV2Address, factoryV3: c.factoryV3Address, launchGeneration: c.launchGeneration,
        dexLive: c.dexLive,
      })),
      registered: listProjects().map((p) => p.symbol),
    });
  }
  // Availability is per chain, so the caller may ask about specific chains.
  const creator = searchParams.get("creator");
  const chainIds = (searchParams.get("chainIds") || "")
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v) && v > 0);

  if (chainIds.length > 0) {
    const perChain = chainIds.map((chainId) => {
      const c = checkSymbolAvailable(symbol, chainId, creator);
      return {
        chainId,
        chainKey: resolveChain(chainId)?.key ?? null,
        available: c.available,
        reason: c.available ? null : c.reason,
      };
    });
    const blocked = perChain.filter((p) => !p.available);
    return NextResponse.json({
      symbol: symbol.toUpperCase(),
      available: blocked.length === 0,
      reason: blocked.length === 0 ? null : blocked[0].reason,
      perChain,
    });
  }

  const check = checkSymbolAvailable(symbol, null, creator);
  return NextResponse.json({
    symbol: symbol.toUpperCase(),
    available: check.available,
    reason: check.available ? null : check.reason,
    existingChains: findProjectGroup(symbol).map((p) => ({ chainId: p.chainId, chainKey: p.chainKey })),
  });
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON." }, { status: 400 });
  }

  const stage = String(body.stage || "prepare").toLowerCase();
  try {
    if (stage === "prepare") return await handlePrepare(body);
    if (stage === "confirm") return await handleConfirm(body);
    return NextResponse.json({ error: `Unknown stage "${stage}". Use "prepare" or "confirm".` }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Unexpected error" }, { status: 500 });
  }
}

// ─── Stage 1: prepare ──────────────────────────────────────────────────────

async function handlePrepare(body: any) {
  const symbol = String(body.symbol || "").trim().toUpperCase();
  const name = String(body.name || "").trim();
  const supply = Number(String(body.supply ?? "1000000000").replace(/[^0-9]/g, "")) || 0;

  if (!name) return NextResponse.json({ error: "Token name is required." }, { status: 400 });
  if (supply <= 0) return NextResponse.json({ error: "Supply must be greater than zero." }, { status: 400 });

  // Lapis pertama: tanda tangan wallet, terikat ke deployer yang diklaim, dan
  // diverifikasi di sini — bukan boolean di sisi klien seperti flag
  // "World ID verified" yang lama.
  const attestation = verifyLaunchAttestation(body);
  if (!attestation.ok) {
    return NextResponse.json({ error: attestation.error, code: "ATTESTATION_INVALID" }, { status: 401 });
  }

  // Lapis kedua: proof World ID. Tanda tangan wallet hanya membuktikan kendali
  // atas SEBUAH alamat, dan alamat baru bisa dibuat tanpa batas, jadi lapis
  // pertama sendirian bukan hambatan Sybil. Gerbang ini menyala hanya bila World
  // ID dikonfigurasi; kalau tidak, perilaku lama dipertahankan dan UI menyatakan
  // apa adanya.
  //
  // Wajib diperiksa DI SINI, bukan cuma di UI: tanpa ini penyerang tinggal
  // memanggil endpoint ini langsung dan melewati widget sepenuhnya.
  const worldId = worldIdConfig();
  let worldIdNullifier: string | null = null;
  if (worldId.enabled) {
    const check = verifyWorldIdToken(String(body.worldIdToken || ""), attestation.signer);
    if (!check.ok) {
      return NextResponse.json({ error: check.error, code: check.code }, { status: 401 });
    }
    worldIdNullifier = check.nullifierHash;
  }

  const requested: string[] = Array.isArray(body.targetChains) && body.targetChains.length > 0
    ? body.targetChains
    : [body.chain || "0G"];

  const chains = requested
    .map((c: string) => resolveChain(c))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  if (chains.length === 0) {
    return NextResponse.json({ error: "No recognised target chain." }, { status: 400 });
  }

  // Availability is evaluated per target chain. The same creator extending their
  // own ticker onto more chains is the whole point of the one-click multi-chain
  // launch, so it must not be treated as a duplicate.
  const checks = chains.map((c) => ({ chain: c, check: checkSymbolAvailable(symbol, c.chainId, body.deployer) }));
  const blocked = checks.filter((r) => !r.check.available) as Array<{
    chain: (typeof chains)[number];
    check: { available: false; reason: string };
  }>;

  if (blocked.length === chains.length) {
    return NextResponse.json(
      {
        error: blocked[0].check.reason,
        code: "SYMBOL_UNAVAILABLE",
        perChain: blocked.map((b) => ({
          chainId: b.chain.chainId,
          chainKey: b.chain.key,
          reason: b.check.reason,
        })),
      },
      { status: 409 }
    );
  }

  const allowed = chains.filter((c) => !blocked.some((b) => b.chain.chainId === c.chainId));
  const deployable = allowed.filter((c) => c.dexLive && (c.factoryV3Address || c.factoryV2Address));
  const unavailable = [
    ...allowed
      .filter((c) => !c.dexLive || !(c.factoryV3Address || c.factoryV2Address))
      .map((c) => ({
        chainKey: c.key,
        chainId: c.chainId,
        chainName: c.name,
        reason: "No ADEXTO factory is deployed on this chain yet, so no tradable market can be created.",
      })),
    ...blocked.map((b) => ({
      chainKey: b.chain.key,
      chainId: b.chain.chainId,
      chainName: b.chain.name,
      reason: b.check.reason,
    })),
  ];

  const lpFeeBps = Math.round((Number(body.swapFee ?? 0.3) - Number(body.treasuryCut ?? 0.1)) * 100);
  const treasuryBuybackBps = Math.round(Number(body.treasuryCut ?? 0.1) * 100);

  const opening = await resolveOpenings(deployable);
  if (!opening.ok) {
    return NextResponse.json({ error: opening.error, code: "OPENING_PRICE_UNAVAILABLE" }, { status: 503 });
  }
  const openings = opening.openings;

  const metadata = {
    protocol: "ADEXTO Protocol (adexto.xyz)",
    version: "2.5.0",
    ecosystem: {
      token: { name, symbol, supply, standard: "ERC-8004", curve: "Bonding curve over a virtual reserve" },
      dex: {
        type: "Sovereign bonding curve",
        lpFeeBps,
        treasuryBuybackBps,
        subdomain: `https://${symbol.toLowerCase()}.adexto.xyz`,
      },
      agent: {
        model: String(body.model || "glm-5.2"),
        computeHost: "0G Compute Router Mainnet (Chain 16661)",
        teeEnclave: "AMD SEV-SNP Hardware Attested",
        persona: String(body.persona || "Autonomous AI agent"),
      },
    },
    targetChainIds: chains.map((c) => c.chainId),
    deployer: body.deployer || ADEXTO_CONTRACTS.deployer,
    timestamp: new Date().toISOString(),
  };

  const storage = await uploadMetadataTo0G(metadata, `adexto_${symbol.toLowerCase()}_meta.json`);
  const storageRoot =
    storage.root && /^0x[a-fA-F0-9]{64}$/.test(storage.root)
      ? storage.root
      : keccak256(toHex(`ADEXTO_${symbol}_${Date.now()}`));

  return NextResponse.json({
    success: true,
    stage: "prepare",
    symbol,
    // Dilaporkan supaya klien (dan harness) bisa memastikan gerbang mana yang
    // benar-benar dilewati, bukan menebak dari copy UI.
    sybilGate: worldId.enabled ? "world-id-zkp" : "wallet-signature-only",
    worldIdNullifierPrefix: worldIdNullifier ? `${worldIdNullifier.slice(0, 10)}…` : null,
    attestationRoot: storageRoot,
    daStorageTx: storage.tx ?? null,
    daStorageOk: storage.ok,
    lpFeeBps,
    treasuryBuybackBps,
    supply,
    // Market cap buka DITETAPKAN SERVER, bukan diambil dari angka paku di config.
    // `virtualNative` per chain sudah dihitung dari harga live, sehingga satu
    // ticker yang diluncurkan ke 4 chain membuka pada nilai USD yang sama.
    openingMarketCapUsd: OPENING_MARKET_CAP_USD,
    deployTargets: deployable.map((c) => ({
      chainKey: c.key,
      chainId: c.chainId,
      chainName: c.name,
      factoryV2: c.factoryV2Address, factoryV3: c.factoryV3Address, launchGeneration: c.launchGeneration,
      nativeSymbol: c.nativeSymbol,
      virtualNative: String(openings[c.chainId].virtualNative),
      nativePriceUsd: openings[c.chainId].priceUsd,
      openingPriceNative: openings[c.chainId].virtualNative / supply,
    })),
    unavailableChains: unavailable,
    metadata,
  });
}

/**
 * Hitung `virtualNative` per chain dari harga live.
 *
 * MENOLAK bila harga chain mana pun bukan harga live. Kurva tidak bisa diubah
 * setelah dibuat, jadi market cap yang salah bersifat permanen — lebih baik
 * launch-nya gagal sekarang daripada pasar itu salah harga selamanya. Hanya chain
 * yang benar-benar dituju yang diperiksa, sehingga feed MON yang mati tidak
 * memblokir launch khusus 0G.
 */
async function resolveOpenings(
  chains: Array<{ chainId: number; key: string; nativeSymbol: string }>
): Promise<
  | { ok: true; openings: Record<number, { virtualNative: number; priceUsd: number }> }
  | { ok: false; error: string }
> {
  const { prices, live } = await nativePrices();
  const openings: Record<number, { virtualNative: number; priceUsd: number }> = {};
  const stale: string[] = [];

  for (const c of chains) {
    const priceUsd = prices[c.nativeSymbol];
    if (!live[c.nativeSymbol] || !priceUsd) {
      stale.push(`${c.key} (${c.nativeSymbol})`);
      continue;
    }
    const virtualNative = openingVirtualNative(priceUsd);
    if (virtualNative <= 0) {
      stale.push(`${c.key} (${c.nativeSymbol})`);
      continue;
    }
    openings[c.chainId] = { virtualNative, priceUsd };
  }

  if (stale.length > 0) {
    return {
      ok: false,
      error:
        `No live price for ${stale.join(", ")}, so the opening market cap cannot be set. ` +
        `A curve cannot be repriced after deployment, so the launch is refused rather than guessed.`,
    };
  }
  return { ok: true, openings };
}

type AttestationResult = { ok: true; signer: string } | { ok: false; error: string };

/**
 * Verify that whoever is launching controls the address they claim.
 *
 * Ini sengaja disebut attestation ALAMAT: ia membuktikan kendali atas sebuah
 * alamat, bukan keunikan manusia. Lapisan anti-Sybil-nya terpisah, lewat proof
 * World ID di `src/lib/worldid.ts`, dan menyala begitu
 * NEXT_PUBLIC_WORLD_ID_APP_ID serta NEXT_PUBLIC_WORLD_ID_ACTION terisi.
 */
function verifyLaunchAttestation(body: any): AttestationResult {
  const signature = String(body.attestationSignature || "");
  const message = String(body.attestationMessage || "");
  const claimed = String(body.deployer || "");

  if (!signature || !message) {
    return { ok: false, error: "A signed launch attestation is required before deploying." };
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(claimed)) {
    return { ok: false, error: "A valid deployer address is required." };
  }
  if (!message.includes(claimed)) {
    return { ok: false, error: "The attestation message must bind the deployer address." };
  }

  const timestampMatch = message.match(/Timestamp:\s*(\d+)/);
  if (!timestampMatch) return { ok: false, error: "The attestation message must include a timestamp." };
  const age = Date.now() - Number(timestampMatch[1]);
  if (!Number.isFinite(age) || age < -60_000 || age > 30 * 60_000) {
    return { ok: false, error: "The attestation has expired. Sign again." };
  }

  try {
    const recovered = ethers.verifyMessage(message, signature);
    if (recovered.toLowerCase() !== claimed.toLowerCase()) {
      return { ok: false, error: "The attestation signature does not match the deployer address." };
    }
    return { ok: true, signer: recovered };
  } catch {
    return { ok: false, error: "The attestation signature could not be verified." };
  }
}

// ─── Stage 2: confirm ──────────────────────────────────────────────────────

async function handleConfirm(body: any) {
  const txHash = String(body.txHash || "");
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return NextResponse.json({ error: "A confirmed 32-byte txHash is required." }, { status: 400 });
  }

  const chain = resolveChain(body.chainId ?? body.chain);
  if (!chain) return NextResponse.json({ error: "Unknown chainId." }, { status: 400 });

  const symbol = String(body.symbol || "").trim().toUpperCase();

  // Gerbang World ID ditegakkan di TAHAP INI JUGA, bukan hanya di prepare.
  // Tahap inilah yang menulis ke registry, dan ia bisa dipanggil langsung tanpa
  // pernah melewati prepare — jadi memeriksa hanya di prepare menyisakan pintu
  // samping yang lebar.
  const worldId = worldIdConfig();
  let confirmedNullifier: string | null = null;
  if (worldId.enabled) {
    const claimant = /^0x[a-fA-F0-9]{40}$/.test(String(body.creator || "")) ? String(body.creator) : "";
    if (!claimant) {
      return NextResponse.json(
        { error: "A creator address is required while the World ID gate is active.", code: "BAD_ADDRESS" },
        { status: 400 }
      );
    }
    const check = verifyWorldIdToken(String(body.worldIdToken || ""), claimant);
    if (!check.ok) {
      return NextResponse.json({ error: check.error, code: check.code }, { status: 401 });
    }
    confirmedNullifier = check.nullifierHash;
  }

  // Scoped to this chain, so chains 2..4 of a multi-chain launch are not rejected
  // as duplicates of chain 1.
  const availability = checkSymbolAvailable(symbol, chain.chainId, body.creator);
  if (!availability.available) {
    return NextResponse.json({ error: availability.reason, code: "SYMBOL_UNAVAILABLE" }, { status: 409 });
  }

  const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    return NextResponse.json(
      { error: `Transaction ${txHash} was not found on ${chain.name}. Wait for confirmation and retry.` },
      { status: 404 }
    );
  }
  if (receipt.status !== 1) {
    return NextResponse.json({ error: `Transaction ${txHash} reverted on ${chain.name}.` }, { status: 400 });
  }

  // Recover token + pool from the factory event rather than trusting the client.
  const iface = new ethers.Interface(FACTORY_V3_ABI);
  let tokenAddress: string | null = null;
  let poolAddress: string | null = null;
  let onChainSymbol: string | null = null;
  let poolNative = 0;
  let poolTokens = 0;

  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === "TrinityProjectDeployed") {
        tokenAddress = parsed.args.token;
        // v3 names the venue `curve`; v2 named it `pool`. Accept either so a
        // registry written by one generation is still readable by the other.
        poolAddress = parsed.args.curve ?? parsed.args.pool;
        onChainSymbol = String(parsed.args.symbol).toUpperCase();
        // v3 has no native deposit: the native side opens as `virtualNative`.
        poolNative = Number(ethers.formatEther(BigInt(parsed.args.virtualNative ?? parsed.args.poolNativeAmount ?? 0)));
        poolTokens = Number(
          ethers.formatUnits(BigInt(parsed.args.curveTokens ?? parsed.args.poolTokenAmount ?? 0), 18)
        );
        break;
      }
    } catch {
      // not a factory event
    }
  }

  if (!tokenAddress) {
    return NextResponse.json(
      {
        error:
          "The transaction did not emit TrinityProjectDeployed. Launches must go through an ADEXTO factory so the token and market addresses come from the chain.",
      },
      { status: 400 }
    );
  }
  if (onChainSymbol && onChainSymbol !== symbol) {
    return NextResponse.json(
      { error: `Ticker mismatch: transaction minted ${onChainSymbol}, request claimed ${symbol}.` },
      { status: 400 }
    );
  }

  const code = await provider.getCode(tokenAddress);
  if (!code || code === "0x") {
    return NextResponse.json({ error: `No contract code at ${tokenAddress} on ${chain.name}.` }, { status: 400 });
  }

  // Opening price straight from the seeded reserves.
  let priceNative = poolTokens > 0 ? poolNative / poolTokens : 0;
  let poolLive = false;
  if (poolAddress) {
    try {
      const pool = new ethers.Contract(poolAddress, SOVEREIGN_CURVE_ABI, provider);
      const [initialized, reserves] = await Promise.all([pool.initialized(), pool.getReserves()]);
      poolLive = Boolean(initialized);
      const reserveNative = Number(ethers.formatEther(BigInt(reserves[0])));
      const reserveToken = Number(ethers.formatUnits(BigInt(reserves[1]), 18));
      if (reserveToken > 0) priceNative = reserveNative / reserveToken;
    } catch {
      poolLive = false;
    }
  }

  const targetChainIds = Array.isArray(body.targetChainIds) && body.targetChainIds.length > 0
    ? body.targetChainIds.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id))
    : [chain.chainId];

  // The label names the chain this market actually lives on. It used to claim
  // "Omnichain (0G + Arbitrum + Base + Monad)" from the *selected* chain list even
  // when the record existed on one chain, and every consumer then mis-resolved the
  // chain from that string.
  const chainLabel = chain.label;

  const record = registerProject({
    tokenAddress,
    poolAddress,
    creator: /^0x[a-fA-F0-9]{40}$/.test(String(body.creator || "")) ? String(body.creator) : receipt.from,
    name: String(body.name || symbol),
    symbol,
    chainId: chain.chainId,
    chainLabel,
    targetChainIds,
    priceNative,
    supply: Number(String(body.supply ?? "1000000000").replace(/[^0-9]/g, "")) || 1_000_000_000,
    lpFeeBps: Number(body.lpFeeBps ?? 20),
    treasuryBuybackBps: Number(body.treasuryBuybackBps ?? 10),
    agentModel: body.agentModel || AGENT_MODEL,
    agentPersona: body.persona || undefined,
    category: body.category || "defi",
    image: body.image || "/logo.svg",
    txHash,
    blockNumber: receipt.blockNumber,
    teeRoot: /^0x[a-fA-F0-9]{64}$/.test(String(body.attestationRoot || "")) ? String(body.attestationRoot) : null,
    daStorageTx: body.daStorageTx || null,
    poolLive,
  });

  // Kuota dicatat SETELAH launch benar-benar terdaftar, bukan saat verifikasi.
  // Kalau dicatat lebih awal, percobaan yang gagal — tx revert, RPC putus —
  // akan menghanguskan hak launch seseorang tanpa dia mendapat apa pun.
  if (confirmedNullifier) recordLaunch(confirmedNullifier);

  const siblings = findProjectGroup(symbol).filter((p) => p.chainId !== chain.chainId);

  return NextResponse.json({
    success: true,
    stage: "confirm",
    sybilGate: worldId.enabled ? "world-id-zkp" : "wallet-signature-only",
    message: `${symbol} verified on ${chain.name} and registered.`,
    project: record,
    alsoOn: siblings.map((p) => ({
      chainId: p.chainId,
      chainKey: p.chainKey,
      tokenAddress: p.tokenAddress,
      poolAddress: p.poolAddress,
    })),
    deployment: {
      chainId: chain.chainId,
      chainName: chain.name,
      token: {
        name: record.name,
        symbol: record.symbol,
        address: record.tokenAddress,
        supply: record.supply,
        standard: "ERC-8004 (Agent Identity Bound)",
        explorer: `${chain.blockExplorer}/address/${record.tokenAddress}`,
      },
      sovereignDex: {
        poolAddress: record.poolAddress,
        poolLive,
        openingPriceNative: priceNative,
        nativeSymbol: chain.nativeSymbol,
        lpFeeBps: record.lpFeeBps,
        treasuryBuybackBps: record.treasuryBuybackBps,
        subdomain: `https://${record.slug}.adexto.xyz`,
        explorer: record.poolAddress ? `${chain.blockExplorer}/address/${record.poolAddress}` : null,
      },
      agentEnclave: {
        model: record.agentModel,
        enclaveHost: "pc.0g.ai/v1 (0G AMD SEV-SNP)",
        storageRoot: record.teeRoot,
        storageTx: record.daStorageTx,
        signerAddress: record.creator,
      },
      transactionHash: txHash,
      blockNumber: receipt.blockNumber,
      explorerTx: `${chain.blockExplorer}/tx/${txHash}`,
    },
  });
}
