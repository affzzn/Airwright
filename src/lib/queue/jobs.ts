import { z } from "zod";

/** Queue names. */
export const PROCESS_PACK_QUEUE = "process-pack";
export const EXTRACT_DRAWING_QUEUE = "extract-drawing";
/** Construction (docs/22): sort an uploaded enquiry pack into the register. */
export const CONSTRUCTION_INGEST_QUEUE = "construction-ingest";
/** Construction (docs/22): read a job's sheets with the AI + build the measurements. */
export const CONSTRUCTION_READ_QUEUE = "construction-read";

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

/** Sort a construction job's uploaded files (unzip, register, geometry). */
export const constructionIngestJobSchema = z.object({
  quoteId: z.string(),
});
export type ConstructionIngestJob = z.infer<typeof constructionIngestJobSchema>;

/** Run one construction read (every included core sheet, then the building model). */
export const constructionReadJobSchema = z.object({
  runId: z.string(),
});
export type ConstructionReadJob = z.infer<typeof constructionReadJobSchema>;
