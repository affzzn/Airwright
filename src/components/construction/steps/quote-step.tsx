"use client";

import Link from "next/link";
import { ArrowUpRight, Check, Download, Loader2, Lock, Printer, Unlock } from "lucide-react";
import type { ConstructionQuoteVM } from "@/server/construction";
import { issueChecks, type JobFacts, type JobStep } from "@/lib/construction/jobState";
import { BAND_LABEL, BRACKET_LABEL, type HeightBracket, type RateBand } from "@/lib/construction/types";
import { Button } from "@/components/ui/button";
import { EmptyHint, Panel } from "@/components/construction/parts";
import { cn, formatGBP } from "@/lib/utils";

/**
 * Step 4 — issue. The pre-issue checks are the gate (each links to its fix), the
 * preview is the real client document, and confirming freezes the lines.
 */
export function QuoteStep({
  quote,
  facts,
  locked,
  compact,
  total,
  extraHirePerWeek,
  quoteDocument,
  goToStep,
  onToggleLock,
  lockPending,
}: {
  quote: ConstructionQuoteVM;
  facts: JobFacts;
  locked: boolean;
  /** True when the drawing pane is open: stack instead of squeezing. */
  compact: boolean;
  total: number;
  extraHirePerWeek: number | null;
  quoteDocument: React.ReactNode;
  goToStep: (s: JobStep) => void;
  onToggleLock: () => void;
  lockPending: boolean;
}) {
  const checks = issueChecks(facts);
  const clear = checks.filter((c) => c.done).length;
  const bracket = quote.defaultHeightBracket as HeightBracket | null;

  const summary: { k: string; v: string }[] = [
    { k: "Items", v: String(quote.lines.length) },
    { k: "Rate band", v: BAND_LABEL[quote.band as RateBand] ?? quote.band },
    { k: "Height band", v: bracket ? BRACKET_LABEL[bracket] : "Not set" },
    {
      k: "Inclusive hire",
      v: quote.durationWeeks ? `${quote.durationWeeks} weeks` : "Not set",
    },
    { k: "Extra hire", v: extraHirePerWeek != null ? `${formatGBP(extraHirePerWeek)} a week` : "—" },
  ];

  return (
    <div className={cn("grid gap-4", !compact && "xl:grid-cols-[minmax(0,1fr)_320px]")}>
      <div className="flex min-w-0 flex-col gap-4">
        <Panel
          title="Before you issue"
          action={
            <span className="text-xs text-ink-muted">
              {clear} of {checks.length} clear
            </span>
          }
        >
          <ul className="grid gap-x-8 sm:grid-cols-2">
            {checks.map((c) => (
              <li key={c.key} className="flex items-center gap-3 border-t border-hairline py-2.5">
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-md",
                    c.done ? "bg-ink text-canvas" : "border border-hairline-strong",
                  )}
                >
                  {c.done ? (
                    <Check className="h-3 w-3" strokeWidth={3.2} />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-ink">{c.title}</span>
                  <span className="block truncate text-[11px] text-ink-muted">{c.detail}</span>
                </span>
                {!c.done && !locked && (
                  <button
                    type="button"
                    onClick={() => goToStep(c.step)}
                    className="shrink-0 text-xs font-semibold text-ink hover:underline"
                  >
                    {c.action}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          title="Quotation"
          action={
            <Link
              href={`/construction/${quote.id}/quote`}
              className="inline-flex items-center gap-1 text-xs font-semibold text-ink-muted hover:text-ink"
            >
              Open full view
              <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
            </Link>
          }
          bodyClassName="px-4 pb-4"
        >
          {quote.lines.length === 0 ? (
            <EmptyHint title="Nothing to quote yet">
              Add scaffold items and they appear here as the client will see them.
            </EmptyHint>
          ) : (
            <div className="h-[540px] overflow-y-auto overscroll-contain rounded-lg border border-hairline bg-surface p-3">
              <div className="w-[164%] origin-top-left scale-[0.61]">
                <div className="mb-[-38%]">{quoteDocument}</div>
              </div>
            </div>
          )}
        </Panel>
      </div>

      <div className={cn("flex flex-col gap-4", !compact && "xl:sticky xl:top-20 xl:self-start")}>
        <Panel>
          <p className="eyebrow mb-1.5">Total excluding VAT</p>
          <p className="text-[28px] font-semibold tabular-nums tracking-tight text-ink">
            {formatGBP(total)}
          </p>
          <dl className="mt-4 flex flex-col gap-2.5 border-t border-hairline pt-3.5">
            {summary.map((s) => (
              <div key={s.k} className="flex items-baseline justify-between gap-3 text-[13px]">
                <dt className="text-ink-muted">{s.k}</dt>
                <dd className="font-medium tabular-nums text-ink">{s.v}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel title={locked ? "Issued" : "Issue"}>
          <Button
            onClick={onToggleLock}
            variant={locked ? "secondary" : "primary"}
            className="h-11 w-full gap-2"
            disabled={lockPending || (!locked && quote.lines.length === 0)}
          >
            {lockPending ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            ) : locked ? (
              <Unlock className="h-4 w-4" strokeWidth={1.75} />
            ) : (
              <Lock className="h-4 w-4" strokeWidth={1.75} />
            )}
            {locked ? "Reopen for editing" : "Confirm and issue"}
          </Button>
          <div className="mt-2.5 flex gap-2">
            <a href={`/construction/${quote.id}/quote/export`} className="flex-1">
              <Button variant="secondary" className="w-full gap-1.5">
                <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                Excel
              </Button>
            </a>
            <Link href={`/construction/${quote.id}/quote`} className="flex-1">
              <Button variant="secondary" className="w-full gap-1.5">
                <Printer className="h-3.5 w-3.5" strokeWidth={1.75} />
                Print
              </Button>
            </Link>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-muted">
            {locked
              ? "Lines and rates are frozen. Reopening starts a new version."
              : "Confirming freezes the lines and rates."}
          </p>
        </Panel>
      </div>
    </div>
  );
}
