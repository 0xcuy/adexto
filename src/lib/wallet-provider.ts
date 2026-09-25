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

/**
 * Wallet yang terdeteksi: hasil EIP-6963 DITAMBAH wallet yang hanya menyuntik diri.
 *
 * EIP-6963 tetap otoritatif — ia membawa nama dan ikon resmi wallet, dan identitasnya tidak
 * bertabrakan. Lapisan suntikan hanya mengisi kekosongan, dan dua aturan dedupe menjaga daftarnya
 * tidak berisi wallet yang sama dua kali:
 *
 *   1. objek provider yang IDENTIK — OKX versi baru mengumumkan diri LEWAT 6963 sekaligus tetap
 *      mengisi `window.okxwallet`, dan keduanya biasanya objek yang sama;
 *   2. nama yang sama setelah dinormalkan — kalau objeknya ternyata berbeda, entri 6963 yang
 *      menang, karena namanya datang dari wallet itu sendiri dan bukan dari sniffing bendera.
 *
 * Diurutkan menurut nama supaya daftarnya stabil antar render.
 */
export function wallets(): DiscoveredWallet[] {
  const announced = [...discovered.values()];
  const providers = new Set(announced.map((w) => w.provider));
  const names = new Set(announced.map((w) => w.info.name.toLowerCase().replace(/\s+/g, "")));

  const extra = legacyWallets().filter((w) => {
    if (providers.has(w.provider)) return false;
    const key = w.info.name.toLowerCase().replace(/\s+/g, "");
    if (names.has(key)) return false;
    names.add(key);
    return true;
  });

  return [...announced, ...extra].sort((a, b) => a.info.name.localeCompare(b.info.name));
}

