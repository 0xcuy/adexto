/**
 * Status attestation TEE model, dibaca dari router 0G itu sendiri.
 *
 * KENAPA BERKAS INI ADA
 *
 * Situs ini pernah menulis "Hardware Attested" dan "AMD SEV-SNP ACTIVE" tanpa
 * satu pun kode yang memeriksa apa pun. Saat audit menemukannya, saya berayun
 * terlalu jauh ke arah lain dan menghapus klaim TEE seluruhnya — juga salah,
 * karena router 0G MEMANG menyatakan attestation, dan menyatakannya dalam bentuk
 * yang bisa dibaca mesin.
 *
 * `GET /v1/models` mengembalikan, per model:
 *
 *   verifiability : "TeeML" | "TeeTLS"
 *   tee_attested  : boolean
 *   tee_type      : "TDX"
 *   tee_verifier  : "dstack"
 *
 * Bedanya penting, dan 0G sendiri yang menjelaskannya: TeeML berarti model dan
 * enklavenya milik 0G — inferensinya ter-attestasi di dalam kotak itu. TeeTLS
 * berarti bobotnya dijalankan pihak lain dan 0G menambahkan lapisan transport
 * ter-attestasi supaya setiap hop routing bisa dibuktikan.
 * (Diparafrasekan dari https://0g.ai/blog/deepseek-v4-pro-live-on-0g-private-computer)
 *
 * Ketiga model yang dipakai aplikasi ini — glm-5.3, 0gm-1.0-35b-a3b dan
 * 0gm-1.0-35b-a3b-sia — semuanya TeeML.
 *
 * Kalimat itu sempat TIDAK benar dan tidak ada yang memberi tahu. Selama daftar
 * ini memuat glm-5.2, router melayaninya sebagai TeeTLS, bukan TeeML — jadi
 * komentar ini mengklaim tingkat attestation yang lebih tinggi daripada yang
 * sebenarnya dinyatakan. Ditanyakan ulang ke GET /v1/models sebelum pindah:
 *
 *   glm-5.2  TeeTLS  attested=true  TDX  dstack
 *   glm-5.3  TeeML   attested=true  TDX  dstack
 *
 * Pindah ke 5.3 membuat kalimat di atas benar lagi, dan `allAttested` di bawah
 * tetap membacanya dari router — kalau 0G menurunkan tingkatnya lagi, UI yang
 * berbicara, bukan komentar ini.
 *
 * KENAPA INI PEMERIKSAAN SUNGGUHAN, BUKAN HIASAN
 *
 * Router yang sama juga menyajikan model TANPA field TEE sama sekali: claude-*,
 * gpt-*. Kalau suatu hari daftar model di studio bertambah, atau 0G membalik
 * `tee_attested` menjadi false, UI akan langsung mengatakannya — karena nilainya
 * dibaca, bukan ditulis di dalam komponen.
 *
 * BATASNYA, DINYATAKAN DI SINI SUPAYA TIDAK HILANG
 *
 * Ini membaca DEKLARASI router, bukan quote TDX mentah. Sudah diperiksa: tidak ada
 * `/v1/attestation`, `/v1/tee/report`, atau jalur sejenis (semuanya 404), dan badan
 * respons chat completion tidak memuat material attestation apa pun — nol
 * kemunculan "tee", "attest", "quote", atau "signature". Jadi kita bisa berkata
 * "router menyatakan model ini ter-attestasi TDX lewat dstack, dan inilah
 * jawabannya hari ini". Kita TIDAK bisa berkata "kami memverifikasi quote-nya
 * sendiri". Verifikasi quote sesungguhnya butuh verifier dstack.
 *
 * Yang memang ikut per respons: `x-provider` (alamat on-chain penyedia yang
 * melayani) dan `x_0g_trace.request_id`. Itu bukan attestation, tapi ia menamai
 * pihak yang bertanggung jawab, dan itu bisa dipakai.
 */

