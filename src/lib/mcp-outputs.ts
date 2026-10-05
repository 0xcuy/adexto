/**
 * Output schema untuk ke-14 alat MCP (`outputSchema` di `tools/list`).
 *
 * KENAPA SEMUA BIDANG OPSIONAL DAN OBJEKNYA LONGGAR
 *
 * SDK server memvalidasi `structuredContent` setiap jawaban terhadap schema ini SEBELUM
 * dikirim, dan jawaban yang tidak lolos diganti galat "Output validation error". Alat-alat ini
 * menjawab penolakan sebagai hasil biasa (`{ error, detail }`, misalnya `unknown_market`),
 * bukan `isError`, dan banyak bidang sengaja `null` ketika tidak terbaca. Jadi schema yang
 * mewajibkan bidang sukses akan mengubah setiap penolakan menjadi galat protokol, dan schema
 * yang menolak bidang tambahan akan mematahkan alat begitu satu bidang baru ditambahkan.
 *
 * Aturannya: setiap bidang opsional, yang bisa `null` ditandai nullable, objek bersarang yang
 * bentuknya milik layanan lain (tantangan 402 gateway, fakta on-chain) ditulis `unknown`
 * dengan deskripsi, dan setiap objek `looseObject`. Schema ini mendeskripsikan, bukan membatasi.
 *
 * Teks deskripsi di sini English karena tersalin ke `tools/list` publik.
 */
import { z } from "zod-v4";

/**
 * Setiap skalar nullable. `structuredContent` adalah hasil round-trip JSON dari teks jawaban yang
 * sama (lihat `jsonResult` di route MCP), dan JSON mengubah NaN atau Infinity menjadi null; angka
 * yang kebetulan tidak terbaca tidak boleh membuat seluruh jawaban gagal validasi.
 */
const s = (d: string) => z.string().nullable().describe(d).optional();
const n = (d: string) => z.number().nullable().describe(d).optional();
const b = (d: string) => z.boolean().nullable().describe(d).optional();
const sn = s;
const nn = n;
const any = (d: string) => z.unknown().describe(d).optional();

/** Bidang penolakan, sama di setiap alat. */
const refusal = {
  error: s("Present only when the tool refused, as a stable code such as unknown_market. Nothing was spent."),
  detail: any("Why it refused, or extra context on a successful answer."),
};

const agentIdentity = z
  .looseObject({
    standard: s("Always ERC-8004."),
    agentId: s("ERC-8004 agent id on the market's chain."),
    agentRegistry: s("eip155:<chainId>:<registry address>."),
    source: s("token-contract when read from the token now, registry-copy when copied at launch."),
  })
  .nullable()
  .describe("The ERC-8004 agent the token is bound to, or null when unbound.")
  .optional();

const staking = z
  .looseObject({
    contract: s("Stake contract: the market's own, or its chain's stake hub."),
    kind: s("dedicated or hub."),
    minStake: n("Minimum active stake, in whole tokens."),
    token: s("Token to stake."),
    howToStake: s("The two calls a hub stake needs."),
    minimumRule: s("How a hub minimum is derived."),
    unlocks: s("What an active stake opens."),
    lock: s("Always none: unstake works at any time."),
  })
  .nullable()
  .describe("How to stake this market, or null when its chain has no stake contract.")
  .optional();

const unsignedTx = z.looseObject({
  purpose: s("What the transaction does."),
  chainId: n("Chain to send it on."),
  from: s("Address that must sign and send it."),
  to: s("Contract it calls."),
  data: s("Calldata."),
  value: s("Native value in wei. Always 0."),
  gasEstimate: sn("Gas estimate, or null when it can only be estimated after the previous transaction is mined."),
  markets: z.array(z.string()).describe("Markets a claim covers.").optional(),
});

const market = z.looseObject({
  symbol: s("Ticker."),
  name: s("Token name."),
  chainId: n("Chain id of the market."),
  chain: s("Chain name and id."),
  nativeSymbol: s("Native asset of the chain."),
  token: s("Token contract."),
  curve: sn("Bonding curve contract, or null when none is live."),
  tradable: b("Whether the curve is live and can be bought."),
  priceNative: nn("Last recorded price of one token in the chain's native asset."),
  historySource: s("indexer, market-index or rpc-logs: which read path serves trade_history."),
  agentIdentity,
});

