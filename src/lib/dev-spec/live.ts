/**
 * LIVE values pulled straight from the extractor code, so the Dev spec page shows
 * the real numbers by construction and can never drift from the code.
 *
 * Only imports PURE modules (no pdfjs, no Anthropic SDK, no Prisma), so it is
 * safe in the Next.js app. It is imported by the server page only; the page
 * passes plain serialisable values down to the client components.
 */

import { PROMPT_VERSION, SYSTEM_PROMPT, USER_INSTRUCTION } from "@/lib/extract/prompt";
import {
  EXTRACTION_MAX_TOKENS,
  INPUT_COST_PER_MTOK,
  OUTPUT_COST_PER_MTOK,
} from "@/lib/extract/config";
import {
  BIRDCAGE_TOLERANCE,
  BIRDCAGE_INTERNAL_XCHECK_TOLERANCE,
  BIRDCAGE_NDSS_MIN_OVER,
  BIRDCAGE_NDSS_MAX_OVER,
} from "@/lib/extract/birdcage";
import { HEIGHT_GAP_NOTE_M } from "@/lib/extract/height";
import {
  DEFAULT_PARAMS,
  STANDARD_STOREY_LIFTS,
  RENDER_LIFTS_BY_STOREY,
  EXPECTED_FLOORS_BY_STOREY,
} from "@/lib/takeoff/engine";
import {
  EXCLUSION_TERMS,
  SITE_LAYOUT_TERMS,
  SETTING_OUT_CIVIL_GUARDS,
  TAKEOFF_KINDS,
} from "@/lib/extract/classify-rules";
import { extractionResultSchema } from "@/lib/extract/schema";

const pct = (n: number): string => `${(n * 100).toFixed(n * 100 === Math.round(n * 100) ? 0 : 1)}%`;

export const LIVE = {
  prompt: {
    version: PROMPT_VERSION,
    system: SYSTEM_PROMPT,
    user: USER_INSTRUCTION,
  },
  request: {
    maxTokens: EXTRACTION_MAX_TOKENS,
    inputCostPerMtok: INPUT_COST_PER_MTOK,
    outputCostPerMtok: OUTPUT_COST_PER_MTOK,
  },
  engine: {
    liftHeightM: DEFAULT_PARAMS.liftHeightM,
    cornerAllowanceM: DEFAULT_PARAMS.cornerAllowanceM,
    standardStoreyLifts: STANDARD_STOREY_LIFTS,
    renderLiftsByStorey: RENDER_LIFTS_BY_STOREY,
    expectedFloorsByStorey: EXPECTED_FLOORS_BY_STOREY,
  },
  birdcage: {
    statedTolerance: BIRDCAGE_TOLERANCE,
    internalXCheckTolerance: BIRDCAGE_INTERNAL_XCHECK_TOLERANCE,
    ndssMinOver: BIRDCAGE_NDSS_MIN_OVER,
    ndssMaxOver: BIRDCAGE_NDSS_MAX_OVER,
    statedTolerancePct: pct(BIRDCAGE_TOLERANCE),
    internalXCheckTolerancePct: pct(BIRDCAGE_INTERNAL_XCHECK_TOLERANCE),
    ndssBandPct: `${pct(BIRDCAGE_NDSS_MIN_OVER)} … +${pct(BIRDCAGE_NDSS_MAX_OVER)}`,
  },
  height: {
    gapNoteM: HEIGHT_GAP_NOTE_M,
  },
  classification: {
    takeoffKinds: [...TAKEOFF_KINDS],
    siteLayoutTerms: [...SITE_LAYOUT_TERMS],
    exclusionTerms: [...EXCLUSION_TERMS],
    settingOutCivilGuards: [...SETTING_OUT_CIVIL_GUARDS],
  },
  /** The exact top-level field names the model must return (from the Zod schema). */
  schemaFieldNames: Object.keys(extractionResultSchema.shape),
} as const;

export type LiveValues = typeof LIVE;
