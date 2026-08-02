import { z } from "zod";
import { confidence } from "./schema";

/**
 * The extractPlotList() output contract: the plot list / site plan maps each
 * plot number to a house-type code and its configuration. This is what turns a
 * single priced house type into a priced whole site.
 */
export const plotConfiguration = z.enum([
  "DETACHED",
  "SEMI_DETACHED",
  "END_TERRACE",
  "MID_TERRACE",
]);

export const plotListResultSchema = z.object({
  plots: z.array(
    z.object({
      plotNumber: z.string().describe("The plot number/label, e.g. '18'."),
      houseTypeCode: z
        .string()
        .nullable()
        .describe("House-type code for this plot, e.g. '1337'."),
      houseTypeName: z
        .string()
        .nullable()
        .describe("House-type name, e.g. 'CHESTERWOOD'."),
      configuration: plotConfiguration
        .nullable()
        .describe(
          "Detached / semi / end-terrace / mid-terrace. Null if not stated — do not guess.",
        ),
      isRendered: z
        .boolean()
        .nullable()
        .describe("Whether this plot is rendered, if stated. Null if unknown.")
        .optional(),
      confidence,
    }),
  ),
  notes: z
    .string()
    .describe(
      "Short, useful notes only: anything ambiguous, or fields you couldn't read. Empty if nothing useful.",
    ),
});

export type PlotListResult = z.infer<typeof plotListResultSchema>;
