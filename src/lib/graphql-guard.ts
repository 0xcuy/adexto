/**
 * Penilai biaya kueri GraphQL untuk proxy publik indexer Envio (`/api/indexer/graphql`).
 *
 * KENAPA INI ADA
 *
 * Proxy itu meneruskan kueri APA PUN ke Hasura dengan role `public`. Role itu read-only, jadi
 * tidak ada yang bisa ditulis — tetapi membaca pun bisa dibuat mahal, dan Postgres-nya berbagi
 * VPS dengan situs ini:
 *
 *   - `ENVIO_HASURA_RESPONSE_LIMIT` (1000) membatasi baris PER SELEKSI, bukan per kueri. Jadi
 *     `{ Curve { swaps { curve { swaps { id } } } } }` meminta pasar × 1000 × 1000 baris, dan
 *     setiap tingkat daftar berikutnya mengalikan lagi dengan 1000;
 *   - alias mengulang seleksi yang sama sebanyak muatan 16 KB, mis. 150 `Swap_aggregate`;
 *   - Hasura CE tidak punya batas kedalaman atau jumlah node, dan `AbortSignal.timeout` di proxy
 *     hanya memutus klien HTTP — kueri Postgres-nya tetap berjalan sampai selesai.
 *
 * APA YANG DIUKUR
 *
 * Teks kueri di-tokenisasi dan diurai secukupnya (operasi, fragment, seleksi, alias, argumen,
 * direktif), lalu fragment DIEKSPANSI supaya tidak bisa dipakai menyembunyikan kedalaman.
 * Introspeksi (`__schema`, `__type`) dikecualikan: ia dijawab dari cache skema Hasura, bukan
 * dari basis data, dan klien GraphQL membutuhkannya dengan kedalaman lebih dari 10.
 *
 * Yang paling menentukan biaya adalah DAFTAR BESAR bertingkat. Skemanya (envio/schema.graphql)
 * hanya punya daftar bertingkat di `Curve` (`swaps`, `buybacks`, `dayData`, `creatorFeeClaims`,
 * `protocolFeeClaims`), dan tabel yang kecil adalah tabel per pasar (`Curve`, `Project`, ...).
 * Satu jalur boleh memuat SATU daftar besar: `Curve { swaps }` boleh, `Swap { curve { swaps } }`
 * dan `Curve { swaps { curve { swaps } } }` tidak.
 *
 * Ini bukan validator GraphQL. Kueri yang salah tapi lolos dari sini tetap ditolak Hasura; yang
 * dijamin berkas ini hanya bahwa kueri yang diteruskan tidak bisa meminta lebih dari batasnya.
 */

export interface QueryLimits {
  /** Kedalaman seleksi; `{ Curve { id } }` = 2. Agregat atas relasi butuh 5. */
  maxDepth: number;
  /** Jumlah field sesudah fragment diekspansi. */
  maxFields: number;
  /** Field di akar operasi (tiap alias dihitung). */
  maxRootFields: number;
  /** Field `*_aggregate` sesudah ekspansi. */
  maxAggregates: number;
  /** Daftar besar sepanjang satu jalur akar-ke-daun. */
  maxBigLists: number;
}

export const INDEXER_QUERY_LIMITS: QueryLimits = {
  maxDepth: 6,
  maxFields: 300,
  maxRootFields: 10,
  maxAggregates: 10,
  maxBigLists: 1,
};

export type QueryVerdict =
  | { ok: true; depth: number; fields: number; rootFields: number; aggregates: number; bigLists: number }
  | { ok: false; reason: string };

/** Tabel akar yang barisnya sebanyak PASAR, bukan sebanyak transaksi. */
const SMALL_ROOT_TABLES = new Set(["Project", "Curve", "AgentBinding", "GlobalStats", "chain_metadata"]);

/** Relasi daftar di dalam `Curve`, dari `@derivedFrom` di envio/schema.graphql. */
const BIG_NESTED_LISTS = new Set(["swaps", "buybacks", "dayData", "creatorFeeClaims", "protocolFeeClaims"]);

