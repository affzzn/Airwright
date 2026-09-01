import { describe, expect, it } from "vitest";
import { CROSS_CHECKS, GLOSSARY, MEASUREMENTS, SCHEMA_FIELDS } from "./index";
import { LIVE } from "./live";

/**
 * Drift guards for the Dev spec content: the hand-authored data must line up with
 * the live code (the schema field names) and be internally consistent (every
 * cross-check / glossary / measurement reference resolves).
 */
describe("dev-spec drift guards", () => {
  it("the contract table matches the live Zod schema field names", () => {
    const authored = SCHEMA_FIELDS.map((f) => f.name).sort();
    const live = [...LIVE.schemaFieldNames].sort();
    expect(authored).toEqual(live);
  });

  it("every measurement cross-check id resolves", () => {
    const ids = new Set(CROSS_CHECKS.map((c) => c.id));
    for (const m of MEASUREMENTS)
      for (const cc of m.crossChecks ?? [])
        expect(ids, `measurement "${m.id}" → cross-check "${cc}"`).toContain(cc);
  });

  it("every measurement related-term id resolves in the glossary", () => {
    const ids = new Set(GLOSSARY.map((t) => t.id));
    for (const m of MEASUREMENTS)
      for (const term of m.relatedTerms ?? [])
        expect(ids, `measurement "${m.id}" → term "${term}"`).toContain(term);
  });

  it("ids are unique within each list", () => {
    const uniq = (xs: string[]) => new Set(xs).size === xs.length;
    expect(uniq(MEASUREMENTS.map((m) => m.id))).toBe(true);
    expect(uniq(CROSS_CHECKS.map((c) => c.id))).toBe(true);
    expect(uniq(GLOSSARY.map((t) => t.id))).toBe(true);
  });
});
