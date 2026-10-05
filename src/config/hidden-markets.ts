/**
 * Pasar yang TIDAK ditampilkan di daftar publik mana pun, tapi tetap utuh dan bisa dibuka.
 *
 * Kegunaannya pasar uji milik kami sendiri: dijalankan di mainnet supaya alurnya terbukti (launch,
 * beli lintas chain), tapi tidak dipajang di samping pasar sungguhan. Kuncinya `chainId:SYMBOL`
 * (sama dengan `marketKey`), jadi pasar bisa disembunyikan SEBELUM diluncurkan — tidak ada jeda
 * ketika ia sempat terdaftar dan terlihat.
 *
 * Yang disaring (lewat `listPublicProjects`): explorer dan `/api/graphql`, `/agents` dan `/api/agents`,
 * leaderboard, `list_markets` di MCP dan A2A, contoh di halaman protokol, Telegram, DexScreener, dan
 * agen ERC-8004 yang terikat ke pasar ini di `/.well-known/agent-registration.json`.
 *
 * Yang TIDAK disaring, dan memang harus begitu: halaman token lewat URL langsung, `/api/pool`
 * (gateway x402 mencari pasar lewat sini, jadi pembelian tetap jalan), `get_market`, `quote_buy`,
 * `buy_token`, kartu registrasi agennya, dan pemeriksaan ticker (ticker tetap terpakai).
 *
 * "Tersembunyi" hanya berarti tidak dipajang di situs ini. Token, kurva dan identitasnya publik di chain.
 */
export const HIDDEN_MARKETS: ReadonlySet<string> = new Set([
  // Pasar uji end-to-end 5 Okt 2026: Agent A meluncurkan lewat MCP, Agent B membeli lewat A2A x402.
  "42161:ARBTTEST",
  // Pasar uji Arc, disembunyikan sebelum diluncurkan: alur yang sama (MCP launch, A2A x402 buy)
  // direkam bersama video demo setelah factory Arc di-broadcast.
  "5042:ARCTEST",
]);

/** True bila pasar ini tidak boleh muncul di daftar publik. */
export function isHiddenMarket(chainId: number, symbol: string | null | undefined): boolean {
  if (!symbol) return false;
  return HIDDEN_MARKETS.has(`${Number(chainId)}:${String(symbol).toUpperCase()}`);
}
