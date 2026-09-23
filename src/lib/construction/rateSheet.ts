/**
 * Airwright's master rate sheet — the PURE parser (no Prisma, no IO).
 *
 * Airwright keep ONE item list for the whole business, exported from their
 * estimating system. The item TITLE carries the whole data model:
 *
 *   (A) Con Ind Scaff (6-12m max) M
 *    │   │   │         │           └── band:   H | M | C | SC
 *    │   │   │         └────────────── height bracket
 *    │   │   └──────────────────────── item family
 *    │   └──────────────────────────── business line: Con | TRAD | TF
 *    └──────────────────────────────── (A) current · (Z) legacy
 *
 * The band can sit before or after the bracket, "(per lift)" may appear in the
 * middle, and some items carry neither a band nor a bracket. This module turns a
 * title into structured fields; the importer groups them into elements + rates.
 */

import type { ConstructionUnit, HeightBracket, RateBand } from "./types";

export type BusinessLine = "CONSTRUCTION" | "TRADITIONAL" | "TIMBER_FRAME" | "GENERAL";

export interface ParsedRateTitle {
  /** The title exactly as Airwright wrote it. */
  raw: string;
  /** "(A)" is the current set, "(Z)" the legacy one. Untagged counts as current. */
  current: boolean;
  line: BusinessLine;
  /** The item name with the prefix, bracket and band stripped off. */
  family: string;
  /** null when the title carries no height bracket (the rate is bracket-agnostic). */
  bracket: HeightBracket | null;
  /** null when the title carries no band (one price for every band). */
  band: RateBand | null;
  /** True when the item is priced per lift ("(per lift)" in the name). */
  perLift: boolean;
}

const LINE_BY_TOKEN: Record<string, BusinessLine> = {
  CON: "CONSTRUCTION",
  TRAD: "TRADITIONAL",
  TF: "TIMBER_FRAME",
};

const BAND_BY_TOKEN: Record<string, RateBand> = {
  H: "HIGH",
  M: "MEDIUM",
  C: "COMPETITIVE",
  SC: "SUPER_COMPETITIVE",
};

/**
 * Normalise a bracket as Airwright write it. They use both "(6m max)" and
 * "(0-6m max)" for the same band, and TF uses "(6m - 12m)".
 */
export function parseHeightBracket(text: string): HeightBracket | null {
  const t = text.toLowerCase().replace(/\s+/g, "");
  const range = /(\d+(?:\.\d+)?)m?-(\d+(?:\.\d+)?)m/.exec(t);
  if (range) {
    const hi = Number(range[2]);
    if (hi <= 6) return "UP_TO_6M";
    if (hi <= 12) return "H6_12M";
    if (hi <= 18) return "H12_18M";
    if (hi <= 24) return "H18_24M";
    if (hi <= 30) return "H24_30M";
    return null;
  }
  const single = /^(\d+(?:\.\d+)?)mmax$/.exec(t);
  if (single) {
    const hi = Number(single[1]);
    if (hi <= 6) return "UP_TO_6M";
    if (hi <= 12) return "H6_12M";
    if (hi <= 18) return "H12_18M";
    if (hi <= 24) return "H18_24M";
    if (hi <= 30) return "H24_30M";
  }
  return null;
}

/** Everything in a title that looks like a height bracket, e.g. "(6-12m max)". */
const BRACKET_RE = /\(\s*\d+(?:\.\d+)?\s*m?\s*(?:-\s*\d+(?:\.\d+)?\s*m?)?\s*(?:max)?\s*\)/gi;

/**
 * Parse one item title. Returns null for a blank or structureless title, so the
 * importer can skip it rather than inventing an item.
 */
export function parseRateTitle(raw: string): ParsedRateTitle | null {
  const title = raw.replace(/\s+/g, " ").trim();
  if (!title) return null;

  let rest = title;
  let current = true;
  const prefix = /^\(([AZ])\)\s*/i.exec(rest);
  if (prefix) {
    current = prefix[1].toUpperCase() === "A";
    rest = rest.slice(prefix[0].length);
  }

  let line: BusinessLine = "GENERAL";
  const lineTok = /^(Con|TRAD|TF)\b\s*/i.exec(rest);
  if (lineTok) {
    line = LINE_BY_TOKEN[lineTok[1].toUpperCase()] ?? "GENERAL";
    rest = rest.slice(lineTok[0].length);
  }

  const perLift = /\(\s*per\s+lift\s*\)/i.test(rest);

  // Pull the bracket out wherever it sits, then look for a standalone band token
  // in what is left (Airwright put it before OR after the bracket).
  let bracket: HeightBracket | null = null;
  rest = rest.replace(BRACKET_RE, (m) => {
    const parsed = parseHeightBracket(m.slice(1, -1));
    if (parsed && !bracket) {
      bracket = parsed;
      return " ";
    }
    return m; // not a height bracket, e.g. "(2M Drop Max)" handled below
  });

  let band: RateBand | null = null;
  rest = rest.replace(/(^|\s)(SC|H|M|C)(?=\s|$)/g, (m, lead: string, tok: string) => {
    if (band) return m;
    band = BAND_BY_TOKEN[tok] ?? null;
    return band ? lead : m;
  });

  const family = rest
    .replace(/\s+/g, " ")
    .replace(/[!\s]+$/g, "")
    .trim();
  if (!family) return null;

  return { raw: title, current, line, family, bracket, band, perLift };
}

/** Airwright's "Measure" column plus the per-lift flag → our unit. */
export function unitFromMeasure(measure: string, perLift: boolean): ConstructionUnit {
  const m = measure.trim().toUpperCase();
  if (m === "LM") return perLift ? "LM_PER_LIFT" : "LM";
  if (m === "SQM" || m === "M2") return perLift ? "M2_PER_LIFT" : "M2";
  if (m === "EACH" || m === "NR") return perLift ? "NR_PER_LIFT" : "NR";
  return "FIXED"; // M3 and anything unexpected: priced as a lump, never guessed
}

