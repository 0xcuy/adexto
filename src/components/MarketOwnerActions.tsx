"use client";

import { useEffect, useRef, useState } from "react";
import { Share2, Pencil, ImagePlus, Check, Copy, X, RefreshCw, AlertTriangle, Image as ImageIcon, Wallet } from "lucide-react";
import { getActiveEip1193 } from "@/lib/wallet-provider";
import { useWallet } from "@/context/WalletContext";
import Mascot, { type MascotPose } from "@/components/Mascot";
import { buildUpdateMessage, imageFingerprint } from "@/lib/market-update";
import { readSquareLogoFile } from "@/lib/logo-upload";
import { ACCEPT_ATTR, LOGO_PX, MAX_UPLOAD_MB } from "@/lib/logo-image";
import { SHARE_CARD_VERSION } from "@/lib/share-card-format";

/**
 * Tindakan pemilik pasar: bagikan, sunting keterangan, ganti gambar.
 *
 * KENAPA "share" ADA DI SINI DAN TERBUKA UNTUK SIAPA SAJA
 *
 * Membagikan pasar bukan tindakan pemilik — siapa pun boleh menautkan halaman publik. Jadi
 * tombol Share selalu tampil, sementara Edit dan Change picture HANYA muncul bagi dompet yang
 * meluncurkan pasar itu. Menyembunyikan Share di balik kepemilikan akan membuat pengunjung
 * biasa tidak punya cara membagikan halaman yang memang untuk dibagikan.
 *
 * Penyembunyian tombol BUKAN kontrol akses, dan tidak diperlakukan begitu: `/api/market/update`
 * memverifikasi tanda tangan terhadap `creator` di registry. Komponen ini hanya menghindari
 * menawarkan tombol yang pasti ditolak.
 */

const PRESETS: MascotPose[] = [
  "front",
  "threequarter",
  "idle",
  "wave",
  "point",
  "think",
  "celebrate",
  "run",
  "jump",
  "sit",
];

type Links = { website: string | null; github: string | null; x: string | null; docs: string | null };

