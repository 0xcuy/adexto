/**
 * Pool Agent Compute: menerbitkan kunci API per pemegang stake, dan menegakkan jatahnya.
 *
 * BENTUKNYA, DAN KENAPA TIDAK ADA PROXY
 *
 * Kunci yang diterima pemegang stake adalah kunci ASLI Adexto Router. Mereka memanggil
 * `https://compute.adexto.xyz/v1` langsung; situs ini tidak berada di jalur panggilan. Pilihan
 * itu diambil sengaja, dan alternatifnya sempat ditimbang:
 *
 *   Gerbang OpenAI-compatible di `adexto.xyz` yang meneruskan ke router. Memberi penghitungan
 *   per token yang tepat dan penolakan seketika saat jatah habis — tapi menaruh Next.js di
 *   jalur setiap aliran SSE, menuntut endpoint yang berbeda dari yang dijanjikan, dan
 *   menggandakan tempat yang bisa mati.
 *
 *   Mencocokkan header Authorization di Caddy supaya kunci ADEXTO dibelokkan ke aplikasi.
 *   Endpointnya tetap sama, tapi routing berdasarkan isi kredensial adalah perilaku yang tidak
 *   akan diduga siapa pun yang membaca berkas Caddy setahun dari sekarang.
 *
 * Yang dipakai: router SUDAH mencatat `promptTokens` dan `completionTokens` per kunci di tabel
 * `usageHistory`, dan `apiKeys.isActive` sudah menjadi gerbang di jalur permintaannya. Jadi
 * penegakan tidak menuntut kode baru di jalur panas — ia menuntut pembacaan berkala dan satu
 * PUT. Yang hilang dari pilihan ini dinyatakan apa adanya di UI: penegakannya per sapuan, jadi
 * sebuah kunci bisa melewati jatahnya sampai satu sapuan sebelum mati.
 *
 * APA YANG DISIMPAN, DAN APA YANG TIDAK
 *
 * Rahasia kuncinya TIDAK disimpan di sisi ini. Ia dikembalikan sekali ke pemiliknya saat dibuat;
 * sesudah itu yang kami pegang hanya `routerKeyId` dan awalannya untuk ditampilkan. Saat sapuan
 * butuh mencocokkan catatan pemakaian, rahasianya dibaca ulang dari router lewat sesi admin dan
 * langsung dibuang.
 */
import { ethers } from "ethers";
import { isDurable, readJson, writeJson } from "@/lib/server-store";
import { CHAIN_LIST } from "@/lib/chains";
import {
  AGENT_COMPUTE_PROVIDER,
  MIN_STAKE_ADEXTO,
  STAKE_TOKEN,
  stakeContractFor,
  tierForStake,
} from "@/config/agent-compute";

const STORE_FILE = "agent-compute-keys.json";
const KEY_NAME_PREFIX = "adx:";

/** Satu kunci yang diterbitkan, sebagaimana kami menyimpannya. */
export type PoolKey = {
  /** Alamat pemilik, huruf kecil. Satu alamat satu kunci. */
  address: string;
  /** Id kunci di router, dipakai untuk mengaktifkan dan mematikan. */
  routerKeyId: string;
  /** Awalan untuk ditampilkan. Bukan rahasia: router memberi awalan yang sama ke semua kunci. */
  keyPrefix: string;
  name: string;
  createdAt: string;
  /** Tingkatan pada sapuan terakhir, bukan pada saat diterbitkan. */
  tierLabel: string | null;
  allowance: number;
  /** Kumulatif, monoton naik. Lihat `accumulate`. */
  usedInput: number;
  usedOutput: number;
  requests: number;
  active: boolean;
  /** Kenapa dimatikan, dalam bahasa yang boleh dilihat pemiliknya. */
  disabledReason: string | null;
  stakedAtLastSweep: number | null;
  lastSweepAt: string | null;
};

type Store = { keys: PoolKey[] };

function load(): Store {
  return readJson<Store>(STORE_FILE, { keys: [] });
}

function save(store: Store): boolean {
  return writeJson(STORE_FILE, store);
}

