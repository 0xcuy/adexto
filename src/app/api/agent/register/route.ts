import { NextResponse } from "next/server";

import { CHAIN_LIST } from "@/lib/chains";
import { AGENT_REGISTRY_ADDRESS } from "@/lib/dex";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { BodyTooLargeError, payloadTooLarge, readJsonBody } from "@/lib/body-limit";
import {
  agentRegistryId,
  buildRegistrationFile,
  computeCidV1Raw,
  pinToIpfs,
  serialize,
  toDataUri,
} from "@/lib/agent-registration";

/**
 * Build the ERC-8004 registration file for an agent, and hand back the URI to sign.
 *
 * THIS ROUTE DOES NOT REGISTER ANYTHING, AND THAT IS THE POINT.
 *
 * `AdextoFactory.deployTrinity` requires `ownerOf(agentId) == msg.sender`. So the agent
 * has to be registered BY the wallet that will launch, or the launch is rejected by the
 * factory. If this route signed the registration with a protocol key, we would own the
 * user's agent and they could not use it — and handing it over afterwards would mean the
 * protocol briefly holds somebody else's asset, which is the one thing every page here
 * promises does not happen.
 *
 * So the split is: the server builds the file, the user's wallet sends the transaction.
 * The build has to be server-side because `src/lib/agent-registration.ts` uses
 * `node:crypto` and `Buffer` for the CIDv1 computation, neither of which exists in a
 * browser, and because pinning needs `PINATA_JWT` which must never reach the client.
 *
 * WHAT `setAgentURI` WOULD ADD, AND WHY IT IS NOT HERE YET
 *
 * ERC-8004 wants the `agentId` inside the registration file, and the id does not exist
 * until `register()` returns — so being fully spec-compliant costs a second signature
 * per chain. That is deliberately skipped for now: `ownerOf` is what the factory checks,
 * so the binding is correct either way, and the file is still a valid registration
 * without the `registrations` block. `RegistrationInput.agentId` is optional precisely
 * to allow this, and adding the second step later needs no change to what is written
 * here — call this route again with `agentId` set and send `setAgentURI`.
 */
export const dynamic = "force-dynamic";

/** Cap on the free-text fields, so a request cannot push an essay on-chain. */
const MAX_PERSONA = 400;
const MAX_NAME = 64;

/**
 * Batas laju, karena setiap panggilan yang sah MENYEMATKAN berkas ke Pinata atas akun kami.
 *
 * Sebelumnya rute ini tanpa autentikasi dan tanpa batas: satu loop atas ticker acak menghabiskan
 * kuota Pinata (atau menaikkan tagihannya) dan menerbitkan berkas permanen berisi teks pilihan
 * pemanggil di bawah deskripsi kami. Satu creator mendaftarkan agent sekali per pasar, jadi 10
 * per jam per alamat jauh di atas pemakaian sungguhan.
 */
const REGISTER_LIMIT = 10;
const REGISTER_WINDOW_MS = 60 * 60_000;

