"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCustomMeterRate } from "@/server/actions/projects";

/**
 * The meter-rate (£/LM) field on the pricing screen's Commercial panel. Read-only
 * for standard bands (their rates live on /rates); EDITABLE for the Custom band —
 * saving sets the Custom band's external-lift rate and re-prices the matrix.
 */
export function MeterRateField({
  projectId,
  value,
  editable,
}: {
  projectId: string;
  value: number | null;
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [val, setVal] = useState(value !== null ? String(value) : "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setVal(value !== null ? String(value) : ""), [value]);

  if (!editable) {
    return (
      <div className="flex h-[38px] items-center rounded-md border border-hairline bg-surface px-3 text-sm tabular-nums text-ink-muted">
        {value !== null ? `£${value.toFixed(2)}` : "— no rate for this band"}
      </div>
    );
  }

  const save = () => {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) {
      setVal(value !== null ? String(value) : "");
      return;
    }
    if (value !== null && n === value) return;
    start(async () => {
      setError(null);
      const res = await setCustomMeterRate(projectId, n);
      if (!res.ok) setError(res.error ?? "Failed to save.");
      router.refresh();
    });
  };

  return (
    <div>
      <div className="flex h-[38px] items-center rounded-md border border-hairline-strong bg-canvas px-3 focus-within:border-ink">
        <span className="text-sm text-ink-subtle">£</span>
        <input
          inputMode="decimal"
          aria-label="Custom meter rate (£/LM)"
          value={val}
          disabled={pending}
          onChange={(e) => setVal(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="w-full bg-transparent px-1 text-sm tabular-nums text-ink focus:outline-none disabled:opacity-50"
        />
      </div>
      {error && <p className="mt-1 text-[11px] text-ink-muted">{error}</p>}
    </div>
  );
}
