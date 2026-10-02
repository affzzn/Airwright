"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { checkBankPickAgainstDrawing, pickBankVersion } from "@/server/actions/bank";
import type { BankOrigin } from "@/server/bank";
import { formatDate } from "@/lib/utils";

/**
 * The review-page banner for a house type picked from the house bank (docs/20 v2):
 * where its numbers came from, that the drawing was not read, and — after the optional
 * "Check against this drawing" — whether this drawing still matches that version.
 */
export function BankOriginStrip({ houseTypeId, origin }: { houseTypeId: string; origin: BankOrigin }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"check" | "restore" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(key: "check" | "restore", fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key);
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong");
      else router.refresh();
      setBusy(null);
    });
  }

  const btn =
    "inline-flex items-center gap-1 rounded border border-hairline-strong bg-canvas px-2 py-0.5 text-[11px] font-medium text-ink transition-colors hover:bg-surface disabled:opacity-50";
  const diffs = origin.comparison?.diffs ?? [];
  const same = origin.comparison?.verdict === "IDENTICAL";
  const where = `${origin.name}${origin.code ? ` ${origin.code}` : ""} v${origin.version}`;

  return (
    <div className="border-b border-hairline bg-surface/70 px-6 py-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 rounded border border-ink px-1.5 py-0.5 text-[11px] font-semibold text-ink">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-ink" aria-hidden />
          From house bank
        </span>
        <span className="text-ink">
          <span className="font-medium">{where}</span>
          <span className="text-ink-muted">
            {" "}· {origin.builder}
            {origin.savedAt ? ` · saved ${formatDate(origin.savedAt)}` : ""}
            {origin.fromProject ? ` from ${origin.fromProject}` : ""}
          </span>
        </span>
        <Link href={`/bank/${origin.entryId}`} className="text-ink-muted hover:text-ink hover:underline">
          View in bank →
        </Link>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {origin.checking ? (
          <span className="inline-flex items-center gap-1.5 text-ink-muted">
            <Loader2 className="h-3 w-3 animate-spin" /> Reading this drawing to compare with v{origin.version}…
          </span>
        ) : !origin.drawingRead ? (
          <>
            <span className="text-ink-muted">
              {!same && diffs.length > 0
                ? `Edited since it was picked: ${diffs.map((d) => d.label.toLowerCase()).join(", ")}.`
                : origin.restored
                  ? `v${origin.version}'s numbers were put back after reading this drawing.`
                  : `This drawing was not read — these are the bank's numbers for v${origin.version}.`}
            </span>
            <button
              type="button"
              className={btn}
              disabled={pending}
              title="Read this drawing with the AI and compare it with the bank version (one read)"
              onClick={() => run("check", () => checkBankPickAgainstDrawing(houseTypeId))}
            >
              {busy === "check" && <Loader2 className="h-3 w-3 animate-spin" />}
              Check against this drawing
            </button>
          </>
        ) : same ? (
          <span className="font-medium text-ink">Checked against this drawing: matches v{origin.version}.</span>
        ) : (
          <>
            <span className="text-ink">
              <span className="font-medium">This drawing differs from v{origin.version}:</span>{" "}
              {diffs
                .slice(0, 6)
                .map((d) => `${d.label} ${fmt(d.from)} → ${fmt(d.to)}`)
                .join(" · ")}
            </span>
            <span className="text-ink-subtle">
              Check it, confirm, then Save to house bank to keep it as a new version.
            </span>
            <button
              type="button"
              className={btn}
              disabled={pending}
              onClick={() => run("restore", () => pickBankVersion(houseTypeId, origin.versionId))}
            >
              {busy === "restore" && <Loader2 className="h-3 w-3 animate-spin" />}
              Use v{origin.version}&rsquo;s numbers again
            </button>
          </>
        )}
        {error && <span className="text-ink-muted">{error}</span>}
      </div>
    </div>
  );
}

function fmt(v: number | string | null): string {
  if (v === null) return "—";
  if (typeof v === "number") return String(Math.round(v * 100) / 100);
  return v.toLowerCase().replace(/_/g, " ");
}