export async function POST(req: Request) {
  const gate = rateLimit(`agent-register:${clientIp(req)}`, REGISTER_LIMIT, REGISTER_WINDOW_MS);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many registration files requested. Try again later.", code: "RATE_LIMITED", retryAfter: gate.retryAfter },
      { status: 429, headers: rateLimitHeaders(gate) }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return payloadTooLarge(e.limit);
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object." }, { status: 400 });
  }

  const chainId = Number(body.chainId);
  const chain = CHAIN_LIST.find((c) => c.chainId === chainId);
  if (!chain) {
    return NextResponse.json(
      {
        error: `Unknown chainId ${body.chainId}. Supported: ${CHAIN_LIST.map((c) => c.chainId).join(", ")}.`,
        code: "UNKNOWN_CHAIN",
      },
      { status: 400 }
    );
  }

  /**
   * The registry is a per-chain singleton at the same deterministic address, and it is
   * ABSENT on every testnet. Refusing here rather than returning a URI keeps the failure
   * where it can be explained: a `register()` sent to an address with no code does not
   * revert in a way a wallet can describe.
   */
  const symbolRaw = String(body.symbol ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(symbolRaw)) {
    return NextResponse.json(
      { error: "A ticker of 2–12 letters or digits is required to describe the agent.", code: "BAD_SYMBOL" },
      { status: 400 }
    );
  }

  const marketName = String(body.marketName ?? "").trim().slice(0, MAX_NAME) || `$${symbolRaw}`;
  const persona = String(body.persona ?? "").trim().slice(0, MAX_PERSONA);

  /**
   * Description is ASSEMBLED here rather than taken wholesale from the request.
   *
   * What goes into a registration file is permanent and publicly attributed to us, so the
   * claims in it are ours to stand behind. The creator's persona is included as their
   * stated mandate and labelled as such; the settlement paragraph is written here because
   * it describes how this protocol actually behaves, and a caller must not be able to
   * replace it with something untrue about our own curve.
   */
  const settlement =
    "An unpaid request to the x402 endpoint is answered with HTTP 402 and a quote. Paying it means " +
    "signing an EIP-3009 authorization for USDC on Base, which the token contract verifies itself, and " +
    "the bonding curve sends the tokens straight to the payer's own address. Delivery is executed before " +
    "the charge, so a failed fill costs the protocol rather than the buyer.";

  const description =
    `Market agent for $${symbolRaw}, a bonding-curve market launched through ADEXTO on ${chain.name}. ` +
    `The curve opens against a virtual reserve, so it needs no liquidity deposit and is tradable from ` +
    `the first block. ` +
    (persona ? `Mandate stated by its creator: ${persona}. ` : "") +
    settlement;

  let file: Record<string, unknown>;
  try {
    file = buildRegistrationFile({
      name: `${marketName} Agent`,
      description,
      image: "https://adexto.xyz/logo.svg",
      services: [
        { name: "web", endpoint: "https://adexto.xyz" },
        {
          name: "x402",
          endpoint: `https://x402.adexto.xyz/v1/x402/buy/${symbolRaw.toLowerCase()}`,
          version: "v1",
        },
      ],
      x402Support: true,
      chainId: chain.chainId,
      registryAddress: AGENT_REGISTRY_ADDRESS,
      /**
       * `supportedTrust` left unset on purpose. The spec reads an absent or empty value
       * as "discovery only, not trust", which is the accurate claim while TEE attestation
       * is a label read from a router rather than a quote we verify.
       */
    });
  } catch (e) {
    // `buildRegistrationFile` throws on an empty name, empty description or a service
    // endpoint that does not parse. Those are our inputs, so a throw here is our bug.
    return NextResponse.json(
      { error: `Could not build the registration file: ${(e as Error).message}`, code: "BUILD_FAILED" },
      { status: 500 }
    );
  }

  const bytes = serialize(file);
  /**
   * Pinning is attempted, and falling back is not a failure.
   *
   * A `data:` URI is base64 of the same bytes, stored in the transaction itself — more
   * gas, but it cannot rot, and ERC-8004 explicitly allows it. That is a better outcome
   * than refusing to register because a third-party pinning service is down.
   */
  const pinned = await pinToIpfs(bytes);
  const uri = pinned.ok && pinned.uri ? pinned.uri : toDataUri(bytes);

  return NextResponse.json({
    /** Exactly what to pass to `register(string agentURI)`. */
    uri,
    uriMode: pinned.ok ? "ipfs" : "data",
    pinError: pinned.ok ? null : pinned.error,
    registry: AGENT_REGISTRY_ADDRESS,
    /** `eip155:<chainId>:<registry>`, the agent's home as ERC-8004 writes it. */
    agentRegistry: agentRegistryId(chain.chainId, AGENT_REGISTRY_ADDRESS),
    chainId: chain.chainId,
    chainName: chain.name,
    /** Returned so the client can show what it is about to make permanent. */
    file,
    bytes: bytes.length,
    cid: computeCidV1Raw(bytes),
  });
}
