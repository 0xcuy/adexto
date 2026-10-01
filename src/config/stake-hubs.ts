/**
 * AdextoStakeHub: one stake contract per chain for every ADEXTO market that does not have its own
 * `AdextoAgentStake`. Deployed 2026-10-01 by `scripts/deploy-stake-hub.mjs` from commit f8328ab;
 * every value below was read back from the chain by that script, and every hub is an exact match
 * (creation and runtime) on Sourcify.
 *
 * WHAT A HUB IS, IN ONE PARAGRAPH
 *
 * A token is accepted when one of the factories fixed at construction returns a curve for it from
 * `curveOf(token)`, which only `deployTrinity` writes, so every new launch is stakeable from its
 * first block with nothing deployed. The minimum is 0.001% of the token's current supply
 * (`totalSupply / 100_000`). There is no owner, no pause, no lock and no reward, and the lists of
 * factories and excluded tokens were written once in the constructor.
 *
 * WHY THE FOUR DEDICATED STAKES ARE EXCLUDED
 *
 * $ADEXTO on 0G and $SAI on Arbitrum One, Robinhood Chain and Monad already had an
 * `AdextoAgentStake` with positions in it. Each hub refuses those tokens, so no market has two
 * stake contracts whose positions disagree, and those four keep their tiered Agent Compute.
 *
 * Addresses are public and immutable, so they are written here rather than read from env.
 */
export interface StakeHub {
  chainId: number;
  address: string;
  deployBlock: number;
  deployTx: string;
  /** Factories whose tokens are accepted, in constructor order: v1 first, then 0.11.0. */
  factories: readonly string[];
  /** Tokens refused because they have their own AdextoAgentStake. */
  ownStakeTokens: readonly string[];
}

export const STAKE_HUBS: readonly StakeHub[] = [
  {
    chainId: 143,
    address: "0xb89d17F7308Ac007b106EB400eB2A8CB51cf887A",
    deployBlock: 109727181,
    deployTx: "0x4af6f26be4307364ec6e34fb2a8a9096e0e5abfcb7baaba962f1be2c7d43d66d",
    factories: ["0x3dFcBEd7dd889F465cC9f75c430B43Ef873b6056", "0x5800e9715a47a598fce9bc3B65a95FD6BeBf76A3"],
    ownStakeTokens: ["0xD873B033e2dffbF7E3107CD61E7156cE23B39f20"],
  },
  {
    chainId: 42161,
    address: "0xdf8891bA9fd8e3DC2E7D0A0ccae279247cd2ddf3",
    deployBlock: 510798163,
    deployTx: "0x447f42419e2e7cb81353fc6ad9e7791946c1151d49f7c55d935ee9d388ea741a",
    factories: ["0x79DF3671e7e7456832C84a34c2bC0DB7871C0E0E", "0xE17f1027FC5f294327D701829baeD9d6519e922C"],
    ownStakeTokens: ["0xC4b5eA97bd4e3f8Bc047fFCc74Ca9c2B6b426cb3"],
  },
  {
    chainId: 4663,
    address: "0x05EFA7F066FcbefbE650EDd58583C107831A600B",
    deployBlock: 77733726,
    deployTx: "0x5470dcd6025c7b4a4989b37fc7c2cffcd07a9adb16043de971735c1c698647e9",
    factories: ["0x8e63e117E71A80Cfc10fDF375F079e2e29cd7D7D"],
    ownStakeTokens: ["0x4C63223B883B3096bC1Bd24087b56951D1dAC82d"],
  },
  {
    chainId: 8453,
    address: "0x2ba1EcffCD624Dc18044531F3999F0445014240D",
    deployBlock: 52052214,
    deployTx: "0xd081572c266bd73481b7998dc15c17ba29131596dd0def14af4d49085d936e25",
    factories: ["0xF5f904ca7763Fc6755bbCe5466a9DBd4C15c2708", "0x216E7880D64D94335B583c539802d3e61958d4A2"],
    ownStakeTokens: [],
  },
  {
    chainId: 16661,
    address: "0x440B89416A3a907a7016F20A29DA18665269A52f",
    deployBlock: 45891788,
    deployTx: "0xc063a01575ae753f746cca27a23a12ec76af26d95dc720fd5cef3ee830652550",
    factories: ["0xEBbE0fB112859b57A0ad1afbeD4978e43dC96c5D", "0x51c4168226463F7e5A141e1c6D30520734BC840a"],
    ownStakeTokens: ["0xA1358C17004469C7CA5365AbafD294F9b2c11DF7"],
  },
];

/**
 * The commit all five hubs were compiled from (`sourceCommit` in each deployment record). At this
 * commit `contracts/` is the v1 tree of factory-deployments.json `sourceCommit` plus
 * `AdextoStakeHub.sol`, so one checkout rebuilds the factory and the hubs. audit_consistency.mjs
 * reads this line to check that the scanned hub source is the deployed one.
 */
export const STAKE_HUB_SOURCE_COMMIT = "f8328ab43375c8a785ccf86fb4dfe39c83c2986f";

/** The hub's minimum is `totalSupply / HUB_MIN_STAKE_DIVISOR`: 0.001% of supply. */
export const HUB_MIN_STAKE_DIVISOR = 100_000;

export function stakeHubFor(chainId: number): StakeHub | null {
  return STAKE_HUBS.find((h) => h.chainId === Number(chainId)) ?? null;
}

/** True when `token` on `chainId` is one the hub refuses because it has its own stake contract. */
export function hubRefuses(chainId: number, token: string): boolean {
  const hub = stakeHubFor(chainId);
  if (!hub) return true;
  const t = token.toLowerCase();
  return hub.ownStakeTokens.some((o) => o.toLowerCase() === t);
}

/**
 * The hub's minimum in WHOLE tokens for a supply in whole tokens. The contract computes it from
 * the current `totalSupply`, which only falls (buyback burns), so this figure is never below what
 * the contract asks for by more than the burned share.
 */
export function hubMinStake(supplyWhole: number): number {
  return Math.max(1, Math.floor(Number(supplyWhole) / HUB_MIN_STAKE_DIVISOR));
}

/** The ABI the site uses for a hub. Every call names the token. */
export const STAKE_HUB_ABI = [
  "function stake(address token, uint256 amount)",
  "function unstakeAll(address token)",
  "function stakedOf(address token, address account) view returns (uint256)",
  "function totalStaked(address token) view returns (uint256)",
  "function stakerCount(address token) view returns (uint256)",
  "function minStakeOf(address token) view returns (uint256)",
  "function isActive(address token, address account) view returns (bool)",
  "function isEligible(address token) view returns (bool)",
] as const;
