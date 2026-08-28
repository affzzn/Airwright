/**
 * Per-builder ingest profiles (`docs/17-smart-upload-and-grouping.md` §6).
 *
 * A profile tells the grouping engine how ONE house-builder packages a tender
 * pack: how to recognise the builder, how to find the house-type identity for a
 * file (folder name / filename regex / a pre-combined PDF), which folders and
 * files are non-scaffold junk, and how config/plots fall out of the name.
 *
 * Deterministic + reliable for KNOWN builders (this file). An UNKNOWN builder
 * falls back to the LLM manifest reasoner (a separate hook) which also drafts a
 * new profile for a human to confirm — so onboarding a builder is cheap.
 *
 * Seeded from the four real packs in `data/first-ones-sent/` (gitignored):
 * Vistry Top Wighay, Bloor Oadby PH2A, Tilia Hawkesbury, Taylor Wimpey
 * Perryfields 2B. Pure — no I/O.
 */

export type GroupingStrategy = "folder" | "filename" | "combined-pdf";

export interface BuilderIngestProfile {
  id: string;
  label: string;

  /** Recognise the builder from the top folder name or any title-block text. */
  detect: {
    topFolderIncludes?: string[]; // matched case-insensitively against path segments
    titleIncludes?: string[];
  };

  /** How a file's house-type identity is resolved. */
  grouping: {
    strategy: GroupingStrategy;
    /**
     * Resolve the house-type key (name) for a relative path. Returns null when
     * this file is not a per-house-type drawing (site plan, block plan…).
     */
    houseTypeFromPath: (relativePath: string) => string | null;
    /**
     * combined-pdf only: does this path point at the pre-combined house-type
     * drawing to use directly (skipping page assembly)? e.g. TW's
     * `…/00_House_Type_PDF/…`.
     */
    isCombinedPdf?: (relativePath: string) => boolean;
  };

  /** Whole folders that are never scaffold-relevant (matched per path segment). */
  ignoreFolders: RegExp[];
  /** Individual files that are never relevant even in a kept folder. */
  ignoreFilePatterns: RegExp[];

  /** Two codes that are the same house type handed L/R (e.g. `470` vs `470-1`). */
  handedPairEquivalent?: (a: string, b: string) => boolean;
}

const seg = (relativePath: string) => relativePath.split("/").filter(Boolean);
const fileOf = (relativePath: string) => relativePath.split("/").pop() ?? relativePath;
const clean = (s: string) => s.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();

// ── Vistry — pre-curated `Scaffold/<TYPE>/…` subfolders. The folder IS the type.
const VISTRY: BuilderIngestProfile = {
  id: "vistry",
  label: "Vistry",
  detect: { topFolderIncludes: ["vistry"], titleIncludes: ["vistry"] },
  grouping: {
    strategy: "folder",
    houseTypeFromPath: (rp) => {
      const parts = seg(rp);
      const i = parts.findIndex((p) => /^scaffold$/i.test(p));
      if (i === -1 || i + 1 >= parts.length - 1) return null;
      const type = parts[i + 1];
      // Non-house-type buckets under Scaffold/.
      if (/^(block plans|site plans|boundaries|engineer|garages)$/i.test(type)) return null;
      return type.toUpperCase();
    },
  },
  ignoreFolders: [/^boundaries$/i, /^engineer$/i, /^site plans$/i],
  ignoreFilePatterns: [/materials?[ _]plan/i],
};

