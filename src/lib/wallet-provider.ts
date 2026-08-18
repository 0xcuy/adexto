/**
 * Sumber tunggal provider wallet untuk seluruh aplikasi.
 *
 * Sebelumnya setiap jalur trading membaca `window.ethereum` langsung. Itu punya
 * dua akibat: kalau user memasang lebih dari satu wallet (MetaMask, Rabby, OKX,
 * Phantom), yang dipakai adalah pemenang lomba injeksi — user tidak bisa memilih;
 * dan andai pemilih wallet ditambahkan di UI saja, transaksi akan tetap dikirim
 * lewat provider lain sehingga pilihannya cuma kosmetik.
 *
 * Modul ini menemukan semua wallet lewat EIP-6963, menyimpan mana yang dipilih,
 * dan memberi satu titik akses (`getActiveEip1193`) yang dipakai baik oleh React
 * maupun kode non-React.
 */

export interface WalletInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface DiscoveredWallet {
  info: WalletInfo;
  provider: any;
}

const STORAGE_KEY = "adexto_wallet_rdns";

const discovered = new Map<string, DiscoveredWallet>();
const listeners = new Set<(wallets: DiscoveredWallet[]) => void>();
let activeRdns: string | null = null;
let started = false;

function emit() {
  const list = wallets();
  listeners.forEach((fn) => fn(list));
}

/** Wallet yang terdeteksi, diurutkan menurut nama agar daftarnya stabil. */
export function wallets(): DiscoveredWallet[] {
  return [...discovered.values()].sort((a, b) => a.info.name.localeCompare(b.info.name));
}

/**
 * Mulai mendengarkan pengumuman EIP-6963. Aman dipanggil berkali-kali.
 *
 * Urutannya penting: pasang listener LEBIH DULU, baru minta pengumuman. Wallet
 * mengumumkan diri sebagai balasan `eip6963:requestProvider`, jadi meminta
 * sebelum mendengarkan akan melewatkan semuanya.
 */
export function startWalletDiscovery(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  activeRdns = localStorage.getItem(STORAGE_KEY);

  window.addEventListener("eip6963:announceProvider", (event: any) => {
    const detail = event?.detail;
    if (!detail?.info?.rdns || !detail?.provider) return;
    discovered.set(detail.info.rdns, { info: detail.info, provider: detail.provider });
    emit();
  });

  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

export function onWalletsChanged(fn: (wallets: DiscoveredWallet[]) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Wallet legacy `window.ethereum`, dipakai bila tak ada yang mengumumkan diri. */
function legacyProvider(): any | null {
  if (typeof window === "undefined") return null;
  return (window as any).ethereum ?? null;
}

export function getActiveWallet(): DiscoveredWallet | null {
  if (activeRdns && discovered.has(activeRdns)) return discovered.get(activeRdns)!;
  return null;
}

export function getActiveWalletInfo(): WalletInfo | null {
  return getActiveWallet()?.info ?? null;
}

/**
 * Provider EIP-1193 yang harus dipakai untuk SEMUA tanda tangan dan pengiriman.
 *
 * Urutannya sengaja begini:
 *   1. wallet yang dipilih user — selalu menang;
 *   2. satu-satunya wallet EIP-6963 yang terdeteksi — tidak ada yang perlu dipilih;
 *   3. tidak ada wallet EIP-6963 sama sekali -> `window.ethereum`, menjaga
 *      kompatibilitas dengan wallet lama dan dengan shim yang dipakai skrip audit
 *      serta perekaman demo;
 *   4. beberapa wallet terdeteksi tapi belum dipilih -> **null**.
 *
 * Poin 4 penting. Sebelumnya kasus ini jatuh ke `window.ethereum`, yang berarti
 * aplikasi diam-diam memakai wallet pemenang lomba injeksi dan bahkan menampilkan
 * dirinya "tersambung" ke akun yang tidak pernah dipilih user — persis keluhan
 * "tidak bisa pilih wallet". Mengembalikan null memaksa UI menanyakan dulu.
 */
export function getActiveEip1193(): any | null {
  const chosen = getActiveWallet();
  if (chosen) return chosen.provider;
  const list = wallets();
  if (list.length === 1) return list[0].provider;
  if (list.length === 0) return legacyProvider();
  return null;
}

export function setActiveWallet(rdns: string | null): void {
  activeRdns = rdns;
  if (typeof window === "undefined") return;
  if (rdns) localStorage.setItem(STORAGE_KEY, rdns);
  else localStorage.removeItem(STORAGE_KEY);
  emit();
}

/** True bila ada wallet apa pun yang bisa dipakai. */
export function hasWallet(): boolean {
  return wallets().length > 0 || Boolean(legacyProvider());
}

/**
 * Membuka pemilih akun milik wallet. MetaMask dan yang sejenis menampilkan daftar
 * akun untuk `wallet_requestPermissions`, sedangkan `eth_requestAccounts` akan
 * langsung mengembalikan akun yang sudah diizinkan tanpa memberi kesempatan
 * berganti. Mengembalikan daftar akun setelah user memilih.
 */
export async function requestAccountChange(): Promise<string[]> {
  const provider = getActiveEip1193();
  if (!provider) throw new Error("No wallet available.");
  try {
    await provider.request({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {} }],
    });
  } catch (e: any) {
    // 4001 = user membatalkan; teruskan supaya UI bisa diam saja.
    if (e?.code === 4001) throw e;
    // Wallet yang tidak mendukung metode ini tetap bisa dilanjutkan ke bawah.
  }
  return (await provider.request({ method: "eth_accounts" })) as string[];
}
