"use client";

/**
 * Kartu identitas agen ERC-8004: satu komponen untuk pratinjau di `/agents/identity` (kanvas kosong yang terisi
 * saat creator mengetik) dan kartu publik di `/agents/id/[chainId]/[agentId]`.
 *
 * Digambar pada ukuran tetap 1012×638 (rasio kartu ID-1) lalu diskalakan ke lebar wadah, supaya tata letaknya
 * sama persis di desktop dan ponsel. Barcode (Code 128, `chainId:agentId`) dan QR (URL kartu publik) baru muncul
 * sesudah agen terdaftar: sebelum itu belum ada id yang bisa dikodekan, jadi yang tampil penanda, bukan barcode
 * palsu. Teks English (aturan bahasa repo).
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { code128B } from "@/lib/code128";

export interface IdentityCardData {
  chainId: number;
  chainName: string;
  name?: string;
  description?: string;
  /** URL gambar yang bisa ditampilkan browser (https atau data:). */
  image?: string | null;
  agentId?: string | null;
  owner?: string | null;
  /** Catatan di samping owner, misalnya "your wallet". */
  ownerNote?: string | null;
  registry: string;
  /** null = belum diketahui (pratinjau); [] = terdaftar tapi belum ada pasar. */
  markets?: Array<{ symbol: string; score: number }> | null;
  /** Tujuan QR. Hanya diisi bila halamannya benar-benar ada. */
  cardUrl?: string | null;
}

const W = 1012;
const H = 638;
const INK = "#0f1b2a";
const SOFT = "#5b6e82";

const CHAIN_LOGO: Record<number, { src: string; tile?: boolean }> = {
  143: { src: "/brand/monad.svg" },
  42161: { src: "/brand/arbitrum.svg" },
  8453: { src: "/brand/base.svg" },
  4663: { src: "/brand/robinhood.svg" },
  16661: { src: "/brand/0g-token.png", tile: true },
};

const short = (a: string, x = 6, y = 4) => (a.length > x + y + 1 ? `${a.slice(0, x)}…${a.slice(-y)}` : a);

/** Garis guilloche: kurva sinus berlapis, deterministik. */
function guilloche(): string[] {
  const out: string[] = [];
  for (let k = 0; k < 22; k++) {
    let d = "";
    for (let x = 0; x <= W; x += 8) {
      const y = 330 + Math.sin(x / (70 + k * 5) + k * 0.7) * (150 - k * 4) + Math.sin(x / 19 + k) * 6;
      d += (x ? " L" : "M") + x + " " + y.toFixed(1);
    }
    out.push(d);
  }
  return out;
}
const GUILLOCHE = guilloche();

function mrzLine(chainId: number, agentId: string | null | undefined, name: string): string {
  const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "<").replace(/^<|<$/g, "");
  return `AGT<${chainId}<${agentId ?? ""}<<${clean(name) || "AGENT"}`.padEnd(44, "<").slice(0, 44);
}


/**
 * Logo ADEXTO sebagai SVG inline, bukan `<img src="/logo.svg">`: tema gelap situs membalik warna `/logo.svg`
 * (globals.css), padahal kartu ini selalu terang. Path disalin dari `public/logo.svg`.
 */
