/**
 * Typed content model for the Dev / Spec page (`/dev`).
 *
 * This is the SINGLE hand-authored source for the extractor spec's prose,
 * worked examples, status and ownership — ported from
 * `docs/EXTRACTOR-COMPLETE-REFERENCE.md`. Hard code VALUES (constants,
 * tolerances, the verbatim prompt, the schema field names) are imported LIVE
 * from the code in `live.ts`, so the page can't drift from the code on those.
 *
 * Pure data + types only — safe to import into a client component.
 */

/** Who owns confirming an open rule. */
export type Owner = "colin" | "laura" | "ben" | "rayyan" | "innate";

export const OWNER_LABEL: Record<Owner, string> = {
  colin: "Colin",
  laura: "Laura",
  ben: "Ben",
  rayyan: "Rayyan",
  innate: "Innate",
};

/** Which layer produces a value. */
export type Layer = "llm" | "engine" | "both";

export const LAYER_LABEL: Record<Layer, string> = {
  llm: "AI reads",
  engine: "Engine computes",
  both: "AI reads → engine computes",
};

/** Confirmed = a settled rule; open = awaiting the owner (built as a flag/param). */
export type Status = "confirmed" | "open";

/** One observable / measurement in the catalogue (Part 5 of the reference). */
export interface Measurement {
  id: string;
  name: string;
  /** One line, Colin-readable — always visible. */
  plain: string;
  /** Which sheet(s) it is read from. */
  whereRead: string[];
  layer: Layer;
  /** How the model reads it. */
  howRead: string;
  /** The engine's derivation, in words (if computed). */
  derivation?: string;
  /** A monospace formula, if any. */
  formula?: string;
  /** Alternative methods / fallbacks, in priority order. */
  fallbacks?: string[];
  /** How the confidence is decided. */
  confidenceRule?: string;
  /** An ordered decision procedure the model/engine follows, shown as numbered cards. */
  steps?: { title: string; detail: string }[];
  /** Small labelled tables (cases / ladders / worked examples), rendered visually. */
  tables?: { caption?: string; head: string[]; rows: string[][] }[];
  /** Cross-check ids (into CROSS_CHECKS). */
  crossChecks?: string[];
  workedExample?: string;
  status: Status;
  owner?: Owner;
  /** Repo-relative code files this lives in. */
  codeRefs: string[];
  /** Glossary term ids. */
  relatedTerms?: string[];
}

/** One open question — an agenda item for the Airwright sign-off. */
export interface OpenQuestion {
  id: string;
  question: string;
  owner: Owner;
  /** What the code assumes today (the flagged default). */
  currentAssumption: string;
  status: "open" | "resolved";
  /** How the resolved ones were settled. */
  resolution?: string;
  relatedMeasurementId?: string;
}

/** One deterministic engine rule (Part 6). */
export interface EngineRule {
  id: string;
  name: string;
  plain: string;
  /** An extra paragraph of detail (precedence rules, caveats). */
  plainExtra?: string;
  formula?: string;
  /** A small labelled table, rendered as rows. */
  table?: { caption?: string; head: string[]; rows: string[][] };
  status: Status;
  owner?: Owner;
  codeRefs: string[];
}

/** One automated cross-check / flag (Part 7 / 9). */
export interface CrossCheck {
  id: string;
  /** e.g. "C9", "H3", or "" for the unnamed ones. */
  code: string;
  name: string;
  trigger: string;
  effect: string;
  /** The `warnings.*` key it writes, if any. */
  warningKey?: string;
  status: Status;
}

export interface GlossaryTerm {
  id: string;
  term: string;
  definition: string;
  layer?: Layer;
}

/** One golden-set validation result. */
export interface ValidationCase {
  houseType: string;
  kind: string;
  ours: string;
  colin: string;
  verdict: string;
}

/** One pipeline stage (Part 0.5). */
export interface PipelineStage {
  id: string;
  name: string;
  runsIn: "browser" | "worker" | "app";
  what: string;
}

/** One field of the extraction contract (Part 4). */
export interface SchemaField {
  name: string;
  type: string;
  meaning: string;
}

/** One per-builder profile row (Part 11). */
export interface BuilderProfileRow {
  builder: string;
  access: string;
  propping: string;
  notes: string;
}
