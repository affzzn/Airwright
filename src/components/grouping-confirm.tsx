"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { confirmGrouping } from "@/server/actions/grouping";
import { cn } from "@/lib/utils";

export interface GroupingGroup {
  name: string;
  confidence: "high" | "medium" | "low";
  pageCount: number;
  files: string[];
  flags: string[];
}

export interface GroupingData {
  builderId: string;
  builderLabel: string;
  groups: GroupingGroup[];
  ignoredCount: number;
  unplacedFiles: string[];
}

const CONFIDENCE_LABEL: Record<GroupingGroup["confidence"], string> = {
  high: "High confidence",
  medium: "Check",
  low: "Low — review",
};

/**
 * The grouping confirm screen (docs/17 §10): always shown before the paid
 * extraction, with low-confidence groups + unplaced files surfaced for
 * attention. Confirm starts extraction on the assembled combined-PDFs.
 */
export function GroupingConfirm({
  packId,
  data,
}: {
  packId: string;
  data: GroupingData;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Low-confidence groups and unplaced files float to the top for attention.
  const groups = [...data.groups].sort((a, b) => rank(a.confidence) - rank(b.confidence));
  const needsAttention =
    groups.some((g) => g.confidence !== "high") || data.unplacedFiles.length > 0;

  async function onConfirm() {
    setBusy(true);
    try {
      await confirmGrouping(packId);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-8 border-ink/20">
      <CardHeader className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink">Review grouping</h2>
          <p className="mt-0.5 text-xs text-ink-subtle">
            {data.builderLabel} · {groups.length} house type
            {groups.length === 1 ? "" : "s"} found ·{" "}
            {data.ignoredCount} file{data.ignoredCount === 1 ? "" : "s"} set aside as
            non-scaffold
            {data.unplacedFiles.length > 0 &&
              ` · ${data.unplacedFiles.length} unplaced`}
          </p>
        </div>
        <button
          onClick={onConfirm}
          disabled={busy}
          className={cn(
            "shrink-0 rounded-md bg-ink px-3.5 py-1.5 text-sm font-medium text-canvas transition-opacity",
            busy && "opacity-60",
          )}
        >
          {busy ? "Starting…" : "Confirm & extract"}
        </button>
      </CardHeader>
      <CardBody className="p-0">
        {needsAttention && (
          <p className="border-b border-hairline bg-surface px-5 py-2.5 text-xs text-ink-muted">
            Nothing is read until you confirm. Check the flagged groups
            {data.unplacedFiles.length > 0 && " and unplaced files"} below, then
            confirm to start extraction.
          </p>
        )}
        <ul className="divide-y divide-hairline">
          {groups.map((g) => (
            <li key={g.name} className="px-5 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{g.name}</p>
                  <p className="mt-0.5 text-xs text-ink-subtle">
                    {g.pageCount} page{g.pageCount === 1 ? "" : "s"} · {g.files.length}{" "}
                    source file{g.files.length === 1 ? "" : "s"}
                  </p>
                </div>
                <Badge variant={g.confidence === "high" ? "muted" : "outline"}>
                  {CONFIDENCE_LABEL[g.confidence]}
                </Badge>
              </div>
              {g.flags.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {g.flags.map((f, i) => (
                    <li key={i} className="text-xs text-ink-muted">
                      — {f}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        {data.unplacedFiles.length > 0 && (
          <div className="border-t border-hairline px-5 py-3">
            <p className="text-xs font-medium text-ink">
              Unplaced files ({data.unplacedFiles.length})
            </p>
            <ul className="mt-1 space-y-0.5">
              {data.unplacedFiles.slice(0, 12).map((f) => (
                <li key={f} className="truncate text-xs text-ink-subtle">
                  {f}
                </li>
              ))}
              {data.unplacedFiles.length > 12 && (
                <li className="text-xs text-ink-subtle">
                  …and {data.unplacedFiles.length - 12} more
                </li>
              )}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function rank(c: GroupingGroup["confidence"]): number {
  return c === "low" ? 0 : c === "medium" ? 1 : 2;
}
