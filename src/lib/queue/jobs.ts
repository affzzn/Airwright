import { z } from "zod";

/** Queue names. */
export const PROCESS_PACK_QUEUE = "process-pack";
export const EXTRACT_DRAWING_QUEUE = "extract-drawing";
export const EXTRACT_PLOT_LIST_QUEUE = "extract-plot-list";

/** Ingest + classify + segment a whole tender pack, then fan out extractions. */
export const processPackJobSchema = z.object({
  packId: z.string(),
});
export type ProcessPackJob = z.infer<typeof processPackJobSchema>;

/** Extract a single house type's pages. `pageRange` is preset by segmentation. */
export const extractDrawingJobSchema = z.object({
  documentId: z.string(),
  extractionId: z.string(),
  pageRange: z.string().nullable().optional(),
});
export type ExtractDrawingJob = z.infer<typeof extractDrawingJobSchema>;

/** Extract the plot list from a plot-layout document's pages. */
export const extractPlotListJobSchema = z.object({
  documentId: z.string(),
  pageRange: z.string().nullable().optional(),
});
export type ExtractPlotListJob = z.infer<typeof extractPlotListJobSchema>;
