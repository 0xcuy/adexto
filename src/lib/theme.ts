/**
 * Tema tampilan: gelap bawaan, terang opsional.
 *
 * Sumber kebenarannya atribut `data-theme` di <html>. Server selalu merender "dark";
 * `THEME_BOOT_SCRIPT` berjalan di <head> SEBELUM paint dan menggantinya bila pengguna
 * pernah memilih terang, jadi tidak ada kedipan tema yang salah dan tidak ada
 * perbedaan hidrasi di dalam <body>.
 *
 * Pilihan disimpan di localStorage hanya bila penyimpanan preferensi diizinkan
 * (lihat CookieConsent). Kuncinya ikut dihapus saat pengguna memilih "Essential only".
 */

export type Theme = "dark" | "light";

export const THEME_KEY = "adexto_theme";
export const DEFAULT_THEME: Theme = "dark";

/** Warna bilah browser mobile per tema — sama dengan --cream masing-masing. */
export const THEME_COLOR: Record<Theme, string> = {
  dark: "#0d0b12",
  light: "#f4efe4",
};

/**
 * Skrip inline untuk <head>. Sengaja kecil dan tanpa dependensi: ia berjalan sebelum
 * bundle apa pun dimuat. try/catch karena mode privat bisa melempar saat localStorage
 * disentuh — dalam kasus itu tema bawaan dipakai.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_KEY
)});if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="light"?${JSON.stringify(
  THEME_COLOR.light
)}:${JSON.stringify(THEME_COLOR.dark)});}}catch(e){}})();`;

export function readTheme(): Theme {
  if (typeof document === "undefined") return DEFAULT_THEME;
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

/** Nama event supaya chart (dan komponen lain yang menggambar ke canvas) bisa ikut. */
export const THEME_EVENT = "adexto:theme";

export function applyTheme(theme: Theme, persist: boolean) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
  if (persist) {
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Tanpa penyimpanan, pilihan tetap berlaku sampai halaman dimuat ulang.
    }
  }
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: theme }));
}
