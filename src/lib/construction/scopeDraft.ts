/**
 * "Draft from enquiry" (docs/19) — the PURE reconciliation + alias-learning
 * helpers (no Prisma, no SDK), so they are unit-tested in isolation.
 *
 * The trust guardrails live here:
 *   - reject any element id the model invented (not in the real picking list),
 *   - never drop a scope line — an invalid/absent id becomes an unmatched line,
 *   - learn a client's wording as an alias only on a genuine correction.
 */

import type { DraftConfidence, DraftLine } from "./scopeSchema";
import {
  parseScopeDimension,
  parseScopeDurationWeeks,
  parseScopeHeight,
  quantityForUnit,
} from "./scopeDimension";

/** A draft line after reconciliation — safe to hand to the review UI. */
export interface ReconciledDraftLine {
  clientText: string;
  itemRef: string | null;
  location: string | null;
  /** Weeks of hire this line asks for; a scope states it PER LINE. */
  hireWeeks: number | null;
  heightM: number | null;
  loadingRequirement: string | null;
  /** How the quantity was arrived at, when it came from a dimension cell. */
  quantityBasis: string | null;
  /** A VALID picking-list element id, or null (unmatched → needs mapping). */
  elementId: string | null;
  quantity: number | null;
  lifts: number | null;
  note: string | null;
  confidence: DraftConfidence;
  reason: string | null;
  /** True when the model returned an id we rejected (not in the library). */
  invented: boolean;
}

const cleanNum = (n: number | null | undefined): number | null => {
  if (n == null || !Number.isFinite(n) || n < 0) return null;
  return n;
};

const cleanLifts = (n: number | null | undefined): number | null => {
  const v = cleanNum(n);
  if (v == null) return null;
  const t = Math.trunc(v);
  return t > 0 ? t : null;
};

/**
 * Validate the model's draft against the real element ids. An id that isn't in
 * the library is rejected (nulled + flagged `invented`); the line is kept so
 * nothing is dropped and the estimator can map it by hand. Quantities/lifts are
 * sanitised (finite, non-negative; lifts a positive integer).
 */
export function reconcileDraftLines(
  lines: DraftLine[],
  validIds: Iterable<string>,
  /** Unit per element id, so a dimension cell can be turned into a quantity. */
  unitById: Map<string, string> = new Map(),
): ReconciledDraftLine[] {
  const valid = validIds instanceof Set ? validIds : new Set(validIds);
  return lines.map((l) => {
    const proposed = l.elementId?.trim() || null;
    const isValid = proposed != null && valid.has(proposed);
    const invented = proposed != null && !isValid;
    const elementId = isValid ? proposed : null;

    // The model copies the dimension cell verbatim; the arithmetic happens here.
    let quantity = cleanNum(l.quantity);
    let quantityBasis: string | null = null;
    if (quantity == null && l.dimensionText && elementId) {
      const unit = unitById.get(elementId);
      if (unit) {
        const derived = quantityForUnit(parseScopeDimension(l.dimensionText), unit);
        if (derived) {
          quantity = derived.quantity;
          quantityBasis = derived.basis;
        }
      }
    }

    return {
      clientText: l.clientText?.trim() ?? "",
      itemRef: l.itemRef?.trim() || null,
      location: l.location?.trim() || null,
      hireWeeks: parseScopeDurationWeeks(l.hireDurationText ?? ""),
      heightM: parseScopeHeight(l.heightText ?? ""),
      loadingRequirement: l.loadingRequirement?.trim() || null,
      quantityBasis,
      elementId,
      quantity,
      lifts: cleanLifts(l.lifts),
      note: l.note?.trim() || null,
      confidence: l.confidence,
      reason: l.reason?.trim() || null,
      invented,
    };
  });
}

/** Normalise a candidate alias for comparison (case-insensitive, whitespace-collapsed). */
export function normaliseAlias(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

const MAX_ALIAS_LEN = 80;

/**
 * Decide whether the client's wording should be learned as a new alias on an
 * element, and return it (trimmed, original case) — or null to skip.
 *
 * Skips: empty, over-long, or already covered by the element's name/aliases
 * (case-insensitively). Learning is caller-gated to CORRECTIONS only (docs/19),
 * so the alias list stays high-signal, not noisy.
 */
export function aliasToLearn(
  clientText: string,
  element: { name: string; aliases: string[] },
): string | null {
  const trimmed = clientText.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > MAX_ALIAS_LEN) return null;
  const norm = normaliseAlias(trimmed);
  if (norm === normaliseAlias(element.name)) return null;
  if (element.aliases.some((a) => normaliseAlias(a) === norm)) return null;
  return trimmed;
}
