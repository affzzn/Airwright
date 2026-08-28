/**
 * Cross-file grouping engine (pure, no I/O) — `docs/17-smart-upload-and-grouping.md` §8.
 *
 * Takes every file in an uploaded pack (each with its classified pages) plus the
 * detected builder profile, and groups the scaffold-relevant pages into HOUSE
 * TYPES that may span many files. Emits, per house type, the ordered source
 * pages to assemble into one combined PDF, plus a computed confidence and flags.
 *
 * Doctrine (same as birdcage/height): read multiple signals — folder, filename,
 * title block — reconcile in code, compute confidence from agreement, and flag
 * (never silently drop) anything unresolved. Junk is excluded by profile; the
 * latest revision of a sheet wins; nothing is guessed.
 */

import {
  parsePath,
  revisionStrippedKey,
  RELEVANT_KINDS,
  type DrawingKind,
} from "./parsePath";
import { isIgnoredPath, type BuilderIngestProfile } from "./profiles";

/** One classified page of a source file (from `classify.ts`). */
export interface IngestPage {
  page: number; // 1-based within the file
  relevant: boolean; // relevant to a scaffold take-off
  houseTypeName?: string | null; // title-block name, if the classifier read one
}

/** One source file in the uploaded pack. */
export interface IngestFile {
  documentId: string;
  relativePath: string;
  pages: IngestPage[];
}

export interface GroupedPage {
  documentId: string;
  relativePath: string;
  page: number; // 1-based within the source file
  drawingKind: DrawingKind;
}

export interface HouseTypeGrouping {
  name: string;
  pages: GroupedPage[]; // ordered for assembly (reading order)
  files: string[]; // distinct source relative paths, for display
  confidence: "high" | "medium" | "low";
  flags: string[];
}

export interface GroupingResult {
  builderId: string | null;
  groups: HouseTypeGrouping[];
  ignoredFiles: string[];
  /** Relevant-looking files whose house type couldn't be resolved → need a human/LLM. */
  unplacedFiles: string[];
  /** True when there is no profile, or too many files went unplaced. */
  needsLlmFallback: boolean;
}

/** Assembly reading order (mirrors the extractor's reading order, docs/13 §1). */
const KIND_ORDER: DrawingKind[] = [
  "COMBINED",
  "FRONT_ELEVATION",
  "REAR_ELEVATION",
  "SIDE_ELEVATION",
  "GABLE_ELEVATION",
  "GA_ELEVATION",
  "ELEVATION",
  "FLOOR_PLAN",
  "SETTING_OUT",
  "SECTION",
  "ROOF",
  "UNKNOWN",
  "JUNK",
];
const orderOf = (k: DrawingKind) => {
  const i = KIND_ORDER.indexOf(k);
  return i === -1 ? KIND_ORDER.length : i;
};

interface Candidate {
  file: IngestFile;
  name: string;
  parsed: ReturnType<typeof parsePath>;
  /** revision-stripped identity, for latest-wins dedupe within a house type */
  dedupeKey: string;
  revisionOrder: number;
}

/**
 * Group an uploaded pack into house types.
 *
 * @param files  every relevant/irrelevant file in the pack, with classified pages
 * @param profile the detected builder profile, or null (→ LLM fallback)
 */
