import type { Metadata } from "next";
import { H2, P, UL, PageTitle, Note } from "../_parts";

export const metadata: Metadata = {
  title: "Contact — ADEXTO",
  description: "How to reach ADEXTO, and which channel to use for what.",
};

/**
 * Hanya kanal yang BENAR-BENAR dijawab.
 *
 * Halaman kontak biasanya memasang formulir dan alamat email pendukung. Tidak ada keduanya di
 * sini: tidak ada endpoint yang menerima formulir itu, dan tidak ada kotak masuk yang dijaga.
 * Formulir yang mengirim ke tempat yang tidak dibaca lebih buruk daripada tidak ada formulir —
 * orang menganggap pesannya terkirim lalu menunggu jawaban yang tidak akan datang.
 *
 * Kanal keamanan menunjuk Private Vulnerability Reporting di GitHub karena itulah yang memang
 * menyala dan sudah pernah dipakai satu laporan nyata.
 */
export default function ContactPage() {
  return (
    <>
      <PageTitle updated="24 September 2026">Contact</PageTitle>

      <P>
        Every channel below is one that actually gets read. There is no contact form and no support
        inbox, because neither exists — a form that posts into a mailbox nobody watches is worse than
        no form at all.
      </P>

      <H2>General and announcements</H2>
      <UL>
        <li>
          X:{" "}
          <a
            href="https://x.com/adexto_"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-accent hover:underline"
          >
            @adexto_
          </a>
        </li>
        <li>
          Telegram:{" "}
          <a
            href="https://t.me/adexto"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-accent hover:underline"
          >
            t.me/adexto
          </a>
        </li>
      </UL>

      <H2>Bugs, features and questions about the code</H2>
      <P>
        Open an issue at{" "}
        <a
          href="https://github.com/0xcuy/adexto/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-accent hover:underline"
        >
          github.com/0xcuy/adexto/issues
        </a>
        . Public issues are preferred for anything that is not a vulnerability, since the answer is
        then useful to whoever asks next.
      </P>

      <H2>Security</H2>
      <Note>
        Do not open a public issue for a vulnerability. Use GitHub Private Vulnerability Reporting on
        the{" "}
        <a
          href="https://github.com/0xcuy/adexto/security/advisories/new"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-accent hover:underline"
        >
          repository&apos;s security tab
        </a>
        . It is enabled on both repositories and has already been used for a real report. The scope,
        the channel and what to expect are written in{" "}
        <a
          href="https://github.com/0xcuy/adexto/blob/main/SECURITY.md"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-accent hover:underline"
        >
          SECURITY.md
        </a>
        .
      </Note>

      <H2>What we cannot help with</H2>
      <UL>
        <li>
          Reversing a transaction. The curves have no owner and no withdrawal function, so nobody —
          including us — can undo a trade or recover tokens sent to a wrong address.
        </li>
        <li>
          Releasing a ticker. A symbol is claimed permanently per chain by the factory, and there is
          no function to free one.
        </li>
        <li>Advice on whether to buy anything. See the disclaimer.</li>
      </UL>
    </>
  );
}
