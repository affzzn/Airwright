"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LAYER_LABEL,
  OWNER_LABEL,
  type CrossCheck,
  type Layer,
  type Measurement,
  type Owner,
  type Status,
} from "@/lib/dev-spec/types";
import { LayerBadge, StatusBadge } from "./badges";

const LAYER_OPTIONS: { value: Layer | "all"; label: string }[] = [
  { value: "all", label: "All layers" },
  { value: "llm", label: LAYER_LABEL.llm },
  { value: "engine", label: LAYER_LABEL.engine },
  { value: "both", label: LAYER_LABEL.both },
];

const STATUS_OPTIONS: { value: Status | "all"; label: string }[] = [
  { value: "all", label: "All status" },
  { value: "confirmed", label: "Confirmed" },
  { value: "open", label: "Open" },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="eyebrow mb-1">{label}</p>
      <div className="text-sm leading-relaxed text-ink-muted">{children}</div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded border border-hairline-strong bg-surface px-1.5 py-0.5 text-[11px] text-ink-muted">
      {children}
    </span>
  );
}

const selectCls =
  "h-8 rounded-md border border-hairline-strong bg-canvas px-2 text-sm text-ink focus:border-ink focus:outline-none";

export function MeasurementCatalogue({
  items,
  crossChecks,
}: {
  items: Measurement[];
  crossChecks: CrossCheck[];
}) {
  const [q, setQ] = useState("");
  const [layer, setLayer] = useState<Layer | "all">("all");
  const [status, setStatus] = useState<Status | "all">("all");
  const [owner, setOwner] = useState<Owner | "all">("all");

  const ccById = useMemo(() => {
    const m = new Map<string, CrossCheck>();
    for (const c of crossChecks) m.set(c.id, c);
    return m;
  }, [crossChecks]);

  const owners = useMemo(() => {
    const s = new Set<Owner>();
    for (const it of items) if (it.owner) s.add(it.owner);
    return [...s];
  }, [items]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((it) => {
      if (layer !== "all" && it.layer !== layer) return false;
      if (status !== "all" && it.status !== status) return false;
      if (owner !== "all" && it.owner !== owner) return false;
      if (!needle) return true;
      const hay = [
        it.name,
        it.plain,
        it.howRead,
        it.derivation ?? "",
        it.confidenceRule ?? "",
        (it.fallbacks ?? []).join(" "),
        it.workedExample ?? "",
        it.whereRead.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [items, q, layer, status, owner]);

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" strokeWidth={1.75} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search measurements…"
            className="h-8 w-56 rounded-md border border-hairline-strong bg-canvas pl-8 pr-2 text-sm text-ink placeholder:text-ink-subtle focus:border-ink focus:outline-none"
          />
        </div>
        <select value={layer} onChange={(e) => setLayer(e.target.value as Layer | "all")} className={selectCls}>
          {LAYER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as Status | "all")} className={selectCls}>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {owners.length > 0 && (
          <select value={owner} onChange={(e) => setOwner(e.target.value as Owner | "all")} className={selectCls}>
            <option value="all">All owners</option>
            {owners.map((o) => (
              <option key={o} value={o}>{OWNER_LABEL[o]}</option>
            ))}
          </select>
        )}
        <span className="text-sm text-ink-subtle">
          {filtered.length} of {items.length}
        </span>
      </div>

      <div className="space-y-2.5">
        {filtered.map((it) => (
          <details key={it.id} className="group rounded-lg border border-hairline bg-canvas">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
              <div className="min-w-0">
                <span className="font-medium text-ink">{it.name}</span>
                <p className="mt-1 text-sm leading-relaxed text-ink-muted">{it.plain}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="hidden sm:inline-flex"><LayerBadge layer={it.layer} /></span>
                <StatusBadge status={it.status} owner={it.owner} />
                <ChevronDown className="mt-0.5 h-4 w-4 text-ink-subtle transition-transform group-open:rotate-180" strokeWidth={1.75} />
              </div>
            </summary>

            <div className="space-y-4 border-t border-hairline px-5 py-4">
              <Field label="Where it's read">
                <div className="flex flex-wrap gap-1.5">
                  {it.whereRead.map((w) => (
                    <Chip key={w}>{w}</Chip>
                  ))}
                </div>
              </Field>
              <Field label="How the model reads it">{it.howRead}</Field>
              {it.derivation && <Field label="What the engine computes">{it.derivation}</Field>}
              {it.formula && (
                <Field label="Formula">
                  <pre className="whitespace-pre-wrap rounded-md border border-hairline bg-surface px-3 py-2 font-mono text-[12.5px] text-ink">
                    {it.formula}
                  </pre>
                </Field>
              )}
              {it.fallbacks && it.fallbacks.length > 0 && (
                <Field label="Fallbacks & alternative methods">
                  <ol className="list-decimal space-y-1 pl-5">
                    {it.fallbacks.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ol>
                </Field>
              )}
              {it.confidenceRule && <Field label="Confidence rule">{it.confidenceRule}</Field>}
              {it.workedExample && (
                <Field label="Worked example">
                  <p className="rounded-md border border-hairline bg-surface px-3 py-2">{it.workedExample}</p>
                </Field>
              )}
              {it.crossChecks && it.crossChecks.length > 0 && (
                <Field label="Cross-checks">
                  <div className="flex flex-wrap gap-1.5">
                    {it.crossChecks.map((cid) => {
                      const c = ccById.get(cid);
                      const text = c ? (c.code ? `${c.code} · ${c.name}` : c.name) : cid;
                      return (
                        <a key={cid} href="#cross-checks" className="no-underline">
                          <Chip>{text}</Chip>
                        </a>
                      );
                    })}
                  </div>
                </Field>
              )}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-1">
                {it.relatedTerms && it.relatedTerms.length > 0 && (
                  <a href="#glossary" className={cn("text-xs text-ink-subtle underline decoration-hairline-strong underline-offset-2 hover:text-ink")}>
                    Related terms in the glossary
                  </a>
                )}
                <span className="font-mono text-[11px] text-ink-subtle">{it.codeRefs.join("  ·  ")}</span>
              </div>
            </div>
          </details>
        ))}
        {filtered.length === 0 && (
          <p className="rounded-lg border border-dashed border-hairline-strong px-5 py-8 text-center text-sm text-ink-subtle">
            No measurements match these filters.
          </p>
        )}
      </div>
    </div>
  );
}
