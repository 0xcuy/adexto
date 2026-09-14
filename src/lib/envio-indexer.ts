/**
 * Membaca riwayat perdagangan Monad dari indexer Envio.
 *
 * KENAPA INI ADA, DAN APA YANG DIGANTIKANNYA
 *
 * Monad memotong `eth_getLogs` pada 100 blok. Dengan anggaran 16 panggilan per pembacaan,
 * jendela yang terjangkau `readOnChainSwaps` adalah 1.600 blok — sekitar sepuluh menit.
 * Akibatnya perdagangan MENGHILANG dari chart dan feed beberapa menit setelah terjadi,
 * bukan karena galat apa pun, melainkan karena jendelanya sudah lewat.
 *
 * Terukur pada $PARCEL: kurvanya melaporkan `swapCount() = 12`, sementara endpoint
 * telemetry melaporkan 7 — kelima fill terbaru semuanya jatuh di bawah tepi bawah
 * jendela. Sepuluh menit sebelumnya endpoint yang sama melaporkan 10, karena tiga di
 * antaranya masih di dalam. Riwayat yang tampil karena itu tergantung kapan halaman dibuka.
 *
 * Penambalnya selama ini store JSON yang diisi tangan lewat `scripts/backfill-trades.mjs`.
 * Store itu tidak punya lubang teoretis; ia punya lubang praktis: TIDAK ADA kode aplikasi
 * yang menulis ke sana. `POST /api/agent/telemetry` menuntut bearer secret dan satu-satunya
 * pemanggilnya adalah skrip itu. Jadi setiap perdagangan lewat UI hilang lagi sepuluh menit
 * kemudian sampai seseorang menjalankan skripnya.
 *
 * Indexer menghapus KEDUA hal itu: ia menyimpan setiap `Swap` sejak blok peluncuran, dan ia
 * terus berjalan sehingga fill baru masuk tanpa ada yang perlu dijalankan tangan.
 *
 * YANG TIDAK DILAKUKAN BERKAS INI
 *
 * Tidak mengarang satu angka pun, dan tidak menghitung ulang apa pun yang sudah dihitung
 * indexer. Arah, jumlah, harga eksekusi, dan harga spot sesudah trade semuanya diturunkan
 * dari field event yang sama seperti `readOnChainSwaps` — jadi baris dari sumber mana pun
 * bisa dibandingkan langsung, dan dedup `txHash` + `type` tetap berarti.
 */
import type { TradeEvent } from "@/lib/telemetry";

/**
 * Endpoint GraphQL indexer. Kosong berarti indexer tidak dipakai, dan pemanggil jatuh ke
 * jalur RPC + store seperti sebelumnya.
 *
 * Di produksi ini nama layanan di dalam jaringan Docker, BUKAN URL publik: container web
 * dan indexer berada di `adexto-net` yang sama, jadi Hasura tidak perlu satu pun port
 * terbuka ke internet.
 */
const ENDPOINT = process.env.ENVIO_GRAPHQL_URL ?? "";
const ADMIN_SECRET = process.env.ENVIO_HASURA_SECRET ?? "";

/** Chain yang benar-benar diindeks. Menanyakan chain lain ke indexer ini akan bohong. */
export const ENVIO_CHAIN_IDS = new Set<number>([143]);

export function envioServes(chainId: number | null | undefined): boolean {
  return Boolean(ENDPOINT) && chainId != null && ENVIO_CHAIN_IDS.has(chainId);
}

type EnvioSwapRow = {
  txHash: string;
  logIndex: string;
  isBuy: boolean;
  amountIn: string;
  amountOut: string;
  priceNativeAfter: string;
  reserveNativeAfter: string;
  reserveTokenAfter: string;
  trader: string;
  timestamp: string;
  blockNumber: string;
};

export type EnvioReadResult = {
  trades: TradeEvent[];
  /** Total baris yang dimiliki indexer untuk kurva ini, tanpa dipotong `limit`. */
  totalSwaps: number;
  /** Blok terakhir yang sudah diproses indexer, untuk menyatakan kesegarannya. */
  syncedToBlock: number | null;
  error: string | null;
};

const WEI = 1e18;
/** Wei -> unit utuh. Angka di kurva ini muat di double; presisinya cukup untuk ditampilkan. */
const toWhole = (raw: string): number => Number(raw) / WEI;

/**
 * Query mengambil `Swap` TERBARU lebih dulu dan membatasi jumlahnya di sisi server.
 *
 * Diurut `blockNumber` lalu `logIndex`, bukan `timestamp`: beberapa swap bisa berada di satu
 * blok, dan di Monad banyak blok berbagi satu detik yang sama. Mengurut waktu saja membuat
 * urutan di dalam satu detik ditentukan keberuntungan, dan itulah yang membuat sebuah
 * candle membuka pada harga yang bukan penutup candle sebelumnya.
 */
