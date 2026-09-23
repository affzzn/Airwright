"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { deleteConstructionQuote } from "@/server/actions/construction";
import type { ConstructionQuoteListItem } from "@/server/construction";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { EmptyHint, IconButton } from "@/components/construction/parts";
import { formatDate, formatGBP, cn } from "@/lib/utils";

/**
 * The construction jobs list. Every row carries the one thing the job is waiting
 * on (`next`), so the estimator can see what to pick up without opening it.
 */

type Filter = "ALL" | "DRAFT" | "CONFIRMED" | "QUOTED";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "DRAFT", label: "Draft" },
  { key: "CONFIRMED", label: "Confirmed" },
  { key: "QUOTED", label: "Issued" },
];

const STAGE_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  CONFIRMED: "Confirmed",
  QUOTED: "Issued",
};

function StageChip({ status }: { status: string }) {
  const solid = status === "CONFIRMED" || status === "QUOTED";
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center rounded-md px-2 text-[11px] font-semibold",
        solid ? "bg-ink text-canvas" : "bg-surface text-ink-muted",
      )}
    >
      {STAGE_LABEL[status] ?? status}
    </span>
  );
}

export function ConstructionWorkspace({ quotes }: { quotes: ConstructionQuoteListItem[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [deleteTarget, setDeleteTarget] = useState<ConstructionQuoteListItem | null>(null);
  const [pending, start] = useTransition();

  const stats = useMemo(() => {
    const open = quotes.filter((q) => q.status === "DRAFT").length;
    const unread = quotes.filter((q) => q.next.label === "Read enquiry").length;
    const ready = quotes.filter(
      (q) => q.next.label === "Ready to issue" || q.next.label === "Issue quote",
    ).length;
    const issued = quotes
      .filter((q) => q.status === "QUOTED")
      .reduce((a, q) => a + q.total, 0);
    return { open, unread, ready, issued };
  }, [quotes]);

  const visible = useMemo(() => {
    const base = filter === "ALL" ? quotes : quotes.filter((q) => q.status === filter);
    const s = query.trim().toLowerCase();
    if (!s) return base;
    return base.filter((q) =>
      [q.reference, q.customerName, q.siteAddress]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(s)),
    );
  }, [quotes, filter, query]);

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    start(async () => {
      await deleteConstructionQuote(id);
      setDeleteTarget(null);
      router.refresh();
    });
  };

  const href = (q: ConstructionQuoteListItem) => `/construction/${q.id}?step=${q.next.step}`;

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-1">Construction</p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Jobs</h1>
        </div>
        <Link href="/construction/new">
          <Button className="gap-2">
            <Plus className="h-4 w-4" strokeWidth={2} /> New job
          </Button>
        </Link>
      </div>

      {quotes.length === 0 ? (
        <EmptyHint
          title="No jobs yet"
          className="py-10"
          action={
            <Link href="/construction/new">
              <Button className="gap-2">
                <Plus className="h-4 w-4" strokeWidth={2} /> New job
              </Button>
            </Link>
          }
        >
          Start a job and drop in the email and drawings the client sent.
        </EmptyHint>
      ) : (
        <>
          {/* Pipeline */}
          <div className="mb-5 grid grid-cols-2 divide-y divide-hairline rounded-xl border border-hairline bg-canvas sm:grid-cols-4 sm:divide-x sm:divide-y-0">
            <Stat label="Open jobs" value={String(stats.open)} />
            <Stat label="Enquiry not read" value={String(stats.unread)} />
            <Stat label="Ready to issue" value={String(stats.ready)} />
            <Stat label="Issued" value={formatGBP(stats.issued)} />
          </div>

          {/* Toolbar */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
                strokeWidth={1.75}
                aria-hidden
              />
              <label className="sr-only" htmlFor="job-search">
                Search jobs
              </label>
              <input
                id="job-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search job, customer or site"
                className="h-10 w-full rounded-lg border border-hairline-strong bg-canvas pl-9 pr-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/15"
              />
            </div>
            <div className="flex items-center gap-1 rounded-xl bg-surface-2 p-1">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "h-8 rounded-lg px-3 text-[13px] transition-colors",
                    filter === f.key
                      ? "bg-canvas font-semibold text-ink"
                      : "text-ink-muted hover:text-ink",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyHint title="Nothing matches" className="py-8">
              Clear the search or pick another filter.
            </EmptyHint>
          ) : (
            <div className="rounded-xl border border-hairline bg-canvas">
              {/* Desktop table */}
              <table className="hidden w-full lg:table">
                <thead>
                  <tr className="text-left">
                    <Th className="pl-5">Job</Th>
                    <Th>Customer</Th>
                    <Th>Stage</Th>
                    <Th className="text-right">Items</Th>
                    <Th className="text-right">Value</Th>
                    <Th>Next step</Th>
                    <Th className="pr-5" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((q) => (
                    <tr key={q.id} className="group border-t border-hairline transition-colors hover:bg-surface/50">
                      <td className="py-3.5 pl-5 pr-3">
                        <Link href={href(q)} className="text-sm font-semibold tracking-tight text-ink">
                          {q.reference || q.customerName || "Untitled job"}
                        </Link>
                        <p className="mt-0.5 text-xs text-ink-muted">
                          {q.siteAddress || `Created ${formatDate(q.createdAt)}`}
                        </p>
                      </td>
                      <td className="py-3.5 pr-3 text-sm text-ink-muted">{q.customerName || "—"}</td>
                      <td className="py-3.5 pr-3">
                        <StageChip status={q.status} />
                      </td>
                      <td className="py-3.5 pr-3 text-right text-sm tabular-nums text-ink-muted">
                        {q.lineCount}
                      </td>
                      <td className="py-3.5 pr-3 text-right text-sm font-semibold tabular-nums text-ink">
                        {formatGBP(q.total)}
                      </td>
                      <td className="py-3.5 pr-3">
                        <Link
                          href={href(q)}
                          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink"
                        >
                          {q.next.label}
                          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
                        </Link>
                      </td>
                      <td className="py-3.5 pr-5 text-right">
                        <IconButton
                          label="Delete job"
                          onClick={() => setDeleteTarget(q)}
                          className="opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Mobile cards */}
              <ul className="lg:hidden">
                {visible.map((q) => (
                  <li key={q.id} className="border-t border-hairline first:border-t-0">
                    <Link href={href(q)} className="block px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-semibold tracking-tight text-ink">
                            {q.reference || q.customerName || "Untitled job"}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-ink-muted">
                            {[q.customerName, q.siteAddress].filter(Boolean).join(" · ") || "No site set"}
                          </p>
                        </div>
                        <StageChip status={q.status} />
                      </div>
                      <div className="mt-3 flex items-center justify-between border-t border-hairline pt-3">
                        <span className="text-base font-semibold tabular-nums tracking-tight text-ink">
                          {formatGBP(q.total)}
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                          {q.next.label}
                          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        label="Delete job"
        className="max-w-md"
      >
        <div className="px-6 py-5">
          <h2 className="text-base font-semibold text-ink">Delete this job?</h2>
          <p className="mt-2 text-sm text-ink-muted">
            {deleteTarget?.reference || deleteTarget?.customerName || "This job"} and its items,
            measurements and files are removed. This cannot be undone.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={confirmDelete} disabled={pending} className="gap-2">
              {pending && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-4">
      <p className="eyebrow mb-1.5">{label}</p>
      <p className="text-[22px] font-semibold tabular-nums tracking-tight text-ink">{value}</p>
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "px-3 pb-2.5 pt-4 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted",
        className,
      )}
    >
      {children}
    </th>
  );
}
