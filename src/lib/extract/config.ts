/**
 * Model request settings + pricing for the drawing extractor, in ONE pure module.
 *
 * This file imports nothing (no Anthropic SDK, no pdfjs), so it is safe to import
 * anywhere — including the Next.js app bundle and the Dev spec page — without
 * pulling in the worker-only dependencies. `claude.ts` and `extractDrawing.ts`
 * import these so the request settings live in a single, displayable place.
 */

/** max_tokens for a drawing extraction — the field set is rich; large blocks
 *  (3-storey, many elevations/floors) can be verbose. */
export const EXTRACTION_MAX_TOKENS = 16384;

/** Claude pricing per 1M tokens (Opus). Update if the model/pricing changes. */
export const INPUT_COST_PER_MTOK = 15;
export const OUTPUT_COST_PER_MTOK = 75;
