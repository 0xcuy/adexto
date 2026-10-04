import { clientIp, rateLimit, rateLimitHeaders, type RateLimitVerdict } from "@/lib/rate-limit";
import { BodyTooLargeError, payloadTooLarge, readJsonBody } from "@/lib/body-limit";

/**
 * RPC publik BACA-SAJA untuk peramban, per chain. Dipakai lewat `/api/public-rpc/[chain]`.
 *
 * KENAPA INI ADA
 *
 * ISP Indonesia memblokir `*.robinhood.com`. Peramban membaca Robinhood Chain langsung ke
 * `rpc.mainnet.chain.robinhood.com`, jadi pengunjung tanpa VPN melihat "You receive" kosong dan
 * Fee $0.00 di setiap pasar 4663 (terukur 5 Okt 2026, Pixel 7 id-ID dengan host itu diblokir).
 * Server tidak terkena karena VPS berada di luar Indonesia, jadi peramban membaca lewat sini.
 *
 * PUBLIK TANPA AUTENTIKASI, DAN ITU DISENGAJA
 *
 * Isinya data chain publik yang juga dilayani gratis oleh RPC publik Robinhood sendiri. Tidak
 * ada kunci yang bisa dibocorkan dan tidak ada uang yang bisa dibelanjakan lewat sini:
 *
 *   - daftar izin metode yang hanya membaca; `eth_sendRawTransaction`, `eth_sign*`,
 *     `personal_*`, `debug_*`, `trace_*`, `txpool_*`, `admin_*`, filter dan subscribe tidak
 *     pernah lolos;
 *   - satu objek JSON-RPC per permintaan (batch ditolak, karena batch bisa menyelundupkan
 *     banyak panggilan di bawah satu hitungan batas laju), body ≤ 16 KB;
 *   - params dibangun ulang dari field yang dikenal, bukan diteruskan apa adanya;
 *   - batas laju per IP dan batas bersama untuk panggilan ke upstream, plus cache singkat.
 *
 * Tujuan batas bersama dan cache: upstream publik Robinhood juga melayani pembacaan SERVER kita
 * dari IP VPS yang sama. Lalu lintas pengunjung tidak boleh membuat pembacaan server kena batas.
 *
 * BUKAN relai berkunci `src/app/api/rpc/[chain]/route.ts`. Relai itu milik Worker x402, berkunci
 * `X-Relay-Key`, dan mengizinkan siaran transaksi. Kuncinya tidak boleh sampai ke peramban, jadi
 * kedua jalur sengaja terpisah dan tidak berbagi kode. URL upstream di bawah disalin, bukan diimpor.
 *
 * Tanpa header CORS: endpoint ini untuk origin sendiri. Peramban di origin lain tidak bisa
 * membaca jawabannya; klien non-peramban bisa, dan itu sama saja dengan memakai RPC publiknya.
 */

export interface PublicRpcChain {
  readonly chainId: number;
  readonly upstreams: readonly string[];
}

/** Segmen jalur → chain. Hanya chain yang memang tidak terjangkau dari sebagian jaringan pengunjung. */
const PUBLIC_RPC_CHAINS: Record<string, PublicRpcChain> = {
  // drpc dulu: dari VPS 0,05–0,07 dtk per `eth_call`, endpoint resmi 1,5–1,9 dtk (terukur 5 Okt
  // 05:4x, lihat `SERVER_READ_RPC` di chains.ts). Endpoint resmi tetap cadangan bila drpc gagal.
  robinhood: {
    chainId: 4663,
    upstreams: ["https://robinhood.drpc.org", "https://rpc.mainnet.chain.robinhood.com"],
  },
};

/**
 * `hasOwnProperty`, bukan `PUBLIC_RPC_CHAINS[seg]`: `constructor`, `toString`, `__proto__` juga
 * segmen jalur yang sah, dan pencarian biasa akan menemukannya di prototipe objek.
 */
export function publicRpcChain(segment: string): PublicRpcChain | null {
  return Object.prototype.hasOwnProperty.call(PUBLIC_RPC_CHAINS, segment) ? PUBLIC_RPC_CHAINS[segment] : null;
}

export const PUBLIC_RPC_MAX_BODY_BYTES = 16 * 1024;
/** `data`/`input` pada `eth_call`/`eth_estimateGas`, dalam karakter hex sesudah `0x`. Terukur: 8. */
const MAX_CALLDATA_HEX = 8 * 1024;
const UPSTREAM_TIMEOUT_MS = 8_000;

