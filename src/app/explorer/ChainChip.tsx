/**
 * Versi lokal `ChainChip` untuk halaman UI-2, sampai primitive bersama `@/components/ui/ChainChip` (Plan UI-1, U1.0)
 * ada di main. Props-nya sengaja sama persis dengan versi bersama, jadi penggantiannya cukup mengubah satu baris
 * impor; berkas ini lalu dihapus (UI-POLISH §3 dan PLAN-UI-2 U2.0: jangan menyalin kodenya ke `src/components/ui/`).
 *
 * Nama chain yang pendek dan tidak pernah pecah baris: logo `chainMark()` + `chain.key` ("Monad", "Arbitrum",
 * "Robinhood", "Base", "0G"). Label panjang "0G Mainnet (16661)" hanya ada di `title`. Baseline 4 Okt: label
 * panjang itu pecah tiga baris di baris explorer 360 px.
 */
import { chainMark, resolveChain, type ChainInfo } from "@/lib/chains";

export type ChainChipSize = "sm" | "md";

export interface ChainChipProps {
  chain: ChainInfo | number | string | null | undefined;
  size?: ChainChipSize;
  /** chip = berbingkai · plain = logo + teks tanpa bingkai, untuk baris daftar. */
  variant?: "chip" | "plain";
  /** Hanya logo; nama lengkap tetap ada sebagai teks sr-only dan di `title`. */
  iconOnly?: boolean;
  className?: string;
}

function toChain(input: ChainChipProps["chain"]): ChainInfo | null {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "object") return input;
  return resolveChain(input);
}

// px, bukan kelas rem: rem situs ini 14 px, jadi `h-5` hanya 17,5 px.
const SIZES: Record<ChainChipSize, { text: string; mark: string; chip: string; gap: string }> = {
  sm: { text: "text-[11px]", mark: "h-[12px] w-[12px]", chip: "h-[20px] px-1.5", gap: "gap-1" },
  md: { text: "text-[12px]", mark: "h-[14px] w-[14px]", chip: "h-[24px] px-2", gap: "gap-1.5" },
};

export default function ChainChip({ chain, size = "md", variant = "chip", iconOnly = false, className }: ChainChipProps) {
  const info = toChain(chain);
  if (!info) return null;
  const mark = chainMark(info);
  const s = SIZES[size];
  const classes = [
    "inline-flex shrink-0 items-center whitespace-nowrap font-medium leading-none text-ink-soft",
    s.text,
    s.gap,
    variant === "chip" ? `rounded-full border border-line bg-cream-2 ${s.chip}` : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span title={info.label} className={classes}>
      {mark ? (
        // eslint-disable-next-line @next/next/no-img-element -- logo chain statis kecil dari /public
        <img src={mark} alt="" aria-hidden="true" className={`shrink-0 rounded-sm object-contain ${s.mark}`} />
      ) : (
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-faint" />
      )}
      {iconOnly ? <span className="sr-only">{info.name}</span> : <span>{info.key}</span>}
    </span>
  );
}
