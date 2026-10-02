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
  HUB_COMPUTE_SHARE_BPS,
  MEASURED_INPUT_FLOOR,
  hubTokensForUsd,
  tierForStake,
  type ComputeStake,
} from "@/config/agent-compute";
import {
  allComputeSources,
  findComputeSource,
  hubBudget,
  hubTotalStaked,
  protocolFeesWei,
} from "@/lib/stake-hub-server";

const STORE_FILE = "agent-compute-keys.json";
const KEY_NAME_PREFIX = "adx:";

/** Satu kunci yang diterbitkan, sebagaimana kami menyimpannya. */
export type PoolKey = {
  /** Alamat pemilik, huruf kecil. Satu alamat satu kunci PER TOKEN yang di-stake. */
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
  /** Stake sumber tingkatan pada sapuan terakhir, dalam token utuh sumber itu. */
  stakedAtLastSweep: number | null;
  /**
   * Id token yang di-stake untuk kunci ini (`COMPUTE_STAKES`). Tingkatannya hanya dibaca dari
   * stake token ini. Catatan lama tanpa bidang ini diterbitkan dari $ADEXTO, satu-satunya sumber
   * waktu itu.
   */
  stakeSource?: string;
  lastSweepAt: string | null;
  /**
   * Hanya kunci pasar hub: token model yang sudah terkumpul untuk kunci ini dari protocol fee
   * pasarnya, kumulatif dan hanya naik. `allowance` kunci hub sama dengan angka ini.
   */
  accrued?: number;
  /**
   * Hanya kunci pasar hub: protocol fee kurva (wei) saat kunci ini terbit. Kunci ini hanya ikut
   * dibagi fee di atas angka ini, jadi trade yang terjadi sebelum kuncinya ada tidak dibagikan
   * kepadanya, walaupun sapuan berikutnya baru membaginya sesudah kunci ini terbit.
   */
  feesAtIssueWei?: string;
};

/**
 * `hubFees[sourceId]` adalah protocol fee kurva pasar hub (wei) yang sudah dibagikan ke kunci-
 * kuncinya. Sapuan membagi selisih antara fee sekarang dan angka ini, lalu menaikkannya; jadi
 * fee yang masuk sebelum sebuah kunci ada tidak pernah dibagi ke kunci itu.
 */
type Store = { keys: PoolKey[]; hubFees?: Record<string, { seenFeesWei: string; updatedAt: string }> };

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

/**
 * Satu sumber stake sebagaimana dibaca untuk satu alamat.
 *
 * `staked` null dan 0 DIBEDAKAN, dan bedanya menentukan: 0 berarti alamatnya tidak stake, null
 * berarti tidak ada angka (belum ada kontrak, atau pembacaannya gagal — lihat `error`). Yang
 * pertama boleh mematikan kunci; yang kedua tidak boleh, karena RPC yang sedang bermasalah tidak
 * boleh mencabut compute orang yang stakenya utuh.
 */
export type StakeReading = { id: string; staked: number | null; error: string | null };

/** Batas waktu satu pembacaan, supaya satu RPC yang macet tidak menahan seluruh permintaan. */
const STAKE_READ_TIMEOUT_MS = 12_000;

async function readOne(source: ComputeStake, address: string): Promise<StakeReading> {
  if (!source.contract) return { id: source.id, staked: null, error: null };
  const chain = CHAIN_LIST.find((c) => c.chainId === source.chainId);
  if (!chain) return { id: source.id, staked: null, error: `No RPC is configured for chain ${source.chainId}.` };
  try {
    const provider = new ethers.JsonRpcProvider(chain.rpcUrl, chain.chainId, {
      staticNetwork: true,
      batchMaxCount: 1,
    });
    // Hub: satu kontrak untuk semua pasar di chain itu, jadi setiap pembacaan menyebut tokennya.
    const isHub = source.kind === "hub";
    const stake = new ethers.Contract(
      source.contract,
      [isHub ? "function stakedOf(address,address) view returns (uint256)" : "function stakedOf(address) view returns (uint256)"],
      provider
    );
    const raw = (await Promise.race([
      isHub ? stake.stakedOf(source.token, address) : stake.stakedOf(address),
      new Promise((_, reject) => setTimeout(() => reject(new Error("stake read timed out")), STAKE_READ_TIMEOUT_MS)),
    ])) as bigint;
    return { id: source.id, staked: Number(ethers.formatUnits(raw, source.decimals)), error: null };
  } catch (e) {
    return { id: source.id, staked: null, error: String((e as Error).message || e).slice(0, 160) };
  }
}