const CATEGORY_RULES: [RegExp, string][] = [
  [/inspection|daywork|design|drawing|protection to transom|carpet/i, "Extras"],
  [/handrail|edge protection|toe board|netting|monarflex|sheeting|foam|fan|brick guard/i, "Protection"],
  [/birdcage|crash deck|internal|backprop|propping|punched up|suspended|temporary roof/i, "Internal"],
  [/haki|stair|ladder|loading bay|tower|chute|skip|hoist|access|gantry|bridge|bridging/i, "Access"],
  [/scaff|scaffold|beam|cantilever|adapt|hop up|boarding|mat|support rate|framework/i, "Access"],
];

/** A grouping for the picker. Falls back to "Extras" rather than inventing one. */
export function categoryFor(family: string): string {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(family)) return cat;
  return "Extras";
}

/** One row of Airwright's sheet, as the importer reads it. */
export interface RateSheetRow {
  title: string;
  measure: string;
  /** "Based on (Hire Period)" — weeks of hire the rate already includes. */
  baseHireWeeks: number | null;
  rate: number | null;
  /** "E/H Value" — £ per unit per week beyond the base hire period. */
  extraHirePerWeek: number | null;
  /** "%age to charge" — the percentage of E/H actually billed. */
  extraHireChargePct: number | null;
}

export interface ImportedRate {
  band: RateBand;
  bracket: HeightBracket;
  rate: number;
  baseHireWeeks: number;
  extraHirePerWeek: number;
  extraHireChargePct: number;
  /** True when the title named no band, so the price was copied across bands. */
  bandAssumed: boolean;
}

export interface ImportedElement {
  key: string; // line + family, stable across re-imports
  line: BusinessLine;
  name: string;
  family: string;
  category: string;
  unit: ConstructionUnit;
  usesLifts: boolean;
  usesHeightBracket: boolean;
  sourceTitle: string;
  rates: ImportedRate[];
}

export interface ImportResult {
  elements: ImportedElement[];
  skipped: { title: string; reason: string }[];
  /** Rows whose (element, band, bracket) collided; the explicit band wins. */
  collisions: number;
}

const ALL_BANDS: RateBand[] = ["HIGH", "MEDIUM", "COMPETITIVE", "SUPER_COMPETITIVE"];

/**
 * Turn the sheet's rows into elements + rates.
 *
 * - Only the CURRENT set is imported; "(Z)" legacy rows are skipped.
 * - A title with no band gets its price copied across every band (that is what a
 *   single price means), but an explicitly banded row always wins over a copy.
 * - A title with no bracket is stored as ANY, which the rate resolver falls back
 *   to, so a flat-rate item prices at any height.
 */
export function buildImport(rows: RateSheetRow[]): ImportResult {
  const byKey = new Map<string, ImportedElement>();
  const explicit = new Set<string>(); // `${key}|${band}|${bracket}` set from a banded title
  const skipped: { title: string; reason: string }[] = [];
  let collisions = 0;

  for (const row of rows) {
    const parsed = parseRateTitle(row.title);
    if (!parsed) {
      skipped.push({ title: row.title, reason: "unparseable title" });
      continue;
    }
    if (!parsed.current) continue; // legacy "(Z)" set
    if (row.rate == null || !Number.isFinite(row.rate) || row.rate <= 0) {
      skipped.push({ title: row.title, reason: "no rate" });
      continue;
    }

    const key = `${parsed.line}:${parsed.family.toLowerCase()}`;
    let el = byKey.get(key);
    if (!el) {
      el = {
        key,
        line: parsed.line,
        name: parsed.family,
        family: parsed.family,
        category: categoryFor(parsed.family),
        unit: unitFromMeasure(row.measure, parsed.perLift),
        usesLifts: parsed.perLift,
        usesHeightBracket: false,
        sourceTitle: parsed.raw,
        rates: [],
      };
      byKey.set(key, el);
    }
    if (parsed.bracket) el.usesHeightBracket = true;

    const bracket: HeightBracket = parsed.bracket ?? "ANY";
    const bands = parsed.band ? [parsed.band] : ALL_BANDS;
    for (const band of bands) {
      const slot = `${key}|${band}|${bracket}`;
      const existing = el.rates.find((r) => r.band === band && r.bracket === bracket);
      if (existing) {
        collisions++;
        // An explicitly banded row beats a price copied across bands.
        if (parsed.band && !explicit.has(slot)) {
          existing.rate = row.rate;
          existing.baseHireWeeks = row.baseHireWeeks ?? 4;
          existing.extraHirePerWeek = row.extraHirePerWeek ?? 0;
          existing.extraHireChargePct = row.extraHireChargePct ?? 100;
          existing.bandAssumed = false;
        }
      } else {
        el.rates.push({
          band,
          bracket,
          rate: row.rate,
          baseHireWeeks: row.baseHireWeeks ?? 4,
          extraHirePerWeek: row.extraHirePerWeek ?? 0,
          extraHireChargePct: row.extraHireChargePct ?? 100,
          bandAssumed: parsed.band == null,
        });
      }
      if (parsed.band) explicit.add(slot);
    }
  }

  const elements = [...byKey.values()].sort(
    (a, b) => a.line.localeCompare(b.line) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );
  elements.forEach((e, i) => {
    e.rates.sort((x, y) => x.bracket.localeCompare(y.bracket) || x.band.localeCompare(y.band));
    void i;
  });
  return { elements, skipped, collisions };
}