class GuardError extends Error {}

type Tok = { k: "name" | "punct" | "value"; v: string };

const NAME_START = /[_A-Za-z]/;
const NAME_CONT = /[_0-9A-Za-z]/;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "," || c === "\uFEFF") {
      i += 1;
      continue;
    }
    if (c === "#") {
      while (i < n && src[i] !== "\n" && src[i] !== "\r") i += 1;
      continue;
    }
    if (c === '"') {
      if (src.startsWith('"""', i)) {
        let j = i + 3;
        for (;;) {
          if (j >= n) throw new GuardError("unterminated block string");
          if (src.startsWith('\\"""', j)) {
            j += 4;
            continue;
          }
          if (src.startsWith('"""', j)) {
            j += 3;
            break;
          }
          j += 1;
        }
        i = j;
      } else {
        let j = i + 1;
        for (;;) {
          if (j >= n) throw new GuardError("unterminated string");
          const d = src[j];
          if (d === "\\") {
            j += 2;
            continue;
          }
          if (d === "\n" || d === "\r") throw new GuardError("unterminated string");
          j += 1;
          if (d === '"') break;
        }
        i = j;
      }
      out.push({ k: "value", v: "string" });
      continue;
    }
    if (c === ".") {
      if (!src.startsWith("...", i)) throw new GuardError("unexpected '.'");
      out.push({ k: "punct", v: "..." });
      i += 3;
      continue;
    }
    if ("{}()[]:=@$!|&".includes(c)) {
      out.push({ k: "punct", v: c });
      i += 1;
      continue;
    }
    if (NAME_START.test(c)) {
      let j = i + 1;
      while (j < n && NAME_CONT.test(src[j])) j += 1;
      out.push({ k: "name", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "-" || (c >= "0" && c <= "9")) {
      let j = i + 1;
      while (j < n && /[0-9.eE+\-]/.test(src[j])) j += 1;
      out.push({ k: "value", v: "number" });
      i = j;
      continue;
    }
    throw new GuardError(`unexpected character '${c}'`);
  }
  return out;
}

type Sel =
  | { kind: "field"; name: string; sel: Sel[] | null }
  | { kind: "spread"; name: string }
  | { kind: "inline"; sel: Sel[] };

/** Batas rekursi pengurai, jauh di atas `maxDepth`, supaya `{{{{…` tidak menghabiskan stack. */
const PARSE_NESTING_LIMIT = 32;

class Parser {
  private p = 0;
  private nesting = 0;
  constructor(private readonly t: Tok[]) {}

  private peek(offset = 0): Tok | undefined {
    return this.t[this.p + offset];
  }
  private isPunct(v: string): boolean {
    const x = this.t[this.p];
    return x !== undefined && x.k === "punct" && x.v === v;
  }
  private name(): string {
    const x = this.t[this.p];
    if (!x || x.k !== "name") throw new GuardError("expected a name");
    this.p += 1;
    return x.v;
  }
  private skipBalanced(): void {
    // Token sekarang adalah pembuka. Nilai argumen boleh memuat objek dan daftar bersarang.
    let depth = 0;
    do {
      const x = this.t[this.p];
      if (!x) throw new GuardError("unterminated arguments");
      this.p += 1;
      if (x.k === "punct") {
        if (x.v === "(" || x.v === "[" || x.v === "{") depth += 1;
        else if (x.v === ")" || x.v === "]" || x.v === "}") depth -= 1;
      }
    } while (depth > 0);
  }
  private directives(): void {
    while (this.isPunct("@")) {
      this.p += 1;
      this.name();
      if (this.isPunct("(")) this.skipBalanced();
    }
  }

