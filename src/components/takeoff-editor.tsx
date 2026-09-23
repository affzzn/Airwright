"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Lock, Pencil, Plus, X } from "lucide-react";
import { buildTakeoff, DEFAULT_PARAMS, type BuildSystem, type Configuration } from "@/lib/takeoff/engine";
import { takeoffInputFromStored } from "@/lib/takeoff/fromStored";
import {
  confirmTakeoff,
  reopenTakeoff,
  saveTakeoffEdits,
  type TakeoffEditsInput,
} from "@/server/actions/takeoff";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfidenceDot } from "@/components/ui/badge";
import { Toggle } from "@/components/ui/toggle";
import { formatDate } from "@/lib/utils";
import { Provenance } from "@/components/ui/provenance";
import type { ExtractionResult } from "@/lib/extract/schema";
import type { StructureForm } from "@/lib/structure";
import {
  aiMeasurementValues,
  buildProvenanceCards,
  liftsProvenance,
  perimeterProvenance,
  adaptionLiftsProvenance,
  tfAdaptionProvenance,
  tfApexProvenance,
  partyWallProvenance,
  birdcageTotalProvenance,
  resolvePage,
  configurationBasisFrom,
  configurationProvenance,
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
  /** Party/separating wall as read off the drawing; null = the drawing did not say. */
  isPartyWall?: boolean | null;
  lengthM: number;
  confidence: number | null;
  sourceDimension: string | null;
  source: string;
}
export interface EditorCategoricals {
  roofType: "PITCHED" | "HIPPED" | "MIXED" | null;
  structure: StructureForm | null;
  dwellingsWide: number | null;
  roomInRoof: boolean | null;
  rendered: boolean | null;
  chimney: boolean | null;
}

interface Props {
  takeoffId: string;
  /** Take-off review status: DRAFT / IN_REVIEW / CONFIRMED. */
  status: string;
  /** ISO timestamp the take-off was confirmed, or null. */
  confirmedAt: string | null;
  measurements: EditorMeasurement[];
  walls: EditorWall[];
  warnings: Record<string, unknown>;
  categoricals: EditorCategoricals;
  /** The house type's build form (a real column on the take-off). Drives which
   *  sides are scaffolded, the corners, the apex reduction and the party wall. */
  configuration: string;
  /** Party-wall spec-item default for this house type (removable per job). */
  includePartyWall: boolean;
  /** The verbatim model output, for provenance (null on legacy extractions). */
  raw: ExtractionResult | null;
  /** Per-page sheet titles, for resolving a source label to a page number. */
  documentPages: PageRef[];
  /** Pages that were relevant to this extraction (the viewer's shown set). */
  relevantPages?: number[];
  /** Jump the drawing viewer to a page (wired to the workspace). */
  onGoToPage?: (page: number) => void;
  /** AI notes for this house type, shown first. */
  notes?: string | null;
  /** Per-builder storey→lifts template; falls back to the engine default. */
  storeyLiftTemplate?: Record<string, number>;
  /** Build system for this tender (project-level — docs/18). TF changes the lifts,
   *  drops the birdcage and adds LM adaptions. Defaults to TRADITIONAL. */
  buildSystem?: BuildSystem;
}

// The editable measurement rows. `birdcage` rows are dropped for timber frame.
const MEAS_LABEL: Record<string, { label: string; unit: string }> = {
  STOREYS: { label: "Storeys", unit: "" },
  HEIGHT_TO_SOFFIT: { label: "Height to soffit", unit: "m" },
  CORNER_COUNT: { label: "Corners", unit: "" },
  GABLE_QTY: { label: "Gables / apex", unit: "" },
  RENDER_LENGTH: { label: "Render length", unit: "m" },
  BIRDCAGE_GF_M2: { label: "Birdcage (GF)", unit: "m²" },
  BIRDCAGE_FF_M2: { label: "Birdcage (FF)", unit: "m²" },
  BIRDCAGE_SF_M2: { label: "Birdcage (SF)", unit: "m²" },
  LOW_LEVEL_QTY: { label: "Low-level", unit: "" },
};
// Every measurement key we render an input for (order-independent — the layout
// below places each explicitly, interleaved with the computed rows).
const MEASUREMENT_KEYS = Object.keys(MEAS_LABEL);

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

