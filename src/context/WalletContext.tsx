"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CHAINS, CHAIN_LIST, DEFAULT_CHAIN, chainFromId, type ChainInfo, type ChainKey } from "@/lib/chains";
import { ensureWalletChain } from "@/lib/dex";
import {
  getActiveEip1193,
  getActiveWalletInfo,
  onWalletsChanged,
  requestAccountChange,
  registerExternalWallet,
  setActiveWallet,
  startWalletDiscovery,
  unregisterExternalWallet,
  wallets as discoveredWallets,
  type DiscoveredWallet,
  type WalletInfo,
} from "@/lib/wallet-provider";
import {
  WALLETCONNECT_RDNS,
  connectWalletConnect,
  disconnectWalletConnect,
  restoreWalletConnect,
  walletConnectConfigured,
  walletConnectWasUsed,
} from "@/lib/walletconnect";

/**
 * Wallet state.
 *
 * The previous version seeded `chainId` with 16661 whether or not a wallet was
 * connected, so consumers could not tell which network the wallet was actually on
 * — which is how a wallet sitting on 0G ended up sending native value to an
 * Arbitrum contract address. `walletChainId` is now null until it has been read
 * from the provider, and `isOnChain` / `switchToChain` are exposed so trade paths
 * can gate on the real value.
 */

export type SupportedChainKey = ChainKey;

export const CHAIN_CONFIGS: Record<ChainKey, ChainInfo> = CHAINS;

interface WalletContextType {
  address: string | null;
  /** Chain the wallet actually reports, or null when unknown/disconnected. */
  walletChainId: number | null;
  /** Chain the user selected in the UI. */
  selectedChain: ChainKey;
  chainInfo: ChainInfo;
  /** Kept for existing consumers: selected chain's id. */
  chainId: number;
  chainName: string;
  isConnected: boolean;
  isConnecting: boolean;
  /** Menerima rdns supaya user bisa memilih wallet saat ada beberapa terpasang. */
  connectWallet: (rdns?: string) => Promise<void>;
  disconnectWallet: () => void;
  setSelectedChain: (chain: ChainKey) => Promise<void>;
  switchToChain: (chain: ChainInfo) => Promise<void>;
  isOnChain: (chainId: number) => boolean;
  /** Semua wallet yang mengumumkan diri lewat EIP-6963. */
  availableWallets: DiscoveredWallet[];
  /** Wallet yang sedang dipakai, null bila memakai `window.ethereum` legacy. */
  activeWallet: WalletInfo | null;
  /** Pindah ke wallet lain yang terpasang, lalu minta izin akunnya. */
  switchWallet: (rdns: string) => Promise<void>;
  /** Membuka pemilih akun milik wallet (ganti akun tanpa ganti wallet). */
  changeAccount: () => Promise<void>;
  /**
   * True bila ada tombol Connect di halaman yang meminta pemilih wallet dibuka.
   *
   * KENAPA INI ADA, dan bug yang ditutupnya:
   *
   * `getActiveEip1193()` sengaja mengembalikan null ketika beberapa wallet terdeteksi tetapi
   * belum ada yang dipilih — supaya aplikasi tidak diam-diam memakai pemenang lomba injeksi.
   * Yang terlewat: hanya WalletMenu di navbar yang tahu cara MENANYAKAN. Lima tombol Connect
   * lain (swap, terminal token, studio ×3, agent compute) memanggil `connectWallet()` tanpa
   * rdns, jatuh ke cabang "tidak ada provider", dan menampilkan alert **"No Web3 wallet
   * detected. Install MetaMask…"** kepada orang yang memasang DUA wallet.
   *
   * Diukur sebelum perbaikan: dengan MetaMask + Phantom terpasang, keempat halaman itu
   * menolak menyambung dan `eth_requestAccounts` tidak pernah dipanggil sekali pun.
   *
   * Jadi flag ini membuat satu pemilih yang sudah ada — di navbar, hadir di setiap halaman —
   * menjadi jawaban untuk semua tombol Connect, alih-alih menambah pemilih di lima tempat.
   */
  walletPickerOpen: boolean;
  setWalletPickerOpen: (open: boolean) => void;
  /**
   * True bila WalletConnect tersedia, yaitu bila project id Reown terpasang.
   *
   * Dibedakan dari "ada wallet" karena ia satu-satunya jalur yang tidak menuntut wallet menyuntik
   * diri ke halaman — dan karena itu satu-satunya jalur bagi pengguna ponsel yang membuka situs ini
   * di Chrome atau Safari biasa.
   */
  walletConnectReady: boolean;
  /** Membuka QR WalletConnect (desktop) atau deep link ke aplikasi wallet (ponsel). */
  connectViaWalletConnect: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType>({
  address: null,
  walletChainId: null,
  selectedChain: DEFAULT_CHAIN.key,
  chainInfo: DEFAULT_CHAIN,
  chainId: DEFAULT_CHAIN.chainId,
  chainName: DEFAULT_CHAIN.name,
  isConnected: false,
  isConnecting: false,
  connectWallet: async () => {},
  disconnectWallet: () => {},
  setSelectedChain: async () => {},
  switchToChain: async () => {},
  isOnChain: () => false,
  availableWallets: [],
  activeWallet: null,
  switchWallet: async () => {},
  changeAccount: async () => {},
  walletPickerOpen: false,
  setWalletPickerOpen: () => {},
  walletConnectReady: false,
  connectViaWalletConnect: async () => {},
});

/**
 * Provider aktif menurut `wallet-provider`. Dulu fungsi ini membaca
 * `window.ethereum` langsung, sehingga tidak mungkin memilih wallet.
 */
function injected(): any | null {
  return getActiveEip1193();
}

/**
 * Niat pengguna untuk MEMUTUS, disimpan karena tidak ada tempat lain yang menyimpannya.
 *
 * "Disconnect" di sebuah dapp tidak mencabut izin di ekstensi — MetaMask tetap menganggap situs ini
 * tersambung, jadi `eth_accounts` TERUS mengembalikan alamatnya. Tanpa penanda ini, efek pemulihan
 * membaca alamat itu dan menyambungkan ulang, sehingga tombol Disconnect tidak pernah benar-benar
 * memutus apa pun.
 *
 * Dan bukan hanya saat reload. `disconnectWallet()` memanggil `setActiveWallet(null)`, yang mengubah
 * `activeWallet?.rdns` — salah satu dependensi efek pemulihan. Jadi efeknya langsung jalan ulang dan
 * menyambungkan kembali. Terukur: tersambung lagi **dalam 1 detik, tanpa reload**. Itu gejala
 * "connect terus" yang dilaporkan.
 */
const DISCONNECTED_KEY = "adexto_wallet_disconnected";

function userDisconnected(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(DISCONNECTED_KEY) === "1";
  } catch {
    return false;
  }
}

