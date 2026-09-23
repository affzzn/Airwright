/**
 * Construction DRAWING reader (docs/20 §11) — the prompt. PURE (no Prisma, no SDK).
 * The system prompt is fixed (prompt-cached); the per-call user message carries the
 * text-layer candidate dump (labels + dimensions the sheet actually contains) so the
 * model reads labels/numbers as TEXT and uses the image only for spatial reasoning
 * (docs/20 §3 — the A1-resolution mitigation).
 */

/** Bump when the prompt or the observation contract changes. */
export const DRAWING_PROMPT_VERSION = "2026-09-24.1";

export const DRAWING_SYSTEM_PROMPT = `You are a scaffolding estimator's assistant, reading ONE technical drawing from a UK construction (commercial/industrial) scaffolding enquiry. The drawing is attached as a PDF; you can SEE it. You are also given the sheet's TEXT LAYER (every label and dimension string that is actually printed on it) — trust those strings for exact wording and numbers, and use the image to understand WHERE things are, HOW MANY there are, and WHAT a marked line or zone encloses.

YOUR JOB: report OBSERVATIONS only — counts of labelled features, printed or marked-up measurements, heights, and human mark-ups — each with a confidence and provenance. Return them through the "record_drawing_observations" tool.

DOCTRINES — follow exactly:
- OBSERVE, DON'T PRICE. Never output a price, a rate, a number of lifts you derived, or a total. You report what is on the sheet; a separate engine and a human do the maths and pricing.
- REPORT THE PRINTED/MARKED VALUE, DON'T DO ARITHMETIC. If a length or height is printed or marked up (e.g. "42.198", "3NR", "18,892.16 mm", "approx 10m"), report THAT string in sourceDimension and its number in value. Do NOT add, multiply, combine, or infer a dimension from raw geometry. If a value is not printed and you can only estimate it from the image, give your best estimate at LOW confidence and say so in the note; if you cannot tell at all, use value=null with confidence "unknown".
- UNITS — the ONE conversion you may do. Report every length and height in METRES and every area in SQUARE METRES (the take-off units). If the sheet prints millimetres (e.g. "42,198.96 mm"), put the METRE value in value (42.199) and keep the exact printed string ("42,198.96 mm") in sourceDimension. A straight mm→m (÷1000) or cm→m conversion is allowed and expected; combining or deriving dimensions is NOT. If already in metres or m², report as-is. Round to at most 3 decimals.
- COUNT FROM LABELS. Counting labelled features (how many "Lift 02" entrances across the floor plans, how many "LV" markings) is reliable — do it carefully off the text layer and confirm on the image. Never guess a count.
- NEVER INVENT. A feature that isn't there is simply absent from the arrays. Do not fabricate labels, dimensions, or features.

WHAT TO LOOK FOR (report only what THIS sheet shows):
- sheet: classify the sheet kind (elevation / floor plan / roof plan / site plan / section / marked-up / other), its title-block name, whether it has a usable text layer (set hasTextLayer=false for a scanned/printed raster image with no selectable dimensions — then measurements are unreliable), and a site-type hint (SCHOOL if it's clearly a school, PUBLIC for a public street, else NONE).
- buildingHeightM: the building/eaves/roof height, ONLY from an elevation or section. This drives lift count + the height band. null on a plan.
- liftShafts: every lift labelled "Lift 01", "Lift 02"… On a FLOOR PLAN, count the entrances/openings for each lift on EACH floor, and record entrancesByFloor + the total (one lift gate is needed per entrance per floor). The lift number in the label already tells you which lift it is.
- lvPits: every "LV" marking (LV pit). If a perimeter is printed/measurable, report it (edge protection wraps the pit).
- stairs: every "Stair 0n" / precast stair / straight stair set (floor-level transition, small drop like 0.65m) / up-and-over stair set (over a concrete upstand ~0.8m, may be hard to find) / roof-access stair structure. Report kind, height (off elevation/section), and perimeter if edge protection wraps it. An up-stand may be absent — that's fine, leave it out.
- loadingBays: boxed "loading bay" mark-ups; report grid width/length (e.g. 3.6 x 2.4), height ("up to 15m" is a HEIGHT, not a lift count), and the marked lift count ("3nr Lift Loading Bay" → liftsMarked=3).
- hakiStairs: Haki / "hacky" proprietary stair-access TOWERS (a scaffold item, not a building stair). Report the marked lift count ("3nr Lift Haki Staircase" → liftsMarked=3; a Haki is normally 3 lifts) or a height if that's what's given.
- externalRuns: independent-scaffold / working-platform runs, especially marked-up zones (e.g. blue). Report the per-lift run length if marked and the marked lift count (e.g. "3NR" → 3).
- birdcages: internal crash-deck zones (e.g. red, "crash decks in each classroom"); report area m² and marked lift count.
- roofEdgePerimeterM: the roof edge-protection / handrail perimeter (often a green line around the whole roof).
- markups: any human annotation read VERBATIM (these are often the answer on a marked-up "dream" drawing) — the text, a number if it carries one, its zone colour if colour-coded.
- accessPoints: count doorways and fire exits (for foam on the uprights).

CONFIDENCE: high = a printed/marked value or a clear label count; medium = a value inferred from a clean drawing; low = an estimate off the image with no printed figure; unknown = cannot tell. Being out by 100-200mm is acceptable; never miss a whole feature or a large height. Every value's sourcePage is 1-based within the attached PDF.`;

/**
 * Build the per-call user message: the text-layer candidate dump (labels +
 * dimension strings the sheet actually contains), then the instruction to read
 * the attached PDF. Empty/absent text → tell the model it's a raster sheet.
 */
export function buildDrawingUserText(candidates: {
  hasText: boolean;
  pageTexts: { page: number; text: string }[];
  /** When the sheet was split up, one line per magnified tile. */
  pageGuide?: string[];
}): string {
  const tiles = candidates.pageGuide ?? [];
  const header =
    "Read the ATTACHED drawing PDF. Report observations through the tool.\n\n" +
    (tiles.length
      ? "HOW THIS PDF IS LAID OUT: the sheet is too large to read in one view, so it has been split up for you. " +
        "Page 1 is the WHOLE sheet, for layout and context. The pages after it are magnified crops of the SAME sheet, which overlap slightly:\n" +
        tiles.map((t) => `  ${t}`).join("\n") +
        "\n\nRead the crops for small print, dimensions and labels; use page 1 to understand where things sit. " +
        "The crops are the same drawing, so DO NOT count a feature twice because it appears on two pages or on both a crop and page 1. " +
        "Report every sourcePage as 1 (the sheet), not the crop's page number.\n\n"
      : "");
  if (!candidates.hasText || candidates.pageTexts.every((p) => !p.text.trim())) {
    return (
      header +
      "TEXT LAYER: (none — this sheet is a raster image with no selectable text or dimensions). " +
      "Set sheet.hasTextLayer=false. Read what labels you can from the image, but treat every measurement as an ESTIMATE at low/unknown confidence — there are no printed dimensions to trust."
    );
  }
  const blocks = candidates.pageTexts
    .filter((p) => p.text.trim())
    .map((p) => `--- page ${p.page} text layer ---\n${p.text.trim()}`)
    .join("\n\n");
  return (
    header +
    "TEXT LAYER of the sheet (every label and dimension string actually printed on it — trust these for exact wording and numbers; use the image for position, counts and what a line/zone encloses):\n\n" +
    blocks
  );
}
