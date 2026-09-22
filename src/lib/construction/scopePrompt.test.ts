import { describe, it, expect } from "vitest";
import {
  buildPickingListContext,
  buildScopeUserText,
  SCOPE_SYSTEM_PROMPT,
} from "./scopePrompt";

const els = [
  { id: "ce-lift-gate", name: "Lift Gate", aliases: ["safegate"], unit: "NR" as const, usesLifts: false, category: "Protection" },
  { id: "ce-haki", name: "Haki Stair Tower", aliases: ["hacky stairs"], unit: "NR_PER_LIFT" as const, usesLifts: true, category: "Access" },
];

describe("buildPickingListContext", () => {
  it("lists each element with id, unit, per-lift and aliases", () => {
    const ctx = buildPickingListContext(els);
    expect(ctx).toContain("id=ce-lift-gate");
    expect(ctx).toContain("Lift Gate");
    expect(ctx).toContain("aka: safegate");
    expect(ctx).toContain("per-lift"); // Haki uses lifts
    expect(ctx).toContain("Access");
  });
  it("handles an empty list", () => {
    expect(buildPickingListContext([])).toMatch(/empty/i);
  });
});

describe("buildScopeUserText", () => {
  it("embeds the picking list and the scope text", () => {
    const text = buildScopeUserText(buildPickingListContext(els), "Safegates all levels");
    expect(text).toContain("PICKING LIST");
    expect(text).toContain("id=ce-haki");
    expect(text).toContain("Safegates all levels");
  });
  it("marks an empty scope", () => {
    expect(buildScopeUserText("x", "   ")).toContain("(empty)");
  });
});

describe("SCOPE_SYSTEM_PROMPT", () => {
  it("forbids inventing items and pricing", () => {
    expect(SCOPE_SYSTEM_PROMPT).toMatch(/never invent/i);
    expect(SCOPE_SYSTEM_PROMPT.toLowerCase()).toContain("do not price");
  });
});
