export const ADEXTO_CONTRACTS = {
  // Primary 0G Mainnet Architecture
  og: {
    chainId: 16661,
    chainName: "0G Mainnet",
    rpcUrl: "https://evmrpc.0g.ai",
    blockExplorer: "https://chainscan.0g.ai",
    factoryAddress: "0xe8E9Cf43f88D065892c35c4aDa002C7B8b11F3e0",
    sovereignHookAddress: "0x592c697aD1Fa712c6701C90991B96264aB2E98d8",
    governorAddress: "0x5045b117dDF788078c535f37837fDB6384da034d",
    ccipReceiverAddress: "0xaD0C7BFF5aDfeb01C3DaF2bF8C85414FE4D47Ab4",
    status: "Live On-Chain",
  },
  // Arbitrum One Mainnet Architecture
  arbitrum: {
    chainId: 42161,
    chainName: "Arbitrum One",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    blockExplorer: "https://arbiscan.io",
    factoryAddress: "0x2674654D4a8B79f84c1daC4Cf254EA066e59bC56",
    sovereignHookAddress: "0xbC72FE919F85E679e7d95e2b471AaDA3c7c3Ac39",
    governorAddress: "0x33811F9c53da5071A130F18D844f64999dBD43bA",
    ccipReceiverAddress: "0x5800e9715a47a598fce9bc3B65a95FD6BeBf76A3",
    status: "Live On-Chain",
  },
  // Shared Infrastructure
  deployer: "0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D",
  daStorageIndexer: "https://indexer-storage-turbo.0g.ai",
  computeRouter: "https://router-api.0g.ai/v1",
  edgeX402Gateway: "https://adexto-x402-edge.cucuvirtual.workers.dev",
  // Fallback direct references for 0G primary
  chainId: 16661,
  chainName: "0G Mainnet",
  rpcUrl: "https://evmrpc.0g.ai",
  blockExplorer: "https://chainscan.0g.ai",
  factoryAddress: "0xe8E9Cf43f88D065892c35c4aDa002C7B8b11F3e0",
  sovereignHookAddress: "0x592c697aD1Fa712c6701C90991B96264aB2E98d8",
  governorAddress: "0x5045b117dDF788078c535f37837fDB6384da034d",
  ccipReceiverAddress: "0xaD0C7BFF5aDfeb01C3DaF2bF8C85414FE4D47Ab4",
} as const;
