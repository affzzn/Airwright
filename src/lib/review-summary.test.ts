import { describe, it, expect } from "vitest";
import { buildReviewSummary, reviewNotesFrom } from "./review-summary";

const base = {
  config: "SEMI_DETACHED",
  isApartment: false,
  structure: "PAIR_SEMI",
  storeys: 1,
  roomInRoof: false,
  roofType: "PITCHED",
  rendered: false,
  chimney: false,
  timberFrame: false,
  frontageDivisor: 1,
  partyLeft: true,
  partyRight: false,
  engineFlags: [],
  configFlag: null,
  lowConfidence: [],
  reviewNotes: [],
  legacyNotes: null,
};

describe("buildReviewSummary", () => {
  it("Millfield: one plain line saying what the house is", () => {
    const s = buildReviewSummary(base);
    expect(s.headline).toBe("Single-storey semi-detached bungalow · one house of a pair drawn · party wall on the left");
    expect(s.facts).toBe("Pitched roof · not rendered · no chimney · traditional");
    expect(s.check).toEqual([]);
  });
  it("Dekker: a whole pair drawn on one sheet", () => {
    const s = buildReviewSummary({ ...base, storeys: 2, frontageDivisor: 2, partyLeft: false });
    expect(s.headline).toBe("Two-storey semi-detached house · whole pair drawn");
  });
  it("mid-terrace, 2½-storey timber frame; detached says nothing about party walls", () => {
    expect(
      buildReviewSummary({ ...base, config: "MID_TERRACE", structure: "TERRACE", storeys: 2, roomInRoof: true, partyRight: true, timberFrame: true }).headline,
    ).toBe("2½-storey mid-terrace house · one house of a terrace drawn · party walls both sides");
    expect(buildReviewSummary({ ...base, config: "DETACHED", structure: "DETACHED", storeys: 2 }).headline).toBe("Two-storey detached house");
  });
  it("check = engine flags + uncertain house type + AI assumptions + low confidence; spec notes are info", () => {
    const s = buildReviewSummary({
      ...base,
      configFlag: "House type is a default, not a read.",
      engineFlags: ["Lift mismatch: height gives 3, storey template gives 2."],
      lowConfidence: ["Apexes on the drawing"],
      reviewNotes: [
        { kind: "ASSUMPTION", text: "Party wall side not marked — assumed the left.", sourcePage: 4 },
        { kind: "SPEC_NOTE", text: "Chimney shown 'if required' only — not counted.", sourcePage: 2 },
      ],
    });
    expect(s.check.map((c) => c.text)).toEqual([
      "House type is a default, not a read.",
      "Lift mismatch: height gives 3, storey template gives 2.",
      "Assumed: Party wall side not marked — assumed the left.",
      "Low-confidence read: Apexes on the drawing — check it against the drawing.",
    ]);
    expect(s.check[2].page).toBe(4);
    expect(s.info).toEqual([{ text: "On the drawing: Chimney shown 'if required' only — not counted.", page: 2 }]);
  });
  it("legacy free-text notes land in info, one sentence each, de-duplicated", () => {
    const s = buildReviewSummary({ ...base, legacyNotes: "First thing. Second thing. First thing." });
    expect(s.info.map((i) => i.text)).toEqual(["First thing.", "Second thing."]);
  });
  it("reviewNotesFrom ignores junk from older rows", () => {
    expect(reviewNotesFrom(undefined)).toEqual([]);
    expect(reviewNotesFrom([{ kind: "NOPE", text: "x" }, { kind: "UNREAD", text: "Height not dimensioned." }])).toEqual([
      { kind: "UNREAD", text: "Height not dimensioned.", sourcePage: null },
    ]);
  });
});
