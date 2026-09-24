import Link from "next/link";
import type { Metadata } from "next";
import { H2, P, UL, PageTitle, Note } from "../_parts";

export const metadata: Metadata = {
  title: "Disclaimer — ADEXTO",
  description:
    "The risks of using ADEXTO, stated plainly: unaudited contracts, irreversible trades, and no advice of any kind.",
};

/**
 * Halaman ini sengaja tidak melunak.
 *
 * Penafian biasanya ditulis untuk melindungi penulisnya sambil tetap terdengar meyakinkan. Yang
 * dikerjakan di sini kebalikannya: menyebut hal-hal yang paling mungkin merugikan pembaca, di
 * urutan paling atas, dengan angka kalau angkanya ada.
 *
 * Alasannya praktis, bukan mulia. Seluruh sisa situs ini dibangun di atas klaim yang bisa
 * diperiksa; satu halaman penafian yang memutar-mutar risiko akan menjadi bagian paling lemah
 * dari keseluruhannya, dan ia berdiri persis di tempat orang datang untuk memeriksa.
 */
export default function DisclaimerPage() {
  return (
    <>
      <PageTitle updated="24 September 2026">Disclaimer</PageTitle>

      <Note>
        <strong>Nothing on this site is financial, investment, legal or tax advice.</strong> No page
        here is a recommendation to buy, sell or hold anything. Every figure shown is a measurement,
        not a forecast.
      </Note>

      <H2>The contracts are not audited</H2>
      <P>
        No security firm has audited them. Static analysers have been run and their complete output —
        including findings still open — is published on the{" "}
        <Link href="/security" className="font-semibold text-accent hover:underline">
          security page
        </Link>
        . The deployed bytecode is frozen and cannot be patched, so a bug found tomorrow cannot be
        fixed in a market that already exists. Risk only what you can afford to lose entirely.
      </P>

      <H2>Trades cannot be reversed</H2>
      <P>
        The curves have no owner, no pause switch and no withdrawal function. That is the guarantee
        the design is built on, and it cuts both ways: nobody can seize your tokens, and nobody can
        help you if you buy the wrong market, mistype an amount or send tokens to a wrong address.
      </P>

      <H2>Anyone can create a market, including to deceive you</H2>
      <UL>
        <li>
          Creation is permissionless. A market existing here is not an endorsement, a review or a
          verification of anything about it.
        </li>
        <li>
          A name or ticker proves nothing about who made it. Check the creator address and the
          contract address on a block explorer before buying.
        </li>
        <li>
          The same ticker on two chains is two unrelated tokens with two separate prices. Nothing
          bridges between them.
        </li>
      </UL>

      <H2>These markets are small and prices move violently</H2>
      <P>
        A bonding curve prices from its own reserves, so a single trade can move the price a long way.
        Thin markets can fall to near zero and stay there. There is no market maker with an obligation
        to quote, and no floor under any price.
      </P>

      <H2>$ADEXTO is a market, not a protocol token</H2>
      <P>
        It sits on a curve like every other market here. It carries no governance rights, no revenue
        claim and no promise of any kind. There is no protocol token, no treasury allocation and no
        airdrop: every market&apos;s entire supply enters its curve at genesis, so there is nothing
        held back to distribute.
      </P>

      <H2>Agents act on their own</H2>
      <P>
        The MCP server lets an AI agent quote and execute purchases. An agent is software following a
        model&apos;s output and can be wrong, or can be manipulated by whatever it reads. If you point
        one at these markets, the consequences of its trades are yours.
      </P>

      <H2>This interface can go down</H2>
      <P>
        It is one container on one server behind one proxy. The contracts do not need it and can be
        called directly, but this website going offline is an ordinary event rather than an unthinkable
        one, and it is listed here so nobody is surprised by it.
      </P>

      <H2>Your jurisdiction may not permit this</H2>
      <P>
        Rules on trading digital assets differ by country and some people are not permitted to use
        services like this at all. Establishing your own position, and your own tax obligations, is
        yours to do.
      </P>
    </>
  );
}