export function storeIsDurable(): boolean {
  return isDurable();
}

// ─── klien admin router ────────────────────────────────────────────────────────

const ROUTER_URL = (process.env.AGENT_COMPUTE_ROUTER_URL || "https://compute.adexto.xyz").replace(
  /\/+$/,
  ""
);
const ROUTER_PASSWORD = process.env.AGENT_COMPUTE_ROUTER_PASSWORD || "";

/**
 * Pool dianggap tidak terkonfigurasi tanpa kata sandi admin, dan itu gagal-tertutup dengan
 * sengaja. Tanpa sesi admin kami tidak bisa membuat kunci DAN tidak bisa mematikannya; yang
 * kedua lebih penting. Menerbitkan kunci yang tidak bisa dicabut lebih buruk daripada tidak
 * menerbitkan apa pun.
 */
export function poolConfigured(): boolean {
  return Boolean(ROUTER_PASSWORD);
}

/**
 * Cookie sesi admin, disimpan di memori proses.
 *
 * Tidak dicoba di-cache ke disk: sesinya murah dibuat ulang, dan menulis kredensial sesi ke
 * volume hanya menambah tempat ia bisa bocor.
 */
let sessionCookie: string | null = null;

async function login(): Promise<void> {
  const res = await fetch(`${ROUTER_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: ROUTER_PASSWORD }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Router admin login failed (${res.status}).`);
  }
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("Router admin login returned no session cookie.");
  // Hanya pasangan nama=nilai yang dipakai; atribut Path/HttpOnly/SameSite tidak dikirim balik.
  sessionCookie = setCookie
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

/**
 * Satu permintaan ke API admin router, dengan satu kali login ulang kalau sesinya kedaluwarsa.
 * Login ulang dibatasi satu kali supaya kata sandi yang salah tidak berubah menjadi lingkaran
 * percobaan masuk terhadap pembatas laju router sendiri.
 */
async function adminFetch(path: string, init?: RequestInit, retried = false): Promise<Response> {
  if (!poolConfigured()) throw new Error("Agent compute pool is not configured on the server.");
  if (!sessionCookie) await login();

  const res = await fetch(`${ROUTER_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "content-type": "application/json",
      cookie: sessionCookie as string,
    },
    cache: "no-store",
  });

  if ((res.status === 401 || res.status === 403) && !retried) {
    sessionCookie = null;
    return adminFetch(path, init, true);
  }
  return res;
}

type RouterKey = { id: string; key: string; name: string; isActive: boolean };

async function listRouterKeys(): Promise<RouterKey[]> {
  const res = await adminFetch("/api/keys", { method: "GET" });
  if (!res.ok) throw new Error(`Router key list failed (${res.status}).`);
  const json = (await res.json()) as { keys?: RouterKey[] };
  return json.keys || [];
}

async function createRouterKey(name: string): Promise<{ id: string; key: string }> {
  const res = await adminFetch("/api/keys", {
    method: "POST",
    // `targetProvider` mengunci kunci ini ke 0G Compute. Lihat catatan di
    // src/config/agent-compute.ts: tanpa itu jatahnya bisa dibelanjakan di kolam lain.
    body: JSON.stringify({ name, targetProvider: AGENT_COMPUTE_PROVIDER }),
  });
  if (!res.ok) {
    throw new Error(`Router key creation failed (${res.status}).`);
  }
  const json = (await res.json()) as { id?: string; key?: string };
  if (!json.id || !json.key) throw new Error("Router key creation returned an incomplete record.");
  return { id: json.id, key: json.key };
}

async function setRouterKeyActive(id: string, isActive: boolean): Promise<void> {
  const res = await adminFetch(`/api/keys/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ isActive }),
  });
  if (!res.ok) throw new Error(`Router key update failed (${res.status}).`);
}

async function deleteRouterKey(id: string): Promise<void> {
  const res = await adminFetch(`/api/keys/${encodeURIComponent(id)}`, { method: "DELETE" });
  // 404 diperlakukan sebagai selesai: kalau kuncinya sudah tidak ada di router, hasil yang
  // diinginkan sudah tercapai dan melempar galat hanya akan menahan pembersihan sisi kami.
  if (!res.ok && res.status !== 404) throw new Error(`Router key delete failed (${res.status}).`);
}

