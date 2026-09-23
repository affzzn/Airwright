"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { reuseBankEntry } from "@/server/actions/bank";

export interface ReuseEntry {
  id: string;
  canonicalName: string;
  canonicalCode: string | null;
  storeys: number | null;
  perimeter: number | null;
  versions: number;
  timesReused: number;
}

/**
 * Reuse a confirmed house type from the shared bank into this tender without
 * re-reading a drawing (docs/20 §6c — skip-read). Materialises a confirmed
 * take-off + a plot in seconds; it lands flagged "not yet verified against a
 * drawing" so a change can still be checked later.
 */
export function ReuseFromBank({
  projectId,
  buildTypeLabel,
  entries,
}: {
  projectId: string;
  buildTypeLabel: string;
  entries: ReuseEntry[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.canonicalName.toLowerCase().includes(q) ||
        (e.canonicalCode ?? "").toLowerCase().includes(q),
    );
  }, [entries, query]);

  function reuse(id: string) {
    start(async () => {
      setError(null);
      const res = await reuseBankEntry(projectId, id);
      if (!res.ok) {
        setError(res.error ?? "Reuse failed");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={entries.length === 0}
        title={
          entries.length === 0
            ? "No banked house types for this client yet"
            : "Reuse a confirmed house type from the bank"
        }
        className="rounded border border-hairline-strong bg-canvas px-2.5 py-1 text-[11px] font-medium text-ink transition-colors hover:bg-surface disabled:opacity-40"
      >
        Reuse from bank
      </button>

      <Modal open={open} onClose={() => setOpen(false)} label="Reuse from bank" className="max-w-lg">
        <div className="border-b border-hairline px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">Reuse from bank</h2>
          <p className="mt-0.5 text-xs text-ink-subtle">
            {buildTypeLabel} house types confirmed before. Dropped straight into this tender —
            flagged to verify against the drawing.
          </p>
        </div>
        <div className="px-5 py-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or code…"
            className="w-full rounded-md border border-hairline-strong bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-ink"
          />
        </div>
        <div className="max-h-80 overflow-y-auto px-2 pb-2">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-ink-subtle">No matches.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {filtered.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {e.canonicalName}
                      {e.canonicalCode && (
                        <span className="ml-2 text-xs text-ink-subtle">{e.canonicalCode}</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-subtle">
                      {e.storeys != null ? `${e.storeys}-storey` : "—"}
                      {e.perimeter != null && ` · ${e.perimeter} m perimeter`}
                      {e.timesReused > 0 && ` · reused ${e.timesReused}×`}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={pending}
                    onClick={() => reuse(e.id)}
                    className="shrink-0"
                  >
                    {pending ? "…" : "Reuse"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && (
          <p className="border-t border-hairline px-5 py-2.5 text-xs text-ink-muted">{error}</p>
        )}
      </Modal>
    </>
  );
}
