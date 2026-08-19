"use client";

import { useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { retryExtraction } from "@/server/actions/extractions";

/** "Retry" for a failed extraction — re-queues the job without a re-upload. */
export function RetryExtraction({ extractionId }: { extractionId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => retryExtraction(extractionId))}
      className="inline-flex items-center gap-1 rounded-md border border-hairline-strong px-2 py-1 text-xs font-medium text-ink transition-colors hover:bg-surface disabled:pointer-events-none disabled:opacity-40"
    >
      <RotateCcw className="h-3 w-3" strokeWidth={1.75} />
      {pending ? "Retrying…" : "Retry"}
    </button>
  );
}