const CONFIG_OPTIONS: { value: Configuration; label: string }[] = [
  { value: "DETACHED", label: "Detached" },
  { value: "SEMI_DETACHED", label: "Semi-detached" },
  { value: "END_TERRACE", label: "End terrace" },
  { value: "MID_TERRACE", label: "Mid-terrace" },
];
const CONFIG_LABEL: Record<string, string> = Object.fromEntries(
  CONFIG_OPTIONS.map((o) => [o.value, o.label]),
);
/** The extractor's confidence words → the numeric scale ConfidenceDot expects
 *  (same mapping the extractor uses when it stores a measurement's confidence). */
const CONF_NUM: Record<string, number | null> = {
  high: 0.95,
  medium: 0.7,
  low: 0.4,
  unknown: null,
};

const isConfig = (v: string): v is Configuration =>
  v === "DETACHED" || v === "SEMI_DETACHED" || v === "END_TERRACE" || v === "MID_TERRACE";

type WallRow = {
  key: string;
  id: string | null;
  position: string;
  isPartyWall?: boolean | null;
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

/** Break the AI's free-text notes into readable bullet points — one per sentence. */
function splitNotes(notes: string): string[] {
  return notes
    .split(/(?<=[.!?])\s+(?=[A-Z(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function TakeoffEditor({
  takeoffId,
  status,
  confirmedAt,
  measurements,
  walls,
  warnings,
  categoricals,
  configuration,
  includePartyWall,
  raw,
  documentPages,
  relevantPages,
  onGoToPage,
  notes,
  storeyLiftTemplate,
  buildSystem = "TRADITIONAL",
}: Props) {
  const router = useRouter();
  const locked = status === "CONFIRMED";
  const isTF = buildSystem === "TIMBER_FRAME";
  const [confirmPending, startConfirm] = useTransition();
  const doConfirm = () =>
    startConfirm(async () => {
      await confirmTakeoff(takeoffId);
      router.refresh();
    });
  const doReopen = () =>
    startConfirm(async () => {
      await reopenTakeoff(takeoffId);
      router.refresh();
    });

  // --- Initial editable state (memoised from the immutable props) ---
  const initialMVals = useMemo(() => {
    const r: Record<string, string> = {};
    for (const key of MEASUREMENT_KEYS) r[key] = "";
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
        isPartyWall: w.isPartyWall ?? null,
        lengthM: String(w.lengthM),
        sourceDimension: w.sourceDimension,
      })),
    [walls],
  );

  const [mVals, setMVals] = useState(initialMVals);
  const [wallRows, setWallRows] = useState(initialWallRows);
  const [cats, setCats] = useState(categoricals);
  const [config, setConfig] = useState<Configuration>(
    isConfig(configuration) ? configuration : "DETACHED",
  );
  const [includePW, setIncludePW] = useState<boolean>(includePartyWall);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const newCounter = useRef(0);

  const isApartment = cats.structure === "APARTMENT_BLOCK";
  const isDetached = config === "DETACHED";
  const isAttached = !isDetached && !isApartment;
  // Front/rear frontage is divided by how many houses it spans (default 1). The
  // engine reads this from warnings.dwellingsWide — we drive both from one value
  // so the "covers" control and the perimeter can never disagree.
  const covers = isApartment ? 1 : (cats.dwellingsWide ?? 1);

  // --- Provenance ("how was this derived") from the verbatim model output ---
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
    () => (raw ? buildProvenanceCards(raw, resolve, buildSystem) : {}),
    [raw, resolve, buildSystem],
  );

  // --- How the CONFIGURATION was derived (the single highest-leverage field) ---
  // Prefer the verbatim model output; fall back to the basis the extractor stored
  // on `warnings` (legacy rows have neither → no claim is made).
  const configBasis = useMemo(
    () => configurationBasisFrom(raw, warnings),
    [raw, warnings],
  );

  const configCard = useMemo(
    () =>
      configurationProvenance(config, configBasis.derived, configBasis.form, configBasis.confidence),
    [config, configBasis],
  );
  // Flag an uncertain derivation ONLY while the shown value still equals it — once
  // the estimator has picked a different position, the question has been answered.
  const configFlag =
    configBasis.derived && !configBasis.derived.certain && config === configBasis.derived.config
      ? `House type is a default, not a read: ${configBasis.derived.reason}`
      : null;
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

  // --- Live recompute of the deterministic take-off (one line, the selected type) ---
  const engineMeasurements = useMemo(
    () =>
      Object.entries(mVals)
        .map(([key, v]) => ({ key, valueNumber: parseNum(v) }))
        .filter((m) => m.valueNumber !== null),
    [mVals],
  );
  const engineWalls = useMemo(
    () =>
      wallRows.map((w) => ({
        position: w.position,
        lengthM: parseNum(w.lengthM) ?? 0,
        isPartyWall: w.isPartyWall ?? null,
      })),
    [wallRows],
  );
  const engineWarnings = useMemo(
    () => ({
      ...warnings,
      roofType: cats.roofType ?? undefined,
      roomInRoof: cats.roomInRoof ?? undefined,
      rendered: cats.rendered ?? undefined,
      chimney: cats.chimney ?? undefined,
      structure: cats.structure ?? undefined,
      dwellingsWide: covers,
    }),
    [warnings, cats, covers],
  );
  const line = useMemo(() => {
    const params = storeyLiftTemplate
      ? { ...DEFAULT_PARAMS, storeyLiftTemplate }
      : DEFAULT_PARAMS;
    const input = takeoffInputFromStored(
      engineMeasurements,
      engineWalls,
      engineWarnings,
      config,
      buildSystem,
    );
    input.includePartyWall = includePW;
    return buildTakeoff(input, params);
  }, [engineMeasurements, engineWalls, engineWarnings, config, includePW, storeyLiftTemplate, buildSystem]);

  const perimeter = useMemo(
    () => engineWalls.reduce((s, w) => s + w.lengthM, 0),
    [engineWalls],
  );
  const engineFlags = line.flags;
  // The configuration flag is not an engine flag (the engine is given the config,
  // it does not derive it), so it is merged in for display.
  const reviewFlags = useMemo(
    () => (configFlag ? [configFlag, ...engineFlags] : engineFlags),
    [configFlag, engineFlags],
  );

  // --- Which wall positions the selected type does NOT scaffold (greyed) ---
  const suppressed = useMemo<Set<string>>(() => {
    if (isDetached || isApartment) return new Set();
    // A mid-terrace's two gable ends are party walls; 'other' walls ARE scaffolded
    // (engine change 2026-09-23), so they are no longer greyed out.
    if (config === "MID_TERRACE") return new Set(["GABLE_LEFT", "GABLE_RIGHT"]);
    // Semi / end: drop the gable the DRAWING says is the party wall. Only when it does
    // not say do we fall back to dropping the shorter one (mirrors the engine).
    const party = (pos: string) =>
      wallRows.some((w) => w.position === pos && w.isPartyWall === true);
    if (party("GABLE_LEFT") && !party("GABLE_RIGHT")) return new Set(["GABLE_LEFT"]);
    if (party("GABLE_RIGHT") && !party("GABLE_LEFT")) return new Set(["GABLE_RIGHT"]);
    const sum = (pos: string) =>
      wallRows.filter((w) => w.position === pos).reduce((a, w) => a + (parseNum(w.lengthM) ?? 0), 0);
    return new Set([sum("GABLE_RIGHT") <= sum("GABLE_LEFT") ? "GABLE_RIGHT" : "GABLE_LEFT"]);
  }, [config, isDetached, isApartment, wallRows]);

  // --- Auto-save (debounced) whenever the editable state differs from saved ---
  const serialise = (
    m: Record<string, string>,
    w: WallRow[],
    c: EditorCategoricals,
    cfg: string,
    ipw: boolean,
  ): string =>
    JSON.stringify({
      // isPartyWall is part of the dirty check — without it, changing a gable's party
      // flag would leave the form "clean" and the edit would never be saved.
      m,
      w: w.map((r) => [r.key, r.position, r.lengthM, r.isPartyWall ?? null]),
      c,
      cfg,
      ipw,
    });
  const baseline = useRef(
    serialise(initialMVals, initialWallRows, categoricals, configuration, includePartyWall),
  );

  useEffect(() => {
    if (locked) return;
    const snap = serialise(mVals, wallRows, cats, config, includePW);
    if (snap === baseline.current) {
      setSaveState((s) => (s === "saved" ? "saved" : "idle"));
      return;
    }
    setSaveState("dirty");
    const timer = setTimeout(async () => {
      setSaveState("saving");
      const payload = buildPayload(mVals, initialMVals, wallRows, cats, config, includePW);
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
  }, [mVals, wallRows, cats, config, includePW]);

  // --- Handlers ---
  const setMeasurement = (key: string, v: string) =>
    setMVals((p) => ({ ...p, [key]: v }));
  const patchWall = (key: string, patch: Partial<WallRow>) =>
    setWallRows((p) => p.map((w) => (w.key === key ? { ...w, ...patch } : w)));
  const addWall = () =>
    setWallRows((p) => [
      ...p,
      { key: `new-${newCounter.current++}`, id: null, position: "FRONT", lengthM: "", sourceDimension: null },
    ]);
  const removeWall = (key: string) =>
    setWallRows((p) => p.filter((w) => w.key !== key));

  const smartRoofChip =
    typeof warnings.smartRoofPeakM === "number"
      ? `High roof peak ${warnings.smartRoofPeakM} m — check smart roof`
      : null;

  // --- Row renderers (measured + computed share one list) ---
  const measureRow = (key: string) => {
    const conf = MEAS_LABEL[key];
    if (!conf) return null;
    const meta = mMeta[key];
    const edited =
      mVals[key] !== initialMVals[key] || meta?.source === "EDITED" || meta?.source === "MANUAL";
    const card = measurementCard(key);
    return (
      <div key={key} className="flex items-center justify-between border-b border-hairline py-2 last:border-0">
        <span className="text-sm text-ink-muted">
          {card ? (
            <Provenance content={card} onGoToPage={onGoToPage}>
              {conf.label}
            </Provenance>
          ) : (
            conf.label
          )}
        </span>
        <div className="flex items-center gap-2">
          <NumField
            value={mVals[key]}
            unit={conf.unit}
            disabled={locked}
            onChange={(v) => setMeasurement(key, v)}
          />
          <span className="flex w-10 justify-end">
            {edited ? (
              <span className="text-[10px] text-ink-subtle">edited</span>
            ) : meta ? (
              <ConfidenceDot value={meta.confidence} />
            ) : null}
          </span>
        </div>
      </div>
    );
  };

  const calcRow = (label: string, card: ProvContent | null, value: React.ReactNode) => (
    <div className="flex items-center justify-between border-b border-hairline py-2 last:border-0">
      <span className="text-sm text-ink">
        {card ? (
          <Provenance content={card} onGoToPage={onGoToPage}>
            {label}
          </Provenance>
        ) : (
          label
        )}
      </span>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium tabular-nums text-ink">{value}</span>
        <span className="w-10 text-right text-[10px] uppercase tracking-[0.06em] text-ink-subtle">
          calc
        </span>
      </div>
    </div>
  );

  // Provenance cards for the computed rows.
  const liftsCard = liftsProvenance(
    parseNum(mVals.HEIGHT_TO_SOFFIT ?? ""),
    parseNum(mVals.STOREYS ?? ""),
    cats.roomInRoof === true,
    line.lifts.heightLifts,
    line.lifts.storeyLifts,
    line.lifts.lifts,
    line.lifts.flag,
    buildSystem,
  );
  const perimCard =
    line.perimeter.totalM !== null
      ? perimeterProvenance(
          line.perimeter.corners,
          1,
          line.perimeter.wallsM,
          line.perimeter.perLiftM,
          line.lifts.lifts,
          line.perimeter.totalM,
        )
      : null;

  const wallRuleText = isApartment
    ? "Apartment block — the whole building is scaffolded."
    : isDetached
      ? "Detached — all four sides scaffolded."
      : config === "MID_TERRACE"
        ? "Mid-terrace — front and rear only. Both gables are shared walls (greyed below)."
        : `${CONFIG_LABEL[config]} — front, rear and one gable. The other gable is the shared wall (greyed below).`;

  // The wall-segments block (rule caption → editable rows → covers helper).
  const wallsBlock = (
    <div className="border-b border-hairline py-2">
      <div className="mb-1.5 flex items-baseline justify-between">
        <p className="eyebrow">Wall segments</p>
        <Provenance
          content={wallSumProvenance(engineWalls, perimeter)}
          onGoToPage={onGoToPage}
          className="text-xs text-ink-subtle"
        >
          measured total {perimeter.toFixed(3)} m
        </Provenance>
      </div>
      <p className="mb-2 rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-[11.5px] leading-snug text-ink-muted">
        {wallRuleText}
      </p>
      <ul className="divide-y divide-hairline">
        {wallRows.map((w) => {
          const sup = suppressed.has(w.position);
          return (
            <li
              key={w.key}
              className={`flex items-center gap-2 py-1.5 ${sup ? "opacity-50" : ""}`}
            >
              <select
                value={w.position}
                disabled={locked}
                onChange={(e) => patchWall(w.key, { position: e.target.value })}
                className={`h-8 rounded-md border border-hairline-strong bg-canvas pl-2 pr-1 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-60 ${sup ? "line-through" : ""}`}
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
                disabled={locked}
                onChange={(v) => patchWall(w.key, { lengthM: v })}
              />
              {/* Party wall — only meaningful on a gable end, and the single most
                  load-bearing fact on the wall: it decides which gable is scaffolded,
                  the apex count and the configuration. Tri-state, because "the drawing
                  did not say" must stay distinct from "no" (docs/21 §B2). */}
              {(w.position === "GABLE_LEFT" || w.position === "GABLE_RIGHT") && (
                <select
                  aria-label="Party wall"
                  title="Is this gable a party (separating) wall? It is not scaffolded."
                  value={w.isPartyWall === true ? "y" : w.isPartyWall === false ? "n" : "?"}
                  disabled={locked}
                  onChange={(e) =>
                    patchWall(w.key, {
                      isPartyWall:
                        e.target.value === "y" ? true : e.target.value === "n" ? false : null,
                    })
                  }
                  className="h-8 shrink-0 rounded-md border border-hairline-strong bg-canvas pl-1.5 pr-1 text-[11px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-60"
                >
                  <option value="?">party?</option>
                  <option value="y">party</option>
                  <option value="n">external</option>
                </select>
              )}
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
              {sup && (
                <span className="rounded-md border border-hairline-strong px-1.5 py-0.5 text-[10px] text-ink-subtle">
                  shared — not scaffolded
                </span>
              )}
              {!locked && (
                <button
                  type="button"
                  aria-label="Remove wall"
                  onClick={() => removeWall(w.key)}
                  className="ml-auto rounded-md p-1 text-ink-subtle transition-colors hover:bg-surface hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              )}
            </li>
          );
        })}
        {wallRows.length === 0 && (
          <p className="py-3 text-sm text-ink-subtle">No wall segments.</p>
        )}
      </ul>
      {!locked && (
        <button
          type="button"
          onClick={addWall}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} /> Add wall
        </button>
      )}
      {isAttached && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-hairline-strong bg-surface px-2.5 py-2 text-[12px] text-ink-muted">
          <span>Front / rear measurement covers</span>
          <select
            aria-label="Front/rear measurement covers how many houses"
            value={covers}
            disabled={locked}
            onChange={(e) => setCats((c) => ({ ...c, dwellingsWide: parseNum(e.target.value) }))}
            className="h-7 rounded-md border border-hairline-strong bg-canvas px-1.5 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-60"
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span>house(s) — the frontage is divided by this to get one house.</span>
        </div>
      )}
    </div>
  );

  // The one take-off list — measured + computed together, in reading order.
  const partyRow =
    isTF || isApartment
      ? null
      : calcRow(
          "Party wall",
          partyWallProvenance(config, includePW, line.partyWalls),
          isDetached ? (
            <span className="font-normal text-ink-subtle">— none (detached)</span>
          ) : (
            <span className="inline-flex items-center gap-2">
              <span className="rounded-full border border-hairline-strong px-2 py-0.5 text-[10.5px] text-ink-subtle">
                £165 · unit
              </span>
              <Toggle
                checked={includePW}
                onChange={(v) => setIncludePW(v)}
                label="Include party wall"
                disabled={locked}
              />
              <span className={includePW ? "" : "font-normal text-ink-subtle"}>
                {includePW ? "1 unit" : "excluded"}
              </span>
            </span>
          ),
        );

  const takeoffList = isTF ? (
    // Timber frame — no birdcage; adaption lifts + LM adaptions + apex units.
    <div>
      {measureRow("STOREYS")}
      {measureRow("HEIGHT_TO_SOFFIT")}
      {calcRow("Lifts", liftsCard, line.lifts.lifts ?? "?")}
      {line.adaptions &&
        calcRow(
          "Adaption lifts",
          adaptionLiftsProvenance(line.lifts.lifts, line.adaptions.adaptionLifts),
          <>
            {line.adaptions.adaptionLifts}
            {line.lifts.lifts !== null && line.adaptions.adaptionLifts < line.lifts.lifts
              ? ` of ${line.lifts.lifts}`
              : ""}
          </>,
        )}
      {wallsBlock}
      {measureRow("CORNER_COUNT")}
      {perimCard &&
        calcRow(
          "Perimeter",
          perimCard,
          <>
            {line.perimeter.perLiftM} m/lift × {line.lifts.lifts ?? "?"} = {line.perimeter.totalM} m
          </>,
        )}
      {measureRow("GABLE_QTY")}
      {calcRow("Apex", tfApexProvenance(line.apex.count), <>{line.apex.count} → 4 units</>)}
      {line.adaptions &&
        calcRow(
          "Inside-board adaption",
          tfAdaptionProvenance(
            "inside-board",
            line.perimeter.perLiftM,
            line.adaptions.adaptionLifts,
            line.adaptions.insideBoardLM,
            line.adaptions.apexInsideBoardUnits,
          ),
          <>
            {line.adaptions.insideBoardLM} LM
            {line.adaptions.apexInsideBoardUnits > 0 ? ` + ${line.adaptions.apexInsideBoardUnits} apex` : ""}
          </>,
        )}
      {line.adaptions &&
        calcRow(
          "Hop-up adaption",
          tfAdaptionProvenance(
            "hop-up",
            line.perimeter.perLiftM,
            line.adaptions.adaptionLifts,
            line.adaptions.hopUpLM,
            line.adaptions.apexHopUpUnits,
          ),
          <>
            {line.adaptions.hopUpLM} LM
            {line.adaptions.apexHopUpUnits > 0 ? ` + ${line.adaptions.apexHopUpUnits} apex` : ""}
          </>,
        )}
      {measureRow("RENDER_LENGTH")}
      {line.render &&
        calcRow(
          "Render adaption",
          null,
          <>
            {line.render.lengthM} m × {line.render.lifts ?? "?"} lifts
          </>,
        )}
      {measureRow("LOW_LEVEL_QTY")}
      {calcRow("Birdcage", null, <span className="font-normal text-ink-subtle">— none (timber frame)</span>)}
    </div>
  ) : (
    // Traditional — the full list.
    <div>
      {measureRow("STOREYS")}
      {measureRow("HEIGHT_TO_SOFFIT")}
      {calcRow("Lifts", liftsCard, line.lifts.lifts ?? "?")}
      {wallsBlock}
      {measureRow("CORNER_COUNT")}
      {perimCard &&
        calcRow(
          "Perimeter",
          perimCard,
          <>
            {line.perimeter.perLiftM} m/lift × {line.lifts.lifts ?? "?"} = {line.perimeter.totalM} m
          </>,
        )}
      {measureRow("GABLE_QTY")}
      {measureRow("RENDER_LENGTH")}
      {measureRow("BIRDCAGE_GF_M2")}
      {measureRow("BIRDCAGE_FF_M2")}
      {measureRow("BIRDCAGE_SF_M2")}
      {line.birdcage.floorCount > 0 &&
        calcRow(
          "Birdcage total",
          birdcageTotalProvenance(line.birdcage.floors, line.birdcage.totalM2),
          <>
            {line.birdcage.totalM2} m² × {line.birdcage.floorCount} floors
          </>,
        )}
      {measureRow("LOW_LEVEL_QTY")}
      {partyRow}
    </div>
  );

  return (
    <Card className="lg:flex lg:h-full lg:flex-col">
      <CardHeader className="flex shrink-0 items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">Extracted take-off</h2>
        {locked ? (
          <button
            type="button"
            onClick={doReopen}
            disabled={confirmPending}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink disabled:opacity-50"
          >
            {confirmPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            Re-open to edit
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <SaveIndicator state={saveState} />
            <Button
              size="sm"
              variant="secondary"
              onClick={doConfirm}
              disabled={confirmPending || saveState === "saving" || saveState === "dirty"}
              title={
                saveState === "dirty" || saveState === "saving" ? "Saving changes first…" : undefined
              }
              className="gap-1.5"
            >
              {confirmPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              ) : (
                <Check className="h-3.5 w-3.5" strokeWidth={2} />
              )}
              Confirm take-off
            </Button>
          </div>
        )}
      </CardHeader>
      <CardBody className="space-y-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {locked && (
          <div className="flex items-center gap-2 rounded-md border border-hairline bg-surface px-3 py-2 text-xs text-ink-muted">
            <Lock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            <span>
              Confirmed{confirmedAt ? ` on ${formatDate(confirmedAt)}` : ""} · locked for pricing.
              Re-open to edit.
            </span>
          </div>
        )}

        {/* 1 — AI notes (first) */}
        {notes && (
          <div>
            <p className="eyebrow mb-2">AI notes</p>
            <div className="rounded-md border border-hairline bg-surface px-3 py-3">
              <ul className="list-disc space-y-1.5 pl-4 marker:text-ink-subtle">
                {splitNotes(notes).map((s, i) => (
                  <li key={i} className="pl-0.5 text-[13px] leading-relaxed text-ink-muted">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* 2 — House type (cascades) */}
        <div>
          <div className="mb-2 flex items-center gap-1.5">
            <Provenance content={configCard} onGoToPage={onGoToPage}>
              <span className="eyebrow">House type</span>
            </Provenance>
            <ConfidenceDot value={CONF_NUM[configBasis.confidence ?? "unknown"] ?? null} />
            {configFlag && (
              <span className="text-[11px] leading-none text-ink-subtle">· defaulted</span>
            )}
          </div>
          {isApartment ? (
            <div className="rounded-md border border-hairline-strong bg-surface px-3 py-2.5 text-sm font-semibold text-ink">
              Apartment block · whole building
            </div>
          ) : (
            <select
              aria-label="House type"
              value={config}
              disabled={locked}
              onChange={(e) => isConfig(e.target.value) && setConfig(e.target.value)}
              className="h-11 w-full rounded-md border border-hairline-strong bg-canvas px-3 text-base font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-70"
            >
              {CONFIG_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* 3 — The one take-off list */}
        <div>
          <p className="eyebrow mb-1">Take-off</p>
          <div className="border-t border-hairline">{takeoffList}</div>
          <p className="mt-2 text-[11px] text-ink-subtle">
            {isTF
              ? "Access: always Haki · loading bay / chute shared across the block (apportioned — not yet applied)."
              : "Extras (loading bay, chute, access, propping) come from the builder profile — not yet applied."}
          </p>
        </div>

        {/* Review flags (contextual) */}
        {reviewFlags.length > 0 && (
          <div className="rounded-md border border-hairline bg-surface px-3 py-3">
            <p className="eyebrow mb-1.5">Review flags</p>
            <ul className="space-y-1">
              {reviewFlags.map((f) => (
                <li key={f} className="text-[11px] leading-snug text-ink-muted">
                  ⚠ {f}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 4 — Also read from the drawing */}
        <div>
          <p className="eyebrow mb-2">Also read from the drawing</p>
          <div className="divide-y divide-hairline">
            <DetailRow label="Roof type" card={cards.ROOF_TYPE} onGoToPage={onGoToPage}>
              <MiniSelect
                value={cats.roofType ?? ""}
                options={ROOF_OPTIONS}
                disabled={locked}
                onChange={(v) =>
                  setCats((c) => ({ ...c, roofType: (v || null) as EditorCategoricals["roofType"] }))
                }
              />
            </DetailRow>
            <DetailRow
              label="Room in roof (2.5-storey)"
              card={cards.ROOM_IN_ROOF}
              onGoToPage={onGoToPage}
            >
              <Toggle
                checked={cats.roomInRoof === true}
                onChange={(v) => setCats((c) => ({ ...c, roomInRoof: v }))}
                label="Room in roof"
                disabled={locked}
              />
            </DetailRow>
            <DetailRow label="Rendered" card={cards.RENDERED} onGoToPage={onGoToPage}>
              <Toggle
                checked={cats.rendered === true}
                onChange={(v) => setCats((c) => ({ ...c, rendered: v }))}
                label="Rendered"
                disabled={locked}
              />
            </DetailRow>
            <DetailRow label="Chimney" card={cards.CHIMNEY} onGoToPage={onGoToPage}>
              <Toggle
                checked={cats.chimney === true}
                onChange={(v) => setCats((c) => ({ ...c, chimney: v }))}
                label="Chimney"
                disabled={locked}
              />
            </DetailRow>
          </div>
          {smartRoofChip && (
            <div className="mt-3">
              <span className="rounded-md border border-hairline bg-surface px-2.5 py-1 text-xs text-ink-muted">
                {smartRoofChip}
              </span>
            </div>
          )}
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
  config: Configuration,
  includePW: boolean,
): TakeoffEditsInput {
  const measurements = MEASUREMENT_KEYS.filter((key) => mVals[key] !== initialMVals[key])
    .map((key) => ({ key, value: parseNum(mVals[key]) }))
    .filter((m) => !(m.value === null && initialMVals[m.key] === ""));

  const walls = wallRows
    .filter((w) => w.id !== null || parseNum(w.lengthM) !== null)
    .map((w) => ({
      id: w.id,
      position: w.position,
      lengthM: parseNum(w.lengthM) ?? 0,
      isPartyWall: w.isPartyWall ?? null,
    }));

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
    configuration: config,
    includePartyWall: includePW,
  };
}

function NumField({
  value,
  unit,
  onChange,
  disabled,
}: {
  value: string;
  unit?: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <input
        inputMode="decimal"
        value={value}
        placeholder="—"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-16 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-right text-sm font-medium tabular-nums text-ink placeholder:text-ink-subtle transition-colors hover:border-hairline hover:bg-surface focus:border-hairline-strong focus:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:cursor-default disabled:hover:border-transparent disabled:hover:bg-transparent"
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
  disabled,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border border-hairline-strong bg-canvas pl-2 pr-1 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-60"
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
