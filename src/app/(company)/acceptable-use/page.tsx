import type { Metadata } from "next";
import { H2, P, UL, PageTitle, Note, In } from "../_parts";
import { UPDATED } from "../_facts";

export const metadata: Metadata = {
  title: "Acceptable use — ADEXTO",
  description:
    "What may not be launched, promoted or done through ADEXTO, and what happens to a market that breaks the rules.",
};

/**
 * Kebijakan penggunaan yang dapat diterima: bagian dari /terms.
 *
 * Ditulis global, tanpa menyebut undang-undang negara tertentu: larangannya dirumuskan sebagai
 * perbuatan (menipu, menyamar, mencuci uang), yang dilarang hampir di mana pun, bukan sebagai
 * kepatuhan pada satu rezim hukum yang tidak bisa kami klaim.
 *
 * Konsekuensinya hanya yang benar-benar bisa kami lakukan, dan sumbernya di kode: menolak listing
 * (`checkSymbolAvailable`), mencabut dari situs dan layanan kami (`src/config/delisted-markets.ts`),
 * mencabut kunci Agent Compute. Kontrak tidak bisa disentuh siapa pun, dan halaman ini mengatakannya.
 */
export default function AcceptableUsePage() {
  return (
    <>
      <PageTitle updated={UPDATED}>Acceptable use</PageTitle>

      <P>
        This policy is part of the <In href="/terms">terms</In>. It applies to everyone who uses ADEXTO: people
        and agents, creators and buyers, through this site, the MCP server, the A2A agent, the x402 gateway or
        the contracts directly.
      </P>

      <H2>Do not launch, promote or trade a market for</H2>
      <UL>
        <li>
          <strong>Fraud.</strong> A planned rug pull or pump and dump, fake volume to lure buyers, or false
          claims about a team, a partnership, a listing, a product or a return.
        </li>
        <li>
          <strong>Impersonation.</strong> Posing as a person, a brand, a project, a public figure, a government
          or an institution, or as ADEXTO, including with a lookalike name, ticker, logo or link.
        </li>
        <li>
          <strong>Infringement.</strong> Using someone else&apos;s trademark, artwork or other protected work
          without permission.
        </li>
        <li>
          <strong>Investment schemes.</strong> Offering a token as a share of profits, a promise of returns, a
          pyramid or Ponzi scheme, or a securities offering that the law requires to be registered or licensed.
        </li>
        <li>
          <strong>Financial crime.</strong> Money laundering, terrorist financing, sanctions evasion, or moving
          the proceeds of crime.
        </li>
        <li>
          <strong>Harmful content.</strong> Child sexual abuse material, sexual content made or shared without
          consent, content that promotes terrorism, incites violence, or attacks people for their race,
          ethnicity, religion, gender, sexual orientation or disability.
        </li>
        <li>
          <strong>Malicious links.</strong> Phishing, malware, wallet drainers, or anything that asks for a seed
          phrase or private key, in a description, a link or an image.
        </li>
        <li>
          <strong>Illegal goods and services.</strong> Including illegal gambling, drugs and weapons.
        </li>
      </UL>

      <H2>Do not abuse ADEXTO itself</H2>
      <UL>
        <li>
          Do not manipulate the numbers this site shows: wash trading to climb the leaderboard or an Agent
          Score, or self-referral and fake referrals.
        </li>
        <li>
          Do not attack or overload the site, the gateway, the agents or the RPC proxies, or get around their
          rate limits. Report vulnerabilities as described in{" "}
          <a
            href="https://github.com/0xcuy/adexto/blob/main/SECURITY.md"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-accent hover:underline"
          >
            SECURITY.md
          </a>{" "}
          instead.
        </li>
        <li>
          Do not use an agent to do anything on this list. An agent&apos;s actions are its operator&apos;s.
        </li>
      </UL>

      <H2>What happens to a market that breaks these rules</H2>
      <UL>
        <li>
          Some patterns are refused automatically before a launch is prepared: names that pose as official, as a
          giveaway, as ADEXTO or as a well-known exchange or issuer, descriptions that ask for a recovery phrase or
          promise guaranteed returns, and links through URL shorteners, to bare IP addresses or to lookalike
          domains. Passing these checks does not mean a market is allowed.
        </li>
        <li>
          We refuse to list it, or remove it from this site, the x402 gateway, the MCP and A2A tools, the Telegram
          feed and the feeds we serve to aggregators. Its page then says it was removed and why, and the removal is
          recorded with its reason in the public repository.
        </li>
        <li>We may also refuse service to the addresses involved and switch off their Agent Compute keys.</li>
        <li>
          Where the law requires it, or where people are at risk, we may pass what we hold to the authorities.
          The <In href="/contact">contact page</In> lists what that is.
        </li>
      </UL>
      <Note>
        Removal here does not remove anything from the blockchain. The contracts have no owner, so the token
        and its curve keep existing, and nobody, including us, can freeze them or return funds. Check a market
        before buying, and read the <In href="/disclaimer">disclaimer</In>.
      </Note>

      <H2>Reporting</H2>
      <P>
        Seen a market that breaks this policy? <In href="/report">Report a market</In>.
      </P>
    </>
  );
}
