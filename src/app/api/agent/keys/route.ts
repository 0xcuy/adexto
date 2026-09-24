/**
 * Kunci API pool Agent Compute.
 *
 *   GET    ?address=0x…   keadaan sebuah alamat: stake, tingkatan, pemakaian, kunci
 *   POST   {address, message, signature}   menerbitkan satu kunci
 *   DELETE {address, message, signature}   mencabutnya
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
  MIN_STAKE_ADEXTO,
  STAKE_TOKEN,
  stakeContractFor,
  tierForStake,
} from "@/config/agent-compute";
import {
  issueKey,
  keyForAddress,
  poolConfigured,
  revokeKey,
  stakedOf,
  storeIsDurable,
  sweep,
} from "@/lib/agent-compute-pool";
import {
  AGENT_KEY_ISSUE_ACTION as ISSUE_ACTION,
  AGENT_KEY_REVOKE_ACTION as REVOKE_ACTION,
} from "@/lib/agent-compute-message";

export const dynamic = "force-dynamic";

/** Umur tanda tangan yang diterima. Cukup lama untuk membaca pesannya, cukup pendek untuk tidak jadi bearer token. */
const MAX_SIGNATURE_AGE_MS = 10 * 60_000;

type Verified = { ok: true; address: string } | { ok: false; error: string };

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
    return { ok: true, address: recovered.toLowerCase() };
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

  const base = {
    configured: poolConfigured(),
    durable: storeIsDurable(),
    endpoint: AGENT_COMPUTE_ENDPOINT,
    model: AGENT_COMPUTE_MODEL,
    stakeContract: contract,
    minStake: MIN_STAKE_ADEXTO,
  };

  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ ...base, address: null, staked: null, tier: null, key: null });
  }

  let staked: number | null = null;
  let stakeError: string | null = null;
  try {
    staked = await stakedOf(address);
  } catch (e) {
    stakeError = (e as Error).message.slice(0, 160);
  }

  const tier = staked === null ? null : tierForStake(staked);
  const record = keyForAddress(address);

  return NextResponse.json({
    ...base,
    address: address.toLowerCase(),
    staked,
    stakeError,
    tier: tier ? { label: tier.label, stake: tier.stake, allowance: tier.allowance } : null,
    key: record
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
          lastSweepAt: record.lastSweepAt,
        }
      : null,
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
    const result = await issueKey(v.address);
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
    const result = await revokeKey(v.address);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json({ revoked: true });
  } catch (e) {
    return NextResponse.json(
      { error: `Revoke failed: ${(e as Error).message.slice(0, 160)}` },
      { status: 502 }
    );
  }
}
