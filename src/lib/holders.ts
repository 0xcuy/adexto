import { DEAD_ADDRESS, ZERO_ADDRESS, type IndexStatus, type MarketIndex } from "@/lib/market-index";

/**
 * Distribusi pemegang dari saldo di indeks pasar: jumlah holder, porsi 10 teratas, porsi
 * creator, dan porsi yang masih di kurva.
 *
 * Murni supaya bisa diuji. Saldo di indeks disusun dari SELURUH `Transfer` sejak mint, jadi
 * angka di sini bisa dicocokkan satu per satu dengan `balanceOf` di chain.
 *
 * YANG BUKAN HOLDER
 *
 * Kurva memegang semua suplai yang belum terjual — pada peluncuran 100% — jadi memasukkannya
 * ke "10 teratas" membuat setiap pasar terbaca "top 10 memegang 99,99%" dan angka itu tidak
 * memberi tahu apa pun. Kurva ditampilkan terpisah sebagai "in curve". Alamat nol dan alamat
 * dead juga bukan pemegang: token di sana sudah dibakar.
 *
 * Persentase dihitung terhadap suplai YANG ADA sekarang (jumlah semua saldo), sama seperti
 * explorer menghitung "percentage of total supply". Token yang dibakar ke alamat nol sudah
 * keluar dari suplai itu.
 */

export interface HolderRow {
  address: string;
  tokens: number;
  pct: number;
}

export interface HoldersReport {
  symbol: string;
  chainId: number;
  index: IndexStatus;
  /** Saldo sudah disusun dari seluruh riwayat sejak mint. */
  complete: boolean;
  /** Blok terakhir yang sudah diterapkan ke saldo. */
  asOfBlock: number;
  supplyTokens: number;
  holders: number;
  top10Pct: number;
  creator: string;
  creatorTokens: number;
  creatorPct: number;
  curveTokens: number;
  curvePct: number;
  burnedTokens: number;
  top: HolderRow[];
}

export function computeHolders(
  index: MarketIndex,
  opts: { symbol: string; creator: string; status: IndexStatus; topN?: number }
): HoldersReport {
  const scale = 10n ** BigInt(index.decimals);
  const toTokens = (wei: bigint) => Number(wei / scale) + Number(wei % scale) / Number(scale);
  const curve = index.curve.toLowerCase();
  const creator = (opts.creator || "").toLowerCase();

  let supply = 0n;
  const rows: Array<{ address: string; wei: bigint }> = [];
  for (const [address, raw] of Object.entries(index.balances)) {
    const wei = BigInt(raw);
    if (wei <= 0n) continue;
    supply += wei;
    if (address === curve || address === ZERO_ADDRESS || address === DEAD_ADDRESS) continue;
    rows.push({ address, wei });
  }
  rows.sort((a, b) => (b.wei > a.wei ? 1 : b.wei < a.wei ? -1 : a.address.localeCompare(b.address)));

  // Persen dari bigint, bukan dari float: pada suplai 1e27 wei float kehilangan presisi di
  // digit yang justru membedakan 0,0018% dari 0,0019%.
  const pctOf = (wei: bigint) => (supply > 0n ? Number((wei * 100_000_000n) / supply) / 1_000_000 : 0);
  const balanceOf = (a: string) => BigInt(index.balances[a] ?? "0");
  const topN = opts.topN ?? 10;
  const top = rows.slice(0, topN);
  const topWei = top.reduce((s, r) => s + r.wei, 0n);
  const dead = balanceOf(DEAD_ADDRESS);

  return {
    symbol: opts.symbol.toUpperCase(),
    chainId: index.chainId,
    index: opts.status,
    complete: opts.status.complete,
    asOfBlock: index.scannedTo,
    supplyTokens: toTokens(supply),
    holders: rows.length,
    top10Pct: pctOf(topWei),
    creator,
    creatorTokens: toTokens(balanceOf(creator)),
    creatorPct: pctOf(balanceOf(creator)),
    curveTokens: toTokens(balanceOf(curve)),
    curvePct: pctOf(balanceOf(curve)),
    burnedTokens: toTokens(BigInt(index.burnedToZero) + dead),
    top: top.map((r) => ({ address: r.address, tokens: toTokens(r.wei), pct: pctOf(r.wei) })),
  };
}
