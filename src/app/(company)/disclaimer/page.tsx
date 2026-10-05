import type { Metadata } from "next";
import { H2, P, UL, PageTitle, Note, In } from "../_parts";
import { UPDATED } from "../_facts";

export const metadata: Metadata = {
  title: "Disclaimer — ADEXTO",
  description:
    "The risks of using ADEXTO, stated plainly: unaudited contracts, irreversible trades, markets made by strangers, agents, and no advice of any kind.",
};

/**
 * Halaman ini sengaja tidak melunak.
 *
 * Penafian biasanya ditulis untuk melindungi penulisnya sambil tetap terdengar meyakinkan. Yang
 * dikerjakan di sini kebalikannya: menyebut hal-hal yang paling mungkin merugikan pembaca, di urutan
 * paling atas, dengan angka kalau angkanya ada.
 */
export default function DisclaimerPage() {
  return (
    <>
      <PageTitle updated={UPDATED}>Disclaimer</PageTitle>

      <Note>
        <strong>Nothing on this site is financial, investment, legal or tax advice.</strong> No page here, no
        agent answer and no Agent Score is a recommendation to buy, sell or hold anything. Every figure shown is
        a measurement, not a forecast.
      </Note>

      <H2>The contracts are not audited</H2>
      <P>
        No security firm has audited them. Static analysers have been run and their complete output, including
        findings still open, is published on the <In href="/security">security page</In>. The deployed bytecode
        is frozen and cannot be patched, so a bug found tomorrow cannot be fixed in a market that already exists.
        Risk only what you can afford to lose entirely.
      </P>

      <H2>Trades cannot be reversed</H2>
      <P>
        The curves have no owner, no pause switch and no withdrawal function. That is the guarantee the design is
        built on, and it cuts both ways: nobody can seize your tokens, and nobody can help you if you buy the wrong
        market, mistype an amount or send tokens to a wrong address.
      </P>

      <H2>Anyone can create a market, including to deceive you</H2>
      <UL>
        <li>
          Creation is permissionless, on this site and directly on the factory. A market listed here is not an
          endorsement, a review or a verification of anything about it or about its creator.
        </li>
        <li>
          A name, a ticker, a logo or an ERC-8004 badge proves nothing about who made it. The badge only shows
          that the launcher owned that agent identity at launch. Check the creator address and the contract
          address on a block explorer before buying.
        </li>
        <li>
          The same ticker on two chains is two unrelated tokens with two separate prices. Nothing bridges between
          them.
        </li>
        <li>
          A market removed from this site for breaking the <In href="/acceptable-use">acceptable use policy</In>{" "}
          still exists on chain and can still be traded directly against its curve.
        </li>
      </UL>

      <H2>These markets are small and prices move violently</H2>
      <P>
        A bonding curve prices from its own reserves, so a single trade can move the price a long way. Thin
        markets can fall to near zero and stay there. There is no market maker with an obligation to quote, and
        no floor under any price. Trading so far is small and almost all of it is ours.
      </P>

      <H2>Cross-chain purchases have their own risks</H2>
      <P>
        An x402 purchase runs in two steps on two chains: our relayer buys and delivers the tokens on the
        market&apos;s chain, and only then is your USDC authorization settled on Base. The steps are not atomic. If
        delivery fails you are not charged, and the price you get is the one in the quote, which includes a spread.
      </P>

      <H2>$ADEXTO is a market, not a protocol token</H2>
      <P>
        It sits on a curve like every other market here. It carries no governance rights, no claim on revenue and
        no promise of any kind. Staking it gives access to Agent Compute, a service we run and may change or end;
        that is a use, not a return. There is no treasury allocation and no airdrop: every market&apos;s entire
        supply enters its curve at genesis.
      </P>

      <H2>Agents act on their own</H2>
      <P>
        The MCP server and the A2A agent let an AI agent read markets, launch, buy, stake and claim. An agent is
        software following a model&apos;s output and can be wrong, or can be manipulated by whatever it reads. If
        you point one at these markets, the consequences of its actions are yours. Market agents answer from facts
        read on chain, through a third-party model router, and can still be wrong.
      </P>

      <H2>This interface can go down</H2>
      <P>
        It is one container on one server behind one proxy. The contracts do not need it and can be called
        directly, but this website going offline is an ordinary event, and it is listed here so nobody is
        surprised by it.
      </P>

      <H2>Your jurisdiction may not permit this</H2>
      <P>
        Rules on digital assets differ by country, and some people are not permitted to use services like this at
        all. Establishing your own position, and your own tax obligations, is yours to do. The{" "}
        <In href="/terms">terms</In> say who may use ADEXTO.
      </P>
    </>
  );
}
