import { describe, it, expect } from "vitest";
import { PARAM_DEFS, paramFlags, paramNumber, resolveJobParams } from "./params";
import { CONSTRUCTION_ELEMENT_SEED, isDevPlaceholder } from "./library";

describe("job params (docs/23 §16)", () => {
  it("defaults are the documented placeholders, all unconfirmed", () => {
    const p = resolveJobParams(null);
    expect(paramNumber(p, "P1_liftHeightM")).toBe(2);
    expect(paramNumber(p, "P4_cornerAllowanceM")).toBe(1);
    expect(PARAM_DEFS.every((d) => !d.confirmed)).toBe(true);
  });
  it("a valid override wins; a wrong type, bad choice or negative is ignored", () => {
    const p = resolveJobParams({
      P1_liftHeightM: { value: 1.8, confirmed: true },
      P4_cornerAllowanceM: { value: "lots" },
      P9_gablesCounted: { value: "SOME" },
      P2b_dpcAboveGroundM: { value: -1 },
      NOT_A_PARAM: { value: 1 },
    });
    expect(paramNumber(p, "P1_liftHeightM")).toBe(1.8);
    expect(p.P1_liftHeightM.overridden).toBe(true);
    expect(p.P1_liftHeightM.confirmed).toBe(true);
    expect(paramNumber(p, "P4_cornerAllowanceM")).toBe(1);
    expect(p.P9_gablesCounted.value).toBe("MAIN_ONLY");
    expect(paramNumber(p, "P2b_dpcAboveGroundM")).toBe(0.15);
  });
  it("garbage stored JSON falls back to the defaults", () => {
    expect(paramNumber(resolveJobParams("nonsense"), "P1_liftHeightM")).toBe(2);
  });
  it("flags only unconfirmed params, once each", () => {
    const p = resolveJobParams({ P1_liftHeightM: { value: 2, confirmed: true } });
    const flags = paramFlags(p, ["P1_liftHeightM", "P4_cornerAllowanceM", "P4_cornerAllowanceM"]);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain("Corner allowance");
  });
});

describe("dev picking list (docs/22 §4.0)", () => {
  it("every item is badged as a DEV placeholder", () => {
    expect(CONSTRUCTION_ELEMENT_SEED.every((e) => isDevPlaceholder(e.defaultRuleNote))).toBe(true);
  });
  it("ids are unique and the 13 original ids are kept", () => {
    const ids = CONSTRUCTION_ELEMENT_SEED.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [
      "ce-independent-scaffold", "ce-double-handrail", "ce-single-handrail", "ce-triple-handrail",
      "ce-toe-board", "ce-haki-stair", "ce-loading-bay", "ce-rubbish-chute", "ce-birdcage",
      "ce-lift-gate", "ce-scaffold-mat", "ce-foam", "ce-inspection",
    ]) expect(ids).toContain(id);
  });
  it("each item has one rate per (band, bracket), every rate carries hire terms", () => {
    for (const e of CONSTRUCTION_ELEMENT_SEED) {
      const keys = e.rates.map((r) => `${r.band}|${r.bracket}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(new Set(e.rates.map((r) => r.band)).size).toBe(4);
      if (e.usesHeightBracket) expect(e.rates.some((r) => r.bracket === "H24_30M")).toBe(true);
      else expect(e.rates.every((r) => r.bracket === "ANY")).toBe(true);
      for (const r of e.rates) {
        expect(r.rate).toBeGreaterThan(0);
        expect(r.extraHireChargePct).toBeGreaterThan(0);
      }
    }
  });
  it("aliases are unique across the list (a scope word maps to one item)", () => {
    const seen = new Map<string, string>();
    for (const e of CONSTRUCTION_ELEMENT_SEED)
      for (const a of e.aliases) {
        const k = a.toLowerCase();
        expect(seen.get(k) ?? e.id, `alias "${a}" on ${e.id} and ${seen.get(k)}`).toBe(e.id);
        seen.set(k, e.id);
      }
  });
  it("the King Edward scope words each have a home", () => {
    const words = [
      "independent tied scaffold", "lifts at each level", "triple guardrails & toe boards",
      "ladder access bays", "staircase access towers", "slab edge protection",
      "edge protection (lift, stairs, risers)", "leading edge protection", "loading bays",
      "loading bay platforms", "gates", "blockwork walls", "lift shaft internal scaffold",
      "stair core access scaffold", "riser access platform", "roof edge protection",
      "access", "temporary handrails", "adaptions",
    ];
    const all = new Set(CONSTRUCTION_ELEMENT_SEED.flatMap((e) => e.aliases.map((a) => a.toLowerCase())));
    for (const w of words) expect(all.has(w), w).toBe(true);
  });
});
