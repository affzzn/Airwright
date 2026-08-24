"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addPlot, bulkUpdatePlots, deletePlot, updatePlot } from "@/server/actions/plots";
import { cn } from "@/lib/utils";

export interface PlotRow {
  id: string;
  plotNumber: string;
  houseTypeId: string;
  configuration: string;
  isRendered: boolean;
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
  const [error, setError] = useState<string | null>(null);
  // Add-plot form (default to the top house type — usually the confirmed one)
  const [addHt, setAddHt] = useState(
    () => [...houseTypes].sort(sortHouseTypes)[0]?.id ?? "",
  );
  const [addConfig, setAddConfig] = useState("DETACHED");
  const [addNumber, setAddNumber] = useState("");
  const [addCount, setAddCount] = useState("1");

  const options = [...houseTypes].sort(sortHouseTypes);
  const htStatusById = new Map(houseTypes.map((h) => [h.id, h.status]));

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
    const patch: { houseTypeId?: string; configuration?: string; isRendered?: boolean } = {};
    if (bulkHt) patch.houseTypeId = bulkHt;
    if (bulkConfig) patch.configuration = bulkConfig;
    if (bulkRender) patch.isRendered = bulkRender === "yes";
    if (Object.keys(patch).length === 0) {
      setError("Choose a house type, configuration or render to apply.");
      return;
    }
    run(async () => {
      const res = await bulkUpdatePlots([...selected], patch);
      if (res.ok) {
        setSelected(new Set());
        setBulkHt("");
        setBulkConfig("");
        setBulkRender("");
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
      }
      return res;
    });
  };

  const selectClass =
    "rounded-md border border-hairline-strong bg-canvas px-2 py-1 text-xs text-ink " +
    "focus:border-ink focus:outline-none disabled:opacity-50";

  return (
    <div>
      {error && (
        <p className="border-b border-hairline bg-surface px-5 py-2 text-xs text-ink-muted">
          {error}
        </p>
      )}

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

      {/* Add plot */}
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-5 py-2.5">
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
      </div>

      {plots.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-ink-subtle">
          No plots yet. Add one above to price this house type — or upload a site layout to read
          the plot list automatically.
        </p>
      ) : (
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
                      <span
                        title={priceable ? "Take-off confirmed — will price" : "Take-off not confirmed — won't price"}
                        className={cn(
                          "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                          priceable ? "bg-ink" : "border border-hairline-strong",
                        )}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      aria-label={`Configuration for plot ${p.plotNumber}`}
                      value={p.configuration}
                      disabled={pending}
                      onChange={(e) =>
                        run(() => updatePlot(p.id, { configuration: e.target.value }))
                      }
                      className={selectClass}
                    >
                      {CONFIGS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        run(() => updatePlot(p.id, { isRendered: !p.isRendered }))
                      }
                      className={cn(
                        "rounded border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50",
                        p.isRendered
                          ? "border-transparent bg-ink text-canvas hover:opacity-90"
                          : "border-hairline-strong bg-canvas text-ink-muted hover:bg-surface",
                      )}
                    >
                      {p.isRendered ? "Rendered" : "—"}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => deletePlot(p.id))}
                      className="text-[11px] text-ink-subtle hover:text-ink disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      <p className="border-t border-hairline px-5 py-2.5 text-[11px] text-ink-subtle">
        A filled dot means the plot’s house type has a <strong>confirmed</strong> take-off and will
        price. Assign each plot its real house type (confirm its take-off on the Review screen), then
        set the configuration. Changes save automatically.
      </p>
    </div>
  );
}