export function groupPack(
  files: IngestFile[],
  profile: BuilderIngestProfile | null,
): GroupingResult {
  if (!profile) {
    return {
      builderId: null,
      groups: [],
      ignoredFiles: [],
      unplacedFiles: files.map((f) => f.relativePath),
      needsLlmFallback: true,
    };
  }

  const ignoredFiles: string[] = [];
  const unplacedFiles: string[] = [];
  const candidates: Candidate[] = [];

  for (const file of files) {
    // 1. Drop whole-folder / whole-file junk per the profile.
    if (isIgnoredPath(profile, file.relativePath)) {
      ignoredFiles.push(file.relativePath);
      continue;
    }

    const parsed = parsePath(file.relativePath);

    // 2. combined-pdf builders: only the pre-combined drawing is used directly.
    if (profile.grouping.strategy === "combined-pdf") {
      const isCombined = profile.grouping.isCombinedPdf?.(file.relativePath) ?? false;
      if (!isCombined) {
        // A loose sheet in a combined-pdf pack (e.g. TW apartment GA pages) is
        // still usable if it's relevant; otherwise it's ignored.
        if (!fileHasRelevantPage(file, parsed.drawingKind)) {
          ignoredFiles.push(file.relativePath);
          continue;
        }
      }
    }

    // 3. Resolve the house-type identity for this file.
    const name = profile.grouping.houseTypeFromPath(file.relativePath);
    if (!name) {
      // A relevant-looking file we couldn't place → surface it, don't drop it.
      if (fileHasRelevantPage(file, parsed.drawingKind)) unplacedFiles.push(file.relativePath);
      else ignoredFiles.push(file.relativePath);
      continue;
    }

    candidates.push({
      file,
      name,
      parsed,
      dedupeKey: revisionStrippedKey(parsed.baseName),
      revisionOrder: parsed.revision?.order ?? 0,
    });
  }

  // 4. Latest-revision-wins within each house type: collapse candidates whose
  //    revision-stripped identity matches, keeping the highest revision order.
  const byName = new Map<string, Candidate[]>();
  for (const c of candidates) {
    (byName.get(c.name) ?? byName.set(c.name, []).get(c.name)!).push(c);
  }

  const groups: HouseTypeGrouping[] = [];
  for (const [name, cands] of byName) {
    const latest = new Map<string, Candidate>();
    for (const c of cands) {
      const prev = latest.get(c.dedupeKey);
      if (!prev || c.revisionOrder > prev.revisionOrder) latest.set(c.dedupeKey, c);
    }
    const chosen = [...latest.values()];

    // 5. Collect the relevant pages across the chosen files, in reading order.
    const pages: GroupedPage[] = [];
    for (const c of chosen) {
      const fileKind = c.parsed.drawingKind;
      for (const p of c.file.pages) {
        if (!p.relevant) continue;
        pages.push({
          documentId: c.file.documentId,
          relativePath: c.file.relativePath,
          page: p.page,
          // A single-drawing file's kind comes from its name; a combined PDF's
          // pages keep the file kind (per-page kind refined later by classify).
          drawingKind: fileKind === "UNKNOWN" ? "ELEVATION" : fileKind,
        });
      }
    }
    pages.sort(
      (a, b) => orderOf(a.drawingKind) - orderOf(b.drawingKind) || a.page - b.page,
    );

    const flags: string[] = [];
    if (pages.length === 0) flags.push("No relevant pages found for this house type.");
    if (chosen.some((c) => c.parsed.configHint))
      flags.push(
        `Config/handing variants present (${[
          ...new Set(chosen.map((c) => c.parsed.configHint).filter(Boolean)),
        ].join(", ")}) — confirm which plot uses which.`,
      );

    groups.push({
      name,
      pages,
      files: [...new Set(chosen.map((c) => c.file.relativePath))],
      confidence: confidenceFor(chosen.length, pages.length, flags),
      flags,
    });
  }

  groups.sort((a, b) => a.name.localeCompare(b.name));

  return {
    builderId: profile.id,
    groups,
    ignoredFiles,
    unplacedFiles,
    needsLlmFallback: unplacedFiles.length > candidates.length, // mostly unplaced → unsure
  };
}

function fileHasRelevantPage(file: IngestFile, fileKind: DrawingKind): boolean {
  return RELEVANT_KINDS.has(fileKind) || file.pages.some((p) => p.relevant);
}

function confidenceFor(
  fileCount: number,
  pageCount: number,
  flags: string[],
): "high" | "medium" | "low" {
  if (pageCount === 0) return "low";
  if (flags.length > 0) return "medium";
  // A house type with a healthy spread of sheets read cleanly is high confidence.
  return pageCount >= 3 || fileCount >= 3 ? "high" : "medium";
}
