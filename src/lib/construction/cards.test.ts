import { describe, expect, it } from "vitest";
import { ADDONS, coreLines, derivedLifts, derivedQty, longestHire, pickRow, readBuildingCard, trustOf, type MeasureRow } from "./cards";
import { resolveJobParams } from "./params";

const params = resolveJobParams(null);
const row = (key: string, v: number, over: Partial<MeasureRow> = {}): MeasureRow => ({
  key,
  label: key,
  valueNumber: v,
  unit: "m",
  lifts: null,
  confidence: "high",
  source: "DRAWING",
  provenance: [`0201 Plan: ${key}`],
  note: `${key} note`,
  buildingId: "b",
  runId: "run1",
  ...over,
});

describe("trust, in plain terms", () => {
  it("two drawings agree → checked; printed once → printed; yours → measured / entered", () => {
    expect(trustOf(row("x", 1))).toBe("checked");
    expect(trustOf(row("x", 1, { confidence: "medium" }))).toBe("printed");
    expect(trustOf(row("x", 1, { source: "DRAWN", runId: null }))).toBe("measured");
    expect(trustOf(row("x", 1, { source: "MANUAL", runId: null }))).toBe("entered");
    expect(trustOf(row("x", 1, { source: "ROOMS", runId: null }))).toBe("printed");
    expect(trustOf(null)).toBe("none");
  });
  it("your own value beats the drawings'", () => {
    const rows = [row("ext-perimeter", 59.516), row("ext-perimeter", 60, { source: "MANUAL", runId: null })];
    expect(pickRow(rows, "b", "ext-perimeter")!.valueNumber).toBe(60);
  });
});

describe("the external card", () => {
  const rows = [
    row("ext-perimeter", 59.516),
    row("ext-corners", 4, { unit: "nr" }),
    row("height:soffit:2.85", 3, { lifts: 2, confidence: "high" }),
    row("height:soffit:1.65", 1.8, { lifts: 1, confidence: "medium" }),
    row("gables", 2, { unit: "nr" }),
  ];
  const card = readBuildingCard(rows, "b", params, [], 16);
  it("run = perimeter + 1 m per corner, with the working", () => {
    expect(card.external.run.value).toBe(63.516);
    expect(card.external.run.why).toContain("59.516 m wall + 1 m × 4 corners = 63.516 m");
  });
  it("height = the highest printed part; lifts = height ÷ 2 m, rounded up", () => {
    expect(card.external.height.value).toBe(3);
    expect(card.external.lifts.value).toBe(2);
    expect(card.external.lifts.why).toContain("3 m ÷ 2 m per lift");
    expect(card.external.bracket).toBe("UP_TO_6M");
    expect(card.external.heights).toHaveLength(2);
  });
  it("your lifts override the suggestion", () => {
    const c = readBuildingCard([...rows, row("ext-lifts", 3, { source: "MANUAL", runId: null, unit: "nr" })], "b", params);
    expect(c.external.lifts.value).toBe(3);
    expect(c.external.lifts.trust).toBe("entered");
  });
  it("nothing read → nothing filled, with a plain reason", () => {
    const c = readBuildingCard([], "b", params);
    expect(c.external.perimeter.value).toBeNull();
    expect(c.external.perimeter.trust).toBe("none");
    expect(c.external.run.value).toBeNull();
    expect(c.external.lifts.value).toBeNull();
  });
  it("the card's main line, and the add-ons that follow it", () => {
    const core = coreLines(card);
    expect(core).toHaveLength(1);
    expect(core[0]).toMatchObject({ cardKey: "ext:run", section: "External", role: "INDEPENDENT", quantity: 63.516, lifts: 2, hireWeeks: 16 });
    const a = (k: string) => ADDONS.find((x) => x.key === k)!;
    expect(derivedQty(a("ext:table-lifts"), card, 16)).toBe(2);
    expect(derivedQty(a("ext:netting"), card, 16)).toBe(190.55); // 63.516 × 3
    expect(derivedQty(a("ext:haki"), card, 16)).toBe(1);
    expect(derivedLifts(a("ext:haki"), card)).toBe(2);
    expect(derivedQty(a("job:inspections"), card, 16)).toBe(16);
  });
});

describe("internal + birdcage cards and hire", () => {
  const rows = [
    row("int-run", 40, { source: "DRAWN", runId: null }),
    row("int-lifts", 2, { source: "MANUAL", runId: null, unit: "nr" }),
    row("bc-area", 168.74, { source: "ROOMS", runId: null, unit: "m²", provenance: ["Hall: 168.74 m² (printed)", "room-id:r1"] }),
    row("hire:Internal", 8, { source: "MANUAL", runId: null, unit: "weeks" }),
    row("hire:Internal Birdcage", 4, { source: "MANUAL", runId: null, unit: "weeks" }),
  ];
  const card = readBuildingCard(rows, "b", params, [], 16);
  it("each card gives its main line with its own hire", () => {
    const core = coreLines(card);
    expect(core.map((c) => [c.cardKey, c.quantity, c.hireWeeks])).toEqual([
      ["int:run", 40, 8],
      ["bc:area", 168.74, 4],
    ]);
    expect(card.birdcage.roomIds).toEqual(["r1"]);
  });
  it("inspections run for the longest hire across the cards", () => {
    expect(longestHire([card], 16)).toBe(16);
    expect(longestHire([readBuildingCard(rows, "b", params, [], null)], null)).toBe(8);
  });
});
