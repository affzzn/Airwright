/**
 * Name/code normalisation + similarity for the House-Type Bank matcher (docs/20 §4).
 *
 * The name is only a HINT that surfaces a candidate — geometry decides identity
 * (match.ts). So this need only be good enough to raise a candidate once; a human
 * confirms and the alias is then learned for an exact hit next time. Pure + tested.
 */

import { cleanHouseTypeName, cleanHouseTypeCode } from "@/lib/extract/houseTypeIdentity";

// Tokens that describe a plot-level VARIANT of the same type, not a different type
// — stripped before comparing names so "Denton LH" and "Denton (end)" match "Denton".
const VARIANT_TOKENS = new Set([
  // handing
  "lh", "rh", "left", "right", "handed", "handing", "mirror", "mirrored", "reverse", "reversed", "as", "drawn", "opposite", "opp", "hand",
  // configuration / position
  "det", "detached", "semi", "end", "mid", "terrace", "terraced", "link", "linked",
  // garage / extras
  "garage", "garages", "integral", "detachedgarage", "plot", "plots", "affordable", "aff", "social",
]);

/** Normalise a house-type name to a comparable stem: lower-cased, noise + variant tokens stripped. */
export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return "";
  // Reuse the file-noise cleaner (rev/issue/working-drawings/leading numbers), then
  // reduce to alphanumeric tokens and drop the variant vocabulary.
  const cleaned = cleanHouseTypeName(raw).toLowerCase();
  const tokens = cleaned
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !VARIANT_TOKENS.has(t));
  return tokens.join(" ").trim();
}

/** Normalise a code to just the identifier (reuses the shared cleaner), lower-cased. */
export function normalizeCode(raw: string | null | undefined): string | null {
  const c = cleanHouseTypeCode(raw);
  return c ? c.toLowerCase().replace(/\s+/g, "") : null;
}

function tokens(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

/** Jaccard similarity over the token sets (order-independent). */
export function tokenJaccard(a: string, b: string): number {
  const sa = new Set(tokens(a));
  const sb = new Set(tokens(b));
  if (sa.size === 0 && sb.size === 0) return 1;
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Levenshtein edit distance (iterative, O(n·m) space-optimised). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

/** Edit-distance similarity ratio in [0,1] over the space-collapsed stems. */
export function levenshteinRatio(a: string, b: string): number {
  const x = a.replace(/\s+/g, "");
  const y = b.replace(/\s+/g, "");
  const max = Math.max(x.length, y.length);
  if (max === 0) return 1;
  return 1 - levenshtein(x, y) / max;
}

/** Is one token sequence a leading prefix of the other? ("denton" vs "denton grande") */
export function isTokenPrefix(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((t, i) => t === long[i]);
}

export interface NameSimilarity {
  /** Best similarity score in [0,1]. */
  score: number;
  /** One stem is a leading prefix of the other (a strong "same family" signal). */
  prefix: boolean;
  /** The stems are identical after normalisation. */
  exact: boolean;
}

/** Compare two already-normalised name stems. */
export function nameSimilarity(a: string, b: string): NameSimilarity {
  if (a.length === 0 || b.length === 0) return { score: 0, prefix: false, exact: false };
  const exact = a === b;
  const prefix = isTokenPrefix(a, b);
  const score = Math.max(tokenJaccard(a, b), levenshteinRatio(a, b), prefix ? 0.9 : 0);
  return { score: exact ? 1 : score, prefix, exact };
}
