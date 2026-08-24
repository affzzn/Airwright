"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addPlot } from "@/server/actions/plots";

/**
 * One-click "add this house type as a plot" — the fast path for pricing a house
 * type when the pack had no site layout (so no plots were auto-created). Creates
 * a detached plot with the next free number; edit its config/number in the Plots
 * table afterwards.
 */
export function AddAsPlot({
  projectId,
  houseTypeId,
}: {
  projectId: string;
  houseTypeId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <button
      type="button"
      disabled={pending}
      title="Create a plot for this house type so it can be priced"
      onClick={() =>
        start(async () => {
          setError(null);
          const res = await addPlot(projectId, { houseTypeId });
          if (!res.ok) setError(res.error ?? "Failed");
          else router.refresh();
        })
      }
      className="rounded border border-hairline-strong bg-canvas px-2 py-1 text-[11px] font-medium text-ink-muted transition-colors hover:bg-surface disabled:opacity-50"
    >
      {pending ? "…" : error ? "Failed" : "Add as plot"}
    </button>
  );
}
