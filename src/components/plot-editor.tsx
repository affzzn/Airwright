"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addPlot, bulkUpdatePlots, deletePlot, updatePlot } from "@/server/actions/plots";
import { cn } from "@/lib/utils";

export interface PlotRow {
  id: string;
  plotNumber: string;
  houseTypeId: string;
  configuration: string;
  isRendered: boolean;
  includePartyWall: boolean;
}
export interface HouseTypeOption {
  id: string;
  name: string;
  code: string | null;
  status: string; // CONFIRMED | IN_REVIEW | DRAFT | NONE
  plotCount: number;
}

const CONFIGS = [
  { value: "DETACHED", label: "Detached" },
  { value: "SEMI_DETACHED", label: "Semi" },
  { value: "END_TERRACE", label: "End terrace" },
  { value: "MID_TERRACE", label: "Mid terrace" },
];

/** Sort real (coded / extracted) house types to the top, then by name. */
function sortHouseTypes(a: HouseTypeOption, b: HouseTypeOption): number {
  const rank = (h: HouseTypeOption) =>
    h.status === "CONFIRMED" ? 0 : h.code ? 1 : h.status !== "NONE" ? 2 : 3;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  return a.name.localeCompare(b.name);
}

function htLabel(h: HouseTypeOption): string {
  const bits = [h.name];
  if (h.code) bits.push(h.code);
  const marker =
    h.status === "CONFIRMED" ? "✓ confirmed" : h.status === "NONE" ? "no take-off" : "draft";
  return `${bits.join(" · ")} — ${marker}`;
}

