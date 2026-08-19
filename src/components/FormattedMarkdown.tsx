import React from "react";

export function FormattedMarkdown({ text }: { text: string }) {
  if (!text) return null;

  // Split lines
  const lines = text.split("\n");

  return (
    <div className="space-y-1.5 text-xs text-ink leading-relaxed font-sans">
      {lines.map((line, lIdx) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={lIdx} className="h-1" />;

        // Check if list bullet
        const isBullet = trimmed.startsWith("• ") || trimmed.startsWith("- ") || trimmed.startsWith("* ");
        const lineContent = isBullet ? trimmed.slice(2) : trimmed;

        // Parse bold **text** and `code` inline
        const parts = lineContent.split(/(\*\*.*?\*\*|`.*?`)/g);

        const renderedLine = parts.map((part, pIdx) => {
          if (part.startsWith("**") && part.endsWith("**")) {
            return (
              <strong key={pIdx} className="font-bold text-accent">
                {part.slice(2, -2)}
              </strong>
            );
          }
          if (part.startsWith("`") && part.endsWith("`")) {
            return (
              <code key={pIdx} className="px-1 py-0.5 rounded bg-cream-2 border border-line text-accent font-mono text-[11px]">
                {part.slice(1, -1)}
              </code>
            );
          }
          return <span key={pIdx}>{part}</span>;
        });

        if (isBullet) {
          return (
            <div key={lIdx} className="flex items-start gap-1.5 pl-1">
              <span className="text-accent font-bold">•</span>
              <div>{renderedLine}</div>
            </div>
          );
        }

        return <div key={lIdx}>{renderedLine}</div>;
      })}
    </div>
  );
}
