/**
 * Tata letak bersama kedua kartu bagikan (pasar dan posisi), 1200x630, untuk satori.
 *
 * Satu tata letak untuk dua kartu, karena cacat yang sama pernah harus diperbaiki dua kali:
 * logo merek palsu, tautan internal, dan baris angka yang meluap ke bawah robot.
 *
 * YANG MEMBENTUKNYA
 *
 * - Chain dipindah dari baris angka ke chip di bawah nama. Sebagai kolom ketiga ia yang
 *   pertama terdorong keluar: harga native `0.000000001664 ETH` sudah selebar dua kolom, jadi
 *   "Base Mainnet" tergambar DI BAWAH robot dan terpotong.
 * - Baris angka boleh membungkus (`flexWrap`), dan kolom kiri berhenti jauh sebelum robot.
 *   Satori tidak membungkus baris flex dengan sendirinya; tanpa ini luapan tidak terlihat
 *   sampai kartunya dibagikan.
 * - Angka pertama yang paling besar. Di kartu pasar itu market cap, sama seperti urutan di
 *   halaman token: harga per token dengan supply satu miliar selalu mikroskopis dan paling
 *   sulit dibaca.
 *
 * Aturan satori yang berlaku di sini: setiap `div` dengan lebih dari satu anak WAJIB punya
 * `display` eksplisit, `radial-gradient` tergambar sebagai cakram keras, dan SVG tidak digambar.
 */

export const CARD_COLORS = {
  charcoal: "#17120d",
  panel: "#221b15",
  cream: "#f7f2e9",
  creamSoft: "#dbcfbd",
  creamFaint: "#bdab95",
  violet: "#b193ff",
  ok: "#4ade80",
  down: "#fb7185",
} as const;

const C = CARD_COLORS;

export interface CardImage {
  src: string;
  width: number;
  height: number;
}

export interface CardStat {
  label: string;
  value: string;
  /** Warna nilai untuk angka bertanda (PnL). Tanpa ini nilai memakai warna teks biasa. */
  tone?: "up" | "down";
}

export interface ShareCardProps {
  /** Mark ADEXTO; null hanya bila berkasnya hilang dari image. */
  mark: CardImage | null;
  /** Sumber gambar token (data URI), atau null untuk monogram. */
  logoSrc: string | null;
  symbol: string;
  title: string;
  subtitle: string;
  chainLabel: string;
  /** Logo chain di depan label chip, dari `chainMarkImage()`; null berarti chip tanpa logo. */
  chainMark?: CardImage | null;
  /** Angka pertama digambar paling besar. */
  stats: CardStat[];
  note: { text: string; color: string };
  /** Alamat pasar lengkap; yang digambar tanpa `https://`, QR membawa versi lengkapnya. */
  marketUrl: string;
  qr: string;
  robot: CardImage | null;
}

/** "Base Mainnet" → "Base". Nama testnet dibiarkan utuh supaya tidak terbaca sebagai mainnet. */
export function chainChipLabel(name: string): string {
  return name.replace(/\s+Mainnet$/i, "");
}

/** Judul panjang mengecil alih-alih meluap: "I hold $ABCDEFGHIJ" tidak muat pada 64px. */
function titleSize(title: string): number {
  if (title.length <= 8) return 64;
  if (title.length <= 12) return 56;
  if (title.length <= 16) return 48;
  return 40;
}

