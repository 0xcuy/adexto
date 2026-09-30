"use client";

import { useEffect, useMemo, useState } from "react";
import { Megaphone, Copy, Check } from "lucide-react";
import { composeLinks, launchAnnouncement } from "@/lib/launch-announcement";

/**
 * Blok "Announce it" di layar sukses Studio: draf yang bisa disunting, lalu satu klik ke composer
 * X atau Farcaster, atau salin. Lihat `src/lib/launch-announcement.ts` untuk isi drafnya.
 */
export default function LaunchAnnouncement({
  name,
  symbol,
  chainName,
  chainId,
  tokenAddress,
}: {
  name: string;
  symbol: string;
  chainName: string;
  chainId: number;
  tokenAddress: string;
}) {
  /**
   * Asal publik: `NEXT_PUBLIC_APP_URL` bila diset (produksi: adexto.xyz), kalau tidak asal
   * halaman ini. Diselesaikan sesudah hidrasi karena `window` tidak ada di server.
   */
  const [origin, setOrigin] = useState(process.env.NEXT_PUBLIC_APP_URL || "");
  useEffect(() => {
    if (!origin) setOrigin(window.location.origin);
  }, [origin]);

  const draft = useMemo(
    () => launchAnnouncement({ name, symbol, chainName, chainId, tokenAddress, origin: origin || "https://adexto.xyz" }),
    [name, symbol, chainName, chainId, tokenAddress, origin]
  );
  const [body, setBody] = useState(draft.body);
  useEffect(() => setBody(draft.body), [draft.body]);
  const links = composeLinks(body, draft.marketUrl);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${body}\n${draft.marketUrl}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const btn =
    "inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors";

  return (
    <div className="space-y-2 rounded-2xl border border-accent/30 bg-accent-soft/40 p-3 font-sans" data-testid="launch-announcement">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-bold text-ink">
          <Megaphone className="h-3.5 w-3.5 text-accent" /> Announce ${symbol}
        </span>
        <span className="text-[10px] text-ink-faint">edit the text, then post it from your own account</span>
      </div>
      <label className="sr-only" htmlFor={`announce-${chainId}`}>
        Announcement text
      </label>
      <textarea
        id={`announce-${chainId}`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={6}
        className="w-full resize-y rounded-xl border border-line bg-surface p-2.5 text-[12px] leading-relaxed text-ink focus:border-accent/40 focus:outline-none"
        data-testid="announcement-text"
      />
      <p className="truncate text-[10px] text-ink-faint">
        Link added at the end: <span className="font-mono text-accent">{draft.marketUrl}</span>
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <a
          href={links.xUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${btn} border-line bg-surface text-ink hover:border-accent/40`}
          data-testid="announce-x"
        >
          Post on X
        </a>
        <a
          href={links.farcasterUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${btn} border-line bg-surface text-ink hover:border-accent/40`}
          data-testid="announce-farcaster"
        >
          Post on Farcaster
        </a>
        <button type="button" onClick={copy} className={`${btn} border-accent/30 bg-accent text-white hover:bg-accent-strong`} data-testid="announce-copy">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy announcement"}
        </button>
      </div>
    </div>
  );
}
