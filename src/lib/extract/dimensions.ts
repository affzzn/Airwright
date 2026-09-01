/**
 * Text-layer dimension helpers — PURE (no pdfjs), safe to import anywhere.
 *
 * A tender PDF carries an invisible text layer with the EXACT printed dimension
 * numbers (10660, 7904, 302…). We use it two ways:
 *   1. buildDimensionHint  — feed those numbers to the model as a per-page
 *      candidate list, so it snaps its reading to a real printed string instead
 *      of re-reading digits off the linework (prevents transposed/dropped digits).
 *   2. makeDimensionVerifier — after extraction, check that a value's cited
 *      sourceDimension actually appears in the text layer; if not, flag it
 *      (catches hallucinated / misread digits).
 *
 * The pdfjs-based reader that produces `PageDims` lives in classify.ts
 * (worker-only). This module only consumes that plain data.
 */

export interface PageDims {
  /** 1-based page number WITHIN the sliced PDF the model is shown. */
  page: number;
  /** Distinct 3–5 digit numbers present in that page's text layer. */
  tokens: string[];
}

/** Every 3–5 digit run in a string (scaffold dims are ~3–5 digit millimetres). */
const DIM_RE = /\d{3,5}/g;

/** The numeric runs in a cited dimension string, tolerant of "7.904" / "7904 / 302". */
export function dimRuns(dim: string): string[] {
  const raw = dim.match(DIM_RE) ?? [];
  // Also try a separator-stripped form so "7.904" → "7904" still matches.
  const stripped = dim.replace(/[.,\s]/g, "").match(DIM_RE) ?? [];
  return [...new Set([...raw, ...stripped])];
}

/**
 * The per-page candidate list appended to the user message. Empty string when
 * there is no text layer (scanned PDF) — then we simply don't add a hint.
 */
export function buildDimensionHint(pages: PageDims[]): string {
  const withTokens = pages.filter((p) => p.tokens.length > 0);
  if (withTokens.length === 0) return "";
  const lines = withTokens.map(
    // Cap per page so a busy sheet can't blow up the prompt.
    (p) => `Page ${p.page}: ${p.tokens.slice(0, 80).join(", ")}`,
  );
  return `

PRINTED DIMENSIONS FROM THE PDF TEXT LAYER
These are the exact numeric strings present on each attached page (millimetres unless obviously otherwise). When you read a dimension off the drawing, SNAP your value to the matching exact string below rather than reading the digits off the linework — this avoids transposed or dropped digits, and you must quote that exact string in sourceDimension. They are UNLABELLED (they include window sizes, floor levels, brick courses, etc.), so YOU still decide what each number measures and which page it is on; use the list only to get the digits right. If a value you need is genuinely not in the list, read it as best you can and lower the confidence.
${lines.join("\n")}`;
}

/**
 * Build a verifier that checks whether a cited sourceDimension really exists in
 * the text layer. Returns a function `(dim, sourcePage) => boolean`:
 *   - no text layer at all      → always true (can't verify → never flag)
 *   - null/blank or no numbers   → true (nothing numeric to check)
 *   - otherwise                  → true iff one of the dim's numeric runs is on
 *                                  the cited page (or anywhere, as a fallback)
 * Lenient by design: it exists to catch clearly-invented numbers, not to
 * second-guess a correct value formatted oddly.
 */
export function makeDimensionVerifier(
  pages: PageDims[],
): (dim: string | null | undefined, sourcePage?: number | null) => boolean {
  const all = new Set<string>();
  const byPage = new Map<number, Set<string>>();
  for (const p of pages) {
    const s = byPage.get(p.page) ?? new Set<string>();
    for (const t of p.tokens) {
      s.add(t);
      all.add(t);
    }
    byPage.set(p.page, s);
  }
  const hasText = all.size > 0;

  return (dim, sourcePage) => {
    if (!hasText) return true;
    if (!dim) return true;
    const runs = dimRuns(dim);
    if (runs.length === 0) return true;
    const pageSet =
      sourcePage != null ? byPage.get(sourcePage) : undefined;
    return runs.some((r) => pageSet?.has(r) || all.has(r));
  };
}

// --- Internal ↔ overall role reconciliation (birdcage) ----------------------
//
// The model sometimes files a printed INTERNAL span (the middle of a
// `[wall | span | wall]` line) into `overallWidthM`/`overallDepthM`, so the
// engine strips walls it shouldn't and the area comes out too small (or the
// reverse). We catch that deterministically against the printed dimension
// tokens, using the identity `internal + 2·wall = overall`.

import type { BirdcageRectInput } from "./birdcage";

const posn = (x: number | null | undefined): number | null => (x != null && x > 0 ? x : null);