/** Stake sebuah alamat di setiap sumber compute, dibaca paralel dari chain masing-masing. */
export async function stakesOf(address: string): Promise<StakeReading[]> {
  return Promise.all(allComputeSources().map((s) => readOne(s, address)));
}

/** Sumber stake sebuah catatan kunci. Catatan lama tanpa bidang ini diterbitkan dari $ADEXTO. */
const sourceOf = (k: PoolKey): string => k.stakeSource ?? "adexto";

// ─── penerbitan ────────────────────────────────────────────────────────────────

export type IssueResult =
  | { ok: true; secret: string; key: PoolKey }
  | { ok: false; status: number; error: string };

/**
 * Menerbitkan satu kunci untuk satu alamat dan SATU token yang di-stake.
 *
 * Owner 2026-10-01: setiap token di daftar centang punya stake dan kuncinya sendiri, jadi kunci
 * $ADEXTO yang sudah ada tidak perlu dicabut untuk membuka kunci $SAI. Tingkatannya dibaca dari
 * stake token itu saja, dengan tangga token itu.
 *
 * Tanda tangan alamat diperiksa di pemanggil (`/api/agent/keys`), termasuk bahwa pesannya
 * menyebut token ini; di sini yang diperiksa adalah syarat yang bisa berubah antara tanda tangan
 * dan penerbitan: apakah kontraknya ada, apakah stakenya cukup, dan apakah kuncinya sudah ada.
 */
export async function issueKey(address: string, stakeId: string): Promise<IssueResult> {
  const owner = address.toLowerCase();
  const source = findComputeSource(stakeId);
  if (!source) return { ok: false, status: 400, error: "Unknown stake." };
  if (source.kind === "hub") return issueHubKey(owner, source);

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

  const where = `$${source.symbol} on ${source.chainName}`;
  if (!source.contract) {
    return {
      ok: false,
      status: 503,
      error: `The stake contract for ${where} is not deployed yet, so there is no stake to read and no tier to assign.`,
    };
  }
  const reading = await readOne(source, owner);
  if (reading.staked === null) {
    return { ok: false, status: 503, error: `The ${where} stake could not be read right now. Try again shortly.` };
  }
  const staked = reading.staked;
  const tier = tierForStake(staked, source.tiers);
  if (!tier) {
    return {
      ok: false,
      status: 403,
      error: `A stake of at least ${source.minStake.toLocaleString("en-US")} ${source.symbol} on ${source.chainName} is required. This address has ${Math.floor(staked).toLocaleString("en-US")}.`,
    };
  }

  const store = load();
  if (store.keys.some((k) => k.address === owner && sourceOf(k) === source.id)) {
    return {
      ok: false,
      status: 409,
      error: `This address already has a key for ${where}. Revoke it before issuing another.`,
    };
  }

  // $ADEXTO memakai nama lama supaya kunci yang sudah ada tetap cocok; token lain diberi akhiran.
  const name = source.id === "adexto" ? `${KEY_NAME_PREFIX}${owner}` : `${KEY_NAME_PREFIX}${owner}:${source.id}`;
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
    stakeSource: source.id,
    lastSweepAt: new Date().toISOString(),
  };

  // Dibaca ulang tepat sebelum ditulis (tanpa await di antaranya): sapuan yang berjalan selama
  // kunci router dibuat akan menimpa salinan lama, dan salinan lama akan menimpa hasil sapuan.
  const fresh = load();
  if (fresh.keys.some((k) => k.address === owner && sourceOf(k) === source.id)) {
    await deleteRouterKey(created.id).catch(() => {});
    return { ok: false, status: 409, error: `This address already has a key for ${where}. Revoke it before issuing another.` };
  }
  fresh.keys.push(key);
  if (!save(fresh)) {
    // Catatan gagal ditulis, jadi kuncinya tidak akan pernah bisa kami cabut. Dibatalkan di
    // router supaya tidak ada kunci hidup yang tidak tercatat di mana pun.
    await deleteRouterKey(created.id).catch(() => {});
    return { ok: false, status: 500, error: "Could not persist the key record. Nothing was issued." };
  }

  return { ok: true, secret: created.key, key };
}

