import type { Metadata } from "next";
import { H2, P, UL, PageTitle, Note } from "../_parts";

export const metadata: Metadata = {
  title: "Privacy — ADEXTO",
  description:
    "Exactly what this site stores, what it sends to third parties, and what is permanent because it is on a public blockchain.",
};

/**
 * Ditulis dari KODE, bukan dari templat.
 *
 * Setiap butir di bawah ditelusuri lebih dulu:
 *   dua kunci localStorage        -> grep localStorage di src/
 *   IP di memori untuk rate limit -> src/lib/rate-limit.ts, Map, kunci cf-connecting-ip
 *   tanpa analitik milik sendiri  -> tidak ada gtag/plausible/analytics di layout atau config
 *   skrip Cloudflare Insights     -> teramati di jaringan, TIDAK disuntik oleh kode ini
 *   prompt chat ke router 0G      -> src/app/api/chat/route.ts
 *
 * Kebijakan privasi yang menyebut hal yang tidak dilakukan situsnya sama buruknya dengan yang
 * menyembunyikan yang dilakukannya: keduanya membuat halaman ini tidak bisa dipercaya sebagai
 * deskripsi.
 */
export default function PrivacyPage() {
  return (
    <>
      <PageTitle updated="24 September 2026">Privacy</PageTitle>

      <P>
        ADEXTO has no accounts, no sign-up and no email list. There is nothing to log in to, so there
        is no profile to build. What follows is the complete list of what is stored or transmitted,
        taken from the source rather than from a template.
      </P>

      <H2>Stored in your browser</H2>
      <P>Two keys, in localStorage, on your device only. They are never sent to us.</P>
      <UL>
        <li>
          <code className="text-ink">adexto_selected_chain</code> — which chain the interface is
          showing, so it survives a reload.
        </li>
        <li>
          <code className="text-ink">adexto_wallet_address</code> — the address last connected, so the
          session can be restored without prompting again.
        </li>
        <li>
          <code className="text-ink">adexto_cookie_consent</code> — your answer to the storage notice.
        </li>
      </UL>
      <P>
        Choosing <strong>Essential only</strong> in that notice deletes the first two immediately and
        stops them being written again. Your wallet will simply not reconnect on its own afterwards.
      </P>

      <H2>Cookies</H2>
      <P>
        We set none. The cookies your browser may hold for this domain — names beginning{" "}
        <code className="text-ink">__cf</code> — are set by Cloudflare, which sits in front of this
        site for TLS and bot filtering. We cannot turn those off and they are not readable by our
        code.
      </P>

      <H2>Server side</H2>
      <UL>
        <li>
          <strong>IP addresses for rate limiting.</strong> Endpoints that spend money —{" "}
          <code className="text-ink">/api/chat</code> and{" "}
          <code className="text-ink">/api/generate-logo</code> — count requests per IP, read from
          Cloudflare&apos;s <code className="text-ink">cf-connecting-ip</code> header. The counter
          lives in memory in a plain map and is lost whenever the process restarts. It is never
          written to disk and never used for anything but the limit.
        </li>
        <li>
          <strong>No request logs are kept</strong> beyond what the container prints to its own
          standard output, which is not persisted.
        </li>
        <li>
          <strong>No analytics of our own.</strong> No Google Analytics, no Plausible, no advertising
          or cross-site tracking. Cloudflare may inject its own Web Analytics script at the network
          level; that comes from the zone configuration, not from this codebase.
        </li>
      </UL>

      <H2>Sent to third parties</H2>
      <UL>
        <li>
          <strong>0G Compute router.</strong> If you use the in-app chat or generate a token emblem,
          your prompt is sent to 0G&apos;s inference router to be answered. Do not put anything
          private in a prompt.
        </li>
        <li>
          <strong>Public RPC endpoints.</strong> Reading prices and market state means requests to
          public RPC providers for 0G, Base, Arbitrum and Monad. Those providers see the requests, and
          your wallet makes its own requests directly to whichever provider it is configured with.
        </li>
        <li>
          <strong>Your wallet extension.</strong> It is software on your device, outside our control,
          with its own privacy policy.
        </li>
      </UL>

      <H2>What is public and permanent</H2>
      <Note>
        A blockchain transaction is public forever and cannot be deleted by us or by you. Your
        address, the markets you launch, every buy and sell, and the metadata a launch anchors to 0G
        DA are all permanently readable by anyone. No privacy policy can change that, so treat an
        address you use here as public.
      </Note>

      <H2>Your choices</H2>
      <UL>
        <li>Clear the three keys above at any time from your browser&apos;s site data.</li>
        <li>Choose Essential only in the storage notice to stop preferences being kept.</li>
        <li>
          Use the site without connecting a wallet. Prices, markets and documentation all work
          without one.
        </li>
      </UL>
      <P>
        There is no database of users to request an export from or a deletion of, because no such
        database exists.
      </P>
    </>
  );
}
