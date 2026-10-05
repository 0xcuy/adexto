import type { Metadata } from "next";
import { H2, P, UL, PageTitle, Note, Ext, In } from "../_parts";
import { LISTED_MARKETS, MCP_TOOL_COUNT, REPOS, UPDATED, chainCountWord, chainSentence } from "../_facts";

export const metadata: Metadata = {
  title: "About — ADEXTO",
  description:
    "What ADEXTO is, what arrives with a market, who builds it, and what it deliberately does not claim to be.",
};

/**
 * KENAPA HALAMAN INI TIDAK MENYEBUT PERUSAHAAN
 *
 * Bagian footer-nya berjudul "Company" karena itu kata yang dicari orang, tapi tidak ada badan
 * hukum untuk disebut — tidak ada perusahaan terdaftar, tidak ada kantor, tidak ada yurisdiksi
 * yang bisa dituliskan dengan benar. Mengarang salah satunya di halaman yang justru ada untuk
 * membangun kepercayaan adalah kesalahan terburuk yang bisa dilakukan halaman ini.
 *
 * Isinya mengikuti README ("Honest status"), dan angka yang bisa dibaca dari kode diambil dari
 * `../_facts`, bukan ditulis tangan. Versi sebelumnya menulis "four mainnets" dengan tangan dan
 * tertinggal begitu Robinhood Chain hidup.
 */
export default function AboutPage() {
  return (
    <>
      <PageTitle updated={UPDATED}>About ADEXTO</PageTitle>

      <P>
        ADEXTO is market infrastructure for the agent economy. One transaction opens a market on a
        bonding curve: a token with its whole supply inside its own curve, no liquidity deposit, no
        allocation to the creator, and trading from its first block. The creator, a person or an AI
        agent, is paid from every trade instead of holding tokens. Other agents can find the market
        and buy it, paying USDC from another chain.
      </P>
      <P>
        It runs on {chainCountWord} mainnets: {chainSentence}. Every new launch goes through the same
        factory, <code className="text-ink">AdextoFactory 1.0.0</code>, byte-identical on every chain
        and an exact match on Sourcify. {LISTED_MARKETS} markets are listed on this site today.
      </P>

      <H2>What arrives with a market</H2>
      <UL>
        <li>
          <strong>A curve with fixed terms.</strong> Every fee leg is immutable from the launch block.
          On the standard preset a trade pays 1.00%: 0.70% to the creator, 0.10% to depth, 0.10% to the
          buyback vault and 0.10% to the protocol. No contract has an owner, a setter or a withdrawal
          function.
        </li>
        <li>
          <strong>An optional agent identity.</strong> A launch can be bound to an ERC-8004 agent. The
          factory reads <code className="text-ink">ownerOf</code> from the Identity Registry and refuses
          the launch unless the launcher owns that agent, and the token records the binding permanently.
        </li>
        <li>
          <strong>A terminal.</strong> Candles from one second upward, an order book, a live trade feed,
          holders and positions, all read from chain.
        </li>
        <li>
          <strong>Cross-chain buyers.</strong> The x402 gateway sells any listed market for USDC on Base.
          The buyer signs one EIP-3009 authorization, the curve on the market&apos;s own chain delivers
          the tokens first, and only then is the USDC settled. The buyer needs no gas on that chain and no
          bridge.
        </li>
        <li>
          <strong>Agent access.</strong> An MCP server with {MCP_TOOL_COUNT} tools, and an A2A agent. An
          agent can list and read markets, launch its own market, buy with x402, stake and claim. Every
          launch, stake and claim is signed by the agent&apos;s own key: the server prepares the
          transaction and never holds that key.
        </li>
        <li>
          <strong>Staking and compute.</strong> Any market can be staked in its chain&apos;s stake hub
          from its first block. A stake opens the market&apos;s agent over MCP and can be exchanged for an
          API key to the 0G Compute router (Agent Compute).
        </li>
        <li>
          <strong>Creator earnings.</strong> <In href="/creator">/creator</In> shows what any address has
          earned on every chain and claims it, per market or per chain in one transaction.
        </li>
      </UL>

      <H2>Who builds it</H2>
      <P>
        A single independent developer. There is no company behind ADEXTO, no registered entity, no
        office and no staff. This page says so rather than implying otherwise, because it is the one claim
        on this site nobody could check for themselves.
      </P>
      <P>Everything else is public:</P>
      <UL>
        {REPOS.map((r) => (
          <li key={r.name}>
            <Ext href={`https://github.com/${r.name}`}>{r.name}</Ext>: {r.what}
          </li>
        ))}
      </UL>
      <P>
        Deployed addresses for every chain are in the <In href="/docs">docs</In>, and the{" "}
        <In href="/security">security page</In> lists commands that check the deployed contracts
        against the source yourself.
      </P>

      <H2>What it is not</H2>
      <Note>
        The contracts have not been audited by a security firm. Trading so far is small and almost all of
        it is ours: our own test trades, demo wallets and deliveries through our relayer. That proves the
        paths work, not that there is outside demand. A market listed here is not endorsed, reviewed or
        verified by ADEXTO. Nothing here is a regulated product and nothing on this site is financial
        advice. The <In href="/disclaimer">disclaimer</In> and the <In href="/terms">terms</In> state the
        limits in detail.
      </Note>

      <H2>Rules for markets</H2>
      <P>
        Anyone can launch, and the contracts cannot be stopped by anyone, including us. What we control is
        this site and the services around it. The <In href="/acceptable-use">acceptable use policy</In>{" "}
        says what may not be launched or done here, and <In href="/report">Report a market</In> is where
        to flag one that breaks it.
      </P>

      <H2>Recognition</H2>
      <P>
        ADEXTO is one of eight projects named in the 0G Atlas Founder House Demo Day line-up and appears in
        0G&apos;s own A2A economy landscape. Each item links to its source on the{" "}
        <In href="/recognition">recognition page</In>, including the places where their wording differs
        from ours.
      </P>
    </>
  );
}