/**
 * Kunci untuk pasar hub. Bedanya dengan kunci bertingkat ada tiga, dan ketiganya disengaja:
 *
 *   - syaratnya hanya stake di atas minimum hub (0,001% supply), tanpa tangga tingkatan;
 *   - jatahnya mulai dari NOL dan naik hanya ketika trading pasar itu membayar protocol fee,
 *     jadi kuncinya DIMATIKAN di router sejak dibuat dan baru hidup setelah ada jatah;
 *   - kunci pertama sebuah pasar menetapkan titik nol fee pasar itu sekarang juga, supaya fee
 *     yang masuk sebelum kuncinya ada tidak dibagikan kepadanya.
 */
async function issueHubKey(owner: string, source: ComputeStake): Promise<IssueResult> {
  if (!poolConfigured()) {
    return { ok: false, status: 503, error: "The agent compute pool is not configured on this server." };
  }
  if (!storeIsDurable()) {
    return { ok: false, status: 503, error: "Key storage is not durable on this server, so keys cannot be issued safely." };
  }
  const where = `$${source.symbol} on ${source.chainName}`;
  const reading = await readOne(source, owner);
  if (reading.staked === null) {
    return { ok: false, status: 503, error: `The ${where} stake could not be read right now. Try again shortly.` };
  }
  if (reading.staked < source.minStake) {
    return {
      ok: false,
      status: 403,
      error: `A stake of at least ${source.minStake.toLocaleString("en-US")} ${source.symbol} in the ${source.chainName} stake hub is required. This address has ${Math.floor(reading.staked).toLocaleString("en-US")}.`,
    };
  }

  const store = load();
  if (store.keys.some((k) => k.address === owner && sourceOf(k) === source.id)) {
    return { ok: false, status: 409, error: `This address already has a key for ${where}. Revoke it before issuing another.` };
  }
  const firstForMarket = !store.keys.some((k) => sourceOf(k) === source.id);
  // Fee pasar saat kunci ini terbit: titik nol kunci ini sendiri (`feesAtIssueWei`), dan titik
  // nol pasarnya kalau ini kunci pertama.
  const fees = await protocolFeesWei(source);

  const name = `${KEY_NAME_PREFIX}${owner}:${source.id}`;
  const created = await createRouterKey(name);
  try {
    // Jatahnya nol saat lahir. Kunci hidup tanpa jatah adalah compute gratis sampai sapuan berikut.
    await setRouterKeyActive(created.id, false);
  } catch (e) {
    await deleteRouterKey(created.id).catch(() => {});
    return { ok: false, status: 502, error: `Could not hold the new key until compute accrues: ${(e as Error).message.slice(0, 120)}` };
  }

  const now = new Date().toISOString();
  const key: PoolKey = {
    address: owner,
    routerKeyId: created.id,
    keyPrefix: created.key.slice(0, 11),
    name,
    createdAt: now,
    tierLabel: "Fee-funded",
    allowance: 0,
    accrued: 0,
    usedInput: 0,
    usedOutput: 0,
    requests: 0,
    active: false,
    disabledReason: "No compute has accrued for this key yet. It accrues as this market trades.",
    stakedAtLastSweep: reading.staked,
    stakeSource: source.id,
    lastSweepAt: now,
    ...(fees === null ? {} : { feesAtIssueWei: fees.toString() }),
  };
  // Dibaca ulang tepat sebelum ditulis, seperti di `issueKey`. Titik nol hanya ditetapkan kalau
  // kunci ini MASIH yang pertama untuk pasarnya: kunci lain yang terbit selama kita menunggu
  // router sudah menetapkannya, dan menimpanya akan memotong jatah kunci itu.
  const fresh = load();
  if (fresh.keys.some((k) => k.address === owner && sourceOf(k) === source.id)) {
    await deleteRouterKey(created.id).catch(() => {});
    return { ok: false, status: 409, error: `This address already has a key for ${where}. Revoke it before issuing another.` };
  }
  const stillFirst = firstForMarket && !fresh.keys.some((k) => sourceOf(k) === source.id);
  fresh.keys.push(key);
  fresh.hubFees = fresh.hubFees ?? {};
  if (stillFirst) {
    if (fees === null) delete fresh.hubFees[source.id];
    else fresh.hubFees[source.id] = { seenFeesWei: fees.toString(), updatedAt: now };
  }
  if (!save(fresh)) {
    await deleteRouterKey(created.id).catch(() => {});
    return { ok: false, status: 500, error: "Could not persist the key record. Nothing was issued." };
  }
  return { ok: true, secret: created.key, key };
}

