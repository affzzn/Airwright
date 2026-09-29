/**
 * The review screen's Summary — what a reviewer (Colin, Laura) needs at a glance:
 *
 *   - headline: WHAT this house is, in one plain line — built by CODE from the take-off
 *     itself (never AI prose), so it can never contradict the numbers below it;
 *   - facts:    the secondary facts (roof, render, chimney, build system);
 *   - check:    every item a person must look at — the engine's flags, an uncertain
 *     house type, low-confidence reads, and the AI's assumptions / unclear / unread notes;
 *   - info:     worth knowing, nothing to do — notes printed on the drawing (spec notes)
 *     and legacy free-text notes from older reads.
 *
 * Pure + unit-tested; the editor recomputes it live as the reviewer edits.
 */

export type ReviewNoteKind = "ASSUMPTION" | "UNCLEAR" | "UNREAD" | "SPEC_NOTE";
export interface ReviewNoteIn {
  kind: ReviewNoteKind;
  text: string;
  sourcePage?: number | null;
}
export interface SummaryItem {
  text: string;
  page?: number | null;
}
export interface ReviewSummary {
  headline: string;
  facts: string;
  check: SummaryItem[];
  info: SummaryItem[];
}

const CONFIG_WORD: Record<string, string> = {
  DETACHED: "detached",
  SEMI_DETACHED: "semi-detached",
  END_TERRACE: "end-terrace",
  MID_TERRACE: "mid-terrace",
};

function storeyWord(storeys: number | null, roomInRoof: boolean): string | null {
  if (storeys == null) return null;
  if (storeys === 2.5 || (storeys === 2 && roomInRoof)) return "2½-storey";
  if (storeys === 1) return "Single-storey";
  if (storeys === 2) return "Two-storey";
  if (storeys === 3) return "Three-storey";
  return `${storeys}-storey`;
}

const KIND_LABEL: Record<ReviewNoteKind, string> = {
  ASSUMPTION: "Assumed",
  UNCLEAR: "Unclear on the drawing",
  UNREAD: "Could not read",
  SPEC_NOTE: "On the drawing",
};

export function buildReviewSummary(x: {
  config: string;
  isApartment: boolean;
  structure: string | null;
  storeys: number | null;
  roomInRoof: boolean;
  roofType: string | null;
  rendered: boolean | null;
  chimney: boolean | null;
  timberFrame: boolean;
  /** The frontage divisor the engine applied — >1 means the sheet draws the whole block. */
  frontageDivisor: number;
  /** Party-wall status of the two side walls, AFTER role normalisation. */
  partyLeft: boolean | null;
  partyRight: boolean | null;
  engineFlags: string[];
  configFlag: string | null;
  /** Labels of measurements read with low confidence. */
  lowConfidence: string[];
  reviewNotes: ReviewNoteIn[];
  legacyNotes: string | null;
}): ReviewSummary {
  // --- Headline: what this is -------------------------------------------------
  const parts: string[] = [];
  const sw = storeyWord(x.storeys, x.roomInRoof);
  if (x.isApartment) {
    parts.push(`${sw ?? "Apartment"}${sw ? " apartment block" : " block"} — scaffolded as one building`);
  } else {
    const noun = x.storeys === 1 ? "bungalow" : "house";
    const cfg = CONFIG_WORD[x.config] ?? x.config.toLowerCase();
    parts.push([sw, cfg, noun].filter(Boolean).join(" ").replace(/^./, (c) => c.toUpperCase()));
    const attached = x.config !== "DETACHED";
    const group =
      x.structure === "PAIR_SEMI" ? "a pair" : x.structure === "THREE_BLOCK" ? "a block of 3" : x.structure === "TERRACE" ? "a terrace" : null;
    if (x.frontageDivisor > 1) parts.push(`whole ${x.frontageDivisor === 2 ? "pair" : `block of ${x.frontageDivisor}`} drawn`);
    else if (attached && group) parts.push(`one house of ${group} drawn`);
    if (attached && x.frontageDivisor <= 1) {
      if (x.partyLeft === true && x.partyRight === true) parts.push("party walls both sides");
      else if (x.partyLeft === true) parts.push("party wall on the left");
      else if (x.partyRight === true) parts.push("party wall on the right");
      else parts.push("party wall side not marked");
    }
  }

  // --- Facts: secondary, still worth a glance ---------------------------------
  const facts: string[] = [];
  if (x.roofType) facts.push(`${x.roofType.charAt(0)}${x.roofType.slice(1).toLowerCase()} roof`);
  if (x.rendered != null) facts.push(x.rendered ? "rendered" : "not rendered");
  if (x.chimney != null) facts.push(x.chimney ? "chimney" : "no chimney");
  facts.push(x.timberFrame ? "timber frame" : "traditional");

  // --- Check: everything a person must look at ---------------------------------
  const check: SummaryItem[] = [];
  const seen = new Set<string>();
  const add = (list: SummaryItem[], text: string, page?: number | null) => {
    const k = text.trim();
    if (!k || seen.has(k)) return;
    seen.add(k);
    list.push({ text: k, page: page ?? null });
  };
  if (x.configFlag) add(check, x.configFlag);
  for (const f of x.engineFlags) add(check, f);
  for (const n of x.reviewNotes)
    if (n.kind !== "SPEC_NOTE") add(check, `${KIND_LABEL[n.kind]}: ${n.text}`, n.sourcePage);
  for (const l of x.lowConfidence) add(check, `Low-confidence read: ${l} — check it against the drawing.`);

  // --- Info: worth knowing, nothing to do --------------------------------------
  const info: SummaryItem[] = [];
  for (const n of x.reviewNotes) if (n.kind === "SPEC_NOTE") add(info, `${KIND_LABEL.SPEC_NOTE}: ${n.text}`, n.sourcePage);
  if (x.legacyNotes)
    for (const s of x.legacyNotes.split(/(?<=[.!?])\s+/).map((t) => t.trim()).filter(Boolean)) add(info, s);

  return { headline: parts.join(" · "), facts: facts.join(" · "), check, info };
}

/** Parse the stored `warnings.reviewNotes` defensively (older rows have none). */
export function reviewNotesFrom(v: unknown): ReviewNoteIn[] {
  if (!Array.isArray(v)) return [];
  const kinds = new Set(["ASSUMPTION", "UNCLEAR", "UNREAD", "SPEC_NOTE"]);
  return v
    .filter((n): n is Record<string, unknown> => !!n && typeof n === "object")
    .filter((n) => typeof n.text === "string" && kinds.has(String(n.kind)))
    .map((n) => ({
      kind: n.kind as ReviewNoteKind,
      text: n.text as string,
      sourcePage: typeof n.sourcePage === "number" ? n.sourcePage : null,
    }));
}