function AdextoMark({ size, fill = INK, opacity = 1 }: { size: number; fill?: string; opacity?: number }) {
  const id = useId().replace(/:/g, "");
  const ring = "M76,286 a180,66 0 1 0 360,0 a180,66 0 1 0 -360,0 Z M99,276 a169,55 0 1 0 338,0 a169,55 0 1 0 -338,0 Z";
  return (
    <svg viewBox="74 77 364 364" width={size} height={size} aria-hidden="true" style={{ opacity }}>
      <mask id={`cut-${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
        <rect width="512" height="512" fill="#fff" />
        <g transform="rotate(-14 256 286)"><path d={ring} fill="none" stroke="#000" strokeWidth={20} strokeLinejoin="round" /></g>
        <circle cx="388" cy="302" r="34" fill="none" stroke="#000" strokeWidth={20} />
      </mask>
      <g fill={fill}>
        <path d="M256,104 L438,414 L350,414 L256,214 L162,414 L74,414 Z" mask={`url(#cut-${id})`} />
        <g transform="rotate(-14 256 286)"><path d={ring} fillRule="evenodd" /></g>
        <circle cx="388" cy="302" r="34" />
      </g>
    </svg>
  );
}

/** `preview`: kanvas kosong di halaman pembuatan menampilkan teks contoh di kolom yang belum diisi. */
export default function IdentityCard({ data, className, preview = false }: { data: IdentityCardData; className?: string; preview?: boolean }) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.5);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / W);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    if (!data.cardUrl) {
      setQr(null);
      return;
    }
    QRCode.toDataURL(data.cardUrl, { margin: 0, width: 312, errorCorrectionLevel: "M", color: { dark: INK, light: "#ffffff" } })
      .then((url) => alive && setQr(url))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [data.cardUrl]);

  const name = (data.name ?? "").trim();
  const hasId = Boolean(data.agentId && /^\d+$/.test(data.agentId));
  const barcode = useMemo(() => (hasId ? code128B(`${data.chainId}:${data.agentId}`) : null), [hasId, data.chainId, data.agentId]);
  const logo = CHAIN_LOGO[data.chainId];
  const markets = data.markets;
  const top = markets && markets.length ? markets.reduce((a, b) => (b.score > a.score ? b : a)) : null;
  // px desain per modul. 5 supaya tetap ≥ ±2,5 px fisik per modul sampai kartu selebar 292 px CSS di DPR 2
  // (iPhone SE) dan 539 px di DPR 1; 3 px gagal dibaca ZXing di kedua kondisi itu (diuji 5 Okt).
  // Id panjang (mis. 0G "16661:3545431", 189 modul) dikecilkan supaya muat 700 px; teks samping hanya bila muat.
  const MODULE = barcode ? Math.min(5, 700 / barcode.modules) : 5;
  const sideText = barcode ? 40 + barcode.modules * MODULE + 40 + `${data.chainId}:${data.agentId}`.length * 15.5 < 972 : false;

  return (
    <div ref={wrap} className={className} style={{ position: "relative", width: "100%", aspectRatio: `${W} / ${H}` }} data-testid="identity-card">
      <style>{`
        @keyframes idcard-holo { 0% { transform: translateX(-30%) rotate(8deg); } 100% { transform: translateX(30%) rotate(8deg); } }
        .idcard-holo-sheen { animation: idcard-holo 4.5s ease-in-out infinite alternate; }
        @media (prefers-reduced-motion: reduce) { .idcard-holo-sheen { animation: none; } }
      `}</style>
      <div
        role="img"
        aria-label={`ERC-8004 agent identity card${name ? ` for ${name}` : ""}${hasId ? `, agent ${data.agentId} on ${data.chainName}` : ", not registered yet"}`}
        style={{
          position: "absolute", left: 0, top: 0, width: W, height: H, transform: `scale(${scale})`, transformOrigin: "0 0",
          borderRadius: 34, overflow: "hidden", color: INK,
          background: "linear-gradient(135deg,#fbfdff 0%,#f1f5f9 55%,#eef2f8 100%)",
          boxShadow: "0 40px 80px rgba(15,27,42,.22),0 0 0 1px rgba(15,27,42,.10), inset 0 0 0 1px rgba(255,255,255,.8)",
        }}
      >
        {/* guilloche + rosette */}
        <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }} aria-hidden="true">
          {GUILLOCHE.map((d, k) => (
            <path key={k} d={d} fill="none" stroke={k % 2 ? "rgba(109,40,217,.09)" : "rgba(14,143,126,.09)"} strokeWidth={1.2} />
          ))}
          <g transform="translate(165 253)">
            {Array.from({ length: 36 }, (_, k) => (
              <ellipse key={k} cx={0} cy={0} rx={150} ry={52} transform={`rotate(${k * 5})`} fill="none" stroke="rgba(15,27,42,.07)" strokeWidth={1} />
            ))}
          </g>
        </svg>

        {/* pita holografik */}
        <div style={{ position: "absolute", left: 0, top: 0, width: W, height: 96, overflow: "hidden",
          background: "linear-gradient(100deg,#bfefff 0%,#d9ccff 22%,#ffd6ec 42%,#c9fbe6 62%,#cfe3ff 80%,#e9d5ff 100%)" }}>
          <div className="idcard-holo-sheen" style={{ position: "absolute", inset: "-40px -200px",
            background: "linear-gradient(90deg,rgba(255,255,255,0) 35%,rgba(255,255,255,.55) 50%,rgba(255,255,255,0) 65%)" }} />
          <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(115deg,rgba(255,255,255,.35) 0 2px,rgba(255,255,255,0) 2px 7px)", mixBlendMode: "overlay" }} />
        </div>
        <div style={{ position: "absolute", left: 34, top: 26, display: "flex", alignItems: "center", gap: 12 }}>
          <AdextoMark size={40} />
          <span className="font-display" style={{ font: "800 30px/44px var(--font-display)", letterSpacing: ".06em" }}>ADEXTO</span>
        </div>
        <div style={{ position: "absolute", left: 236, top: 22 }}>
          <div className="font-mono" style={{ fontSize: 15, lineHeight: "20px", letterSpacing: ".2em", color: "#33475b", fontWeight: 700 }}>AGENT IDENTITY</div>
          <div className="font-display" style={{ fontSize: 26, lineHeight: "30px", fontWeight: 700, marginTop: 3 }}>ERC-8004 · draft</div>
        </div>
        <div style={{ position: "absolute", right: 30, top: 26, height: 44, padding: "0 16px 0 10px", borderRadius: 22, background: "rgba(255,255,255,.75)",
          display: "flex", alignItems: "center", gap: 8 }}>
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo.src} alt="" width={26} height={26} style={{ borderRadius: logo.tile ? 6 : 0 }} />
          )}
          <span className="font-mono" style={{ fontSize: 18, fontWeight: 700, letterSpacing: ".08em" }}>{data.chainName.replace(/ Mainnet$/i, "").toUpperCase()}</span>
        </div>

        {/* foto */}
        <div style={{ position: "absolute", left: 40, top: 128, width: 250, height: 250, borderRadius: 22, overflow: "hidden",
          border: data.image ? "3px solid #fff" : "3px dashed #9aa9b8", background: data.image ? "#fff" : "rgba(255,255,255,.5)",
          boxShadow: data.image ? "0 0 0 1px rgba(15,27,42,.15)" : "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {data.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <span className="font-mono" style={{ fontSize: 18, color: "#8696a6", letterSpacing: ".1em", textAlign: "center" }}>{preview ? <>AGENT<br />IMAGE</> : <>NO<br />IMAGE</>}</span>
          )}
        </div>
        {/* kotak hologram perak */}
        <div style={{ position: "absolute", left: 214, top: 316, width: 110, height: 110, borderRadius: 18, overflow: "hidden",
          background: "conic-gradient(from 210deg,#d9dee5,#f8fafc,#aab4c0,#eef2f6,#c7ced8,#fdfdff,#b7c0cc,#d9dee5)",
          boxShadow: "0 6px 16px rgba(15,27,42,.25), inset 0 0 0 2px rgba(255,255,255,.7)" }} aria-hidden="true">
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(120deg,rgba(139,233,255,.55),rgba(196,181,253,0) 30%,rgba(251,207,232,.55) 55%,rgba(167,243,208,0) 75%,rgba(139,233,255,.5))", mixBlendMode: "color" }} />
          <div className="idcard-holo-sheen" style={{ position: "absolute", inset: "-30px -80px", background: "linear-gradient(90deg,rgba(255,255,255,0) 35%,rgba(255,255,255,.7) 50%,rgba(255,255,255,0) 65%)" }} />
          <div style={{ position: "absolute", inset: 0, background: "repeating-radial-gradient(circle at 30% 30%,rgba(255,255,255,.55) 0 1px,rgba(255,255,255,0) 1px 5px)", mixBlendMode: "overlay" }} />
          <div style={{ position: "absolute", left: 25, top: 25, mixBlendMode: "multiply" }}><AdextoMark size={60} opacity={0.38} /></div>
        </div>

        {/* data */}
        {(
          [
            ["NAME", name || (preview ? "Your agent" : "Unnamed agent"), 126, false, !name],
            ["AGENT ID", hasId ? `#${data.agentId}` : "#  issued at registration", 204, true, !hasId],
          ] as Array<[string, string, number, boolean, boolean]>
        ).map(([label, value, top0, mono, faint]) => (
          <div key={label} style={{ position: "absolute", left: 340, top: top0, maxWidth: 400 }}>
            <div className="font-mono" style={{ fontSize: 14, lineHeight: "18px", letterSpacing: ".2em", color: SOFT }}>{label}</div>
            <div className={mono ? "font-mono" : "font-display"}
              style={{ fontSize: mono ? (faint ? 22 : 28) : 34, lineHeight: "42px", fontWeight: 700, color: faint ? "#9aa9b8" : INK,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {value}
            </div>
          </div>
        ))}
        <div style={{ position: "absolute", left: 340, top: 282 }}>
          <div className="font-mono" style={{ fontSize: 14, lineHeight: "18px", letterSpacing: ".2em", color: SOFT }}>OWNER</div>
          <div className="font-mono" style={{ fontSize: 28, lineHeight: "40px", fontWeight: 700, color: data.owner ? INK : "#9aa9b8", whiteSpace: "nowrap" }}>
            {data.owner ? short(data.owner) : "connect a wallet"}
            {data.owner && data.ownerNote && (
              <span style={{ display: "inline-block", marginLeft: 10, padding: "0 12px", height: 30, borderRadius: 15, border: "2px solid #0e8f7e",
                background: "rgba(14,143,126,.10)", color: "#0e8f7e", font: "700 15px/26px var(--font-sans)", verticalAlign: 6 }}>
                ✓ {data.ownerNote}
              </span>
            )}
          </div>
        </div>
        <div style={{ position: "absolute", left: 340, top: 360 }}>
          <div className="font-mono" style={{ fontSize: 14, lineHeight: "18px", letterSpacing: ".2em", color: SOFT }}>REGISTRY</div>
          <div className="font-mono" style={{ fontSize: 22, lineHeight: "40px", fontWeight: 700 }}>eip155:{data.chainId}:{short(data.registry)}</div>
        </div>

        {/* skor */}
        <div style={{ position: "absolute", right: 34, top: 124, width: 200, height: 172, borderRadius: 20, background: "rgba(255,255,255,.75)",
          boxShadow: "0 0 0 1px rgba(15,27,42,.10)", textAlign: "center" }}>
          <div className="font-mono" style={{ fontSize: 14, letterSpacing: ".2em", color: SOFT, marginTop: 16 }}>AGENT SCORE</div>
          {top ? (
            <>
              <div className="font-display" style={{ fontSize: 64, lineHeight: "70px", fontWeight: 700, marginTop: 18 }}>
                {top.score}
                <span style={{ fontSize: 26, color: SOFT }}>/100</span>
              </div>
              <div style={{ margin: "6px auto 0", width: 150, height: 10, borderRadius: 5, background: "#dfe6ec", overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, top.score)}%`, height: "100%", background: "linear-gradient(90deg,#6d28d9,#0e8f7e)" }} />
              </div>
            </>
          ) : (
            <div className="font-mono" style={{ fontSize: 16, lineHeight: "22px", color: "#8696a6", marginTop: 34, padding: "0 14px" }}>
              {markets ? "No markets yet" : "Scored after your first launch"}
            </div>
          )}
        </div>
        <div className="font-mono" style={{ position: "absolute", right: 34, top: 306, width: 200, fontSize: 14, lineHeight: "20px", color: SOFT, textAlign: "center", letterSpacing: ".08em" }}>
          {markets && markets.length ? (
            <>MARKETS <b style={{ color: INK }}>{markets.length}</b>{top ? <> · <b style={{ color: INK }}>${top.symbol}</b></> : null}</>
          ) : (
            "MARKETS 0"
          )}
        </div>

        {/* QR → kartu publik */}
        <div style={{ position: "absolute", right: 36, top: 336, width: 156, height: 156, padding: 8, background: "#fff", borderRadius: 12,
          boxShadow: "0 0 0 1px rgba(15,27,42,.10)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="" width={140} height={140} style={{ imageRendering: "pixelated" }} />
          ) : (
            <div style={{ width: 140, height: 140, borderRadius: 6, background: "repeating-linear-gradient(45deg,#e5ebf0 0 6px,#f4f7fa 6px 12px)" }} />
          )}
        </div>
        <div className="font-mono" style={{ position: "absolute", right: 34, top: 498, width: 160, textAlign: "center", fontSize: 12, color: SOFT, letterSpacing: ".06em" }}>
          {qr ? "scan → public card" : "QR after registration"}
        </div>

        {/* lencana binding atau deskripsi */}
        {markets && markets.length ? (
          <div style={{ position: "absolute", left: 40, top: 446, height: 44, padding: "0 18px", borderRadius: 12, background: "rgba(14,143,126,.10)",
            color: "#0e8f7e", font: "700 20px/44px var(--font-sans)", whiteSpace: "nowrap" }}>
            🔒 Bound to {markets.length} market{markets.length === 1 ? "" : "s"} · can&apos;t be swapped
          </div>
        ) : (
          <div style={{ position: "absolute", left: 40, top: 440, width: 620, height: 52, overflow: "hidden", font: "500 17px/26px var(--font-sans)",
            color: data.description ? "#33475b" : "#9aa9b8" }}>
            {data.description?.trim() || (preview ? "A short description of what your agent does." : "")}
          </div>
        )}

        {/* barcode Code 128 */}
        {barcode ? (
          <>
            <svg style={{ position: "absolute", left: 40, top: 506 }} width={barcode.modules * MODULE} height={64}
              viewBox={`0 0 ${barcode.modules} 64`} preserveAspectRatio="none" aria-hidden="true" data-testid="identity-barcode">
              <rect x={0} y={0} width={barcode.modules} height={64} fill="#fff" opacity={0} />
              {barcode.bars.map(([x, w]) => (
                <rect key={x} x={x} y={0} width={w} height={64} fill={INK} />
              ))}
            </svg>
            {sideText && <div className="font-mono" style={{ position: "absolute", left: 40 + barcode.modules * MODULE + 40, top: 528, fontSize: 18, fontWeight: 700, letterSpacing: ".24em", color: "#33475b" }}>
              {data.chainId}:{data.agentId}
            </div>}
          </>
        ) : (
          <div className="font-mono" style={{ position: "absolute", left: 40, top: 506, width: 670, height: 64, borderRadius: 6, display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 14, letterSpacing: ".14em", color: "#8696a6",
            background: "repeating-linear-gradient(90deg,#dfe6ec 0 3px,transparent 3px 9px)" }}>
            <span style={{ background: "#f1f5f9", padding: "2px 10px", borderRadius: 4 }}>BARCODE ISSUED AT REGISTRATION</span>
          </div>
        )}
        <div className="font-mono" style={{ position: "absolute", left: 40, top: 582, fontSize: 17, lineHeight: "22px", fontWeight: 700, letterSpacing: ".18em", color: "#33475b", whiteSpace: "nowrap" }}>
          {mrzLine(data.chainId, hasId ? data.agentId : null, name)}
        </div>
      </div>
    </div>
  );
}
