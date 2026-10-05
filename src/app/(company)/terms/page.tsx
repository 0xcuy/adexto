import type { Metadata } from "next";
import { H2, P, UL, PageTitle, Note, In } from "../_parts";
import { UPDATED, X402_SPREAD_PERCENT } from "../_facts";

export const metadata: Metadata = {
  title: "Terms — ADEXTO",
  description:
    "Terms of use for adexto.xyz, the ADEXTO contracts, the MCP and A2A agents and the x402 gateway: eligibility, acceptable use, what we may remove, fees, and the limits of liability.",
};

/**
 * Syarat penggunaan. Dibaca global: tidak menyebut satu negara pun.
 *
 * TIDAK ADA YURISDIKSI DAN TIDAK ADA BADAN HUKUM YANG DIKARANG
 *
 * Templat standar menyebut "hukum negara X" dan "perusahaan Y". Keduanya tidak ada di sini, dan
 * mengisinya dengan nama yang tidak terdaftar akan membuat seluruh dokumen ini tidak bisa dipercaya —
 * termasuk bagian yang benar. Bagian "Governing law" menyatakan itu apa adanya.
 *
 * SETIAP KEWENANGAN YANG DIKLAIM DI SINI BENAR-BENAR ADA DI KODE
 *
 *   - menolak listing: `checkSymbolAvailable` (ticker cadangan, blue-chip, impersonasi lintas chain)
 *   - menyembunyikan: `src/config/hidden-markets.ts`
 *   - mencabut dari situs, gerbang x402, MCP/A2A, Telegram dan feed agregator:
 *     `src/config/delisted-markets.ts`
 *   - mencabut kunci Agent Compute: `src/lib/agent-compute-pool.ts`
 *   - persetujuan yang ditandatangani: `TERMS_ACCEPTANCE_LINE` (`src/config/terms.ts`), diwajibkan
 *     `verifyLaunchAttestation`. `TERMS_VERSION` harus sama dengan `UPDATED` halaman ini.
 *   - saringan isi peluncuran: `src/lib/launch-content.ts`
 *
 * Yang TIDAK ada — membekukan, menghentikan trade di kurva, menyita — dinyatakan tidak ada.
 */
