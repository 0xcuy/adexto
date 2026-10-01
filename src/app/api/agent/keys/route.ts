/**
 * Kunci API pool Agent Compute.
 *
 *   GET    ?address=0x…   keadaan sebuah alamat: stake, tingkatan, pemakaian dan kunci per token
 *   POST   {address, message, signature, stake}   menerbitkan satu kunci untuk satu token
 *   DELETE {address, message, signature, stake}   mencabutnya
 *
 * `stake` adalah id di `COMPUTE_STAKES` dan harus sama dengan baris `Stake:` di pesan yang
 * ditandatangani. Tanpa keduanya artinya $ADEXTO, seperti sebelum ada kunci per token.
 *
 * KENAPA TANDA TANGAN, BUKAN SESI
 *
 * Yang menentukan jatah adalah stake sebuah ALAMAT, jadi yang harus dibuktikan adalah kendali
 * atas alamat itu. Tidak ada akun di situs ini yang bisa dipakai sebagai gantinya. `personal_sign`
 * dengan pesan yang mengikat alamat dan waktunya membuktikan tepat itu, tanpa menyimpan apa pun
 * tentang penggunanya.
 *
 * Yang TIDAK dibuktikannya, dan tidak diklaim: bahwa satu orang hanya punya satu alamat. Alamat
 * tidak berbiaya. Yang membatasi di sini bukan identitas melainkan stake — setiap alamat harus
 * memegang stakenya sendiri, dan jatahnya mengikuti stake itu, bukan orangnya.
 */
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import {
  AGENT_COMPUTE_ENDPOINT,
  AGENT_COMPUTE_MODEL,
  HUB_COMPUTE_USD_PER_MILLION_TOKENS,
  MIN_STAKE_ADEXTO,
  STAKE_TOKEN,
  stakeContractFor,
  tierForStake,
  type ComputeStake,
} from "@/config/agent-compute";
import { allComputeSources, findComputeSource, hubBudget, hubEligible, type HubBudget } from "@/lib/stake-hub-server";
import {
  issueKey,
  keyFor,
  keyForAddress,
  poolConfigured,
  revokeKey,
  stakesOf,
  storeIsDurable,
  sweep,
  type PoolKey,
} from "@/lib/agent-compute-pool";
import {
  AGENT_KEY_ISSUE_ACTION as ISSUE_ACTION,
  AGENT_KEY_REVOKE_ACTION as REVOKE_ACTION,
  stakeInMessage,
} from "@/lib/agent-compute-message";

export const dynamic = "force-dynamic";

/** Umur tanda tangan yang diterima. Cukup lama untuk membaca pesannya, cukup pendek untuk tidak jadi bearer token. */
const MAX_SIGNATURE_AGE_MS = 10 * 60_000;

type Verified = { ok: true; address: string; stake: string } | { ok: false; error: string };

function verify(body: any, action: string): Verified {
  const address = String(body?.address || "");
  const message = String(body?.message || "");
  const signature = String(body?.signature || "");

  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return { ok: false, error: "A valid address is required." };
  if (!message || !signature) return { ok: false, error: "A signed message is required." };
  if (!message.includes(action)) {
    return { ok: false, error: "The signed message does not authorise this action." };
  }
  if (!message.toLowerCase().includes(address.toLowerCase())) {
    return { ok: false, error: "The signed message must bind the address." };
  }

  /**
   * Kunci per token: token yang dimaksud harus disebut DI DALAM pesan yang ditandatangani, bukan
   * hanya di body, supaya tanda tangan untuk satu token tidak bisa dipakai untuk token lain.
   * Pesan tanpa baris `Stake:` berasal dari sebelum ada kunci per token dan hanya berarti $ADEXTO.
   */
  const named = stakeInMessage(message) ?? "adexto";
  const asked = typeof body?.stake === "string" && body.stake ? String(body.stake) : named;
  if (!findComputeSource(asked)) return { ok: false, error: "Unknown stake." };
  if (asked !== named) return { ok: false, error: "The signed message names a different stake." };

  const stamp = message.match(/Timestamp:\s*(\d+)/);
  if (!stamp) return { ok: false, error: "The signed message must include a timestamp." };
  const age = Date.now() - Number(stamp[1]);
  if (!Number.isFinite(age) || age < -60_000 || age > MAX_SIGNATURE_AGE_MS) {
    return { ok: false, error: "The signature has expired. Sign again." };
  }

  try {
    const recovered = ethers.verifyMessage(message, signature);
    if (recovered.toLowerCase() !== address.toLowerCase()) {
      return { ok: false, error: "The signature does not match the address." };
    }
    return { ok: true, address: recovered.toLowerCase(), stake: named };
  } catch {
    return { ok: false, error: "The signature could not be verified." };
  }
}

