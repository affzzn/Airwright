"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  confirmGrouping,
  renameGroup,
  excludeGroup,
  mergeGroups,
} from "@/server/actions/grouping";
import { cn } from "@/lib/utils";

export interface GroupingGroup {
  name: string;
  houseTypeId: string;
  documentId: string;
  confidence: "high" | "medium" | "low";
  relevantPageCount: number;
  totalPageCount: number;
  files: string[];
  flags: string[];
}

export interface AnswerKey {
  source: string;
  expected: string[];
  matched: string[];
  missing: string[];
  extra: string[];
}

export interface GroupingData {
  builderId: string;
  builderLabel: string;
  groups: GroupingGroup[];
  unplacedFiles: string[];
  answerKey?: AnswerKey | null;
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
  const ak = data.answerKey;
  const akMismatch = ak && (ak.missing.length > 0 || ak.extra.length > 0);
  const needsAttention =
    groups.some((g) => g.confidence !== "high") || data.unplacedFiles.length > 0 || Boolean(akMismatch);

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
            {groups.length === 1 ? "" : "s"} found
            {data.unplacedFiles.length > 0 &&
              ` · ${data.unplacedFiles.length} pack-level file${data.unplacedFiles.length === 1 ? "" : "s"} unplaced`}
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
        {ak && (
          <div className="border-b border-hairline px-5 py-2.5 text-xs">
            <p className={akMismatch ? "font-medium text-ink" : "text-ink-subtle"}>
              Cross-checked against the pack’s own list ({ak.source}):{" "}
              {ak.matched.length}/{ak.expected.length} house types matched
              {ak.missing.length > 0 && ` · ${ak.missing.length} missing`}
              {ak.extra.length > 0 && ` · ${ak.extra.length} extra`}
            </p>
            {ak.missing.length > 0 && (
              <p className="mt-0.5 text-ink-muted">
                On the sheet but not grouped: {ak.missing.slice(0, 10).join(", ")}
                {ak.missing.length > 10 && ` +${ak.missing.length - 10} more`}
              </p>
            )}
            {ak.extra.length > 0 && (
              <p className="mt-0.5 text-ink-muted">
                Grouped but not on the sheet: {ak.extra.slice(0, 10).join(", ")}
                {ak.extra.length > 10 && ` +${ak.extra.length - 10} more`}
              </p>
            )}
          </div>
        )}
        <ul className="divide-y divide-hairline">
          {groups.map((g) => (
            <GroupRow key={g.houseTypeId} group={g} others={groups} packId={packId} locked={busy} />
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

/** One group row with inline override controls (rename / merge / exclude). */
function GroupRow({
  group,
  others,
  packId,
  locked,
}: {
  group: GroupingGroup;
  others: GroupingGroup[];
  packId: string;
  locked: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(group.name);
  const disabled = locked || busy;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const mergeTargets = others.filter((o) => o.houseTypeId !== group.houseTypeId);

  return (
    <li className="px-5 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full max-w-xs rounded-md border border-hairline-strong bg-canvas px-2 py-1 text-sm text-ink"
              />
              <button
                disabled={disabled || !name.trim()}
                onClick={() =>
                  run(async () => {
                    await renameGroup(packId, group.houseTypeId, name);
                    setRenaming(false);
                  })
                }
                className="text-xs font-medium text-ink hover:underline disabled:opacity-50"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setRenaming(false);
                  setName(group.name);
                }}
                className="text-xs text-ink-subtle hover:text-ink"
              >
                Cancel
              </button>
            </div>
          ) : (
            <p className="truncate text-sm font-medium text-ink">{group.name}</p>
          )}
          <p className="mt-0.5 text-xs text-ink-subtle">
            {group.relevantPageCount} relevant / {group.totalPageCount} total page
            {group.totalPageCount === 1 ? "" : "s"} · {group.files.length} source file
            {group.files.length === 1 ? "" : "s"}
          </p>
        </div>
        <Badge variant={group.confidence === "high" ? "muted" : "outline"}>
          {CONFIDENCE_LABEL[group.confidence]}
        </Badge>
      </div>

      {group.flags.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {group.flags.map((f, i) => (
            <li key={i} className="text-xs text-ink-muted">
              — {f}
            </li>
          ))}
        </ul>
      )}

      {!renaming && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-subtle">
          <button
            disabled={disabled}
            onClick={() => setRenaming(true)}
            className="hover:text-ink disabled:opacity-50"
          >
            Rename
          </button>
          {mergeTargets.length > 0 && (
            <label className="flex items-center gap-1">
              Merge into
              <select
                disabled={disabled}
                value=""
                onChange={(e) => {
                  const t = mergeTargets.find((o) => o.houseTypeId === e.target.value);
                  if (t)
                    run(() =>
                      mergeGroups(packId, group.houseTypeId, group.documentId, t.houseTypeId, t.documentId),
                    );
                }}
                className="rounded-md border border-hairline bg-canvas px-1.5 py-0.5 text-xs text-ink disabled:opacity-50"
              >
                <option value="">…</option>
                {mergeTargets.map((o) => (
                  <option key={o.houseTypeId} value={o.houseTypeId}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            disabled={disabled}
            onClick={() => run(() => excludeGroup(packId, group.houseTypeId, group.documentId))}
            className="hover:text-ink disabled:opacity-50"
          >
            Exclude
          </button>
          {busy && <span className="text-ink-subtle">working…</span>}
        </div>
      )}
    </li>
  );
}
