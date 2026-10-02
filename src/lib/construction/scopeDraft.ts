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
import { cellOf, type ScopeTable } from "./scopeTable";
import {
  parseScopeDimension,
  parseScopeDurationWeeks,
  parseScopeHeight,
  quantityForUnit,
} from "./scopeDimension";

/** A draft line after reconciliation — safe to hand to the review UI. */
export interface ReconciledDraftLine {
  clientText: string;
  /** The schedule row this line came from ("R12"), when the scope is a table. */
  rowRef: string | null;
  /** The sheet that row is on (for the client-template export). */
  sheet: string | null;
  /** The section heading it sits under. */
  section: string | null;
  /** A count written in the client's wording ("2nr", "x2"), else null. */
  statedCount: number | null;
  /** The client stated no quantity: the drawings decide it ("blank means we measure"). */
  needsMeasurement: boolean;
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
  /** Checks code raised on the line (scopeFixes: "20 m in total, or each?"…). */
  flags?: string[];
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

    const clientText = l.clientText?.trim() ?? "";
    const lifts = cleanLifts(l.lifts) ?? liftsFromText(l.liftsText);
    const statedCount = countInWording(clientText);
    return {
      clientText,
      rowRef: l.rowRef?.trim().replace(/^\[|\]$/g, "") || null,
      sheet: null,
      section: l.section?.trim() || null,
      statedCount,
      needsMeasurement: quantity == null && statedCount == null,
      itemRef: l.itemRef?.trim() || null,
      location: l.location?.trim() || null,
      hireWeeks: parseScopeDurationWeeks(l.hireDurationText ?? ""),
      heightM: parseScopeHeight(l.heightText ?? ""),
      loadingRequirement: l.loadingRequirement?.trim() || null,
      quantityBasis,
      elementId,
      quantity,
      lifts,
      note: l.note?.trim() || null,
      confidence: l.confidence,
      reason: l.reason?.trim() || null,
      invented,
    };
  });
}

/** A lifts cell or wording → a number of lifts ("2", "2 lifts"); "at each level" → null (a rule decides). */
export function liftsFromText(text: string | null | undefined): number | null {
  const m = /^\s*(\d{1,2})\s*(lifts?)?\s*$/i.exec(text ?? "");
  return m && Number(m[1]) > 0 ? Number(m[1]) : null;
}

/**
 * A count written inside the client's wording: "Staircase access towers; 2nr",
 * "Safe gates x2", "3 no. ladder towers". A dimension ("2.4x5.4m") is not a count.
 */
export function countInWording(text: string): number | null {
  const t = text.replace(/\s+/g, " ");
  const nr = /\b(\d{1,3})\s*(?:nr|no\.?|nos\.?)(?![a-z])/i.exec(t);
  if (nr) return Number(nr[1]) > 0 ? Number(nr[1]) : null;
  const x = /(?:^|[^\d.])x\s*(\d{1,3})\b(?!\s*\.\d)(?!\s*m\b)/i.exec(t);
  if (x) return Number(x[1]) > 0 ? Number(x[1]) : null;
  return null;
}

const firstNumber = (s: string | null): number | null => {
  const m = /-?\d+(?:\.\d+)?/.exec((s ?? "").replace(/,/g, ""));
  return m ? Number(m[0]) : null;
};

/**
 * Tie the reader's lines to the schedule rows they came from (docs/23 §11.1). The
 * ROW is the authority for the structure: its section, its hire weeks, its stated
 * lifts / quantity / height come from the cells, never from the model. A row the
 * model left out is added back as an unmatched line (account for every scope
 * line); a rowRef that is not in the table is cleared.
 */
