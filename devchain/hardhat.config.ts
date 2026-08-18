import type { HardhatUserConfig } from "hardhat/config";

/**
 * Local devchain only. Contracts live in ../contracts and are compiled by
 * ../scripts/compile-contracts.mjs (solc-js) for deployment; this config exists
 * purely to expose `hardhat node` for free end-to-end swap tests.
 */
const config: HardhatUserConfig = {
  solidity: {
    profiles: {
      default: {
        version: "0.8.26",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true,
        },
      },
    },
  },
  paths: {
    sources: "../contracts",
  },
};

export default config;