export function ShareCard(p: ShareCardProps) {
  return (
    <div
      style={{
        width: "1200px",
        height: "630px",
        display: "flex",
        background: C.charcoal,
        color: C.cream,
        fontFamily: "sans-serif",
        position: "relative",
      }}
    >
      {/* Cahaya violet di kanan. Gradien linear, bukan radial: lihat catatan di atas. */}
      <div
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          width: "560px",
          height: "630px",
          display: "flex",
          background:
            "linear-gradient(270deg, rgba(124,58,237,0.38) 0%, rgba(124,58,237,0.12) 45%, rgba(23,18,13,0) 100%)",
        }}
      />

      <div style={{ display: "flex", flexDirection: "column", padding: "52px 0 48px 60px", width: "780px" }}>
        {/* Merek: mark + wordmark "adexto." dengan titik beraksen, sama seperti header situs. */}
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          {p.mark ? <img src={p.mark.src} width={44} height={44} /> : null}
          <div style={{ display: "flex", fontSize: "30px", fontWeight: 600, letterSpacing: "-0.03em" }}>
            <span>adexto</span>
            <span style={{ color: C.violet }}>.</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "24px", marginTop: "40px" }}>
          <div
            style={{
              display: "flex",
              width: "104px",
              height: "104px",
              borderRadius: "26px",
              border: `1px solid ${C.creamFaint}`,
              background: C.panel,
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            {p.logoSrc ? (
              <img src={p.logoSrc} width={104} height={104} style={{ objectFit: "cover" }} />
            ) : (
              <div style={{ display: "flex", fontSize: "44px", fontWeight: 700, color: C.violet }}>
                {p.symbol.slice(0, 2)}
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontSize: `${titleSize(p.title)}px`,
                fontWeight: 700,
                letterSpacing: "-0.03em",
                lineHeight: 1,
              }}
            >
              {p.title}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "14px", marginTop: "12px" }}>
              <div
                style={{
                  display: "flex",
                  fontSize: "24px",
                  color: C.creamSoft,
                  maxWidth: "380px",
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                }}
              >
                {p.subtitle}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "18px",
                  fontWeight: 600,
                  color: C.violet,
                  border: `1px solid rgba(177,147,255,0.55)`,
                  background: "rgba(124,58,237,0.16)",
                  borderRadius: "999px",
                  padding: p.chainMark ? "4px 14px 4px 8px" : "4px 14px",
                }}
              >
                {/* Logo apa adanya, tanpa dipotong bulat: sama dengan pemilih chain di situs. */}
                {p.chainMark ? (
                  <img src={p.chainMark.src} width={p.chainMark.width} height={p.chainMark.height} style={{ objectFit: "contain" }} />
                ) : null}
                <span>{p.chainLabel}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Setiap angka duduk di kotak setinggi angka terbesar dan menempel ke dasarnya: label
            sejajar di atas, angka sejajar di bawah, walau ukurannya berbeda. */}
        <div style={{ display: "flex", flexWrap: "wrap", rowGap: "18px", columnGap: "56px", marginTop: "44px" }}>
          {p.stats.map((s, i) => (
            <div key={s.label} style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  display: "flex",
                  fontSize: "16px",
                  color: C.creamFaint,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                }}
              >
                {s.label}
              </div>
              <div style={{ display: "flex", height: "70px", alignItems: "flex-end" }}>
                <div
                  style={{
                    ...(i === 0
                      ? { display: "flex", fontSize: "56px", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.1 }
                      : { display: "flex", fontSize: "34px", fontWeight: 600, color: C.creamSoft, lineHeight: 1.1, paddingBottom: "4px" }),
                    ...(s.tone === "up" ? { color: C.ok } : s.tone === "down" ? { color: C.down } : {}),
                  }}
                >
                  {s.value}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
          <div style={{ display: "flex", fontSize: "20px", color: p.note.color }}>{p.note.text}</div>
          <div style={{ display: "flex", fontSize: "22px", fontWeight: 600, color: C.violet, marginTop: "8px" }}>
            {p.marketUrl.replace(/^https?:\/\//, "")}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          justifyContent: "space-between",
          padding: "48px 52px 36px 0",
          width: "420px",
        }}
      >
        <img src={p.qr} width={140} height={140} style={{ borderRadius: "16px", background: C.cream, padding: "6px" }} />
        {p.robot ? <img src={p.robot.src} width={p.robot.width} height={p.robot.height} style={{ objectFit: "contain" }} /> : null}
      </div>

      <div
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          width: "1200px",
          height: "6px",
          background: C.panel,
          display: "flex",
        }}
      />
    </div>
  );
}
