/**
 * Struktur docs: grup sidebar, label pendek, urutan pager, dan ringkasan "In short" per halaman.
 *
 * Bentuknya meniru docs comfy.fun atas permintaan owner (4 Okt): sidebar berkelompok, judul pendek,
 * ringkasan tiga kalimat biasa di atas setiap halaman, lalu isi lengkap. Prosa panjang tetap di
 * `src/config/docs-pages.json` (disusun model bahasa, diperiksa `scripts/docs-verify.mjs`); berkas ini
 * DITULIS TANGAN, karena satu baris yang menentukan apakah orang mau membaca bukan tugas model.
 *
 * Aturan isi ringkasan: hanya hal yang tertulis di halaman itu sendiri atau di `docs-facts.json`, bahasa
 * sehari-hari, tanpa alamat atau hash. Teks publik: English, `audit_claims.mjs` harus 0.
 *
 * Slug di sini HARUS sama dengan kunci `docs-pages.json` dan `DOCS_SLUGS` di `src/middleware.ts`
 * (dijaga `audit_consistency.mjs`). Menambah halaman berarti menyentuh ketiganya.
 */
import { LAUNCH_CHAIN_COUNT_WORD, chainNameList } from "@/lib/chains";

export interface DocNavItem {
  /** `null` untuk halaman indeks `/docs`. */
  slug: string | null;
  href: string;
  /** Label sidebar dan pager. Pendek. */
  label: string;
}

export interface DocNavGroup {
  label: string;
  items: readonly DocNavItem[];
}

const item = (slug: string, label: string): DocNavItem => ({ slug, href: `/docs/${slug}`, label });

/**
 * Dua puluh halaman ditambahkan 7 Okt (permintaan owner: "dokumentasi web komplit sebanyak-banyaknya").
 * Halaman-halaman itu DITULIS TANGAN langsung ke `docs-pages.json` (`origin: "hand-written"`), dari
 * kode sumbernya dan dari endpoint produksi, bukan lewat `docs-draft.mjs`; judul seksinya sudah kalimat
 * biasa, jadi tidak butuh entri di `DOC_HEADINGS`.
 *
 * Slug baru TIDAK BOLEH sama dengan rute tingkat atas (`studio`, `swap`, `explorer`, `creator`,
 * `rewards`, `leaderboard`, `agents`, `report`, …): di `docs.adexto.xyz` segmen pertama yang berupa slug
 * docs ditahan sebagai halaman docs, jadi slug `swap` akan membelokkan tautan navbar `/swap` di subdomain
 * itu ke halaman docs. Karena itu `referrals` dan bukan `rewards`, `reporting` dan bukan `report`.
 */
export const DOC_GROUPS: readonly DocNavGroup[] = [
  {
    label: "Start",
    items: [{ slug: null, href: "/docs", label: "What is ADEXTO" }, item("quickstart", "Quickstart"), item("glossary", "Glossary")],
  },
  {
    label: "Launch",
    items: [
      item("launch", "Launch a market"),
      item("studio-guide", "Studio, step by step"),
      item("agent-launch", "Launch from an agent"),
      item("fees", "Fees"),
      item("agent-identity", "Agent identity"),
    ],
  },
  {
    label: "Trade",
    items: [
      item("trading", "Trading"),
      item("market-page", "The market page"),
      item("finding-markets", "Finding markets"),
      item("cross-chain", "Cross-chain swaps"),
      item("wallets", "Wallets and networks"),
      item("chains", "Chains"),
    ],
  },
  {
    label: "Earn",
    items: [
      item("creator-earnings", "Creator earnings"),
      item("staking", "Staking"),
      item("compute", "Agent Compute"),
      item("referrals", "Referrals"),
    ],
  },
  {
    label: "Build",
    items: [
      item("mcp", "MCP server"),
      item("a2a", "A2A"),
      item("x402", "Buy with x402"),
      item("public-api", "Public API"),
      item("data", "Market data"),
    ],
  },
  {
    label: "Trust",
    items: [
      item("security", "Security"),
      item("check-a-market", "Check a market"),
      item("risks", "Risks"),
      item("reporting", "Report a market"),
      { slug: null, href: "/docs#contracts", label: "Contracts and status" },
    ],
  },
  { label: "Help", items: [item("faq", "FAQ"), item("troubleshooting", "Troubleshooting"), item("telegram", "Telegram bot")] },
];

