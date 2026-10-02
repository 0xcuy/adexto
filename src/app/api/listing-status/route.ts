import { NextResponse } from "next/server";
import { findProject } from "@/lib/registry";
import { getListingStatus } from "@/lib/listing-status";

/**
 * `GET /api/listing-status?chainId=&token=` — apakah pasar ADEXTO ini sudah tampil di DEX Screener
 * dan GeckoTerminal. Hanya untuk token di registry, supaya rute ini tidak menjadi proxy umum ke API
 * agregator untuk alamat apa pun.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const chainId = Number(url.searchParams.get("chainId"));
  const token = (url.searchParams.get("token") ?? "").trim();
  if (!Number.isInteger(chainId) || chainId <= 0 || !/^0x[0-9a-fA-F]{40}$/.test(token)) {
    return NextResponse.json({ error: "Pass chainId and a token address." }, { status: 400 });
  }
  const project = findProject(token, chainId);
  if (!project || project.chainId !== chainId) {
    return NextResponse.json({ error: "Not an ADEXTO market on this chain." }, { status: 404 });
  }
  const status = await getListingStatus(chainId, project.tokenAddress);
  return NextResponse.json(status, { headers: { "cache-control": "public, max-age=300" } });
}
