/**
 * Cross-file grouping engine (pure, no I/O) — `docs/17-smart-upload-and-grouping.md`.
 *
 * Takes every file in an uploaded pack (each with its classified pages) plus the
 * grouping recipe (a builder profile, hand-written or AI-inferred), and groups
 * EVERY file into HOUSE TYPES that may span many files. Relevance is a per-page
 * TAG (§5), not a grouping filter: the combined PDF per house type is the complete
 * dossier (every page of every file for that type); the tag says which pages the
 * extractor reads and the review preview shows.
 *
 * Doctrine (same as birdcage/height): read multiple signals — folder, filename,
 * title block — reconcile in code, and flag (never silently drop) anything
 * unresolved. Every file is accounted for exactly once; the latest revision of a
 * sheet wins; nothing is guessed.
 */

import {
  parsePath,
  revisionStrippedKey,
  variantStrippedKey,
  canonicalPageRole,
  type DrawingKind,
} from "./parsePath";
import { isIgnoredPath, type BuilderIngestProfile } from "./profiles";

/** One classified page of a source file (from `classify.ts`). */
export interface IngestPage {
  page: number; // 1-based within the file
  relevant: boolean; // scaffold-relevant (drives extraction + preview)
  houseTypeName?: string | null; // title-block name, if the classifier read one
  sheetTitle?: string | null; // title-block drawing title — drives canonical-role dedup
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
  relevant: boolean; // scaffold-relevant tag for this page
  sheetTitle?: string | null; // title-block drawing title (for canonical-role dedup)
}

export interface HouseTypeGrouping {
  name: string;
  pages: GroupedPage[]; // ordered for assembly: relevant pages first, then the rest
  files: string[]; // distinct source relative paths, for display
  relevantPageCount: number;
  totalPageCount: number;
  confidence: "high" | "medium" | "low";
  flags: string[];
}

export interface GroupingResult {
  builderId: string | null;
  groups: HouseTypeGrouping[];
  /** Files with no resolvable house type (site/block plans, registers) — pack-level, not in any dossier. */
  unplacedFiles: string[];
  /** True when there is no recipe at all (→ AI structure pass, docs/17 §4). */
  needsLlmFallback: boolean;
}

/** Assembly reading order for the RELEVANT block (mirrors the extractor, docs/13 §1). */
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

const isAffordable = (baseName: string): boolean => /\baffordable\b/i.test(baseName);

interface Candidate {
  file: IngestFile;
  name: string;
  parsed: ReturnType<typeof parsePath>;
  junkFile: boolean; // in an ignored folder / matches an ignore pattern → pages forced not-relevant
  dedupeKey: string; // revision-stripped identity, for latest-wins dedupe
  revisionOrder: number;
}

/**
 * Group an uploaded pack into house types (group everything; relevance is a tag).
 *
 * @param files  EVERY file in the pack (relevant or junk), with its pages
 * @param profile the grouping recipe (hand profile or AI-compiled), or null
 */