/** Pemakaian per rahasia kunci: input, output, jumlah permintaan. */
type UsageRow = { input: number; output: number; requests: number };

/**
 * Pemakaian kumulatif per kunci, dibaca dari statistik router.
 *
 * Bentuk `byApiKey` adalah `"<rahasia>|<model>|<provider>"` → agregat, jadi satu kunci muncul
 * sekali per model. Semuanya dijumlahkan: jatahnya berlaku untuk pool, bukan untuk satu model,
 * dan pemegang kunci bisa memanggil model 0G mana pun.
 *
 * `period=all` DIPILIH, bukan `today`, dan bedanya bukan cuma rentang waktu. Router menyusun
 * `byApiKey` lewat dua jalur: untuk `today` dan `24h` ia mengelompokkan per kunci TER-MASK —
 * delapan karakter pertama — dan setiap kunci di mesin ini berawalan sama, jadi pemakaian semua
 * orang bertumpuk menjadi satu baris. Hanya jalur ringkasan harian (`period` selain dua itu) yang
 * menyimpan rahasia penuh dan bisa dipisah per kunci. Diuji: kunci baru muncul sendiri dengan
 * `in 829 out 7 req 1` setelah satu panggilan.
 *
 * Angka yang dikembalikan adalah yang TERCATAT, bukan yang dilaporkan ke pemanggil. Respons ke
 * pemanggil dilebihkan tepat 2000 token input oleh `BUFFER_TOKENS` di router (lihat
 * `CLIENT_USAGE_BUFFER` di config). Meteran memakai yang tercatat karena itu yang benar-benar
 * dibelanjakan; selisihnya dijelaskan di halaman supaya tidak terbaca sebagai kecurangan.
 */
async function routerUsage(): Promise<Map<string, UsageRow>> {
  const res = await adminFetch("/api/usage/stats?period=all", { method: "GET" });
  if (!res.ok) throw new Error(`Router usage read failed (${res.status}).`);
  const json = (await res.json()) as {
    byApiKey?: Record<string, { promptTokens?: number; completionTokens?: number; requests?: number }>;
  };

  const out = new Map<string, UsageRow>();
  for (const [composite, agg] of Object.entries(json.byApiKey || {})) {
    const secret = composite.split("|")[0];
    if (!secret) continue;
    const prev = out.get(secret) || { input: 0, output: 0, requests: 0 };
    out.set(secret, {
      input: prev.input + (agg.promptTokens || 0),
      output: prev.output + (agg.completionTokens || 0),
      requests: prev.requests + (agg.requests || 0),
    });
  }
  return out;
}

// ─── stake on-chain ────────────────────────────────────────────────────────────

const ZERO_G = CHAIN_LIST.find((c) => c.chainId === STAKE_TOKEN.chainId);

/**
 * Stake sebuah alamat, dalam token utuh, atau null kalau tidak ada kontrak untuk dibaca.
 *
 * null dan 0 DIBEDAKAN, dan bedanya menentukan: 0 berarti alamatnya tidak stake, null berarti
 * belum ada tempat untuk stake. Yang pertama boleh mematikan kunci, yang kedua tidak boleh
 * menerbitkan apa pun sejak awal.
 */
export async function stakedOf(address: string): Promise<number | null> {
  const contract = stakeContractFor(STAKE_TOKEN.chainId);
  if (!contract || !ZERO_G) return null;

  const provider = new ethers.JsonRpcProvider(ZERO_G.rpcUrl, ZERO_G.chainId, {
    staticNetwork: true,
  });
  const stake = new ethers.Contract(
    contract,
    ["function stakedOf(address) view returns (uint256)"],
    provider
  );
  const raw: bigint = await stake.stakedOf(address);
  return Number(ethers.formatUnits(raw, STAKE_TOKEN.decimals));
}

// ─── penerbitan ────────────────────────────────────────────────────────────────

export type IssueResult =
  | { ok: true; secret: string; key: PoolKey }
  | { ok: false; status: number; error: string };

