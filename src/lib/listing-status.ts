/**
 * Status listing sebuah token di agregator, untuk launch kit di Studio.
 *
 * Dibaca dari API publik masing-masing agregator tanpa kunci. Yang dikirim ke mereka hanya chain
 * dan alamat token, keduanya publik. Hasilnya di-cache sepuluh menit per token: GeckoTerminal
 * membatasi API publiknya sekitar 30 panggilan per menit dan menjawab 429 di atasnya.
 *
 * "unknown" berarti agregatornya tidak menjawab dengan jelas (timeout, 429, 5xx); UI tidak boleh
 * membacanya sebagai "belum terdaftar".
 */
import { DEXSCREENER_CHAIN, GECKOTERMINAL_NETWORK, type AggregatorListing, type ListingStatus } from "@/lib/launch-kit";

const TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 5_000;

declare global {
  var __ADEXTO_LISTING_STATUS__: Map<string, { at: number; value: Promise<ListingStatus> }> | undefined;
}

function cache() {
  if (!globalThis.__ADEXTO_LISTING_STATUS__) globalThis.__ADEXTO_LISTING_STATUS__ = new Map();
  return globalThis.__ADEXTO_LISTING_STATUS__;
}

async function getJson(url: string): Promise<{ status: number; body: any }> {
  const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function dexScreener(chainId: number, token: string): Promise<AggregatorListing> {
  const slug = DEXSCREENER_CHAIN[chainId];
  if (!slug) return { name: "DEX Screener", state: "unsupported-chain", url: null };
  try {
    const { status, body } = await getJson(`https://api.dexscreener.com/token-pairs/v1/${slug}/${token}`);
    if (status !== 200 || !Array.isArray(body)) return { name: "DEX Screener", state: "unknown", url: null };
    const pair = body.find((p: any) => typeof p?.url === "string" && p.url.startsWith("https://dexscreener.com/"));
    return pair ? { name: "DEX Screener", state: "listed", url: pair.url } : { name: "DEX Screener", state: "not-listed", url: null };
  } catch {
    return { name: "DEX Screener", state: "unknown", url: null };
  }
}

async function geckoTerminal(chainId: number, token: string): Promise<AggregatorListing> {
  const network = GECKOTERMINAL_NETWORK[chainId];
  if (!network) return { name: "GeckoTerminal", state: "unsupported-chain", url: null };
  try {
    const { status, body } = await getJson(`https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${token}/pools?page=1`);
    if (status === 404) return { name: "GeckoTerminal", state: "not-listed", url: null };
    if (status !== 200 || !Array.isArray(body?.data)) return { name: "GeckoTerminal", state: "unknown", url: null };
    const pool = body.data.find((p: any) => typeof p?.attributes?.address === "string");
    return pool
      ? { name: "GeckoTerminal", state: "listed", url: `https://www.geckoterminal.com/${network}/pools/${pool.attributes.address}` }
      : { name: "GeckoTerminal", state: "not-listed", url: null };
  } catch {
    return { name: "GeckoTerminal", state: "unknown", url: null };
  }
}

export function getListingStatus(chainId: number, token: string): Promise<ListingStatus> {
  const key = `${chainId}:${token.toLowerCase()}`;
  const hit = cache().get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = Promise.all([dexScreener(chainId, token), geckoTerminal(chainId, token)]).then((aggregators) => ({
    chainId,
    token,
    aggregators,
    checkedAt: Math.floor(Date.now() / 1000),
  }));
  cache().set(key, { at: Date.now(), value });
  // Jawaban yang seluruhnya "unknown" tidak disimpan sepuluh menit; pemanggil berikutnya mencoba lagi.
  value.then((s) => {
    if (s.aggregators.every((a) => a.state === "unknown" || a.state === "unsupported-chain")) cache().delete(key);
  });
  return value;
}
