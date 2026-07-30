import { z } from "zod";

/** Queue name for drawing extraction jobs. */
export const EXTRACT_DRAWING_QUEUE = "extract-drawing";

/** Payload for an extraction job. `pageRange` lets us split oversized packs. */
export const extractDrawingJobSchema = z.object({
  documentId: z.string(),
  extractionId: z.string(),
  pageRange: z.string().nullable().optional(),
});

export type ExtractDrawingJob = z.infer<typeof extractDrawingJobSchema>;
