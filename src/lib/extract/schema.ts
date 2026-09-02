import { z } from "zod";
import { STRUCTURE_FORMS } from "@/lib/structure";

/**
 * The extractDrawing() output contract — the OBSERVABLES a scaffolder reads off
 * a house-type drawing (Layer 1). This is measurements only: the model reports
 * what it can see, with per-field confidence + provenance. It NEVER computes the
 * number of lifts, the perimeter total, birdcage areas, or any pricing — those
 * are deterministic engine rules applied downstream (see docs/11 §4).
 *
 * The Claude tool's input_schema is generated from this Zod schema
 * (see extractDrawing.ts), so the two can never drift.
 *
 * Grounded in Colin's take-off method (docs/11): perimeter = building line off
 * the ground-floor plan; height to soffit; storeys + room-in-roof; roof type;
 * apexes counted per elevation; render measured per rendered section; birdcage
 * from internal floor dimensions per floor; low-level porch/bay; external corners.
 */

export const confidence = z
  .enum(["high", "medium", "low", "unknown"])
  .describe("Confidence in this value. Use 'unknown' if you cannot read it.");

/**
 * 1-based page number WITHIN THE ATTACHED PDF where the value was read — count
 * the pages in the document you were given, first page = 1. NOT the drawing's
 * printed sheet number. Lets the review screen link straight to the page.
 */
const sourcePage = z
  .number()
  .int()
  .nullable()
  .describe(
    "1-based page number WITHIN THIS attached PDF where you read the value (count the pages you were given, first = 1). NOT the drawing's printed sheet/drawing number. null if you cannot point to a specific page.",
  )
  .optional();

const numberField = z.object({
  value: z.number().nullable().describe("The numeric value, or null if unreadable."),
  confidence,
  sourceSheet: z
    .string()
    .nullable()
    .describe("The sheet/page label this came from, e.g. 'Front Elevation'.")
    .optional(),
  sourceDimension: z
    .string()
    .nullable()
    .describe("The exact dimension string on the drawing, e.g. '9203'.")
    .optional(),
  sourcePage,
});

const boolField = z.object({
  value: z.boolean().nullable().describe("true / false, or null if you cannot tell."),
  confidence,
  sourceSheet: z.string().nullable().optional(),
  sourcePage,
});

const wallSegment = z.object({
  position: z
    .enum(["front", "rear", "gable_left", "gable_right", "other"])
    .describe(
      "Which external wall this length is. gable_left / gable_right are the two side/end walls.",
    ),
  label: z.string().nullable().optional(),
  lengthM: z.number().describe("Wall length in metres (converted from the printed mm)."),
  sourceDimension: z
    .string()
    .nullable()
    .describe("The dimension string this length was read from, e.g. '9203'.")
    .optional(),
  sourcePage,
  confidence,
});

/** One elevation face. Apexes and render are read per face, the way Colin does. */
const elevation = z.object({
  face: z
    .enum(["front", "rear", "left", "right", "other"])
    .describe("Which elevation face this entry describes."),
  faceRoof: z
    .enum(["GABLED", "HIPPED"])
    .nullable()
    .describe(
      "STEP 1 — the roof shape where it meets THIS face: GABLED (brickwork rises to an apex point → needs a table lift) or HIPPED (slopes back, no brickwork above the eaves → no apex). Decide per face — a MIXED roof has some of each. null if you cannot tell.",
    )
    .optional()
    .default(null),
  apexReason: z
    .string()
    .nullable()
    .describe(
      "STEP 2 — decide this BEFORE the number: one SHORT line of reasoning for THIS face (e.g. 'projecting front gable rises to a brickwork point → 1', 'hipped, nothing above the eaves → 0').",
    )
    .optional()
    .default(null),
  apexCount: z
    .number()
    .nullable()
    .describe(
      "STEP 3 — the number that follows from faceRoof + apexReason: how many gable apexes on THIS face have brickwork up to the point (each needs a table lift). 0 if this face is hipped or has no apex.",
    ),
  rendered: z
    .boolean()
    .nullable()
    .describe("Whether this face has a rendered (or clad) section needing a render adaption."),
  renderLengthM: z
    .number()
    .nullable()
    .describe("Linear metres of the rendered section on this face, if dimensioned; else null.")
    .optional(),
  sourceSheet: z.string().nullable().optional(),
  sourceDimension: z.string().nullable().optional(),
  sourcePage,
  confidence,
});

