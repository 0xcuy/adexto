import type { Metadata } from "next";
import { H2, P, UL, PageTitle, Note, Ext, In } from "../_parts";
import { UPDATED } from "../_facts";

export const metadata: Metadata = {
  title: "Report a market — ADEXTO",
  description:
    "How to report a market that looks like a scam, an impersonation or illegal content, what happens next, and what ADEXTO can and cannot do about it.",
};

const REPORT_URL = "https://github.com/0xcuy/adexto/issues/new?template=report-market.yml";

/**
 * Saluran laporan penyalahgunaan.
 *
 * Kontrak tidak punya owner, jadi yang bisa kami lakukan hanya di sisi kami: menolak, menyembunyikan
 * atau mencabut pasar dari situs ini, feed-nya, alat agen kami dan gerbang x402. Halaman ini menyebut
 * batas itu di depan, supaya korban penipuan tidak menunggu pengembalian dana yang tidak mungkin, dan
 * langsung diarahkan ke tempat yang bisa bertindak (polisi, platform tempat penipunya berpromosi).
 *
 * Saluran yang disebut hanya yang benar-benar dibaca: templat issue GitHub `report-market.yml`
 * (`.github/ISSUE_TEMPLATE/`) dan Telegram.
 */
export default function ReportPage() {
  return (
    <>
      <PageTitle updated={UPDATED}>Report a market</PageTitle>

      <P>
        Anyone can launch a market here, and some people will try to use that to deceive others. If a
        market looks like a scam, impersonates someone, or carries illegal content, report it. Reports are
        how markets get removed from this site.
      </P>

      <H2>How to report</H2>
      <UL>
        <li>
          <strong>GitHub</strong> (preferred, public):{" "}
          <Ext href={REPORT_URL}>open a market report</Ext>. The form asks for the chain, the market, the
          reason and your evidence.
        </li>
        <li>
          <strong>Telegram</strong>: <Ext href="https://t.me/adexto">t.me/adexto</Ext>, for anything you
          would rather not post publicly, such as material you should not repost.
        </li>
      </UL>
      <P>A useful report includes:</P>
      <UL>
        <li>The chain and the ticker, plus the token address or the market page URL if you have them.</li>
        <li>Which rule it breaks, from the <In href="/acceptable-use">acceptable use policy</In>.</li>
        <li>
          Evidence: links to where it is promoted, transaction hashes, and what the creator claimed. A
          ticker alone proves nothing, since the same ticker on two chains is two unrelated markets.
        </li>
        <li>
          For a trademark or copyright report, a statement that you own the right or act for the owner.
        </li>
      </UL>
      <Note>
        Do not post child sexual abuse material anywhere, including in a report. Describe where it appears
        and report it to the authorities and to a hotline such as{" "}
        <Ext href="https://www.missingkids.org/gethelpnow/cybertipline">NCMEC CyberTipline</Ext> or{" "}
        <Ext href="https://www.inhope.org/EN">INHOPE</Ext>.
      </Note>

      <H2>What happens next</H2>
      <UL>
        <li>We look at the market and the evidence. There is no fixed response time.</li>
        <li>
          If it breaks the policy, we remove it from adexto.xyz: the explorer and every list, its page,
          purchases through the x402 gateway, the MCP and A2A agent tools, the Telegram feed and the feeds
          we serve to aggregators. Its ticker stays taken on that chain.
        </li>
        <li>We may remove a market without a report, and without notice to its creator.</li>
        <li>We do not disclose who reported a market.</li>
      </UL>

      <H2>What nobody can do</H2>
      <P>
        Removing a market here does not remove it from the blockchain. The contracts have no owner, no
        pause and no blacklist, so nobody, including us, can stop trades made directly against the curve,
        freeze tokens, or return money to anyone. Anyone can also launch a market by calling the factory
        directly, without this site.
      </P>
      <P>
        If you lost money to fraud, report it to the police where you live and to the platform where the
        market was promoted, and give them the transaction hashes. Everything on chain is public and
        permanent, so the creator address and every transfer stay traceable. The{" "}
        <In href="/contact">contact page</In> lists what records exist for legal requests.
      </P>
    </>
  );
}
