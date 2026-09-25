/**
 * WalletConnect lewat Reown, untuk pengguna yang wallet-nya TIDAK menyuntik diri ke halaman.
 *
 * MASALAH YANG DITUTUPNYA
 *
 * Seluruh penemuan wallet kita bergantung pada wallet yang menyuntik provider ke halaman —
 * EIP-6963, `window.okxwallet`, `window.ethereum`. Itu menutup ekstensi desktop dan peramban di
 * dalam aplikasi wallet, tetapi TIDAK menutup kasus yang paling umum di ponsel: seseorang membuka
 * adexto.xyz di Chrome atau Safari biasa. Di sana tidak ada ekstensi untuk dipasang dan tidak ada
 * yang menyuntik apa pun, jadi sebelum ini orang itu benar-benar tidak punya jalan masuk.
 *
 * WalletConnect menyelesaikannya lewat relay: halaman menampilkan QR (di desktop) atau membuka
 * aplikasi wallet lewat deep link (di ponsel), dan tanda tangan berjalan di aplikasi wallet.
 *
 * KENAPA `@walletconnect/ethereum-provider` DAN BUKAN AppKit LENGKAP
 *
 * Paket ini SUDAH memakai `@reown/appkit` di dalamnya, jadi modal QR-nya tetap milik Reown. Yang
 * berbeda adalah permukaan yang kita pakai: ia mengembalikan provider EIP-1193 biasa, dan seluruh
 * aplikasi ini sudah berbicara EIP-1193 lewat `getActiveEip1193()`. Jadi ia masuk sebagai satu
 * wallet tambahan tanpa menyentuh arsitektur.
 *
 * AppKit lengkap membawa wagmi dan viem beserta pohon provider React-nya sendiri, plus hook dan
 * store yang akan berdampingan dengan `WalletContext` dan pemilih wallet yang sudah ada — dua
 * sumber kebenaran untuk pertanyaan "wallet mana yang aktif". Itu bukan penambahan, itu
 * penggantian, dan bukan yang diminta.
 *
 * DIMUAT MALAS, dan itu wajib. Pohon paketnya besar; mengimpornya di tingkat modul akan
 * memasukkannya ke bundel setiap pengunjung, termasuk yang memakai ekstensi dan tidak akan pernah
 * menyentuh QR. `await import(...)` hanya berjalan saat seseorang benar-benar memilihnya.
 */
import { CHAIN_LIST } from "@/lib/chains";

/**
 * Project id dari https://dashboard.reown.com/.
 *
 * KOSONG ADALAH KEADAAN YANG SAH: tanpa id, relay Reown menolak setiap sambungan, jadi menampilkan
 * tombolnya hanya akan menawarkan sesuatu yang pasti gagal. Fitur ini mati total sampai id-nya ada,
 * dan UI tidak menyebutnya sama sekali dalam keadaan itu.
 */
const PROJECT_ID = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID || "";

/**
 * Penanda bahwa sesi WalletConnect pernah dibuat di peramban ini.
 *
 * Dipakai supaya pemulihan sesi tidak menuntut pemuatan pohon paketnya untuk SETIAP pengunjung.
 * WalletConnect menyimpan sesinya sendiri di localStorage, tetapi satu-satunya cara mengetahuinya
 * adalah dengan meng-init providernya — yaitu memuat bundelnya. Penanda ringan ini menjawab
 * "perlu dimuat atau tidak" tanpa memuat apa pun.
 */
const MARKER = "adexto_wc_session";

export const WALLETCONNECT_RDNS = "walletconnect";

export function walletConnectConfigured(): boolean {
  return Boolean(PROJECT_ID);
}

export function walletConnectWasUsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(MARKER) === "1";
  } catch {
    return false;
  }
}

let provider: any = null;
let initPromise: Promise<any> | null = null;