/**
 * One rectangle of an internal floor footprint. Report ONLY raw printed numbers —
 * NEVER multiply or subtract. Prefer a direct internal dimension; otherwise give
 * the overall external dimension and the STRUCTURAL wall thickness and the engine
 * derives it. A plain floor is ONE rectangle; an L-shape / step is several (the
 * engine sums them). The wall thickness is DIFFERENT on every drawing — read it,
 * never assume a number.
 */
const birdcageRect = z.object({
  internalWidthM: z
    .number()
    .nullable()
    .describe(
      "Clear INTERNAL width of ONE dwelling in metres — the MIDDLE number of an inner dimension line reading [wall | span | wall] (e.g. 5287 → 5.287), ONLY if that internal span is printed. Prefer this over deriving. Do NOT compute it. null otherwise.",
    ),
  internalDepthM: z
    .number()
    .nullable()
    .describe(
      "Clear INTERNAL depth (front-to-back) in metres — the internal span of the depth dimension line, ONLY if printed directly. Prefer this over deriving. Do NOT subtract anything. null otherwise.",
    ),
  overallWidthM: z
    .number()
    .nullable()
    .describe(
      "Overall EXTERNAL width of ONE HOUSE in metres — the outermost dimension line of a SINGLE house (the setting-out plan shows one house). Do NOT report the combined pair/terrace frontage here, and do NOT subtract walls — report it as-is. The engine subtracts the walls; it does NOT divide the birdcage (that's per house). Report it whenever visible (it cross-checks the internal read).",
    )
    .optional(),
  overallDepthM: z
    .number()
    .nullable()
    .describe(
      "Overall EXTERNAL depth (front-to-back) in metres — the outermost depth dimension line (e.g. 7904 → 7.904). Report it as-is — do NOT subtract the wall thicknesses; the engine does. Report it whenever visible.",
    )
    .optional(),
  wallWidthLeftMm: z
    .number()
    .nullable()
    .describe(
      "STRUCTURAL wall thickness (mm) at the LEFT END of the WIDTH dimension line — the short end segment across the hatched wall (e.g. 328 / 302 / 392). Read it off the plan; DIFFERENT on every drawing, never assume. The two ends can DIFFER (a party wall vs an external gable) — report each side.",
    )
    .optional(),
  wallWidthRightMm: z
    .number()
    .nullable()
    .describe("STRUCTURAL wall thickness (mm) at the RIGHT END of the WIDTH dimension line.")
    .optional(),
  wallDepthFrontMm: z
    .number()
    .nullable()
    .describe(
      "STRUCTURAL wall thickness (mm) at the FRONT END of the DEPTH dimension line. The two ends can differ (e.g. a rendered front wall 370 vs a brick rear 328) — report each side.",
    )
    .optional(),
  wallDepthRearMm: z
    .number()
    .nullable()
    .describe("STRUCTURAL wall thickness (mm) at the REAR END of the DEPTH dimension line.")
    .optional(),
  wallThicknessMm: z
    .number()
    .nullable()
    .describe(
      "Convenience: the UNIFORM structural wall thickness (mm) when every external wall on this plan is the same — e.g. 328 / 302 / 392. Use this INSTEAD of the four per-side fields when the walls are all equal (the common case); the engine applies it to any side you didn't give a per-side value for. null if the plan does not dimension the wall.",
    )
    .optional(),
  legendWallThicknessMm: z
    .number()
    .nullable()
    .describe(
      "FALLBACK ONLY: the cavity wall thickness quoted in the WALL LEGEND text (e.g. '353MM THICK CAVITY WALL' → 353). This is the FINISHED-face thickness (bigger than the structural one). Report it only when the plan does not dimension the structural wall; the engine uses it only if no plan wall is given. null if there is no legend value.",
    )
    .optional(),
  sourceDimension: z.string().nullable().optional(),
  sourcePage,
});

