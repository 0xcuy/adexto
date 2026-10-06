/**
 * Membuka lembar Launch tab bar ponsel (Studio / Agent) dari tempat lain, mis. pintu "Launch" di landing
 * (owner 6 Okt: "samakan dengan launch bawah roket, ada ke agent").
 *
 * `MobileTabBar` mendengarkan event ini dan memegang satu-satunya lembar, jadi isinya tidak pernah berbeda dari
 * tab Launch. `opener` menerima fokus lagi saat lembar ditutup dengan Esc.
 *
 * Lembar hanya dirender di bawah lg (tab bar `lg:hidden`). Pemanggil memeriksa `launchSheetAvailable()` dulu dan
 * membiarkan tautannya berjalan kalau tidak: di desktop "Launch" tetap langsung ke /studio, sama dengan bagian kiri
 * tombol Launch di header, yang ▾-nya membuka pilihan Agent.
 */
export const LAUNCH_SHEET_EVENT = "adexto:open-launch-sheet";
export const LAUNCH_SHEET_ID = "mobile-launch-sheet";

export interface LaunchSheetDetail {
  opener: HTMLElement | null;
}

/** True bila lembar Launch sedang bisa tampil (tab bar dirender, yaitu di bawah lg). */
export function launchSheetAvailable(): boolean {
  if (typeof document === "undefined") return false;
  const sheet = document.getElementById(LAUNCH_SHEET_ID);
  return Boolean(sheet) && getComputedStyle(sheet as HTMLElement).display !== "none";
}

export function openLaunchSheet(opener: HTMLElement | null = null): void {
  window.dispatchEvent(new CustomEvent<LaunchSheetDetail>(LAUNCH_SHEET_EVENT, { detail: { opener } }));
}
