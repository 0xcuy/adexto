import { NextResponse } from "next/server";
import { CHAIN_LIST } from "@/lib/chains";
import { AGENT_REGISTRY_ADDRESS } from "@/lib/dex";
import { agentRegistryId, computeCidV1Raw, pinToIpfs, serialize, toDataUri } from "@/lib/agent-registration";
import { buildIdentityFile, checkIdentityFields, ipfsToHttp } from "@/lib/agent-identity-file";
import { sniffImageMime, validateProjectImage } from "@/lib/logo-image";
import { BodyTooLargeError, payloadTooLarge, readJsonBody } from "@/lib/body-limit";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";

/**
 * POST /api/agents/identity — siapkan berkas registrasi ERC-8004 untuk kartu identitas agen (`/agents/identity`).
 *
 * TIDAK MENDAFTARKAN APA PUN. Factory meminta `ownerOf(agentId) == msg.sender`, jadi `register(uri)` harus dikirim wallet
 * pemilik sendiri; rute ini hanya membangun berkasnya dan mengembalikan URI yang akan ditandatangani (alasan yang sama
 * dengan `/api/agent/register`).
 *
 * GAMBAR WAJIB DI-PIN, TIDAK PERNAH `data:` DI DALAM agentURI
 *
 * `agentURI` disimpan sebagai string di storage registry. Gambar 256 px berukuran 30–70 KB; sebagai `data:` di dalam
 * berkas `data:`, itu ribuan slot storage (puluhan juta gas). Jadi gambar di-pin ke IPFS; kalau pin gagal, rute menolak
 * dan pengguna bisa memilih tanpa gambar, bukan diam-diam menulis sesuatu yang mahal atau URL yang tidak kami kendalikan.
 * Berkas JSON-nya sendiri kecil (±600 byte), jadi untuknya `data:` adalah cadangan yang sah (ERC-8004 mengizinkannya).
 */
export const dynamic = "force-dynamic";

const LIMIT = 10;
const WINDOW_MS = 60 * 60_000;
const REGISTRY_CHAINS = CHAIN_LIST.filter((c) => c.dexLive && c.curveFactoryAddress);

export async function POST(req: Request) {
  const gate = rateLimit(`agent-identity:${clientIp(req)}`, LIMIT, WINDOW_MS);
  if (!gate.ok) {
    return NextResponse.json(
      { error: `At most ${LIMIT} identity files per hour from one address.`, code: "RATE_LIMITED" },
      { status: 429, headers: rateLimitHeaders(gate) }
    );
  }
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req, 320 * 1024);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return payloadTooLarge(320 * 1024);
    return NextResponse.json({ error: "Send a JSON body.", code: "BAD_JSON" }, { status: 400 });
  }

  const chain = REGISTRY_CHAINS.find((c) => c.chainId === Number(body.chainId));
  if (!chain) {
    return NextResponse.json(
      { error: `Choose one of ${REGISTRY_CHAINS.map((c) => c.name).join(", ")}.`, code: "UNKNOWN_CHAIN" },
      { status: 400 }
    );
  }
  const fields = checkIdentityFields(body);
  if (!fields.ok) return NextResponse.json({ error: fields.error, code: fields.code }, { status: 400 });

  // Gambar: data URI raster dari Generate atau Upload (validator yang sama dengan logo pasar), lalu di-pin.
  let image = "";
  let imageMode: "ipfs" | "none" = "none";
  const rawImage = typeof body.image === "string" ? body.image : "";
  if (rawImage) {
    const check = validateProjectImage(rawImage);
    if (!check.ok || !check.value.startsWith("data:")) {
      return NextResponse.json({ error: check.ok ? "Send the image as a PNG, JPEG or WebP." : check.reason, code: "BAD_IMAGE" }, { status: 400 });
    }
    const b64 = check.value.slice(check.value.indexOf(",") + 1);
    const mime = sniffImageMime(b64);
    if (!mime) return NextResponse.json({ error: "Send the image as a PNG, JPEG or WebP.", code: "BAD_IMAGE" }, { status: 400 });
    const bytes = Buffer.from(b64, "base64");
    const pinned = await pinToIpfs(bytes, `agent-image.${mime.split("/")[1]}`, mime);
    if (!pinned.ok || !pinned.uri) {
      return NextResponse.json(
        {
          error: "The image could not be stored on IPFS right now. Try again, or register without an image.",
          code: "IMAGE_PIN_FAILED",
          detail: pinned.error ?? null,
        },
        { status: 503 }
      );
    }
    image = pinned.uri;
    imageMode = "ipfs";
  }

  const file = buildIdentityFile({
    chainId: chain.chainId,
    registryAddress: AGENT_REGISTRY_ADDRESS,
    owner: fields.value.owner,
    name: fields.value.name,
    description: fields.value.description,
    image,
    website: fields.value.website ?? undefined,
  });
  const bytes = serialize(file);
  const pinned = await pinToIpfs(bytes);
  const uri = pinned.ok && pinned.uri ? pinned.uri : toDataUri(bytes);

  return NextResponse.json(
    {
      /** Persis yang dikirim ke `register(string agentURI)`. */
      uri,
      uriMode: pinned.ok ? "ipfs" : "data",
      image,
      imageMode,
      imageHttp: image ? ipfsToHttp(image) : null,
      registry: AGENT_REGISTRY_ADDRESS,
      agentRegistry: agentRegistryId(chain.chainId, AGENT_REGISTRY_ADDRESS),
      chainId: chain.chainId,
      chainName: chain.name,
      file,
      bytes: bytes.length,
      cid: computeCidV1Raw(bytes),
    },
    { headers: { "cache-control": "no-store" } }
  );
}
