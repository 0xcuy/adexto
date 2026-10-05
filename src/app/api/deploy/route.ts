import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { keccak256, toHex } from "viem";
import { uploadMetadataTo0G } from "@/lib/upload-metadata-0g";
import { validateProjectImage } from "@/lib/logo-image";
import { normalizeCategory } from "@/lib/categories";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { BodyTooLargeError, IMAGE_JSON_BODY_BYTES, payloadTooLarge, readJsonBody } from "@/lib/body-limit";

/** Satu peluncuran memanggil `prepare` sekali; lihat catatan di POST. */
const PREPARE_LIMIT = 6;
const PREPARE_WINDOW_MS = 10 * 60 * 1000;

/** Batas field yang ditambatkan ke 0G DA dan disimpan di registry; alasannya di `handlePrepare`. */
const MAX_NAME_CHARS = 64;
const MAX_MODEL_CHARS = 64;
const MAX_PERSONA_CHARS = 1_000;
/** Label model tersimpan, mis. "0G Router (glm-5.3 · Intel TDX attested)". */
const MAX_AGENT_MODEL_LABEL_CHARS = 96;
/** Lebih dari jumlah chain yang ada; satu peluncuran menyebut tiap chain paling banyak sekali. */
const MAX_TARGET_CHAINS = 16;

/** Id agent ERC-8004 sebagai teks desimal uint256, atau kosong. */
function agentIdText(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^\d{1,78}$/.test(text) ? text : "";
}
import { ADEXTO_CONTRACTS } from "@/config/contracts";
import { resolveChain, resolveChainOrDefault, CHAIN_LIST, readProvider } from "@/lib/chains";
import {
  checkSymbolAvailable,
  creatorQuota,
  creatorTickers,
  findProjectGroup,
  registerProject,
  listPublicProjects,
  RegistryLimitError,
} from "@/lib/registry";
import {
  CURVE_FACTORY_ABI,
  SOVEREIGN_CURVE_ABI,
  protocolLegIsCarvedOut,
  readFactoryGeneration,
} from "@/lib/dex";
import { OPENING_MARKET_CAP_USD, nativePrices, openingVirtualNative } from "@/lib/native-price";
import { publicErrorMessage } from "@/lib/public-error";

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
// Names the model and nothing more. The router reports Intel TDX for it; ADEXTO does not verify
// the quote, so "attested" does not belong in a stored label (see /docs and /api/tee).
const AGENT_MODEL = "0G Router (glm-5.3)";

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
          /**
           * Apakah kaki protokol sudah termasuk di dalam total yang dikonfigurasi.
           *
           * Dikirim, bukan disimpulkan ulang di peramban dari `factoryVersion`: studio
           * menghitung `depthCut` untuk digambar di bar fee, dan server menghitung
           * `lpFeeBps` untuk dimasukkan ke calldata. Kalau keduanya memakai penalaran
           * masing-masing atas string versi, keduanya bisa berpisah — dan yang muncul di
           * layar akan berbeda dari yang ter-deploy permanen.
           */
          protocolLegCarvedOut: protocolLegIsCarvedOut(gen.version),
          protocolTreasury: gen.protocolTreasury,
          // Factory generasi sebelumnya di chain ini, kalau ada. Hanya untuk
          // verifikasi — pasar lamanya tetap bisa diperdagangkan dan tetap memakai
          // kaki fee aslinya, yang tidak memuat fee protokol.
          supersededCurveFactory: c.supersededCurveFactoryAddress,
        };
      }),
      registered: listPublicProjects().map((p) => p.symbol),
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
    // Dibatasi: `confirm` membawa logo data URI (paling banyak 200.000 karakter), tidak lebih.
    body = await readJsonBody(req, IMAGE_JSON_BODY_BYTES);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return payloadTooLarge(e.limit);
    return NextResponse.json({ error: "Body must be valid JSON." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object." }, { status: 400 });
  }

  const stage = String(body.stage || "prepare").toLowerCase();

  /**
   * `prepare` DIBATASI LAJUNYA. Ia stage yang membelanjakan uang kami.
   *
   * `handlePrepare` memanggil `uploadMetadataTo0G`, yang menandatangani unggahan dengan
   * `PRIVATE_KEY` server dan membayar gas di 0G. Satu-satunya gerbang sebelum ini adalah
   * attestation self-signed — yang membuktikan pemanggil menguasai alamat yang diklaimnya, dan
   * tidak lebih. Komentar di berkas ini sudah menyebutnya sendiri: "alamat baru bisa dibuat
   * tanpa batas dan tanpa biaya", jadi gerbang itu tidak berbiaya bagi penyerang.
   *
   * Batas gas nyata yang dijadikan andalan di catatan lain berlaku untuk `confirm`, yang
   * menuntut transaksi sudah mined. Ia tidak pernah menyentuh `prepare`.
   *
   * Dibatasi SEBELUM body diurai lebih jauh dan sebelum stage-nya dipanggil, dengan alasan yang
   * sama seperti di `/api/chat`: yang dibatasi adalah biaya, dan biaya itu keluar di panggilan
   * hilir. `confirm` sengaja TIDAK dibatasi — ia menuntut transaksi mainnet yang sudah mined,
   * jadi ia sudah berbiaya gas bagi pemanggilnya, dan membatasinya berisiko menolak pencatatan
   * pasar yang sudah hidup di chain.
   *
   * Angkanya: satu peluncuran memanggil `prepare` sekali. 6 per 10 menit memberi ruang untuk
   * mencoba ulang dan meluncurkan beberapa pasar berturut-turut, sambil menjadikan penyedotan
   * kunci anchoring mustahil dari satu alamat.
   *
   * Ini BUKAN perlindungan yang lengkap, dan itu perlu ditulis: `clientIp` bergantung pada
   * header yang benar, dan lapisan itu diperbaiki terpisah. Batas per-IP juga lebih lemah
   * daripada budget belanja pada kunci anchoring beserta alarm saldonya.
   *
   * Dilaporkan sebagai temuan 3 di GHSA-g589-wjqq-86f2.
   */
  if (stage === "prepare") {
    const gate = rateLimit(`deploy-prepare:${clientIp(req)}`, PREPARE_LIMIT, PREPARE_WINDOW_MS);
    if (!gate.ok) {
      return NextResponse.json(
        {
          error:
            "Too many launch preparations. This stage anchors metadata to 0G and costs gas on our side, so it is rate limited.",
          retryAfter: gate.retryAfter,
        },
        { status: 429, headers: rateLimitHeaders(gate) }
      );
    }
  }

  try {
    if (stage === "prepare") return await handlePrepare(body);
    if (stage === "confirm") return await handleConfirm(body);
    return NextResponse.json({ error: `Unknown stage "${stage}". Use "prepare" or "confirm".` }, { status: 400 });
  } catch (error: any) {
    console.error("[deploy]", error);
    return NextResponse.json({ error: publicErrorMessage(error) }, { status: 500 });
  }
}

