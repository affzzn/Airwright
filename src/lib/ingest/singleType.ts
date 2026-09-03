/**
 * "One file = one whole house type" detection (pure, no I/O).
 *
 * The cross-file AI grouping (docs/17) exists to solve a hard problem: loose
 * single-page PDFs scattered across trade folders. But the common, simple upload
 * is the opposite — a single multi-page PDF (or a flat folder of them) where each
 * file already IS a complete house type. For that shape the AI recipe is pure
 * overhead and, worse, can pick a strategy that places nothing → an empty grouping
 * and a "stuck" pack. This module detects that shape so the worker can take a
 * deterministic fast path (one house type per file, extracted straight from the
 * original PDF) instead.
 */

import { baseNameOf, variantStrippedKey } from "./parsePath";

/** The minimal page shape the detection needs (mirrors a classified DocumentPage). */
export interface DetectionPage {
  kind: string; // PageKind: ELEVATION / FLOOR_PLAN / SECTION / …
  relevant: boolean;
}

/** The minimal document shape the detection needs. */
export interface DetectionDoc {
  isReadable: boolean;
  isRasterOnly: boolean;
  fileName: string;
  relativePath: string | null;
  pages: DetectionPage[];
}

/**
 * A file is a self-contained house type when it carries BOTH a relevant elevation
 * AND a relevant floor plan — i.e. a whole drawing set, not a single loose sheet
 * (one elevation, or one plan) that only makes sense grouped with its siblings.
 */
export function isSelfContainedType(pages: DetectionPage[]): boolean {
  const relevant = pages.filter((p) => p.relevant);
  const hasElevation = relevant.some((p) => p.kind === "ELEVATION");
  const hasFloorPlan = relevant.some((p) => p.kind === "FLOOR_PLAN");
  return hasElevation && hasFloorPlan;
}

/**
 * True when the pack is the "one file per house type" shape and can skip cross-file
 * grouping entirely: every drawing file (one with any scaffold-relevant page) is a
 * self-contained house type, and no two of them are config/handing variants of the
 * SAME type. Non-drawing files (answer-key / plot schedule / site plan — no relevant
 * pages) are ignored.
 *
 * Fires for a single combined PDF and a flat folder of per-type combined PDFs
 * (e.g. Bloor). Deliberately does NOT fire for loose single-sheet packs
 * (Vistry/Tilia — files aren't self-contained) or variant-split packs
 * (Taylor Wimpey — sibling END/MID files share a variant key), which still need
 * the cross-file AI grouping that collapses variants.
 */
export function isOneFilePerType(docs: DetectionDoc[]): boolean {
  const drawings = docs.filter(
    (d) => d.isReadable && !d.isRasterOnly && d.pages.some((p) => p.relevant),
  );
  if (drawings.length === 0) return false;
  if (!drawings.every((d) => isSelfContainedType(d.pages))) return false;

  // Two files that collapse to the same variant key are variants of one type
  // (END/MID/affordable/handing) → the AI grouping must handle them, not the fast
  // path (which would create duplicate house types).
  const keys = drawings.map((d) => variantStrippedKey(baseNameOf(d.relativePath ?? d.fileName)));
  return new Set(keys).size === keys.length;
}

/**
 * A clean house-type name from a combined-PDF filename — the fallback when the
 * title block carried no house-type name (Bloor/Tilia NSS sheets often don't).
 * Strips a "-full" dossier-export suffix, revision/issue tokens and a leading
 * portfolio code:
 *   "301_LAWRENCE_ISSUE_7.1"  → "LAWRENCE"
 *   "386_KILBURN_ISSUE_4.12"  → "KILBURN"
 *   "2B4P_SINCLAIR_ISSUE_4.3" → "SINCLAIR"
 *   "SM1 SM2-full"            → "SM1 SM2"
 * The take-off extractor later adopts the real name off the drawing (persist.ts),
 * so this only needs to be a sensible placeholder while it processes.
 */
export function houseTypeNameFromFileName(fileName: string): string {
  const original = baseNameOf(fileName);
  let s = original.replace(/[-_ ]?\bfull\b/i, ""); // dossier-export suffix
  s = variantStrippedKey(s); // strips ISSUE/Ver/Pnn/Cn + config tokens; uppercases
  s = s.replace(/^\s*[A-Z]?\d[\dA-Z]*\s+/, ""); // leading code: "301 " / "2B4P " / "386 "
  s = s.replace(/\s+/g, " ").trim();
  return s || original.toUpperCase();
}
