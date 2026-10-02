"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { setConstructionJobParam } from "@/server/actions/constructionReview";
import { startConstructionRead } from "@/server/actions/constructionPack";
import { updateConstructionQuote } from "@/server/actions/construction";
import type { ConstructionQuoteVM } from "@/server/construction";
import type { ResolvedParam } from "@/lib/construction/params";
import { BRACKET_LABEL, type HeightBracket } from "@/lib/construction/types";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { CellInput, Panel, ToggleButton } from "@/components/construction/parts";
import { cn } from "@/lib/utils";

/**
 * The ⚠ job settings (docs/23 §16): every value Colin has not confirmed, with its
 * placeholder, why it was chosen, and a switch to confirm it for this job. A
 * changed setting re-measures the pack on the next read — every sheet's saved
 * read is reused, so that costs nothing.
 */

const OPTION_LABEL: Record<string, string> = {
  SOFFIT_OR_PARAPET: "Soffit (pitched) / parapet (flat)",
  SOFFIT: "Underside of soffit",
  PARAPET: "Top of parapet",
  RIDGE: "Ridge",
  LOWEST_PROPOSED: "Lowest proposed spot level",
  LOWEST_EXISTING: "Lowest existing level",
  FFL: "Finished floor − DPC",
  MAX_HEIGHT: "The highest scaffold",
  UNKNOWN: "Not known yet",
  WALL_LENGTH: "Length of wall",
  FLOOR_AREA: "Floor area",
  FOLLOW_EXTERNAL: "Same as the external lifts",
  MAIN_ONLY: "Main gables only",
  ALL: "All gables",
  SCOPED_OR_MARKED: "Rooms the scope or mark-up names",
  ALL_SUSPENDED: "Every suspended level + roof",
  ALL_OPENINGS: "Every slab opening",
  PER_RISER_PER_LEVEL: "One per riser per level",
  PER_SHAFT: "One per shaft",
  LONGEST_HIRE: "The longest hire on the job",
  BUILDING_BY_AREA: "Building × external / internal / birdcage",
  TERMS: "Stated as terms (price = the rates' 4 weeks)",
  INCLUDED: "Included in the price",
  PER_FLOOR_LEVEL: "One per floor level above ground",
  EVERY_LIFT: "Every lift boarded",
};

