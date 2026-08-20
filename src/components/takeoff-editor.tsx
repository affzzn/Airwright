"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { buildTakeoff, type Configuration } from "@/lib/takeoff/engine";
import { takeoffInputFromStored } from "@/lib/takeoff/fromStored";
import { saveTakeoffEdits, type TakeoffEditsInput } from "@/server/actions/takeoff";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfidenceDot } from "@/components/ui/badge";
import { Toggle } from "@/components/ui/toggle";
import { Provenance } from "@/components/ui/provenance";
import type { ExtractionResult } from "@/lib/extract/schema";
import {
  aiMeasurementValues,
  buildProvenanceCards,
  liftsProvenance,
  perimeterProvenance,
  resolvePage,
  wallProvenance,
  wallSumProvenance,
  type PageRef,
  type ProvContent,
} from "@/lib/provenance";

// --- Types shared with the page (all serialisable) ---------------------------

export interface EditorMeasurement {
  key: string;
  valueNumber: number | null;
  confidence: number | null;
  source: string;
}
export interface EditorWall {
  id: string;
  position: string;
  lengthM: number;
  confidence: number | null;
  sourceDimension: string | null;
  source: string;
}
export interface EditorCategoricals {
  roofType: "PITCHED" | "HIPPED" | "MIXED" | null;
  structure: "SINGLE" | "PAIR_OR_TERRACE" | "APARTMENT_BLOCK" | null;
  dwellingsWide: number | null;
  roomInRoof: boolean | null;
  rendered: boolean | null;
  chimney: boolean | null;
}

interface Props {
  takeoffId: string;
  measurements: EditorMeasurement[];
  walls: EditorWall[];
  warnings: Record<string, unknown>;
  categoricals: EditorCategoricals;
  /** The verbatim model output, for provenance (null on legacy extractions). */
  raw: ExtractionResult | null;
  /** Per-page sheet titles, for resolving a source label to a page number. */
  documentPages: PageRef[];
  /** Pages that were relevant to this extraction (the viewer's shown set). */
  relevantPages?: number[];
  /** Jump the drawing viewer to a page (wired to the workspace). */
  onGoToPage?: (page: number) => void;
  /** Report the live engine flags up, so they render beside the drawing. */
  onFlagsChange?: (flags: string[]) => void;
}

// The canonical, always-shown measurement rows (a blank one is fillable).
const MEASUREMENTS: { key: string; label: string; unit: string }[] = [
  { key: "STOREYS", label: "Storeys", unit: "" },
  { key: "HEIGHT_TO_SOFFIT", label: "Height to soffit", unit: "m" },
  { key: "CORNER_COUNT", label: "Corners", unit: "" },
  { key: "GABLE_QTY", label: "Gables / apex", unit: "" },
  { key: "RENDER_LENGTH", label: "Render length", unit: "m" },
  { key: "BIRDCAGE_GF_M2", label: "Birdcage (GF)", unit: "m²" },
  { key: "BIRDCAGE_FF_M2", label: "Birdcage (FF)", unit: "m²" },
  { key: "BIRDCAGE_SF_M2", label: "Birdcage (SF)", unit: "m²" },
  { key: "LOW_LEVEL_QTY", label: "Low-level", unit: "" },
];

const WALL_OPTIONS: { value: string; label: string }[] = [
  { value: "FRONT", label: "Front" },
  { value: "REAR", label: "Rear" },
  { value: "GABLE_LEFT", label: "Gable L" },
  { value: "GABLE_RIGHT", label: "Gable R" },
  { value: "OTHER", label: "Other" },
];

const ROOF_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "—" },
  { value: "PITCHED", label: "Pitched" },
  { value: "HIPPED", label: "Hipped" },
  { value: "MIXED", label: "Mixed" },
];
const STRUCTURE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "—" },
  { value: "SINGLE", label: "Single" },
  { value: "PAIR_OR_TERRACE", label: "Pair / terrace" },
  { value: "APARTMENT_BLOCK", label: "Apartment block" },
];

