/**
 * Smart upload & grouping — the layer UPSTREAM of the extractor. The main points
 * only (not every detail); full write-up in docs/EXTRACTOR-COMPLETE-REFERENCE.md
 * Part 14 and docs/17-smart-upload-and-grouping.md.
 */

export const SMART_UPLOAD_INTRO =
  "The layer that runs before the extractor. You drop a whole tender folder (or ZIP) — often hundreds of PDFs buried in trade sub-folders, and every builder packages it differently — and the system works out which files belong to which house type, bundles each type into one combined PDF (its full “dossier”), tags which pages a scaffolder actually needs, and gets a human sign-off — all before any paid AI extraction. Downstream of the tagged pages, the extractor runs exactly as documented above.";

/** The two ideas that make it reliable, not just clever. */
export const SMART_UPLOAD_IDEAS = [
  {
    title: "Grouping = identity; relevance = a per-page tag",
    body: "Grouping only answers “which house type is this file?” and puts EVERY file for a type — relevant or not — into one dossier. A separate per-page “relevant?” flag then decides which pages the extractor reads and the preview shows. Nothing is discarded: “Open full drawing” always shows the whole dossier.",
  },
  {
    title: "The AI infers the rule; plain code applies it",
    body: "Asked to place hundreds of files at once, an LLM silently drops some — and a dropped house type is a missing line on the quote. So the AI reads a text summary of the pack and returns a small recipe (“house types are the folder under Scaffold/; these are junk; the names look like X”), and deterministic code applies that recipe to every file, accounting for each one exactly once.",
  },
];

/** The pipeline, compact. `by` = which layer does the step. */
export const SMART_UPLOAD_PIPELINE: { step: string; by: "AI" | "Code" | "AI + Code" | "Human"; what: string }[] = [
  { step: "Upload", by: "Code", what: "Folder-first, resumable uploader — files register as they finish, so an interrupted session resumes by re-dropping (only the missing files re-upload)." },
  { step: "Ingest", by: "Code", what: "Expand ZIPs; dedupe a zip-vs-unzipped copy by content hash; keep each file's folder path (the main grouping signal)." },
  { step: "Classify (Tier 1)", by: "Code", what: "Read the text layer to tag drawing type + relevance for free. A raster page with no text layer is flagged for a human, not OCR'd." },
  { step: "Relevance triage", by: "AI", what: "Only re-checks ambiguous pages — and can only RESCUE a missed drawing, never remove one. Recall beats precision: a wrong include wastes tokens; a wrong exclude is a silent hole." },
  { step: "Infer recipe", by: "AI", what: "From a text summary of the pack, return the packaging strategy + junk folders + house-type names. It explicitly does NOT place files." },
  { step: "Apply + tighten", by: "Code", what: "Assign every file to a house type, then keep the latest revision, collapse material/handing variants, and one page per role — but never collapse elevations." },
  { step: "Assemble", by: "Code", what: "Merge each type's chosen pages into one PDF, relevant pages first, with a manifest tracing every page to its source file + page." },
  { step: "Confirm", by: "Human", what: "The worker stops at PROPOSED with pending extractions; the confirm screen lets a human rename / merge / exclude. Only “Confirm & extract” spends money." },
];

export const SMART_UPLOAD_AI_NOTE =
  "Two AI touch-points — both text-based, forced-tool + schema, on the grouping model (defaults to the extraction model): (1) infer the grouping recipe, and (2) rescue-only relevance triage. Everything else — path parsing, dedup, file placement, PDF assembly, and the whole confirm gate — is deterministic. Both are gated by the INGEST_GROUPING_AI flag (default on); off falls back to a fully deterministic path.";

export const SMART_UPLOAD_GATE_NOTE =
  "Nothing costs money until a person approves. Grouping produces only pending extractions and stops at a PROPOSED state; the confirm screen sorts low-confidence groups to the top and surfaces any unplaced files. Only “Confirm & extract” enqueues the paid extraction — the same rule as the rest of the platform: a human confirms first.";
