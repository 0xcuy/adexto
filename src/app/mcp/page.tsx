import Link from "next/link";
import { exampleMarkets } from "@/lib/registry";
import { ArrowRight, Coins, Plug, ShieldCheck, Terminal, Wrench } from "lucide-react";

/**
 * Halaman dokumentasi server MCP.
 *
 * KENAPA HALAMAN, BUKAN TAUTAN LANGSUNG KE ENDPOINT
 *
 * Tautan di footer harus membuka sesuatu yang bisa dibaca orang. `/api/mcp` adalah
 * endpoint JSON-RPC: dibuka di browser ia menjawab galat, bukan penjelasan. Jadi footer
 * menunjuk ke sini, dan halaman ini yang menyebutkan URL-nya untuk disalin.
 *
 * KENAPA TERPISAH DARI /x402
 *
 * /x402 mendokumentasikan format kabelnya — bentuk 402, EIP-3009, kode status. Yang
 * dibutuhkan pemakai MCP berbeda: potongan konfigurasi klien dan daftar nama alat. Dua
 * pembaca, dua halaman, satu gerbang di belakang keduanya.
 *
 * SEMUA NAMA ALAT DI SINI DIBACA DARI SERVER YANG SAMA
 *
 * Enam baris di tabel adalah enam `registerTool` di `src/app/api/[transport]/route.ts`.
 * Kalau daftarnya berubah, `tools/list` yang jadi acuan, bukan halaman ini.
 */

export const metadata = {
  title: "MCP server — ADEXTO",
  description:
    "Model Context Protocol server for ADEXTO's x402 cross-chain buys. Six tools: list markets, quote a buy, read trade history, and pay with USDC on Base to receive tokens on another chain.",
};

const TOOLS: { name: string; cost: string; what: string }[] = [
  {
    name: "list_markets",
    cost: "Free",
    what: "Every tradable market, with its chain, curve address and which read path serves its history. Start here.",
  },
  {
    name: "get_market",
    cost: "Free",
    what: "One market in detail: supply, fee rates, current price in the chain's native asset, launch transaction.",
  },
  {
    name: "quote_buy",
    cost: "Free",
    what: "Returns the HTTP 402 challenge — amount, asset, payTo, EIP-712 domain — without spending anything.",
  },
  {
    name: "how_to_pay",
    cost: "Free",
    what: "The exact steps from challenge to settled buy: what to sign, which chain settles, which header carries it.",
  },
  {
    name: "buy_token",
    cost: "0.10 USDC on Base",
    what: "Executes the buy. Without a payment header it returns the 402 challenge; with one it settles and the curve delivers.",
  },
  {
    name: "trade_history",
    cost: "Free",
    what: "Every swap on a market, newest first, with an explicit statement of whether the answer reaches the launch block.",
  },
];