export function groupPack(
  files: IngestFile[],
  profile: BuilderIngestProfile | null,
): GroupingResult {
  if (!profile) {
    return {
      builderId: null,
      groups: [],
      unplacedFiles: files.map((f) => f.relativePath),
      needsLlmFallback: true,
    };
  }

  const unplacedFiles: string[] = [];
  const candidates: Candidate[] = [];

  for (const file of files) {
    // Resolve the house-type identity for EVERY file (junk included — it still
    // belongs in that house type's dossier, just tagged not-relevant).
    const name = profile.grouping.houseTypeFromPath(file.relativePath);
    if (!name) {
      // No house type → a pack-level file (site/block plan, register). Not in a dossier.
      unplacedFiles.push(file.relativePath);
      continue;
    }
    const parsed = parsePath(file.relativePath);
    candidates.push({
      file,
      name,
      parsed,
      // A junk-folder / junk-file: its pages never count as relevant, even if the
      // page classifier false-positived one (belt-and-braces for combined-pdf packs).
      junkFile: isIgnoredPath(profile, file.relativePath),
      dedupeKey: revisionStrippedKey(parsed.baseName),
      revisionOrder: parsed.revision?.order ?? 0,
    });
  }

  // Group by house type; latest-revision-wins within each (collapse candidates
  // whose revision-stripped identity matches, keeping the highest revision order).
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

    // Config-variant collapse for the EXTRACTION pages: keep ONE file per
    // variant-stripped identity (prefer non-affordable) so a house type shipped in
    // END/MID/affordable variants isn't read four times over. ALL variants remain
    // in `files` (→ the full dossier); only the primary contributes eager pages.
    const primaryByVariant = new Map<string, Candidate>();
    for (const c of chosen) {
      const vk = variantStrippedKey(c.parsed.baseName);
      const prev = primaryByVariant.get(vk);
      if (!prev || (isAffordable(prev.parsed.baseName) && !isAffordable(c.parsed.baseName))) {
        primaryByVariant.set(vk, c);
      }
    }
    const primaryIds = new Set([...primaryByVariant.values()].map((c) => c.file.documentId));
    const variantsDropped = chosen.length - primaryByVariant.size;

    // Collect the pages of the PRIMARY-variant files; tag relevance per page.
    const pages: GroupedPage[] = [];
    for (const c of chosen) {
      if (!primaryIds.has(c.file.documentId)) continue; // non-primary variant → dossier only
      const kind = c.parsed.drawingKind === "UNKNOWN" ? "ELEVATION" : c.parsed.drawingKind;
      for (const p of c.file.pages) {
        pages.push({
          documentId: c.file.documentId,
          relativePath: c.file.relativePath,
          page: p.page,
          drawingKind: kind,
          relevant: p.relevant && !c.junkFile,
          sheetTitle: p.sheetTitle ?? null,
        });
      }
    }

    // Canonical-role dedup for the EXTRACTION set: inside a combined
    // working-drawings PDF the same face / plan / section repeats across material
    // and handing options, so its relevant page count balloons past the ~10-14 a
    // take-off needs. Keep ONE relevant page per canonical role (render kept apart
    // from plain — it carries the render meterage); demote the duplicates to
    // dossier-only (relevant = false, still present in `pages`). Pages whose role
    // can't be positively identified are left relevant (recall > precision).
    const primaryByRole = new Map<string, GroupedPage>();
    let duplicatePagesDropped = 0;
    for (const p of pages) {
      if (!p.relevant) continue;
      const role = canonicalPageRole(p.sheetTitle ?? "");
      if (!role) continue;
      const prev = primaryByRole.get(role);
      if (!prev) {
        primaryByRole.set(role, p);
        continue;
      }
      // Keep the earlier page (stable); demote the other to dossier-only.
      if (prev.page <= p.page) {
        p.relevant = false;
      } else {
        prev.relevant = false;
        primaryByRole.set(role, p);
      }
      duplicatePagesDropped++;
    }

    // Ordering: relevant pages FIRST (so the extraction range is a clean 1-k block
    // and the preview is trivial), then by reading order, then page number.
    pages.sort(
      (a, b) =>
        Number(b.relevant) - Number(a.relevant) ||
        orderOf(a.drawingKind) - orderOf(b.drawingKind) ||
        a.page - b.page,
    );

    const relevantPageCount = pages.filter((p) => p.relevant).length;

    const flags: string[] = [];
    if (relevantPageCount === 0)
      flags.push("No scaffold-relevant pages found — check the grouping before extracting.");
    if (variantsDropped > 0)
      flags.push(
        `${variantsDropped} config/handing variant(s) set aside for extraction (still in the full dossier) — confirm which plot uses which.`,
      );

    // Confidence is judged on real warnings only; the routine role-dedup below is
    // informational (a normal combined-PDF collapse), so it must not downgrade.
    const confidence = confidenceFor(chosen.length, relevantPageCount, flags);
    if (duplicatePagesDropped > 0)
      flags.push(
        `${duplicatePagesDropped} duplicate variant page(s) set aside for extraction (kept in the full dossier).`,
      );

    groups.push({
      name,
      pages,
      files: [...new Set(chosen.map((c) => c.file.relativePath))],
      relevantPageCount,
      totalPageCount: pages.length,
      confidence,
      flags,
    });
  }

  groups.sort((a, b) => a.name.localeCompare(b.name));

  return {
    builderId: profile.id,
    groups,
    unplacedFiles,
    needsLlmFallback: candidates.length === 0, // resolved nothing → unsure
  };
}

function confidenceFor(
  fileCount: number,
  relevantPageCount: number,
  flags: string[],
): "high" | "medium" | "low" {
  if (relevantPageCount === 0) return "low";
  if (flags.length > 0) return "medium";
  return relevantPageCount >= 3 || fileCount >= 3 ? "high" : "medium";
}