/**
 * Angka dari pengukuran R1.0 (LOG 5 Okt 01:02): halaman token 4663 yang dibiarkan terbuka
 * mengirim 45–48 `eth_call` per menit; menit paling sibuk (muat + ketik + tab Stake) ≈ 95.
 *
 * Per IP 240 per menit = 5× halaman diam. Jendela 60 detik, bukan 5 menit, supaya satu keranjang
 * paling banyak menyimpan 240 stempel: angka yang dipakai `rate-limit.ts` untuk menghitung batas
 * memorinya (10.000 kunci × 240 × 8 B).
 *
 * Bersama 4.000 per menit (≈ 67/detik), dihitung HANYA pada panggilan yang benar-benar pergi ke
 * upstream. Jawaban dari cache tidak membebani siapa pun, jadi tidak ikut dihitung.
 */
export const PUBLIC_RPC_LIMITS = { perIp: 240, shared: 4_000, windowMs: 60_000 } as const;

/** Metode yang boleh lewat, dengan validator params-nya. Isinya dari R1.0, bukan dari daftar relai. */
type Params = unknown[];
type Validator = (params: Params) => Params | null;

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX_HASH = /^0x[0-9a-fA-F]{64}$/;
const HEX_QUANTITY = /^0x[0-9a-fA-F]{1,64}$/;
const HEX_DATA = /^0x(?:[0-9a-fA-F]{2})*$/;

const isAddress = (v: unknown): v is string => typeof v === "string" && HEX_ADDRESS.test(v);
const isQuantity = (v: unknown): v is string => typeof v === "string" && HEX_QUANTITY.test(v);

/** `latest`/`pending`/nomor blok hex. Tag tidak ada berarti `latest`. Tanpa `earliest`, tanpa objek EIP-1898. */
function blockTag(v: unknown): string | null {
  if (v === undefined) return "latest";
  if (v === "latest" || v === "pending") return v;
  return isQuantity(v) ? v : null;
}

/**
 * Objek transaksi untuk `eth_call`/`eth_estimateGas`, dibangun ulang dari field yang dikenal.
 * `to` wajib: tidak ada pemakai yang mensimulasikan pembuatan kontrak dari peramban.
 */
function txObject(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const tx = v as Record<string, unknown>;
  if (!isAddress(tx.to)) return null;
  const out: Record<string, string> = { to: tx.to };
  if (tx.from !== undefined) {
    if (!isAddress(tx.from)) return null;
    out.from = tx.from;
  }
  for (const key of ["data", "input"] as const) {
    const d = tx[key];
    if (d === undefined) continue;
    if (typeof d !== "string" || !HEX_DATA.test(d) || d.length - 2 > MAX_CALLDATA_HEX) return null;
    out[key] = d;
  }
  for (const key of ["value", "gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "nonce", "type", "chainId"] as const) {
    const q = tx[key];
    if (q === undefined || q === null) continue;
    if (!isQuantity(q)) return null;
    out[key] = q;
  }
  return out;
}

const noParams: Validator = (p) => (p.length === 0 ? [] : null);

const callLike: Validator = (p) => {
  if (p.length < 1 || p.length > 2) return null; // params ke-3 (state override) tidak diterima
  const tx = txObject(p[0]);
  const tag = blockTag(p[1]);
  return tx && tag ? [tx, tag] : null;
};

const addressAtBlock: Validator = (p) => {
  if (p.length < 1 || p.length > 2 || !isAddress(p[0])) return null;
  const tag = blockTag(p[1]);
  return tag ? [p[0], tag] : null;
};

const txHash: Validator = (p) => (p.length === 1 && typeof p[0] === "string" && HEX_HASH.test(p[0]) ? [p[0]] : null);

const ALLOWED: Record<string, Validator> = {
  eth_chainId: noParams,
  eth_blockNumber: noParams,
  eth_gasPrice: noParams,
  eth_maxPriorityFeePerGas: noParams,
  eth_call: callLike,
  eth_estimateGas: callLike,
  eth_getBalance: addressAtBlock,
  eth_getCode: addressAtBlock,
  eth_getTransactionCount: addressAtBlock,
  eth_getTransactionReceipt: txHash,
  eth_getTransactionByHash: txHash,
  // Hanya hash transaksi (`false`), bukan isi penuhnya: ethers `getFeeData` hanya butuh itu.
  eth_getBlockByNumber: (p) => {
    if (p.length !== 2 || p[1] !== false) return null;
    const tag = blockTag(p[0]);
    return tag ? [tag, false] : null;
  },
};

// ── cache ─────────────────────────────────────────────────────────────────────

const CACHE_MAX = 2_000;
const CACHE_KEY = "__adextoPublicRpcCacheV1";
const INFLIGHT_KEY = "__adextoPublicRpcInflightV1";
type CacheEntry = { exp: number; result: unknown };

/** Bentuknya divalidasi, bukan diasumsikan: `globalThis` bertahan melewati hot-reload (lihat rate-limit.ts). */
function globalMap<V>(key: string): Map<string, V> {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!(g[key] instanceof Map)) g[key] = new Map<string, V>();
  return g[key] as Map<string, V>;
}

