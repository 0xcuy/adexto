/**
 * <ChainChip chain={…} size="sm" | "md" variant="chip" | "plain" iconOnly? className? />
 *
 * Nama chain yang pendek dan tidak pernah pecah baris: logo `chainMark()` + `chain.key`
 * ("Monad", "Arbitrum", "Robinhood", "Base", "0G"). Label panjang "0G Mainnet (16661)" TIDAK
 * pernah dirender di sini; ia hanya muncul di `title` untuk hover. Baseline 3 Okt: label panjang
 * itu pecah jadi tiga baris di baris explorer 360 px.
 *
 *   chain     ChainInfo, chain id (143), atau label apa pun yang dikenali `resolveChain()`
 *             ("Monad", "0G Mainnet (16661)"). Tidak dikenali → komponen tidak merender apa pun,
 *             supaya tidak ada nama chain karangan.
 *   size      sm = 11 px (baris padat, tabel), md = 12 px (bawaan).
 *   variant   chip = berbingkai (bawaan) · plain = logo + teks tanpa bingkai, untuk baris daftar.
 *   iconOnly  hanya logo; nama lengkap tetap ada sebagai teks sr-only dan di `title`.
 *
 * Komponen server-safe (tanpa state), jadi boleh dipakai di server component maupun client.
 *
 * Contoh baris explorer (UI-2):
 *   <span className="flex min-w-0 items-center gap-2">
 *     <span className="truncate font-semibold">{p.name}</span>
 *     <ChainChip chain={p.chainId} size="sm" variant="plain" />
 *   </span>
 */
import { chainMark, resolveChain, type ChainInfo } from "@/lib/chains";
import { cn } from "@/components/ui/cn";

export type ChainChipSize = "sm" | "md";

export interface ChainChipProps {
  chain: ChainInfo | number | string | null | undefined;
  size?: ChainChipSize;
  variant?: "chip" | "plain";
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
  return (
    <span
      title={info.label}
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap font-medium leading-none text-ink-soft",
        s.text,
        s.gap,
        variant === "chip" && cn("rounded-full border border-line bg-cream-2", s.chip),
        className
      )}
    >
      {mark ? (
        <img src={mark} alt="" aria-hidden="true" className={cn("shrink-0 rounded-sm object-contain", s.mark)} />
      ) : (
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-faint" />
      )}
      {iconOnly ? <span className="sr-only">{info.name}</span> : <span>{info.key}</span>}
    </span>
  );
}