function markDisconnected() {
  try {
    localStorage.setItem(DISCONNECTED_KEY, "1");
  } catch {
    // Mode privat bisa menolak. Keadaan dalam memori tetap terputus untuk tab ini.
  }
}

function clearDisconnected() {
  try {
    localStorage.removeItem(DISCONNECTED_KEY);
  } catch {
    // tidak ada yang rusak karenanya
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [selectedChain, setSelectedChainState] = useState<ChainKey>(DEFAULT_CHAIN.key);
  const [isConnecting, setIsConnecting] = useState(false);
  const [availableWallets, setAvailableWallets] = useState<DiscoveredWallet[]>([]);
  const [walletPickerOpen, setWalletPickerOpen] = useState(false);
  const [activeWallet, setActiveWalletInfo] = useState<WalletInfo | null>(null);

  const chainInfo = CHAINS[selectedChain] ?? DEFAULT_CHAIN;

  // Penemuan wallet harus jalan sebelum apa pun mencoba memakai provider.
  useEffect(() => {
    startWalletDiscovery();
    setAvailableWallets(discoveredWallets());
    setActiveWalletInfo(getActiveWalletInfo());
    const off = onWalletsChanged((list) => {
      setAvailableWallets(list);
      setActiveWalletInfo(getActiveWalletInfo());
    });
    return off;
  }, []);

  useEffect(() => {
    const savedChain = localStorage.getItem("adexto_selected_chain") as ChainKey | null;
    if (savedChain && CHAINS[savedChain]) setSelectedChainState(savedChain);

    /**
     * Niat pengguna menang atas izin yang masih hidup di ekstensi.
     *
     * Tanpa penjaga ini, alamat yang masih dikembalikan `eth_accounts` akan menyambungkan ulang
     * orang yang baru saja menekan Disconnect — baik saat reload maupun saat efek ini jalan ulang
     * karena `setActiveWallet(null)` mengubah dependensinya.
     *
     * Pendengar `accountsChanged`/`chainChanged` juga tidak dipasang di sini, dan itu disengaja:
     * dalam keadaan terputus, pergantian akun di ekstensi tidak boleh menarik pengguna kembali
     * tersambung tanpa ia meminta.
     */
    if (userDisconnected()) return;

    const ethereum = injected();
    if (!ethereum) return;

    // Only restore the address if the wallet still authorises this origin, so a
    // stale localStorage entry can never make the UI look connected.
    ethereum
      .request({ method: "eth_accounts" })
      .then((accounts: string[]) => {
        if (accounts?.length > 0) setAddress(accounts[0]);
        else localStorage.removeItem("adexto_wallet_address");
      })
      .catch(() => {});

    ethereum
      .request({ method: "eth_chainId" })
      .then((hex: string) => {
        const id = parseInt(hex, 16);
        setWalletChainId(id);
        const known = chainFromId(id);
        if (known && !savedChain) setSelectedChainState(known.key);
      })
      .catch(() => {});

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length > 0) {
        setAddress(accounts[0]);
        localStorage.setItem("adexto_wallet_address", accounts[0]);
      } else {
        setAddress(null);
        localStorage.removeItem("adexto_wallet_address");
      }
    };

    const handleChainChanged = (hexChainId: string) => {
      const id = parseInt(hexChainId, 16);
      setWalletChainId(id);
      const known = chainFromId(id);
      if (known) {
        setSelectedChainState(known.key);
        localStorage.setItem("adexto_selected_chain", known.key);
      }
    };

    ethereum.on?.("accountsChanged", handleAccountsChanged);
    ethereum.on?.("chainChanged", handleChainChanged);

    return () => {
      ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
      ethereum.removeListener?.("chainChanged", handleChainChanged);
    };
    // Penemuan EIP-6963 datang asinkron setelah mount, jadi provider aktif bisa
    // berubah. Efek ini harus dipasang ulang ke provider yang benar — kalau hanya
    // berjalan sekali, listener menempel pada wallet yang salah dan pergantian
    // akun atau chain di wallet terpilih tidak akan pernah terbaca.
  }, [activeWallet?.rdns, availableWallets.length]);

  const switchToChain = useCallback(async (target: ChainInfo) => {
    const ethereum = injected();
    if (!ethereum) throw new Error("No Web3 wallet detected. Install MetaMask, Rabby or Coinbase Wallet.");
    await ensureWalletChain(ethereum, target);
    setWalletChainId(target.chainId);
    setSelectedChainState(target.key);
    localStorage.setItem("adexto_selected_chain", target.key);
  }, []);

  const setSelectedChain = useCallback(
    async (chain: ChainKey) => {
      const target = CHAINS[chain];
      if (!target) return;
      setSelectedChainState(chain);
      localStorage.setItem("adexto_selected_chain", chain);
      if (injected() && address) {
        try {
          await switchToChain(target);
        } catch (error) {
          console.warn("[adexto] chain switch declined:", (error as Error).message);
        }
      }
    },
    [address, switchToChain]
  );

  const connectWallet = useCallback(async (rdns?: string) => {
    // Bila user menyebut wallet tertentu, jadikan aktif LEBIH DULU supaya
    // permintaan izin dan seluruh transaksi setelahnya lewat provider itu.
    if (rdns) setActiveWallet(rdns);

    /**
     * Beberapa wallet terpasang dan belum ada yang dipilih: TANYAKAN, jangan menolak.
     *
     * Dibaca dari modul, bukan dari state React, dengan sengaja: callback ini punya daftar
     * dependensi kosong, jadi membaca `availableWallets` di sini akan menangkap nilai dari
     * render pertama — yaitu array kosong, karena pengumuman EIP-6963 datang asinkron setelah
     * mount. Closure basi itu akan membuat perbaikan ini tidak pernah aktif.
     */
    /**
     * Ada yang perlu dipilih: buka pemilih, SEKALI KLIK, dari tombol Connect mana pun.
     *
     * Syaratnya menyertakan WalletConnect, bukan hanya jumlah wallet tersuntik. Tanpa itu, PC
     * dengan satu ekstensi terpasang akan langsung menyambung ke ekstensi itu dan pengguna tidak
     * pernah melihat WalletConnect sama sekali — terukur di produksi sebelum perbaikan ini.
     *
     * Ini juga jalur pengguna ponsel yang membuka adexto.xyz di Chrome atau Safari biasa, di mana
     * jumlah wallet tersuntik NOL: sebelumnya satu-satunya jawaban yang bisa kami berikan adalah
     * "pasang ekstensi", saran yang tidak mungkin dijalankan di sana.
     */
    if (!rdns && !getActiveWalletInfo() && (discoveredWallets().length > 1 || walletConnectConfigured())) {
      setWalletPickerOpen(true);
      return;
    }

    const ethereum = injected();
    if (!ethereum) {
      /**
       * Pesannya menyebut jalur PONSEL, karena situs ini tidak mendukung WalletConnect.
       *
       * Tanpa itu, pengguna ponsel yang membuka adexto.xyz di Chrome diberi tahu untuk
       * "memasang MetaMask" — saran yang tidak menyelesaikan apa pun, sebab ekstensi tidak ada
       * di peramban ponsel dan tidak ada pemasangan QR untuk dipakai. Yang benar-benar bekerja
       * hari ini adalah membuka situsnya di dalam peramban aplikasi wallet.
       */
      alert(
        "No wallet detected in this browser.\n\n" +
          "On desktop: install MetaMask, Rabby or Coinbase Wallet, then reload.\n\n" +
          "On a phone: open adexto.xyz inside your wallet app's own browser. " +
          "WalletConnect QR pairing is not supported yet."
      );
      return;
    }
    setIsConnecting(true);
    try {
      const accounts: string[] = await ethereum.request({ method: "eth_requestAccounts" });
      const hexChainId: string = await ethereum.request({ method: "eth_chainId" });
      const id = parseInt(hexChainId, 16);

      // Sambungan yang BERHASIL membatalkan niat memutus sebelumnya. Dihapus di sini, bukan di
      // awal fungsi: kalau pemilih dibuka lalu ditutup tanpa memilih, niat memutus harus tetap
      // berlaku — pengguna belum menyambung apa pun.
      clearDisconnected();

      setAddress(accounts[0]);
      setWalletChainId(id);
      localStorage.setItem("adexto_wallet_address", accounts[0]);

      const known = chainFromId(id);
      if (known) {
        setSelectedChainState(known.key);
        localStorage.setItem("adexto_selected_chain", known.key);
      }
    } catch (error: any) {
      if (error?.code !== 4001) console.error("[adexto] wallet connect failed:", error);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  /**
   * WalletConnect: buka QR (desktop) atau deep link (ponsel), lalu daftarkan providernya.
   *
   * Sesudah terdaftar, tidak ada satu pun jalur hilir yang perlu tahu bahwa wallet ini tidak
   * menyuntik diri ke halaman — `getActiveEip1193()` mengembalikannya seperti wallet lain.
   */
  const connectViaWalletConnect = useCallback(async () => {
    setIsConnecting(true);
    try {
      const { provider, accounts } = await connectWalletConnect();
      registerExternalWallet(
        { uuid: WALLETCONNECT_RDNS, rdns: WALLETCONNECT_RDNS, name: "WalletConnect", icon: "" },
        provider
      );
      clearDisconnected();
      setActiveWalletInfo(getActiveWalletInfo());
      setAddress(accounts[0]);
      localStorage.setItem("adexto_wallet_address", accounts[0]);
      try {
        const hex: string = await provider.request({ method: "eth_chainId" });
        const id = parseInt(hex, 16);
        setWalletChainId(id);
        const known = chainFromId(id);
        if (known) {
          setSelectedChainState(known.key);
          localStorage.setItem("adexto_selected_chain", known.key);
        }
      } catch {
        // Chain tidak terbaca bukan alasan menggagalkan sambungan; UI akan meminta pindah chain
        // saat transaksi pertama.
      }
    } catch (error: any) {
      // Menutup modal QR adalah pembatalan, bukan kegagalan yang perlu dilaporkan.
      const msg = String(error?.message || "");
      if (error?.code !== 4001 && !/closed|cancel|reject/i.test(msg)) {
        console.error("[adexto] WalletConnect failed:", error);
      }
    } finally {
      setIsConnecting(false);
    }
  }, []);

  /**
   * Memulihkan sesi WalletConnect saat halaman dimuat ulang.
   *
   * Dijaga penanda localStorage supaya pengunjung yang tidak pernah memakainya TIDAK pernah memuat
   * pohon paketnya. Tanpa penjaga itu, satu-satunya cara mengetahui ada sesi adalah meng-init
   * providernya, yaitu membayar bundelnya untuk semua orang.
   */
  useEffect(() => {
    // Niat memutus juga berlaku untuk sesi WalletConnect yang masih tersimpan.
    if (userDisconnected()) return;
    if (!walletConnectConfigured() || !walletConnectWasUsed()) return;
    let alive = true;
    void (async () => {
      const restored = await restoreWalletConnect();
      if (!alive || !restored) return;
      registerExternalWallet(
        { uuid: WALLETCONNECT_RDNS, rdns: WALLETCONNECT_RDNS, name: "WalletConnect", icon: "" },
        restored.provider
      );
      setActiveWalletInfo(getActiveWalletInfo());
      setAddress(restored.accounts[0]);
      try {
        const hex: string = await restored.provider.request({ method: "eth_chainId" });
        setWalletChainId(parseInt(hex, 16));
      } catch {
        // biarkan null; bukan alasan membuang sesi yang sah
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const disconnectWallet = useCallback(() => {
    /**
     * Niatnya dicatat LEBIH DULU, sebelum state apa pun berubah.
     *
     * `setActiveWallet(null)` di bawah memicu `emit()`, yang mengubah dependensi efek pemulihan
     * dan membuatnya jalan ulang pada render berikutnya. Kalau penanda ini belum ada pada saat itu,
     * efek itu membaca `eth_accounts` yang masih mengembalikan alamat dan menyambungkan ulang.
     */
    markDisconnected();

    /**
     * Izin di ekstensi dicabut kalau wallet-nya mendukung, dengan usaha terbaik.
     *
     * Ini yang membuat Disconnect berarti sesuatu di luar situs ini: tanpanya MetaMask tetap
     * mencantumkan adexto.xyz sebagai situs tersambung, dan sambungan berikutnya tidak akan
     * meminta izin lagi. Wallet yang tidak mengenal metode ini melempar, dan itu bukan kegagalan —
     * penanda lokal di atas sudah menjamin perilaku yang benar di sisi kami.
     */
    const provider = injected();
    if (provider?.request) {
      void provider
        .request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] })
        .catch(() => {});
    }

    setAddress(null);
    setWalletChainId(null);
    localStorage.removeItem("adexto_wallet_address");
    /**
     * Sesi WalletConnect diputus di KEDUA sisi.
     *
     * Hanya melupakan alamatnya akan meninggalkan pairing hidup di aplikasi wallet: pengguna
     * melihat ADEXTO masih tersambung di daftar sesinya, dan tidak ada apa pun di situs ini yang
     * bisa membersihkannya lagi.
     */
    if (getActiveWalletInfo()?.rdns === WALLETCONNECT_RDNS) {
      void disconnectWalletConnect();
      unregisterExternalWallet(WALLETCONNECT_RDNS);
    }
    // Lepaskan juga pilihan wallet, supaya "Connect" berikutnya kembali menawarkan
    // daftar wallet dan bukan diam-diam memakai yang terakhir.
    setActiveWallet(null);
    setActiveWalletInfo(null);
  }, []);

  /** Pindah ke wallet lain yang terpasang lalu minta izin akunnya. */
  const switchWallet = useCallback(
    async (rdns: string) => {
      setAddress(null);
      setWalletChainId(null);
      setActiveWallet(rdns);
      setActiveWalletInfo(getActiveWalletInfo());
      await connectWallet(rdns);
    },
    [connectWallet]
  );

  /** Buka pemilih akun wallet tanpa berganti wallet. */
  const changeAccount = useCallback(async () => {
    try {
      const accounts = await requestAccountChange();
      if (accounts?.length > 0) {
        setAddress(accounts[0]);
        localStorage.setItem("adexto_wallet_address", accounts[0]);
      } else {
        setAddress(null);
        localStorage.removeItem("adexto_wallet_address");
      }
    } catch (e: any) {
      if (e?.code !== 4001) console.warn("[adexto] account change failed:", e?.message ?? e);
    }
  }, []);

  const isOnChain = useCallback(
    (target: number) => {
      if (walletChainId === null) return false;
      if (walletChainId === target) return true;
      const a = chainFromId(walletChainId);
      const b = chainFromId(target);
      return Boolean(a && b && a.key === b.key && walletChainId === b.chainId);
    },
    [walletChainId]
  );

  const value = useMemo<WalletContextType>(
    () => ({
      address,
      walletChainId,
      selectedChain,
      chainInfo,
      chainId: chainInfo.chainId,
      chainName: chainInfo.name,
      isConnected: Boolean(address),
      isConnecting,
      connectWallet,
      disconnectWallet,
      setSelectedChain,
      switchToChain,
      isOnChain,
      availableWallets,
      activeWallet,
      switchWallet,
      changeAccount,
      walletPickerOpen,
      setWalletPickerOpen,
      walletConnectReady: walletConnectConfigured(),
      connectViaWalletConnect,
    }),
    [
      address,
      walletChainId,
      selectedChain,
      chainInfo,
      isConnecting,
      connectWallet,
      disconnectWallet,
      setSelectedChain,
      switchToChain,
      isOnChain,
      availableWallets,
      activeWallet,
      switchWallet,
      changeAccount,
      walletPickerOpen,
      connectViaWalletConnect,
    ]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export const useWallet = () => useContext(WalletContext);
export { CHAIN_LIST };
