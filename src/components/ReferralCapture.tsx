"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { consentAllowsPreferences } from "@/components/CookieConsent";
import { normalizeRefCode, storeRef } from "@/lib/referral-tag";

/**
 * Menangkap `?ref=<kode>` di halaman mana pun dan menyimpannya di `localStorage` (`adexto_ref`,
 * 30 hari; tautan referral baru menggantinya). Tidak merender apa pun.
 *
 * `localStorage`, bukan cookie: kodenya hanya dibaca klien saat menyusun trade, jadi server tidak
 * perlu menerimanya di setiap permintaan, dan "we set no cookies of our own" tetap benar. Ia
 * preferensi seperti kunci lain, jadi "Essential only" menghapusnya dan mencegah penulisan ulang.
 */
export default function ReferralCapture() {
  const pathname = usePathname();
  useEffect(() => {
    const code = normalizeRefCode(new URLSearchParams(window.location.search).get("ref"));
    if (code && consentAllowsPreferences()) storeRef(code);
  }, [pathname]);
  return null;
}
