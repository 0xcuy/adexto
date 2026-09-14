/**
 * Endpoint GraphQL publik dan read-only untuk indexer Envio (Monad, chain 143).
 *
 * KENAPA SEBUAH PROXY, DAN BUKAN HASURA YANG DITERBITKAN LANGSUNG
 *
 * Hasura melayani lebih dari `/v1/graphql`. Ia juga melayani `/v1/metadata` dan `/v2/query`,
 * yang bisa mengubah skema dan menjalankan SQL mentah. Keduanya menuntut admin secret, jadi
 * menerbitkan portnya tidak langsung membocorkan apa pun — tetapi ia menaruh permukaan admin
 * di internet dan menggantungkan seluruh keamanannya pada satu string. Rute ini hanya
 * meneruskan operasi GraphQL, jadi kedua jalur itu tidak pernah terjangkau dari luar.
 *
 * SIAPA YANG MENEGAKKAN READ-ONLY
 *
 * Bukan berkas ini. Permintaan diteruskan TANPA admin secret, sehingga Hasura memetakannya
 * ke role `public` — dan Envio membuat role itu dengan `pg_create_select_permission` saja:
 * select, tanpa insert, update, atau delete. Sebuah `mutation` karena itu gagal di lapisan
 * izin, bukan karena ada yang mencocokkan kata "mutation" di badan permintaan.
 *
 * Perbedaan itu penting. Penjaga berbasis string bisa dilewati — alias, fragment, operasi
 * bernama, `\u006dutation` yang di-escape — dan setiap kali seseorang menemukan celahnya,
 * yang tersisa adalah akses tulis. Role tanpa izin tulis tidak punya celah untuk ditemukan.
 * Pemeriksaan `mutation` di bawah tetap ada, tapi sebagai jawaban yang lebih jelas bagi
 * pemanggil, bukan sebagai kontrol keamanan.
 *
 * APA YANG DIJAWAB ENDPOINT INI
 *
 * Riwayat lengkap setiap pasar Adexto di Monad sejak blok peluncuran factory: peluncuran,
 * swap, buyback, klaim fee, dan pengikatan agent ERC-8004. Introspeksi dibiarkan HIDUP —
 * endpoint GraphQL tanpa introspeksi memaksa orang menebak skemanya, dan tujuan rute ini
 * justru supaya angka kami bisa diperiksa tanpa meminta izin siapa pun.
 */
import { NextResponse } from "next/server";

/** Hasura hanya bisa dihubungi dari dalam jaringan Docker; ini nama layanannya. */
const UPSTREAM = process.env.ENVIO_GRAPHQL_URL ?? "";

/**
 * Batas ukuran badan permintaan.
 *
 * Bukan rate limit — ini hanya menutup kueri raksasa yang dikirim sekali. Batas baris untuk
 * role `public` sudah dipasang di sisi Hasura (`ENVIO_HASURA_RESPONSE_LIMIT`), jadi yang
 * belum tertutup adalah biaya PARSING, dan itu ditentukan panjang teks kueri.
 */
const MAX_BODY_BYTES = 16_000;

