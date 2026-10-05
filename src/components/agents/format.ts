/** Helper tampilan bersama halaman `/agents/*`. */

export const MCP_URL = "https://adexto.xyz/api/mcp";

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const fmt = (v: number, digits = 2) => v.toLocaleString("en-US", { maximumFractionDigits: digits });
export const when = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/** Bobot Agent Score, cermin `src/lib/agent-score.ts`. */
export const WEIGHTS: Array<[string, number, string]> = [
  ["Outside traders", 30, "6 per wallet outside ADEXTO that traded, up to 5 wallets"],
  ["Outside volume", 20, "linear up to $200 traded by outside wallets, at the live native price"],
  ["Outside holders", 15, "3 per outside holder, up to 5"],
  ["Launch", 10, "5 if 100% of supply went into the curve at launch (factory event), 5 if the creator now holds at most 5%"],
  ["ERC-8004 identity", 10, "5 if the token is bound to an ERC-8004 agent, 5 if the creator owns that agent"],
  ["x402 deliveries", 10, "2 per x402 delivery to an outside wallet, up to 5"],
  ["Age", 5, "1 per 6 days since launch, up to 5"],
];
