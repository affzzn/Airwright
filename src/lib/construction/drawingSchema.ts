/**
 * Construction DRAWING reader (docs/20 §5) — the Zod observation contract. PURE
 * (no Prisma, no SDK): the tool's JSON schema is generated from this so the
 * model's contract and our parser can never drift.
 *
 * The reader reports OBSERVABLES with confidence + provenance — labelled feature
 * counts, printed/marked measurements, heights and mark-ups. It NEVER prices,
 * NEVER computes lifts, NEVER does arithmetic (docs/20 §0 doctrine A/B).
 */

import { z } from "zod";

export const DRAWING_TOOL_NAME = "record_drawing_observations";

export const drawingConfidence = z.enum(["high", "medium", "low", "unknown"]);
export type DrawingConfidence = z.infer<typeof drawingConfidence>;

/** A single observed value, traceable back to the sheet + the exact printed string. */
const numberField = z.object({
  value: z.number().nullable(),
  confidence: drawingConfidence,
  /** The EXACT printed/marked string it was read from (e.g. "42.198", "18,892.16 mm"), or null. */
  sourceDimension: z.string().nullable(),
  sourceSheet: z.string().nullable(),
  sourcePage: z.number(),
});
export type NumberField = z.infer<typeof numberField>;

const floorEntrance = z.object({
  floor: z.string(), // "GF", "FF", "SF", "Roof"… as labelled
  count: z.number(),
});

const liftShaft = z.object({
  label: z.string(), // "Lift 01", "Lift 02"
  entrancesByFloor: z.array(floorEntrance),
  totalEntrances: numberField, // Σ across floors → one gate per entrance per floor
});

const lvPit = z.object({
  label: z.string(),
  perimeterM: numberField,
});

const stair = z.object({
  label: z.string(),
  kind: z.enum(["PRECAST", "STRAIGHT_SET", "UP_OVER", "ACCESS", "OTHER"]),
  heightM: numberField,
  perimeterM: numberField,
});

const loadingBay = z.object({
  label: z.string(),
  widthM: numberField,
  lengthM: numberField,
  heightM: numberField,
  liftsMarked: z.number().nullable(), // "3nr Lift Loading Bay" → 3 (priced per lift)
});

/** A Haki (proprietary) stair-access tower — a scaffold item, not a building stair. */
const hakiStair = z.object({
  label: z.string(),
  liftsMarked: z.number().nullable(), // "3nr Lift Haki Staircase" → 3 (normally 3 lifts)
  heightM: numberField, // if a height is given instead of a lift count
});

const externalRun = z.object({
  zone: z.string().nullable(), // "blue", "external perimeter"…
  lengthM: numberField, // per-lift run length if marked
  liftsMarked: z.number().nullable(), // e.g. "3NR" → 3
});

const birdcage = z.object({
  zone: z.string().nullable(), // "red", "classroom"…
  areaM2: numberField,
  liftsMarked: z.number().nullable(),
});

const markup = z.object({
  text: z.string(), // the annotation verbatim
  valueM: z.number().nullable(),
  zoneColour: z.string().nullable(), // "blue" | "red" | "green"…
  note: z.string().nullable(),
});

export const drawingObservationsSchema = z.object({
  sheet: z.object({
    kind: z.enum(["ELEVATION", "FLOOR_PLAN", "ROOF_PLAN", "SITE_PLAN", "SECTION", "MARKED_UP", "OTHER"]),
    title: z.string().nullable(),
    /** false → raster / no selectable dimensions → measurements are unreliable (measure by hand). */
    hasTextLayer: z.boolean(),
    siteTypeHint: z.enum(["SCHOOL", "PUBLIC", "SITE", "NONE"]),
    confidence: drawingConfidence,
  }),

  buildingHeightM: numberField, // off an ELEVATION → lift count + height band

  // Each array is `.catch([])`: a single malformed field from the model degrades to
  // empty rather than crashing the whole read (docs/20 §13 — account for everything,
  // never let one bad field lose the rest).
  liftShafts: z.array(liftShaft).catch([]),
  lvPits: z.array(lvPit).catch([]),
  stairs: z.array(stair).catch([]),
  loadingBays: z.array(loadingBay).catch([]),
  hakiStairs: z.array(hakiStair).catch([]),
  externalRuns: z.array(externalRun).catch([]),
  birdcages: z.array(birdcage).catch([]),
  roofEdgePerimeterM: numberField, // the green edge-protection line

  markups: z.array(markup).catch([]),
  accessPoints: z.object({
    doorways: numberField,
    fireExits: numberField,
  }),

  notes: z.string().catch(""),
});

export type DrawingObservations = z.infer<typeof drawingObservationsSchema>;
