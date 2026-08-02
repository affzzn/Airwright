import { z } from "zod";

/** Queue names. */
export const PROCESS_PACK_QUEUE = "process-pack";
export const EXTRACT_DRAWING_QUEUE = "extract-drawing";

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
