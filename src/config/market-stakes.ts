/**
 * Stake contracts bound to individual markets. One `AdextoAgentStake` per market, on that
 * market's chain, deployed by `scripts/deploy-market-stake.mjs` after the market launched.
 *
 * WHAT STAKING DOES HERE, AND ONLY THIS
 *
 * The contract holds the stake and answers `stakedOf` and `isActive`. It has no owner, no lock
 * and no reward: `unstake` works at any time and pays nothing extra. What a stake opens is
 * access to the market's agent over MCP (`ask_agent`), checked against `isActive` on every
 * call, and, for markets listed in `COMPUTE_STAKES` (src/config/agent-compute.ts), an Agent
 * Compute API key whose tier is read from this same contract on every sweep. Nothing here is a
 * yield, and no copy on the site may describe it as one.
 *
 * Addresses are written here once, from the deployment output, instead of read from env: they
 * are public, they never change (the binding is immutable), and a build that cannot find them
 * should fail visibly rather than render a panel with an empty address.
 */
export interface MarketStake {
  chainId: number;
  symbol: string;
  /** The market's token. The contract's `stakeToken`, immutable. */
  token: string;
  /** AdextoAgentStake address. */
  contract: string;
  /** Minimum position in WHOLE tokens; the contract stores it in base units. */
  minStake: number;
  decimals: number;
  deployBlock: number;
  deployTx: string;
}

export const MARKET_STAKES: MarketStake[] = [
  /**
   * $SAI (SAi Arbitrum) on Arbitrum One. Deployed 2026-10-01 by the deployer with
   * scripts/deploy-market-stake.mjs; immutables read back from the chain: stakeToken = the
   * token below, minStake = 10,000 SAI, empty at deployment.
   */
  {
    chainId: 42161,
    symbol: "SAI",
    token: "0xC4b5eA97bd4e3f8Bc047fFCc74Ca9c2B6b426cb3",
    contract: "0x2fc2A49ea2e4357541Dda9488DCeadCD0c43B508",
    minStake: 10000,
    decimals: 18,
    deployBlock: 510578200,
    deployTx: "0x129e503750a64dde02150bf8c076737845a5fc4869d9722726fd296ec106c865",
  },
];

export function marketStakeFor(chainId: number, symbol: string): MarketStake | null {
  const want = symbol.toUpperCase();
  return MARKET_STAKES.find((s) => s.chainId === Number(chainId) && s.symbol === want) ?? null;
}

/** EIP-191 message an address signs to use `ask_agent`. Built in one place for server and client. */
export function agentAccessMessage(params: { symbol: string; chainId: number; address: string; timestamp: number }): string {
  return (
    `ADEXTO agent access\n` +
    `Market: $${params.symbol.toUpperCase()} on chain ${params.chainId}\n` +
    `Address: ${params.address}\n` +
    `Timestamp: ${params.timestamp}`
  );
}

/** How long a signed access message stays valid. */
export const AGENT_ACCESS_MAX_AGE_MS = 10 * 60 * 1000;
