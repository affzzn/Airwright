"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Search, Trash2 } from "lucide-react";
import { deleteConstructionQuote } from "@/server/actions/construction";
import type { ConstructionQuoteListItem } from "@/server/construction";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { StatCard } from "@/components/ui/stat-card";
import { formatDate, formatGBP, cn } from "@/lib/utils";
import { BAND_LABEL, type RateBand } from "@/lib/construction/types";

type Status = "DRAFT" | "CONFIRMED" | "QUOTED";
type Filter = "ALL" | Status;
const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "DRAFT", label: "Draft" },
  { key: "CONFIRMED", label: "Confirmed" },
  { key: "QUOTED", label: "Quoted" },
];

export function ConstructionWorkspace({ quotes }: { quotes: ConstructionQuoteListItem[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [deleteTarget, setDeleteTarget] = useState<ConstructionQuoteListItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const stats = useMemo(
    () => ({
      quotes: quotes.length,
      drafts: quotes.filter((q) => q.status === "DRAFT").length,
      confirmed: quotes.filter((q) => q.status === "CONFIRMED" || q.status === "QUOTED").length,
    }),
    [quotes],
  );

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
    setBusyId(id);
    startTransition(async () => {
      await deleteConstructionQuote(id);
      setDeleteTarget(null);
      router.refresh();
      setBusyId(null);
    });
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-1">Construction</p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Construction quotes</h1>
        </div>
        <Link href="/construction/new">
          <Button variant="secondary" className="gap-2">
            <Plus className="h-4 w-4" strokeWidth={1.75} /> New quote
          </Button>
        </Link>
      </div>

      {/* Stat strip */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <StatCard label="Quotes" value={stats.quotes} />
        <StatCard label="Drafts" value={stats.drafts} />
        <StatCard label="Confirmed" value={stats.confirmed} />
      </div>

      {/* Toolbar */}
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
            strokeWidth={1.75}
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search quotes, customers or sites"
            className="pl-9"
            aria-label="Search construction quotes"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "h-8 rounded-full border px-3 text-xs transition-colors",
                filter === f.key
                  ? "border-hairline-strong bg-surface-2 font-medium text-ink"
                  : "border-hairline text-ink-muted hover:bg-surface",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {visible.length === 0 ? (
        <Card>
          <CardBody className="py-14 text-center text-sm text-ink-subtle">
            {quotes.length === 0 ? (
              <>
                No construction quotes yet.{" "}
                <Link href="/construction/new" className="text-ink underline decoration-hairline-strong underline-offset-2 hover:decoration-ink">
                  Create one
                </Link>
                .
              </>
            ) : (
              "No quotes match your search."
            )}
          </CardBody>
        </Card>
      ) : (
        <div className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline">
          {visible.map((q) => (
            <Row
              key={q.id}
              q={q}
              busy={busyId === q.id}
              onDelete={() => setDeleteTarget(q)}
            />
          ))}
        </div>
      )}

      {/* Delete confirm */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => (busyId ? null : setDeleteTarget(null))}
        label="Delete quote"
        className="max-w-md"
      >
        <div className="border-b border-hairline px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">Delete quote</h2>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-ink-muted">
            Permanently delete{" "}
            <span className="font-medium text-ink">
              {deleteTarget?.reference || deleteTarget?.customerName || "this quote"}
            </span>{" "}
            and its measurements, lines and attachment records. This can’t be undone.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={busyId !== null} onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button type="button" disabled={busyId !== null} onClick={confirmDelete} className="gap-2">
              {busyId === deleteTarget?.id && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Row({
  q,
  busy,
  onDelete,
}: {
  q: ConstructionQuoteListItem;
  busy: boolean;
  onDelete: () => void;
}) {
  const name = q.reference || q.customerName || "Untitled quote";
  const subtitle = [
    q.reference ? q.customerName : q.siteAddress,
    BAND_LABEL[q.band as RateBand] ?? q.band,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={cn(
        "group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface",
        busy && "opacity-50",
      )}
    >
      <Link href={`/construction/${q.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{name}</p>
          <p className="mt-0.5 truncate text-xs text-ink-subtle">{subtitle}</p>
        </div>
        <StatusChip status={q.status} />
        <div className="hidden w-36 shrink-0 text-right text-xs text-ink-subtle sm:block">
          <span className="tabular-nums text-ink-muted">{formatGBP(q.total)}</span>
          {q.lineCount > 0 && ` · ${q.lineCount} item${q.lineCount === 1 ? "" : "s"}`}
        </div>
        <div className="hidden w-16 shrink-0 text-right text-xs text-ink-subtle md:block">
          {formatDate(q.createdAt)}
        </div>
      </Link>
      <div className="flex shrink-0 gap-0.5 text-ink-subtle opacity-60 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          disabled={busy}
          onClick={onDelete}
          aria-label="Delete quote"
          title="Delete"
          className="rounded-md p-1.5 transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:pointer-events-none"
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const base =
    "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-surface px-2.5 py-0.5 text-[11px] text-ink-muted";
  if (status === "CONFIRMED")
    return (
      <span className={base}>
        <span className="h-1.5 w-1.5 rounded-full bg-ink" />
        Confirmed
      </span>
    );
  if (status === "QUOTED")
    return (
      <span className={base}>
        <span className="h-1.5 w-1.5 rounded-full bg-ink-subtle" />
        Quoted
      </span>
    );
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-dashed border-hairline-strong bg-surface px-2.5 py-0.5 text-[11px] text-ink-subtle">
      Draft
    </span>
  );
}