export function attachScopeTables(
  lines: ReconciledDraftLine[],
  tables: ScopeTable[],
  /** Unit per element id, so a dimension cell can be turned into a quantity. */
  unitById: Map<string, string> = new Map(),
): ReconciledDraftLine[] {
  const rows = new Map(tables.flatMap((t) => t.rows.filter((r) => r.kind === "ITEM").map((r) => [r.ref, r] as const)));
  if (rows.size === 0) return lines;
  const out: ReconciledDraftLine[] = [];
  const used = new Set<string>();
  for (const l of lines) {
    const row = l.rowRef ? rows.get(l.rowRef) : undefined;
    if (!row) {
      out.push({ ...l, rowRef: null });
      continue;
    }
    used.add(row.ref);
    const hire = parseScopeDurationWeeks(cellOf(row, "HIRE_WEEKS") ?? "");
    const lifts = liftsFromText(cellOf(row, "LIFTS"));
    const qty = firstNumber(cellOf(row, "QTY"));
    const len = firstNumber(cellOf(row, "L"));
    const height = parseScopeHeight(cellOf(row, "HEIGHT") ?? cellOf(row, "H") ?? "");
    // A plan-dimension cell ("2.4x5.4m", "560lin.m") becomes a quantity by the item's unit.
    const dimCell = cellOf(row, "DIMENSIONS");
    const unit = l.elementId ? unitById.get(l.elementId) : undefined;
    const fromDim = l.quantity == null && dimCell && unit ? quantityForUnit(parseScopeDimension(dimCell), unit) : null;
    const quantity = l.quantity ?? (qty != null && qty > 0 ? qty : len != null && len > 0 ? len : (fromDim?.quantity ?? null));
    out.push({
      ...l,
      clientText: l.clientText || row.text,
      itemRef: l.itemRef ?? cellOf(row, "REF"),
      location: l.location ?? cellOf(row, "LOCATION"),
      loadingRequirement: l.loadingRequirement ?? cellOf(row, "LOADING"),
      sheet: row.sheet,
      section: row.section ?? l.section,
      hireWeeks: hire ?? l.hireWeeks,
      lifts: lifts ?? l.lifts,
      heightM: height ?? l.heightM,
      quantity,
      quantityBasis:
        l.quantity == null && quantity != null
          ? fromDim && quantity === fromDim.quantity && !(qty != null && qty > 0) && !(len != null && len > 0)
            ? fromDim.basis
            : `${qty != null && qty > 0 ? "Quantity" : "l"} cell: ${quantity}`
          : l.quantityBasis,
      needsMeasurement: quantity == null && l.statedCount == null,
    });
  }
  for (const row of rows.values()) {
    if (used.has(row.ref)) continue;
    out.push({
      clientText: row.text,
      rowRef: row.ref,
      sheet: row.sheet,
      section: row.section,
      statedCount: countInWording(row.text),
      needsMeasurement: true,
      itemRef: cellOf(row, "REF"),
      location: cellOf(row, "LOCATION"),
      hireWeeks: parseScopeDurationWeeks(cellOf(row, "HIRE_WEEKS") ?? ""),
      heightM: parseScopeHeight(cellOf(row, "HEIGHT") ?? ""),
      loadingRequirement: cellOf(row, "LOADING"),
      quantityBasis: null,
      elementId: null,
      quantity: null,
      lifts: liftsFromText(cellOf(row, "LIFTS")),
      note: "The reader returned nothing for this row — map it by hand.",
      confidence: "low",
      reason: null,
      invented: false,
    });
  }
  // Keep the schedule's own order.
  const order = (l: ReconciledDraftLine) => {
    const r = l.rowRef ? rows.get(l.rowRef) : undefined;
    return r ? r.row + (tables.find((t) => t.sheet === r.sheet)?.sheetIndex ?? 0) * 100000 : Number.MAX_SAFE_INTEGER;
  };
  return out.map((l, i) => ({ l, i })).sort((a, b) => order(a.l) - order(b.l) || a.i - b.i).map((x) => x.l);
}

/**
 * Keep only section headings the scope actually prints — the reader must not make one
 * up for free text ("Email scope"). Applied to fresh and cached reads alike.
 */
export function keepPrintedSections(
  lines: ReconciledDraftLine[],
  sections: string[],
  scopeText: string,
): { lines: ReconciledDraftLine[]; sections: string[] } {
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, " ").trim();
  const text = norm(scopeText);
  const printed = (h: string | null) => h != null && h.trim() !== "" && text.includes(norm(h));
  return {
    lines: lines.map((l) => (l.section && !printed(l.section) ? { ...l, section: null } : l)),
    sections: sections.map((x) => x.trim()).filter(printed),
  };
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
