/**
 * Canonical on-chain addresses for the ADEXTO Protocol.
 *
 * `factoryV2Address` points at AdextoTrinityFactoryV2, which deploys a real
 * executable SovereignHook AMM per launch. It is read from the environment so a
 * broadcast does not require a code change:
 *
 *   NEXT_PUBLIC_FACTORY_V2_0G / _ARBITRUM / _BASE / _MONAD
 *
 * `sovereignHookAddress` is the legacy v1 hook. It has no `receive()` and no swap
 * entrypoint, so it cannot settle trades — the UI treats a chain without a
 * `factoryV2Address` as "DEX not live yet" instead of sending doomed transactions.
 */

const env = (key: string): string | null => {
  const value = process.env[key];
  return value && /^0x[a-fA-F0-9]{40}$/.test(value) ? value : null;
};

export const ADEXTO_CONTRACTS = {
  og: {
    chainId: 16661,
    chainName: "0G Mainnet",
    nativeSymbol: "0G",
    rpcUrl: "https://evmrpc.0g.ai",
    blockExplorer: "https://chainscan.0g.ai",
    factoryAddress: "0xe8E9Cf43f88D065892c35c4aDa002C7B8b11F3e0",
    factoryV2Address: env("NEXT_PUBLIC_FACTORY_V2_0G"),
    sovereignHookAddress: "0x592c697aD1Fa712c6701C90991B96264aB2E98d8",
    governorAddress: "0x5045b117dDF788078c535f37837fDB6384da034d",
    ccipReceiverAddress: "0xaD0C7BFF5aDfeb01C3DaF2bF8C85414FE4D47Ab4",
    status: "Live On-Chain",
  },
  arbitrum: {
    chainId: 42161,
    chainName: "Arbitrum One",
    nativeSymbol: "ETH",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    blockExplorer: "https://arbiscan.io",
    factoryAddress: "0x2674654D4a8B79f84c1daC4Cf254EA066e59bC56",
    factoryV2Address: env("NEXT_PUBLIC_FACTORY_V2_ARBITRUM"),
    sovereignHookAddress: "0xbC72FE919F85E679e7d95e2b471AaDA3c7c3Ac39",
    governorAddress: "0x33811F9c53da5071A130F18D844f64999dBD43bA",
    ccipReceiverAddress: "0x5800e9715a47a598fce9bc3B65a95FD6BeBf76A3",
    status: "Live On-Chain",
  },
  base: {
    chainId: 8453,
    chainName: "Base Mainnet",
    nativeSymbol: "ETH",
    rpcUrl: "https://mainnet.base.org",
    blockExplorer: "https://basescan.org",
    factoryAddress: "0x8e63e117E71A80Cfc10fDF375F079e2e29cd7D7D",
    factoryV2Address: env("NEXT_PUBLIC_FACTORY_V2_BASE"),
    sovereignHookAddress: "0xb264D861264B0e4f8fb98A61B7694BA8a3B6BBe3",
    governorAddress: "0x01b250a2db25561dB185f4628B93C72048D8bc1B",
    ccipReceiverAddress: "0x1eE8701Dd8CD8C456E71ef74bd3Dbf0b377B6D8d",
    status: "Live On-Chain",
  },
  monad: {
    chainId: 143,
    chainName: "Monad Mainnet",
    nativeSymbol: "MON",
    rpcUrl: "https://rpc.monad.xyz",
    blockExplorer: "https://monadvision.com",
    factoryAddress: "0x8e63e117E71A80Cfc10fDF375F079e2e29cd7D7D",
    factoryV2Address: env("NEXT_PUBLIC_FACTORY_V2_MONAD"),
    sovereignHookAddress: "0xb264D861264B0e4f8fb98A61B7694BA8a3B6BBe3",
    governorAddress: "0x01b250a2db25561dB185f4628B93C72048D8bc1B",
    ccipReceiverAddress: "0x1eE8701Dd8CD8C456E71ef74bd3Dbf0b377B6D8d",
    status: "Live On-Chain",
  },

  // Shared infrastructure
  deployer: "0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D",
  daStorageIndexer: "https://indexer-storage-turbo.0g.ai",
  computeRouter: "https://router-api.0g.ai/v1",
  edgeX402Gateway: "https://adexto-x402-edge.cucuvirtual.workers.dev",

  // Fallback direct references for the 0G primary chain
  chainId: 16661,
  chainName: "0G Mainnet",
  nativeSymbol: "0G",
  rpcUrl: "https://evmrpc.0g.ai",
  blockExplorer: "https://chainscan.0g.ai",
  factoryAddress: "0xe8E9Cf43f88D065892c35c4aDa002C7B8b11F3e0",
  sovereignHookAddress: "0x592c697aD1Fa712c6701C90991B96264aB2E98d8",
  governorAddress: "0x5045b117dDF788078c535f37837fDB6384da034d",
  ccipReceiverAddress: "0xaD0C7BFF5aDfeb01C3DaF2bF8C85414FE4D47Ab4",
} as const;