// ─── Stage 1: prepare ──────────────────────────────────────────────────────

async function handlePrepare(body: any) {
  const symbol = String(body.symbol || "").trim().toUpperCase();
  const name = String(body.name || "").trim();
  const supply = Number(String(body.supply ?? "1000000000").replace(/[^0-9]/g, "")) || 0;

  if (!name) return NextResponse.json({ error: "Token name is required." }, { status: 400 });
  if (supply <= 0) return NextResponse.json({ error: "Supply must be greater than zero." }, { status: 400 });

  /**
   * Panjang field yang ikut ditambatkan ke 0G DA DIBATASI, dan ditolak — bukan dipotong.
   *
   * Semuanya masuk ke dokumen metadata yang diunggah `uploadMetadataTo0G` dengan kunci dan
   * gas KAMI, permanen. Tanpa batas, satu permintaan dengan `persona` 50 MB berarti berkas
   * sementara 50 MB, unggahan berbayar 50 MB, dan dokumen permanen berisi teks pilihan
   * penyerang di bawah nama kami. Ditolak, bukan dipotong, karena isinya permanen: creator
   * harus tahu apa yang tertambat, bukan menemukannya terpotong nanti.
   *
   * Angkanya mengikuti antarmuka yang ada: nama 64 (`maxLength` Studio dan skema MCP),
   * model 64 (id model terpanjang 19 karakter), mandat 1.000 (yang terpanjang di registry
   * hari ini 175 karakter).
   */
  const tooLong = (
    [
      ["name", name, MAX_NAME_CHARS],
      ["model", String(body.model ?? ""), MAX_MODEL_CHARS],
      ["persona", String(body.persona ?? ""), MAX_PERSONA_CHARS],
    ] as const
  ).find(([, value, max]) => value.length > max);
  if (tooLong) {
    return NextResponse.json(
      { error: `${tooLong[0]} is longer than ${tooLong[2]} characters.`, code: "FIELD_TOO_LONG" },
      { status: 400 }
    );
  }

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

  /**
   * Daftar chain dibatasi panjangnya dan DIDEDUPLIKASI per chainId.
   *
   * Sebelumnya duplikat lolos utuh ke `Promise.all` pembacaan factory di bawah, jadi
   * `targetChains: Array(50000).fill("0G")` dari satu alamat segar menjadi ~150.000 eth_call
   * dan 50.000 provider sekaligus — cukup untuk menghabiskan soket proses dan membuat RPC
   * publik memblokir IP origin. Duplikat tidak pernah berarti apa-apa: satu peluncuran sekali
   * per chain.
   */
  if (requested.length > MAX_TARGET_CHAINS) {
    return NextResponse.json(
      { error: `At most ${MAX_TARGET_CHAINS} target chains per launch.`, code: "TOO_MANY_CHAINS" },
      { status: 400 }
    );
  }
  const seenChainIds = new Set<number>();
  const chains = requested
    .map((c: string) => resolveChain(c))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .filter((c) => {
      if (seenChainIds.has(c.chainId)) return false;
      seenChainIds.add(c.chainId);
      return true;
    });

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
    /**
     * Plafon dinaikkan 1.0 -> 2.0, dan alasan lamanya memang sudah tidak berlaku.
     *
     * Komentar sebelumnya berbunyi "ceiling stays under the 1% that pump.fun charges,
     * which is the comparison this product invites". Sejak 0.12.0 tarif standar KAMI
     * adalah 1%, jadi plafon 1.0 akan menolak tier "Meme" milik studio sendiri —
     * pembandingnya sudah bukan pembatas yang relevan.
     *
     * 2.0 dipilih karena itu tier tertinggi yang benar-benar ada di studio, bukan 5.0
     * yang merupakan batas kontrak. Plafon yang longgar sampai batas kontrak akan
     * mengizinkan pasar 5% diluncurkan lewat POST langsung dan terdaftar di situs ini
     * dengan pembingkaian "gas only" kami di sekelilingnya.
     *
     * `creatorCut` dinaikkan 0.5 -> 1.6 dengan logika yang sama: tier Meme menuntut 1.5.
     * Ia TIDAK dinaikkan sampai 2.0, supaya sisa untuk kaki protokol dan depth tidak bisa
     * dihabiskan lewat satu angka saja — maksud asli bound ini, menahan skim bermusuhan,
     * tetap utuh.
     */
    swapFee: { min: 0.2, max: 2.0 },
    creatorCut: { min: 0, max: 1.6 },
    treasuryCut: { min: 0, max: 1.0 },
  } as const;

  const swapFeeRaw = Number(body.swapFee ?? 1.0);
  const creatorCut = Number(body.creatorCut ?? 0.7);
  const treasuryCut = Number(body.treasuryCut ?? 0.1);

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

  /**
   * Kaki protokol dibaca dari factory tiap chain yang benar-benar dituju.
   *
   * DIPINDAHKAN KE ATAS perhitungan depth, karena sejak 0.12.0 depth bergantung padanya:
   * kaki protokol dipotong dari dalam `swapFeeBps`, jadi `depthFeeBps` tidak bisa dihitung
   * sebelum diketahui berapa besar kaki itu dan apakah ia memang dipotong dari dalam.
   *
   * Angka ini harus dilaporkan, bukan dibiarkan tersirat — kalau tidak, satu-satunya
   * tempat kaki keempat muncul adalah di dalam kontrak, dan creator baru mengetahuinya
   * setelah pasarnya permanen.
   *
   * Dibaca PER CHAIN karena generasinya bisa berbeda: satu chain 0.12.0 sementara yang
   * lain masih 0.11.0. Nol berarti factory chain itu memang tidak punya kaki protokol.
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
   * SEMUA chain tujuan harus sepakat soal cara kaki protokol dipungut. Kalau tidak,
   * permintaan ditolak — bukan diluncurkan dengan depth yang salah di salah satu chain.
   *
   * Alasannya struktural, bukan kehati-hatian: `lpFeeBps` di bawah adalah SATU angka yang
   * dikirim ke semua chain dalam satu peluncuran. Pada factory carve-out depth yang benar
   * adalah `swap - creator - buyback - protokol`, pada factory aditif `swap - creator -
   * buyback`. Tidak ada satu nilai pun yang benar untuk keduanya, jadi meluncurkan ke
   * campuran generasi berarti satu chain PASTI mendapat kaki depth yang salah — dan setiap
   * kaki `immutable`, jadi kesalahan itu permanen untuk pasar tersebut.
   *
   * Menolak lebih jujur daripada memilih salah satu. Yang hilang hanya kemampuan
   * meluncurkan serentak selama jendela rollout, dan itu memang keadaan sementara.
   */
  const carveStates = new Set(protocolLegs.map(([, gen]) => protocolLegIsCarvedOut(gen.version)));
  if (carveStates.size > 1) {
    const carved = protocolLegs
      .filter(([, gen]) => protocolLegIsCarvedOut(gen.version))
      .map(([chainId, gen]) => `${chainId} (${gen.version})`);
    const additive = protocolLegs
      .filter(([, gen]) => !protocolLegIsCarvedOut(gen.version))
      .map(([chainId, gen]) => `${chainId} (${gen.version ?? "no VERSION"})`);
    return NextResponse.json(
      {
        error:
          `Target chains disagree on how the protocol fee is charged, so one depth value cannot be ` +
          `correct for all of them. Carved out of the total: ${carved.join(", ")}. Charged on top: ` +
          `${additive.join(", ")}. Launch these groups separately.`,
        code: "FEE_GENERATION_MIXED",
      },
      { status: 400 }
    );
  }
  const protocolCarvedOut = carveStates.values().next().value === true;
  /** Kaki protokol yang harus disisihkan dari total, dalam persen. Nol saat ia aditif. */
  const carvedProtocolPct = protocolCarvedOut ? maxProtocolFeeBps / 100 : 0;

  // Depth is what remains, so the parts may never exceed the whole. Without this the
  // subtraction below goes negative and `Math.round` hands the factory a nonsense depth.
  //
  // Kaki protokol masuk ke sisi kiri saat ia dipotong dari dalam, persis seperti
  // `require(creatorShareBps + treasuryShareBps + PROTOCOL_FEE_BPS <= swapFeeBps)` di
  // AdextoFactory 0.12.0. Tanpa itu, pembagian yang ditolak factory baru gagal setelah
  // metadata di-anchor ke 0G DA dan setelah pengguna menandatangani.
  if (creatorCut + treasuryCut + carvedProtocolPct > swapFeeRaw) {
    return NextResponse.json(
      {
        error:
          `creatorCut (${creatorCut}%) + treasuryCut (${treasuryCut}%)` +
          (carvedProtocolPct > 0 ? ` + the protocol leg (${carvedProtocolPct}%)` : "") +
          ` cannot exceed the total swapFee (${swapFeeRaw}%). Depth fee is whatever is left over.`,
        code: "FEE_SPLIT_INVALID",
      },
      { status: 400 }
    );
  }

  // Persis seperti AdextoFactory menghitung `depthFeeBps`, termasuk suku protokolnya.
  //
  // Formula lama di sini `swapFee - treasuryCut` LUPA mengurangi bagian creator, jadi ia
  // melaporkan depth 0.25% untuk peluncuran 0.30% Standard yang on-chain depth-nya 0.15%.
  // Angka itu lalu ditimpa balik ke studio dan disimpan di registry, sehingga terminal
  // menampilkan "Curve depth (0.25%)" bersebelahan dengan nilai dolar yang justru dihitung
  // dari 0.15% — kontradiksi di satu layar. Kaki protokol adalah suku ketiga yang sama
  // mudahnya terlupakan, dengan akibat yang sama bentuknya.
  const lpFeeBps = Math.round((swapFeeRaw - creatorCut - treasuryCut - carvedProtocolPct) * 100);
  const treasuryBuybackBps = Math.round(treasuryCut * 100);
  const creatorFeeBps = Math.round(creatorCut * 100);

  /**
   * Cap 5% diperiksa di sini juga, terhadap total yang BENAR-BENAR dibayar trader.
   *
   * Saat kaki protokol dipotong dari dalam, yang dibayar adalah `swapFeeBps` itu sendiri
   * dan menambahkan kaki protokol lagi akan membatasi total sebenarnya di 4.9% sambil
   * mengaku 5%. Saat ia aditif, ia memang harus ditambahkan. Karena itu sukunya
   * bersyarat, bukan selalu ada.
   *
   * Factory sendiri sudah menuntut batas ini, tapi kalau pemeriksaannya hanya di sana,
   * permintaan yang melewati batas baru gagal di tengah transaksi launch — setelah
   * metadata di-anchor ke 0G DA dan setelah pengguna menandatangani.
   */
  const totalPaidBps = Math.round(swapFeeRaw * 100) + (protocolCarvedOut ? 0 : maxProtocolFeeBps);
  if (totalPaidBps > 500) {
    return NextResponse.json(
      {
        error:
          `Total fee a trader would pay is ${(totalPaidBps / 100).toFixed(2)}%, above the 5% cap the ` +
          `curve enforces. swapFee is ${swapFeeRaw}%` +
          (protocolCarvedOut
            ? ` and the protocol leg is already inside it.`
            : ` and the protocol leg on the target chains adds ${(maxProtocolFeeBps / 100).toFixed(2)}%.`),
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
                    // Hanya angka desimal (uint256), seperti skema MCP. Nilai lain menjadi
                    // kosong alih-alih teks bebas di dokumen permanen.
                    agentId: agentIdText((body.agentIds ?? {})[c.chainId] ?? body.agentId),
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
  if (message.length > 400) {
    return { ok: false, error: "The attestation message is too long." };
  }

  /**
   * Pesannya harus pesan PELUNCURAN, bukan sembarang teks yang memuat alamat.
   *
   * Sebelumnya cukup `message.includes(address)` ditambah `Timestamp:`. Itu menerima tanda
   * tangan yang dibuat untuk keperluan lain — misalnya pesan akses `ask_agent` (memuat
   * `Address: 0x…` dan `Timestamp:`), yang dikirim sebagai argumen alat MCP dan bisa berakhir
   * di transkrip. Dengan pesan seperti itu siapa pun bisa menjalankan `prepare` atas nama
   * korban, dan kami membayar penambatan metadata permanen yang menyebut korban sebagai
   * deployer dengan nama dan mandat pilihan penyerang.
   *
   * Templatnya satu, dipakai Studio (`signAttestation`), `launchAttestationMessage` di
   * `src/lib/agent-launch.ts` (MCP dan agent-kit) dan skrip peluncuran di repo:
   *
   *   ADEXTO launch attestation
   *   Deployer: 0x…
   *   Ticker: SYMBOL
   *   Timestamp: <ms>
   *
   * Baris `Ticker:` SENGAJA tidak dicocokkan dengan ticker permintaan. Studio menyimpan
   * attestation yang sudah ditandatangani dan hanya membuangnya saat akun berganti, jadi creator
   * yang menyunting ticker sesudah menandatangani akan terkunci tanpa tombol tanda tangan ulang.
   * Awalan dan baris `Deployer:` sudah cukup untuk menolak tanda tangan dari keperluan lain.
   */
  if (!message.startsWith("ADEXTO launch attestation\n")) {
    return { ok: false, error: 'The attestation message must start with "ADEXTO launch attestation".' };
  }
  const deployerLine = /^Deployer: (0x[a-fA-F0-9]{40})$/m.exec(message);
  if (!deployerLine || deployerLine[1].toLowerCase() !== claimed.toLowerCase()) {
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

  /**
   * PEMERIKSAAN KETERSEDIAAN TICKER SENGAJA TIDAK DI SINI LAGI.
   *
   * Dulu ia berjalan di titik ini dengan `body.creator` — nilai dari badan permintaan — dan
   * itulah lubangnya. `checkSymbolAvailable` memakai creator untuk dua pengecualian: ticker
   * yang direservasi protokol, dan hak creator asal memperluas tickernya ke chain lain. Dengan
   * creator yang bisa diklaim bebas, keduanya terbuka untuk siapa saja:
   *
   *   - luncurkan token ber-ticker `ADEXTO` lewat factory publik (symbolRegistry on-chain
   *     tidak mereservasi nama protokol), lalu POST `confirm` dengan creator = deployer kami
   *     -> halaman `/token/adexto` resmi menampilkan token orang lain
   *   - ambil alamat creator proyek mana pun yang terdaftar, POST token sendiri di chain yang
   *     tickernya belum terdaftar -> listing palsu atas nama proyek itu
   *
   * Stage ini juga tidak pernah memeriksa tanda tangan: `verifyLaunchAttestation` hanya
   * dipanggil oleh `handlePrepare`. Jadi tidak ada apa pun yang mengikat pemanggil ke alamat
   * yang diklaimnya.
   *
   * Pemeriksaannya kini berjalan SESUDAH event factory diurai, memakai creator dari chain.
   * Harganya satu pembacaan receipt untuk permintaan yang akhirnya ditolak — dan itu memang
   * harga yang harus dibayar, sebab keputusan otorisasi tidak boleh bergantung pada nilai yang
   * dikirim pemanggil.
   *
   * Dilaporkan sebagai temuan 2 di GHSA-g589-wjqq-86f2.
   */
  const provider = readProvider(chain);
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
  let onChainCreator: string | null = null;
  let poolNative = 0;
  let poolTokens = 0;

  /**
   * Event hanya dipercaya kalau DIPANCARKAN OLEH FACTORY ADEXTO di chain ini.
   *
   * Sebelumnya setiap log yang cocok dengan tanda tangan `TrinityProjectDeployed` diterima,
   * dari kontrak mana pun. Tanda tangan event bukan rahasia: siapa saja bisa men-deploy
   * kontrak yang memancarkan event yang sama dengan `token`, `curve` dan `creator` pilihannya
   * sendiri. Itu membatalkan seluruh alasan identitas dibaca "dari chain":
   *
   *   - `creator` palsu = deployer kami atau creator proyek yang sudah terdaftar, sehingga
   *     ticker yang direservasi (`ADEXTO`) atau ticker proyek orang lain di chain baru lolos
   *     `checkSymbolAvailable`;
   *   - `curve` palsu = kontrak penyerang yang terdaftar sebagai pasar di /explorer dan di
   *     terminal token. Tombol Buy situs ini lalu mengirim native pengunjung ke kontrak itu.
   *
   * Hanya alamat log yang tidak bisa dipalsukan, karena EVM yang menuliskannya. Factory saat ini
   * dan pendahulunya di chain itu sama-sama ADEXTO (token dan kurvanya dibuat factory dengan
   * `new`), jadi keduanya diterima — sama dengan `registerLaunch` di `src/lib/agent-launch.ts`,
   * yang sejak awal memeriksa ini.
   */
  const trustedFactories = new Set(
    [chain.curveFactoryAddress, chain.supersededCurveFactoryAddress]
      .filter((a): a is string => typeof a === "string" && /^0x[a-fA-F0-9]{40}$/.test(a))
      .map((a) => a.toLowerCase())
  );
  if (trustedFactories.size === 0) {
    return NextResponse.json({ error: `No ADEXTO factory is configured on ${chain.name}.` }, { status: 400 });
  }

  let eventName: string | null = null;
  let eventSupply: bigint | null = null;
  let eventDepthFeeBps: bigint | null = null;
  let eventBuybackBps: bigint | null = null;

  for (const log of receipt.logs) {
    if (!trustedFactories.has(String(log.address).toLowerCase())) continue;
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === "TrinityProjectDeployed") {
        tokenAddress = parsed.args.token;
        eventName = String(parsed.args.name);
        eventSupply = BigInt(parsed.args.initialSupply ?? 0);
        eventDepthFeeBps = BigInt(parsed.args.depthFeeBps ?? 0);
        eventBuybackBps = BigInt(parsed.args.treasuryBuybackBps ?? 0);
        // `creator` di event ini adalah `msg.sender` dari `deployTrinity`
        // (AdextoCurveFactory.sol:336). Ia datang dari chain, jadi pemanggil tidak bisa
        // memilihnya — itulah sebabnya identitas dibaca dari sini dan bukan dari body.
        onChainCreator = parsed.args.creator ?? null;
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

  /**
   * Identitas creator, DARI CHAIN.
   *
   * `receipt.from` dipakai sebagai cadangan, bukan sebagai pilihan utama: kalau launch dikirim
   * lewat kontrak perantara, pengirim transaksi dan `msg.sender` yang dilihat factory bisa
   * berbeda, dan yang benar adalah yang factory catat. Keduanya berasal dari chain, jadi tidak
   * ada jalur di mana pemanggil memilih nilai ini.
   */
  const creator = onChainCreator ?? receipt.from;

  /**
   * `body.creator` DITOLAK kalau tidak cocok, bukan diabaikan diam-diam.
   *
   * Mengabaikannya akan membuat klien lama yang mengirim alamat berbeda tetap berhasil dengan
   * identitas yang bukan miliknya, dan tidak ada yang tahu. Menjawab 409 memberi tahu persis
   * apa yang tidak cocok, dan studio memang selalu mengirim alamat penanda tangannya sendiri —
   * jadi jalur normal tidak pernah menyentuh cabang ini.
   */
  if (body.creator && String(body.creator).toLowerCase() !== creator.toLowerCase()) {
    return NextResponse.json(
      {
        error:
          `The launch transaction was sent by ${creator}, but the request claims ${body.creator}. ` +
          `Creator identity is read from the factory event, not from the request.`,
        code: "CREATOR_MISMATCH",
        creator,
      },
      { status: 409 }
    );
  }

  // Scoped to this chain, so chains 2..4 of a multi-chain launch are not rejected
  // as duplicates of chain 1. Lihat catatan panjang di atas: creator-nya sekarang dari chain.
  const availability = checkSymbolAvailable(symbol, chain.chainId, creator);
  if (!availability.available) {
    return NextResponse.json({ error: availability.reason, code: "SYMBOL_UNAVAILABLE" }, { status: 409 });
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

  // Hanya chain yang dikenal, sekali masing-masing: daftar ini disimpan di registry dan dibaca
  // ulang di setiap permintaan, jadi badan permintaan tidak boleh menentukan ukurannya.
  const targetChainIds: number[] = Array.isArray(body.targetChainIds) && body.targetChainIds.length > 0
    ? [
        ...new Set<number>(
          body.targetChainIds
            .slice(0, MAX_TARGET_CHAINS)
            .map((id: any) => Number(id))
            .filter((id: number) => Number.isFinite(id) && Boolean(resolveChain(id)))
        ),
      ]
    : [chain.chainId];
  if (targetChainIds.length === 0) targetChainIds.push(chain.chainId);

  /**
   * Pengikatan ERC-8004 DIBACA DARI TOKEN, bukan dari badan permintaan.
   *
   * Factory memeriksa `ownerOf(agentId) == msg.sender` lalu menulis hasilnya immutable ke
   * token. Badan permintaan tidak membawa apa pun soal ini, dan memang tidak boleh: nilai
   * yang dipilih pemanggil akan membuat registry menyebut agent yang tidak pernah diikat.
   *
   * Gagal baca berarti `null` — dicatat "tidak diketahui", tidak pernah ditebak. Kolom ini
   * salinan; lencana di terminal membaca token itu sendiri.
   */
  let agentIdentity: { agentId: string; registry: string } | null = null;
  try {
    const tokenAgent = new ethers.Contract(
      tokenAddress,
      [
        "function agentBound() view returns (bool)",
        "function agentId() view returns (uint256)",
        "function agentRegistry() view returns (address)",
      ],
      provider
    );
    if (await tokenAgent.agentBound()) {
      const [id, registry] = await Promise.all([tokenAgent.agentId(), tokenAgent.agentRegistry()]);
      agentIdentity = { agentId: (id as bigint).toString(), registry: ethers.getAddress(String(registry)) };
    }
  } catch {
    agentIdentity = null;
  }

  /**
   * `image` DIVALIDASI, dan sebelumnya tidak.
   *
   * Barisnya dulu `image: body.image || "/logo.svg"` — apa pun yang dikirim langsung masuk
   * `projects.json`. Studio kini memperkecil unggahan ke 256x256 sebelum mengirimnya, tapi
   * studio bukan satu-satunya yang bisa memanggil endpoint ini: `POST /api/deploy` menerima
   * JSON dari siapa pun, jadi batas di browser hanya saran sampai server ikut menolak.
   *
   * Yang dilindungi adalah registry. `projects.json` dibaca dan di-parse utuh setiap kali
   * disentuh, dan batasnya 500 pasar, jadi satu nilai besar dikalikan 500. URL absolut juga
   * ditolak: membiarkannya berarti gambar sebuah pasar bisa diganti menjadi apa pun setelah
   * terdaftar, oleh host yang bukan milik kita.
   *
   * 400, bukan diam-diam diganti bawaan: pasar sudah ada di chain pada titik ini, dan creator
   * harus tahu kenapa listing-nya ditolak alih-alih menemukan logonya hilang nanti.
   */
  const imageCheck = validateProjectImage(body.image);
  if (!imageCheck.ok) {
    return NextResponse.json(
      {
        error: imageCheck.reason,
        code: "INVALID_IMAGE",
        // Dikembalikan dengan alasan yang sama seperti RegistryLimitError di bawah: tokennya
        // sudah hidup, jadi alamatnya tidak boleh hilang hanya karena logonya ditolak.
        tokenAddress,
        poolAddress,
        txHash,
        chainId: chain.chainId,
      },
      { status: 400 }
    );
  }

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
    // Dari event factory, bukan dari body. Baris ini dulu lebih memilih `body.creator` dan
    // hanya jatuh ke `receipt.from` bila formatnya salah — jadi alamat berformat benar milik
    // orang lain selalu menang. Temuan 2 di GHSA-g589-wjqq-86f2.
    creator,
    /**
     * Nama, supply dan fee DARI EVENT FACTORY, bukan dari badan permintaan.
     *
     * Ketiganya dulu `body.name`, `body.supply`, `body.lpFeeBps` dan `body.treasuryBuybackBps`,
     * dan `FEE_BOUNDS` hanya diperiksa di `prepare`. Jadi pasar yang diluncurkan langsung lewat
     * factory dengan pembagian fee bermusuhan (mis. 4,9% ke creator, di bawah batas kontrak
     * 5%) bisa didaftarkan dengan `lpFeeBps: 20` dan tampil di /explorer dan `get_market`
     * dengan fee yang bohong. Factory memancarkan nilai yang benar-benar di-deploy, dan event
     * itu sekarang terbukti dari factory (lihat pemeriksaan pemancar di atas). `registerLaunch`
     * di MCP sudah lama mengirim nilai event; Studio mengirim nilai yang sama dari calldata-nya.
     */
    name: (eventName ?? String(body.name || symbol)).slice(0, MAX_NAME_CHARS) || symbol,
    symbol,
    chainId: chain.chainId,
    chainLabel,
    targetChainIds,
    priceNative,
    supply:
      eventSupply !== null && eventSupply > 0n
        ? Number(eventSupply)
        : Number(String(body.supply ?? "1000000000").replace(/[^0-9]/g, "")) || 1_000_000_000,
    lpFeeBps: eventDepthFeeBps !== null ? Number(eventDepthFeeBps) : Number(body.lpFeeBps ?? 20),
    treasuryBuybackBps: eventBuybackBps !== null ? Number(eventBuybackBps) : Number(body.treasuryBuybackBps ?? 10),
    // Dipotong, bukan ditolak: di titik ini pasarnya SUDAH hidup di chain, dan yang dipotong
    // hanya teks listing. `prepare` sudah menolak nilai yang lebih panjang untuk jalur Studio.
    agentModel: String(body.agentModel || AGENT_MODEL).slice(0, MAX_AGENT_MODEL_LABEL_CHARS),
    agentPersona: body.persona ? String(body.persona).slice(0, MAX_PERSONA_CHARS) : undefined,
    // Dinormalkan, bukan diterima apa adanya: nilai ini menjadi tab yang terlihat publik di
    // /explorer, jadi ejaan bebas memecah satu kategori menjadi beberapa tab berisi satu
    // pasar. Yang tidak dikenal turun ke bawaan alih-alih menolak peluncuran — alasannya ada
    // di `src/lib/categories.ts`.
    category: normalizeCategory(body.category),
    // Pitch dan tautan milik creator. Diteruskan mentah ke registry KARENA registry
    // yang membersihkannya (`normalizeDescription` / `normalizeLinks`) — satu gerbang,
    // bukan dua aturan yang bisa berselisih. Yang penting di sini: nilainya tidak
    // pernah dipakai untuk membentuk calldata, jadi ia tidak bisa mengubah apa yang
    // di-deploy, hanya apa yang terdaftar.
    description: body.description ?? null,
    links: {
      website: body.website ?? null,
      github: body.github ?? null,
      x: body.x ?? body.twitter ?? null,
      docs: body.docs ?? null,
    },
    image: imageCheck.value,
    txHash,
    blockNumber: receipt.blockNumber,
    teeRoot: /^0x[a-fA-F0-9]{64}$/.test(String(body.attestationRoot || "")) ? String(body.attestationRoot) : null,
    // Hash transaksi 0G DA, atau tidak sama sekali — bukan teks bebas di registry publik.
    daStorageTx: /^0x[a-fA-F0-9]{64}$/.test(String(body.daStorageTx || "")) ? String(body.daStorageTx) : null,
    poolLive,
    agentIdentity,
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
        /**
         * Dulu tertulis tetap "ERC-8004 (Agent Identity Bound)" untuk SETIAP peluncuran,
         * termasuk yang tidak mengikat agent apa pun. Sekarang dari token itu sendiri.
         */
        standard: agentIdentity ? `ERC-20, bound to ERC-8004 agent ${agentIdentity.agentId}` : "ERC-20",
        agentIdentity,
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
