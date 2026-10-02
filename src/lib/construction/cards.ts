/**
 * The section cards (2026-10-02) — PURE, unit-tested. One place that decides, for a
 * building, the few numbers a construction quote is built from, how much each one
 * can be trusted, and which quote lines the cards produce.
 *
 * Per building, three cards that match Airwright's real quote sections:
 *   External         — perimeter + corners → scaffold run; height → lifts; gables
 *   Internal         — run; clear height; lifts            (Internal independent)
 *   Internal Birdcage — area (rooms ticked / measured); clear height; lifts
 * plus the job card (weekly inspections). Everything else is an ADD-ON the
 * estimator ticks (Haki, loading bay, table lifts…) — never chosen by the AI.
 *
 * A value comes from a measurement row by key. The estimator's own row (entered by
 * hand or measured on the drawing, `runId` null) always beats the automatic one.
 */

import type { Hint } from "./model/buildingModel";
import { paramNumber, type ResolvedParams } from "./params";
import { heightBracketFor, suggestedLiftsFor } from "./rules";
import type { ConstructionUnit, HeightBracket } from "./types";

/** The slice of a measurement row the cards read. */
export interface MeasureRow {
  id?: string;
  key: string | null;
  label: string;
  valueNumber: number;
  unit: string | null;
  lifts: number | null;
  confidence: string | null;
  source: string | null;
  provenance: string[];
  note: string | null;
  buildingId: string | null;
  runId: string | null;
  /** The sheets it came from (a measured value also carries the line drawn on the sheet). */
  sheetRefs?: { sheetId: string; attachmentId: string; page: number; title: string; points?: [number, number][]; closed?: boolean }[];
}

/**
 * How far a value can be trusted, in plain words:
 *   checked  — read from the drawings, and two drawings agree
 *   printed  — read from the drawings, printed in one place
 *   measured — measured by you on the drawing
 *   entered  — typed in by you
 *   client   — the client's own figure
 *   none     — nothing yet
 */
export type Trust = "checked" | "printed" | "measured" | "entered" | "client" | "none";

export const TRUST_TEXT: Record<Trust, { title: string; body: string }> = {
  checked: { title: "Checked", body: "Read from the drawings, and a second drawing gives the same number." },
  printed: { title: "Printed", body: "Read from a number printed on the drawings. Only one drawing shows it." },
  measured: { title: "Measured by you", body: "You measured this on the drawing." },
  entered: { title: "Entered by you", body: "You typed this in." },
  client: { title: "Client's figure", body: "The number the client gave. Not checked against the drawings." },
  none: { title: "Not set", body: "Nothing could be read reliably. Enter it, or measure it on the drawing." },
};

export function trustOf(row: MeasureRow | null): Trust {
  if (!row) return "none";
  if (row.source === "DRAWN") return "measured";
  if (row.source === "MANUAL" || row.source === "GOOGLE_EARTH") return "entered";
  if (row.source === "CLIENT_SCOPE") return "client";
  if (row.source === "ROOMS") return "printed"; // the printed areas of rooms the estimator ticked
  return row.confidence === "high" ? "checked" : "printed";
}

export interface CardValue {
  value: number | null;
  trust: Trust;
  /** The row behind it (sources, sheets). */
  row: MeasureRow | null;
  /** How the value was arrived at, in plain words. */
  why: string;
}

const none = (why: string): CardValue => ({ value: null, trust: "none", row: null, why });
const fromRow = (row: MeasureRow, why?: string): CardValue => ({ value: row.valueNumber, trust: trustOf(row), row, why: why ?? row.note ?? "" });

/** The estimator's row for a key beats the automatic one. */
export function pickRow(rows: MeasureRow[], buildingId: string | null, key: string): MeasureRow | null {
  const mine = rows.filter((r) => r.key === key && (r.buildingId ?? null) === (buildingId ?? null));
  return mine.find((r) => r.runId == null) ?? mine[0] ?? null;
}

export type CardSection = "External" | "Internal" | "Internal Birdcage";
export const CARD_SECTIONS: CardSection[] = ["External", "Internal", "Internal Birdcage"];