/** Urutan baca untuk pager previous/next: urutan sidebar, tanpa tautan #anchor. */
export const DOC_ORDER: readonly DocNavItem[] = DOC_GROUPS.flatMap((g) => g.items).filter((i) => !i.href.includes("#"));

export function groupOf(href: string): string | null {
  return DOC_GROUPS.find((g) => g.items.some((i) => i.href === href))?.label ?? null;
}

export function neighbours(href: string): { prev: DocNavItem | null; next: DocNavItem | null } {
  const i = DOC_ORDER.findIndex((d) => d.href === href);
  return {
    prev: i > 0 ? DOC_ORDER[i - 1] : null,
    next: i >= 0 && i < DOC_ORDER.length - 1 ? DOC_ORDER[i + 1] : null,
  };
}

/**
 * Judul seksi dalam kalimat biasa, berurutan sama dengan `sections` di `docs-pages.json`.
 *
 * Judul dari model berbunyi seperti spesifikasi ("Market Initialization and Virtual Liquidity"); pembaca
 * mencari jawaban ("One transaction, no liquidity deposit"). Dipakai HANYA bila jumlahnya sama persis
 * dengan jumlah seksi halaman itu: kalau docs disusun ulang dan jumlahnya berubah, halaman jatuh kembali ke
 * judul JSON, bukan memasang judul yang salah ke seksi yang salah.
 */
export const DOC_HEADINGS: Readonly<Record<string, readonly string[]>> = {
  launch: [
    "One transaction, no liquidity deposit",
    "All of the supply goes into the curve",
    "The launch window",
    "Your ticker is reserved for good",
    "Binding an agent (optional)",
    "What Express mode fills in",
    "Where you can launch",
  ],
  trading: [
    "How the price moves",
    "Buying, selling and slippage",
    "Reading the fee a trade pays",
    "The token is a plain ERC-20",
    "What is guaranteed, and what is not",
  ],
  fees: [
    "Four parts of every fee",
    "Where the protocol part sits",
    "Rates never change after launch",
    "Anyone can trigger a claim",
    "Buyback and burn",
  ],
  chains: [
    "Where ADEXTO runs",
    "Check that the code is identical",
    "Why the hashes match",
    "Why a local build looks different",
    "Same address, different chain",
  ],
  x402: [
    "Ask, and get a quote",
    "Pay by signing, not by sending",
    "Delivery first, payment second",
    "Not atomic, and inventory is finite",
    "Buying on the same chain",
  ],
  mcp: [
    "Connect a client",
    "What needs a key, and what does not",
    "Who holds the key for a purchase",
    "Checks before any money moves",
  ],
  "agent-identity": [
    "What is integrated",
    "Register first, bind at launch",
    "Use agentBound, not the id",
    "One registry per chain",
    "The registry can change",
  ],
  data: [
    "The factory decides what exists",
    "How each chain is read",
    "Monad: Envio HyperIndex",
    "0G: direct RPC log scans",
    "Factory and markets",
  ],
  security: [
    "Fixed rates, no owner on the launch path",
    "No way to drain a curve",
    "No proxy, no upgrade",
    "Automated analysers",
    "No external review, and how to report a bug",
  ],
};

