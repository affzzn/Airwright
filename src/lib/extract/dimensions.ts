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
