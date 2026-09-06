import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { keccak256, toHex } from "viem";
import { uploadMetadataTo0G } from "@/lib/upload-metadata-0g";
import { ADEXTO_CONTRACTS } from "@/config/contracts";
import { resolveChain, resolveChainOrDefault, CHAIN_LIST } from "@/lib/chains";
import {
  checkSymbolAvailable,
  creatorQuota,
  creatorTickers,
  findProjectGroup,
  registerProject,
  listProjects,
  RegistryLimitError,
} from "@/lib/registry";
import { CURVE_FACTORY_ABI, SOVEREIGN_CURVE_ABI, readFactoryGeneration } from "@/lib/dex";
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

// "+ AMD SEV-SNP" dibuang: router 0G menyatakan tee_type=TDX, verifier dstack.
const AGENT_MODEL = "0G Router (glm-5.3 · Intel TDX attested)";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol");
  if (!symbol) {
    /**
     * The factory's own VERSION and protocol fee are READ FROM CHAIN, not asserted.
     *
     * The studio has to tell a creator what a trader will actually pay, and since
     * 0.11.0 that is no longer the total the creator configures — the protocol leg is
     * charged on top of it. Reading the constant means the studio needs no edit when a
     * chain is upgraded, and cannot advertise a leg on a chain that does not charge one.
     */
    const generations = await Promise.all(
      CHAIN_LIST.map(async (c) => [c.chainId, await readFactoryGeneration(c)] as const)
    );
    const genOf = new Map(generations);
    return NextResponse.json({
      factories: CHAIN_LIST.map((c) => {
        const gen = genOf.get(c.chainId)!;
        return {
          chainKey: c.key,
          chainId: c.chainId,
          chainName: c.name,
          curveFactory: c.curveFactoryAddress, launchGeneration: c.launchGeneration,
          dexLive: c.dexLive,
          factoryVersion: gen.version,
          protocolFeeBps: gen.protocolFeeBps,
          protocolTreasury: gen.protocolTreasury,
          // Factory generasi sebelumnya di chain ini, kalau ada. Hanya untuk
          // verifikasi — pasar lamanya tetap bisa diperdagangkan dan tetap memakai
          // kaki fee aslinya, yang tidak memuat fee protokol.
          supersededCurveFactory: c.supersededCurveFactoryAddress,
        };
      }),
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

  // Tanda tangan wallet, terikat ke deployer yang diklaim, dan diverifikasi di
  // sini — bukan boolean di sisi klien. Inilah satu-satunya gerbang endpoint ini.
  //
  // Yang dibuktikannya: pemanggil mengendalikan alamat yang diklaimnya. Yang TIDAK
  // dibuktikannya: bahwa pemanggil orang yang berbeda dari pemanggil sebelumnya —
  // alamat baru bisa dibuat tanpa batas dan tanpa biaya. Gerbang proof-of-personhood
  // dulu dimaksudkan menutup celah itu dan sudah DICABUT; lihat catatan pada
  // `verifyLaunchAttestation` untuk apa yang sebenarnya masih membatasi spam.
  const attestation = verifyLaunchAttestation(body);
  if (!attestation.ok) {
    return NextResponse.json({ error: attestation.error, code: "ATTESTATION_INVALID" }, { status: 401 });
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

  /**
   * Kuota diperiksa DI SINI, sebelum apa pun ditandatangani.
   *
   * Tahap confirm juga menegakkannya, dan harus — ia bisa dipanggil langsung tanpa
   * pernah melewati prepare. Tapi menegakkannya HANYA di sana berarti penolakan datang
   * setelah transaksi mined dan gas terbayar, yaitu saat paling tidak berguna bagi
   * pemanggil. Jadi ini bukan duplikasi yang bisa dihapus: yang di bawah untuk keamanan,
   * yang di sini supaya orang tidak membakar gas untuk listing yang sudah pasti ditolak.
   */
  const quota = creatorQuota(body.deployer);
  const alreadyOwned = creatorTickers(body.deployer).has(symbol.toUpperCase());
  if (!alreadyOwned && quota.remaining === 0) {
    return NextResponse.json(
      {
        error:
          `This address has listed ${quota.used} tickers, which is the limit of ${quota.max} per address. ` +
          `Extending a ticker you already own onto more chains is still allowed.`,
        code: "CREATOR_TICKER_LIMIT",
        quota,
      },
      { status: 409 }
    );
  }

  const allowed = chains.filter((c) => !blocked.some((b) => b.chain.chainId === c.chainId));
  const deployable = allowed.filter((c) => c.dexLive && c.curveFactoryAddress);
  const unavailable = [
    ...allowed
      .filter((c) => !c.dexLive || !c.curveFactoryAddress)
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

  // Depth fee = total − creator − buyback, PERSIS seperti AdextoCurveFactory
  // menghitung `depthFeeBps = swapFeeBps - creatorShareBps - treasuryShareBps`.
  //
  // Formula lama di sini `swapFee - treasuryCut` LUPA mengurangi bagian creator,
  // jadi ia melaporkan depth 0.25% untuk peluncuran 0.30% Standard yang on-chain
  // depth-nya 0.15%. Angka itu lalu ditimpa balik ke studio dan disimpan di
  // registry, sehingga terminal menampilkan "Curve depth (0.25%)" bersebelahan
  // dengan nilai dolar yang justru dihitung dari 0.15% — kontradiksi di satu layar.
  /**
   * Fee parameters are VALIDATED, not merely defaulted.
   *
   * These three numbers came straight from the request body with nothing but `??`
   * defaults. The only ceiling anywhere was `MAX_TOTAL_FEE_BPS = 500` inside the curve,
   * so a caller could POST `creatorCut: 4.9` and deploy a market that skims 4.9% of every
   * swap into their own pocket. The studio never sends that, but the studio is not the
   * only thing that can POST here.
   *
   * That mattered more than a normal input bug because the split is `immutable` in
   * `SovereignCurve`: there is no setter and no admin, so a market launched with a hostile
   * split stays hostile for as long as the chain exists. It would also have been listed on
   * this site, under our own explorer, with our own "gas only" framing around it.
   *
   * Values are REJECTED rather than silently clamped. Quietly rewriting someone's fee
   * split and then permanently deploying it is worse than refusing: the caller would have
   * no idea the market they own does not match what they asked for.
   */
  const FEE_BOUNDS = {
    // Floor keeps a market from launching with no depth accrual at all; ceiling stays
    // under the 1% that pump.fun charges, which is the comparison this product invites.
    swapFee: { min: 0.05, max: 1.0 },
    creatorCut: { min: 0, max: 0.5 },
    treasuryCut: { min: 0, max: 0.5 },
  } as const;

  const swapFeeRaw = Number(body.swapFee ?? 0.3);
  const creatorCut = Number(body.creatorCut ?? 0.1);
  const treasuryCut = Number(body.treasuryCut ?? 0.05);

  for (const [name, value] of [
    ["swapFee", swapFeeRaw],
    ["creatorCut", creatorCut],
    ["treasuryCut", treasuryCut],
  ] as const) {
    const { min, max } = FEE_BOUNDS[name];
    if (!Number.isFinite(value) || value < min || value > max) {
      return NextResponse.json(
        {
          error: `${name} must be a number between ${min}% and ${max}%. Received: ${body[name]}`,
          code: "FEE_OUT_OF_RANGE",
        },
        { status: 400 }
      );
    }
  }

  // Depth is what remains, so the parts may never exceed the whole. Without this the
  // subtraction below goes negative and `Math.round` hands the factory a nonsense depth.
  if (creatorCut + treasuryCut > swapFeeRaw) {
    return NextResponse.json(
      {
        error:
          `creatorCut (${creatorCut}%) + treasuryCut (${treasuryCut}%) cannot exceed the ` +
          `total swapFee (${swapFeeRaw}%). Depth fee is whatever is left over.`,
        code: "FEE_SPLIT_INVALID",
      },
      { status: 400 }
    );
  }

  const lpFeeBps = Math.round((swapFeeRaw - creatorCut - treasuryCut) * 100);
  const treasuryBuybackBps = Math.round(treasuryCut * 100);
  const creatorFeeBps = Math.round(creatorCut * 100);

  /**
   * Kaki protokol dibaca dari factory tiap chain yang benar-benar dituju.
   *
   * `swapFeeBps` yang dikirim creator BUKAN lagi yang dibayar trader: sejak factory
   * 0.11.0 `PROTOCOL_FEE_BPS` dipungut DI ATAS total itu, jadi konfigurasi 0.30%
   * menghasilkan 0.40% yang benar-benar keluar dari dompet. Angka itu harus dilaporkan,
   * bukan dibiarkan tersirat — kalau tidak, satu-satunya tempat kaki keempat muncul
   * adalah di dalam kontrak, dan creator baru mengetahuinya setelah pasarnya permanen.
   *
   * Dibaca PER CHAIN karena rollout-nya bisa bertahap: satu chain sudah 0.11.0
   * sementara yang lain masih 0.10.0, dan satu angka gabungan akan salah di salah satu
   * sisi. Nol berarti factory chain itu memang tidak punya kaki protokol.
   */
  const protocolLegs = await Promise.all(
    deployable.map(async (c) => [c.chainId, await readFactoryGeneration(c)] as const)
  );
  const legOf = new Map(protocolLegs);
  const protocolFeeBpsByChain = Object.fromEntries(
    protocolLegs.map(([chainId, gen]) => [String(chainId), gen.protocolFeeBps])
  );
  const maxProtocolFeeBps = protocolLegs.reduce((m, [, gen]) => Math.max(m, gen.protocolFeeBps), 0);

  /**
   * Cap 5% diperiksa di sini juga, terhadap total yang SUDAH termasuk kaki protokol.
   *
   * Factory sendiri sudah menuntut `swapFeeBps + PROTOCOL_FEE_BPS <= 500`, tapi kalau
   * pemeriksaannya hanya di sana, permintaan yang melewati batas baru gagal di tengah
   * transaksi launch — setelah metadata di-anchor ke 0G DA dan setelah pengguna
   * menandatangani. Menolaknya lebih awal membuat kegagalannya bisa dijelaskan.
   */
  const totalPaidBps = Math.round(swapFeeRaw * 100) + maxProtocolFeeBps;
  if (totalPaidBps > 500) {
    return NextResponse.json(
      {
        error:
          `Total fee a trader would pay is ${(totalPaidBps / 100).toFixed(2)}%, above the 5% cap the ` +
          `curve enforces. swapFee is ${swapFeeRaw}% and the protocol leg on the target chains adds ` +
          `${(maxProtocolFeeBps / 100).toFixed(2)}%.`,
        code: "FEE_OUT_OF_RANGE",
      },
      { status: 400 }
    );
  }

  const opening = await resolveOpenings(deployable);
  if (!opening.ok) {
    return NextResponse.json({ error: opening.error, code: "OPENING_PRICE_UNAVAILABLE" }, { status: 503 });
  }
  const openings = opening.openings;

  // Metadata ini di-anchor permanen ke 0G DA dan di-hash jadi metadataRoot. Tiga
  // klaim lama di sini adalah versi tertanam dari yang sudah dibersihkan di UI:
  //   version "2.5.0"  -> produk belum pernah publish; sekarang ikut VERSION factory.
  //   standard "ERC-8004" -> dulu SALAH: AdextoToken hanya menyimpan satu address
  //     immutable agentIdentity. Sejak factory 0.10.0 token BISA terikat ke agentId
  //     ERC-8004 sungguhan, tapi hanya kalau creator memilihnya — jadi `standard`
  //     tetap "ERC-20" (itu yang token ini), dan pengikatan agent dilaporkan
  //     terpisah di bawah, per-launch, bukan sebagai sifat tetap protokol.
  //   teeEnclave "AMD SEV-SNP Hardware Attested" -> FALSE, dan ini persis klaim
  //     yang dicabut dari landing/docs. Router 0G menyatakan Intel TDX lewat
  //     dstack; kami MEMBACA deklarasi itu, tidak memverifikasi raw quote-nya,
  //     dan hardware-nya bukan SEV-SNP. Membiarkannya di metadata berarti setiap
  //     launch meninggalkan jejak attestation palsu yang permanen.
  /**
   * `version` DIBACA dari factory, per chain, bukan dituliskan sebagai teks.
   *
   * Ini dokumen yang di-anchor permanen ke 0G DA dan di-hash menjadi `metadataRoot`.
   * Angka yang salah di sini tidak bisa dikoreksi nanti — hanya bisa dibantah oleh
   * dokumen lain, yang justru memperburuk. Nilai tetap "0.10.0" akan berbohong pada
   * setiap launch begitu ada satu chain yang naik ke 0.11.0, dan tidak ada apa pun
   * yang memaksa string itu ikut berubah.
   *
   * Dicatat per chain karena rollout-nya bisa bertahap: satu ticker yang diluncurkan
   * ke empat chain bisa lahir dari dua generasi factory sekaligus, dan satu angka
   * gabungan akan salah di sebagian chain. `null` berarti factory-nya tidak menjawab
   * `VERSION()`, dan itu dicatat apa adanya alih-alih ditebak.
   */
  const factoryVersionByChain = Object.fromEntries(
    deployable.map((c) => [String(c.chainId), legOf.get(c.chainId)?.version ?? null])
  );

  const metadata = {
    protocol: "ADEXTO Protocol (adexto.xyz)",
    factoryVersionByChain,
    ecosystem: {
      token: { name, symbol, supply, standard: "ERC-20", curve: "Bonding curve over a virtual reserve" },
      dex: {
        type: "Sovereign bonding curve",
        lpFeeBps,
        creatorFeeBps,
        treasuryBuybackBps,
        /**
         * Kaki protokol dicatat per chain, dan `totalPaidBps` adalah yang benar-benar
         * dibayar trader. Tanpa keduanya, dokumen permanen ini hanya memuat total yang
         * dikonfigurasi creator — angka yang, sejak 0.11.0, bukan lagi biaya sebenarnya.
         */
        protocolFeeBpsByChain,
        totalConfiguredBps: lpFeeBps + creatorFeeBps + treasuryBuybackBps,
        totalPaidBps,
        subdomain: `https://${symbol.toLowerCase()}.adexto.xyz`,
      },
      agent: {
        model: String(body.model || "glm-5.3"),
        computeHost: "0G Compute Router",
        // Deklarasi router, bukan bukti kami. Lihat /docs dan /api/tee.
        teeAttestation: "0G router reports Intel TDX via dstack; raw quote not verified by ADEXTO",
        persona: String(body.persona || "Autonomous AI agent"),
        /**
         * ERC-8004 binding, as requested for THIS launch.
         *
         * Recorded per launch rather than as a protocol-wide claim because it is
         * optional: most launches will not bind an agent, and a metadata field
         * asserting ERC-8004 on every one of them would be the same overreach the
         * old `standard: "ERC-8004"` was. The factory verifies ownership on-chain,
         * so a launch that says `bound: true` had its ownership checked.
         *
         * The id is recorded PER CHAIN. This document is anchored once and shared
         * by every chain in the launch, so a single `agentId` field would be
         * accurate on one chain and wrong on the others: the registry is at one
         * address everywhere but each keeps its own state, so the same agent has a
         * different id per chain.
         */
        erc8004: body.bindAgent
          ? {
              bound: true,
              agentIdByChain: Object.fromEntries(
                chains.map((c) => [
                  String(c.chainId),
                  {
                    agentId: String((body.agentIds ?? {})[c.chainId] ?? body.agentId ?? ""),
                    agentRegistry: `eip155:${c.chainId}:${ADEXTO_CONTRACTS.agentRegistry.toLowerCase()}`,
                  },
                ])
              ),
              identityRegistry: ADEXTO_CONTRACTS.agentRegistry,
              // Nama kontrak dibuang dari kalimat ini. Ia permanen di 0G DA, dan
              // factory 0.11.0 bernama `AdextoFactory` — menyebut nama lama akan
              // membekukan nama yang salah ke dalam dokumen yang tidak bisa dikoreksi.
              note: "Ownership verified on-chain by the launch factory at launch, per chain.",
            }
          : { bound: false, note: "No ERC-8004 agent identity was supplied for this launch." },
      },
    },
    targetChainIds: chains.map((c) => c.chainId),
    deployer: body.deployer || ADEXTO_CONTRACTS.deployer,
    timestamp: new Date().toISOString(),
  };

  const storage = await uploadMetadataTo0G(metadata, `adexto_${symbol.toLowerCase()}_meta.json`);
  /**
   * `metadataRoot` is either the 0G DA storage root, or — when anchoring failed — a
   * keccak commitment to the metadata bytes THEMSELVES.
   *
   * The fallback used to be `keccak256("ADEXTO_" + symbol + "_" + Date.now())`, which
   * committed to nothing: it could not be recomputed from the metadata, so it was an
   * unverifiable number occupying a field that claims to identify content. Hashing the
   * actual JSON means anyone can re-derive it from the metadata and check.
   *
   * `daStorageOk` below reports which of the two this is, so no caller has to guess.
   */
  const storageRoot =
    storage.root && /^0x[a-fA-F0-9]{64}$/.test(storage.root)
      ? storage.root
      : keccak256(toHex(JSON.stringify(metadata)));

  return NextResponse.json({
    success: true,
    stage: "prepare",
    symbol,
    // Dilaporkan supaya klien (dan harness) bisa memastikan gerbang mana yang
    // benar-benar dilewati, bukan menebak dari copy UI. Nilainya kini konstan
    // karena hanya ada satu gerbang; dipertahankan supaya klien lama tidak
    // membaca `undefined` dan menyimpulkan ada gerbang yang lebih kuat.
    sybilGate: "wallet-signature-only",
    attestationRoot: storageRoot,
    daStorageTx: storage.tx ?? null,
    daStorageOk: storage.ok,
    lpFeeBps,
    treasuryBuybackBps,
    creatorFeeBps,
    /**
     * Kaki protokol dan total yang benar-benar dibayar trader.
     *
     * `lpFeeBps + creatorFeeBps + treasuryBuybackBps` menjumlah ke total yang
     * DIKONFIGURASI creator. `totalPaidBps` menambahkan kaki protokol di atasnya, dan
     * itulah angka yang keluar dari dompet trader. Keduanya dikirim supaya klien tidak
     * perlu memilih salah satu lalu keliru.
     */
    protocolFeeBps: maxProtocolFeeBps,
    protocolFeeBpsByChain,
    totalConfiguredBps: lpFeeBps + creatorFeeBps + treasuryBuybackBps,
    totalPaidBps,
    supply,
    // Market cap buka DITETAPKAN SERVER, bukan diambil dari angka paku di config.
    // `virtualNative` per chain sudah dihitung dari harga live, sehingga satu
    // ticker yang diluncurkan ke 4 chain membuka pada nilai USD yang sama.
    openingMarketCapUsd: OPENING_MARKET_CAP_USD,
    deployTargets: deployable.map((c) => ({
      chainKey: c.key,
      chainId: c.chainId,
      chainName: c.name,
      curveFactory: c.curveFactoryAddress, launchGeneration: c.launchGeneration,
      factoryVersion: legOf.get(c.chainId)?.version ?? null,
      protocolFeeBps: legOf.get(c.chainId)?.protocolFeeBps ?? 0,
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
 * alamat, bukan keunikan manusia. Tidak ada lapisan anti-Sybil di belakangnya —
 * gerbang World ID sudah dicabut, jadi satu orang boleh meluncurkan berapa pun
 * ticker dari berapa pun alamat. Jangan menulis copy yang menyiratkan sebaliknya.
 *
 * Yang tetap membatasi penyalahgunaan, dan sengaja tidak diganti dengan gerbang
 * identitas:
 *   - `checkSymbolAvailable` — satu ticker satu pemilik per chain, jadi spam tidak
 *     bisa merebut nama yang sudah dipakai.
 *   - biaya gas nyata — stage confirm menuntut receipt tx yang SUDAH mined beserta
 *     event factory-nya, jadi setiap entri registry berharga gas di mainnet.
 *   - batas 10 ticker per alamat (`ADEXTO_MAX_TICKERS_PER_CREATOR`), dan batas 500
 *     market yang MENOLAK entri baru alih-alih menggusur yang tertua.
 * Batas itu ekonomis, bukan identitas, dan itu memang klaim yang bisa kami dukung.
 * Yang TIDAK boleh diklaim: bahwa ini menutup Sybil. Alamat tidak berbiaya, jadi batas
 * per-alamat bisa dilewati dengan memutar alamat. Yang dijamin hanya bahwa entri yang
 * sudah ada tidak bisa dihapus oleh peluncuran orang lain.
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
  const iface = new ethers.Interface(CURVE_FACTORY_ABI);
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

  /**
   * Batas registry dijawab 409, bukan 500.
   *
   * Pada titik ini transaksinya SUDAH mined dan gasnya sudah terbayar. Kalau penolakan
   * yang normal dan bisa dijelaskan keluar sebagai 500, pemanggil wajar menyimpulkan
   * peluncurannya gagal seluruhnya — padahal tokennya ada, kurvanya jalan, dan yang
   * gagal hanya pencatatannya di situs ini. Pesan galatnya menyatakan itu, dan
   * `tokenAddress` ikut dikembalikan supaya tidak ada yang hilang jejak.
   */
  let record;
  try {
    record = registerProject({
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
  } catch (error) {
    if (error instanceof RegistryLimitError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          // Dikembalikan supaya pemilik market tetap punya alamat tokennya walau
          // listing-nya ditolak — tanpa ini transaksinya jadi tidak terlacak dari UI.
          tokenAddress,
          poolAddress,
          txHash,
          chainId: chain.chainId,
        },
        { status: 409 }
      );
    }
    throw error;
  }

  const siblings = findProjectGroup(symbol).filter((p) => p.chainId !== chain.chainId);

  return NextResponse.json({
    success: true,
    stage: "confirm",
    sybilGate: "wallet-signature-only",
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
        // Berkas ini sudah memuat catatan di atas bahwa "AMD SEV-SNP Hardware
        // Attested" adalah klaim yang salah — lalu baris ini mengirimkannya lagi
        // di respons API. Router 0G menyatakan tee_type=TDX, verifier dstack.
        enclaveHost: "pc.0g.ai/v1 (0G Router · Intel TDX, router-reported)",
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
