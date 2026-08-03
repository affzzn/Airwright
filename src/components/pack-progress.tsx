import { Fragment } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProgressStep, StepStatus } from "@/lib/pack-progress";

/**
 * Horizontal pipeline stepper. Driven entirely by real pack state
 * (see computePackProgress) — the active step pulses, done steps fill in, and
 * live counts show underneath. Re-renders on the page's auto-refresh poll.
 */
export function PackProgress({ steps }: { steps: ProgressStep[] }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface px-6 pt-5 pb-12">
      <div className="relative flex items-center">
        {steps.map((step, i) => (
          <Fragment key={step.key}>
            <div className="relative flex shrink-0 flex-col items-center">
              <StepDot status={step.status} />
              <div className="absolute top-8 flex w-24 flex-col items-center gap-0.5 text-center">
                <span
                  className={cn(
                    "text-[11px] font-medium leading-tight",
                    step.status === "pending" ? "text-ink-subtle" : "text-ink",
                  )}
                >
                  {step.label}
                </span>
                {step.detail && (
                  <span className="text-[10px] leading-tight text-ink-subtle tabular-nums">
                    {step.detail}
                  </span>
                )}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div
                className={cn(
                  "mx-1.5 h-px flex-1 transition-colors duration-500",
                  step.status === "done" ? "bg-ink" : "bg-hairline-strong",
                )}
              />
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function StepDot({ status }: { status: StepStatus }) {
  if (status === "done") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink text-canvas">
        <Check className="h-3 w-3" strokeWidth={2.5} />
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="step-active flex h-5 w-5 items-center justify-center rounded-full border-2 border-ink bg-canvas">
        <span className="h-1.5 w-1.5 rounded-full bg-ink" />
      </span>
    );
  }
  return (
    <span className="h-5 w-5 rounded-full border border-hairline-strong bg-canvas" />
  );
}
