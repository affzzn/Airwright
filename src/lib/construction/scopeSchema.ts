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