const swap = z.looseObject({
  txHash: s("Swap transaction."),
  side: s("BUY or SELL."),
  amountToken: n("Tokens moved."),
  amountNative: n("Native asset moved."),
  nativeSymbol: s("Native asset of the chain."),
  executionPriceNative: n("Price actually paid or received, fees included."),
  spotPriceAfter: nn("Curve spot price after this swap."),
  trader: s("Address that traded."),
  timestamp: s("ISO 8601 time of the block."),
  blockNumber: nn("Block of the swap."),
});

export const MCP_OUTPUTS = {
  list_markets: z.looseObject({
    count: n("Number of markets."),
    markets: z.array(market).describe("Every market served, on every chain.").optional(),
    note: s("How delivery works and what agentIdentity means."),
  }),

  get_market: z.looseObject({
    ...refusal,
    symbol: s("Ticker."),
    name: s("Token name."),
    slug: s("URL slug of the market."),
    chainId: n("Chain id of the market."),
    chain: s("Chain name and id."),
    nativeSymbol: s("Native asset of the chain."),
    token: s("Token contract."),
    curve: sn("Bonding curve contract."),
    tradable: b("Whether the curve is live."),
    priceNative: nn("Price of one token in the native asset."),
    supply: n("Total supply in whole tokens."),
    lpFeeBps: n("Fee kept in the curve, in basis points."),
    treasuryBuybackBps: n("Buyback-and-burn fee, in basis points."),
    creator: s("Creator address, paid the creator fee."),
    launchTx: sn("Launch transaction."),
    launchBlock: nn("Launch block."),
    historySource: s("indexer, market-index or rpc-logs: which read path serves trade_history."),
    buyResource: s("x402 URL that sells this market."),
    agentIdentity,
    staking,
    known: z.array(z.string()).describe("On unknown_market: the tickers that do exist.").optional(),
  }),

  quote_buy: z.looseObject({
    httpStatus: n("Status the gateway answered: 402 is a quote."),
    quoted: b("True when the gateway returned a 402 quote."),
    resource: s("Gateway URL that was quoted."),
    challenge: any("The gateway's answer: on 402, x402Version, accepts[0] with the payment terms, and quote."),
    next: s("What to do next."),
  }),

  how_to_pay: z.looseObject({
    protocol: s("Payment protocol."),
    settlementChain: s("Chain the payment settles on."),
    settlementAsset: s("Asset paid."),
    scheme: s("x402 scheme and transfer method."),
    header: s("Header that carries the payment."),
    headerNote: s("Which payment header names the gateway reads."),
    steps: z.array(z.string()).describe("Steps from challenge to settled buy.").optional(),
    youNeverNeed: z.array(z.string()).describe("What a buyer never needs.").optional(),
    orderOfOperations: s("Delivery runs before the charge."),
    replayProtection: s("Why one authorization cannot be spent twice."),
  }),

  buy_token: z.looseObject({
    httpStatus: n("Status the gateway answered."),
    settled: b("True when the payment settled and the tokens were delivered."),
    paymentRequired: b("True when this is the 402 challenge to sign."),
    challenge: any("On 402: the payment terms in accepts[0]."),
    result: any("On a paid call: delivery and settlement transactions, or the gateway's refusal."),
    next: s("What to do next."),
  }),

  pay_and_buy: z.looseObject({
    ...refusal,
    symbol: s("Ticker bought."),
    chain: s("Chain of the market."),
    httpStatus: n("Status the gateway answered."),
    settled: b("True when the payment settled."),
    paidBy: s("Operator wallet that signed the payment."),
    signedBy: s("Who signed: the operator wallet on the server, not the agent."),
    amountUsdc: s("USDC paid."),
    delivery: any("Delivery transaction on the market's chain."),
    settlement: any("Settlement transaction on Base."),
    buyback: any("Automatic buyback result, when one ran."),
    gatewayError: any("The gateway's answer when it did not settle."),
    terminal: s("Market page."),
    retryAfterSeconds: n("On rate_limited: seconds until the next purchase is allowed."),
    known: z.array(z.string()).describe("On unknown_market: the tickers that do exist.").optional(),
    limits: any("On refused_by_limits: the hard limits the quote did not meet."),
  }),

  trade_history: z.looseObject({
    ...refusal,
    symbol: s("Ticker."),
    chainId: n("Chain id of the market."),
    chain: s("Chain name and id."),
    curve: s("Bonding curve contract."),
    source: s("envio-hyperindex, the-graph, market-index or rpc-logs: which read path answered."),
    complete: b("True only when the answer reaches the launch block."),
    completeBecause: s("Why the history is complete."),
    incompleteBecause: s("Why older swaps may be missing."),
    totalSwaps: n("Swaps since launch; on an incomplete answer, the swaps seen so far."),
    returned: n("Rows in swaps."),
    indexerSyncedToBlock: nn("Block the indexer or subgraph has reached."),
    indexerError: any("Why the indexer or subgraph was skipped, when it was."),
    degraded: b("True when the indexer or subgraph failed and another read path answered instead."),
    launchBlock: nn("Launch block of the market."),
    indexedThroughBlock: nn("Last block our per-market index has scanned, when it was used."),
    indexProgress: nn("Share of the blocks since launch the per-market index has scanned, 0 to 1, while it catches up."),
    coverage: any("What the log scan reached."),
    swaps: z.array(swap).describe("Swaps, newest first.").optional(),
    publicEndpoint: s("Public GraphQL endpoint of the indexer."),
    known: z.array(z.string()).describe("On unknown_market: the tickers that do exist.").optional(),
    note: s("Context for a read failure."),
  }),

  check_stake: z.looseObject({
    ...refusal,
    staking: b("False when the market's chain has no stake contract for it."),
    symbol: s("Ticker."),
    chainId: n("Chain id of the market."),
    chain: s("Chain name and id."),
    stakeContract: s("Stake contract read."),
    kind: s("dedicated or hub."),
    address: s("Wallet read."),
    staked: s("Staked, in whole tokens."),
    minStake: s("Minimum for an active stake, in whole tokens."),
    active: b("True when the stake is at or above the minimum."),
    totalStaked: s("Total staked in this market, in whole tokens."),
    stakers: n("Number of stakers."),
    lock: s("Always none: unstake works at any time."),
  }),

  access_message: z.looseObject({
    ...refusal,
    symbol: s("Ticker, on unknown_market."),
    address: s("Address, on bad_address."),
    message: s("The exact EIP-191 message to sign."),
    sign: s("How to sign it."),
    validForSeconds: n("How long ask_agent accepts it."),
    next: s("What to do next."),
  }),

  ask_agent: z.looseObject({
    ...refusal,
    answered: b("True when the agent answered."),
    symbol: s("Ticker."),
    chainId: n("Chain id of the market."),
    answer: s("The agent's answer, limited to the facts below."),
    answeredBy: s("Model and route that answered."),
    stake: any("The stake position that opened the agent."),
    facts: any("Facts read on chain for this answer."),
    retryAfterSeconds: n("On rate_limited: seconds until the next question is allowed."),
    httpStatus: n("On model_failed: the model's HTTP status."),
  }),

  prepare_launch: z.looseObject({
    ...refusal,
    step: s("sign_attestation on the first call, sign_and_send on the second."),
    chainId: n("Chain to launch on."),
    chain: s("Chain name."),
    symbol: s("Ticker."),
    name: s("Token name."),
    deployer: s("Address that signs and sends."),
    attestationMessage: s("Step one: the message to sign with personal_sign."),
    signWith: s("Step one: how to sign."),
    validForSeconds: n("Step one: how long the attestation is accepted."),
    checks: any("Step one: ticker and agent checks already passed."),
    transaction: z
      .looseObject({
        from: s("Deployer."),
        to: s("ADEXTO launch factory."),
        data: s("deployTrinity calldata."),
        value: s("Always 0: a launch costs gas only."),
        chainId: n("Chain id."),
        gas: s("Gas limit to send with."),
      })
      .describe("Step two: the unsigned launch transaction.")
      .optional(),
    gasEstimate: s("Step two: estimated gas."),
    gasSource: s("estimateGas or measured."),
    gasPriceWei: sn("Current gas price."),
    estimatedCostWei: sn("Estimated cost in wei."),
    deployerBalanceWei: sn("Deployer balance."),
    fundsSufficient: b("Whether the balance covers the estimate."),
    nativeSymbol: s("Native asset that pays the gas."),
    simulation: z
      .looseObject({ ok: b("True when the simulation did not revert."), revert: sn("Revert reason, if any.") })
      .describe("The transaction simulated from the deployer.")
      .optional(),
    market: any("The market the launch creates: supply, fee split, opening market cap, agent."),
    attestationRoot: s("Metadata root written on chain."),
    metadataAnchoredTo0G: b("True when the metadata was stored on 0G DA."),
    next: s("What to do next."),
    launchableChains: any("On unsupported_chain: the chains that can launch."),
    quota: any("On creator_ticker_limit: this address's ticker quota."),
    status: n("On prepare_failed: HTTP status of the preparation stage."),
    code: sn("On prepare_failed: error code of the preparation stage."),
    retryAfterSeconds: n("On a rate limit: seconds to wait."),
    unavailableChains: any("Chains the preparation stage could not open."),
  }),

  register_launch: z.looseObject({
    ...refusal,
    registered: b("True when the market is listed."),
    alreadyRegistered: b("True when it was listed before this call."),
    symbol: s("Ticker."),
    name: s("Token name."),
    chainId: n("Chain id."),
    chain: s("Chain name."),
    token: s("Token contract."),
    curve: s("Bonding curve contract."),
    creator: s("Creator address, from the factory event."),
    agentIdentity: any("ERC-8004 binding read from the token, or null."),
    explorerTx: sn("Explorer link of the launch transaction."),
    metadataApplied: b("True when the prepare_launch metadata was applied."),
    page: s("Market page."),
    buyResource: s("x402 URL that sells the market."),
    next: s("What to do next."),
    launchableChains: any("On unsupported_chain: the chains that can launch."),
    status: n("On confirm_failed: HTTP status of the registration stage."),
    code: sn("On confirm_failed: error code of the registration stage."),
    note: s("Context for a failed registration."),
  }),

  prepare_stake: z.looseObject({
    ...refusal,
    market: s("Ticker and chain."),
    chainId: n("Chain id."),
    stakeContract: s("Stake contract the transactions call."),
    kind: s("dedicated or hub."),
    token: s("Token staked."),
    transactions: z.array(unsignedTx).describe("Send in order: an exact approval if needed, then the stake.").optional(),
    order: s("Sending order."),
    after: z
      .looseObject({ staked: s("Position after staking."), minimum: s("Minimum."), active: b("Active after staking.") })
      .describe("The position once the transactions are mined.")
      .optional(),
    lock: s("Always none."),
    next: s("What to do next."),
    balance: s("On insufficient_balance: the wallet's balance."),
    minimum: s("On below_minimum: the minimum."),
    alreadyStaked: s("On below_minimum: the current position."),
  }),

  prepare_claim: z.looseObject({
    ...refusal,
    address: s("Creator address."),
    claimable: z
      .array(
        z.looseObject({
          symbol: s("Ticker."),
          chainId: n("Chain id."),
          curve: s("Curve that owes the fee."),
          owed: nn("Owed, in the chain's native asset."),
          nativeSymbol: s("Native asset."),
          owedUsd: nn("Owed, in USD at the current native price."),
        })
      )
      .describe("Markets that owe this address a creator fee.")
      .optional(),
    transactions: z.array(unsignedTx).describe("One claim per curve, or one Multicall3 batch per chain.").optional(),
    checkedMarkets: any("Markets checked."),
    unreadableMarkets: any("Markets that could not be read."),
    note: s("Who receives the fee."),
  }),
} as const;

export type McpToolName = keyof typeof MCP_OUTPUTS;
