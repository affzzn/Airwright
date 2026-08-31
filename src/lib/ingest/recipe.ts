/**
 * The grouping "recipe" (docs/17 §3-4): the small, bounded rule the AI infers for
 * a pack, which code then applies EXHAUSTIVELY to every file. The AI never places
 * files itself (that drops items); it only picks a strategy + a few constrained
 * parameters from a fixed vocabulary — no arbitrary regex — and `compileRecipe`
 * turns that into the same `BuilderIngestProfile` shape the hand profiles use, so
 * the deterministic `groupPack` apply path is unchanged.
 *
 * Pure, no I/O, unit-tested.
 */

import { z } from "zod";
import type { BuilderIngestProfile, GroupingStrategy } from "./profiles";

/** A house-type-identification strategy the AI can choose from (fixed vocabulary). */
export const recipeSchema = z.object({
  strategy: z.enum([
    "folder-parent", // house type = the folder that directly contains the file (Vistry, TW apartments)
    "folder-after-marker", // house type = the folder immediately after `folderMarker` (e.g. after "Scaffold")
    "filename-prefix", // house type = filename text before the sheet number (Tilia: "CROMFORD-201-…")
    "filename-name-token", // house type = the name word after a leading code, before a revision (Bloor: "372_BYRON_ISSUE_…")
    "combined-pdf", // house type = the folder above `combinedPdfFolder` (TW houses: "…/EMA21_Avonsford/00_House_Type_PDF/…")
  ]),
  folderMarker: z.string().nullish(), // for folder-after-marker (single); prefer folderMarkers
  folderMarkers: z.array(z.string()).nullish(), // for folder-after-marker — ALL marker regions
  combinedPdfFolder: z.string().nullish(), // for combined-pdf (e.g. "00_House_Type_PDF")
  junkFolderKeywords: z.array(z.string()).default([]), // a folder segment containing any → not-relevant
  junkFileKeywords: z.array(z.string()).default([]), // a filename containing any → not-relevant
  houseTypeNames: z.array(z.string()).default([]), // the distinct types the AI identifies (validation)
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
  reasoning: z.string().default(""),
});

export type Recipe = z.infer<typeof recipeSchema>;

const seg = (rp: string) => rp.split("/").filter(Boolean);
const ciEq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const norm = (s: string) => s.toUpperCase().replace(/[_\s]+/g, " ").trim();

/** Non-house-type folder buckets that a folder strategy must never treat as a type. */
const BUCKET_RX = /^(block plans?|site plans?|boundaries|engineer|garages|materials?)$/i;