/**
 * Menerbitkan satu kunci untuk satu alamat.
 *
 * Tanda tangan alamat diperiksa di pemanggil (`/api/agent/keys`); di sini yang diperiksa adalah
 * syarat yang bisa berubah antara tanda tangan dan penerbitan: apakah kontraknya ada, apakah
 * stakenya cukup, dan apakah alamat itu sudah punya kunci.
 */
export async function issueKey(address: string): Promise<IssueResult> {
  const owner = address.toLowerCase();

  if (!poolConfigured()) {
    return {
      ok: false,
      status: 503,
      error: "The agent compute pool is not configured on this server.",
    };
  }
  if (!storeIsDurable()) {
    // Kunci yang catatannya hilang saat restart adalah kunci yang tidak bisa dicabut.
    return {
      ok: false,
      status: 503,
      error: "Key storage is not durable on this server, so keys cannot be issued safely.",
    };
  }

  const staked = await stakedOf(owner);
  if (staked === null) {
    return {
      ok: false,
      status: 503,
      error:
        "The stake contract is not deployed yet, so there is no stake to read and no tier to assign.",
    };
  }
  const tier = tierForStake(staked);
  if (!tier) {
    return {
      ok: false,
      status: 403,
      error: `A stake of at least ${MIN_STAKE_ADEXTO.toLocaleString("en-US")} ADEXTO is required. This address has ${Math.floor(staked).toLocaleString("en-US")}.`,
    };
  }

  const store = load();
  if (store.keys.some((k) => k.address === owner)) {
    return {
      ok: false,
      status: 409,
      error: "This address already has a key. Revoke it before issuing another.",
    };
  }

  const name = `${KEY_NAME_PREFIX}${owner}`;
  const created = await createRouterKey(name);

  const key: PoolKey = {
    address: owner,
    routerKeyId: created.id,
    keyPrefix: created.key.slice(0, 11),
    name,
    createdAt: new Date().toISOString(),
    tierLabel: tier.label,
    allowance: tier.allowance,
    usedInput: 0,
    usedOutput: 0,
    requests: 0,
    active: true,
    disabledReason: null,
    stakedAtLastSweep: staked,
    lastSweepAt: new Date().toISOString(),
  };

  store.keys.push(key);
  if (!save(store)) {
    // Catatan gagal ditulis, jadi kuncinya tidak akan pernah bisa kami cabut. Dibatalkan di
    // router supaya tidak ada kunci hidup yang tidak tercatat di mana pun.
    await deleteRouterKey(created.id).catch(() => {});
    return { ok: false, status: 500, error: "Could not persist the key record. Nothing was issued." };
  }

  return { ok: true, secret: created.key, key };
}

/** Mencabut kunci sebuah alamat: dihapus di router, dihapus di catatan kami. */
export async function revokeKey(address: string): Promise<{ ok: boolean; error?: string }> {
  const owner = address.toLowerCase();
  const store = load();
  const found = store.keys.find((k) => k.address === owner);
  if (!found) return { ok: false, error: "No key is issued to this address." };

  await deleteRouterKey(found.routerKeyId);
  store.keys = store.keys.filter((k) => k.address !== owner);
  save(store);
  return { ok: true };
}

// ─── sapuan dan penegakan ──────────────────────────────────────────────────────

/**
 * Pemakaian hanya boleh naik.
 *
 * Yang kami baca adalah ringkasan harian router, dan router punya pembersih yang membuang catatan
 * lama (`purgeOldDatabaseLogs`). Artinya angka untuk sebuah kunci bisa TURUN seiring waktu. Kalau
 * angka itu dipakai mentah, jatah yang sudah habis akan terisi ulang sendiri — kegagalan yang
 * tidak akan terlihat sampai seseorang memperhatikan kuncinya hidup lagi. `Math.max` membuat
 * penghitungan kami monoton tanpa bergantung pada retensi router sama sekali.
 */
function accumulate(prev: number, reported: number): number {
  return Math.max(prev, reported);
}

export type SweepResult = { checked: number; disabled: number; reactivated: number; errors: string[] };