const QUERY = `
query CurveSwaps($curve: String!, $limit: Int!) {
  Swap(
    where: { curve_id: { _eq: $curve } }
    order_by: [{ blockNumber: desc }, { logIndex: desc }]
    limit: $limit
  ) {
    txHash
    logIndex
    isBuy
    amountIn
    amountOut
    priceNativeAfter
    reserveNativeAfter
    reserveTokenAfter
    trader
    timestamp
    blockNumber
  }
  Swap_aggregate(where: { curve_id: { _eq: $curve } }) {
    aggregate { count }
  }
  chain_metadata {
    chain_id
    latest_processed_block
  }
}`;

/**
 * Perdagangan sebuah kurva, terbaru dulu.
 *
 * Mengembalikan `error` alih-alih melempar. Pemanggilnya adalah endpoint yang juga punya
 * jalur RPC + store, dan indexer yang sedang tidak bisa dihubungi tidak boleh mengosongkan
 * chart — ia harus menyerahkan giliran ke sumber lain.
 */
export async function readEnvioSwaps(
  curveAddress: string,
  symbol: string,
  nativeSymbol: string,
  chainId: number,
  limit = 400
): Promise<EnvioReadResult> {
  const empty: EnvioReadResult = { trades: [], totalSwaps: 0, syncedToBlock: null, error: null };
  if (!ENDPOINT) return { ...empty, error: "ENVIO_GRAPHQL_URL is not configured." };
  if (!/^0x[a-fA-F0-9]{40}$/.test(curveAddress)) {
    return { ...empty, error: "Curve address is not a valid contract address." };
  }

  /**
   * Alamat di-LOWERCASE sebelum dicocokkan.
   *
   * `address_format: lowercase` di config indexer berarti setiap id disimpan huruf kecil,
   * sementara registry menyimpan alamat ber-checksum. Tanpa normalisasi ini kecocokannya
   * nol dan gejalanya sama persis dengan pasar yang belum pernah diperdagangkan.
   */
  const curve = curveAddress.toLowerCase();

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (ADMIN_SECRET) headers["x-hasura-admin-secret"] = ADMIN_SECRET;

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: QUERY, variables: { curve, limit } }),
      // Indexer ada di jaringan yang sama, jadi lambat berarti ada yang salah. Batas waktu
      // pendek supaya halaman tidak menggantung menunggu sumber yang punya pengganti.
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (!res.ok) return { ...empty, error: `Indexer answered HTTP ${res.status}.` };

    const body = await res.json();
    if (body?.errors?.length) {
      return { ...empty, error: String(body.errors[0]?.message ?? "Indexer returned an error.") };
    }

    const rows: EnvioSwapRow[] = Array.isArray(body?.data?.Swap) ? body.data.Swap : [];
    const totalSwaps = Number(body?.data?.Swap_aggregate?.aggregate?.count ?? rows.length);
    const meta: Array<{ chain_id: number; latest_processed_block: number }> = Array.isArray(
      body?.data?.chain_metadata
    )
      ? body.data.chain_metadata
      : [];
    const syncedToBlock =
      meta.find((m) => Number(m.chain_id) === chainId)?.latest_processed_block ?? null;

    const trades: TradeEvent[] = rows.map((r) => {
      const isBuy = Boolean(r.isBuy);
      // Pada pembelian `amountIn` native dan `amountOut` token; pada penjualan terbalik.
      const amountNative = toWhole(isBuy ? r.amountIn : r.amountOut);
      const amountToken = toWhole(isBuy ? r.amountOut : r.amountIn);
      return {
        /**
         * Id memuat `logIndex`, bukan hanya hash transaksi. Satu transaksi bisa memancarkan
         * beberapa `Swap` — sebuah buyback berjalan di dalam transaksi yang sama dengan
         * fill yang memicunya — jadi id berbasis hash saja akan menabrakkan keduanya.
         */
        id: `${r.txHash}-${r.logIndex}`,
        txHash: r.txHash,
        type: isBuy ? "BUY" : "SELL",
        symbol,
        amountToken,
        amountNative,
        nativeSymbol,
        // Harga eksekusi: yang benar-benar dibayar atau diterima, fee termasuk.
        priceNative: amountToken > 0 ? amountNative / amountToken : 0,
        /**
         * Harga spot sesudah trade, dipakai chart. Diambil dari `priceNativeAfter` milik
         * indexer, yang diturunkan dari snapshot reserve event itu sendiri — jadi angkanya
         * identik dengan yang dihitung `readOnChainSwaps` dari event yang sama.
         */
        priceNativeAfter: Number(r.priceNativeAfter) || null,
        trader: r.trader,
        timestamp: new Date(Number(r.timestamp) * 1000).toISOString(),
        blockNumber: Number(r.blockNumber),
        chainId,
        source: "onchain",
      };
    });

    return { trades, totalSwaps, syncedToBlock, error: null };
  } catch (e: any) {
    const msg = e?.name === "TimeoutError" ? "Indexer did not answer in time." : String(e?.message ?? e);
    return { ...empty, error: msg };
  }
}
