import { z } from "zod";

/**
 * The extractDrawing() output contract — Week 1 minimal field set.
 * Every field carries a confidence label and (where relevant) the exact source
 * dimension on the drawing, so the review screen can show provenance and the
 * ambiguous/low-confidence fields can float to the top of the queue.
 *
 * This Zod schema is the single source of truth: the Claude tool's input_schema
 * is generated from it (see extractDrawing.ts), so the two can never drift.
 *
 * Later weeks deepen this into the full staged-operation take-off.
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

const wallSegment = z.object({
  position: z
    .enum(["front", "rear", "gable_left", "gable_right", "other"])
    .describe("Which wall of the house this length belongs to."),
  label: z.string().nullable().optional(),
  lengthM: z.number().describe("Wall length in metres."),
  sourceDimension: z
    .string()
    .nullable()
    .describe("The dimension string this length was read from.")
    .optional(),
  confidence,
});

export const extractionResultSchema = z.object({
  houseType: z.object({
    name: z.string().nullable().describe("House-type name, e.g. 'Chesterwood'."),
    code: z
      .string()
      .nullable()
      .describe("House-type code, e.g. '6.1' or 'WOLLATON'.")
      .optional(),
    confidence,
  }),
  buildType: z.object({
    value: z.enum(["TRADITIONAL", "TIMBER_FRAME"]).nullable(),
    confidence,
  }),
  storeys: numberField.describe("Number of storeys (2.5 allowed for two-and-a-half)."),
  heightToSoffitM: numberField.describe("Height to soffit / eaves in metres."),
  gableCount: numberField.describe("Number of gables/apexes needing scaffold."),
  wallSegments: z
    .array(wallSegment)
    .describe("Individual external wall lengths that make up the perimeter."),
  notes: z
    .string()
    .describe("Any ambiguity you resolved, e.g. wall line vs overhang, or pages skipped."),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;
