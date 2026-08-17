"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export type SupportedChainKey = "0G" | "Base" | "Arbitrum" | "Monad";

interface ChainConfig {
  id: number;
  name: string;
  key: SupportedChainKey;
  rpcUrl: string;
  blockExplorer: string;
  status: "Live On-Chain" | "Phase 2 Mesh";
}

export const CHAIN_CONFIGS: Record<SupportedChainKey, ChainConfig> = {
  "0G": {
    id: 16661,
    name: "0G Mainnet (Primary)",
    key: "0G",
    rpcUrl: "https://evmrpc.0g.ai",
    blockExplorer: "https://chainscan.0g.ai",
    status: "Live On-Chain",
  },
  Arbitrum: {
    id: 42161,
    name: "Arbitrum One",
    key: "Arbitrum",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    blockExplorer: "https://arbiscan.io",
    status: "Live On-Chain",
  },
  Base: {
    id: 8453,
    name: "Base Mainnet",
    key: "Base",
    rpcUrl: "https://mainnet.base.org",
    blockExplorer: "https://basescan.org",
    status: "Phase 2 Mesh",
  },
  Monad: {
    id: 10143,
    name: "Monad Mainnet",
    key: "Monad",
    rpcUrl: "https://mainnet-rpc.monad.xyz",
    blockExplorer: "https://monadvision.com",
    status: "Phase 2 Mesh",
  },
};

const CHAIN_ID_TO_KEY: Record<number, SupportedChainKey> = {
  16661: "0G",
  16602: "0G",
  8453: "Base",
  84532: "Base",
  42161: "Arbitrum",
  421614: "Arbitrum",
  10143: "Monad",
};

interface WalletContextType {
  address: string | null;
  chainId: number;
  selectedChain: SupportedChainKey;
  chainName: string;
  isConnected: boolean;
  isConnecting: boolean;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  setSelectedChain: (chain: SupportedChainKey) => void;
}

const WalletContext = createContext<WalletContextType>({
  address: null,
  chainId: 16661,
  selectedChain: "0G",
  chainName: "0G Mainnet (Primary)",
  isConnected: false,
  isConnecting: false,
  connectWallet: async () => {},
  disconnectWallet: () => {},
  setSelectedChain: () => {},
});

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [selectedChain, setSelectedChainState] = useState<SupportedChainKey>("0G");
  const [chainId, setChainId] = useState<number>(16661);
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    const savedAddr = localStorage.getItem("adexto_wallet_address");
    const savedChain = localStorage.getItem("adexto_selected_chain") as SupportedChainKey;

    if (savedAddr) {
      setAddress(savedAddr);
    }
    if (savedChain && CHAIN_CONFIGS[savedChain]) {
      setSelectedChainState(savedChain);
      setChainId(CHAIN_CONFIGS[savedChain].id);
    }

    // Listen to real window.ethereum changes if available
    if (typeof window !== "undefined" && (window as any).ethereum) {
      const handleAccountsChanged = (accounts: string[]) => {
        if (accounts.length > 0) {
          setAddress(accounts[0]);
          localStorage.setItem("adexto_wallet_address", accounts[0]);
        } else {
          disconnectWallet();
        }
      };

      const handleChainChanged = (hexChainId: string) => {
        const num = parseInt(hexChainId, 16);
        setChainId(num);
        if (CHAIN_ID_TO_KEY[num]) {
          setSelectedChainState(CHAIN_ID_TO_KEY[num]);
          localStorage.setItem("adexto_selected_chain", CHAIN_ID_TO_KEY[num]);
        }
      };

      (window as any).ethereum.on("accountsChanged", handleAccountsChanged);
      (window as any).ethereum.on("chainChanged", handleChainChanged);

      return () => {
        (window as any).ethereum?.removeListener?.("accountsChanged", handleAccountsChanged);
        (window as any).ethereum?.removeListener?.("chainChanged", handleChainChanged);
      };
    }
  }, []);

  const setSelectedChain = async (chain: SupportedChainKey) => {
    setSelectedChainState(chain);
    const targetId = CHAIN_CONFIGS[chain].id;
    setChainId(targetId);
    localStorage.setItem("adexto_selected_chain", chain);

    if (typeof window !== "undefined" && (window as any).ethereum && address) {
      try {
        await (window as any).ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${targetId.toString(16)}` }],
        });
      } catch (err: any) {
        // Fallback gracefully without breaking UI state
        console.warn("Chain switch request:", err.message);
      }
    }
  };

  const connectWallet = async () => {
    setIsConnecting(true);
    try {
      if (typeof window !== "undefined" && (window as any).ethereum) {
        const accounts = await (window as any).ethereum.request({ method: "eth_requestAccounts" });
        const currentChainIdHex = await (window as any).ethereum.request({ method: "eth_chainId" });
        const numChain = parseInt(currentChainIdHex, 16);
        const userAddr = accounts[0];

        setAddress(userAddr);
        setChainId(numChain);
        if (CHAIN_ID_TO_KEY[numChain]) {
          setSelectedChainState(CHAIN_ID_TO_KEY[numChain]);
          localStorage.setItem("adexto_selected_chain", CHAIN_ID_TO_KEY[numChain]);
        }
        localStorage.setItem("adexto_wallet_address", userAddr);
      } else {
        alert("Web3 Wallet not detected. Please install MetaMask, Coinbase Wallet, or Rabby to connect.");
      }
    } catch (err) {
      console.error("User rejected connection", err);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectWallet = () => {
    setAddress(null);
    localStorage.removeItem("adexto_wallet_address");
  };

  return (
    <WalletContext.Provider
      value={{
        address,
        chainId,
        selectedChain,
        chainName: CHAIN_CONFIGS[selectedChain]?.name || "Base Mainnet",
        isConnected: !!address,
        isConnecting,
        connectWallet,
        disconnectWallet,
        setSelectedChain,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export const useWallet = () => useContext(WalletContext);