/** Init sekali per tab. Menjaga satu instance supaya tidak ada dua sesi relay bersaing. */
async function init(): Promise<any> {
  if (provider) return provider;
  if (!initPromise) {
    initPromise = (async () => {
      const mod = await import("@walletconnect/ethereum-provider");
      const EthereumProvider = (mod as any).default ?? (mod as any).EthereumProvider;

      /**
       * `optionalChains`, BUKAN `chains`.
       *
       * Dokumentasi Reown menganjurkannya untuk dapp multi-chain: chain yang ditaruh di `chains`
       * bersifat WAJIB, jadi wallet yang tidak mendukung salah satunya akan menolak menyambung
       * sama sekali. ADEXTO hidup di empat chain dan 0G bukan chain yang dikenal semua wallet
       * ponsel, jadi menaruhnya di `chains` akan memutus sambungan bagi wallet yang sebenarnya
       * bisa dipakai di tiga chain lainnya.
       */
      const optionalChains = CHAIN_LIST.map((c) => c.chainId);
      const rpcMap: Record<number, string> = {};
      for (const c of CHAIN_LIST) rpcMap[c.chainId] = c.rpcUrl;

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://adexto.xyz";

      provider = await EthereumProvider.init({
        projectId: PROJECT_ID,
        optionalChains,
        rpcMap,
        showQrModal: true,
        /**
         * `url` harus benar-benar domain situsnya: Verify API Reown memakainya untuk memberi tahu
         * pengguna apakah domain yang meminta tanda tangan sudah terverifikasi. Nilai yang salah
         * membuat wallet menampilkan peringatan domain tidak cocok pada setiap permintaan.
         */
        metadata: {
          name: "ADEXTO",
          description: "Launch agent-bound ERC-20s onto their own bonding curve.",
          url: appUrl,
          icons: [`${appUrl}/logo.svg`],
        },
      });
      return provider;
    })();
  }
  return initPromise;
}

/** Membuka modal QR / deep link, lalu mengembalikan provider yang sudah tersambung. */
export async function connectWalletConnect(): Promise<{ provider: any; accounts: string[] }> {
  if (!PROJECT_ID) throw new Error("WalletConnect is not configured on this site.");
  const p = await init();
  // `enable()` membuka modal dan menunggu; ia mengembalikan akun yang disetujui.
  const accounts: string[] = await p.enable();
  if (!accounts?.length) throw new Error("No account was approved.");
  try {
    localStorage.setItem(MARKER, "1");
  } catch {
    // Mode privat bisa menolak; sesinya tetap hidup untuk tab ini.
  }
  return { provider: p, accounts };
}

/**
 * Memulihkan sesi yang sudah ada, tanpa membuka modal.
 *
 * Hanya dipanggil ketika penanda ada, jadi pengunjung yang tidak pernah memakai WalletConnect
 * tidak pernah memuat bundelnya. Mengembalikan null kalau sesinya sudah tidak sah — itu keadaan
 * normal, bukan galat: pengguna bisa memutus sambungan dari sisi aplikasi wallet.
 */
export async function restoreWalletConnect(): Promise<{ provider: any; accounts: string[] } | null> {
  if (!PROJECT_ID || !walletConnectWasUsed()) return null;
  try {
    const p = await init();
    const accounts: string[] = p.accounts ?? [];
    if (!p.session || accounts.length === 0) {
      clearMarker();
      return null;
    }
    return { provider: p, accounts };
  } catch {
    clearMarker();
    return null;
  }
}

function clearMarker() {
  try {
    localStorage.removeItem(MARKER);
  } catch {
    // tidak ada yang bisa dilakukan, dan tidak ada yang rusak karenanya
  }
}

/**
 * Memutus sesi di KEDUA sisi.
 *
 * Tanpa `provider.disconnect()`, memutus di situs hanya melupakan alamatnya sementara pairing-nya
 * tetap hidup di aplikasi wallet — pengguna melihat ADEXTO masih tersambung di daftar sesi
 * wallet-nya, dan tidak ada apa pun di situs ini yang bisa membersihkannya.
 */
export async function disconnectWalletConnect(): Promise<void> {
  clearMarker();
  if (!provider) return;
  try {
    await provider.disconnect();
  } catch {
    // Sesi bisa sudah mati di sisi wallet; hasil yang diinginkan sudah tercapai.
  }
  provider = null;
  initPromise = null;
}
