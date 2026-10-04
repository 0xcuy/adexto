import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";

/**
 * Penjaga render kartu bagikan (`/api/share-card/*`): cache, antrean, dan anggaran render.
 *
 * KENAPA INI ADA
 *
 * Setiap kartu dirender ulang pada SETIAP permintaan: satori menata JSX, resvg meng-encode PNG
 * 1200x630, ditambah QR — semuanya di thread utama satu-satunya proses Node situs ini — dan
 * kartu pasar menambahkan 15 `eth_call` lewat `readPoolState`. Satu-satunya penjaga adalah
 * `Cache-Control: public, max-age=300`, yang tidak menolong sama sekali: `?r=<acak>` membuat
 * setiap permintaan kunci cache baru di edge, dan route-nya mengabaikan parameter tambahan.
 * Loop `curl` paralel ke satu kartu cukup untuk membuat event loop sibuk menggambar, dan
 * selama itu `/api/rpc/base` — relai yang dipakai Worker x402 untuk menyelesaikan pembayaran —
 * ikut menunggu di proses yang sama.
 *
 * TIGA LAPIS
 *
 *   1. Cache di memori per (pasar, chain), 60 detik, termasuk render yang sedang berjalan.
 *      Kuncinya dibentuk dari pasar yang sudah DIRESOLUSI registry, bukan dari query string,
 *      jadi jumlah kunci dibatasi jumlah pasar dan parameter acak tidak membuat kunci baru.
 *   2. Anggaran render: per IP dan global. Yang dihitung hanya render sungguhan (cache miss);
 *      crawler X/Telegram yang mengambil kartu yang sama berulang kali tidak pernah kena.
 *   3. Paling banyak dua render bersamaan, sisanya antre dalam batas. Render sendiri sinkron di
 *      thread utama, jadi yang dibatasi di sini terutama pembacaan RPC dan memori yang menyertai.
 *
 * Melewati batas dijawab 429 (per IP) atau 503 dengan `Retry-After` (global/antrean penuh):
 * crawler sosial mencoba lagi, dan kartu yang tertunda lebih baik daripada situs yang macet.
 */

interface Rendered {
  at: number;
  status: number;
  headers: [string, string][];
  /** Disalin oleh `new Response()` setiap kali disajikan, jadi aman dipakai berulang. */
  body: ArrayBuffer;
}

const TTL_MS = 60_000;
const MAX_ENTRIES = 256;
const MAX_ACTIVE = 2;
const MAX_WAITING = 24;

const RENDERS_PER_IP = 20;
const RENDERS_GLOBAL = 120;
const RENDER_WINDOW_MS = 60_000;

const cache = new Map<string, Rendered>();
const inflight = new Map<string, Promise<Rendered>>();

let active = 0;
const waiting: Array<() => void> = [];

/** `false` kalau antrean sudah penuh. Slot diserahkan langsung ke penunggu berikutnya. */
async function acquire(): Promise<boolean> {
  if (active < MAX_ACTIVE) {
    active += 1;
    return true;
  }
  if (waiting.length >= MAX_WAITING) return false;
  await new Promise<void>((resolve) => waiting.push(resolve));
  return true;
}

function release(): void {
  const next = waiting.shift();
  if (next) next();
  else active -= 1;
}

class BusyError extends Error {}

function toResponse(r: Rendered): Response {
  return new Response(r.body, { status: r.status, headers: r.headers });
}

function remember(key: string, r: Rendered): void {
  if (r.status !== 200) return;
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, r);
}

async function renderOnce(render: () => Promise<Response>): Promise<Rendered> {
  if (!(await acquire())) throw new BusyError();
  try {
    const res = await render();
    const body = await res.arrayBuffer();
    return { at: Date.now(), status: res.status, headers: [...res.headers], body };
  } finally {
    release();
  }
}

/**
 * Sajikan satu kartu. `key` null berarti kartu ini tidak boleh di-cache (mis. kartu posisi,
 * yang memuat saldo seseorang), tetapi tetap tunduk pada anggaran dan antrean.
 */
export async function serveCard(req: Request, key: string | null, render: () => Promise<Response>): Promise<Response> {
  if (key) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return toResponse(hit);
    const pending = inflight.get(key);
    if (pending) {
      try {
        return toResponse(await pending);
      } catch (e) {
        if (e instanceof BusyError) return busy();
        throw e;
      }
    }
  }

  const perIp = rateLimit(`share-render:${clientIp(req)}`, RENDERS_PER_IP, RENDER_WINDOW_MS);
  if (!perIp.ok) {
    return new Response("Too many share cards rendered for this address. Retry shortly.", {
      status: 429,
      headers: rateLimitHeaders(perIp),
    });
  }
  const global = rateLimit("share-render:global", RENDERS_GLOBAL, RENDER_WINDOW_MS, { pinned: true });
  if (!global.ok) return busy(global.retryAfter);

  const job = renderOnce(render);
  if (key) {
    inflight.set(key, job);
    void job.then(
      (r) => remember(key, r),
      () => undefined
    ).finally(() => inflight.delete(key));
  }
  try {
    return toResponse(await job);
  } catch (e) {
    if (e instanceof BusyError) return busy();
    throw e;
  }
}

function busy(retryAfter = 5): Response {
  return new Response("Share card renderer is busy. Retry shortly.", {
    status: 503,
    headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" },
  });
}
