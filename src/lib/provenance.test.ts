import { describe, it, expect } from "vitest";
import { resolvePage, type PageRef } from "./provenance";

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