/** Lama cache per metode, atau 0 bila tidak di-cache. `eth_chainId` dijawab dari config, tanpa upstream. */
function cacheTtlMs(method: string, params: Params): number {
  if (method === "eth_blockNumber") return 1_000;
  if (method === "eth_call" || method === "eth_getBalance" || method === "eth_getCode") {
    return params[params.length - 1] === "latest" ? 2_000 : 0;
  }
  return 0;
}

function cacheGet(key: string, now: number): CacheEntry | null {
  const m = globalMap<CacheEntry>(CACHE_KEY);
  const e = m.get(key);
  if (!e || typeof e !== "object" || typeof e.exp !== "number") return null;
  if (e.exp <= now) {
    m.delete(key);
    return null;
  }
  return e;
}

function cacheSet(key: string, result: unknown, ttl: number, now: number): void {
  const m = globalMap<CacheEntry>(CACHE_KEY);
  m.delete(key);
  if (m.size >= CACHE_MAX) {
    for (const [k, e] of m) if (!e || e.exp <= now) m.delete(k);
    while (m.size >= CACHE_MAX) {
      const first = m.keys().next();
      if (first.done) break;
      m.delete(first.value);
    }
  }
  m.set(key, { exp: now + ttl, result });
}

// ── upstream ──────────────────────────────────────────────────────────────────

type UpstreamReply =
  | { kind: "result"; result: unknown }
  | { kind: "error"; error: { code: number; message: string; data?: string } }
  | { kind: "unavailable" };

/**
 * Upstream untuk uji lokal (`PUBLIC_RPC_TEST_UPSTREAM`), hanya bila menunjuk loopback, supaya
 * variabel yang tertinggal di env tidak bisa mengalihkan pembacaan pengunjung ke host lain.
 */
function upstreamsFor(chain: PublicRpcChain): readonly string[] {
  const test = process.env.PUBLIC_RPC_TEST_UPSTREAM?.trim();
  if (test && /^http:\/\/127\.0\.0\.1:\d{1,5}(\/[^\s]*)?$/.test(test)) return [test];
  return chain.upstreams;
}

async function callUpstream(chain: PublicRpcChain, method: string, params: Params): Promise<UpstreamReply> {
  // Header dan cookie klien TIDAK diteruskan; badan dibangun ulang dengan id kita sendiri.
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  for (const url of upstreamsFor(chain)) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { result?: unknown; error?: { code?: unknown; message?: unknown; data?: unknown } };
      if (json && typeof json === "object" && "result" in json && json.result !== undefined) {
        return { kind: "result", result: json.result };
      }
      if (json?.error && typeof json.error === "object") {
        const e = json.error;
        // Galat PENYEDIA (batas laju, kuota, timeout) bukan jawaban chain: coba upstream berikutnya.
        const msg = typeof e.message === "string" ? e.message : "";
        if (!/revert/i.test(msg) && /rate|limit|too many|quota|timeout|unavailable|capacity/i.test(msg)) continue;
        // Galat chain (mis. "execution reverted" beserta data revert-nya) diteruskan: ethers butuh
        // data itu untuk menjelaskan revert. Bentuknya dibatasi, isinya tidak diubah.
        const error: { code: number; message: string; data?: string } = {
          code: typeof e.code === "number" ? e.code : -32603,
          message: typeof e.message === "string" ? e.message.slice(0, 500) : "upstream error",
        };
        if (typeof e.data === "string" && HEX_DATA.test(e.data) && e.data.length <= 2 + MAX_CALLDATA_HEX) error.data = e.data;
        return { kind: "error", error };
      }
    } catch {
      // Habis waktu, jaringan, atau bukan JSON: coba upstream berikutnya.
    }
  }
  return { kind: "unavailable" };
}

