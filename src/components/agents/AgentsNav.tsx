import Link from "next/link";

/**
 * Navigasi antar halaman `/agents/*`. Peluncuran, data, feed, dan bahan teknis dipisah per halaman
 * (arahan owner 5 Okt: `/agents` hanya untuk meluncurkan), jadi pembaca perlu jalan pindah yang jelas.
 */
const ITEMS = [
  { href: "/agents", label: "Launch" },
  { href: "/agents/markets", label: "Agent markets" },
  { href: "/agents/activity", label: "Activity" },
  { href: "/agents/registry", label: "Identities & discovery" },
] as const;

export default function AgentsNav({ current }: { current: (typeof ITEMS)[number]["href"] }) {
  return (
    <nav aria-label="Agents pages" className="mb-8 flex flex-wrap gap-2">
      {ITEMS.map((item) => {
        const active = item.href === current;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-[40px] items-center rounded-full border px-4 text-[13px] font-semibold transition-colors ${
              active ? "border-accent/40 bg-accent-soft text-accent" : "border-line bg-surface text-ink-soft hover:text-ink"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
