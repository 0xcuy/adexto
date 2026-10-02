/**
 * Discovery metadata for the x402 gateway: how indexers find and describe it.
 *
 * Nothing here changes how a payment works. The challenge, the X-PAYMENT header, delivery-first
 * ordering and settlement are untouched; this module only adds descriptions that indexers read:
 *
 *   - `GET /openapi.json`: OpenAPI 3.1 with `x-payment-info` per paid operation. x402scan and
 *     AgentCash discovery read this first.
 *   - `GET /.well-known/x402`: the compatibility fan-out, one concrete URL per tradable market.
 *   - `extensions.bazaar` and `resource` on every 402 body: the x402 v2 Bazaar extension
 *     (input/output schema plus service name, tags and icon). Indexers that probe the endpoint
 *     itself mark a route without an input schema as non-invocable.
 *
 * Bazaar catalogs a route when a facilitator settles a payment that echoes the extension. This
 * gateway settles EIP-3009 itself, so the CDP Bazaar does not see it until settlement goes
 * through a facilitator. The metadata is published now so that switch needs no second change.
 *
 * Komentar di berkas ini sengaja English: isinya tersalin ke dokumen publik.
 */

export const SERVICE = {
  name: "ADEXTO",
  tags: ["tokens", "cross-chain", "bonding-curve", "usdc", "agents"],
  iconUrl: "https://adexto.xyz/brand/adexto-512.png",
  site: "https://adexto.xyz",
} as const;

/** The one paid route. `:symbol` is a market ticker; `chain` picks one when a ticker trades on several. */
export const ROUTE_TEMPLATE = "/v1/x402/buy/:symbol";

const GET_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    input: {
      type: "object",
      properties: {
        type: { type: "string", const: "http" },
        method: { type: "string", enum: ["GET", "HEAD", "DELETE"] },
        pathParams: {
          type: "object",
          properties: { symbol: { type: "string", description: "Market ticker, for example parcel." } },
          required: ["symbol"],
        },
        queryParams: {
          type: "object",
          properties: {
            chain: { type: "string", description: "Chain id of the market, for a ticker that trades on more than one chain." },
            to: { type: "string", description: "Address that receives the tokens. Defaults to the payer." },
          },
        },
        headers: { type: "object", additionalProperties: { type: "string" } },
      },
      required: ["type", "method"],
      additionalProperties: false,
    },
    output: {
      type: "object",
      properties: { type: { type: "string" }, example: { type: "object" } },
      required: ["type"],
    },
  },
  required: ["input"],
} as const;

/** What a paid call returns, trimmed to the fields an agent acts on. */
function outputExample(symbol: string, chainId: number) {
  return {
    symbol: symbol.toUpperCase(),
    delivery: {
      success: true,
      transaction: "0x…",
      chainId,
      to: "0x… (the payer unless ?to= is given)",
      minTokensOut: "…",
    },
    settlement: { success: true, transaction: "0x…", network: "base", amount: "100000" },
  };
}

/** `extensions.bazaar` for one market's 402 challenge. */
export function bazaarExtension(params: { slug: string; chainId: number; chainPinned: boolean }) {
  return {
    info: {
      input: {
        type: "http",
        method: "GET",
        pathParams: { symbol: params.slug },
        ...(params.chainPinned ? { queryParams: { chain: String(params.chainId) } } : {}),
      },
      output: { type: "json", example: outputExample(params.slug, params.chainId) },
    },
    schema: GET_SCHEMA,
    routeTemplate: ROUTE_TEMPLATE,
  };
}

/** Top-level `resource` of the 402 body, with the v2 service metadata. */
export function resourceInfo(params: { url: string; description: string }) {
  return {
    url: params.url,
    description: params.description,
    mimeType: "application/json",
    serviceName: SERVICE.name,
    tags: [...SERVICE.tags],
    iconUrl: SERVICE.iconUrl,
  };
}

export interface ListedMarket {
  slug: string;
  chainId: number;
  chainName?: string;
  tradable: boolean;
}

