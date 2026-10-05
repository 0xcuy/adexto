import type { Metadata } from "next";
import { H2, P, UL, PageTitle, Note, In } from "../_parts";
import { UPDATED } from "../_facts";

export const metadata: Metadata = {
  title: "Privacy — ADEXTO",
  description: "Exactly what adexto.xyz, its agents and its gateway store or send, taken from the source, and what is public forever.",
};

/**
 * Daftar ini diambil dari kode, bukan dari templat, dan diperiksa ulang 5 Okt 2026:
 *
 *   - localStorage: WalletContext, wallet-provider, walletconnect, theme (bawaan gelap), watchlist,
 *     referral-tag, cross-chain-client, CookieConsent (`PREFERENCE_KEYS`)
 *   - IP: `src/lib/rate-limit.ts` (Map di memori), `src/lib/mcp-usage.ts` (hash harian, 60 hari)
 *   - berkas server (`server-store`): projects, telemetry (1.000 trade terakhir), referral-records,
 *     referral-handles, agent-compute-keys, telegram-subs, mcp-usage, market index
 *   - memori: task A2A (6 jam, 2.000), metadata `prepare_launch` (6 jam)
 *   - Worker: Ratelimit Cloudflare per IP, Durable Object nonce per pembayar
 *   - pihak ketiga: RPC, Reown/WalletConnect, router 0G lewat compute.adexto.xyz, 0G storage, Cloudflare
 *
 * Hash IP di mcp-usage memakai tanggal sebagai garam, dan tanggal bukan rahasia. Jadi ia disebut
 * "pseudonymous", tidak "anonymous".
 */