  document(): { operations: Sel[][]; fragments: Map<string, Sel[]> } {
    const operations: Sel[][] = [];
    const fragments = new Map<string, Sel[]>();
    while (this.p < this.t.length) {
      if (this.isPunct("{")) {
        operations.push(this.selectionSet());
        continue;
      }
      const kw = this.peek();
      if (kw?.k === "name" && (kw.v === "query" || kw.v === "mutation" || kw.v === "subscription")) {
        this.p += 1;
        if (this.peek()?.k === "name") this.p += 1;
        if (this.isPunct("(")) this.skipBalanced();
        this.directives();
        operations.push(this.selectionSet());
        continue;
      }
      if (kw?.k === "name" && kw.v === "fragment") {
        this.p += 1;
        const fname = this.name();
        if (this.name() !== "on") throw new GuardError(`fragment ${fname} has no type condition`);
        this.name();
        this.directives();
        if (fragments.has(fname)) throw new GuardError(`fragment ${fname} is defined twice`);
        fragments.set(fname, this.selectionSet());
        continue;
      }
      throw new GuardError("expected an operation or a fragment");
    }
    if (operations.length === 0) throw new GuardError("no operation in the query");
    return { operations, fragments };
  }

  private selectionSet(): Sel[] {
    this.nesting += 1;
    if (this.nesting > PARSE_NESTING_LIMIT) throw new GuardError("query is nested too deeply");
    if (!this.isPunct("{")) throw new GuardError("expected '{'");
    this.p += 1;
    const out: Sel[] = [];
    while (!this.isPunct("}")) {
      if (this.p >= this.t.length) throw new GuardError("unterminated selection set");
      if (this.isPunct("...")) {
        this.p += 1;
        const x = this.peek();
        if (x?.k === "name" && x.v !== "on") {
          this.p += 1;
          this.directives();
          out.push({ kind: "spread", name: x.v });
          continue;
        }
        if (x?.k === "name" && x.v === "on") {
          this.p += 1;
          this.name();
        }
        this.directives();
        out.push({ kind: "inline", sel: this.selectionSet() });
        continue;
      }
      let fieldName = this.name();
      if (this.isPunct(":")) {
        this.p += 1;
        fieldName = this.name();
      }
      if (this.isPunct("(")) this.skipBalanced();
      this.directives();
      const sel = this.isPunct("{") ? this.selectionSet() : null;
      out.push({ kind: "field", name: fieldName, sel });
    }
    this.p += 1;
    this.nesting -= 1;
    return out;
  }
}

interface Cost {
  depth: number;
  fields: number;
  aggregates: number;
  bigLists: number;
  rootFields: number;
}

/** Apakah field ini daftar besar, dilihat dari namanya dan nama induknya. */
function isBigList(name: string, parent: string | null): boolean {
  if (name === "nodes" && parent && parent.endsWith("_aggregate")) {
    return isBigList(parent.slice(0, -"_aggregate".length), parentOfAggregate(parent));
  }
  if (parent === null) {
    if (name.endsWith("_by_pk") || name.endsWith("_aggregate")) return false;
    return !SMALL_ROOT_TABLES.has(name);
  }
  return BIG_NESTED_LISTS.has(name);
}

/**
 * `Swap_aggregate` adalah agregat AKAR (huruf besar, nama tabel); `swaps_aggregate` agregat
 * relasi. Tabel akar selalu diawali huruf besar di skema Envio, kecuali tabel internal seperti
 * `chain_metadata` — yang juga diperlakukan sebagai akar.
 */
function parentOfAggregate(aggregate: string): string | null {
  const base = aggregate.slice(0, -"_aggregate".length);
  return BIG_NESTED_LISTS.has(base) ? "Curve" : null;
}