/** Sidik jari daftar wallet, dipakai untuk memutuskan apakah perlu memberi tahu pendengar. */
function fingerprint(): string {
  return wallets()
    .map((w) => w.info.rdns)
    .join("|");
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

  /**
   * Pemindaian ulang, karena wallet yang hanya MENYUNTIK tidak punya event untuk diikuti.
   *
   * Ekstensi menyuntik dirinya pada waktu yang tidak kita kendalikan, dan sebagian tiba setelah
   * React selesai mount. Untuk EIP-6963 itu tidak masalah — pengumumannya memicu `emit()`. Untuk
   * `window.okxwallet` dan kerabatnya tidak ada apa pun yang memberi tahu, jadi satu pembacaan di
   * saat mount bisa melewatkannya dan pemilih tetap kosong.
   *
   * `requestProvider` ikut dikirim ulang: wallet yang belum siap saat permintaan pertama akan
   * menjawab yang kedua. Emit hanya terjadi kalau daftarnya BERUBAH, supaya ini tidak memicu
   * render berulang tanpa sebab.
   */
  let last = fingerprint();
  const rescan = () => {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const now = fingerprint();
    if (now !== last) {
      last = now;
      emit();
    }
  };
  for (const delay of [250, 800, 2000]) setTimeout(rescan, delay);
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

/**
 * Nama wallet dari bendera pada providernya.
 *
 * `isMetaMask` DIPERIKSA PALING AKHIR, dan urutan itu bukan selera. Banyak wallet menyetel
 * `isMetaMask: true` demi kompatibilitas dengan situs yang hanya mengenal MetaMask — OKX pernah
 * begitu, begitu juga beberapa wallet lain. Memeriksanya lebih dulu akan menamai hampir semua
 * wallet "MetaMask", dan pemilih menjadi daftar berisi nama yang sama berulang kali.
 */
function nameFromFlags(p: any): string {
  if (!p || typeof p !== "object") return "Injected wallet";
  if (p.isOkxWallet || p.isOKExWallet || p.isOkxwallet) return "OKX Wallet";
  if (p.isRabby) return "Rabby";
  if (p.isCoinbaseWallet || p.isCoinbaseBrowser) return "Coinbase Wallet";
  if (p.isTrust || p.isTrustWallet) return "Trust Wallet";
  if (p.isBraveWallet) return "Brave Wallet";
  if (p.isPhantom) return "Phantom";
  if (p.isBitKeep || p.isBitget) return "Bitget Wallet";
  if (p.isTokenPocket) return "TokenPocket";
  if (p.isOneKey) return "OneKey";
  if (p.isZerion) return "Zerion";
  if (p.isExodus) return "Exodus";
  if (p.isSafePal) return "SafePal";
  if (p.isMathWallet) return "MathWallet";
  if (p.isBybit) return "Bybit Wallet";
  if (p.isFrame) return "Frame";
  if (p.isBackpack) return "Backpack";
  if (p.isMetaMask) return "MetaMask";
  return "Injected wallet";
}

/**
 * Wallet yang MENYUNTIK diri tapi belum tentu MENGUMUMKAN diri lewat EIP-6963.
 *
 * KENAPA LAPISAN INI ADA
 *
 * Penemuan kita dulu hanya EIP-6963, dan akibatnya wallet yang tidak mengumumkan diri tidak
 * pernah muncul di pemilih sama sekali. Itu dilaporkan sebagai "wallet connect tidak berfungsi"
 * oleh pengguna OKX, dan perilaku OKX memang tidak seragam antar versi: ada versi yang mengambil
 * alih `window.ethereum` (sehingga connect membuka OKX padahal user memilih wallet lain), ada
 * versi yang tidak lagi melakukannya, dan versi baru mengumumkan diri lewat EIP-6963.
 *
 * Yang lebih buruk dari tidak terlihat: kalau wallet LAIN mengumumkan diri sementara OKX tidak,
 * daftar 6963 berisi tepat satu entri, dan `getActiveEip1193()` memakainya tanpa bertanya. Jadi
 * pengguna OKX diam-diam disambungkan ke wallet yang tidak ia pilih.
 *
 * Tiga sumber dipindai, dan semuanya digabung dengan hasil 6963:
 *   1. `window.ethereum.providers` — konvensi multi-provider sebelum 6963; beberapa wallet masih
 *      mengisinya.
 *   2. global khusus per wallet (`window.okxwallet` dan kerabatnya) — satu-satunya cara melihat
 *      wallet yang tidak mengumumkan diri DAN tidak memenangkan `window.ethereum`.
 *   3. `window.ethereum` apa adanya, dinamai dari benderanya.
 */
function legacyWallets(): DiscoveredWallet[] {
  if (typeof window === "undefined") return [];
  const w = window as any;
  const out: DiscoveredWallet[] = [];
  const seen = new Set<any>();

  const push = (provider: any, name: string, rdns: string) => {
    if (!provider || typeof provider.request !== "function") return;
    if (seen.has(provider)) return;
    seen.add(provider);
    out.push({ info: { uuid: rdns, name, icon: "", rdns }, provider });
  };

  // 1. Array multi-provider gaya lama.
  const arr = w.ethereum?.providers;
  if (Array.isArray(arr)) {
    arr.forEach((p: any, i: number) => {
      const name = nameFromFlags(p);
      push(p, name, `injected:${name.toLowerCase().replace(/\s+/g, "-")}:${i}`);
    });
  }

  // 2. Global khusus per wallet.
  const probes: [any, string, string][] = [
    [w.okxwallet, "OKX Wallet", "injected:okx"],
    [w.okexchain?.request ? w.okexchain : null, "OKX Wallet", "injected:okx-legacy"],
    [w.rabby, "Rabby", "injected:rabby"],
    [w.trustwallet, "Trust Wallet", "injected:trust"],
    [w.coinbaseWalletExtension, "Coinbase Wallet", "injected:coinbase"],
    [w.phantom?.ethereum, "Phantom", "injected:phantom"],
    [w.bitkeep?.ethereum, "Bitget Wallet", "injected:bitget"],
    [w.tokenpocket?.ethereum, "TokenPocket", "injected:tokenpocket"],
    [w.bybitWallet, "Bybit Wallet", "injected:bybit"],
    [w.safepalProvider ?? w.safepal, "SafePal", "injected:safepal"],
    [w.onekey?.ethereum, "OneKey", "injected:onekey"],
    [w.zerionWallet, "Zerion", "injected:zerion"],
    [w.exodus?.ethereum, "Exodus", "injected:exodus"],
  ];
  for (const [provider, name, rdns] of probes) push(provider, name, rdns);

  // 3. `window.ethereum` apa adanya.
  const bare = legacyProvider();
  if (bare) push(bare, nameFromFlags(bare), "injected:window-ethereum");

  return out;
}

export function getActiveWallet(): DiscoveredWallet | null {
  if (!activeRdns) return null;
  // Dicari di SELURUH daftar, bukan hanya di peta EIP-6963: wallet yang ditemukan lewat lapisan
  // suntikan juga bisa dipilih pengguna, dan kalau pencarian ini tidak melihatnya, memilih OKX
  // akan tersimpan lalu diabaikan.
  return wallets().find((x) => x.info.rdns === activeRdns) ?? null;
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

/**
 * Mendaftarkan provider yang TIDAK ditemukan di halaman, lalu menjadikannya aktif.
 *
 * Dipakai WalletConnect: providernya baru ada setelah pengguna memindai QR, jadi ia tidak bisa
 * ditemukan lewat pemindaian seperti wallet yang menyuntik diri. Mendaftarkannya ke peta yang sama
 * membuat seluruh jalur hilir — `getActiveEip1193`, penandatanganan, pengiriman transaksi,
 * pergantian chain — tidak perlu tahu bedanya.
 */
export function registerExternalWallet(info: WalletInfo, provider: any): void {
  discovered.set(info.rdns, { info, provider });
  setActiveWallet(info.rdns);
  emit();
}

/** Melepas provider yang didaftarkan manual, mis. saat sesi WalletConnect diputus. */
export function unregisterExternalWallet(rdns: string): void {
  discovered.delete(rdns);
  if (activeRdns === rdns) setActiveWallet(null);
  emit();
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
