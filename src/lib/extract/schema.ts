import { z } from "zod";

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
});

const boolField = z.object({
  value: z.boolean().nullable().describe("true / false, or null if you cannot tell."),
  confidence,
  sourceSheet: z.string().nullable().optional(),
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
  confidence,
});

/** One elevation face. Apexes and render are read per face, the way Colin does. */
const elevation = z.object({
  face: z
    .enum(["front", "rear", "left", "right", "other"])
    .describe("Which elevation face this entry describes."),
  apexCount: z
    .number()
    .nullable()
    .describe(
      "Number of gable apexes on THIS face that have brickwork up to the point and so need a table lift. 0 if this face is hipped or has no apex.",
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
  confidence,
});

/** One internal floor's dimensions → birdcage area (length × width) downstream. */
const floorArea = z.object({
  level: z
    .enum(["GF", "FF", "SF", "TF"])
    .describe(
      "Floor level for the birdcage: GF ground, FF first, SF second, TF third. Count a room-in-roof (2.5-storey top room) as the next level up (usually SF).",
    ),
  internalLengthM: z
    .number()
    .nullable()
    .describe(
      "INTERNAL floor length in metres (inside the external walls). DERIVE it if not printed directly: an overall dimension MINUS the front and rear external wall thicknesses (e.g. 7904 − 302 − 302 = 7300 → 7.3 m). null if you cannot read or derive it.",
    ),
  internalWidthM: z
    .number()
    .nullable()
    .describe(
      "INTERNAL floor width in metres — the clear internal span of ONE dwelling (for a pair, the full printed frontage = width + party wall + width). null if unreadable.",
    ),
  internalAreaM2: z
    .number()
    .nullable()
    .describe(
      "GROSS INTERNAL floor area in m² if the drawing states one — PREFER the setting-out plan / masonry area (e.g. '35.60m² (BEAM & BLOCK)'), NOT the NDSS 'Total Floor Area' schedule (that is the smaller usable/habitable area; use it only if no gross-internal is available, and note it). Report this IN ADDITION to internalLengthM/internalWidthM so they can be reconciled. Else null.",
    )
    .optional(),
  sourceSheet: z.string().nullable().describe("Floor-plan sheet label.").optional(),
  confidence,
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
        .enum(["SINGLE", "PAIR_OR_TERRACE", "APARTMENT_BLOCK"])
        .nullable()
        .describe(
          "SINGLE = one detached dwelling. PAIR_OR_TERRACE = a semi-detached pair or a terrace of HOUSES drawn together (take-off is per house — set dwellingsWide). APARTMENT_BLOCK = a block of FLATS (multiple flats per floor): it is scaffolded as ONE whole building, so do NOT divide the frontage (set dwellingsWide = 1) and report the WHOLE-FLOOR internal area per level, not a single flat's area.",
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
    "Height to soffit / eaves in metres — the top of the wall the scaffold reaches, e.g. from 'U/S Wallplate 5025' = 5.025 m. Read it exactly. Do NOT compute the number of lifts.",
  ),
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
    "Number of EXTERNAL corners / returns on the scaffolded perimeter (a plain rectangle has 4). Count external returns only.",
  ),
  dwellingsWide: numberField.describe(
    "How many dwellings share the FRONT/REAR frontage in THIS drawing: 1 for a single or detached dwelling, 2 for a semi-detached pair, 3+ for a terrace block drawn together. Report the front/rear wall lengths as the FULL printed frontage spanning all the dwellings — do NOT pre-divide them. The engine divides the front/rear by this number to get one dwelling; gable-end walls are NOT divided.",
  ),
  floorAreas: z
    .array(floorArea)
    .describe(
      "Internal floor dimensions per level, so birdcage m² can be computed. For each floor, read the stated GROSS INTERNAL area (setting-out plan / masonry) if given AND derive the internal length × width from dimensions, and report both. One entry per floor (2.5-storey has 3: GF, FF, roof room). Empty if no legible internal dimensions or area — never estimate from an elevation.",
    ),
  lowLevel: z
    .object({
      porchCount: z.number().nullable().describe("Number of porches (each = one low-level scaffold)."),
      bayCount: z.number().nullable().describe("Number of bay windows (each = one low-level scaffold)."),
      confidence,
    })
    .describe("Low-level features needing a separate small low-level scaffold.")
    .default({ porchCount: null, bayCount: null, confidence: "unknown" }),
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
  notes: z
    .string()
    .describe(
      "Short, useful notes only (max 2-3 sentences): assumptions made, ambiguities resolved, an orientation caveat, or fields you couldn't read. No obvious restatements, no reasoning steps, no lists of skipped sheets. Empty if nothing useful.",
    )
    .default(""),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;
