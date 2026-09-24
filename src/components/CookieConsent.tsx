"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Cookie, X } from "lucide-react";

/**
 * Pemberitahuan penyimpanan lokal, dan pilihan yang benar-benar melakukan sesuatu.
 *
 * KENAPA TEKSNYA TIDAK BERBUNYI SEPERTI BANNER COOKIE BIASA
 *
 * Banner standar berbunyi "kami memakai cookie untuk analitik dan personalisasi". Diperiksa
 * di repo ini: TIDAK ADA satu pun cookie yang kami setel, dan tidak ada analitik kami
 * sendiri. Yang benar-benar ada hanya ini:
 *
 *   - dua kunci `localStorage`: `adexto_selected_chain` dan `adexto_wallet_address`
 *   - IP di MEMORI untuk pembatas laju, lewat `cf-connecting-ip`, dalam sebuah Map yang
 *     hilang begitu proses restart — tidak pernah ditulis ke disk
 *   - cookie keamanan Cloudflare (`__cf_bm` dan sejenisnya), disetel oleh jaringan di depan
 *     situs ini, bukan oleh kodenya
 *
 * Menuliskan "personalisasi dan iklan" akan menjadi pernyataan yang salah di halaman yang
 * seluruh isinya soal bisa-diperiksa. Jadi teksnya menyebut ketiga hal itu apa adanya.
 *
 * KENAPA "ESSENTIAL ONLY" MENGHAPUS SESUATU, BUKAN HANYA MENUTUP BANNER
 *
 * Tombol yang tidak melakukan apa pun lebih buruk daripada tidak ada tombol: ia meminta
 * persetujuan lalu mengabaikannya. Di sini pilihan itu punya akibat yang bisa dilihat —
 * kedua kunci preferensi dihapus saat itu juga, dan `consentAllowsPreferences()` menjawab
 * false sehingga tidak ada yang menulisnya lagi. Konsekuensi nyatanya: alamat dompet tidak
 * dipulihkan otomatis pada kunjungan berikutnya, dan pilihan chain kembali ke bawaan. Itu
 * memang arti dari menolak penyimpanan preferensi.
 */

const KEY = "adexto_cookie_consent";
/** Kunci yang dikelola pilihan ini. Keduanya preferensi, bukan kebutuhan keamanan. */
const PREFERENCE_KEYS = ["adexto_selected_chain", "adexto_wallet_address"];

type Choice = "all" | "essential";

/**
 * Dipakai kode lain sebelum menulis preferensi.
 *
 * Bawaannya `true` ketika belum ada pilihan, supaya perilaku situs tidak berubah bagi orang
 * yang belum menjawab — banner ini memberi tahu dan menawarkan pilihan, ia bukan gerbang.
 */
export function consentAllowsPreferences(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) !== "essential";
  } catch {
    return false;
  }
}

export default function CookieConsent() {
  /**
   * `null` berarti belum diketahui, bukan "belum memilih".
   *
   * Dibedakan karena banner tidak boleh muncul sekejap lalu hilang pada orang yang sudah
   * menjawab. `localStorage` hanya ada setelah hidrasi, jadi render pertama tidak
   * menggambar apa pun dan keputusannya diambil di effect.
   */
  const [show, setShow] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setShow(window.localStorage.getItem(KEY) === null);
    } catch {
      // Mode privat bisa melempar saat localStorage diakses. Tanpa tempat menyimpan
      // jawabannya, menampilkan banner pada setiap muat halaman hanya mengganggu.
      setShow(false);
    }
  }, []);

  const decide = (choice: Choice) => {
    try {
      window.localStorage.setItem(KEY, choice);
      if (choice === "essential") {
        for (const k of PREFERENCE_KEYS) window.localStorage.removeItem(k);
      }
    } catch {}
    setShow(false);
  };

  if (show !== true) return null;

  return (
    <div
      role="region"
      aria-label="Storage notice"
      className="fixed inset-x-0 bottom-0 z-[60] border-t-2 border-accent/40 bg-cream-2/95 backdrop-blur"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-6 lg:px-8">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Cookie className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-ink">What this site stores</p>
          {/* Angkanya disebut, bukan diringkas jadi "beberapa data". Dua kunci itu bisa
              diperiksa sendiri di devtools, jadi menyebutnya persis lebih kuat daripada
              kalimat umum. */}
          <p className="text-[11px] leading-relaxed text-ink-soft">
            We set no cookies of our own and run no advertising or cross-site tracking. Your browser
            keeps two preferences — your selected chain and your wallet address — and Cloudflare sets
            its own security cookies in front of this site.{" "}
            <Link href="/privacy" className="font-semibold text-accent hover:underline">
              Privacy
            </Link>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => decide("essential")}
            className="h-9 rounded-xl border border-line bg-white px-3 text-xs font-bold text-ink transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
          >
            Essential only
          </button>
          <button
            type="button"
            onClick={() => decide("all")}
            className="h-9 rounded-xl bg-accent px-4 text-xs font-bold text-white transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
          >
            Accept all
          </button>
          {/* Menutup TANPA memilih.
              Sengaja tidak menyimpan apa pun, jadi banner ini kembali pada kunjungan
              berikutnya. Menyimpan "all" di sini akan menganggap diamnya sebagai
              persetujuan, yang justru hal yang ingin dihindari. */}
          <button
            type="button"
            onClick={() => setShow(false)}
            aria-label="Close this notice without choosing"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-faint transition-colors hover:bg-cream-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