/**
 * One internal floor. Report ONLY the raw footprint dimensions; the engine derives
 * the birdcage area (Σ width×depth) purely from them and sets the confidence. Do
 * NOT report any stated/printed floor area — it is not used. The model does NO
 * arithmetic.
 */
const floorArea = z.object({
  level: z
    .enum(["GF", "FF", "SF", "TF"])
    .describe(
      "Floor level for the birdcage: GF ground, FF first, SF second, TF third. Count a room-in-roof (2.5-storey top room) as the next level up (usually SF).",
    ),
  rectangles: z
    .array(birdcageRect)
    .describe(
      "The internal footprint of ONE HOUSE as one rectangle for a plain rectangular floor, or SEVERAL rectangles that tile a stepped / L / T / U floor. PER HOUSE on a pair/terrace: the WIDTH is one dwelling's internal width (a single [wall|span|wall] span, else the summed run to the party wall), NEVER the full pair frontage; the DEPTH (gable direction) is one house's whole depth. Test for a step first: if the internal depth differs left-vs-right (or the width differs top-vs-bottom) the floor STEPS and MUST be split — a single bounding rectangle would over-read. Give EACH tile its OWN internal width and depth (a width/depth may be a run of adjacent internal segments summed). Report raw printed DIMENSIONS only — the engine multiplies and sums. Empty if no dimensions are legible.",
    )
    .default([]),
  sourceSheet: z.string().nullable().describe("Floor-plan / setting-out sheet label.").optional(),
  sourcePage,
  confidence: confidence.default("medium"),
});

