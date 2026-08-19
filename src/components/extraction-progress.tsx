"use client";

import { useEffect, useState } from "react";
import { ProgressBar } from "@/components/ui/progress";

/**
 * A live per-house-type reading progress bar for the queue. The estimate is
 * time-based (elapsed vs the expected duration) because an LLM read is a single
 * opaque call — so the bar climbs steadily and *approaches* but never falsely
 * reaches 100% until the extraction actually completes. It animates locally (no
 * server polling); the existing pack-status poller flips the row to "Ready" when
 * the read finishes and this bar is unmounted.
 */
export function ExtractionProgress({
  status,
  startedAt,
  expectedMs,
}: {
  status: string;
  /** Epoch ms when the worker began reading, or null if not started yet. */
  startedAt: number | null;
  expectedMs: number;
}) {
  const running = status === "PROCESSING" && startedAt != null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 400);
    return () => clearInterval(t);
  }, [running]);

  // Queued, or processing before the start stamp landed → indeterminate.
  if (!running) {
    const label = status === "PENDING" ? "Queued…" : "Reading…";
    return (
      <div className="mt-2.5">
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-hairline-strong" />
        </div>
        <p className="mt-1 text-[11px] text-ink-subtle">{label}</p>
      </div>
    );
  }

  const elapsed = Math.max(0, now - (startedAt as number));
  // Asymptotic: ~82% at the expected time, ~95% at 2×, never 100 until done.
  const pct = 98 * (1 - Math.exp((-1.8 * elapsed) / expectedMs));
  const remainMs = Math.max(0, expectedMs - elapsed);
  const hint =
    elapsed < expectedMs ? `~${Math.ceil(remainMs / 1000)}s left` : "Almost done…";

  return (
    <div className="mt-2.5">
      <ProgressBar value={pct} />
      <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-ink-subtle">
        <span>Reading drawing &amp; extracting measurements…</span>
        <span className="shrink-0 tabular-nums">
          {Math.round(pct)}% · {hint}
        </span>
      </div>
    </div>
  );
}
