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