type WallRow = {
  key: string;
  id: string | null;
  position: string;
  lengthM: string;
  sourceDimension: string | null;
};

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const parseNum = (v: string): number | null => {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export function TakeoffEditor({
  takeoffId,
  measurements,
  walls,
  warnings,
  categoricals,
  raw,
  documentPages,
  relevantPages,
  onGoToPage,
  onFlagsChange,
}: Props) {
  // --- Initial editable state (memoised from the immutable props) ---
  const initialMVals = useMemo(() => {
    const r: Record<string, string> = {};
    for (const { key } of MEASUREMENTS) r[key] = "";
    for (const m of measurements)
      if (m.valueNumber !== null) r[m.key] = String(m.valueNumber);
    return r;
  }, [measurements]);

  const mMeta = useMemo(() => {
    const r: Record<string, { confidence: number | null; source: string }> = {};
    for (const m of measurements) r[m.key] = { confidence: m.confidence, source: m.source };
    return r;
  }, [measurements]);

  const initialWallRows = useMemo<WallRow[]>(
    () =>
      walls.map((w) => ({
        key: w.id,
        id: w.id,
        position: w.position,
        lengthM: String(w.lengthM),
        sourceDimension: w.sourceDimension,
      })),
    [walls],
  );

  const [mVals, setMVals] = useState(initialMVals);
  const [wallRows, setWallRows] = useState(initialWallRows);
  const [cats, setCats] = useState(categoricals);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const newCounter = useRef(0);

  // --- Provenance ("how was this derived") from the verbatim model output ---
  // Prefer the page the model actually cited (its 1-based page WITHIN the sliced
  // PDF maps exactly to the Nth relevant document page); fall back to matching the
  // sheet label against the classified page titles.
  const resolve = useMemo(
    () => (label: string | null | undefined, sourcePage?: number | null) => {
      if (
        typeof sourcePage === "number" &&
        relevantPages &&
        sourcePage >= 1 &&
        sourcePage <= relevantPages.length
      ) {
        return relevantPages[sourcePage - 1];
      }
      return resolvePage(label, documentPages, relevantPages);
    },
    [documentPages, relevantPages],
  );
  const cards = useMemo<Record<string, ProvContent>>(
    () => (raw ? buildProvenanceCards(raw, resolve) : {}),
    [raw, resolve],
  );
  // Wall length → its cited page, keyed by the dimension string (walls are edited
  // live, so match the raw wall by its dimension string to recover the page).
  const wallPageByDim = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of raw?.wallSegments ?? []) {
      if (!w.sourceDimension) continue;
      const page = resolve(w.sourceDimension, w.sourcePage);
      if (page !== null) m.set(w.sourceDimension, page);
    }
    return m;
  }, [raw, resolve]);
  const aiVals = useMemo<Record<string, number | null>>(
    () => (raw ? aiMeasurementValues(raw) : {}),
    [raw],
  );
  // A measurement's card, with an "edited" note appended once it's been corrected.
  const measurementCard = (key: string): ProvContent | null => {
    const base = cards[key];
    if (!base) return null;
    const aiVal = aiVals[key];
    const liveVal = parseNum(mVals[key] ?? "");
    if (aiVal != null && liveVal != null && Math.abs(liveVal - aiVal) > 1e-6) {
      return {
        ...base,
        footnotes: [...base.footnotes, `Edited — the AI originally read ${aiVal}.`],
      };
    }
    return base;
  };

  // --- Live recompute of the deterministic take-off (client-side, instant) ---
  const engineMeasurements = useMemo(
    () =>
      Object.entries(mVals)
        .map(([key, v]) => ({ key, valueNumber: parseNum(v) }))
        .filter((m) => m.valueNumber !== null),
    [mVals],
  );
  const engineWalls = useMemo(
    () => wallRows.map((w) => ({ position: w.position, lengthM: parseNum(w.lengthM) ?? 0 })),
    [wallRows],
  );
  const perimeter = useMemo(
    () => engineWalls.reduce((s, w) => s + w.lengthM, 0),
    [engineWalls],
  );
  const engineWarnings = useMemo(
    () => ({
      ...warnings,
      roofType: cats.roofType ?? undefined,
      roomInRoof: cats.roomInRoof ?? undefined,
      rendered: cats.rendered ?? undefined,
      chimney: cats.chimney ?? undefined,
      structure: cats.structure ?? undefined,
      dwellingsWide: cats.dwellingsWide ?? undefined,
    }),
    [warnings, cats],
  );

  const isApartment = cats.structure === "APARTMENT_BLOCK";
  const takeoffLines = useMemo(() => {
    const options: { label: string; config: Configuration }[] = isApartment
      ? [{ label: "Whole block", config: "DETACHED" }]
      : [
          { label: "Detached", config: "DETACHED" },
          { label: "Semi / End", config: "SEMI_DETACHED" },
          { label: "Mid-terrace", config: "MID_TERRACE" },
        ];
    return options.map(({ label, config }) => ({
      label,
      line: buildTakeoff(
        takeoffInputFromStored(engineMeasurements, engineWalls, engineWarnings, config),
      ),
    }));
  }, [isApartment, engineMeasurements, engineWalls, engineWarnings]);
  const engineFlags = takeoffLines[0]?.line.flags ?? [];

  // Surface the live flags beside the drawing (the workspace renders them there).
  useEffect(() => {
    onFlagsChange?.(engineFlags);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineFlags.join("|")]);

  // --- Auto-save (debounced) whenever the editable state differs from saved ---
  const serialise = (
    m: Record<string, string>,
    w: WallRow[],
    c: EditorCategoricals,
  ): string =>
    JSON.stringify({
      m,
      w: w.map((r) => [r.key, r.position, r.lengthM]),
      c,
    });
  const baseline = useRef(serialise(initialMVals, initialWallRows, categoricals));

  useEffect(() => {
    const snap = serialise(mVals, wallRows, cats);
    if (snap === baseline.current) {
      setSaveState((s) => (s === "saved" ? "saved" : "idle"));
      return;
    }
    setSaveState("dirty");
    const timer = setTimeout(async () => {
      setSaveState("saving");
      const payload = buildPayload(mVals, initialMVals, wallRows, cats);
      const res = await saveTakeoffEdits(takeoffId, payload);
      if (res?.ok) {
        baseline.current = snap;
        setSaveState("saved");
      } else {
        setSaveState("error");
      }
    }, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mVals, wallRows, cats]);

  // --- Handlers ---
  const setMeasurement = (key: string, v: string) =>
    setMVals((p) => ({ ...p, [key]: v }));
  const patchWall = (key: string, patch: Partial<WallRow>) =>
    setWallRows((p) => p.map((w) => (w.key === key ? { ...w, ...patch } : w)));
  const addWall = () =>
    setWallRows((p) => [
      ...p,
      {
        key: `new-${newCounter.current++}`,
        id: null,
        position: "FRONT",
        lengthM: "",
        sourceDimension: null,
      },
    ]);
  const removeWall = (key: string) =>
    setWallRows((p) => p.filter((w) => w.key !== key));

  const details = [
    typeof warnings.smartRoofPeakM === "number"
      ? `High roof peak ${warnings.smartRoofPeakM} m — check smart roof`
      : null,
  ].filter(Boolean) as string[];

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Extracted take-off</h2>
        <SaveIndicator state={saveState} />
      </CardHeader>
      <CardBody className="space-y-6">
        {/* Measurements */}
        <div>
          <p className="eyebrow mb-2">Measurements</p>
          <dl className="divide-y divide-hairline">
            {MEASUREMENTS.map(({ key, label, unit }) => {
              const meta = mMeta[key];
              const edited =
                mVals[key] !== initialMVals[key] ||
                meta?.source === "EDITED" ||
                meta?.source === "MANUAL";
              const card = measurementCard(key);
              return (
                <div key={key} className="flex items-center justify-between py-1.5">
                  <dt className="text-sm text-ink-muted">
                    {card ? (
                      <Provenance content={card} onGoToPage={onGoToPage}>
                        {label}
                      </Provenance>
                    ) : (
                      label
                    )}
                  </dt>
                  <dd className="flex items-center gap-2">
                    <NumField
                      value={mVals[key]}
                      unit={unit}
                      onChange={(v) => setMeasurement(key, v)}
                    />
                    <span className="flex w-10 justify-end">
                      {edited ? (
                        <span className="text-[10px] text-ink-subtle">edited</span>
                      ) : meta ? (
                        <ConfidenceDot value={meta.confidence} />
                      ) : null}
                    </span>
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>

        {/* Wall segments → perimeter */}
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <p className="eyebrow">Wall segments → perimeter</p>
            <Provenance
              content={wallSumProvenance(engineWalls, perimeter)}
              onGoToPage={onGoToPage}
              className="text-sm font-medium tabular-nums text-ink"
            >
              {perimeter.toFixed(3)} m
            </Provenance>
          </div>
          <ul className="divide-y divide-hairline">
            {wallRows.map((w) => (
              <li key={w.key} className="flex items-center gap-2 py-1.5">
                <select
                  value={w.position}
                  onChange={(e) => patchWall(w.key, { position: e.target.value })}
                  className="h-8 rounded-md border border-hairline-strong bg-canvas pl-2 pr-1 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                >
                  {WALL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <NumField
                  value={w.lengthM}
                  unit="m"
                  onChange={(v) => patchWall(w.key, { lengthM: v })}
                />
                <Provenance
                  content={wallProvenance(
                    parseNum(w.lengthM) ?? 0,
                    w.sourceDimension,
                    w.sourceDimension ? (wallPageByDim.get(w.sourceDimension) ?? null) : null,
                  )}
                  onGoToPage={onGoToPage}
                  className="text-xs text-ink-subtle"
                >
                  {w.sourceDimension ? `dim ${w.sourceDimension}` : "source"}
                </Provenance>
                <button
                  type="button"
                  aria-label="Remove wall"
                  onClick={() => removeWall(w.key)}
                  className="ml-auto rounded-md p-1 text-ink-subtle transition-colors hover:bg-surface hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </li>
            ))}
            {wallRows.length === 0 && (
              <p className="py-3 text-sm text-ink-subtle">No wall segments.</p>
            )}
          </ul>
          <button
            type="button"
            onClick={addWall}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} /> Add wall
          </button>
        </div>

        {/* Details (categorical, editable) */}
        <div>
          <p className="eyebrow mb-2">Details</p>
          <div className="divide-y divide-hairline">
            <DetailRow label="Roof type" card={cards.ROOF_TYPE} onGoToPage={onGoToPage}>
              <MiniSelect
                value={cats.roofType ?? ""}
                options={ROOF_OPTIONS}
                onChange={(v) =>
                  setCats((c) => ({
                    ...c,
                    roofType: (v || null) as EditorCategoricals["roofType"],
                  }))
                }
              />
            </DetailRow>
            <DetailRow label="Structure" card={cards.STRUCTURE} onGoToPage={onGoToPage}>
              <MiniSelect
                value={cats.structure ?? ""}
                options={STRUCTURE_OPTIONS}
                onChange={(v) =>
                  setCats((c) => ({
                    ...c,
                    structure: (v || null) as EditorCategoricals["structure"],
                  }))
                }
              />
            </DetailRow>
            {cats.structure === "PAIR_OR_TERRACE" && (
              <DetailRow label="Dwellings wide">
                <NumField
                  value={cats.dwellingsWide != null ? String(cats.dwellingsWide) : ""}
                  onChange={(v) =>
                    setCats((c) => ({ ...c, dwellingsWide: parseNum(v) }))
                  }
                />
              </DetailRow>
            )}
            <DetailRow
              label="Room in roof (2.5-storey)"
              card={cards.ROOM_IN_ROOF}
              onGoToPage={onGoToPage}
            >
              <Toggle
                checked={cats.roomInRoof === true}
                onChange={(v) => setCats((c) => ({ ...c, roomInRoof: v }))}
                label="Room in roof"
              />
            </DetailRow>
            <DetailRow label="Rendered" card={cards.RENDERED} onGoToPage={onGoToPage}>
              <Toggle
                checked={cats.rendered === true}
                onChange={(v) => setCats((c) => ({ ...c, rendered: v }))}
                label="Rendered"
              />
            </DetailRow>
            <DetailRow label="Chimney" card={cards.CHIMNEY} onGoToPage={onGoToPage}>
              <Toggle
                checked={cats.chimney === true}
                onChange={(v) => setCats((c) => ({ ...c, chimney: v }))}
                label="Chimney"
              />
            </DetailRow>
          </div>
          {details.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {details.map((d) => (
                <span
                  key={d}
                  className="rounded-md border border-hairline bg-surface px-2.5 py-1 text-xs text-ink-muted"
                >
                  {d}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Computed take-off (recomputed live from the edits) */}
        <div>
          <p className="eyebrow mb-2">Computed take-off · by configuration</p>
          <div className="space-y-2">
            {takeoffLines.map(({ label, line }) => (
              <div
                key={label}
                className="rounded-md border border-hairline bg-surface px-3 py-2.5"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs font-medium text-ink-muted">{label}</span>
                  <span className="text-xs tabular-nums text-ink-subtle">
                    <Provenance
                      content={liftsProvenance(
                        parseNum(mVals.HEIGHT_TO_SOFFIT ?? ""),
                        parseNum(mVals.STOREYS ?? ""),
                        cats.roomInRoof === true,
                        line.lifts.heightLifts,
                        line.lifts.storeyLifts,
                        line.lifts.lifts,
                        line.lifts.flag,
                      )}
                      onGoToPage={onGoToPage}
                    >
                      {line.lifts.lifts ?? "?"} lifts
                    </Provenance>
                    {line.perimeter.totalM !== null && (
                      <>
                        {" · "}
                        <Provenance
                          content={perimeterProvenance(
                            line.perimeter.corners,
                            1,
                            line.perimeter.wallsM,
                            line.perimeter.perLiftM,
                            line.lifts.lifts,
                            line.perimeter.totalM,
                          )}
                          onGoToPage={onGoToPage}
                        >
                          {line.perimeter.totalM} m total
                        </Provenance>
                      </>
                    )}
                  </span>
                </div>
                <p className="mt-1 text-sm tabular-nums text-ink">{line.text}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-ink-subtle">
            Extras (loading bay, chute, access, propping) come from the builder
            profile — not yet applied.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

// --- Small building blocks ---------------------------------------------------

function buildPayload(
  mVals: Record<string, string>,
  initialMVals: Record<string, string>,
  wallRows: WallRow[],
  cats: EditorCategoricals,
): TakeoffEditsInput {
  const measurements = MEASUREMENTS.filter(({ key }) => mVals[key] !== initialMVals[key])
    .map(({ key }) => ({ key, value: parseNum(mVals[key]) }))
    // A newly-blank field that was never set has nothing to persist.
    .filter((m) => !(m.value === null && initialMVals[m.key] === ""));

  const walls = wallRows
    .filter((w) => w.id !== null || parseNum(w.lengthM) !== null)
    .map((w) => ({ id: w.id, position: w.position, lengthM: parseNum(w.lengthM) ?? 0 }));

  return {
    measurements,
    walls,
    categoricals: {
      roofType: cats.roofType,
      structure: cats.structure,
      dwellingsWide: cats.dwellingsWide,
      roomInRoof: cats.roomInRoof,
      rendered: cats.rendered,
      chimney: cats.chimney,
    },
  };
}

function NumField({
  value,
  unit,
  onChange,
}: {
  value: string;
  unit?: string;
  onChange: (v: string) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <input
        inputMode="decimal"
        value={value}
        placeholder="—"
        onChange={(e) => onChange(e.target.value)}
        className="w-16 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-right text-sm font-medium tabular-nums text-ink placeholder:text-ink-subtle transition-colors hover:border-hairline hover:bg-surface focus:border-hairline-strong focus:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
      />
      {unit ? (
        <span className="w-4 text-xs text-ink-subtle">{unit}</span>
      ) : (
        <span className="w-4" />
      )}
    </span>
  );
}

function MiniSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border border-hairline-strong bg-canvas pl-2 pr-1 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function DetailRow({
  label,
  card,
  onGoToPage,
  children,
}: {
  label: string;
  card?: ProvContent | null;
  onGoToPage?: (page: number) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-ink-muted">
        {card ? (
          <Provenance content={card} onGoToPage={onGoToPage}>
            {label}
          </Provenance>
        ) : (
          label
        )}
      </span>
      {children}
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const map: Record<SaveState, { text: string; cls: string } | null> = {
    idle: null,
    dirty: { text: "Unsaved changes", cls: "text-ink-subtle" },
    saving: { text: "Saving…", cls: "text-ink-subtle" },
    saved: { text: "Saved", cls: "text-ink-muted" },
    error: { text: "Couldn’t save — retry", cls: "text-ink" },
  };
  const s = map[state];
  if (!s) return null;
  return <span className={`text-xs ${s.cls}`}>{s.text}</span>;
}
