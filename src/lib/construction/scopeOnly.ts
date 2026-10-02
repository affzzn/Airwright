/**
 * Scenario 1 — the client's scope, priced as written (2026-10-02). PURE, unit-tested.
 *
 * A scope was uploaded, so the scope decides everything: what is priced AND how
 * much. The drawings are not read, so there is nothing to cross-check against —
 * no "agrees / differs", no confidence, no information list, no cards. Each scope
 * line the reader mapped to a picking-list item becomes one draft line carrying
 * the client's own numbers exactly as the row (or the wording) gave them:
 *   - quantity: the row's figure, else a count in the wording ("2nr", "1600hrs");
 *   - lifts, hire weeks and section: from the row;
 *   - a line with no number is left BLANK for the estimator to type.
 * The one rule kept: weekly inspections are priced for the row's hire weeks (the
 * client's own number), else the longest hire on the scope — the "1" on such a row
 * is one a week, not a total.
 * Notes code raised on the client's wording (scopeFixes: "20 m × 2 — in total or
 * each?") stay on the line as small notes.
 *
 * The email adds EXTRA lines only: when the scope is a schedule, a line from the
 * prose (the email, no schedule row) for an item the schedule already prices is
 * not repeated — it is listed in the flags so nothing vanishes silently.
 */

import type { DrawingDraftLine } from "./assemble";
import { areaSection, elementRole, emptySectionsOf, type BindLibEl } from "./bindScope";
import { heightBracketFor } from "./rules";
import type { ReconciledDraftLine } from "./scopeDraft";

export interface ScopeOnlyInput {
  items: ReconciledDraftLine[];
  library: BindLibEl[];
  /** Every section heading of the scope (the reader's list + the tables'). */
  sections: string[];
  /** Section headings a schedule table shows with nothing under them. */
  emptyTableSections?: string[];
}

export interface ScopeOnlyResult {
  lines: DrawingDraftLine[];
  emptySections: string[];
  flags: string[];
}

export function scopeOnlyLines(input: ScopeOnlyInput): ScopeOnlyResult {
  const byId = new Map(input.library.map((e) => [e.id, e]));
  const hires = input.items.map((i) => i.hireWeeks).filter((w): w is number => w != null && w > 0);
  const longestHire = hires.length ? Math.max(...hires) : null;
  let blanks = 0;
  let unmatched = 0;
  const onSchedule = new Set(input.items.filter((i) => i.rowRef && i.elementId).map((i) => i.elementId!));
  const covered = input.items.filter((i) => !i.rowRef && i.elementId != null && onSchedule.has(i.elementId));
  const items = input.items.filter((i) => !covered.includes(i));

  const lines: DrawingDraftLine[] = items.map((item) => {
    const el = item.elementId ? byId.get(item.elementId) : undefined;
    const clientRef = {
      text: item.clientText,
      rowRef: item.rowRef,
      sheet: item.sheet,
      section: item.section,
      itemRef: item.itemRef,
      location: item.location,
      statedQuantity: item.quantity,
      statedLifts: item.lifts,
      statedCount: item.statedCount,
      hireWeeks: item.hireWeeks,
    };
    const note = [item.quantityBasis, item.note].filter(Boolean).join(" · ") || null;
    if (!el) {
      unmatched++;
      return {
        elementId: null,
        description: item.clientText || "Unmatched scope line",
        unit: "NR",
        quantity: item.quantity ?? item.statedCount,
        lifts: item.lifts,
        heightBracket: null,
        confidence: "unknown",
        note,
        needsItem: true,
        hireWeeks: item.hireWeeks,
        section: item.section,
        buildingId: null,
        formula: null,
        provenance: [`scope: "${item.clientText}"`],
        paramsUsed: [],
        flags: [...(item.flags ?? []), "No picking-list item matched — choose one, or add it as a one-off."],
        clientRef,
        suggestedElementId: null,
      };
    }
    const role = elementRole(el.name);
    const quantity = role === "INSPECTION" ? (item.hireWeeks ?? longestHire) : (item.quantity ?? item.statedCount);
    if (quantity == null) blanks++;
    return {
      elementId: el.id,
      description: el.name,
      unit: el.unit,
      quantity,
      lifts: el.usesLifts ? item.lifts : null,
      heightBracket: el.usesHeightBracket === false ? null : heightBracketFor(item.heightM),
      confidence: "unknown",
      note,
      needsItem: false,
      hireWeeks: item.hireWeeks,
      section: item.section ?? areaSection(role),
      buildingId: null,
      formula: null,
      provenance: [`scope: "${item.clientText}"`],
      paramsUsed: [],
      flags: [...(item.flags ?? [])],
      clientRef,
      suggestedElementId: el.id,
    };
  });

  const emptySections = emptySectionsOf(input.items, input.sections, input.emptyTableSections);
  const flags: string[] = [];
  if (blanks) flags.push(`${blanks} line${blanks === 1 ? " has" : "s have"} no number in the scope — left blank for you to fill in.`);
  if (unmatched) flags.push(`${unmatched} line${unmatched === 1 ? "" : "s"} matched no picking-list item — choose one.`);
  if (covered.length)
    flags.push(
      `Already on the schedule, so not repeated from the email: ${covered.map((i) => `“${i.clientText.length > 70 ? `${i.clientText.slice(0, 70)}…` : i.clientText}”`).join("; ")}.`,
    );
  if (emptySections.length) flags.push(`Listed with nothing under them: ${emptySections.join(", ")} — confirm none required.`);
  return { lines, emptySections, flags };
}