/** Ringkasan "In short": tiga kalimat biasa per halaman, ditulis tangan dari isi halaman itu. */
export const DOC_SUMMARIES: Readonly<Record<string, readonly string[]>> = {
  launch: [
    "A launch is one transaction. You pay gas only: the factory accepts no liquidity deposit.",
    "All of the supply goes into the curve. The creator gets no allocation and is paid from trading fees instead.",
    "For the first 180 seconds no wallet can hold more than 1% of the supply, and your ticker stays reserved on that chain for good.",
  ],
  trading: [
    "You buy and sell against the market's own curve. It never graduates or migrates, so the curve is the venue for the token's whole life.",
    "Every trade carries a slippage limit and a deadline, so it reverts instead of filling at a worse price.",
    "The token is a plain ERC-20 with no owner, pause or blacklist. Anyone can also pair it on another exchange, where the price can differ.",
  ],
  fees: [
    "Each trade pays four parts: creator, depth, buyback and a 0.10% protocol part.",
    "Every rate is fixed at launch. Nobody can change it later, and the payout addresses are fixed too.",
    "Anyone can trigger a fee claim or a buyback, and bought-back tokens are burned.",
  ],
  chains: [
    `The same factory, version 1.0.0, runs on ${chainNameList()}.`,
    `Its runtime code is byte-for-byte identical on all ${LAUNCH_CHAIN_COUNT_WORD}, and you can check the hash yourself.`,
    "Each chain is a separate market: check the chain id as well as the address before you send anything.",
  ],
  x402: [
    "Ask for a token and the gateway answers HTTP 402 with a quote in USDC on Base.",
    "You pay by signing a USDC transfer authorization, so you spend no gas and grant no allowance.",
    "The token is delivered first and the USDC is collected second. The two steps are not atomic.",
  ],
  mcp: [
    "Point any MCP client at the server URL. Reading markets needs no account and no key.",
    "For launch, stake and claim, the server returns unsigned transactions and your agent signs them with its own key.",
    "pay_and_buy is the one tool that spends money: it needs an x-agent-key header and signs with the operator's key, within fixed limits.",
  ],
  "agent-identity": [
    "At launch you can bind the token to an ERC-8004 agent you already own. It is optional and off by default.",
    "The factory only checks that you own the agent. Registering the agent is a separate step you do first.",
    "The binding is stored in the token and is per chain: an agent id means nothing without its chain.",
  ],
  data: [
    "The factory on each chain is the source of truth for which markets exist.",
    "Indexers add history and can lag behind the chain, so a brand-new market can exist before an index shows it.",
    "History is read differently per chain: subgraphs, Envio HyperIndex on Monad, Robinhood Chain and Arc, or direct RPC log scans.",
  ],
  security: [
    "Nothing on the launch path has an owner or a setter, and no function can drain a curve.",
    "There is no proxy and no upgrade path, so a fix cannot reach a market that already exists.",
    "No security firm has reviewed the contracts. Analyser output is published, and findings go through GitHub private vulnerability reporting.",
  ],
  quickstart: [
    "Connect a browser wallet or a WalletConnect wallet, and keep a little of the chain's own asset for gas.",
    "Buy from a market page: the swap card shows the minimum you receive, and the trade reverts rather than fill at a worse price.",
    "Launch from the Studio in Express mode with a name, a ticker and an image. Your wallet asks for one free signature and one launch transaction.",
  ],
  glossary: [
    "Short definitions of the words used across ADEXTO, from bonding curve and virtual reserve to slippage and basis point.",
    "Fees and launch rules: the four fee parts, claims, tickers, the launch window and the launch attestation.",
    "Agents and data: ERC-8004, MCP, A2A, x402, factories, indexers and the stake hub.",
  ],
  faq: [
    "Launching needs no liquidity deposit, and the creator gets no tokens: the creator earns a fixed part of every trade instead.",
    "Fees never change after launch, markets never graduate, and each chain is a separate market.",
    "No security firm has reviewed the contracts, nothing here is advice, and a scam market can be reported for removal from ADEXTO's site.",
  ],
  "studio-guide": [
    "Express asks for a name, a ticker and an image and fills in the Standard settings. Advanced sets every option over five steps.",
    "Advanced offers three fee tiers, Low, Standard and Meme, and the tier can never change after launch.",
    "Your wallet asks twice: a free attestation signature, then the launch transaction, which costs gas only.",
  ],
  "agent-launch": [
    "An agent launches over MCP, the REST routes or A2A, and signs the transaction with its own key.",
    "prepare_launch is called twice: once for the attestation message, and once with the signature for the unsigned transaction.",
    "After the transaction is mined, register_launch lists the market on the site and on the x402 gateway, and it is safe to repeat.",
  ],
  "market-page": [
    "A market page shows the price, a chart built from every trade, the depth ladder, the trade feed, the holders and your position.",
    "The swap card shows the minimum you receive and the price impact, and simulates every trade before your wallet opens.",
    "On a phone the page has three tabs: Trade, Market and You.",
  ],
  "finding-markets": [
    "The Explorer lists every market by chain and category, sorted by largest or newest.",
    "Your watchlist is kept in this browser only.",
    "The Leaderboard ranks markets by how many different wallets are buying, and leaves out team wallets and each market's own creator.",
  ],
  "cross-chain": [
    "The Cross-chain tab on the swap page moves MON, ETH, USDC, USDG and 0G between Monad, Arbitrum One, Robinhood Chain, Base and 0G through LI.FI.",
    "You sign the route in your own wallet, a bridge carries the funds, and ADEXTO never holds them.",
    "Each route states a minimum: at least that amount arrives at your own address, or the bridge refunds you.",
  ],
  wallets: [
    "Connect any wallet installed in your browser, or a mobile wallet through WalletConnect. ADEXTO never asks for your seed phrase.",
    "The app asks your wallet to switch to the market's chain, and to add the network if the wallet does not have it.",
    "Gas is paid in each chain's own asset: MON, ETH, USDC on Arc, or 0G.",
  ],
  "creator-earnings": [
    "A creator earns a fixed part of every trade, 0.70% on the Standard tier, in the chain's own asset.",
    "It accrues in the curve and is claimed at Creator earnings, one market at a time or every market on a chain in one transaction.",
    "Anyone can send the claim, and the money always goes to the creator address fixed at launch.",
  ],
  staking: [
    "A stake at or above a market's minimum opens that market's agent over MCP and, where offered, an Agent Compute key.",
    "There is no lock and no reward, and you can unstake at any time.",
    "Each chain has one stake hub for ADEXTO markets, and $ADEXTO and $SAI have stake contracts of their own.",
  ],
  compute: [
    "A stake gives you an API key for an OpenAI-compatible endpoint that serves DeepSeek-V4-Flash through 0G Compute.",
    "Stakes in $ADEXTO and $SAI open fixed tiers. Keys on other markets are funded by half of that market's protocol fee.",
    "It is a beta: usage adds up in tokens, and a key switches off when its allowance is spent or its stake falls below the minimum.",
  ],
  referrals: [
    "Share a link with your code, and the trades it brings carry your address in their transaction data.",
    "You earn 25% of the 0.10% protocol part on the volume you refer, counted weekly from Monday UTC and paid out after a review by hand.",
    "One level only, no self-referrals, no token and no points.",
  ],
  a2a: [
    "ADEXTO's A2A agent, ADEXTO Launchpad, works from JSON data parts over JSON-RPC 2.0.",
    "It can launch a market in one multi-turn task, buy through x402, and read markets.",
    "It answers in version 1.0 when you send the A2A-Version header, and in version 0.3 without it.",
  ],
  "public-api": [
    "Public, read-only endpoints for markets, prices, holders, positions, creator earnings and launch facts.",
    "Contract ABIs, share images and discovery files for agents are served from the same site.",
    "Trade history can also be queried with GraphQL from ADEXTO's Envio indexer and from the subgraphs on The Graph.",
  ],
  telegram: [
    "The ADEXTO bot answers /market, /launch and /earnings.",
    "Group admins can use /alerts to post every buy of up to 10 markets in their group.",
    "The public feed posts every new launch and every buy worth at least $1, and never sells or team buys.",
  ],
  troubleshooting: [
    "Most failed trades come from the launch window cap, the slippage limit, the deadline, or a buy larger than the curve holds.",
    "A wallet on the wrong network is asked to switch, and on Robinhood Chain its RPC may need to point at ADEXTO.",
    "A missing market or trade is usually an indexer catching up: the chain has it as soon as it is mined.",
  ],
  "check-a-market": [
    "The clean-launch proof is read from chain: where the supply went, whether the contracts have an owner or a proxy, and whether the creator's wallet bought early.",
    "A showcase entry was not minted by an ADEXTO factory, and an agent badge only proves who owned the agent id at launch.",
    "No check can see a creator's other wallets or tell you what the price will do.",
  ],
  risks: [
    "Prices move with every trade, and a buyer can lose most of what they paid.",
    "No security firm has reviewed the contracts, and nothing can be upgraded, so a bug cannot be fixed in place.",
    "x402 purchases are not atomic, bridges have their own rules, and anyone can launch a market that imitates a real project.",
  ],
  reporting: [
    "Report a market that impersonates someone, links to malware or breaks the Acceptable Use Policy, through the Report page.",
    "Removal takes it off ADEXTO's site, the x402 gateway, MCP, A2A, the Telegram bot and the aggregator feeds.",
    "The chain is not touched: the contracts keep working, and the ticker stays taken.",
  ],
};
