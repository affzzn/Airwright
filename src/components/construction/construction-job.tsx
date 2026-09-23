"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, Loader2, Lock, Unlock } from "lucide-react";
import { setConstructionQuoteStatus } from "@/server/actions/construction";
import type {
  ConstructionElementLibVM,
  ConstructionLineVM,
  ConstructionQuoteVM,
} from "@/server/construction";
import { lineAmount, priceConstructionQuote } from "@/lib/construction/price";
import {
  factsFromQuote,
  jobSteps,
  type JobStep,
  type StepStatus,
} from "@/lib/construction/jobState";
import type { ConstructionUnit } from "@/lib/construction/types";
import { Button } from "@/components/ui/button";
import { EnquiryStep } from "@/components/construction/steps/enquiry-step";
import { FactsStep } from "@/components/construction/steps/facts-step";
import { ItemsStep } from "@/components/construction/steps/items-step";
import { QuoteStep } from "@/components/construction/steps/quote-step";
import { isPreviewable } from "@/components/construction/construction-reference-viewer";
import { cn, formatGBP } from "@/lib/utils";

/**
 * One construction job, in four steps (docs/19 §8): read the enquiry, confirm
 * the site facts, build the items, issue the quote. The rail is a status
 * display, not a wizard — every step stays reachable at any time.
 */
