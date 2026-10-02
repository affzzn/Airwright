import { describe, expect, it } from "vitest";
import { cellOf, columnRole, parseScopeGrid, parseScopeWorkbook, renderScopeTable, type GridSheet } from "./scopeTable";

/** The King Edward CN215 schedule's shape (two header rows, sections, an empty one). */
const ke: GridSheet = {
  name: "Scaffolding",
  rows: [
    { row: 2, cells: [{ col: 2, text: "CN215 - King Edward VI College", bold: true }] },
    { row: 4, cells: [{ col: 2, text: "Scaffolding" }] },
    {
      row: 7,
      cells: [
        { col: 4, text: "Dimensions (m)", bold: true },
        { col: 8, text: "Hire Period", bold: true },
        { col: 9, text: "Weekly Rate", bold: true },
        { col: 10, text: "Cost", bold: true },
        { col: 11, text: "Comment", bold: true },
      ],
    },
    {
      row: 8,
      cells: [
        { col: 4, text: "w", bold: true },
        { col: 5, text: "l", bold: true },
        { col: 6, text: "h", bold: true },
        { col: 7, text: "Lifts", bold: true },
        { col: 8, text: "(weeks)", bold: true },
        { col: 9, text: "(£)", bold: true },
        { col: 10, text: "(£)", bold: true },
      ],
    },
    { row: 10, cells: [{ col: 3, text: "Perimeter Scaffolding" }] },
    { row: 12, cells: [{ col: 3, text: "Independent tied scaffold" }, { col: 8, text: "30" }] },
    { row: 16, cells: [{ col: 3, text: "Staircase access towers; 2nr" }, { col: 8, text: "30" }] },
    { row: 28, cells: [{ col: 3, text: "Internal Scaffolding" }] },
    { row: 29, cells: [{ col: 3, text: "Ground floor blockwork walls" }, { col: 8, text: "8" }] },
    { row: 32, cells: [{ col: 3, text: "Birdcages" }] },
    { row: 34, cells: [{ col: 3, text: "Cores/Shafts" }] },
    { row: 35, cells: [{ col: 3, text: "Lift shaf internal scaffold" }, { col: 8, text: "16" }] },
    { row: 45, cells: [{ col: 3, text: "Adaptions" }] },
    { row: 46, cells: [{ col: 3, text: "Generally" }, { col: 8, text: "item" }] },
    { row: 49, cells: [{ col: 8, text: "Total" }, { col: 10, text: "0" }] },
  ],
};

/** The Wren schedule's shape (one header row, no sections, numbers given). */
const wren: GridSheet = {
  name: "Sheet1",
  rows: [
    {
      row: 1,
      cells: ["Item:", "Nr of Lifts", "Unit:", "Quantity:", "Unit:", "Rate:", "Duration:", "Duration:", "Total Cost:", "Notes:"].map((text, i) => ({ col: i + 1, text })),
    },
    { row: 3, cells: [{ col: 1, text: "Haki Stair Tower" }, { col: 2, text: "2" }, { col: 4, text: "1" }, { col: 7, text: "7" }, { col: 8, text: "Weeks" }] },
    { row: 10, cells: [{ col: 1, text: "Progressive External Perimetre" }, { col: 2, text: "2" }, { col: 4, text: "35.15746" }, { col: 5, text: "m" }, { col: 7, text: "7" }] },
  ],
};

describe("schedule structure (docs/23 §11.1)", () => {
  it("reads King Edward: two header rows, sections, hire per row, the empty section", () => {
    const t = parseScopeGrid(ke)!;
    expect(t.headerRows).toEqual([7, 8]);
    expect(t.itemCol).toBe(3);
    expect(t.columns.map((c) => c.role)).toEqual(["ITEM", "W", "L", "H", "LIFTS", "HIRE_WEEKS", "WEEKLY_RATE", "COST", "COMMENT"]);
    expect(t.title).toContain("CN215");
    const items = t.rows.filter((r) => r.kind === "ITEM");
    expect(items.map((r) => r.ref)).toEqual(["R12", "R16", "R29", "R35", "R46"]);
    expect(items[0].section).toBe("Perimeter Scaffolding");
    expect(cellOf(items[0], "HIRE_WEEKS")).toBe("30");
    expect(items[3].section).toBe("Cores/Shafts");
    expect(t.sections.find((s) => s.name === "Birdcages")!.itemCount).toBe(0);
    expect(t.rows.some((r) => r.kind === "TOTAL")).toBe(true);
  });

  it("reads Wren: no sections, lifts and quantity columns", () => {
    const t = parseScopeGrid(wren)!;
    expect(t.sections).toHaveLength(0);
    const r = t.rows.find((x) => x.ref === "R10")!;
    expect(cellOf(r, "LIFTS")).toBe("2");
    expect(cellOf(r, "QTY")).toBe("35.15746");
    expect(cellOf(r, "HIRE_WEEKS")).toBe("7");
    expect(r.section).toBeNull();
  });

  it("renders rows with refs and marks empty sections for the reader", () => {
    const text = renderScopeTable("CN215.xlsx", parseScopeGrid(ke)!);
    expect(text).toContain('[R12] Independent tied scaffold | Hire Period (weeks): 30');
    expect(text).toContain('SECTION "Birdcages" — no items listed under it');
  });

  it("skips a sheet that repeats another (Stanmore's 'In Order')", () => {
    expect(parseScopeWorkbook([wren, { ...wren, name: "In Order" }])).toHaveLength(1);
  });

  it("is not a table without a header", () => {
    expect(parseScopeGrid({ name: "x", rows: [{ row: 1, cells: [{ col: 1, text: "hello" }] }, { row: 2, cells: [{ col: 1, text: "world" }] }] })).toBeNull();
  });

  it("names column roles from their labels", () => {
    expect(columnRole("Approx. Plan Dimensions")).toBe("DIMENSIONS");
    expect(columnRole("Approx. Height (m)")).toBe("HEIGHT");
    expect(columnRole("Hire Duration")).toBe("HIRE_WEEKS");
    expect(columnRole("Weekly Rate (£)")).toBe("WEEKLY_RATE");
    expect(columnRole("Item Ref.")).toBe("REF");
    expect(columnRole("Total Cost")).toBe("COST");
  });
});