export function JobSettingsPanel({ quote, locked, aiEnabled }: { quote: ConstructionQuoteVM; locked: boolean; aiEnabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const params = Object.values(quote.params);
  const open = params.filter((p) => !p.confirmed).length;
  const hasPack = quote.sheets.length > 0;

  const save = (p: ResolvedParam, value: number | string | null, confirmed: boolean) =>
    start(async () => {
      setError(null);
      const res = await setConstructionJobParam(quote.id, p.key, value, confirmed);
      if (!res.ok) return setError(res.error ?? "Could not save that setting.");
      if (value !== p.value || value === null) setDirty(true);
      router.refresh();
    });
  const remeasure = () =>
    start(async () => {
      setError(null);
      const res = await startConstructionRead(quote.id);
      if (!res.ok) setError(res.error ?? "Could not start the read.");
      else setDirty(false);
      router.refresh();
    });

  return (
    <Panel
      title="Job settings"
      action={<span className="text-xs text-ink-muted">{open ? `${open} placeholder${open === 1 ? "" : "s"} to confirm` : "All confirmed"}</span>}
      bodyClassName="px-0 pb-0"
    >
      <p className="px-5 pb-2 text-xs leading-relaxed text-ink-muted">
        Values Colin has not confirmed yet. Every measurement and line that uses one is flagged until it is confirmed here.
      </p>
      <ul>
        {params.map((p) => (
          <ParamRow key={p.key} p={p} locked={locked || pending} onSave={save} />
        ))}
      </ul>
      {(dirty || error) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-5 py-3">
          <p className="text-xs text-ink">{error ?? "Settings changed: re-measure the pack to update the measurements (saved reads are reused — no AI cost)."}</p>
          {hasPack && aiEnabled && !error && (
            <Button size="sm" variant="secondary" className="gap-1.5" disabled={pending} onClick={remeasure}>
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />}
              Re-measure
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}

function ParamRow({
  p,
  locked,
  onSave,
}: {
  p: ResolvedParam;
  locked: boolean;
  onSave: (p: ResolvedParam, value: number | string | null, confirmed: boolean) => void;
}) {
  const code = p.key.split("_")[0];
  const [v, setV] = useState(String(p.value));
  useEffect(() => setV(String(p.value)), [p.value]);
  const numeric = typeof p.value === "number";
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-hairline px-5 py-2.5">
      <span className="min-w-0 flex-1 basis-64">
        <span className="block text-[13px] font-medium text-ink">
          <span className="mr-1.5 text-[11px] font-semibold text-ink-muted">{code}</span>
          {p.label}
          {p.overridden && <span className="ml-1.5 text-[11px] text-ink-muted">· set for this job</span>}
        </span>
        <span className="block text-[11px] leading-relaxed text-ink-muted">{p.basis}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {numeric ? (
          <span className="flex items-center gap-1.5">
            <CellInput
              aria-label={p.label}
              inputMode="decimal"
              value={v}
              disabled={locked}
              className="w-20"
              onChange={(e) => setV(e.target.value)}
              onBlur={() => v !== String(p.value) && v.trim() !== "" && onSave(p, Number(v), p.confirmed)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            {p.unit && <span className="text-[11px] text-ink-muted">{p.unit}</span>}
          </span>
        ) : (
          <Select
            aria-label={p.label}
            value={String(p.value)}
            disabled={locked || (p.options?.length ?? 0) < 2}
            onChange={(e) => onSave(p, e.target.value, p.confirmed)}
            className={cn("h-8 max-w-[15rem] text-xs")}
          >
            {(p.options ?? [String(p.value)]).map((o) => (
              <option key={o} value={o}>
                {OPTION_LABEL[o] ?? o}
              </option>
            ))}
          </Select>
        )}
        <ToggleButton
          on={p.confirmed}
          disabled={locked}
          onClick={() => onSave(p, p.value, !p.confirmed)}
          onLabel="Confirmed"
          offLabel="Confirm"
          title={p.confirmed ? "Confirmed for this job" : "Confirm this value for this job"}
        />
        {p.overridden && !locked && (
          <button type="button" className="text-[11px] font-semibold text-ink-muted hover:text-ink" onClick={() => onSave(p, null, false)}>
            Reset
          </button>
        )}
      </span>
    </li>
  );
}

/** What the drawings say about the height and band, per building — one click to adopt it. */
export function DrawingFactsPanel({ quote, locked }: { quote: ConstructionQuoteVM; locked: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const heights = quote.measurements.filter((m) => m.runId && (m.key ?? "").startsWith("height:"));
  if (heights.length === 0) return null;
  const perBuilding = [...new Set(heights.map((h) => h.buildingId ?? ""))].map((id) => {
    const hs = heights.filter((h) => (h.buildingId ?? "") === id);
    const top = hs.reduce((a, b) => (b.valueNumber > a.valueNumber ? b : a));
    return { id, name: quote.buildings.find((b) => b.id === id)?.name ?? "Job", top };
  });
  const max = perBuilding.reduce((a, b) => (b.top.valueNumber > a.top.valueNumber ? b : a));
  // The quote stores the height to 2 dp (11.925 → 11.93).
  const same =
    quote.buildingHeightM != null &&
    Math.abs(quote.buildingHeightM - max.top.valueNumber) < 0.006 &&
    quote.defaultHeightBracket === max.top.heightBracket;
  const adopt = () =>
    start(async () => {
      await updateConstructionQuote(quote.id, { buildingHeightM: max.top.valueNumber, defaultHeightBracket: max.top.heightBracket });
      router.refresh();
    });
  return (
    <Panel
      title="From the drawings"
      action={
        !locked && !same ? (
          <Button size="sm" variant="secondary" disabled={pending} onClick={adopt}>
            Use {max.top.valueNumber} m
          </Button>
        ) : same ? (
          <span className="text-xs text-ink-muted">In use</span>
        ) : undefined
      }
    >
      <ul className="flex flex-col gap-2">
        {perBuilding.map((b) => (
          <li key={b.id || "job"} className="flex items-start justify-between gap-3 text-[13px]" title={b.top.provenance.join("\n")}>
            <span className="min-w-0">
              <span className="block font-medium text-ink">{b.name}</span>
              <span className="block text-[11px] text-ink-muted">{b.top.note}</span>
            </span>
            <span className="shrink-0 text-right tabular-nums text-ink">
              {b.top.valueNumber} m
              <span className="block text-[11px] text-ink-muted">
                {[b.top.lifts != null ? `${b.top.lifts} lifts` : null, b.top.heightBracket ? BRACKET_LABEL[b.top.heightBracket as HeightBracket] : null].filter(Boolean).join(" · ")}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