/** Markets from the site's own registry, the same source `/api/pool` resolves against. */
export async function listMarkets(origin: string): Promise<ListedMarket[]> {
  const res = await fetch(`${origin}/api/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "{ projects { slug chainId tradable } }" }),
  });
  if (!res.ok) throw new Error(`registry HTTP ${res.status}`);
  const j: any = await res.json();
  const projects: any[] = j?.data?.projects ?? [];
  return projects
    .filter((p) => typeof p?.slug === "string" && Number.isFinite(Number(p?.chainId)))
    .map((p) => ({ slug: String(p.slug), chainId: Number(p.chainId), chainName: p.chainName, tradable: Boolean(p.tradable) }));
}

/** `/.well-known/x402`, version 1: one concrete URL per tradable market. */
export function wellKnownX402(gateway: string, markets: ListedMarket[]) {
  return {
    version: 1,
    resources: markets.filter((m) => m.tradable).map((m) => `${gateway}/v1/x402/buy/${m.slug}?chain=${m.chainId}`),
    instructions:
      "Each resource buys one market's token with USDC on Base. GET it without a payment for the 402 quote, sign " +
      "the EIP-3009 authorization in accepts[0], then repeat the request with the base64 payload in X-PAYMENT. " +
      "The curve on the market's own chain sends the tokens to the payer; delivery happens before the charge.",
  };
}

/** OpenAPI 3.1 for the gateway. The price is the configured one, read at request time. */
export function openApiDocument(params: { gateway: string; priceAtomic: bigint; markets: ListedMarket[] }) {
  const usd = (Number(params.priceAtomic) / 1e6).toFixed(2);
  const examples = params.markets.filter((m) => m.tradable).slice(0, 12);
  return {
    openapi: "3.1.0",
    info: {
      title: "ADEXTO x402 gateway",
      version: "1.1.0",
      description:
        "Buy any ADEXTO bonding-curve market with USDC on Base and receive the token on the market's own chain " +
        "(0G, Base, Arbitrum One, Monad, Robinhood Chain). No bridge, no gas on the destination chain. Delivery " +
        "is executed before the charge, so a failed fill costs the gateway, not the buyer.",
      "x-guidance":
        `GET /v1/x402/buy/{symbol} without payment returns 402 with a live quote in "quote" and the payment terms ` +
        `in accepts[0] (exact scheme, USDC on Base, EIP-3009). Sign transferWithAuthorization for exactly ` +
        `maxAmountRequired to payTo, base64-encode {x402Version, scheme, network, payload:{signature, authorization}}, ` +
        `and repeat the request with it in the X-PAYMENT header. Pass ?chain=<id> when a ticker trades on more ` +
        `than one chain and ?to=<address> to deliver to another wallet. Market list: ${SERVICE.site}/api/graphql. ` +
        `The same flow is available as MCP tools at ${SERVICE.site}/api/mcp.`,
      contact: { name: "ADEXTO", url: `${SERVICE.site}/contact` },
    },
    servers: [{ url: params.gateway }],
    externalDocs: { description: "x402 integration reference", url: `${SERVICE.site}/x402` },
    paths: {
      "/v1/x402/buy/{symbol}": {
        get: {
          operationId: "buyMarket",
          summary: `Buy a market's token with ${usd} USDC on Base, delivered on the market's own chain`,
          description:
            "Unpaid: 402 with the quote and accepts[0]. Paid (X-PAYMENT header): the curve buys the token for the " +
            "payer on the market's chain, then the USDC authorization is settled. Refusals that happen before any " +
            "charge: unknown market (404), market not tradable (409), out of inventory (503).",
          security: [],
          parameters: [
            {
              name: "symbol",
              in: "path",
              required: true,
              description: "Market ticker, case-insensitive.",
              schema: { type: "string", pattern: "^[A-Za-z0-9]{2,12}$" },
              examples: Object.fromEntries(examples.map((m) => [`${m.slug}-${m.chainId}`, { value: m.slug }])),
            },
            {
              name: "chain",
              in: "query",
              required: false,
              description: "Chain id of the market, for a ticker that trades on more than one chain.",
              schema: { type: "integer" },
            },
            {
              name: "to",
              in: "query",
              required: false,
              description: "Address that receives the tokens. Defaults to the address that signed the payment.",
              schema: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" },
            },
            {
              name: "X-PAYMENT",
              in: "header",
              required: false,
              description: "Base64 x402 payment payload. Omit it to receive the 402 quote.",
              schema: { type: "string" },
            },
          ],
          "x-payment-info": {
            price: { mode: "fixed", currency: "USD", amount: usd },
            protocols: [{ x402: { scheme: "exact", network: "base", asset: "USDC" } }],
          },
          responses: {
            "200": {
              description: "Delivered and settled. delivery.transaction is the buy on the market's chain.",
              content: { "application/json": { schema: { type: "object" }, example: outputExample("parcel", 143) } },
            },
            "402": { description: "Payment Required: quote plus accepts[0], or a payment that failed verification." },
            "404": { description: "Unknown market. No payment was taken." },
            "409": { description: "Market not tradable. No payment was taken." },
            "503": { description: "Quote, inventory or chain unavailable. No payment was taken." },
          },
        },
      },
    },
  };
}
