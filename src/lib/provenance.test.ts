import { describe, it, expect } from "vitest";
import { resolvePage, confidenceReason, type PageRef } from "./provenance";

const pages: PageRef[] = [
  { pageNumber: 7, sheetTitle: "Ground Floor Plan" },
  { pageNumber: 14, sheetTitle: "Front Elevation" },
  { pageNumber: 15, sheetTitle: "Side Elevation & Section" },
  { pageNumber: 22, sheetTitle: null },
];

describe("resolvePage", () => {
  it("matches an exact sheet title (case/space-insensitive)", () => {
    expect(resolvePage("front elevation", pages)).toBe(14);
    expect(resolvePage("Ground Floor Plan", pages)).toBe(7);
  });

  it("matches when the label is contained in the title", () => {
    // model said "Side Elevation"; the page title is "Side Elevation & Section"
    expect(resolvePage("Side Elevation", pages)).toBe(15);
  });

  it("returns null for an unresolvable label", () => {
    expect(resolvePage("Roof Plan", pages)).toBeNull();
    expect(resolvePage(null, pages)).toBeNull();
    expect(resolvePage("", pages)).toBeNull();
  });

  it("restricts matches to the allowed (relevant) pages", () => {
    // Front Elevation is p.14, but only pages 7 and 15 were relevant here.
    expect(resolvePage("Front Elevation", pages, [7, 15])).toBeNull();
    expect(resolvePage("Front Elevation", pages, [7, 14, 15])).toBe(14);
  });
});

describe("confidenceReason", () => {
  it("always begins with the level word, so it reads on its own", () => {
    expect(confidenceReason("high")).toMatch(/^High —/);
    expect(confidenceReason("medium")).toMatch(/^Medium —/);
    expect(confidenceReason("low")).toMatch(/^Low —/);
    expect(confidenceReason("unknown")).toMatch(/^Unknown —/);
  });

  it("returns null when there is no confidence label", () => {
    expect(confidenceReason(null)).toBeNull();
    expect(confidenceReason(undefined)).toBeNull();
  });

  it("high mentions the second-source cross-check only when there was one", () => {
    expect(confidenceReason("high", { crossChecked: true })).toMatch(/second, independent source/i);
    expect(confidenceReason("high", { crossChecked: false })).toMatch(/clearly legible/i);
  });

  it("medium wording follows the method (read vs computed)", () => {
    expect(confidenceReason("medium", { method: "read" })).toMatch(/not independently confirmed/i);
    expect(confidenceReason("medium", { method: "computed" })).toMatch(/not independently cross-checked/i);
  });

  it("a specific `detail` overrides the generic wording", () => {
    const detail = "Low — the two reads disagree; check the dimensions.";
    expect(confidenceReason("low", { detail })).toBe(detail);
  });
});

import { partyWallProvenance, birdcageTotalProvenance } from "./provenance";

describe("partyWallProvenance — its own unit-priced item (not apex)", () => {
  it("detached has no party wall", () => {
    const p = partyWallProvenance("DETACHED", true, 0);
    expect(p.steps.map((s) => s.text).join(" ")).toMatch(/no party wall/i);
  });
  it("a non-detached house is one unit, and says it is not an apex item", () => {
    const p = partyWallProvenance("MID_TERRACE", true, 1);
    const text = [...p.steps.map((s) => s.text), ...p.footnotes].join(" ");
    expect(text).toMatch(/1 party-wall scaffold/i);
    expect(text).toMatch(/NOT part of the apex/i);
  });
  it("an opt-out drops the unit to 0", () => {
    const p = partyWallProvenance("SEMI_DETACHED", false, 0);
    expect(p.steps.map((s) => s.text).join(" ")).toMatch(/Excluded on this job/i);
  });
});

describe("birdcageTotalProvenance — decks summed, one lift each", () => {
  it("lists each floor and the total across n floors", () => {
    const p = birdcageTotalProvenance(
      [
        { level: "GF", m2: 41.239 },
        { level: "FF", m2: 41.239 },
      ],
      82.478,
    );
    const text = p.steps.map((s) => s.text).join(" ");
    expect(text).toMatch(/Ground floor = 41.24/);
    expect(text).toMatch(/Total = 82.48 m² across 2 floors/);
  });
});

import { liftsProvenance } from "./provenance";

describe("liftsProvenance — build-system aware (docs/18)", () => {
  it("timber frame explains the 450 mm + 2 m method, not ÷ 1.5", () => {
    const p = liftsProvenance(4.8, 2, false, 3, 3, 3, false, "TIMBER_FRAME");
    expect(p.summary).toMatch(/timber frame/i);
    const text = [p.summary, ...p.steps.map((s) => s.text), ...(p.footnotes ?? [])].join(" ");
    expect(text).toMatch(/450 mm/);
    expect(text).toMatch(/Result: 3 lift/);
    expect(text).not.toMatch(/÷ 1\.5/);
  });
  it("traditional still explains height ÷ 1.5", () => {
    const p = liftsProvenance(6, 3, false, 4, 6, 6, false); // default TRADITIONAL
    expect(p.summary).toMatch(/÷ 1\.5/);
    expect(p.steps.map((s) => s.text).join(" ")).toMatch(/÷ 1\.5/);
  });
});