export default function PrivacyPage() {
  return (
    <>
      <PageTitle updated={UPDATED}>Privacy</PageTitle>

      <P>
        ADEXTO has no accounts, no sign-up and no email list. It does not ask for your name, email, phone number
        or identity documents, and it has no profile to build. What follows is the complete list of what is stored
        or sent, taken from the source rather than from a template. It covers adexto.xyz, the MCP server, the A2A
        agent and the x402 gateway.
      </P>

      <H2>Stored in your browser</H2>
      <P>These keys live in your browser&apos;s localStorage. They are not sent to us.</P>
      <UL>
        <li>
          <code className="text-ink">adexto_selected_chain</code>: which chain the interface shows.
        </li>
        <li>
          <code className="text-ink">adexto_wallet_address</code>, <code className="text-ink">adexto_wallet_rdns</code>,{" "}
          <code className="text-ink">adexto_wallet_disconnected</code> and{" "}
          <code className="text-ink">adexto_wc_session</code>: the address last connected, which wallet you picked,
          whether you disconnected it, and whether a WalletConnect session is open. If you use WalletConnect, its
          own library also keeps its session keys (<code className="text-ink">wc@2:…</code>).
        </li>
        <li>
          <code className="text-ink">adexto_theme</code>: written only if you switch theme. Without it the site is
          dark.
        </li>
        <li>
          <code className="text-ink">adexto_watchlist</code>: the markets you starred.
        </li>
        <li>
          <code className="text-ink">adexto_ref</code>: the referral code from a <code className="text-ink">?ref=</code>{" "}
          link, kept for 30 days. When you trade, the referrer&apos;s address is appended to the transaction data,
          so it is public on chain.
        </li>
        <li>
          <code className="text-ink">adexto_swap_settings</code> and <code className="text-ink">adexto_swap_recent</code>:
          your slippage choice and your last cross-chain swaps on /swap.
        </li>
        <li>
          <code className="text-ink">adexto_cookie_consent</code>: your answer to the storage notice.
        </li>
      </UL>
      <P>
        Choosing <strong>Essential only</strong> deletes the chain, address, theme, watchlist and referral keys and
        stops them being written again. The wallet keys stay while a wallet is connected, because the connection
        needs them; clear them from your browser&apos;s site data at any time.
      </P>

      <H2>Cookies and analytics</H2>
      <P>
        We set no cookies and run no analytics, advertising or cross-site tracking. Cookies whose names begin with{" "}
        <code className="text-ink">__cf</code> are set by Cloudflare, which sits in front of this site for TLS and
        bot filtering; our code cannot read them. Cloudflare may add its own Web Analytics at the network level.
      </P>

      <H2>Held on our server</H2>
      <UL>
        <li>
          <strong>IP addresses, in memory only.</strong> Public endpoints, including the MCP server, the A2A agent
          and the RPC proxy, count requests per IP to enforce rate limits. The counters live in the process memory
          and are lost when it restarts. They are never written to disk.
        </li>
        <li>
          <strong>MCP usage counts.</strong> For each day: how many times each MCP tool was called, and a list of
          caller hashes, each the first 16 hex characters of a SHA-256 of that day&apos;s date and the caller&apos;s
          IP. Kept for 60 days. The raw IP is not stored, but the date is not secret, so treat this as pseudonymous,
          not anonymous.
        </li>
        <li>
          <strong>The market registry.</strong> For each listed market: its creator address, name, ticker,
          description, links, image, chain, contract addresses, launch transaction and agent binding. All of it is
          public by design and most of it is also on chain.
        </li>
        <li>
          <strong>Trade records.</strong> The last 1,000 trades read from chain: transaction hash, chain, market,
          amounts, prices, the trading and receiving addresses, and the time.
        </li>
        <li>
          <strong>Referral records.</strong> For a trade that carries a referral: what the chain shows about it
          (transaction, market, wallet, referrer, amount, protocol fee) and its dollar value at the time. A handle
          you register for your referral link is stored with your address. No IP or browser data is stored with
          either.
        </li>
        <li>
          <strong>Agent Compute keys.</strong> For each key: the owner address, the key&apos;s id at the router, its
          first characters, its allowance, its usage counts and the stake read at the last sweep. The full key is
          shown to you once and not stored by us.
        </li>
        <li>
          <strong>Telegram alerts.</strong> For a group that follows markets with the bot: the chat id and title,
          the markets it follows, and the Telegram user id of whoever added them.
        </li>
        <li>
          <strong>Agent tasks, in memory.</strong> An A2A task keeps what you sent for up to six hours (for a
          launch: the deployer address, the market details and the attestation message; for a purchase: the payment
          terms). The signed payment you send is forwarded to the gateway and not kept in the task. Launch details
          prepared over MCP are kept in memory for up to six hours until the launch is registered.
        </li>
        <li>
          <strong>No request logs</strong> are kept beyond the container&apos;s own output, which is not persisted.
        </li>
      </UL>

      <H2>The x402 gateway</H2>
      <UL>
        <li>It rate-limits by IP through Cloudflare&apos;s rate limiter. It does not store IPs.</li>
        <li>
          To stop a payment authorization being used twice, it records each payer address with the nonces of its
          EIP-3009 authorizations until they expire. Signatures are not stored.
        </li>
      </UL>

      <H2>Sent to third parties</H2>
      <UL>
        <li>
          <strong>Cloudflare</strong> carries every request to this site and the gateway.
        </li>
        <li>
          <strong>Blockchain RPC providers.</strong> Your browser reads Monad, Arbitrum One, Base and 0G directly from
          public RPC providers, which see your IP. Robinhood Chain is read through our proxy at{" "}
          <code className="text-ink">/api/public-rpc</code>, which forwards only the request itself, not your IP.
          Your wallet makes its own requests to whichever provider it is set to.
        </li>
        <li>
          <strong>WalletConnect (Reown)</strong>, only if you choose it: your browser and your wallet app talk through
          its relay.
        </li>
        <li>
          <strong>The 0G Compute router.</strong> Chat messages, token-image prompts and questions to a market&apos;s
          agent are sent to it to be answered. Requests made with an Agent Compute key go through our router at
          compute.adexto.xyz to 0G, and each key is named after its owner address there. Do not put anything private
          in a prompt.
        </li>
        <li>
          <strong>0G storage.</strong> Launch metadata is anchored to 0G DA, where it is public and permanent.
        </li>
        <li>
          <strong>Data sources</strong> that receive no personal data: price feeds, indexers (Envio, The Graph) and
          listing checks.
        </li>
        <li>
          <strong>Your wallet</strong> is software on your device with its own privacy policy.
        </li>
      </UL>

      <H2>What is public and permanent</H2>
      <Note>
        A blockchain transaction is public forever and cannot be deleted by us or by you. Your address, the markets
        you launch, every buy, sell and stake, and the metadata a launch anchors to 0G DA are readable by anyone.
        Treat an address you use here as public.
      </Note>

      <H2>Your choices</H2>
      <UL>
        <li>Use the site without connecting a wallet. Prices, markets and documentation all work without one.</li>
        <li>Clear the browser keys above at any time, or choose Essential only in the storage notice.</li>
        <li>Revoke an Agent Compute key yourself on /agent-compute.</li>
        <li>
          Ask us to delete the off-chain records tied to your address, such as a referral handle, through the{" "}
          <In href="/contact">contact page</In>. We cannot delete or change anything on chain.
        </li>
      </UL>
      <P>
        ADEXTO is not meant for anyone under 18. Records listed here may be shared with authorities where the law
        requires it, as described on the <In href="/contact">contact page</In>.
      </P>
    </>
  );
}
