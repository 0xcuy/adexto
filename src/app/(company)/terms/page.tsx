import Link from "next/link";
import type { Metadata } from "next";
import { H2, P, UL, PageTitle, Note } from "../_parts";

export const metadata: Metadata = {
  title: "Terms — ADEXTO",
  description: "The terms for using adexto.xyz and the ADEXTO contracts.",
};

/**
 * Tidak ada yurisdiksi, tidak ada badan hukum, tidak ada klausul arbitrase.
 *
 * Templat syarat-dan-ketentuan standar menyebut "hukum negara X" dan "perusahaan Y". Keduanya
 * tidak ada di sini, dan mengisinya dengan nama yang tidak terdaftar akan membuat seluruh
 * dokumen ini tidak bisa dipercaya — termasuk bagian yang benar.
 *
 * Yang ditulis hanyalah yang bisa dipertahankan: apa yang perangkat lunaknya lakukan, apa yang
 * TIDAK bisa dilakukan siapa pun terhadapnya, dan tanggung jawab siapa.
 */
export default function TermsPage() {
  return (
    <>
      <PageTitle updated="24 September 2026">Terms</PageTitle>

      <P>
        Using adexto.xyz or the ADEXTO contracts means accepting what follows. If any part of it is
        unacceptable to you, do not use them.
      </P>

      <H2>What ADEXTO provides</H2>
      <P>
        Software. This site is an interface to smart contracts deployed on public blockchains. It is
        not a broker, an exchange operator, a custodian or a financial institution. It never holds
        your funds: every transaction is signed by your own wallet and settled by the contracts.
      </P>

      <H2>No warranty</H2>
      <Note>
        Everything here is provided as is, without warranty of any kind. The contracts{" "}
        <strong>have never been audited by a security firm</strong>. Analyser output is published in
        full on the{" "}
        <Link href="/security" className="font-semibold text-accent hover:underline">
          security page
        </Link>{" "}
        including findings that remain open. Assume software this young contains bugs, and risk only
        what you can afford to lose entirely.
      </Note>

      <H2>Things nobody can undo</H2>
      <UL>
        <li>
          <strong>Trades are final.</strong> The curves have no owner and no withdrawal function.
          There is no administrator who can reverse a swap, freeze a market or recover funds.
        </li>
        <li>
          <strong>Tickers are permanent.</strong> A symbol is claimed for good on each chain when a
          market is created. No function exists to release one.
        </li>
        <li>
          <strong>On-chain data is permanent.</strong> Launch metadata anchored to 0G DA and every
          transaction stay public forever.
        </li>
      </UL>

      <H2>Your responsibilities</H2>
      <UL>
        <li>
          Keeping your keys safe. A lost key means lost funds, and nobody can restore access for you.
        </li>
        <li>
          Checking what you are buying. A ticker on two chains is two unrelated tokens with two
          prices; the name alone tells you nothing about who created it.
        </li>
        <li>
          Your own legal and tax position, wherever you are. Some people are not permitted to use
          services like this at all, and establishing that is on you.
        </li>
        <li>
          What you launch. Do not create markets that infringe someone else&apos;s trademark,
          impersonate a person or project, or are intended to defraud buyers.
        </li>
      </UL>

      <H2>Fees</H2>
      <P>
        Trading fees are set per market at creation and are visible on each market&apos;s page before
        you trade. Creating a market costs blockchain gas only — there is no listing fee and no
        liquidity deposit. Cross-chain purchases through the x402 gateway carry a spread that is
        quoted to you before payment.
      </P>

      <H2>Availability</H2>
      <P>
        This website can go down. It is one container on one server, and that is stated plainly rather
        than dressed up. The contracts do not depend on it: they keep running whether this interface
        is reachable or not, and they can be called directly.
      </P>

      <H2>Limitation of liability</H2>
      <P>
        To the fullest extent permitted by law, the developer of ADEXTO is not liable for any loss
        arising from use of this site or the contracts, including losses from bugs, from a chain or RPC
        provider failing, from the price of any market moving, or from a market created by somebody
        else.
      </P>

      <H2>Changes</H2>
      <P>
        These terms may change. The date at the top is the only notice given, and the history of every
        change is public in the repository.
      </P>
    </>
  );
}