// ─── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const gate = rateLimit(`agentkeys:get:${clientIp(req)}`, 60, 5 * 60_000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many requests.", retryAfter: gate.retryAfter },
      { status: 429, headers: rateLimitHeaders(gate) }
    );
  }

  const address = new URL(req.url).searchParams.get("address") || "";
  const contract = stakeContractFor(STAKE_TOKEN.chainId);

  /**
   * Sapuan dijalankan di jalur baca, bukan hanya dari cron.
   *
   * Konsekuensinya harus disebut: penegakan jatah bergantung pada ADANYA sapuan, jadi kalau tidak
   * ada yang membuka halaman dan cron belum dipasang, sebuah kunci bisa melewati jatahnya sampai
   * sapuan berikutnya. Itu batas nyata dari memilih penegakan di luar jalur panas, dan ia
   * dinyatakan di UI alih-alih disembunyikan.
   */
  void sweep().catch(() => {});

  /**
   * Every source, with or without an address, so the page can list them before a wallet connects:
   * the four tiered stakes, then one per live market in a stake hub. A hub market also carries its
   * compute budget so far, read from its curve and valued now.
   */
  const all = allComputeSources();
  // A market its chain's hub refuses (made by a factory deployed after the hub) cannot be staked
  // anywhere, so it is not listed as a source. Unknown (hub unreadable) stays listed.
  const eligible = await Promise.all(all.map((s) => (s.kind === "hub" ? hubEligible(s) : Promise.resolve(true))));
  const sources = all.filter((_, i) => eligible[i] !== false);
  const budgets = new Map<string, HubBudget>();
  await Promise.all(
    sources.filter((s) => s.kind === "hub").map(async (s) => budgets.set(s.id, await hubBudget(s)))
  );
  const budgetView = (s: ComputeStake) => {
    const b = budgets.get(s.id);
    return b
      ? {
          feesNative: b.feesNative,
          nativeSymbol: b.nativeSymbol,
          priceUsd: b.priceUsd,
          budgetUsd: b.budgetUsd,
          budgetTokens: b.budgetTokens,
          shareBps: b.shareBps,
          usdPerMillionTokens: HUB_COMPUTE_USD_PER_MILLION_TOKENS,
          error: b.error,
        }
      : null;
  };

  const base = {
    configured: poolConfigured(),
    durable: storeIsDurable(),
    endpoint: AGENT_COMPUTE_ENDPOINT,
    model: AGENT_COMPUTE_MODEL,
    stakeContract: contract,
    minStake: MIN_STAKE_ADEXTO,
    sources: sources.map((s) => ({ ...s, budget: budgetView(s) })),
  };

  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ ...base, address: null, staked: null, tier: null, stakes: [], key: null });
  }

  /**
   * Setiap token di daftar dibaca, dan setiap token punya kuncinya sendiri. `staked`, `tier` dan
   * `key` di tingkat atas tetap berarti $ADEXTO di 0G, seperti sebelum ada token lain, supaya
   * pembaca lama API ini tidak tiba-tiba membaca angka token lain di bidang yang sama.
   */
  const readings = await stakesOf(address);
  const adexto = readings.find((r) => r.id === "adexto");
  const adextoTier = adexto?.staked == null ? null : tierForStake(adexto.staked);
  const keyView = (record: PoolKey | null) =>
    record
      ? {
          keyPrefix: record.keyPrefix,
          createdAt: record.createdAt,
          tierLabel: record.tierLabel,
          allowance: record.allowance,
          usedInput: record.usedInput,
          usedOutput: record.usedOutput,
          requests: record.requests,
          active: record.active,
          disabledReason: record.disabledReason,
          stakeSource: record.stakeSource ?? "adexto",
          lastSweepAt: record.lastSweepAt,
          accrued: record.accrued ?? null,
        }
      : null;

  return NextResponse.json({
    ...base,
    address: address.toLowerCase(),
    staked: adexto?.staked ?? null,
    stakeError: adexto?.error ?? null,
    tier: adextoTier ? { label: adextoTier.label, stake: adextoTier.stake, allowance: adextoTier.allowance } : null,
    stakes: sources.map((s) => {
      const r = readings.find((x) => x.id === s.id);
      const t = r?.staked == null || s.kind === "hub" ? null : tierForStake(r.staked, s.tiers);
      return {
        id: s.id,
        kind: s.kind ?? "tiered",
        chainId: s.chainId,
        symbol: s.symbol,
        name: s.name,
        contract: s.contract,
        minStake: s.minStake,
        staked: r?.staked ?? null,
        error: r?.error ?? null,
        tier: t ? { label: t.label, stake: t.stake, allowance: t.allowance } : null,
        budget: budgetView(s),
        key: keyView(keyFor(address, s.id)),
      };
    }),
    key: keyView(keyForAddress(address)),
  });
}

