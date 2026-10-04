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

export const DOC_GROUPS: readonly DocNavGroup[] = [
  { label: "Start", items: [{ slug: null, href: "/docs", label: "What is ADEXTO" }] },
  { label: "Launch", items: [item("launch", "Launch a market"), item("fees", "Fees"), item("agent-identity", "Agent identity")] },
  { label: "Trade", items: [item("trading", "Trading"), item("chains", "Chains")] },
  { label: "Build", items: [item("mcp", "MCP server"), item("x402", "Buy with x402"), item("data", "Market data")] },
  {
    label: "Trust",
    items: [item("security", "Security"), { slug: null, href: "/docs#contracts", label: "Contracts and status" }],
  },
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
    "The same factory, version 1.0.0, runs on Monad, Arbitrum One, Robinhood Chain, Base and 0G.",
    "Its runtime code is byte-for-byte identical on all five, and you can check the hash yourself.",
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
    "History is read differently per chain: subgraphs, Envio HyperIndex on Monad, or direct RPC log scans.",
  ],
  security: [
    "Nothing on the launch path has an owner or a setter, and no function can drain a curve.",
    "There is no proxy and no upgrade path, so a fix cannot reach a market that already exists.",
    "No security firm has reviewed the contracts. Analyser output is published, and findings go through GitHub private vulnerability reporting.",
  ],
};
