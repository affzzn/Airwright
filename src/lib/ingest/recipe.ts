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
  folderMarker: z.string().nullish(), // for folder-after-marker
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

/** house type = the folder that directly contains the file. */
function folderParent(rp: string): string | null {
  const parts = seg(rp);
  if (parts.length < 2) return null;
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
  const marker = recipe.folderMarker?.trim() || null;
  const combinedFolder = recipe.combinedPdfFolder?.trim() || null;

  const houseTypeFromPath = (rp: string): string | null => {
    const parts = seg(rp);
    switch (recipe.strategy) {
      case "folder-parent":
        return folderParent(rp);
      case "folder-after-marker": {
        if (!marker) return folderParent(rp);
        const i = parts.findIndex((p) => ciEq(p, marker));
        if (i === -1 || i + 1 > parts.length - 2) return null; // must have a folder child (not the file)
        const type = parts[i + 1];
        return BUCKET_RX.test(type) ? null : norm(type);
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
