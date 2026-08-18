"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CHAINS, CHAIN_LIST, DEFAULT_CHAIN, chainFromId, type ChainInfo, type ChainKey } from "@/lib/chains";
import { ensureWalletChain } from "@/lib/dex";
import {
  getActiveEip1193,
  getActiveWalletInfo,
  onWalletsChanged,
  requestAccountChange,
  setActiveWallet,
  startWalletDiscovery,
  wallets as discoveredWallets,
  type DiscoveredWallet,
  type WalletInfo,
} from "@/lib/wallet-provider";

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
});

/**
 * Provider aktif menurut `wallet-provider`. Dulu fungsi ini membaca
 * `window.ethereum` langsung, sehingga tidak mungkin memilih wallet.
 */
function injected(): any | null {
  return getActiveEip1193();
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [selectedChain, setSelectedChainState] = useState<ChainKey>(DEFAULT_CHAIN.key);
  const [isConnecting, setIsConnecting] = useState(false);
  const [availableWallets, setAvailableWallets] = useState<DiscoveredWallet[]>([]);
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
    const ethereum = injected();
    if (!ethereum) {
      alert("No Web3 wallet detected. Install MetaMask, Rabby or Coinbase Wallet to continue.");
      return;
    }
    setIsConnecting(true);
    try {
      const accounts: string[] = await ethereum.request({ method: "eth_requestAccounts" });
      const hexChainId: string = await ethereum.request({ method: "eth_chainId" });
      const id = parseInt(hexChainId, 16);

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

  const disconnectWallet = useCallback(() => {
    setAddress(null);
    setWalletChainId(null);
    localStorage.removeItem("adexto_wallet_address");
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
    ]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export const useWallet = () => useContext(WalletContext);
export { CHAIN_LIST };