export default function TermsPage() {
  return (
    <>
      <PageTitle updated={UPDATED}>Terms</PageTitle>

      <P>
        These terms cover adexto.xyz, the ADEXTO contracts, the MCP server, the A2A agent and the x402
        gateway at x402.adexto.xyz (together, &quot;ADEXTO&quot;). Using any of them means accepting these
        terms, the <In href="/acceptable-use">acceptable use policy</In> and the{" "}
        <In href="/privacy">privacy notice</In>. Launching a market accepts them explicitly: the launch
        attestation your wallet signs, from the studio or from an agent, ends with a line accepting these terms
        and the acceptable use policy by their version date, and no launch is prepared without it. If any part
        is unacceptable to you, do not use ADEXTO.
      </P>

      <H2>Who may use ADEXTO</H2>
      <UL>
        <li>
          You must be at least 18, or the age of majority where you live if that is higher, and able to
          enter into a binding agreement.
        </li>
        <li>
          You must not be a person or entity named on a sanctions list of the United Nations, the United
          States (OFAC), the European Union or the United Kingdom, owned or controlled by one, or acting for
          one. You must not use ADEXTO from, or for the benefit of anyone in, a country or region under
          comprehensive sanctions by any of them.
        </li>
        <li>
          You must not use ADEXTO where the law that applies to you forbids it. Rules on digital assets
          differ by country, and establishing your own position, including your taxes, is yours to do.
        </li>
        <li>
          If you use ADEXTO for an organisation, you accept these terms for it and confirm you may do so.
        </li>
      </UL>

      <H2>What ADEXTO provides</H2>
      <P>
        Software. This site is an interface to smart contracts deployed on public blockchains. ADEXTO is not
        a broker, an exchange operator, a custodian, an investment adviser or a financial institution, and it
        does not issue, underwrite or sell any token. It never holds your funds or your keys: every launch,
        trade, stake and claim is signed by your own wallet and executed by the contracts. The x402 gateway
        buys on the market&apos;s chain with our relayer and delivers to the address you name; it does not
        keep the tokens.
      </P>

      <H2>Markets are created by their creators</H2>
      <UL>
        <li>
          Anyone can create a market, and the creator alone is responsible for it: its name, ticker, image,
          description, links, any claim made about it anywhere, and its compliance with the law, including
          securities, consumer-protection and advertising rules.
        </li>
        <li>
          A market appearing on ADEXTO is not an endorsement, a review, an audit or a verification of the
          market or of its creator. A name or ticker proves nothing about who made it.
        </li>
        <li>
          Do not present a market as an investment that pays returns, as affiliated with anyone it is not,
          or as reviewed by ADEXTO.
        </li>
      </UL>

      <H2>Acceptable use</H2>
      <P>
        The <In href="/acceptable-use">acceptable use policy</In> lists what may not be launched or done
        here, including fraud, impersonation, money laundering, sanctions evasion and illegal content. It is
        part of these terms.
      </P>

      <H2>What we may do on our side</H2>
      <P>We may, at any time, without notice and without giving a reason:</P>
      <UL>
        <li>refuse to list a market, or hide it from the lists on this site;</li>
        <li>
          remove a market from this site, the x402 gateway, the MCP and A2A tools, the Telegram feed and the
          feeds we serve to aggregators. Removals made for the acceptable use policy are recorded with a
          reason in the public repository;
        </li>
        <li>refuse or limit requests to our services from any address or network;</li>
        <li>switch off or revoke an Agent Compute key, and change or end any feature of the site.</li>
      </UL>
      <Note>
        None of this reaches the contracts. They have no owner, no pause and no blacklist, so nobody,
        including us, can freeze a token, stop trades made directly against a curve, or move anyone&apos;s
        funds. A market removed here still exists on chain.
      </Note>

      <H2>Agents</H2>
      <UL>
        <li>
          An agent acting with your key acts for you. Its launches, purchases, stakes and messages are yours,
          including when it was wrong or was manipulated by what it read.
        </li>
        <li>
          <code className="text-ink">pay_and_buy</code> on the MCP server is the one exception to &quot;your
          own key&quot;: it is signed by the operator&apos;s wallet on the server, requires a key we issue,
          and is capped at 0.20 USDC per call and 10 calls per hour across all callers.
        </li>
        <li>
          An Agent Compute key gives access to a third-party model router. Its allowance is enforced by a
          periodic sweep, so usage can run past it by up to one sweep. Keys may be switched off when the
          allowance or the stake runs out, and there is no guarantee of availability or of any output.
        </li>
      </UL>

      <H2>Fees</H2>
      <UL>
        <li>
          Creating a market costs blockchain gas only. There is no listing fee and no liquidity deposit.
        </li>
        <li>
          Every trade pays the fee written into its curve at launch, shown on the market&apos;s page before
          you trade. On current markets (factory 1.0.0) the standard preset is 1.00%: 0.70% to the creator,
          0.10% to depth, 0.10% to the buyback vault and 0.10% to the protocol treasury. The protocol share is
          inside the total, and no curve can charge more than 5%. Markets from the earlier 0.11.0 factory pay
          0.40%. No fee can be changed after launch.
        </li>
        <li>
          An x402 purchase costs the USDC amount in its quote. That amount is converted to the market&apos;s
          native asset at the live price less a spread (currently {X402_SPREAD_PERCENT}), and the quote shows
          the rate and the tokens expected before you sign.
        </li>
      </UL>

      <H2>Things nobody can undo</H2>
      <UL>
        <li>
          <strong>Trades are final.</strong> The curves have no owner and no withdrawal function. Nobody can
          reverse a swap, freeze a market or recover funds.
        </li>
        <li>
          <strong>Tickers are permanent.</strong> A symbol is claimed for good on each chain when a market is
          created. No function exists to release one, including after a market is removed from this site.
        </li>
        <li>
          <strong>On-chain data is permanent.</strong> Launch metadata anchored to 0G DA and every transaction
          stay public forever.
        </li>
      </UL>

      <H2>No warranty</H2>
      <Note>
        Everything is provided as is and as available, without warranty of any kind, express or implied,
        including fitness for a purpose and non-infringement. The contracts{" "}
        <strong>have not been audited by a security firm</strong>. Analyser output is published in full on
        the <In href="/security">security page</In>, including findings that remain open. Assume software
        this young contains bugs, and risk only what you can afford to lose entirely.
      </Note>

      <H2>Availability</H2>
      <P>
        This website is one container on one server, and the gateway is one Cloudflare Worker. Either can go
        down. The contracts do not depend on them and can be called directly. Third parties we rely on,
        including RPC providers, the 0G Compute router, 0G storage, the ERC-8004 Identity Registry, USDC and
        wallets, have their own terms and can fail on their own.
      </P>

      <H2>Your responsibilities</H2>
      <UL>
        <li>Keeping your keys safe. A lost key means lost funds, and nobody can restore access.</li>
        <li>
          Checking what you buy: the chain, the token address and the creator. The same ticker on two chains
          is two unrelated tokens.
        </li>
        <li>Following the acceptable use policy and the law that applies to you.</li>
      </UL>

      <H2>Indemnity</H2>
      <P>
        You will cover the developer of ADEXTO against claims, losses and costs, including reasonable legal
        costs, that arise from your breach of these terms or of the law, from a market you created, or from
        content you published through ADEXTO.
      </P>

      <H2>Limitation of liability</H2>
      <P>
        To the fullest extent the law allows, the developer of ADEXTO is not liable for any loss arising from
        ADEXTO, including losses from bugs, from a chain, RPC provider or other third party failing, from the
        price of any market moving, from an agent&apos;s actions, or from a market created by somebody else,
        and is not liable for indirect or consequential loss or lost profits. Where liability cannot be
        excluded, it is limited to the protocol fees you paid in the twelve months before the claim.
      </P>

      <H2>Governing law</H2>
      <P>
        ADEXTO is built by a single independent developer, not a registered company, so these terms do not
        name a governing law or a court. They are meant to be read under the law that applies to the dispute.
        Nothing here removes a right that law gives you and does not allow to be waived. If a part of these
        terms is unenforceable, the rest still applies.
      </P>

      <H2>Changes</H2>
      <P>
        These terms may change. The date at the top is the version, and the history of every change is public
        in the repository. Using ADEXTO after a change means accepting the new version.
      </P>
    </>
  );
}