/**
 * A matcher over every printed 3–5 digit dimension (in mm), tolerant of ±`tol`
 * mm (walls sum to the overall exactly, but allow rounding). Null pages → a
 * matcher that always returns false (no text layer → we can't reconcile).
 */
export function makeTokenMatcher(pages: PageDims[] | undefined, tol = 2): (mm: number) => boolean {
  const nums: number[] = [];
  for (const p of pages ?? [])
    for (const t of p.tokens) {
      const n = Number(t);
      if (Number.isFinite(n)) nums.push(n);
    }
  if (nums.length === 0) return () => false;
  return (mm) => nums.some((n) => Math.abs(n - mm) <= tol);
}

/** The two walls on an axis, summed (mm) — mirrors birdcage.ts `resolveAxisWalls`
 *  (prefer the printed plan/per-side walls; the legend finished-face wall only if
 *  no plan wall is given). null when the axis has no usable wall. */
function axisWallSumMm(
  side1: number | null | undefined,
  side2: number | null | undefined,
  legacy: number | null | undefined,
  legend: number | null | undefined,
): number | null {
  const s1 = posn(side1), s2 = posn(side2), lg = posn(legacy), leg = posn(legend);
  if (s1 != null || s2 != null || lg != null) {
    const a = s1 ?? s2 ?? lg;
    const b = s2 ?? s1 ?? lg;
    if (a != null && b != null) return a + b;
  }
  if (leg != null) return leg * 2;
  return null;
}

export interface RectRoleFix {
  rect: BirdcageRectInput;
  notes: string[];
}

/**
 * Reconcile a birdcage rectangle's internal/overall roles against the printed
 * dimensions. Two-sided so it can't misfire:
 *   - an axis reported ONLY as `overall` (+ a wall) whose `overall + 2·wall` IS
 *     printed but `overall − 2·wall` is NOT → the "overall" is really the
 *     internal → move it to `internal`, set the true overall to `overall + 2·wall`.
 *   - an axis reported ONLY as `internal` whose `internal − 2·wall` IS printed but
 *     `internal + 2·wall` is NOT → the "internal" is really the overall → move it
 *     to `overall` (the engine then strips to the real internal).
 * A genuine overall (its `−2·wall` internal is printed) or genuine internal (its
 * `+2·wall` overall is printed) is left untouched. Returns the corrected rect +
 * one note per axis it changed.
 */
export function reconcileRectRoles(
  rect: BirdcageRectInput,
  isPrinted: (mm: number) => boolean,
): RectRoleFix {
  const out: BirdcageRectInput = { ...rect };
  const notes: string[] = [];

  const fix = (
    axis: "width" | "depth",
    overall: number | null | undefined,
    internal: number | null | undefined,
    wallSum: number | null,
  ): { internalM?: number | null; overallM?: number | null } | null => {
    if (wallSum == null) return null;
    const o = posn(overall);
    const i = posn(internal);
    // Case A: overall-only, but it's actually the internal span.
    if (o != null && i == null) {
      const oMm = Math.round(o * 1000);
      if (isPrinted(oMm + wallSum) && !isPrinted(oMm - wallSum)) {
        notes.push(`${axis}: reported overall ${oMm}mm is the INTERNAL span (overall ${oMm + wallSum}mm is printed, ${oMm - wallSum}mm is not) — used directly`);
        return { internalM: o, overallM: (oMm + wallSum) / 1000 };
      }
    }
    // Case B: internal-only, but it's actually the overall envelope.
    if (i != null && o == null) {
      const iMm = Math.round(i * 1000);
      if (isPrinted(iMm - wallSum) && !isPrinted(iMm + wallSum)) {
        notes.push(`${axis}: reported internal ${iMm}mm is the OVERALL envelope (internal ${iMm - wallSum}mm is printed, ${iMm + wallSum}mm is not) — walls stripped`);
        return { internalM: null, overallM: i };
      }
    }
    return null;
  };

  const wFix = fix("width", rect.overallWidthM, rect.internalWidthM, axisWallSumMm(rect.wallWidthLeftMm, rect.wallWidthRightMm, rect.wallThicknessMm, rect.legendWallThicknessMm));
  if (wFix) {
    if ("internalM" in wFix) out.internalWidthM = wFix.internalM;
    if ("overallM" in wFix) out.overallWidthM = wFix.overallM;
  }
  const dFix = fix("depth", rect.overallDepthM, rect.internalDepthM, axisWallSumMm(rect.wallDepthFrontMm, rect.wallDepthRearMm, rect.wallThicknessMm, rect.legendWallThicknessMm));
  if (dFix) {
    if ("internalM" in dFix) out.internalDepthM = dFix.internalM;
    if ("overallM" in dFix) out.overallDepthM = dFix.overallM;
  }

  return { rect: out, notes };
}