export default function McpPage() {
  const examples = exampleMarkets();
  const sample = examples[0]?.symbol ?? "PARCEL";

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
      {/* Header */}
      <div className="border-b-2 border-line pb-6 mb-10">
        <div className="kicker mb-3">
          <Plug className="w-4 h-4 text-accent" />
          <span>MODEL CONTEXT PROTOCOL</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold text-ink">MCP server</h1>
        <p className="text-sm text-ink mt-3 font-medium leading-relaxed">
          An agent can find every ADEXTO market, price one, and buy it — paying{" "}
          <strong className="text-ink">USDC on Base</strong> while the tokens are delivered by a bonding curve on
          another chain. No bridging, no gas on the destination chain, no account here.
        </p>
        <p className="text-xs text-ink-soft mt-3 leading-relaxed">
          The gateway already spoke HTTP 402, which any program can use. What it could not do was announce
          itself: a caller had to be told the URL, the path shape and the ticker before it could find anything.
          MCP is the discovery layer — one <code className="text-accent">tools/list</code> hands over the whole
          surface with schemas.
        </p>
      </div>

      {/* Endpoint */}
      <div className="section-block mb-4 space-y-4">
        <div className="kicker">
          <ArrowRight className="w-4 h-4 text-accent" />
          <span>THE ENDPOINT</span>
        </div>
        <h2 className="text-2xl font-semibold text-ink tracking-tight">Point a client at it</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          Streamable HTTP, no authentication and no API key. Five of the six tools cost nothing, so a client can
          connect and read every market before any wallet is involved.
        </p>
        <div className="p-3 rounded-lg bg-white border border-line font-mono text-[11px] sm:text-xs text-ink-soft overflow-x-auto">
          <div className="whitespace-pre">https://adexto.xyz/api/mcp</div>
        </div>
        <p className="text-xs text-ink-soft leading-relaxed">
          For a client that reads a JSON config, that is the whole entry:
        </p>
        <div className="p-3 rounded-lg bg-white border border-line font-mono text-[11px] sm:text-xs text-ink-soft overflow-x-auto">
          <pre className="whitespace-pre">{`{
  "mcpServers": {
    "adexto": {
      "url": "https://adexto.xyz/api/mcp"
    }
  }
}`}</pre>
        </div>
        <p className="text-xs text-ink-soft leading-relaxed">
          Opening that URL in a browser returns a JSON-RPC error rather than a page, which is correct: it is an
          endpoint for programs. To check it by hand, ask it what it can do:
        </p>
        <div className="p-3 rounded-lg bg-white border border-line font-mono text-[11px] sm:text-xs text-ink-soft overflow-x-auto">
          <pre className="whitespace-pre">{`curl -X POST https://adexto.xyz/api/mcp \\
  -H 'content-type: application/json' \\
  -H 'accept: application/json, text/event-stream' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}</pre>
        </div>
      </div>

      {/* Tools */}
      <div className="section-block mb-4 space-y-4">
        <div className="kicker">
          <Wrench className="w-4 h-4 text-accent" />
          <span>THE TOOLS</span>
        </div>
        <h2 className="text-2xl font-semibold text-ink tracking-tight">Six tools, one of them paid</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line">
                <th className="py-2 pr-4 font-bold text-ink uppercase tracking-wider text-[10px]">Tool</th>
                <th className="py-2 pr-4 font-bold text-ink uppercase tracking-wider text-[10px]">Cost</th>
                <th className="py-2 font-bold text-ink uppercase tracking-wider text-[10px]">What it returns</th>
              </tr>
            </thead>
            <tbody>
              {TOOLS.map((t) => (
                <tr key={t.name} className="border-b border-line/60 align-top">
                  <td className="py-3 pr-4 font-mono text-accent font-bold whitespace-nowrap">{t.name}</td>
                  <td className="py-3 pr-4 text-ink-soft whitespace-nowrap">{t.cost}</td>
                  <td className="py-3 text-ink-soft leading-relaxed">{t.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Ini bukan hiasan. Ketiadaan default adalah alasan gerbang menjawab
            `400 symbol_required`, dan itu justru yang mencegah salah ketik menagih
            token yang tidak diminta. */}
        <p className="text-xs text-ink-soft leading-relaxed">
          Every tool requires a ticker and none supplies a default. A missing ticker is refused rather than
          quoted, so a typo can never bill for a token nobody asked for. Call{" "}
          <code className="text-accent">list_markets</code> first — today it answers with{" "}
          <strong className="text-ink">${sample}</strong> among others.
        </p>
      </div>

      {/* Payment */}
      <div className="section-block mb-4 space-y-4">
        <div className="kicker">
          <Coins className="w-4 h-4 text-accent" />
          <span>PAYING</span>
        </div>
        <h2 className="text-2xl font-semibold text-ink tracking-tight">A 402 is the first answer, not a failure</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          <code className="text-accent">buy_token</code> called without a payment returns the challenge. That is
          the quote: it carries the amount, the asset, the recipient and the EIP-712 domain to sign against.
        </p>
        <ol className="space-y-2 text-xs text-ink-soft leading-relaxed list-decimal pl-5">
          <li>
            Call <code className="text-accent">quote_buy</code> to read the challenge without paying.
          </li>
          <li>
            Sign an EIP-3009 <code className="text-accent">transferWithAuthorization</code> for the quoted amount
            of USDC on Base, with a random nonce.
          </li>
          <li>
            Base64-encode the x402 payload and pass it to <code className="text-accent">buy_token</code> as{" "}
            <code className="text-accent">xPayment</code>. It travels in the{" "}
            <code className="text-accent">X-PAYMENT</code> header — one name, no alias.
          </li>
          <li>
            The curve on the market&apos;s own chain sends the tokens straight to the address you named. Both
            transaction hashes come back in the response.
          </li>
        </ol>
        <p className="text-xs text-ink-soft leading-relaxed">
          Delivery runs before the charge, so a failed fill costs us rather than the caller. Every refusal —
          unknown market, not tradable, out of inventory — happens before an authorization is spent, and the
          token contract&apos;s own replay check means one signed authorization can never be spent twice. The
          wire format is documented in full on the{" "}
          <Link href="/x402" className="text-accent hover:underline font-medium">
            x402 reference
          </Link>
          .
        </p>
      </div>

      {/* What it is not */}
      <div className="section-block space-y-4">
        <div className="kicker">
          <ShieldCheck className="w-4 h-4 text-accent" />
          <span>SCOPE</span>
        </div>
        <h2 className="text-2xl font-semibold text-ink tracking-tight">It is an adapter, deliberately</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          No signing, settlement or payment verification happens in the MCP server. Every tool forwards to
          something already running: the x402 gateway, the market registry, and the indexer. The 402 an agent
          receives is the gateway&apos;s own challenge, passed through untouched.
        </p>
        <p className="text-xs text-ink-soft leading-relaxed">
          A second implementation of the payment path would mean two definitions of what a valid payment is, and
          the one that drifts is the one nobody is testing. Status codes are passed through for the same reason:
          an agent that cannot tell <code className="text-accent">402 pay me</code> from{" "}
          <code className="text-accent">404 no such market</code> will retry the wrong one forever.
        </p>
        <div className="flex items-start gap-3 rounded-2xl border border-line bg-white p-4">
          <Terminal className="w-4 h-4 text-accent shrink-0 mt-0.5" />
          {/* Kalimat lama: "Trade history is Monad only." Itu salah, dan salahnya bukan
              soal kata — alatnya memang menolak 0G padahal riwayat 0G lengkap dan sudah
              dipajang halaman token. Penjaganya sekarang jangkauan yang terukur, bukan
              daftar chain. */}
          <p className="text-xs leading-relaxed text-ink-soft">
            <strong className="text-ink">History states its own reach.</strong> Monad is served by an indexer,
            which has no lookback window. The other chains are served by a log scan, and how far it got is
            reported on every call: <code className="text-accent">complete</code> is true only when the scan
            reached the market&apos;s launch block, and since the curve is created in the same transaction as the
            token, nothing can exist before it. When it is false the answer says so, because a short list must
            never be mistaken for a market that has never traded.
          </p>
        </div>
      </div>
    </div>
  );
}