function analyzeSet(
  sel: Sel[],
  parent: string | null,
  fragments: Map<string, Sel[]>,
  memo: Map<string, Cost>,
  active: Set<string>
): Cost {
  let childDepth = 0;
  let fields = 0;
  let aggregates = 0;
  let bigLists = 0;
  let rootFields = 0;

  const merge = (c: Cost) => {
    // Fragment dan inline fragment digabung ke TINGKAT YANG SAMA, jadi kedalamannya tidak
    // menambah satu tingkat — tetapi isinya ikut dihitung penuh.
    childDepth = Math.max(childDepth, c.depth - 1);
    fields += c.fields;
    aggregates += c.aggregates;
    bigLists = Math.max(bigLists, c.bigLists);
    rootFields += c.rootFields;
  };

  for (const s of sel) {
    if (s.kind === "field") {
      if (s.name === "__typename") continue;
      if (s.name.startsWith("__")) {
        // Introspeksi: dijawab dari skema, bukan dari tabel. Dihitung sebagai satu field saja.
        fields += 1;
        continue;
      }
      fields += 1;
      if (parent === null) rootFields += 1;
      if (s.name.endsWith("_aggregate")) aggregates += 1;
      const big = isBigList(s.name, parent) ? 1 : 0;
      if (s.sel) {
        const c = analyzeSet(s.sel, s.name, fragments, memo, active);
        childDepth = Math.max(childDepth, c.depth);
        fields += c.fields;
        aggregates += c.aggregates;
        bigLists = Math.max(bigLists, big + c.bigLists);
      } else {
        bigLists = Math.max(bigLists, big);
      }
    } else if (s.kind === "inline") {
      merge(analyzeSet(s.sel, parent, fragments, memo, active));
    } else {
      const body = fragments.get(s.name);
      if (!body) throw new GuardError(`unknown fragment ${s.name}`);
      // Memo per (fragment, induk): fragment yang menyebar fragment lain berkali-kali akan
      // tumbuh eksponensial kalau dihitung ulang setiap kali. Angkanya tetap tumbuh — dan
      // ditolak oleh `maxFields` — tetapi kerjanya tidak.
      const key = `${s.name}|${parent ?? "<root>"}`;
      let c = memo.get(key);
      if (!c) {
        if (active.has(key)) throw new GuardError(`fragment ${s.name} spreads itself`);
        active.add(key);
        c = analyzeSet(body, parent, fragments, memo, active);
        active.delete(key);
        memo.set(key, c);
      }
      merge(c);
    }
  }
  return { depth: 1 + childDepth, fields, aggregates, bigLists, rootFields };
}

export function analyzeQuery(query: string, limits: QueryLimits = INDEXER_QUERY_LIMITS): QueryVerdict {
  try {
    const { operations, fragments } = new Parser(tokenize(query)).document();
    let worst: Cost = { depth: 0, fields: 0, aggregates: 0, bigLists: 0, rootFields: 0 };
    for (const op of operations) {
      const c = analyzeSet(op, null, fragments, new Map(), new Set());
      worst = {
        depth: Math.max(worst.depth, c.depth),
        fields: Math.max(worst.fields, c.fields),
        aggregates: Math.max(worst.aggregates, c.aggregates),
        bigLists: Math.max(worst.bigLists, c.bigLists),
        rootFields: Math.max(worst.rootFields, c.rootFields),
      };
    }
    if (worst.depth > limits.maxDepth) {
      return { ok: false, reason: `Query is nested ${worst.depth} levels deep; the limit is ${limits.maxDepth}.` };
    }
    if (worst.fields > limits.maxFields) {
      return { ok: false, reason: `Query selects ${worst.fields} fields after fragments are expanded; the limit is ${limits.maxFields}.` };
    }
    if (worst.rootFields > limits.maxRootFields) {
      return { ok: false, reason: `Query has ${worst.rootFields} top-level fields; the limit is ${limits.maxRootFields}.` };
    }
    if (worst.aggregates > limits.maxAggregates) {
      return { ok: false, reason: `Query has ${worst.aggregates} aggregate fields; the limit is ${limits.maxAggregates}.` };
    }
    if (worst.bigLists > limits.maxBigLists) {
      return {
        ok: false,
        reason:
          `Query nests ${worst.bigLists} large lists inside each other (for example Swap { curve { swaps } }); ` +
          `the limit is ${limits.maxBigLists}. Query the inner list from its own root with a where filter instead.`,
      };
    }
    return { ok: true, ...worst };
  } catch (e) {
    if (e instanceof GuardError) return { ok: false, reason: `Query could not be read: ${e.message}.` };
    return { ok: false, reason: "Query could not be read." };
  }
}