export interface BuildingCard {
  buildingId: string | null;
  external: {
    perimeter: CardValue;
    corners: CardValue;
    /** perimeter + corner allowance × corners. */
    run: { value: number | null; why: string };
    height: CardValue;
    lifts: CardValue;
    bracket: HeightBracket | null;
    gables: CardValue;
    /** Every printed height of the building (main and lower parts). */
    heights: MeasureRow[];
    hire: CardValue;
  };
  internal: { run: CardValue; clear: CardValue; lifts: CardValue; hire: CardValue };
  birdcage: { area: CardValue; clear: CardValue; lifts: CardValue; hire: CardValue; rooms: MeasureRow[]; roomIds: string[] };
  /** Printed clear heights to pick from (internal / birdcage). */
  clearHeights: MeasureRow[];
  hints: Hint[];
}

export function readBuildingCard(
  rows: MeasureRow[],
  buildingId: string | null,
  params: ResolvedParams,
  hints: Hint[] = [],
  jobWeeks: number | null = null,
): BuildingCard {
  const row = (key: string) => pickRow(rows, buildingId, key);
  const mine = rows.filter((r) => (r.buildingId ?? null) === (buildingId ?? null));
  const liftH = paramNumber(params, "P1_liftHeightM");
  const corner = paramNumber(params, "P4_cornerAllowanceM");

  // External ---------------------------------------------------------------------------
  const per = row("ext-perimeter");
  const cor = row("ext-corners");
  const perimeter = per ? fromRow(per) : none("Not read — the building is not a plain rectangle that two drawings confirm. Measure it on the plan.");
  const corners = cor ? fromRow(cor) : none("How many outside corners the scaffold turns.");
  const run =
    perimeter.value != null
      ? {
          value: Math.round((perimeter.value + corner * (corners.value ?? 0)) * 1000) / 1000,
          why: `${perimeter.value} m wall + ${corner} m × ${corners.value ?? 0} corner${corners.value === 1 ? "" : "s"} = ${Math.round((perimeter.value + corner * (corners.value ?? 0)) * 1000) / 1000} m of scaffold`,
        }
      : { value: null, why: "Needs the perimeter." };

  const heights = mine.filter((r) => (r.key ?? "").startsWith("height:")).sort((a, b) => b.valueNumber - a.valueNumber);
  const hRow = row("ext-height");
  const height = hRow
    ? fromRow(hRow)
    : heights[0]
      ? fromRow(heights[0], `The highest printed height of the building. ${heights[0].note ?? ""}`.trim())
      : none("No height is printed on the drawings. Enter it.");
  const lRow = row("ext-lifts");
  const autoLifts = suggestedLiftsFor(height.value, liftH);
  const lifts = lRow
    ? fromRow(lRow)
    : autoLifts != null
      ? { value: autoLifts, trust: height.trust, row: height.row, why: `${height.value} m ÷ ${liftH} m per lift, rounded up = ${autoLifts}.` }
      : none("Needs the height.");
  const g = row("gables");
  const gables = g ? fromRow(g) : none("Not read — the roof plan and the elevations do not agree, or show no gables.");

  // Internal + birdcage ---------------------------------------------------------------
  const v = (key: string, why: string) => {
    const r = row(key);
    return r ? fromRow(r) : none(why);
  };
  const hire = (section: CardSection) => {
    const r = row(`hire:${section}`);
    return r ? fromRow(r, `${r.valueNumber} weeks.`) : jobWeeks != null ? { value: jobWeeks, trust: "entered" as Trust, row: null, why: "The job's hire period." } : none("How many weeks of hire.");
  };
  const rooms = mine.filter((r) => (r.key ?? "").startsWith("room:"));
  const areaRow = row("bc-area");
  const roomIds = areaRow?.provenance.filter((p) => p.startsWith("room-id:")).map((p) => p.slice(8)) ?? [];

  return {
    buildingId,
    external: {
      perimeter,
      corners,
      run,
      height,
      lifts,
      bracket: heightBracketFor(height.value),
      gables,
      heights,
      hire: hire("External"),
    },
    internal: {
      run: v("int-run", "Measure the internal scaffold run on the plan."),
      clear: v("int-clear", "Pick a printed clear height, or enter it."),
      lifts: v("int-lifts", "How many lifts inside."),
      hire: hire("Internal"),
    },
    birdcage: {
      area: v("bc-area", "Tick the rooms the birdcage covers, or measure the area."),
      clear: v("bc-clear", "Pick a printed clear height, or enter it."),
      lifts: v("bc-lifts", "How many lifts in the birdcage."),
      hire: hire("Internal Birdcage"),
      rooms,
      roomIds,
    },
    clearHeights: mine.filter((r) => (r.key ?? "").startsWith("clear:")),
    hints: hints,
  };
}

