"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, History, Loader2 } from "lucide-react";
import { chainFromId, chainMark, explorerTxUrl } from "@/lib/chains";
import type { RecentTransfer } from "@/lib/cross-chain-client";
import { chainName, statusLabel, type RecentTransfersState } from "@/components/swap/useRecentTransfers";

const WHEN = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function ChainMark({ chainId }: { chainId: number }) {
  const c = chainFromId(chainId);
  const mark = c ? chainMark(c) : null;
  return mark ? <img src={mark} alt="" aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full object-contain" /> : null;
}

/** Settled and as asked: green. Settled some other way (refund, other token, failure): amber or red. */
function tone(t: RecentTransfer): { className: string; icon: React.ReactNode } {
  const warn = t.substatus === "REFUNDED" || t.substatus === "PARTIAL" || t.substatus === "REFUND_IN_PROGRESS";
  if (t.status === "FAILED") return { className: "text-danger", icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> };
  if (warn || t.status === "INVALID") return { className: "text-warn", icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> };
  if (t.status === "DONE") return { className: "text-ok", icon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> };
  return { className: "text-ink-soft", icon: <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> };
}

function TxLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[32px] items-center gap-1 text-accent hover:underline lg:min-h-0">
      {children}
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/**
 * Recent transfers: the connected wallet's cross-chain transfers through ADEXTO, under Balances on
 * both Swap modes. Hidden until there is something to list.
 */
/** Shown before "Show all", so the list stays short next to the balances. */
const FIRST = 3;

export default function RecentTransfers({ recent, hold = false }: { recent: RecentTransfersState; hold?: boolean }) {
  const { list, historyError, announcement } = recent;
  const [showAll, setShowAll] = useState(false);
  // `hold`: the balances above are still loading. The history usually answers first, and the list
  // would then be pushed a screen down when the balances arrive. On desktop both sit in view, so that
  // push measured as a layout shift of 0.28 at 1024 px. Waiting costs a second or two.
  if (hold || !list.length) return null;
  const shown = showAll ? list : list.slice(0, FIRST);
  return (
    <section className="glass-panel mt-6 rounded-card p-5" aria-labelledby="swap-recent-title" data-testid="swap-recent">
      <h2 id="swap-recent-title" className="flex items-center gap-2 text-[13px]/snug font-semibold text-ink">
        <History className="h-4 w-4 text-accent" aria-hidden="true" /> Recent transfers
      </h2>
      <p className="mt-1 text-[12px] text-ink-faint">Cross-chain transfers this wallet sent through ADEXTO, from any device.</p>
      {historyError && (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-warn">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Showing this browser&apos;s transfers only. {historyError}
        </p>
      )}
      <ul id="swap-recent-list" className="mt-3 space-y-2">
        {shown.map((t) => {
          const { className, icon } = tone(t);
          const arrived = t.received ?? (t.expected || chainName(t.toChainId));
          return (
            <li key={t.txHash} className="rounded-2xl border border-line bg-surface p-3 text-[12px]" data-testid="swap-recent-item" data-status={t.status}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 font-semibold text-ink">
                  <ChainMark chainId={t.fromChainId} />
                  <span aria-hidden="true">→</span>
                  <ChainMark chainId={t.toChainId} />
                  <span className="truncate">{t.toolName}</span>
                </span>
                <span className={`flex shrink-0 items-center gap-1 font-semibold ${className}`}>
                  {icon}
                  {statusLabel(t)}
                </span>
              </div>
              <p className="mt-1 break-words text-ink-soft" data-numeric>
                {t.sent} <span aria-hidden="true">→</span>
                <span className="sr-only">to</span> {arrived}
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px]">
                {t.sentAt > 0 && (
                  <time dateTime={new Date(t.sentAt).toISOString()} className="text-ink-faint" data-numeric>
                    {WHEN.format(t.sentAt)}
                  </time>
                )}
                <TxLink href={explorerTxUrl(t.fromChainId, t.txHash)}>Sent</TxLink>
                {t.receivingTxHash && <TxLink href={explorerTxUrl(t.toChainId, t.receivingTxHash)}>Received</TxLink>}
                {t.explorerUrl && <TxLink href={t.explorerUrl}>Bridge status</TxLink>}
              </div>
            </li>
          );
        })}
      </ul>
      {list.length > FIRST && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          aria-controls="swap-recent-list"
          className="mt-2 flex min-h-[40px] w-full items-center justify-center rounded-xl border border-line text-[12px]/snug font-semibold text-ink-soft hover:border-line-strong hover:text-ink lg:min-h-[34px]"
        >
          {showAll ? "Show fewer" : `Show all ${list.length}`}
        </button>
      )}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}
