"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  linkTakeoffToBank,
  markTakeoffAsNewBankType,
  detachHouseTypeFromBank,
} from "@/server/actions/bank";

/**
 * The bank strip on the review screen (docs/20 §6b). Shows how this take-off
 * relates to the shared bank — already linked, a proposed match with the drawing
 * diff, or new — and lets the estimator override (link / mark new / detach). The
 * automatic write happens on confirm; this is the human-in-the-loop control.
 */
export interface BankPanelData {
  takeoffId: string;
  houseTypeId: string;
  status: string;
  reusedUnverified: boolean;
  linked: { entryId: string; name: string; code: string | null; state: string } | null;
  proposal:
    | { entryId: string | null; name: string | null; state: string; diffs: string[] }
    | null;
}

export function BankMatchPanel({ data }: { data: BankPanelData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Failed");
      else router.refresh();
    });
  }

  const dot = <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-ink/40" aria-hidden />;
  const wrap = "flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-hairline bg-surface/60 px-6 py-2 text-xs";
  const btn =
    "rounded border border-hairline-strong bg-canvas px-2 py-0.5 text-[11px] font-medium text-ink transition-colors hover:bg-surface disabled:opacity-50";

  // Reused-from-bank, not yet checked against a drawing (skip-read safeguard).
  if (data.reusedUnverified) {
    return (
      <div className={wrap}>
        {dot}
        <span className="text-ink-muted">
          Reused from bank — not yet verified against a drawing. Upload the drawing to check for changes.
        </span>
        {data.linked && (
          <Link href={`/bank/${data.linked.entryId}`} className="text-ink hover:underline">
            View in bank →
          </Link>
        )}
      </div>
    );
  }

  // Already linked.
  if (data.linked) {
    return (
      <div className={wrap}>
        {dot}
        <span className="text-ink-muted">
          {data.linked.state === "CHANGED"
            ? "Drawing differs from the banked version — sense-check."
            : data.linked.state === "NEW"
              ? "Saved to the bank as a new type."
              : "Linked to the bank."}
        </span>
        <span className="font-medium text-ink">
          {data.linked.name}
          {data.linked.code ? ` · ${data.linked.code}` : ""}
        </span>
        <Link href={`/bank/${data.linked.entryId}`} className="text-ink hover:underline">
          View →
        </Link>
        <button type="button" className={btn} disabled={pending} onClick={() => run(() => detachHouseTypeFromBank(data.houseTypeId))}>
          Detach
        </button>
        {error && <span className="text-ink-subtle">{error}</span>}
      </div>
    );
  }

  // Not linked yet — show the proposal (informational until confirmed; actionable after).
  const p = data.proposal;
  const confirmed = data.status === "CONFIRMED";
  return (
    <div className={wrap}>
      {dot}
      {!p || p.state === "NEW" || !p.entryId ? (
        <span className="text-ink-muted">
          No bank match — a new type.{" "}
          {confirmed ? "Saved to the bank on confirm." : "Will be added to the bank when confirmed."}
        </span>
      ) : (
        <>
          <span className="text-ink-muted">
            {p.state === "REUSE"
              ? "Matches a banked type"
              : p.state === "CHANGED"
                ? "Looks like a banked type — the drawing differs"
                : p.state === "AMBIGUOUS"
                  ? "Named like a banked type, but the measurements differ"
                  : "Possible bank matches"}
          </span>
          <span className="font-medium text-ink">{p.name}</span>
          {p.diffs.length > 0 && (
            <span className="text-ink-subtle">({p.diffs.slice(0, 4).join(", ")})</span>
          )}
          {confirmed && p.entryId && (
            <>
              <button type="button" className={btn} disabled={pending} onClick={() => run(() => linkTakeoffToBank(data.takeoffId, p.entryId as string))}>
                Link
              </button>
              <button type="button" className={btn} disabled={pending} onClick={() => run(() => markTakeoffAsNewBankType(data.takeoffId))}>
                It’s new
              </button>
            </>
          )}
        </>
      )}
      {error && <span className="text-ink-subtle">{error}</span>}
    </div>
  );
}
