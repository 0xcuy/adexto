import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { activeSlots, approveSlot, listSlots, removeSlot } from "@/lib/promoted";
import { verifyAdmin } from "@/lib/growth-admin";
import { promotedMessage, type PromotedAction } from "@/lib/growth-admin-message";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";

/**
 * Slot Promoted. `GET` = slot aktif (`?all=1`: semua, untuk `/admin`). `POST` = setujui atau cabut
 * slot dengan tanda tangan admin atas `promotedMessage` (`src/lib/growth-admin-message.ts`).
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const all = new URL(req.url).searchParams.get("all") === "1";
  return NextResponse.json({ slots: all ? listSlots() : activeSlots() }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const verdict = rateLimit(`promoted:${clientIp(req)}`, 20, 10 * 60 * 1000);
  if (!verdict.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: rateLimitHeaders(verdict) });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }
  let action: PromotedAction;
  if (body?.action === "approve") {
    if (typeof body.token !== "string" || !ethers.isAddress(body.token)) return NextResponse.json({ error: "token must be an address." }, { status: 400 });
    action = {
      action: "approve",
      chainId: Number(body.chainId),
      token: body.token,
      startsAt: Number(body.startsAt),
      hours: Number(body.hours),
      paymentRef: String(body.paymentRef ?? ""),
    };
  } else if (body?.action === "remove") {
    action = { action: "remove", id: String(body.id ?? "") };
  } else {
    return NextResponse.json({ error: 'action must be "approve" or "remove".' }, { status: 400 });
  }
  const auth = verifyAdmin(promotedMessage(action, Number(body.issuedAt)), body.signature, body.issuedAt);
  if (!auth.ok) return NextResponse.json({ code: auth.code, error: auth.error }, { status: auth.status });
  const result = action.action === "approve" ? approveSlot({ ...action, admin: auth.admin }) : removeSlot(action.id, auth.admin);
  return NextResponse.json(result, { status: result.ok ? 200 : result.status });
}
