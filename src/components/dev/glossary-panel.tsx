"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { GlossaryTerm } from "@/lib/dev-spec/types";

export function GlossaryPanel({ terms }: { terms: GlossaryTerm[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return terms;
    return terms.filter(
      (t) => t.term.toLowerCase().includes(needle) || t.definition.toLowerCase().includes(needle),
    );
  }, [terms, q]);

  return (
    <div>
      <div className="relative mb-4 print:hidden">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" strokeWidth={1.75} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search terms…"
          className="h-8 w-64 rounded-md border border-hairline-strong bg-canvas pl-8 pr-2 text-sm text-ink placeholder:text-ink-subtle focus:border-ink focus:outline-none"
        />
      </div>
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {filtered.map((t) => (
          <div key={t.id} id={`term-${t.id}`} className="scroll-mt-20">
            <dt className="text-sm font-medium text-ink">{t.term}</dt>
            <dd className="mt-0.5 text-sm leading-relaxed text-ink-muted">{t.definition}</dd>
          </div>
        ))}
      </dl>
      {filtered.length === 0 && (
        <p className="text-sm text-ink-subtle">No terms match “{q}”.</p>
      )}
    </div>
  );
}