const CORS = {
  // Terbuka untuk siapa pun, dan itu memang tujuannya: sebuah endpoint yang hanya bisa
  // dipanggil dari domain kami sendiri tidak menyelesaikan apa pun yang rute ini ada untuk
  // menyelesaikan.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const CHAIN_ID = 143;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * `GET` menjawab dokumentasi, bukan 405.
 *
 * Orang yang menemukan URL ini akan membukanya di browser lebih dulu, dan "Method Not
 * Allowed" tidak memberi tahu apa pun tentang cara memakainya. Yang dikembalikan di sini
 * adalah keadaan indexer sekarang plus satu kueri contoh yang bisa langsung ditempel.
 */
export async function GET() {
  const status = await probe();
  return NextResponse.json(
    {
      endpoint: "/api/indexer/graphql",
      method: "POST",
      auth: "none — anonymous, read-only",
      indexer: "Envio HyperIndex",
      chainId: CHAIN_ID,
      chain: "Monad mainnet",
      indexes: "AdextoFactory 0.11.0 and every bonding curve it deploys, from its deploy block",
      entities: [
        "Project",
        "Curve",
        "Swap",
        "BuybackBurn",
        "CreatorFeeClaim",
        "ProtocolFeeClaim",
        "AgentBinding",
        "CurveDayData",
        "GlobalStats",
      ],
      readOnly:
        "Enforced by Hasura's permission system: unauthenticated requests map to a role that holds select permissions only.",
      /**
       * Kueri contoh dipilih supaya jawabannya bisa DICOCOKKAN DENGAN CHAIN tanpa
       * mempercayai kami: `swapCount` di sini harus sama dengan `swapCount()` di kurvanya,
       * dan `totalVolumeNative / 1000` harus sama dengan `totalProtocolFees` karena kaki
       * protokol dipungut 10 bps atas volume kotor.
       */
      exampleQuery:
        "{ Curve { id swapCount volumeNative totalProtocolFees floorPriceNative } Swap_aggregate { aggregate { count } } }",
      exampleCurl:
        `curl -s -X POST https://adexto.xyz/api/indexer/graphql ` +
        `-H 'content-type: application/json' ` +
        `-d '{"query":"{ Curve { id swapCount } }"}'`,
      status,
      docs: "https://github.com/0xcuy/adexto/tree/main/envio",
    },
    { headers: CORS }
  );
}

/** Kesegaran indexer, supaya `GET` menyatakan keadaan alih-alih hanya menjanjikannya. */
async function probe(): Promise<Record<string, unknown>> {
  if (!UPSTREAM) return { reachable: false, reason: "Indexer endpoint is not configured." };
  try {
    const res = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "{ chain_metadata { chain_id latest_processed_block is_hyper_sync } }",
      }),
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!res.ok) return { reachable: false, reason: `Indexer answered HTTP ${res.status}.` };
    const body = await res.json();
    const row = (body?.data?.chain_metadata ?? []).find(
      (m: any) => Number(m.chain_id) === CHAIN_ID
    );
    return {
      reachable: true,
      latestProcessedBlock: row?.latest_processed_block ?? null,
      source: row?.is_hyper_sync ? "HyperSync" : "RPC",
    };
  } catch {
    return { reachable: false, reason: "Indexer did not answer in time." };
  }
}

export async function POST(req: Request) {
  if (!UPSTREAM) {
    return NextResponse.json(
      { errors: [{ message: "Indexer endpoint is not configured on this deployment." }] },
      { status: 503, headers: CORS }
    );
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { errors: [{ message: `Query too large; the limit is ${MAX_BODY_BYTES} bytes.` }] },
      { status: 413, headers: CORS }
    );
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { errors: [{ message: "Body must be valid JSON with a `query` field." }] },
      { status: 400, headers: CORS }
    );
  }

  const query = typeof parsed?.query === "string" ? parsed.query : "";
  if (!query.trim()) {
    return NextResponse.json(
      { errors: [{ message: "Body must include a non-empty `query`." }] },
      { status: 400, headers: CORS }
    );
  }

  /**
   * Penolakan mutation di sini adalah PESAN, bukan kontrol keamanan.
   *
   * Yang benar-benar menghalangi tulisan adalah role `public` di Hasura, yang tidak punya
   * satu pun izin tulis. Pemeriksaan ini hanya menjawab dengan kalimat yang jelas alih-alih
   * membiarkan pemanggil menebak arti "field 'insert_Swap' not found". Ia dibaca dari
   * `operationName` dan kata kunci di awal operasi, dan sengaja tidak berpura-pura menjadi
   * parser — kalau ada yang lolos dari sini, lapisan izin yang menolaknya.
   */
  if (/\b(mutation|subscription)\b/i.test(query)) {
    return NextResponse.json(
      {
        errors: [
          {
            message:
              "This endpoint is read-only. Mutations and subscriptions are not served; the underlying role holds select permissions only.",
          },
        ],
      },
      { status: 405, headers: CORS }
    );
  }

  try {
    const res = await fetch(UPSTREAM, {
      method: "POST",
      /**
       * TANPA `x-hasura-admin-secret`. Ini satu-satunya baris yang membuat endpoint ini
       * read-only, dan menambahkan header itu di sini akan memberi setiap pemanggil anonim
       * hak admin penuh atas basis datanya.
       */
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables: parsed?.variables ?? undefined,
        operationName: parsed?.operationName ?? undefined,
      }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });

    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: {
        ...CORS,
        "Content-Type": "application/json",
        // Tidak di-cache: pasar bergerak, dan jawaban yang di-cache akan membuat endpoint
        // ini melaporkan riwayat yang sudah lewat sebagai keadaan sekarang.
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    const timedOut = e?.name === "TimeoutError";
    return NextResponse.json(
      {
        errors: [
          { message: timedOut ? "Indexer did not answer in time." : "Indexer is unreachable." },
        ],
      },
      { status: 504, headers: CORS }
    );
  }
}
