/**
 * Construction sheet readers (docs/23 §12.2–§12.6) — the tool contracts, one per
 * sheet kind. PURE (Zod only): the tool's JSON schema is generated from these, so
 * the contract and the parser cannot drift. Field ORDER matters to the model:
 * a reason is asked for BEFORE the numbers it justifies (the docs/13 §3.8 lesson).
 *
 * Every number is a PRINTED STRING copied verbatim; the engine parses and adds.
 * Arrays `.catch([])` so one malformed item never loses the rest of a read.
 */

import { z } from "zod";

export const confidence = z.enum(["high", "medium", "low", "unknown"]).catch("unknown");
export type Confidence = z.infer<typeof confidence>;
export const strings = z.array(z.string()).catch([]);
const nstr = z.string().nullable().catch(null);
const nnum = z.number().nullable().catch(null);

// --- PLAN ------------------------------------------------------------------------------

export const PLAN_TOOL = "record_plan";
/**
 * One outline wall as a single line (a string list is far more reliable for the
 * model than a long list of objects — on dense A1 plans the object form broke the
 * tool call). Format, parsed by `parseOutlineEntry`:
 *   "DIR | LENGTHS | GRID | FEATURE | NOTE"
 *   DIR      E, S, W, N (or NE, SE, SW, NW) — the way you travel along the wall on the sheet
 *   LENGTHS  the printed dimension string(s) that measure it, joined with " + ", or "none"
 *   GRID     "C2->D2" when it runs between grid points, else "-"
 *   FEATURE  WALL, PORCH, BAY, CANOPY or OTHER
 *   NOTE     a few words (optional)
 * e.g. "E | 20793 | - | WALL | north wall", "S | 6,965 + 1,463 | - | WALL | wing west wall", "E | none | C2->D2 | WALL | -".
 */
export const OUTLINE_ENTRY_FORMAT = '"DIR | LENGTHS | GRID | FEATURE | NOTE" — e.g. "E | 20793 | - | WALL | north wall", "S | 6,965 + 1,463 | - | WALL | -", "E | none | C2->D2 | WALL | -"';

export const planSchema = z.object({
  level: nstr.describe("The level this plan shows, as labelled (e.g. \"Ground Floor\")."),
  outlineReason: z
    .string()
    .catch("")
    .describe("FIRST: one or two sentences describing the external wall line's shape and where it steps (e.g. \"L-shape: tall hall on the east, wing on the west, flush along the south\")."),
  startCorner: nstr.describe("The external corner you start from, e.g. \"top-left external corner (grid A3)\"."),
  outline: strings.describe(
    `The external wall line traced CLOCKWISE from startCorner: ONE STRING PER STRAIGHT WALL, in the format ${OUTLINE_ENTRY_FORMAT}. Return to the start. A projecting porch or bay is its own entry.`,
  ),
  wallThicknessStrings: strings.describe("Printed wall-thickness segments from the dimension chains across the external wall (e.g. \"303\")."),
  rooms: z
    .array(
      z.object({
        label: z.string(),
        areaString: nstr.describe("A printed area for the room, copied exactly (e.g. \"CA: 50.467 m²\"), else null."),
        internalWidthString: nstr,
        internalDepthString: nstr,
      }),
    )
    .catch([]),
  cores: z
    .array(
      z.object({
        kind: z.enum(["STAIR", "ESCAPE_STAIR", "LIFT_SHAFT", "RISER", "SERVICE_SHAFT", "OTHER"]).catch("OTHER"),
        label: z.string(),
        dimStrings: strings,
      }),
    )
    .catch([]),
  openings: z.array(z.object({ serves: z.string(), dimStrings: strings })).catch([]).describe("Holes through THIS floor slab (stair, lift, riser voids) — upper floors only."),
  liftEntrances: z.array(z.object({ liftLabel: z.string(), count: z.number().int().nonnegative().catch(0) })).catch([]),
  externalDoors: z.object({ doors: nnum, fireExits: nnum }).catch({ doors: null, fireExits: null }),
  features: z
    .array(
      z.object({
        kind: z.enum(["LV_PIT", "LEVEL_CHANGE", "UPSTAND", "LOADING_BAY_MARK", "PRECAST_STAIR", "OTHER"]).catch("OTHER"),
        label: z.string(),
        dimStrings: strings,
      }),
    )
    .catch([]),
  unreadable: strings,
  notes: z.string().catch(""),
});
export type PlanRead = z.infer<typeof planSchema>;

// --- ELEVATION / SECTION shared bits ------------------------------------------------------

export const heightRead = z.object({
  string: z.string().describe("The printed height or level string, copied exactly."),
  measures: z.enum(["SOFFIT", "WALLPLATE", "EAVES", "PARAPET", "RIDGE", "FLOOR_LEVEL", "CEILING", "OTHER"]).catch("OTHER"),
  from: z.enum(["GROUND", "DPC", "FFL", "DATUM", "UNKNOWN"]).catch("UNKNOWN"),
  appliesTo: z.string().catch("").describe("Which part of the building this height belongs to (e.g. \"main hall\", \"lower wing\", \"whole building\")."),
});

// --- ELEVATION ---------------------------------------------------------------------------