export function PlotEditor({
  projectId,
  plots,
  houseTypes,
}: {
  projectId: string;
  plots: PlotRow[];
  houseTypes: HouseTypeOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkHt, setBulkHt] = useState("");
  const [bulkConfig, setBulkConfig] = useState("");
  const [bulkRender, setBulkRender] = useState("");
  const [bulkPartyWall, setBulkPartyWall] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  // Add-plot form (default to the top house type — usually the confirmed one)
  const [addHt, setAddHt] = useState(
    () => [...houseTypes].sort(sortHouseTypes)[0]?.id ?? "",
  );
  const [addConfig, setAddConfig] = useState("DETACHED");
  const [addNumber, setAddNumber] = useState("");
  const [addCount, setAddCount] = useState("1");

  const options = [...houseTypes].sort(sortHouseTypes);
  const htStatusById = new Map(houseTypes.map((h) => [h.id, h.status]));
  const htById = new Map(houseTypes.map((h) => [h.id, h]));

  // "Simple" = every house type maps to at most one plot (no real site layout /
  // no mixed-config blocks). Then the house-type dropdown, checkboxes and bulk
  // bar are pure friction — collapse to a per-house-type strip. The full grid is
  // reserved for a genuine multi-plot development, which is what it's for.
  const perType = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of plots) m.set(p.houseTypeId, (m.get(p.houseTypeId) ?? 0) + 1);
    return m;
  }, [plots]);
  const simple = ![...perType.values()].some((c) => c > 1);

  // Readiness for pricing: a plot prices only when its house type's take-off is
  // CONFIRMED. Surface exactly what's blocking a quote.
  const readyCount = plots.filter((p) => htStatusById.get(p.houseTypeId) === "CONFIRMED").length;
  const notConfirmedCount = plots.length - readyCount;

  const allSelected = plots.length > 0 && selected.size === plots.length;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(plots.map((p) => p.id)));

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      router.refresh();
    });

  const applyBulk = () => {
    if (selected.size === 0) return;
    const patch: {
      houseTypeId?: string;
      configuration?: string;
      isRendered?: boolean;
      includePartyWall?: boolean;
    } = {};
    if (bulkHt) patch.houseTypeId = bulkHt;
    if (bulkConfig) patch.configuration = bulkConfig;
    if (bulkRender) patch.isRendered = bulkRender === "yes";
    if (bulkPartyWall) patch.includePartyWall = bulkPartyWall === "yes";
    if (Object.keys(patch).length === 0) {
      setError("Choose a house type, configuration, render or party wall to apply.");
      return;
    }
    run(async () => {
      const res = await bulkUpdatePlots([...selected], patch);
      if (res.ok) {
        setSelected(new Set());
        setBulkHt("");
        setBulkConfig("");
        setBulkRender("");
        setBulkPartyWall("");
      }
      return res;
    });
  };

  const submitAdd = () => {
    if (!addHt) {
      setError("Pick a house type to add a plot for.");
      return;
    }
    run(async () => {
      const res = await addPlot(projectId, {
        houseTypeId: addHt,
        plotNumber: addNumber.trim() || undefined,
        configuration: addConfig,
        count: addNumber.trim() ? 1 : Math.max(1, parseInt(addCount, 10) || 1),
      });
      if (res.ok) {
        setAddNumber("");
        setAddCount("1");
        setShowAdd(false);
      }
      return res;
    });
  };

  const selectClass =
    "rounded-md border border-hairline-strong bg-canvas px-2 py-1 text-xs text-ink " +
    "focus:border-ink focus:outline-none disabled:opacity-50";

  const readyDot = (priceable: boolean) => (
    <span
      title={priceable ? "Take-off confirmed — will price" : "Take-off not confirmed — won't price"}
      className={cn(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
        priceable ? "bg-ink" : "border border-hairline-strong",
      )}
    />
  );

  const configSelect = (p: PlotRow) => (
    <select
      aria-label={`Configuration for plot ${p.plotNumber}`}
      value={p.configuration}
      disabled={pending}
      onChange={(e) => run(() => updatePlot(p.id, { configuration: e.target.value }))}
      className={selectClass}
    >
      {CONFIGS.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </select>
  );

  const renderToggle = (p: PlotRow) => (
    <button
      type="button"
      disabled={pending}
      onClick={() => run(() => updatePlot(p.id, { isRendered: !p.isRendered }))}
      className={cn(
        "rounded border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50",
        p.isRendered
          ? "border-transparent bg-ink text-canvas hover:opacity-90"
          : "border-hairline-strong bg-canvas text-ink-muted hover:bg-surface",
      )}
    >
      {p.isRendered ? "Rendered" : "Render"}
    </button>
  );

  // Party-wall spec item — one £165 unit on every non-detached plot. Detached has
  // no party wall, so the toggle is disabled there (it prices to £0 regardless).
  const partyWallToggle = (p: PlotRow) => {
    const detached = p.configuration === "DETACHED";
    return (
      <button
        type="button"
        disabled={pending || detached}
        title={detached ? "Detached — no party wall" : "Party-wall spec item (£165/unit)"}
        onClick={() =>
          run(() => updatePlot(p.id, { includePartyWall: !p.includePartyWall }))
        }
        className={cn(
          "rounded border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50",
          !detached && p.includePartyWall
            ? "border-transparent bg-ink text-canvas hover:opacity-90"
            : "border-hairline-strong bg-canvas text-ink-muted hover:bg-surface",
        )}
      >
        {detached ? "—" : p.includePartyWall ? "Party wall" : "No party wall"}
      </button>
    );
  };

  const deleteBtn = (p: PlotRow) => (
    <button
      type="button"
      disabled={pending}
      onClick={() => run(() => deletePlot(p.id))}
      className="text-[11px] text-ink-subtle hover:text-ink disabled:opacity-50"
    >
      Delete
    </button>
  );

  return (
    <div>
      {error && (
        <p className="border-b border-hairline bg-surface px-5 py-2 text-xs text-ink-muted">
          {error}
        </p>
      )}

      {/* Readiness + path to pricing */}
      {plots.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="font-medium text-ink">
              {readyCount} of {plots.length} plot{plots.length === 1 ? "" : "s"} ready to price
            </span>
            {notConfirmedCount > 0 && (
              <span className="text-ink-muted">
                {notConfirmedCount} awaiting a confirmed take-off
              </span>
            )}
          </div>
          <Link
            href={`/projects/${projectId}/pricing`}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              readyCount > 0
                ? "bg-ink text-canvas hover:opacity-90"
                : "border border-hairline-strong text-ink-muted hover:bg-surface",
            )}
          >
            Price →
          </Link>
        </div>
      )}

      {notConfirmedCount > 0 && (
        <p className="border-b border-hairline bg-surface px-5 py-2 text-[11px] text-ink-subtle">
          Confirm each house type’s take-off on its Review screen to make its plots price.
        </p>
      )}

      {simple ? (
        /* ---- Compact per-house-type strip (one plot per type) ---- */
        plots.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-subtle">
            No plots yet. Confirm a house type’s take-off to price it — or add one by hand below.
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {plots.map((p) => {
              const ht = htById.get(p.houseTypeId);
              const priceable = (ht?.status ?? "NONE") === "CONFIRMED";
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3"
                >
                  {readyDot(priceable)}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {ht?.name ?? "Unknown"}
                      {ht?.code && (
                        <span className="ml-2 text-xs text-ink-subtle">{ht.code}</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-subtle">Plot {p.plotNumber}</p>
                  </div>
                  {configSelect(p)}
                  {renderToggle(p)}
                  {partyWallToggle(p)}
                  {deleteBtn(p)}
                </li>
              );
            })}
          </ul>
        )
      ) : (
        /* ---- Full grid (a real multi-plot development) ---- */
        <>
          {/* Bulk action bar */}
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-hairline bg-surface px-5 py-2.5">
              <span className="text-xs font-medium text-ink">{selected.size} selected</span>
              <span className="text-ink-subtle">→</span>
              <select
                aria-label="Assign house type"
                value={bulkHt}
                onChange={(e) => setBulkHt(e.target.value)}
                disabled={pending}
                className={selectClass}
              >
                <option value="">House type…</option>
                {options.map((h) => (
                  <option key={h.id} value={h.id}>
                    {htLabel(h)}
                  </option>
                ))}
              </select>
              <select
                aria-label="Set configuration"
                value={bulkConfig}
                onChange={(e) => setBulkConfig(e.target.value)}
                disabled={pending}
                className={selectClass}
              >
                <option value="">Config…</option>
                {CONFIGS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Set render"
                value={bulkRender}
                onChange={(e) => setBulkRender(e.target.value)}
                disabled={pending}
                className={selectClass}
              >
                <option value="">Render…</option>
                <option value="yes">Rendered</option>
                <option value="no">Not rendered</option>
              </select>
              <select
                aria-label="Set party wall"
                value={bulkPartyWall}
                onChange={(e) => setBulkPartyWall(e.target.value)}
                disabled={pending}
                className={selectClass}
              >
                <option value="">Party wall…</option>
                <option value="yes">Party wall</option>
                <option value="no">No party wall</option>
              </select>
              <button
                type="button"
                onClick={applyBulk}
                disabled={pending}
                className="rounded-md bg-ink px-3 py-1 text-xs font-medium text-canvas hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Applying…" : "Apply"}
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                disabled={pending}
                className="text-xs text-ink-muted hover:text-ink"
              >
                Clear
              </button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left">
                  <th className="w-8 px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Select all plots"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="accent-ink"
                    />
                  </th>
                  <th className="px-3 py-2.5 font-medium text-ink-subtle">Plot</th>
                  <th className="px-3 py-2.5 font-medium text-ink-subtle">House type</th>
                  <th className="px-3 py-2.5 font-medium text-ink-subtle">Configuration</th>
                  <th className="px-3 py-2.5 font-medium text-ink-subtle">Render</th>
                  <th className="px-3 py-2.5 font-medium text-ink-subtle">Party wall</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {plots.map((p) => {
                  const status = htStatusById.get(p.houseTypeId) ?? "NONE";
                  const priceable = status === "CONFIRMED";
                  return (
                    <tr key={p.id} className="border-b border-hairline last:border-0">
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Select plot ${p.plotNumber}`}
                          checked={selected.has(p.id)}
                          onChange={() => toggle(p.id)}
                          className="accent-ink"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-ink">{p.plotNumber}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <select
                            aria-label={`House type for plot ${p.plotNumber}`}
                            value={p.houseTypeId}
                            disabled={pending}
                            onChange={(e) =>
                              run(() => updatePlot(p.id, { houseTypeId: e.target.value }))
                            }
                            className={cn(selectClass, "max-w-[220px]")}
                          >
                            {options.map((h) => (
                              <option key={h.id} value={h.id}>
                                {htLabel(h)}
                              </option>
                            ))}
                          </select>
                          {readyDot(priceable)}
                        </div>
                      </td>
                      <td className="px-3 py-2">{configSelect(p)}</td>
                      <td className="px-3 py-2">{renderToggle(p)}</td>
                      <td className="px-3 py-2">{partyWallToggle(p)}</td>
                      <td className="px-3 py-2 text-right">{deleteBtn(p)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Add plot — always available, but tucked behind a disclosure in the
          simple case (plots are auto-created on confirm, so it's rarely needed). */}
      {showAdd || !simple ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-5 py-2.5">
          <span className="text-xs font-medium text-ink">Add plot</span>
          <select
            aria-label="House type for new plot"
            value={addHt}
            onChange={(e) => setAddHt(e.target.value)}
            disabled={pending}
            className={selectClass}
          >
            <option value="">House type…</option>
            {options.map((h) => (
              <option key={h.id} value={h.id}>
                {htLabel(h)}
              </option>
            ))}
          </select>
          <select
            aria-label="Configuration for new plot"
            value={addConfig}
            onChange={(e) => setAddConfig(e.target.value)}
            disabled={pending}
            className={selectClass}
          >
            {CONFIGS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <input
            aria-label="Plot number (optional)"
            value={addNumber}
            onChange={(e) => setAddNumber(e.target.value)}
            disabled={pending}
            placeholder="Plot no. (auto)"
            className="w-28 rounded-md border border-hairline-strong bg-canvas px-2 py-1 text-xs text-ink placeholder:text-ink-subtle focus:border-ink focus:outline-none disabled:opacity-50"
          />
          {!addNumber.trim() && (
            <>
              <span className="text-xs text-ink-subtle">×</span>
              <input
                aria-label="How many plots to add"
                type="number"
                min={1}
                max={100}
                value={addCount}
                onChange={(e) => setAddCount(e.target.value)}
                disabled={pending}
                className="w-16 rounded-md border border-hairline-strong bg-canvas px-2 py-1 text-xs text-ink focus:border-ink focus:outline-none disabled:opacity-50"
              />
            </>
          )}
          <button
            type="button"
            onClick={submitAdd}
            disabled={pending}
            className="rounded-md bg-ink px-3 py-1 text-xs font-medium text-canvas hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Adding…" : "Add"}
          </button>
          {simple && (
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="text-xs text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          )}
        </div>
      ) : (
        <div className="border-t border-hairline px-5 py-2.5">
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="text-xs font-medium text-ink-muted hover:text-ink"
          >
            + Add a plot manually
          </button>
        </div>
      )}

      <p className="border-t border-hairline px-5 py-2.5 text-[11px] text-ink-subtle">
        A filled dot means the plot’s take-off is <strong>confirmed</strong> and will price.
        Confirming a take-off on the Review screen creates its plot automatically; set the
        configuration if it isn’t detached. Changes save automatically.
      </p>
    </div>
  );
}
