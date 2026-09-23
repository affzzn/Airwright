/**
 * "Draft from enquiry" (docs/19) — the Zod output contract for the construction
 * scope-of-works reader. PURE (no Prisma, no SDK): the tool's JSON schema is
 * generated from this so the model's contract and our parser can never drift.
 *
 * The AI reads the client's WRITTEN scope (text/tables — never drawings) and
 * proposes one draft line per scope row, mapped to a picking-list element by id
 * (or null when nothing matches). It never prices, never invents an element, and
 * keeps the client's exact wording for traceability. Quantities are the client's
 * STATED numbers — a double-check for the estimator, not the final answer.
 */

import { z } from "zod";

export const DRAFT_TOOL_NAME = "draft_quote_lines";

export const draftConfidence = z.enum(["high", "medium", "low"]);
export type DraftConfidence = z.infer<typeof draftConfidence>;

export const draftLineSchema = z.object({
  /** The scope's original wording for this item — kept verbatim for traceability. */
  clientText: z.string(),
  /** The scope's own reference for the row, e.g. "1.2", when it numbers them. */
  itemRef: z.string().nullable(),
  /** Where on the job it is, e.g. "Stair 01", "North courtyard", "Block F roof". */
  location: z.string().nullable(),
  /** The dimension cell VERBATIM, e.g. "2.4x5.4m", "560lin.m", "N/A". Never do
   *  the arithmetic: a deterministic parser turns this into a quantity. */
  dimensionText: z.string().nullable(),
  /** The height cell VERBATIM, e.g. "12m (top working platform level)". */
  heightText: z.string().nullable(),
  /** The hire-duration cell VERBATIM, e.g. "20wks". Scopes give this PER LINE. */
  hireDurationText: z.string().nullable(),
  /** The loading requirement, e.g. "General Purpose", when the scope states one. */
  loadingRequirement: z.string().nullable(),
  /** A REAL picking-list element id from the provided list, or null = no match. */
  elementId: z.string().nullable(),
  /** The quantity the scope states, if any (m / m² / count). null = not stated. */
  quantity: z.number().nullable(),
  /** The number of lifts the scope implies for a per-lift item, if any. */
  lifts: z.number().nullable(),
  /** A short caveat for the estimator (e.g. "'20 LM x 2 pits' — cumulative or per pit?"). */
  note: z.string().nullable(),
  confidence: draftConfidence,
  /** One line on why it mapped this way (or why it couldn't). */
  reason: z.string().nullable(),
});
export type DraftLine = z.infer<typeof draftLineSchema>;

export const constructionDraftSchema = z.object({
  lines: z.array(draftLineSchema),
  /** Anything the estimator should know about the scope as a whole. */
  notes: z.string(),
});
export type ConstructionDraft = z.infer<typeof constructionDraftSchema>;
