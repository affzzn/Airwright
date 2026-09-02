import type { PipelineStage, SchemaField } from "./types";

/** The end-to-end pipeline (docs/EXTRACTOR-COMPLETE-REFERENCE.md Part 0.5). */
export const PIPELINE: PipelineStage[] = [
  {
    id: "upload",
    name: "Upload",
    runsIn: "browser",
    what: "The browser uploads PDFs/ZIP straight to Storage; the app enqueues a process-pack job.",
  },
  {
    id: "classify",
    name: "Classify",
    runsIn: "worker",
    what: "Read the PDF text layer, classify every page for free (no AI) — kind + relevance + house-type code/name. No text layer → flagged, skipped.",
  },
  {
    id: "segment",
    name: "Segment",
    runsIn: "worker",
    what: "Group the relevant pages into house types BY NAME → one HouseType + one Extraction per house type, with its page range.",
  },
  {
    id: "extract",
    name: "Extract (AI)",
    runsIn: "worker",
    what: "Slice the pages, read the text-layer dimension candidates, call Claude (forced tool-use) → raw JSON → Zod-validate → store verbatim.",
  },
  {
    id: "reconcile",
    name: "Reconcile (engine)",
    runsIn: "worker",
    what: "Verify cited dimensions; run birdcage.ts + height.ts; write measurement rows + wall segments + the warnings JSON (derivations + cross-check flags).",
  },
  {
    id: "review",
    name: "Review",
    runsIn: "app",
    what: "PDF beside the fields; confidence dots; provenance on hover; every field editable; edits audit-logged.",
  },
  {
    id: "takeoff",
    name: "Take-off line",
    runsIn: "app",
    what: "The engine computes Colin's line per configuration (honouring edits), shown live on the review screen.",
  },
  {
    id: "confirm",
    name: "Confirm",
    runsIn: "app",
    what: "A human confirms the take-off (locks it) → only then is it priced. Nothing is auto-priced.",
  },
];

/**
 * The extraction contract's top-level fields (docs Part 4). The `name`s are
 * asserted against the live Zod schema keys in the drift-guard test, so this
 * table can't silently rot.
 */
export const SCHEMA_FIELDS: SchemaField[] = [
  { name: "houseType", type: "{ name, code?, confidence }", meaning: "House-type name + code (e.g. Dekker / NSS.277)." },
  { name: "buildType", type: "TRADITIONAL | TIMBER_FRAME | null", meaning: "Selects the pricing matrix; TF also changes sequence/ties." },
  { name: "structure", type: "DETACHED | PAIR_SEMI | THREE_BLOCK | TERRACE | APARTMENT_BLOCK | null", meaning: "Decides how the take-off is split (named by how many houses are joined; terrace = 4+)." },
  { name: "storeys", type: "number field (1 / 2 / 2.5 / 3)", meaning: "Observed; not used to count lifts." },
  { name: "roomInRoof", type: "bool field", meaning: "Room in the roof → 2.5-storey; adds a lift + a birdcage floor." },
  { name: "heightToSoffitM", type: "number field (m)", meaning: "The direct soffit / U-S wallplate read." },
  { name: "storeyHeightsM", type: "number[]", meaning: "Floor-to-floor storey heights as deltas; the engine sums them as a 2nd height estimate." },
  { name: "roof", type: "{ overallType: PITCHED | HIPPED | MIXED | null }", meaning: "Overall roof form." },
  { name: "elevations", type: "array of faces", meaning: "Per face: faceRoof, apexReason, apexCount, rendered, renderLengthM." },
  { name: "wallSegments", type: "array of walls", meaning: "External wall lengths (front/rear/gable), off the floor plan." },
  { name: "cornerCount", type: "number field", meaning: "External corners (rectangle = 4; 4 + one per step)." },
  { name: "cornerReason", type: "string | null", meaning: "One-line justification for the corner count (the shape + steps)." },
  { name: "dwellingsWide", type: "number field", meaning: "How many dwellings share the frontage (engine divides front/rear)." },
  { name: "floorAreas", type: "array of floors", meaning: "Raw birdcage inputs per floor (internal footprint rectangles; a stepped floor splits into several)." },
  { name: "lowLevel", type: "{ porchCanopy, porchSolid, baySingle, bayTwo }", meaning: "Porch/bay counts by type; two-storey bay excluded from the count." },
  { name: "chimney", type: "bool field", meaning: "A chimney stack actually drawn." },
  { name: "smartRoofPeakHeightM", type: "number field", meaning: "Peak height if unusually high (no threshold applied)." },
  { name: "underbuild", type: "{ needed, note }", meaning: "Slope/stepped-foundation flag; real source is the site-elevations plan." },
  { name: "notes", type: "string", meaning: "Short, useful estimator notes only." },
];