// ─── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // Lebih ketat daripada GET: satu alamat hanya butuh satu kunci, jadi laju yang wajar di sini
  // rendah, dan setiap penerbitan membuat catatan di router yang harus dibersihkan kalau salah.
  const gate = rateLimit(`agentkeys:post:${clientIp(req)}`, 5, 60 * 60_000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many key requests. Try again later.", retryAfter: gate.retryAfter },
      { status: 429, headers: rateLimitHeaders(gate) }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "A JSON body is required." }, { status: 400 });
  }

  const v = verify(body, ISSUE_ACTION);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 401 });

  try {
    const result = await issueKey(v.address, v.stake);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    /**
     * Rahasianya dikembalikan SEKALI, dan tidak ada jalan untuk membacanya lagi dari sisi ini.
     * Itu bukan kelalaian: kami tidak menyimpannya, jadi satu-satunya pemulihan yang benar adalah
     * mencabut lalu menerbitkan ulang.
     */
    return NextResponse.json(
      {
        key: result.secret,
        endpoint: AGENT_COMPUTE_ENDPOINT,
        model: AGENT_COMPUTE_MODEL,
        tierLabel: result.key.tierLabel,
        allowance: result.key.allowance,
        stakeSource: result.key.stakeSource ?? null,
        shownOnce: true,
      },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Key issuance failed: ${(e as Error).message.slice(0, 160)}` },
      { status: 502 }
    );
  }
}

// ─── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(req: Request) {
  const gate = rateLimit(`agentkeys:del:${clientIp(req)}`, 10, 60 * 60_000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many requests.", retryAfter: gate.retryAfter },
      { status: 429, headers: rateLimitHeaders(gate) }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "A JSON body is required." }, { status: 400 });
  }

  const v = verify(body, REVOKE_ACTION);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 401 });

  try {
    const result = await revokeKey(v.address, v.stake);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json({ revoked: true, stake: v.stake });
  } catch (e) {
    return NextResponse.json(
      { error: `Revoke failed: ${(e as Error).message.slice(0, 160)}` },
      { status: 502 }
    );
  }
}
