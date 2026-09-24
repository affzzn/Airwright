"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reuseBankIntoHouseType } from "@/server/actions/bank";

/**
 * Upload-time repeat suggestion (docs/20 §6c). When a segmented house type's
 * name/code confidently matches a banked type, we flag it here — before/while the
 * drawing is read — so the estimator can reuse the confirmed take-off in one click
 * (skipping the read) instead of re-measuring. Human-in-the-loop: it only suggests.
 */
export function ReuseSuggestion({
  projectId,
  houseTypeId,
  entryId,
  entryName,
  entryCode,
}: {
  projectId: string;
  houseTypeId: string;
  entryId: string;
  entryName: string;
  entryCode: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-hairline-strong bg-surface/60 px-3 py-1.5 text-[11px]">
      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-ink/40" aria-hidden />
      <span className="text-ink-muted">
        Looks like a repeat of{" "}
        <span className="font-medium text-ink">
          {entryName}
          {entryCode ? ` · ${entryCode}` : ""}
        </span>{" "}
        in the bank
      </span>
      <button
        type="button"
        disabled={pending}
        title="Reuse the confirmed take-off from the bank instead of reading the drawing"
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await reuseBankIntoHouseType(projectId, houseTypeId, entryId);
            if (!res.ok) setError(res.error ?? "Failed");
            else router.refresh();
          })
        }
        className="rounded border border-hairline-strong bg-canvas px-2 py-0.5 font-medium text-ink transition-colors hover:bg-surface disabled:opacity-50"
      >
        {pending ? "Reusing…" : "Reuse without reading"}
      </button>
      {error && <span className="text-ink-subtle">{error}</span>}
    </div>
  );
}
