/**
 * "Draft from enquiry" (docs/19) — the prompt for the construction scope reader.
 * PURE (no Prisma, no SDK). The system prompt is fixed (prompt-cached); the
 * picking-list context + the scope text are the per-call user message.
 *
 * The whole point: reading the client's written scope-of-works is the one place
 * AI belongs in construction. It reads TEXT, not drawings; it proposes lines
 * against the estimator's picking list; a human confirms before anything prices.
 */

import { UNIT_LABEL, type ConstructionUnit } from "./types";

/** Bump when the prompt or the output contract changes (parity with the extractor). */
export const SCOPE_PROMPT_VERSION = "2026-09-22.1";

export const SCOPE_SYSTEM_PROMPT = `You are an assistant to a UK scaffolding estimator, reading a client's written SCOPE OF WORKS for a construction (commercial/industrial) scaffolding job.

You are given (1) the estimator's PICKING LIST — the fixed library of scaffold items they can build, each with an id, a canonical name, aliases (the client's / other firms' words for the same thing), a unit, and whether it is priced per lift — and (2) the client's scope text (possibly a flattened spreadsheet).

Your job: for EACH distinct scope line, propose ONE draft quote line by mapping it to the single best-matching picking-list item.

RULES — follow exactly:
- Match by MEANING, using the aliases. The client's words rarely match the canonical name ("Safegate" = Lift Gate; "working platform" = Independent Scaffold; "crash deck" = Birdcage). Terminology is messy — never expect it to be uniform.
- Return the element's EXACT id from the list, or null when nothing in the list fits. NEVER invent an id, and NEVER invent a new item — an unmatched line is null with a note saying what item it seems to need.
- Account for EVERY scope line: output one line for each, matched or null. Never silently drop one.
- Prefer recall over precision: if unsure, propose the closest item at LOW confidence with a note, rather than leaving it null. A wrong suggestion costs the estimator one click; a missed item costs money.
- QUANTITY / LIFTS: report only the numbers the scope STATES. If the scope gives a linear-metre or area figure, put it in quantity; if it implies a per-lift item over N levels/lifts, put N in lifts. If a number is ambiguous ("20 LM x 2 pits" — cumulative or per pit?), still give your best number but flag it in the note. Leave a field null if the scope does not state it.
- Do NOT price. Do NOT compute totals. Do NOT read or assume anything from drawings — you only have the text.
- Keep clientText as the scope's original wording, verbatim.
- confidence: high = an unambiguous alias/name match with a clear quantity; medium = a sensible match or an inferred quantity; low = a guess or an ambiguous line.

Return your answer through the ${"`draft_quote_lines`"} tool only.`;

/**
 * The picking-list context block, one line per active element. This is the
 * vocabulary the model maps against — its ids are the only valid outputs.
 */
export function buildPickingListContext(
  elements: {
    id: string;
    name: string;
    aliases: string[];
    unit: ConstructionUnit | string;
    usesLifts: boolean;
    category?: string | null;
  }[],
): string {
  if (elements.length === 0) return "(the picking list is empty)";
  const rows = elements.map((e) => {
    const unit = UNIT_LABEL[e.unit as ConstructionUnit] ?? String(e.unit);
    const aliases = e.aliases.length ? ` | aka: ${e.aliases.join(", ")}` : "";
    const lift = e.usesLifts ? " | per-lift" : "";
    const cat = e.category ? ` | ${e.category}` : "";
    return `- id=${e.id} | ${e.name} | unit: ${unit}${lift}${cat}${aliases}`;
  });
  return rows.join("\n");
}

/** The per-call user message: the picking list, then the client's scope text. */
export function buildScopeUserText(
  pickingListContext: string,
  scopeText: string,
): string {
  return [
    "PICKING LIST (map each scope line to one of these ids, or null):",
    pickingListContext,
    "",
    "CLIENT SCOPE OF WORKS (text only — no drawings):",
    scopeText.trim() || "(empty)",
  ].join("\n");
}