export function ConstructionJob({
  quote,
  library,
  aiEnabled,
  initialStep,
  quoteDocument,
}: {
  quote: ConstructionQuoteVM;
  library: ConstructionElementLibVM[];
  aiEnabled: boolean;
  initialStep: JobStep;
  quoteDocument: React.ReactNode;
}) {
  const router = useRouter();
  const locked = quote.status !== "DRAFT";
  const [step, setStep] = useState<JobStep>(initialStep);

  // A live copy of the priced lines, so inline edits update the totals without a
  // round trip. Re-synced when the SET of lines changes (add, remove, apply).
  const [lines, setLines] = useState<ConstructionLineVM[]>(quote.lines);
  const lineSig = quote.lines.map((l) => l.id).join(",");
  useEffect(() => {
    setLines(quote.lines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineSig]);

  const [selectedFileId, setSelectedFileId] = useState<string | null>(
    quote.attachments.find(isPreviewable)?.id ?? null,
  );
  useEffect(() => {
    if (selectedFileId && quote.attachments.some((a) => a.id === selectedFileId)) return;
    setSelectedFileId(quote.attachments.find(isPreviewable)?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote.attachments.map((a) => a.id).join(",")]);

  /** Live lines with their amounts recomputed from the edited fields. */
  const livePricedLines = useMemo(
    () =>
      lines.map((l) => ({
        ...l,
        amount: lineAmount({
          unit: l.unit as ConstructionUnit,
          quantity: l.quantity,
          lifts: l.lifts,
          rate: l.rate,
        }),
      })),
    [lines],
  );

  const priced = useMemo(
    () =>
      priceConstructionQuote({
        lines: lines.map((l) => ({
          unit: l.unit as ConstructionUnit,
          quantity: l.quantity,
          lifts: l.lifts,
          rate: l.rate,
        })),
        extraHirePctPerWeek: quote.extraHirePctPerWeek,
      }),
    [lines, quote.extraHirePctPerWeek],
  );

  const facts = useMemo(
    () => factsFromQuote({ ...quote, lines: livePricedLines }),
    [quote, livePricedLines],
  );
  const steps = jobSteps(facts);

  const goToStep = (s: JobStep) => {
    setStep(s);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("step", s);
      window.history.replaceState(null, "", url.toString());
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const [lockPending, startLock] = useTransition();
  const toggleLock = () =>
    startLock(async () => {
      await setConstructionQuoteStatus(quote.id, locked ? "DRAFT" : "CONFIRMED");
      router.refresh();
    });

  const meta = [
    quote.customerName,
    quote.siteAddress,
    quote.durationWeeks ? `${quote.durationWeeks} week hire` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div>
      {/* Job header */}
      <div className="mb-5">
        <Link
          href="/construction"
          className="mb-2.5 inline-flex items-center gap-1 text-sm text-ink-subtle transition-colors hover:text-ink"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
          Jobs
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-ink">
                {quote.reference || quote.customerName || "Untitled job"}
              </h1>
              <span
                className={cn(
                  "inline-flex h-[22px] shrink-0 items-center rounded-md px-2 text-[11px] font-semibold",
                  locked ? "bg-ink text-canvas" : "bg-surface text-ink-muted",
                )}
              >
                {quote.status === "QUOTED" ? "Issued" : locked ? "Confirmed" : "Draft"}
              </span>
            </div>
            {meta && <p className="mt-1 truncate text-sm text-ink-muted">{meta}</p>}
          </div>

          <div className="flex items-center gap-5">
            <div className="text-right">
              <p className="eyebrow mb-0.5">Total</p>
              <p
                className={cn(
                  "text-xl font-semibold tabular-nums tracking-tight",
                  priced.total > 0 ? "text-ink" : "text-ink-subtle",
                )}
              >
                {formatGBP(priced.total)}
              </p>
            </div>
            <Button
              variant={locked ? "secondary" : "primary"}
              onClick={toggleLock}
              disabled={lockPending || (!locked && lines.length === 0)}
              className="gap-2"
            >
              {lockPending ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              ) : locked ? (
                <Unlock className="h-4 w-4" strokeWidth={1.75} />
              ) : (
                <Lock className="h-4 w-4" strokeWidth={1.75} />
              )}
              {locked ? "Reopen" : "Confirm"}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile step scroller */}
      <div className="-mx-6 mb-4 flex gap-2 overflow-x-auto px-6 pb-1 lg:hidden">
        {steps.map((s, i) => (
          <button
            key={s.key}
            type="button"
            onClick={() => goToStep(s.key)}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-[13px] transition-colors",
              step === s.key
                ? "border-ink bg-ink font-semibold text-canvas"
                : "border-hairline-strong bg-canvas text-ink-muted",
            )}
          >
            <StepMark index={i} status={s.status} active={step === s.key} />
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex gap-6">
        {/* Step rail */}
        <aside className="hidden w-56 shrink-0 lg:block">
          <nav className="sticky top-20 flex flex-col gap-1">
            {steps.map((s, i) => {
              const active = step === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => goToStep(s.key)}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                    active
                      ? "border-hairline bg-canvas"
                      : "border-transparent hover:bg-surface/70",
                  )}
                >
                  <StepMark index={i} status={s.status} active={active} />
                  <span className="min-w-0">
                    <span
                      className={cn(
                        "block text-[13px]",
                        active ? "font-semibold text-ink" : "font-medium text-ink-muted",
                      )}
                    >
                      {s.label}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-muted">{s.hint}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Step content */}
        <div className="min-w-0 flex-1">
          {step === "enquiry" && (
            <EnquiryStep
              quote={quote}
              library={library}
              locked={locked}
              aiEnabled={aiEnabled}
              selectedFileId={selectedFileId}
              onSelectFile={setSelectedFileId}
              goToStep={goToStep}
            />
          )}
          {step === "facts" && (
            <FactsStep
              quote={quote}
              library={library}
              locked={locked}
              extraHirePerWeek={priced.extraHirePerWeek}
            />
          )}
          {step === "items" && (
            <ItemsStep
              quote={quote}
              library={library}
              lines={lines}
              setLines={setLines}
              locked={locked}
              selectedFileId={selectedFileId}
              onSelectFile={setSelectedFileId}
            />
          )}
          {step === "quote" && (
            <QuoteStep
              quote={quote}
              facts={facts}
              locked={locked}
              total={priced.total}
              extraHirePerWeek={priced.extraHirePerWeek}
              quoteDocument={quoteDocument}
              goToStep={goToStep}
              onToggleLock={toggleLock}
              lockPending={lockPending}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** The step's number, or a tick once it is done. */
function StepMark({
  index,
  status,
  active,
}: {
  index: number;
  status: StepStatus;
  active: boolean;
}) {
  const done = status === "done";
  return (
    <span
      className={cn(
        "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border text-[11px] font-bold",
        done || active
          ? "border-ink bg-ink text-canvas"
          : status === "attention"
            ? "border-ink-subtle bg-canvas text-ink-muted"
            : "border-hairline-strong bg-canvas text-ink-subtle",
      )}
    >
      {done ? <Check className="h-3 w-3" strokeWidth={3.2} /> : index + 1}
    </span>
  );
}