// --- Add-ons: the estimator's judgement, ticked, never chosen by the AI ------------------

export type AddonQty =
  | { kind: "count"; default: number }
  | { kind: "metres" } // entered or measured on the drawing
  | { kind: "gables" } // one per main gable
  | { kind: "run" } // the scaffold run (m)
  | { kind: "runTimesHeight" } // run × height (m²)
  | { kind: "fixed" }
  | { kind: "hireWeeks" }; // the longest hire on the job

export interface AddonDef {
  key: string;
  section: CardSection | "Inspections";
  label: string;
  /** Matched to a picking-list item by its role (see `elementRole`). */
  role: string;
  qty: AddonQty;
  /** Whose lifts it takes. */
  lifts?: "external" | "internal";
  /** A plain-words line under the tick box. */
  help: string;
}

export const ADDONS: AddonDef[] = [
  { key: "ext:haki", section: "External", label: "Haki stair tower", role: "HAKI", qty: { kind: "count", default: 1 }, lifts: "external", help: "Lifts follow the external scaffold." },
  { key: "ext:loading-bay", section: "External", label: "Loading bay", role: "LOADING_BAY", qty: { kind: "count", default: 1 }, lifts: "external", help: "Lifts follow the external scaffold." },
  { key: "ext:ladder-tower", section: "External", label: "Ladder tower", role: "LADDER_TOWER", qty: { kind: "count", default: 1 }, lifts: "external", help: "E.g. for an emergency exit." },
  { key: "ext:table-lifts", section: "External", label: "Table lifts", role: "TABLE_LIFT", qty: { kind: "gables" }, help: "One per main gable." },
  { key: "ext:apex", section: "External", label: "Apex handrails", role: "APEX", qty: { kind: "gables" }, help: "One per main gable." },
  { key: "ext:low-level", section: "External", label: "Low-level independent", role: "INDEPENDENT", qty: { kind: "metres" }, help: "Scaffold to a lower part (porch, low wing). Enter or measure the metres and set its lifts." },
  { key: "ext:first-lift", section: "External", label: "Raised first lift", role: "RAISED_FIRST_LIFT", qty: { kind: "run" }, help: "First lift high enough for the public to walk under (e.g. 2.7 m)." },
  { key: "ext:netting", section: "External", label: "Debris netting", role: "NETTING", qty: { kind: "runTimesHeight" }, help: "Scaffold run × height." },
  { key: "ext:brick-guards", section: "External", label: "Brick guards", role: "BRICK_GUARDS", qty: { kind: "run" }, help: "Along the scaffold run." },
  { key: "ext:triple", section: "External", label: "Triple handrail", role: "TRIPLE", qty: { kind: "metres" }, help: "E.g. along a roof edge. Enter or measure the metres." },
  { key: "ext:a-frame", section: "External", label: "A-frame handrail", role: "A_FRAME", qty: { kind: "metres" }, help: "Enter or measure the metres." },
  { key: "ext:beams", section: "External", label: "Beams over a canopy", role: "BEAMS", qty: { kind: "metres" }, help: "To clear a lower roof or canopy." },
  { key: "ext:rakers", section: "External", label: "Rakers", role: "RAKERS", qty: { kind: "count", default: 1 }, help: "Where it cannot be tied to the building." },
  { key: "ext:foam", section: "External", label: "Foam to legs", role: "FOAM", qty: { kind: "count", default: 1 }, help: "Protects the public at doors and walkways." },
  { key: "ext:mat", section: "External", label: "Scaffold mat", role: "MAT", qty: { kind: "count", default: 1 }, help: "First lift for schools and public streets." },
  { key: "ext:carry", section: "External", label: "Carry time", role: "CARRY", qty: { kind: "fixed" }, help: "Over 10 m from the wagon to the scaffold." },
  { key: "int:ladder-tower", section: "Internal", label: "Ladder towers", role: "LADDER_TOWER", qty: { kind: "count", default: 1 }, lifts: "internal", help: "Access to the internal scaffold." },
  { key: "job:inspections", section: "Inspections", label: "Weekly inspections", role: "INSPECTION", qty: { kind: "hireWeeks" }, help: "One a week for the longest hire on the job." },
];