export default function MarketOwnerActions({
  symbol,
  chainId,
  creator,
  description,
  links,
  image,
}: {
  symbol: string;
  chainId: number;
  /** Alamat yang meluncurkan pasar ini, dari registry. */
  creator: string;
  description: string | null;
  links: Links;
  image: string;
}) {
  const { address, isConnected } = useWallet();
  const isOwner = isConnected && Boolean(address) && address!.toLowerCase() === creator.toLowerCase();

  const [shareOpen, setShareOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [picOpen, setPicOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);

  // Form sunting. Diisi dari nilai tersimpan, bukan kosong: dialog sunting yang mulai kosong
  // membuat "simpan" berarti "hapus semuanya" bagi siapa pun yang hanya ingin mengubah satu baris.
  const [form, setForm] = useState({
    description: description ?? "",
    website: links.website ?? "",
    github: links.github ?? "",
    x: links.x ? `@${links.x}` : "",
    docs: links.docs ?? "",
  });
  const [nextImage, setNextImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!shareOpen) return;
    const onDown = (e: MouseEvent) => {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) setShareOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setShareOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [shareOpen]);

  const url = typeof window === "undefined" ? "" : window.location.href.split("#")[0];
  const shareText = `$${symbol} on ADEXTO`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("The browser refused clipboard access.");
    }
  };

  /**
   * Tanda tangani lalu simpan.
   *
   * Pesannya dibangun `buildUpdateMessage` dari `lib/`, yaitu fungsi yang SAMA dengan yang
   * dipakai server untuk memverifikasi — lihat catatan di berkas itu soal kenapa tidak boleh
   * ada dua penyusun string.
   */
  const save = async (imageOverride?: string | null) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const ethereum = getActiveEip1193();
      if (!ethereum) throw new Error("No wallet available.");
      const image = imageOverride === undefined ? nextImage : imageOverride;
      const issuedAt = new Date().toISOString();
      const payload = {
        chainId,
        symbol,
        description: form.description,
        website: form.website,
        github: form.github,
        x: form.x,
        docs: form.docs,
      };
      const message = buildUpdateMessage({
        ...payload,
        imageFingerprint: imageFingerprint(image),
        issuedAt,
      });
      const signature = (await ethereum.request({
        method: "personal_sign",
        params: [message, address],
      })) as string;

      const res = await fetch("/api/market/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, image, issuedAt, signature }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `update failed (${res.status})`);

      setSaved(true);
      setEditOpen(false);
      setPicOpen(false);
      // Halaman dirender server dari registry, jadi nilai baru hanya muncul setelah dibaca
      // ulang. `reload` dipilih daripada menyalin state ke komponen ini: satu sumber
      // kebenaran, dan tidak ada versi layar yang bisa berbeda dari yang tersimpan.
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/denied|rejected/i.test(msg) ? "You dismissed the signature request." : msg);
    } finally {
      setBusy(false);
    }
  };

  const btn =
    "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[11px] font-medium text-ink transition-colors hover:border-accent/40 hover:text-accent";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div ref={shareRef} className="relative">
        <button type="button" onClick={() => setShareOpen((v) => !v)} aria-expanded={shareOpen} className={btn}>
          <Share2 className="h-3 w-3" /> share
        </button>
        {shareOpen && (
          <div
            role="menu"
            className="absolute left-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-panel)]"
          >
            {[
              ["X", `https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(url)}`],
              ["Telegram", `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(shareText)}`],
              ["WhatsApp", `https://wa.me/?text=${encodeURIComponent(`${shareText} ${url}`)}`],
              ["Reddit", `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(shareText)}`],
            ].map(([label, href]) => (
              <a
                key={label}
                role="menuitem"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg px-2.5 py-1.5 text-[12px] text-ink-soft transition-colors hover:bg-cream-3 hover:text-ink"
              >
                {label}
              </a>
            ))}
            {/* Kartu gambar 1200x630 yang dirender server dari data registry yang sama
                dengan halaman ini, jadi harga di kartu tidak bisa berbeda dari harga di
                layar. Dibuka di tab baru alih-alih dipaksa unduh: peramban seluler sering
                mengabaikan `download` untuk lintas-rute, dan gambar yang terbuka tetap bisa
                disimpan lewat tekan-tahan. */}
            <a
              role="menuitem"
              href={`/api/share-card/${encodeURIComponent(symbol.toLowerCase())}?chain=${chainId}&v=${SHARE_CARD_VERSION}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg border-t border-line px-2.5 py-1.5 text-[12px] text-ink-soft transition-colors hover:bg-cream-3 hover:text-ink"
            >
              <ImageIcon className="h-3 w-3" /> market card
            </a>
            {/* Kartu posisi hanya ditawarkan saat ada dompet tersambung, karena servernya
                MEMBACA saldo alamat itu dari chain — tanpa alamat tidak ada yang bisa dibaca.
                Alamatnya ada di URL (server perlu tahu saldo siapa) tetapi TIDAK digambar di
                kartunya; alasannya di route-nya. Kalau saldonya nol, route menjawab 404 alih-alih
                menggambar "saya memegang 0". */}
            {isConnected && address && (
              <a
                role="menuitem"
                href={`/api/share-card/${encodeURIComponent(symbol.toLowerCase())}/position?chain=${chainId}&holder=${address}&v=${SHARE_CARD_VERSION}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-ink-soft transition-colors hover:bg-cream-3 hover:text-ink"
              >
                <Wallet className="h-3 w-3" /> my position card
              </a>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={copyLink}
              className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-ink-soft transition-colors hover:bg-cream-3 hover:text-ink"
            >
              {copied ? <Check className="h-3 w-3 text-ok" /> : <Copy className="h-3 w-3" />}
              {copied ? "copied" : "copy link"}
            </button>
          </div>
        )}
      </div>

      {isOwner && (
        <>
          <button type="button" onClick={() => setEditOpen(true)} className={btn}>
            <Pencil className="h-3 w-3" /> edit details
          </button>
          <button type="button" onClick={() => setPicOpen(true)} className={btn}>
            <ImagePlus className="h-3 w-3" /> change picture
          </button>
          <span className="text-[10px] text-ink-faint">you launched this</span>
        </>
      )}

      {saved && (
        <span className="inline-flex items-center gap-1 text-[11px] text-ok">
          <Check className="h-3 w-3" /> saved
        </span>
      )}
      {error && (
        <span className="inline-flex items-start gap-1 text-[11px] text-danger">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {error}
        </span>
      )}

      {/* ── sunting keterangan ─────────────────────────────────────────────── */}
      {editOpen && (
        <Dialog title="Edit details" onClose={() => setEditOpen(false)}>
          <label className="block text-[10px] uppercase tracking-wider text-ink-faint">One-line pitch</label>
          <div className="relative">
            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value.slice(0, 160) }))}
              placeholder="What is this market for?"
              className="mt-1 w-full rounded-lg border border-line bg-cream-2 px-2.5 py-2 pr-14 text-xs text-ink focus:border-accent/40 focus:outline-none"
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 mt-0.5 -translate-y-1/2 text-[10px] text-ink-faint" data-numeric>
              {form.description.length}/160
            </span>
          </div>

          {(
            [
              ["x", "X / Twitter", "@yourhandle"],
              ["website", "Website", "https://yourproject.xyz"],
              ["github", "GitHub", "https://github.com/you/repo"],
              ["docs", "Docs", "https://docs.yourproject.xyz"],
            ] as const
          ).map(([key, label, placeholder]) => (
            <div key={key} className="mt-2.5">
              <label className="block text-[10px] uppercase tracking-wider text-ink-faint">{label}</label>
              <input
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                placeholder={placeholder}
                className="mt-1 w-full rounded-lg border border-line bg-cream-2 px-2.5 py-2 text-xs text-ink focus:border-accent/40 focus:outline-none"
              />
            </div>
          ))}

          <p className="mt-3 text-[10px] leading-relaxed text-ink-faint">
            Only <code className="text-accent">http</code> and <code className="text-accent">https</code> links are
            stored, and the X field keeps the handle. Your wallet will ask you to sign the exact text of this change —
            it cannot move funds or change fees.
          </p>

          <button
            type="button"
            onClick={() => save(null)}
            disabled={busy}
            className="btn-glow mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[13px] font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
          >
            {busy ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Waiting for signature…
              </>
            ) : (
              "Sign and save"
            )}
          </button>
        </Dialog>
      )}

      {/* ── ganti gambar ───────────────────────────────────────────────────── */}
      {picOpen && (
        <Dialog title="Change picture" onClose={() => setPicOpen(false)}>
          <div className="flex items-center gap-3">
            <img
              src={nextImage ?? image}
              alt=""
              aria-hidden="true"
              className="h-12 w-12 rounded-xl border border-line object-contain p-1"
            />
            <p className="text-[11px] leading-relaxed text-ink-soft">
              Pick an ADEXTO robot below. It is stored as a path on this site, so it costs the registry nothing.
            </p>
          </div>

          <ul className="mt-3 grid grid-cols-5 gap-1.5">
            {PRESETS.map((pose) => {
              const src = `/mascot/${pose}.webp`;
              const active = (nextImage ?? image) === src;
              return (
                <li key={pose}>
                  <button
                    type="button"
                    onClick={() => setNextImage(src)}
                    aria-pressed={active}
                    title={`ADEXTO robot · ${pose}`}
                    className={`flex aspect-square w-full items-center justify-center rounded-lg border p-1 transition-colors ${
                      active ? "border-accent/60 bg-cream-3" : "border-line bg-surface hover:border-accent/40"
                    }`}
                  >
                    <Mascot pose={pose} className="h-full w-auto" />
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Unggahan sendiri. Aturannya BUKAN salinan dari studio: keduanya memanggil
              `readSquareLogoFile`, jadi batas ukuran, syarat persegi, dan kalimat galatnya
              tidak bisa berbeda antar-halaman. */}
          <div className="mt-3 border-t border-line pt-3">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT_ATTR}
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (fileRef.current) fileRef.current.value = "";
                if (!file) return;
                setError(null);
                setReading(true);
                try {
                  const result = await readSquareLogoFile(file);
                  if (!result.ok) {
                    setError(result.reason);
                    return;
                  }
                  setNextImage(result.value);
                } finally {
                  setReading(false);
                }
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={reading}
              className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-cream-2 text-[12px] font-semibold text-ink transition-colors hover:border-accent/40 disabled:opacity-50"
            >
              {reading ? (
                <>
                  <RefreshCw className="h-3 w-3 animate-spin" /> Reading…
                </>
              ) : (
                <>
                  <ImagePlus className="h-3 w-3" /> Upload your own
                </>
              )}
            </button>
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-faint">
              PNG, JPEG or WebP · <strong className="text-ink-soft">square</strong> · max{" "}
              <strong className="text-ink-soft">{MAX_UPLOAD_MB} MB</strong>. Resized to {LOGO_PX}×{LOGO_PX} and stored
              with the market.
            </p>
          </div>

          <button
            type="button"
            onClick={() => save()}
            disabled={busy || !nextImage}
            className="btn-glow mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[13px] font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
          >
            {busy ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Waiting for signature…
              </>
            ) : (
              "Sign and save"
            )}
          </button>
        </Dialog>
      )}
    </div>
  );
}

/** Dialog kecil. Escape menutup, klik latar menutup, fokus tidak dijebak — tidak ada yang
 *  destruktif di dalamnya sehingga menahan fokus justru lebih mengganggu daripada membantu. */
function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  /**
   * Escape dipasang di `document` dengan CAPTURE, bukan di `window` tanpa capture.
   *
   * Versi pertama memakai `window` fase bubble dan terukur tidak bekerja: dengan fokus di
   * dalam dialog, tekanan tombolnya tidak pernah sampai. Fase capture berjalan sebelum
   * penanganan apa pun di dalam pohon, jadi ia tidak bisa dihentikan oleh input atau
   * pustaka lain di halaman ini.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16 backdrop-blur-sm">
      <div
        aria-hidden="true"
        className="absolute inset-0"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-sm rounded-card border border-line bg-surface p-4 shadow-[var(--shadow-panel)]"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-[17px] font-medium text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-ink-faint transition-colors hover:bg-cream-3 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