let lastSweepAt = 0;
const SWEEP_MIN_INTERVAL_MS = 60_000;

/**
 * Menyinkronkan setiap kunci dengan chain dan dengan router, lalu menegakkan jatahnya.
 *
 * Dipanggil dari jalur baca status (halaman memanggilnya saat dibuka) dan bisa dipanggil dari
 * cron lewat `scripts/agent-compute-sweep.mjs`. Di-throttle supaya halaman yang di-refresh
 * berulang tidak menyalakan satu sapuan per permintaan; `force` melewati throttle untuk cron.
 */
export async function sweep(force = false): Promise<SweepResult> {
  const result: SweepResult = { checked: 0, disabled: 0, reactivated: 0, errors: [] };
  if (!poolConfigured()) {
    result.errors.push("pool not configured");
    return result;
  }
  if (!force && Date.now() - lastSweepAt < SWEEP_MIN_INTERVAL_MS) return result;
  lastSweepAt = Date.now();

  const store = load();
  if (store.keys.length === 0) return result;

  let usage: Map<string, UsageRow>;
  let routerKeys: RouterKey[];
  try {
    [usage, routerKeys] = await Promise.all([routerUsage(), listRouterKeys()]);
  } catch (e) {
    result.errors.push((e as Error).message);
    return result;
  }
  const secretById = new Map(routerKeys.map((k) => [k.id, k.key]));
  const activeById = new Map(routerKeys.map((k) => [k.id, k.isActive]));

  for (const key of store.keys) {
    result.checked += 1;

    const secret = secretById.get(key.routerKeyId);
    if (!secret) {
      // Kuncinya hilang dari router — dihapus lewat dashboard, atau DB-nya diganti. Catatan
      // kami ditandai mati supaya UI tidak menjanjikan kunci yang tidak ada.
      key.active = false;
      key.disabledReason = "The key no longer exists on the router.";
      continue;
    }

    const reported = usage.get(secret) || { input: 0, output: 0, requests: 0 };
    key.usedInput = accumulate(key.usedInput, reported.input);
    key.usedOutput = accumulate(key.usedOutput, reported.output);
    key.requests = accumulate(key.requests, reported.requests);

    let staked: number | null = null;
    try {
      staked = await stakedOf(key.address);
    } catch (e) {
      result.errors.push(`stake read failed for ${key.address}: ${(e as Error).message}`);
      // Stake tidak terbaca BUKAN alasan mematikan kunci: RPC yang sedang bermasalah akan
      // mencabut compute orang yang stakenya utuh. Jatah tetap ditegakkan dari angka terakhir.
      staked = key.stakedAtLastSweep;
    }

    const tier = staked === null ? null : tierForStake(staked);
    key.stakedAtLastSweep = staked;
    key.tierLabel = tier?.label ?? null;
    key.allowance = tier?.allowance ?? 0;
    key.lastSweepAt = new Date().toISOString();

    const used = key.usedInput + key.usedOutput;
    let reason: string | null = null;
    if (!tier) {
      reason =
        staked === null
          ? "The stake contract could not be read."
          : `The stake fell below ${MIN_STAKE_ADEXTO.toLocaleString("en-US")} ADEXTO.`;
    } else if (used >= key.allowance) {
      reason = "The tier allowance is spent. Raise the stake to open a larger allowance.";
    }

    const shouldBeActive = reason === null;
    const isActiveOnRouter = activeById.get(key.routerKeyId) ?? true;

    if (shouldBeActive !== isActiveOnRouter) {
      try {
        await setRouterKeyActive(key.routerKeyId, shouldBeActive);
        if (shouldBeActive) result.reactivated += 1;
        else result.disabled += 1;
      } catch (e) {
        result.errors.push(`key update failed for ${key.address}: ${(e as Error).message}`);
        continue;
      }
    }
    key.active = shouldBeActive;
    key.disabledReason = reason;
  }

  save(store);
  return result;
}

/** Catatan satu alamat, tanpa rahasia apa pun. */
export function keyForAddress(address: string): PoolKey | null {
  return load().keys.find((k) => k.address === address.toLowerCase()) || null;
}
