import Link from "next/link";
import type { Metadata } from "next";
import { H2, P, UL, PageTitle, Note } from "../_parts";

export const metadata: Metadata = {
  title: "About — ADEXTO",
  description:
    "What ADEXTO is, who builds it, and what it deliberately does not claim to be.",
};

/**
 * KENAPA HALAMAN INI TIDAK MENYEBUT PERUSAHAAN
 *
 * Bagian footer-nya berjudul "Company" karena itu kata yang dicari orang, tapi tidak ada badan
 * hukum untuk disebut — tidak ada perusahaan terdaftar, tidak ada kantor, tidak ada yurisdiksi
 * yang bisa dituliskan dengan benar. Mengarang salah satunya di halaman yang justru ada untuk
 * membangun kepercayaan adalah kesalahan terburuk yang bisa dilakukan halaman ini, dan
 * satu-satunya klaim di seluruh situs yang tidak bisa diperiksa siapa pun.
 *
 * Jadi halaman ini menjelaskan proyeknya, dan menyebut ketidakhadiran itu apa adanya.
 */
export default function AboutPage() {
  return (
    <>
      <PageTitle updated="24 September 2026">About ADEXTO</PageTitle>

      <P>
        ADEXTO is a market venue. One transaction opens a live market on a bonding curve, and it
        trades from its first block — no liquidity deposit, no founder allocation, no listing queue.
        It runs on four mainnets: 0G, Base, Arbitrum One and Monad.
      </P>

      <H2>What arrives with a market</H2>
      <UL>
        <li>
          A terminal built for something minutes old: candles from one second upward, an order book
          and a live trade feed.
        </li>
        <li>
          A price a buyer can pay from another chain. Holding only USDC elsewhere is enough — no
          bridge, and the buyer never has to hold the market&apos;s gas token.
        </li>
        <li>
          An MCP server, so an AI agent can list markets, pull a quote and execute a buy on its own.
        </li>
      </UL>

      <H2>Who builds it</H2>
      <P>
        A single independent developer. There is no company behind ADEXTO, no registered entity, no
        office and no staff — and this page says so rather than implying otherwise, because it is the
        one claim on this site nobody could verify for themselves.
      </P>
      <P>
        Everything else is checkable. The contracts, the indexer, the gateway and this website are
        public at{" "}
        <a
          href="https://github.com/0xcuy/adexto"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-accent hover:underline"
        >
          github.com/0xcuy/adexto
        </a>
        , and the deployed addresses are listed in the{" "}
        <Link href="/docs" className="font-semibold text-accent hover:underline">
          docs
        </Link>
        .
      </P>

      <H2>What it is not</H2>
      <Note>
        The contracts have never been audited by a firm. On-chain volume is small. Nothing here is a
        regulated product, and nothing on this site is financial advice. The{" "}
        <Link href="/disclaimer" className="font-semibold text-accent hover:underline">
          disclaimer
        </Link>{" "}
        and the{" "}
        <Link href="/security" className="font-semibold text-accent hover:underline">
          security page
        </Link>{" "}
        state the limits in detail, including the output of every analyser that has been run against
        the contracts.
      </Note>

      <H2>Recognition</H2>
      <P>
        ADEXTO is one of eight projects named in the 0G Atlas Founder House Demo Day line-up and
        appears in 0G&apos;s own A2A economy landscape. Each item links to its source on the{" "}
        <Link href="/recognition" className="font-semibold text-accent hover:underline">
          recognition page
        </Link>
        , including the places where their wording differs from ours.
      </P>
    </>
  );
}