// ── Bloor — one multi-page combined PDF per type: `372_BYRON_ISSUE_4.13.pdf`,
//    `470-1_HALLAM_ISSUE_7.1.pdf`. Identity is in the filename; `-1` = handed pair.
const BLOOR: BuilderIngestProfile = {
  id: "bloor",
  label: "Bloor Homes",
  detect: { topFolderIncludes: ["bloor"], titleIncludes: ["bloor"] },
  grouping: {
    strategy: "filename",
    houseTypeFromPath: (rp) => {
      const name = clean(fileOf(rp));
      // <code>_<NAME>_ISSUE… or LM0042.807-1_LYTTELTON_BYRON_ISSUE_7
      const m = name.match(/^[\w.]*?\d[\w.-]*?[_ ]+([A-Za-z][A-Za-z' ]+?)[_ ]+issue/i);
      if (m) return m[1].toUpperCase().trim();
      const m2 = name.match(/^[\d.-]+[_ ]+([A-Za-z][A-Za-z' ]+)/);
      return m2 ? m2[1].toUpperCase().trim() : null;
    },
  },
  ignoreFolders: [],
  ignoreFilePatterns: [/materials?[ _]layout/i, /take[ _]?offs?/i],
  handedPairEquivalent: (a, b) => a === b, // names already match; codes carry the -1
};

// ── Tilia — flat folder, MANY types intermixed; the FILENAME PREFIX is the type:
//    `CROMFORD-201-03D Front Elevation Plots 4, 21…_Ver3.pdf`.
const TILIA: BuilderIngestProfile = {
  id: "tilia",
  label: "Tilia Homes",
  detect: { topFolderIncludes: ["tilia"], titleIncludes: ["tilia"] },
  grouping: {
    strategy: "filename",
    houseTypeFromPath: (rp) => {
      const file = fileOf(rp);
      // Prefix up to the first sheet-number token (e.g. "-201-" / " 201-").
      const m = file.match(/^([A-Za-z0-9]+?)[- ]\d{3}[- ]/);
      if (m) return m[1].toUpperCase();
      // Superstructure-detail sheets: "…Housetype CROMFORD_Ver2.pdf".
      const m2 = file.match(/housetype\s+([A-Za-z0-9]+)/i);
      return m2 ? m2[1].toUpperCase() : null;
    },
  },
  ignoreFolders: [],
  ignoreFilePatterns: [
    /m\+e/i,
    /schedule/i,
    /compliance/i,
    /m4\(2\)/i,
    /joist[ _]layout/i,
    /superstructure[ _]details/i, // structural detail sheet, not a scaffold drawing
    /typical[ _]superstructure/i,
    /take[ _]?offs?/i,
  ],
};

// ── Taylor Wimpey — deep trade tree; the real drawing is the combined PDF in
//    `…/<CODE>_<Type>/00_House_Type_PDF/…`. Apartments = a flat folder of loose
//    GA pages named `APARTMENT_BLOCK_*`.
const TAYLOR_WIMPEY: BuilderIngestProfile = {
  id: "taylor-wimpey",
  label: "Taylor Wimpey",
  detect: { topFolderIncludes: ["taylor wimpey", "wimpey"], titleIncludes: ["taylor wimpey"] },
  grouping: {
    strategy: "combined-pdf",
    houseTypeFromPath: (rp) => {
      const parts = seg(rp);
      // Apartment blocks: group by the SPECIFIC block folder
      // (APARTMENT_BLOCK_A_PLOTS_107_127), not the parent "Apartment_Block_Type"
      // category — so findLast (the deepest matching segment).
      const apt =
        parts.findLast((p) => /^apartment_block_[a-z]/i.test(p)) ??
        parts.findLast((p) => /^apartment_block/i.test(p));
      if (apt) return apt.toUpperCase();
      // Houses: the `<CODE>_<Type>` folder (e.g. EMA21_Avonsford) — its name.
      const typeFolder = parts.find((p) => /^em[abt]\d+_/i.test(p));
      return typeFolder ? typeFolder.toUpperCase() : null;
    },
    isCombinedPdf: (rp) => /(^|\/)00_house_type_pdf\//i.test(rp),
  },
  ignoreFolders: [
    /^0[1-9]_/, // 01_Substructure … 09_Lintels (except 00_House_Type_PDF)
    /^1[0-2]_/, // 10_Fitted_Furniture, 11_Ventilation, 12_…
    /kitchens?/i,
    /wardrobes?/i,
    /sap/i,
    /part_o/i,
    /ventilation/i,
    /heating/i,
    /lintels?/i,
    /stairs?/i,
    /structural_appraisal/i,
    /fitted_furniture/i,
    /metsawood/i,
    /symphony/i,
    /gooding/i,
  ],
  ignoreFilePatterns: [
    /take[ _]?offs?/i,
    /fire[ _]strategy/i,
    /customer[ _]plan/i,
    /pc[ _]plank/i,
    /kitchen[ _]layout/i,
    /bathroom[ _]layout/i,
    /en[ _-]?suite/i,
    /suppliers?[ _]information/i,
    /risk[ _]assessment/i,
    /indicative/i,
  ],
};

export const BUILDER_PROFILES: BuilderIngestProfile[] = [
  VISTRY,
  BLOOR,
  TILIA,
  TAYLOR_WIMPEY,
];

/**
 * Detect the builder from the pack's top-level folder name(s) and, if needed, a
 * sample of title-block text. Returns null when unknown (→ LLM fallback).
 */
export function detectBuilder(
  topFolders: string[],
  sampleTitles: string[] = [],
): BuilderIngestProfile | null {
  const folders = topFolders.map((f) => f.toLowerCase());
  const titles = sampleTitles.map((t) => t.toLowerCase());
  for (const p of BUILDER_PROFILES) {
    const byFolder = p.detect.topFolderIncludes?.some((k) =>
      folders.some((f) => f.includes(k)),
    );
    const byTitle = p.detect.titleIncludes?.some((k) => titles.some((t) => t.includes(k)));
    if (byFolder || byTitle) return p;
  }
  return null;
}

/** True if a path falls inside a folder this profile ignores. */
export function isIgnoredPath(profile: BuilderIngestProfile, relativePath: string): boolean {
  const parts = seg(relativePath);
  const folders = parts.slice(0, -1);
  if (folders.some((f) => profile.ignoreFolders.some((re) => re.test(f)))) return true;
  const file = parts[parts.length - 1] ?? "";
  return profile.ignoreFilePatterns.some((re) => re.test(file));
}