// ── handler ───────────────────────────────────────────────────────────────────

type RpcId = string | number | null;

function reply(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

function rpcError(id: RpcId, code: number, message: string, status: number, headers?: Record<string, string>): Response {
  return reply({ jsonrpc: "2.0", id, error: { code, message } }, status, headers);
}

function limited(v: RateLimitVerdict): Response {
  return rpcError(null, -32005, "Rate limit exceeded. Retry later.", 429, rateLimitHeaders(v));
}

export async function handlePublicRpc(req: Request, segment: string): Promise<Response> {
  const chain = publicRpcChain(segment);
  if (!chain) return rpcError(null, -32601, "Unknown chain.", 404);

  // Dihitung sebelum badan dibaca, jadi spam yang cacat pun ikut terbatas.
  const perIp = rateLimit(`public-rpc:${segment}:${clientIp(req)}`, PUBLIC_RPC_LIMITS.perIp, PUBLIC_RPC_LIMITS.windowMs);
  if (!perIp.ok) return limited(perIp);

  let body: unknown;
  try {
    body = await readJsonBody(req, PUBLIC_RPC_MAX_BODY_BYTES);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return payloadTooLarge(PUBLIC_RPC_MAX_BODY_BYTES);
    return rpcError(null, -32700, "Parse error.", 400);
  }

  if (Array.isArray(body)) return rpcError(null, -32600, "Batch requests are not supported. Send one call per request.", 400);
  if (!body || typeof body !== "object") return rpcError(null, -32600, "Invalid request.", 400);
  const msg = body as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

  // `id` milik klien dikembalikan apa adanya, asal bentuknya sah dan pendek.
  const rawId = msg.id ?? null;
  const idOk =
    rawId === null ||
    (typeof rawId === "number" && Number.isFinite(rawId)) ||
    (typeof rawId === "string" && rawId.length <= 100);
  if (!idOk) return rpcError(null, -32600, "Invalid request id.", 400);
  const id = rawId as RpcId;
  if (msg.jsonrpc !== undefined && msg.jsonrpc !== "2.0") return rpcError(id, -32600, "Invalid request.", 400);
  if (typeof msg.method !== "string") return rpcError(id, -32600, "Invalid request.", 400);

  const method = msg.method;
  const validate = Object.prototype.hasOwnProperty.call(ALLOWED, method) ? ALLOWED[method] : null;
  if (!validate) return rpcError(id, -32601, `Method ${method.slice(0, 64)} is not available on this read-only endpoint.`, 400);

  const rawParams = msg.params === undefined ? [] : msg.params;
  const params = Array.isArray(rawParams) ? validate(rawParams) : null;
  if (!params) return rpcError(id, -32602, `Invalid params for ${method}.`, 400);

  if (method === "eth_chainId") return reply({ jsonrpc: "2.0", id, result: `0x${chain.chainId.toString(16)}` }, 200);

  const now = Date.now();
  const ttl = cacheTtlMs(method, params);
  const key = `${segment}:${method}:${JSON.stringify(params)}`;
  if (ttl > 0) {
    const hit = cacheGet(key, now);
    if (hit) return reply({ jsonrpc: "2.0", id, result: hit.result }, 200);
  }

  // Permintaan identik yang sedang berjalan ditunggu bersama, bukan dikirim dua kali.
  const inflight = globalMap<Promise<UpstreamReply>>(INFLIGHT_KEY);
  let pending = ttl > 0 ? inflight.get(key) : undefined;
  if (!(pending instanceof Promise)) {
    const shared = rateLimit(`public-rpc:${segment}:all`, PUBLIC_RPC_LIMITS.shared, PUBLIC_RPC_LIMITS.windowMs, { pinned: true });
    if (!shared.ok) return limited(shared);
    pending = callUpstream(chain, method, params);
    if (ttl > 0) {
      inflight.set(key, pending);
      void pending.finally(() => inflight.delete(key));
    }
  }
  const up = await pending;

  if (up.kind === "unavailable") return rpcError(id, -32603, "upstream unavailable", 502);
  if (up.kind === "error") return reply({ jsonrpc: "2.0", id, error: up.error }, 200);
  if (ttl > 0) cacheSet(key, up.result, ttl, Date.now());
  return reply({ jsonrpc: "2.0", id, result: up.result }, 200);
}