export const ELEVATION_TOOL = "record_elevation";
export const elevationSchema = z.object({
  face: nstr.describe("The face as titled (North, Front, Side…)."),
  showsOutlineSide: nstr.describe("Which side of the floor plan this face is, if the sheet shows it (key plan / north arrow), else null."),
  heights: z.array(heightRead).catch([]),
  levelMarkers: strings,
  groundLine: z.object({ string: nstr, note: nstr }).catch({ string: null, note: null }),
  roof: z
    .object({
      faceRoof: z.enum(["GABLED", "HIPPED", "FLAT_PARAPET", "FLAT_OPEN", "MIXED", "UNKNOWN"]).catch("UNKNOWN"),
      apexReason: z.string().catch("").describe("FIRST: what the roof does on this face and why."),
      apexCount: z.number().int().nonnegative().catch(0).describe("Brickwork gable apexes (triangular tops) on THIS face."),
      apexes: z.array(z.object({ kind: z.enum(["MAIN", "PORCH", "DORMER"]).catch("MAIN"), note: nstr })).catch([]),
    })
    .catch({ faceRoof: "UNKNOWN", apexReason: "", apexCount: 0, apexes: [] }),
  lowerParts: z.array(z.object({ description: z.string(), heightString: nstr })).catch([]),
  unreadable: strings,
  notes: z.string().catch(""),
});
export type ElevationRead = z.infer<typeof elevationSchema>;

// --- SECTION -----------------------------------------------------------------------------

export const SECTION_TOOL = "record_section";
export const sectionSchema = z.object({
  cut: nstr,
  heights: z.array(heightRead).catch([]),
  internalClearHeights: z
    .array(
      z.object({
        room: z.string(),
        string: z.string(),
        measures: z.enum(["CEILING", "UNDERSIDE_TRUSS", "VAULT", "OTHER"]).catch("OTHER"),
      }),
    )
    .catch([]),
  pitchString: nstr,
  stairs: z.array(z.object({ label: z.string(), fromLevel: nstr, toLevel: nstr, note: nstr })).catch([]),
  liftPitString: nstr,
  liftOverrunString: nstr,
  unreadable: strings,
  notes: z.string().catch(""),
});
export type SectionRead = z.infer<typeof sectionSchema>;

// --- ROOF --------------------------------------------------------------------------------

export const ROOF_TOOL = "record_roof";
export const roofSchema = z.object({
  roofForm: z.enum(["PITCHED", "HIPPED", "FLAT", "MIXED", "UNKNOWN"]).catch("UNKNOWN"),
  gablesReason: z.string().catch("").describe("FIRST: where the gables are and which are main roof gables vs porch/dormer gables."),
  gables: z
    .array(z.object({ where: z.string(), kind: z.enum(["MAIN", "PORCH", "DORMER"]).catch("MAIN"), widthString: nstr }))
    .catch([]),
  hips: nnum,
  edges: z
    .array(
      z.object({
        description: z.string(),
        edgeType: z.enum(["OPEN", "PARAPET", "EAVES_GUTTER", "UNKNOWN"]).catch("UNKNOWN"),
        lengthStrings: strings,
      }),
    )
    .catch([]),
  access: z.array(z.object({ kind: z.enum(["HATCH", "LADDER", "STAIR", "SKYLIGHT_ACCESS", "OTHER"]).catch("OTHER"), label: z.string() })).catch([]),
  overruns: strings,
  plant: strings,
  rooflights: nnum,
  parapetHeightStrings: strings,
  unreadable: strings,
  notes: z.string().catch(""),
});
export type RoofRead = z.infer<typeof roofSchema>;

// --- MARK-UP (a person's colours over a drawing) ------------------------------------------

export const MARKUP_TOOL = "record_markup";
export const markupSchema = z.object({
  zones: z
    .array(
      z.object({
        colour: z.string(),
        legend: nstr.describe("The legend or caption words for this colour, copied exactly."),
        meaning: z
          .enum([
            "EXTERNAL_SCAFFOLD",
            "INTERNAL_SCAFFOLD",
            "EXTERNAL_AND_INTERNAL_SCAFFOLD",
            "BIRDCAGE",
            "WORKING_PLATFORM",
            "EDGE_PROTECTION",
            "HANDRAIL",
            "LOADING_BAY",
            "HAKI",
            "SKIP",
            "OTHER",
          ])
          .catch("OTHER"),
        coversAllExternalWalls: z.boolean().catch(false),
        coversWalls: strings.describe("The outline segments it covers, by their ids from the plan list (e.g. \"S1\", \"S4\"), when not all of them."),
        internalWalls: strings.describe("Internal walls it runs along, described (e.g. \"main hall west wall, inside\")."),
        coversWholeInterior: z.boolean().catch(false),
        coversRooms: strings.describe("Room labels it covers, when not the whole interior."),
        writtenNumbers: z
          .array(z.object({ string: z.string(), means: z.enum(["LENGTH", "LIFTS", "AREA", "HEIGHT", "COUNT", "OTHER"]).catch("OTHER") }))
          .catch([]),
      }),
    )
    .catch([]),
  unreadable: strings,
  notes: z.string().catch(""),
});
export type MarkupRead = z.infer<typeof markupSchema>;