export const extractionResultSchema = z.object({
  houseType: z.object({
    name: z.string().nullable().describe("House-type name, e.g. 'Dekker', 'Rosewood'."),
    code: z
      .string()
      .nullable()
      .describe("House-type code if shown, e.g. 'NSS.277'.")
      .optional(),
    confidence,
  }),
  buildType: z.object({
    value: z.enum(["TRADITIONAL", "TIMBER_FRAME"]).nullable(),
    confidence,
  }),
  structure: z
    .object({
      form: z
        .enum(STRUCTURE_FORMS)
        .nullable()
        .describe(
          "The building type, named by HOW MANY HOUSES are joined side-by-side (set dwellingsWide to match): DETACHED = 1 free-standing house (dwellingsWide 1). PAIR_SEMI = a semi-detached PAIR, 2 houses sharing one party wall (dwellingsWide 2). THREE_BLOCK = 3 houses joined in a row (dwellingsWide 3). TERRACE = 4 OR MORE houses joined in a row — use 'terrace' ONLY for four or more (dwellingsWide 4+). For all house forms the take-off is per ONE house. APARTMENT_BLOCK = a block of FLATS (multiple flats per floor, communal entrance): scaffolded as ONE whole building, so do NOT divide the frontage (dwellingsWide = 1) and report the WHOLE-FLOOR internal area per level, not a single flat's area.",
        ),
      confidence,
    })
    .describe("What kind of building this drawing shows — decides how the take-off is split.")
    .default({ form: null, confidence: "unknown" }),
  storeys: numberField.describe(
    "Number of storeys: 1, 2, 2.5 (room in roof) or 3. Read/observe it; do NOT compute lifts.",
  ),
  roomInRoof: boolField
    .describe(
      "True if there is a habitable room in the roof (a 2.5-storey): dormers, roof/velux windows, or a raised eaves with living space above. This adds a lift and a birdcage floor downstream.",
    )
    .default({ value: null, confidence: "unknown" }),
  heightToSoffitM: numberField.describe(
    "Height to soffit in metres — the top of the wall the scaffold reaches. ALWAYS use the soffit / underside-of-wallplate value (e.g. 'U/S Wallplate 5025' = 5.025 m); never the ridge, never a mid-roof point; the same datum on every house type. Read it exactly. Do NOT compute the number of lifts.",
  ),
  storeyHeightsM: z
    .array(z.number())
    .describe(
      "The floor-to-floor STOREY HEIGHTS from the SECTION, ground upward — each the DIFFERENCE between one level and the next, with the LAST one being the top floor up to the soffit / underside of wallplate (e.g. [2.662, 2.063]). These are DELTAS (heights), NOT absolute floor levels: if the drawing prints absolute FFL levels like 0 / 2662 / 5325, report the DIFFERENCES (2662, 2663), not the levels. Report the RAW printed numbers only — do NOT add them up. Their sum is a second, independent estimate of the soffit height the engine cross-checks against heightToSoffitM. Empty if the section doesn't dimension storey heights.",
    )
    .default([]),
  roof: z
    .object({
      overallType: z
        .enum(["PITCHED", "HIPPED", "MIXED"])
        .nullable()
        .describe(
          "PITCHED = has gable apex(es) with brickwork to the point (needs table lifts). HIPPED = roof slopes back on all sides, no apex, no table lift. MIXED = some faces hipped, some gabled.",
        ),
      confidence,
      sourceSheet: z.string().nullable().optional(),
      sourcePage,
    })
    .describe("Overall roof form. Apexes are then counted per face in `elevations`."),
  elevations: z
    .array(elevation)
    .describe(
      "One entry per elevation face you can read (front, rear, sides). Count apexes and note render PER FACE — this is how the take-off is done. Empty only if no elevation is legible.",
    ),
  wallSegments: z
    .array(wallSegment)
    .describe(
      "Each external wall length along the BUILDING LINE (brickwork line), taken off the OUTSIDE of the GROUND-FLOOR or SETTING-OUT plan. Report each wall separately with its dimension string. Do NOT sum them and do NOT add any corner allowance — that is applied downstream.",
    ),
  cornerCount: numberField.describe(
    "Number of EXTERNAL (outward-pointing) corners on the scaffolded footprint. A plain rectangle has EXACTLY 4. Every place the wall line STEPS IN (a reentrant corner — the inside of a step, notch or L) adds ONE external corner: external corners = 4 + (number of steps/reentrant corners). One front/side step → 5; an L → 5; a T/U → 6. To tell if it is a rectangle, compare the DEPTH on the left vs right and the WIDTH at top vs bottom — equal → rectangle (4); a difference means a step. Count outward corners only (not reentrant corners). Do NOT count bays, porches (low-level items), chimney breasts, or construction offsets (a ~75mm render stop, a ~100mm brick return). Whenever this exceeds 4, the birdcage MUST be split into rectangles (they are the same feature).",
  ),
  cornerReason: z
    .string()
    .nullable()
    .describe(
      "One-line justification for cornerCount stating the shape and any steps — e.g. 'rectangle, all opposite sides equal → 4', or 'front is 675 deeper on the lounge side → 1 step → 5'. Write the reason BEFORE settling the number.",
    )
    .optional(),
  dwellingsWide: numberField.describe(
    "How many dwellings share the FRONT/REAR frontage in THIS drawing: 1 for a detached house, 2 for a pair/semi, 3 for a three-block, 4 or more for a terrace. Report the front/rear wall lengths as the FULL printed frontage spanning all the dwellings — do NOT pre-divide them. The engine divides the front/rear by this number to get one dwelling; gable-end walls are NOT divided. The BIRDCAGE is per house too — its width is ONE dwelling's internal width (≈ frontage/dwellings), NOT the full frontage.",
  ),
  floorAreas: z
    .array(floorArea)
    .describe(
      "One entry per floor level (2.5-storey has 3: GF, FF, roof room). For each floor report the raw internal footprint DIMENSIONS as rectangles (internal span, or overall + wall thickness) — the engine derives the birdcage m² from them. Do NOT report any stated/printed floor area; it is not used. Report only printed numbers; never multiply, subtract or estimate from an elevation. Empty if nothing legible.",
    ),
  lowLevel: z
    .object({
      porchCanopyCount: z
        .number()
        .nullable()
        .describe(
          "Number of PORCHES that are an OPEN CANOPY — a roof/hood over the entrance (often GRP or glass), with no full-height enclosing walls. Each still counts as ONE low-level scaffold.",
        ),
      porchSolidCount: z
        .number()
        .nullable()
        .describe(
          "Number of PORCHES that are SOLID / ENCLOSED (built brick or block walls). Each counts as ONE low-level scaffold. If you can see a porch but cannot tell canopy vs solid, count it HERE.",
        ),
      baySingleStoreyCount: z
        .number()
        .nullable()
        .describe(
          "Number of SINGLE-STOREY bay windows — the bay projects at the GROUND floor ONLY (it stops below the first-floor windows). Each counts as ONE low-level scaffold.",
        ),
      bayTwoStoreyCount: z
        .number()
        .nullable()
        .describe(
          "Number of TWO-STOREY bay windows — the bay rises through BOTH floors (full height), which you read off the ELEVATION. A two-storey bay is NOT a low level (it is full height, part of the main scaffold), so report it HERE and it is EXCLUDED from the low-level count. NEVER put a two-storey bay in baySingleStoreyCount.",
        ),
      confidence,
    })
    .describe(
      "Low-level features. Porches and SINGLE-storey bays each need a small low-level scaffold tower — recorded BY TYPE (canopy/solid, single/two-storey) so the treatment can change later without re-reading the drawings. A TWO-STOREY bay is captured but is NOT a low level.",
    )
    .default({
      porchCanopyCount: null,
      porchSolidCount: null,
      baySingleStoreyCount: null,
      bayTwoStoreyCount: null,
      confidence: "unknown",
    }),
  chimney: boolField
    .describe(
      "Whether the drawing shows a chimney (would need a chimney scaffold). Detect it from the elevations / roof plan.",
    )
    .default({ value: null, confidence: "unknown" }),
  smartRoofPeakHeightM: numberField
    .describe(
      "If the roof peak looks unusually high for this house type (a possible 'smart roof' with a raised peak), report the peak height in metres; else null. Do NOT apply a threshold — just flag an unusually high peak.",
    )
    .default({ value: null, confidence: "unknown" }),
  underbuild: z
    .object({
      needed: z
        .boolean()
        .nullable()
        .describe(
          "Whether this house appears to need UNDERBUILD / a foot scaffold at the base because it sits on a slope or has stepped foundations — ONLY if that is visible on the section or an elevation you were given. The authoritative source is the SITE ELEVATIONS plan, a SEPARATE drawing; if you were not given it, leave null. Never guess from a house elevation alone.",
        ),
      note: z
        .string()
        .nullable()
        .describe("Brief note on what you saw (e.g. 'FFL steps 600mm across the plot on section A-A').")
        .optional(),
      confidence,
    })
    .describe("Underbuild / foot-scaffold need where the plot is on a slope (often not knowable without the site plan).")
    .default({ needed: null, note: null, confidence: "unknown" }),
  notes: z
    .string()
    .describe(
      "Short, useful notes only (max 2-3 sentences): assumptions made, ambiguities resolved, an orientation caveat, or fields you couldn't read. No obvious restatements, no reasoning steps, no lists of skipped sheets. Empty if nothing useful.",
    )
    .default(""),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;

/** The low-level feature breakdown the model reads (typed counts). */
export type LowLevel = ExtractionResult["lowLevel"];

/**
 * The LOW_LEVEL_QTY the engine prices: porches (canopy + solid) + single-storey
 * bays. TWO-storey bays are full height (part of the main scaffold), NOT low
 * levels, so they are EXCLUDED. Returns null only when nothing was read at all.
 * Shared by persist + provenance so the two can never drift.
 */
export function lowLevelQty(ll: LowLevel): number | null {
  const c = ll.porchCanopyCount;
  const s = ll.porchSolidCount;
  const b1 = ll.baySingleStoreyCount;
  const b2 = ll.bayTwoStoreyCount;
  if (c == null && s == null && b1 == null && b2 == null) return null;
  return (c ?? 0) + (s ?? 0) + (b1 ?? 0);
}
