/**
 * "One file = one whole house type" detection (pure, no I/O).
 *
 * The cross-file AI grouping (docs/17) exists to solve a hard problem: loose
 * single-page PDFs scattered across trade folders. But the common, simple upload
 * is the opposite — a single multi-page PDF, or a folder of them, where each file
 * already IS a complete house type (Miller/Bloor "Combined Working Drawings"). For
 * that shape the AI recipe is pure overhead and, worse, unreliable: on Miller
 * filenames it collapsed 18 house types into 2. This module detects that shape so
 * the worker can take a deterministic fast path (one house type per file, extracted
 * straight from the original PDF) — while tolerating the junk files (block/site
 * plans, specs, materials) real packs always carry.
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
 * A file carries a whole house-type drawing SET (as opposed to a single loose
 * sheet, or a non-house-type auxiliary like a block/site plan, spec or materials
 * schedule). Heuristic, tuned on real Miller/Bloor packs:
 *   - it must show a face (a relevant ELEVATION), and
 *   - it must be a set: it carries its floor plan too, OR ≥ 3 relevant sheets
 *     (catches a house type whose floor plan was mis-classified — e.g. a "M+E
 *     services layout" GF plan — but still has several elevations/sections), and
 *   - it must NOT be a big booklet with only a few relevant pages (a construction
 *     spec / standard-details booklet that happens to include an elevation detail).
 */
export function isHouseTypeFile(pages: DetectionPage[]): boolean {
  const relevant = pages.filter((p) => p.relevant);
  const hasElevation = relevant.some((p) => p.kind === "ELEVATION");
  if (!hasElevation) return false;

  // A booklet/spec (many pages, few relevant) is not a house type.
  const total = pages.length;
  if (total >= 40 && relevant.length / total < 0.2) return false;

  const hasFloorPlan = relevant.some((p) => p.kind === "FLOOR_PLAN");
  return hasFloorPlan || relevant.length >= 3;
}

/** Strict self-contained set: a relevant elevation AND a relevant floor plan. */
export function isSelfContainedType(pages: DetectionPage[]): boolean {
  const relevant = pages.filter((p) => p.relevant);
  return (
    relevant.some((p) => p.kind === "ELEVATION") &&
    relevant.some((p) => p.kind === "FLOOR_PLAN")
  );
}

/** The documents that are whole house-type drawing sets (the fast path extracts these). */
export function houseTypeDocs<T extends DetectionDoc>(docs: T[]): T[] {
  return docs.filter((d) => d.isReadable && !d.isRasterOnly && isHouseTypeFile(d.pages));
}

/**
 * True when the pack is the "one file per house type" shape and can skip cross-file
 * grouping: there is at least one whole house-type drawing set, no two of them are
 * config/handing variants of the SAME type, and the remaining drawing files (loose
 * single sheets or auxiliaries) do NOT outnumber the house-type files.
 *
 * Fires for a single combined PDF and a folder of per-type combined PDFs even when
 * mixed with junk (Miller/Bloor: block/site plans, specs, materials are ignored).
 * Deliberately does NOT fire for loose single-sheet packs (Vistry/Tilia — no file is
 * a whole set) or variant-split packs (Taylor Wimpey — sibling END/MID files share a
 * variant key), which still need the cross-file AI grouping that collapses variants.
 */
export function isOneFilePerType(docs: DetectionDoc[]): boolean {
  const drawings = docs.filter(
    (d) => d.isReadable && !d.isRasterOnly && d.pages.some((p) => p.relevant),
  );
  const houseTypes = drawings.filter((d) => isHouseTypeFile(d.pages));
  if (houseTypes.length === 0) return false; // loose-sheet pack → AI grouping

  // Two house-type files that collapse to the same variant key are variants of one
  // type (END/MID/affordable/handing) → the AI grouping must collapse them.
  const keys = houseTypes.map((d) => variantStrippedKey(baseNameOf(d.relativePath ?? d.fileName)));
  if (new Set(keys).size !== keys.length) return false;

  // If loose single sheets / auxiliaries dominate, this is a pack that needs
  // grouping, not a clean per-file pack.
  const others = drawings.filter((d) => !isHouseTypeFile(d.pages));
  if (others.length > houseTypes.length) return false;

  return true;
}

/**
 * A clean house-type name from a combined-PDF filename — the fallback when the
 * title block carried no house-type name (Bloor/Tilia NSS sheets often don't;
 * Miller sheets DO, so this rarely fires for Miller). Strips a "-full"
 * dossier-export suffix, revision/issue tokens and a leading portfolio code:
 *   "301_LAWRENCE_ISSUE_7.1"  → "LAWRENCE"
 *   "2B4P_SINCLAIR_ISSUE_4.3" → "SINCLAIR"
 *   "SM1 SM2-full"            → "SM1 SM2"
 * The take-off extractor later adopts the real name off the drawing (persist.ts).
 */
export function houseTypeNameFromFileName(fileName: string): string {
  const original = baseNameOf(fileName);
  let s = original.replace(/^\s*\d+\.\s*/, "").replace(/[-_ ]?\bfull\b/i, "");
  // Normalise separators + strip revisions/config first (→ UPPERCASE, space-joined),
  // so the boilerplate strip below isn't foiled by an "_" separator (\b won't fire
  // next to "_", which counts as a word char).
  s = variantStrippedKey(s);
  s = s
    .replace(/\bCOMBINED\s+WORKING\s+DRAWINGS\b/, "") // Miller boilerplate
    .replace(/\bWORKING\s+DRAWINGS\b/, "")
    .replace(/\bSEMI\s+DETACHED\s+VARIANT\b/, "")
    .replace(/^\s*[A-Z]?\d[\dA-Z]*[ _]+/, "") // leading simple code: "301 " / "2B4P " / "B12 " / "250814 "
    .replace(/\bREV\s+[A-Z0-9]+\b/g, ""); // trailing "REV B"
  s = s.replace(/\s+/g, " ").trim();
  return s || original.toUpperCase();
}