/** The quantity a derived add-on takes from the card (null = entered by hand). */
export function derivedQty(addon: AddonDef, card: BuildingCard, longestHire: number | null): number | null {
  const run = card.external.run.value;
  switch (addon.qty.kind) {
    case "gables":
      return card.external.gables.value;
    case "run":
      return run;
    case "runTimesHeight":
      return run != null && card.external.height.value != null ? Math.round(run * card.external.height.value * 100) / 100 : null;
    case "fixed":
      return 1;
    case "hireWeeks":
      return longestHire;
    case "count":
      return addon.qty.default;
    default:
      return null;
  }
}

/** The lifts an add-on takes from its card. */
export function derivedLifts(addon: AddonDef, card: BuildingCard): number | null {
  if (addon.lifts === "external") return card.external.lifts.value;
  if (addon.lifts === "internal") return card.internal.lifts.value;
  return null;
}

/** A core line the cards produce (one per card that has its main number). */
export interface CoreLine {
  cardKey: string;
  section: CardSection;
  role: string;
  quantity: number;
  lifts: number | null;
  hireWeeks: number | null;
  formula: string;
  confidence: string;
}

const CONF: Record<Trust, string> = { checked: "high", printed: "medium", measured: "high", entered: "high", client: "medium", none: "unknown" };
const weakest = (...ts: Trust[]) => (ts.includes("printed") || ts.includes("client") ? "medium" : "high");

export function coreLines(card: BuildingCard): CoreLine[] {
  const out: CoreLine[] = [];
  const e = card.external;
  if (e.run.value != null && e.run.value > 0)
    out.push({
      cardKey: "ext:run",
      section: "External",
      role: "INDEPENDENT",
      quantity: e.run.value,
      lifts: e.lifts.value,
      hireWeeks: e.hire.value,
      formula: `${e.run.why} · ${e.lifts.value ?? "?"} lifts${e.height.value != null ? ` (${e.height.value} m high)` : ""}`,
      confidence: weakest(e.perimeter.trust, e.corners.trust, e.lifts.trust),
    });
  const i = card.internal;
  if (i.run.value != null && i.run.value > 0)
    out.push({
      cardKey: "int:run",
      section: "Internal",
      role: "INTERNAL_ACCESS",
      quantity: i.run.value,
      lifts: i.lifts.value,
      hireWeeks: i.hire.value,
      formula: `${i.run.value} m internal run · ${i.lifts.value ?? "?"} lifts`,
      confidence: CONF[i.run.trust],
    });
  const b = card.birdcage;
  if (b.area.value != null && b.area.value > 0)
    out.push({
      cardKey: "bc:area",
      section: "Internal Birdcage",
      role: "BIRDCAGE",
      quantity: b.area.value,
      lifts: b.lifts.value,
      hireWeeks: b.hire.value,
      formula: `${b.area.value} m² · ${b.lifts.value ?? "?"} lifts`,
      confidence: CONF[b.area.trust],
    });
  return out;
}

/** The longest hire across a job's cards (for weekly inspections). */
export function longestHire(cards: BuildingCard[], jobWeeks: number | null): number | null {
  const ws = cards.flatMap((c) => [c.external.hire.value, c.internal.hire.value, c.birdcage.hire.value]).filter((w): w is number => w != null && w > 0);
  return ws.length ? Math.max(...ws) : jobWeeks;
}

/** The unit an add-on's quantity is in, for the label next to its box. */
export function addonUnit(unit: ConstructionUnit | string): string {
  return unit === "LM" || unit === "LM_PER_LIFT" ? "m" : unit === "M2" || unit === "M2_PER_LIFT" ? "m²" : unit === "PER_WEEK" ? "weeks" : "nr";
}