function escapeRx(s: string): RegExp {
  return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

/**
 * Build a canonicaliser from the AI's `houseTypeNames` list. Filename-prefix packs
 * over-split when the same type shows up with slightly different prefixes
 * (`2B4P`/`2B4PN`, `SANDFORD`/`SANDFORD BOULEVARD`, `SM1 SM2`/`MAISONETTES`). The AI's
 * list is already de-duplicated, so we SNAP each raw key to the nearest canonical
 * name. Deterministic; the AI governs which names are distinct (an exact/longest
 * match wins, so `Cromford` and `Cromford Manor` stay separate if the AI lists both).
 */
function makeCanonicalizer(names: string[]): (raw: string) => string {
  const compact = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const canon = names
    .map((n) => ({ display: norm(n), c: compact(n) }))
    .filter((x) => x.c.length >= 3);
  if (canon.length === 0) return (raw) => raw;

  return (raw) => {
    const rc = compact(raw);
    if (rc.length < 3) return raw;
    let best: string | null = null;
    let bestScore = 0;
    for (const cand of canon) {
      let score = 0;
      if (cand.c === rc) score = 1000; // exact
      else if (cand.c.includes(rc)) score = 500 + rc.length; // raw ⊂ canonical (2B4P → 2B4PN)
      else if (rc.includes(cand.c)) score = 400 + cand.c.length; // canonical ⊂ raw (SANDFORD BOULEVARD → SANDFORD)
      if (score > bestScore) {
        bestScore = score;
        best = cand.display;
      }
    }
    return best ?? raw;
  };
}

/**
 * house type = the folder that directly contains the file. The folder must be
 * NESTED at least one level below the pack root (parts.length >= 3), so a loose
 * file sitting directly under the top pack folder is treated as pack-level, not a
 * bogus house type named after the whole pack.
 */
function folderParent(rp: string): string | null {
  const parts = seg(rp);
  if (parts.length < 3) return null;
  const folder = parts[parts.length - 2];
  if (BUCKET_RX.test(folder)) return null;
  return norm(folder);
}

/** house type = the filename text before the first sheet-number run ("-201-", " 201 "). */
function filenamePrefix(rp: string): string | null {
  const file = seg(rp).pop() ?? rp;
  const m = file.match(/^([A-Za-z0-9][A-Za-z0-9 _]*?)[-_\s]\d{3}[-_\s]/);
  if (m) return norm(m[1]);
  const m2 = file.match(/housetype\s+([A-Za-z0-9]+)/i);
  return m2 ? norm(m2[1]) : null;
}

/** house type = the alphabetic name token after a leading code, before a revision. */
function filenameNameToken(rp: string): string | null {
  const file = (seg(rp).pop() ?? rp).replace(/\.[^.]+$/, "");
  const m = file.match(/^[\w.]*?\d[\w.-]*?[_ ]+([A-Za-z][A-Za-z' ]+?)[_ ]+(?:issue|rev|ver)/i);
  if (m) return norm(m[1]);
  const m2 = file.match(/^[\d.\-]+[_ ]+([A-Za-z][A-Za-z' ]+)/);
  return m2 ? norm(m2[1]) : null;
}

/** Compile an AI recipe into the deterministic profile the grouping engine applies. */
export function compileRecipe(recipe: Recipe): BuilderIngestProfile {
  // A pack can have SEVERAL marker regions (e.g. houses under "Masonry" AND
  // apartments under "Apartment_Block_Type"). Merge the singular + array fields.
  const markers = [recipe.folderMarker, ...(recipe.folderMarkers ?? [])]
    .map((m) => m?.trim())
    .filter((m): m is string => Boolean(m));
  const combinedFolder = recipe.combinedPdfFolder?.trim() || null;
  const canonicalize = makeCanonicalizer(recipe.houseTypeNames);

  const rawFromPath = (rp: string): string | null => {
    const parts = seg(rp);
    switch (recipe.strategy) {
      case "folder-parent":
        return folderParent(rp);
      case "folder-after-marker": {
        if (markers.length === 0) return folderParent(rp);
        // Try every marker; the house type is the folder child of the first one
        // this path sits under. The child must be a folder (not the file itself).
        for (const marker of markers) {
          const i = parts.findIndex((p) => ciEq(p, marker));
          if (i !== -1 && i + 1 <= parts.length - 2) {
            const type = parts[i + 1];
            if (!BUCKET_RX.test(type)) return norm(type);
          }
        }
        return null;
      }
      case "filename-prefix":
        return filenamePrefix(rp);
      case "filename-name-token":
        return filenameNameToken(rp);
      case "combined-pdf": {
        if (combinedFolder) {
          const i = parts.findIndex((p) => ciEq(p, combinedFolder));
          if (i > 0) return norm(parts[i - 1]); // the folder above the combined-PDF folder
        }
        return folderParent(rp); // loose file (e.g. apartment GA pages)
      }
    }
  };

  // Snap the raw key to the nearest AI-canonical house-type name (collapses
  // filename over-splits); a no-op when the AI listed no names.
  const houseTypeFromPath = (rp: string): string | null => {
    const raw = rawFromPath(rp);
    return raw ? canonicalize(raw) : null;
  };

  const isCombinedPdf =
    recipe.strategy === "combined-pdf" && combinedFolder
      ? (rp: string) => seg(rp).some((p) => ciEq(p, combinedFolder))
      : undefined;

  return {
    id: "ai-inferred",
    label: "AI-inferred",
    detect: {},
    grouping: {
      strategy: recipe.strategy.startsWith("filename")
        ? "filename"
        : recipe.strategy === "combined-pdf"
          ? "combined-pdf"
          : ("folder" as GroupingStrategy),
      houseTypeFromPath,
      isCombinedPdf,
    },
    ignoreFolders: recipe.junkFolderKeywords.filter(Boolean).map(escapeRx),
    ignoreFilePatterns: recipe.junkFileKeywords.filter(Boolean).map(escapeRx),
  };
}
