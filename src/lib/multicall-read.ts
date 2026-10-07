/**
 * Banyak pembacaan view dalam sedikit permintaan RPC, lewat Multicall3 `aggregate3`.
 *
 * KENAPA ADA (7 Okt, rencana /agent-compute untuk 1.000–10.000 pasar)
 *
 * Halaman Agent Compute dulu membaca stake satu dompet dengan satu `eth_call` per sumber, masing-masing
 * dengan provider baru dan tanpa batch. Dengan 13 sumber itu 13 panggilan; dengan 10.000 pasar itu
 * 10.000 panggilan per tampilan halaman, dan sweep melakukan hal yang sama untuk setiap kunci. Di
 * sini panggilan yang sama dikemas 200 per `eth_call`, jadi 10.000 bacaan menjadi 50 permintaan,
 * berjalan paralel antar chain dan berurutan di dalam satu chain.
 *
 * `allowFailure: true` untuk setiap panggilan: satu kontrak yang revert tidak menggagalkan batch, dan
 * hasilnya null untuk panggilan itu saja. Batch yang gagal seluruhnya (RPC mati, batas waktu) membuat
 * semua hasilnya null, dan pemanggil memperlakukan null sebagai "tidak terbaca", BUKAN nol. Bedanya
 * penting di sweep: nol mematikan kunci, tidak terbaca tidak boleh.
 *
 * Multicall3 ada di alamat yang sama di keenam chain (diperiksa 7 Okt dengan `eth_getCode`).
 */
import { ethers } from "ethers";
import { CHAIN_LIST, readProvider } from "@/lib/chains";

export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

const MULTICALL3 = new ethers.Interface([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
]);

/**
 * Panggilan per `eth_call`. Satu bacaan view (satu SLOAD dingin + overhead Multicall3) ±6k gas, jadi
 * 200 panggilan ±1,2 juta gas: jauh di bawah batas gas `eth_call` RPC publik (biasanya 50 juta), dan
 * jawabannya ±32 KB.
 */
const BATCH = 200;
const TIMEOUT_MS = 10_000;
/** Batch yang berjalan bersamaan di SATU chain. Dua: separuh waktu tunggu, tanpa menyembur RPC publik. */
const PER_CHAIN_CONCURRENCY = 2;
/** Gagal berturut-turut sebanyak ini (masing-masing sudah dicoba ulang sekali) = chain dianggap mati. */
const GIVE_UP_AFTER = 3;

export type ReadCall = { target: string; data: string };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("multicall timed out")), ms))]);
}

/**
 * Hasil mentah setiap panggilan di satu chain, urut sama dengan `calls`; null bila gagal atau kosong.
 *
 * Uji skala 7 Okt (10.000 pasar, 258 batch di enam chain): dua batch gagal sesaat dan 100 pasar
 * tampil tanpa angka sampai pembaruan berikutnya. Jadi batch yang gagal dicoba ulang SEKALI. Chain
 * yang benar-benar mati tidak boleh menahan pembaruan semua chain lain selama puluhan batch × batas
 * waktu, jadi sesudah `GIVE_UP_AFTER` kegagalan berturut-turut sisanya langsung dibiarkan null.
 */
export async function multiRead(chainId: number, calls: readonly ReadCall[]): Promise<(string | null)[]> {
  const out: (string | null)[] = calls.map(() => null);
  if (!calls.length) return out;
  const chain = CHAIN_LIST.find((c) => c.chainId === Number(chainId));
  if (!chain) return out;
  const provider = readProvider(chain);

  const runBatch = async (start: number): Promise<boolean> => {
    const slice = calls.slice(start, start + BATCH);
    const data = MULTICALL3.encodeFunctionData("aggregate3", [
      slice.map((c) => ({ target: c.target, allowFailure: true, callData: c.data })),
    ]);
    try {
      const raw = await withTimeout(provider.call({ to: MULTICALL3_ADDRESS, data }), TIMEOUT_MS);
      const decoded = MULTICALL3.decodeFunctionResult("aggregate3", raw);
      const results = decoded[0] as ReadonlyArray<{ success: boolean; returnData: string }>;
      results.forEach((r, j) => {
        // Panggilan ke alamat tanpa kode BERHASIL dengan data kosong: itu "tidak terbaca", bukan nol.
        out[start + j] = r.success && r.returnData && r.returnData !== "0x" ? r.returnData : null;
      });
      return true;
    } catch {
      return false;
    }
  };

  const starts: number[] = [];
  for (let i = 0; i < calls.length; i += BATCH) starts.push(i);
  let next = 0;
  let consecutiveFailures = 0;
  const worker = async () => {
    while (next < starts.length && consecutiveFailures < GIVE_UP_AFTER) {
      const start = starts[next++];
      let ok = await runBatch(start);
      if (!ok) {
        await new Promise((r) => setTimeout(r, 300));
        ok = await runBatch(start);
      }
      consecutiveFailures = ok ? 0 : consecutiveFailures + 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(PER_CHAIN_CONCURRENCY, starts.length) }, worker));
  return out;
}

/**
 * Panggilan dari banyak chain sekaligus: dikelompokkan per chain, chain berjalan paralel.
 * `key` dipakai pemanggil untuk menemukan hasilnya kembali.
 */
export async function multiReadAll<K>(
  calls: ReadonlyArray<{ key: K; chainId: number; target: string; data: string }>,
): Promise<Map<K, string | null>> {
  const byChain = new Map<number, Array<{ key: K; target: string; data: string }>>();
  for (const c of calls) {
    const list = byChain.get(c.chainId) ?? [];
    list.push({ key: c.key, target: c.target, data: c.data });
    byChain.set(c.chainId, list);
  }
  const out = new Map<K, string | null>();
  await Promise.all(
    [...byChain.entries()].map(async ([chainId, list]) => {
      const res = await multiRead(chainId, list);
      list.forEach((c, i) => out.set(c.key, res[i]));
    }),
  );
  return out;
}

const CODER = ethers.AbiCoder.defaultAbiCoder();

/** uint256 dari hasil mentah, atau null. */
export function decodeUint(raw: string | null | undefined): bigint | null {
  if (!raw) return null;
  try {
    return CODER.decode(["uint256"], raw)[0] as bigint;
  } catch {
    return null;
  }
}

/** bool dari hasil mentah, atau null. */
export function decodeBool(raw: string | null | undefined): boolean | null {
  if (!raw) return null;
  try {
    return Boolean(CODER.decode(["bool"], raw)[0]);
  } catch {
    return null;
  }
}
