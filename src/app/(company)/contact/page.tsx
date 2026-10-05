import type { Metadata } from "next";
import { H2, P, UL, PageTitle, Note, Ext, In } from "../_parts";
import { UPDATED } from "../_facts";

export const metadata: Metadata = {
  title: "Contact — ADEXTO",
  description: "How to reach ADEXTO, which channel to use for what, and how legal and law-enforcement requests are handled.",
};

/**
 * Hanya kanal yang BENAR-BENAR dibaca.
 *
 * Tidak ada formulir dan tidak ada kotak masuk pendukung: tidak ada endpoint yang menerima
 * formulir itu, dan tidak ada kotak masuk yang dijaga. Formulir yang mengirim ke tempat yang tidak
 * dibaca lebih buruk daripada tidak ada formulir.
 *
 * Bagian permintaan hukum menyebut APA YANG KAMI PUNYA, bukan menjanjikan kerja sama yang tidak bisa
 * diberikan: situs ini tidak menyimpan akun, nama, email, atau log permintaan (lihat /privacy).
 */
export default function ContactPage() {
  return (
    <>
      <PageTitle updated={UPDATED}>Contact</PageTitle>

      <P>
        Every channel below is one that actually gets read. There is no contact form and no support inbox,
        because neither exists. A form that posts into a mailbox nobody watches is worse than no form at
        all.
      </P>

      <H2>General and announcements</H2>
      <UL>
        <li>
          X: <Ext href="https://x.com/adexto_">@adexto_</Ext>
        </li>
        <li>
          Telegram: <Ext href="https://t.me/adexto">t.me/adexto</Ext>
        </li>
      </UL>

      <H2>A market that looks like a scam, an impersonation or something illegal</H2>
      <P>
        Use <In href="/report">Report a market</In>. It says what to include and what happens next. A
        report is the fastest way to have a market removed from this site, its feeds and our agent tools.
      </P>

      <H2>Bugs, features and questions about the code</H2>
      <P>
        Open an issue at <Ext href="https://github.com/0xcuy/adexto/issues">github.com/0xcuy/adexto/issues</Ext>.
        Public issues are preferred for anything that is not a vulnerability, since the answer is then useful
        to whoever asks next. Questions about connecting an agent belong in{" "}
        <Ext href="https://github.com/0xcuy/adexto-mcp/issues">0xcuy/adexto-mcp</Ext>.
      </P>

      <H2>Security</H2>
      <Note>
        Do not open a public issue for a vulnerability. Use GitHub Private Vulnerability Reporting on the{" "}
        <Ext href="https://github.com/0xcuy/adexto/security/advisories/new">repository&apos;s security tab</Ext>.
        It has already been used for a real report. The scope, the channel and what to expect are written
        in <Ext href="https://github.com/0xcuy/adexto/blob/main/SECURITY.md">SECURITY.md</Ext>. There is no
        bug bounty.
      </Note>

      <H2>Legal and law-enforcement requests</H2>
      <P>
        Send them through the same channels, marked as a legal request. Before you do, know what exists:
      </P>
      <UL>
        <li>
          <strong>What we can provide:</strong> what is already public on chain (the creator address and
          launch transaction of a market, every trade, and the metadata anchored to 0G DA), and the records
          listed on the <In href="/privacy">privacy page</In>, such as referral records.
        </li>
        <li>
          <strong>What does not exist:</strong> accounts, names, email addresses, identity documents or
          request logs. IP addresses are only held in memory for rate limiting and are gone when the process
          restarts.
        </li>
        <li>
          <strong>What we can do:</strong> remove a market from this site and the services we run (see{" "}
          <In href="/terms">terms</In>). We cannot freeze, seize or move any token or any funds, because no
          contract gives anyone that power.
        </li>
      </UL>

      <H2>What we cannot help with</H2>
      <UL>
        <li>
          Reversing a transaction or recovering funds. The curves have no owner and no withdrawal function,
          so nobody, including us, can undo a trade or recover tokens sent to a wrong address. If you were
          defrauded, report it to the police where you live and give them the transaction hashes.
        </li>
        <li>
          Releasing a ticker. A symbol is claimed permanently per chain by the factory, and there is no
          function to free one.
        </li>
        <li>
          Advice on whether to buy anything. See the <In href="/disclaimer">disclaimer</In>.
        </li>
      </UL>
    </>
  );
}