const ROUTER_URL = (process.env.OG_ROUTER_URL || "https://router-api.0g.ai/v1").replace(/\/+$/, "");
/** Model yang benar-benar bisa dipilih di studio. Harus cocok dengan MODELS di sana. */
export const AGENT_MODEL_IDS = ["glm-5.3", "0gm-1.0-35b-a3b", "0gm-1.0-35b-a3b-sia"] as const;

export interface ModelAttestation {
  id: string;
  /** null bila router tidak menyebut field ini untuk model tersebut. */
  attested: boolean | null;
  /** "TeeML" (enklave milik 0G) atau "TeeTLS" (transport ter-attestasi). */
  tier: string | null;
  /** "TDX". Situs ini pernah menyebut AMD SEV-SNP; router berkata Intel TDX. */
  teeType: string | null;
  /** "dstack" — runtime yang menghasilkan dan memverifikasi quote-nya. */
  verifier: string | null;
}

export interface AttestationReport {
  /** true hanya bila SETIAP model yang bisa dipilih menyatakan tee_attested. */
  allAttested: boolean;
  models: ModelAttestation[];
  /** false bila router tidak bisa dihubungi — jangan tampilkan sebagai "aman". */
  live: boolean;
  fetchedAt: string;
  source: "router" | "cache" | "unreachable";
}

const CACHE_TTL_MS = 10 * 60_000;

declare global {
  var __ADEXTO_TEE_CACHE__: { at: number; value: AttestationReport } | undefined;
}

export async function agentAttestation(): Promise<AttestationReport> {
  const hit = globalThis.__ADEXTO_TEE_CACHE__;
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.value, source: "cache" };

  const key = (process.env.OG_ROUTER_API_KEY || "").trim();
  const empty: AttestationReport = {
    allAttested: false,
    models: AGENT_MODEL_IDS.map((id) => ({ id, attested: null, tier: null, teeType: null, verifier: null })),
    live: false,
    fetchedAt: new Date().toISOString(),
    source: "unreachable",
  };
  // Tanpa kunci, katakan tidak terjangkau. JANGAN mengembalikan nilai cadangan
  // yang terlihat seperti "ter-attestasi" — itu mengulang kesalahan yang justru
  // sedang diperbaiki.
  if (!key) return empty;

  try {
    const res = await fetch(`${ROUTER_URL}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(12_000),
      next: { revalidate: 300 },
    } as RequestInit);
    if (!res.ok) return empty;

    const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
    const rows = Array.isArray(json?.data) ? json.data : [];
    const byId = new Map(rows.map((r) => [String(r.id), r]));

    const models: ModelAttestation[] = AGENT_MODEL_IDS.map((id) => {
      const row = byId.get(id);
      if (!row) return { id, attested: null, tier: null, teeType: null, verifier: null };
      return {
        id,
        attested: typeof row.tee_attested === "boolean" ? row.tee_attested : null,
        tier: typeof row.verifiability === "string" ? row.verifiability : null,
        teeType: typeof row.tee_type === "string" ? row.tee_type : null,
        verifier: typeof row.tee_verifier === "string" ? row.tee_verifier : null,
      };
    });

    const value: AttestationReport = {
      // `every` dengan `=== true` disengaja: null berarti router tidak menyebutnya,
      // dan itu tidak boleh dihitung sebagai ter-attestasi.
      allAttested: models.length > 0 && models.every((m) => m.attested === true),
      models,
      live: true,
      fetchedAt: new Date().toISOString(),
      source: "router",
    };
    globalThis.__ADEXTO_TEE_CACHE__ = { at: Date.now(), value };
    return value;
  } catch {
    return empty;
  }
}

/** Ringkasan satu baris untuk UI. Sengaja menyebut siapa yang mengklaim apa. */
export function attestationSummary(report: AttestationReport): string {
  if (!report.live) return "0G router unreachable — attestation status unknown";
  const first = report.models.find((m) => m.attested === true);
  if (!first) return "0G router does not report TEE attestation for these models";
  const tiers = [...new Set(report.models.map((m) => m.tier).filter(Boolean))].join(" / ");
  return `0G router reports ${first.teeType ?? "TEE"} attestation via ${first.verifier ?? "its verifier"} (${tiers})`;
}