/** Mencabut kunci satu alamat untuk satu token: dihapus di router, dihapus di catatan kami. */
export async function revokeKey(address: string, stakeId: string): Promise<{ ok: boolean; error?: string }> {
  const owner = address.toLowerCase();
  const store = load();
  const found = store.keys.find((k) => k.address === owner && sourceOf(k) === stakeId);
  if (!found) return { ok: false, error: "No key is issued to this address for that stake." };

  await deleteRouterKey(found.routerKeyId);
  // Dibaca ulang sesudah router menjawab, supaya kunci yang terbit atau tersapu sementara itu
  // tidak ikut terhapus atau dikembalikan ke keadaan lamanya.
  const fresh = load();
  fresh.keys = fresh.keys.filter((k) => k.routerKeyId !== found.routerKeyId);
  save(fresh);
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

  /**
   * Pasar hub: protocol fee baru → jatah, sebanding stake.
   *
   * Untuk setiap pasar hub yang punya kunci, fee kurvanya dibaca dan dibandingkan dengan yang
   * sudah dibagikan (`hubFees`). Separuh selisihnya, dinilai pada harga native sekarang, diubah
   * menjadi token model dan dibagi ke kunci-kunci pasar itu menurut stake masing-masing terhadap
   * TOTAL stake di hub — termasuk staker tanpa kunci, yang bagiannya tidak dibelanjakan siapa pun.
   * Kunci yang terbit sesudah titik nol itu dihitung dari fee saat ia terbit (`feesAtIssueWei`).
   *
   * Titik nol hanya maju setelah sesuatu benar-benar dibagikan. Selisih yang belum bernilai satu
   * token, atau yang tidak bisa dinilai karena harga atau stake tidak terbaca, menunggu sapuan
   * berikutnya alih-alih hilang. Selisih ketika belum ada yang stake sama sekali tidak ditabung:
   * tidak ada yang berhak atasnya saat itu.
   */
  store.hubFees = store.hubFees ?? {};
  const readings = new Map<string, StakeReading>();
  /** Pasar yang titik nolnya ditulis sapuan ini; hanya itu yang digabung ke catatan terbaru. */
  const touched = new Set<string>();
  const now = new Date().toISOString();
  for (const id of [...new Set(store.keys.map(sourceOf))].filter((x) => x.startsWith("hub-"))) {
    const source = findComputeSource(id);
    if (!source || source.kind !== "hub") continue;
    const fees = await protocolFeesWei(source);
    if (fees === null) {
      result.errors.push(`protocol fees unreadable for ${id}`);
      continue;
    }
    const prev = store.hubFees[id];
    if (!prev) {
      store.hubFees[id] = { seenFeesWei: fees.toString(), updatedAt: now };
      touched.add(id);
      continue;
    }
    const seen = BigInt(prev.seenFeesWei);
    if (fees <= seen) continue;
    const price = (await hubBudget(source)).priceUsd;
    if (price === null) {
      result.errors.push(`no ${source.nativeSymbol} price for ${id}`);
      continue;
    }
    /** Token model yang dibiayai fee dari `from` sampai sekarang, untuk seluruh pasar. */
    const tokensSince = (from: bigint): number =>
      fees > from ? hubTokensForUsd((Number(ethers.formatEther(fees - from)) * price * HUB_COMPUTE_SHARE_BPS) / 10_000) : 0;
    if (tokensSince(seen) === 0) continue;
    const total = await hubTotalStaked(source);
    if (total === null) {
      result.errors.push(`hub total unreadable for ${id}`);
      continue;
    }
    if (total > 0) {
      // Semua stake dibaca dulu. Satu yang gagal menunda pembagian pasar ini seluruhnya, supaya
      // RPC yang sedang bermasalah tidak menghapus bagian seorang staker sementara titik nol maju.
      const marketKeys = store.keys.filter((k) => sourceOf(k) === id);
      const marketReadings: StakeReading[] = [];
      for (const key of marketKeys) marketReadings.push(await readOne(source, key.address));
      if (marketReadings.some((r) => r.staked === null)) {
        result.errors.push(`a stake in ${id} could not be read; its new fees wait for the next sweep`);
        continue;
      }
      marketKeys.forEach((key, i) => {
        const staked = marketReadings[i].staked as number;
        readings.set(`${id}:${key.address}`, marketReadings[i]);
        if (staked < source.minStake) return;
        // Kunci yang terbit sesudah titik nol pasar hanya dibagi fee sejak ia terbit.
        const issuedAt = key.feesAtIssueWei ? BigInt(key.feesAtIssueWei) : seen;
        const from = issuedAt > seen ? issuedAt : seen;
        key.accrued = (key.accrued ?? 0) + Math.floor(tokensSince(from) * Math.min(1, staked / total));
      });
    }
    store.hubFees[id] = { seenFeesWei: fees.toString(), updatedAt: now };
    touched.add(id);
  }

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

    // Satu kunci, satu token: hanya stake token kunci ini yang dibaca. Tanpa jatuh ke $ADEXTO:
    // sumber yang tidak dikenal lagi (pasar dicabut dari registry) mematikan kuncinya.
    const source = findComputeSource(sourceOf(key));
    let reason: string | null = null;
    if (!source) {
      reason = "This market is no longer listed, so its stake is no longer read.";
      key.allowance = 0;
      key.lastSweepAt = new Date().toISOString();
    } else {
      const reading = readings.get(`${source.id}:${key.address}`) ?? (await readOne(source, key.address));
      let staked: number | null;
      if (reading.error || reading.staked === null) {
        if (reading.error) result.errors.push(`stake read failed for ${key.address} (${source.id}): ${reading.error}`);
        // Stake tidak terbaca BUKAN alasan mematikan kunci: RPC yang sedang bermasalah akan
        // mencabut compute orang yang stakenya utuh. Jatah tetap ditegakkan dari angka terakhir.
        staked = key.stakedAtLastSweep;
      } else {
        staked = reading.staked;
      }
      key.stakedAtLastSweep = staked;
      key.lastSweepAt = new Date().toISOString();
      const used = key.usedInput + key.usedOutput;
      const below =
        staked === null
          ? "The stake contract could not be read."
          : `The stake fell below ${source.minStake.toLocaleString("en-US")} ${source.symbol} on ${source.chainName}.`;

      if (source.kind === "hub") {
        // Tanpa tingkatan: jatahnya adalah yang sudah terkumpul dari protocol fee pasar ini.
        key.tierLabel = "Fee-funded";
        key.allowance = key.accrued ?? 0;
        /**
         * Kunci hub baru hidup kalau sisanya cukup untuk SATU permintaan minimum. Penegakan
         * berjalan per sapuan (cron tiap menit), jadi kunci yang hidup boleh dipakai sampai
         * sapuan berikutnya. Menghidupkannya untuk sisa beberapa token, setiap kali satu trade
         * kecil masuk, membuat setiap trade kecil membuka jendela semenit tanpa batas.
         */
        const remaining = key.allowance - used;
        if (staked === null || staked < source.minStake) reason = below;
        else if (remaining < MEASURED_INPUT_FLOOR) {
          reason =
            key.allowance === 0
              ? "No compute has accrued for this key yet. It accrues as this market trades."
              : remaining <= 0
                ? "The compute this market's trading has paid for is used up. More accrues as it trades."
                : `Less than one request's worth of compute is left (${Math.floor(remaining).toLocaleString("en-US")} of ${MEASURED_INPUT_FLOOR.toLocaleString("en-US")} tokens). More accrues as this market trades.`;
        }
      } else {
        const tier = staked === null ? null : tierForStake(staked, source.tiers);
        key.tierLabel = tier?.label ?? null;
        key.allowance = tier?.allowance ?? 0;
        if (!tier) reason = below;
        else if (used >= key.allowance) reason = "The tier allowance is spent. Raise the stake to open a larger allowance.";
      }
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

  // Digabung ke catatan TERBARU, bukan menimpa salinan dari awal sapuan. Sapuan menunggu router
  // dan RPC beberapa chain, dan kunci yang terbit atau dicabut selama itu akan hilang, atau hidup
  // lagi, kalau salinan lama ditulis utuh. Tidak ada await antara `load` dan `save` di bawah.
  const latest = load();
  const swept = new Map(store.keys.map((k) => [k.routerKeyId, k]));
  latest.keys = latest.keys.map((k) => swept.get(k.routerKeyId) ?? k);
  latest.hubFees = latest.hubFees ?? {};
  for (const id of touched) latest.hubFees[id] = store.hubFees[id];
  save(latest);
  return result;
}

/** Catatan kunci satu alamat untuk satu token, tanpa rahasia apa pun. */
export function keyFor(address: string, stakeId: string): PoolKey | null {
  const owner = address.toLowerCase();
  return load().keys.find((k) => k.address === owner && sourceOf(k) === stakeId) || null;
}

/** Kunci $ADEXTO sebuah alamat, untuk bidang lama `key` di API. */
export function keyForAddress(address: string): PoolKey | null {
  return keyFor(address, "adexto");
}
