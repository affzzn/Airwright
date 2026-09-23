import { describe, it, expect } from "vitest";
import {
  STRUCTURE_FORMS,
  configFromStructure,
  normalizeStructureForm,
  readPartyGables,
  resolveConfiguration,
  type StructureForm,
} from "./structure";
import { configurationBasisFrom, configurationProvenance } from "./provenance";

describe("configFromStructure — the structure → position mapping", () => {
  it("keeps the exact config VALUES the extractor used before (no repricing)", () => {
    // The pre-existing inline maps in persist.ts / plots.ts. This is the
    // regression guard: centralising the mapping must not move a single number.
    const LEGACY: Record<StructureForm, string> = {
      DETACHED: "DETACHED",
      PAIR_SEMI: "SEMI_DETACHED",
      THREE_BLOCK: "END_TERRACE",
      TERRACE: "END_TERRACE",
      APARTMENT_BLOCK: "DETACHED",
    };
    for (const form of STRUCTURE_FORMS) {
      expect(configFromStructure(form, "high").config).toBe(LEGACY[form]);
    }
  });

  it("only a detached house and a semi PAIR determine the position", () => {
    expect(configFromStructure("DETACHED", "high").certain).toBe(true);
    // Both homes in a pair are semis, so the drawing fixes it.
    expect(configFromStructure("PAIR_SEMI", "high").certain).toBe(true);
  });

  it("a three-block / terrace is a DEFAULT, not an answer (it contains mids)", () => {
    for (const form of ["THREE_BLOCK", "TERRACE"] as const) {
      const d = configFromStructure(form, "high");
      expect(d.config).toBe("END_TERRACE");
      expect(d.certain).toBe(false);
      expect(d.reason).toMatch(/mid-terrace/i);
    }
  });

  it("an unreadable structure flags instead of silently defaulting (the bug)", () => {
    for (const form of [null, undefined]) {
      const d = configFromStructure(form);
      expect(d.config).toBe("DETACHED"); // still the safe, larger scaffold
      expect(d.certain).toBe(false); // but never presented as read
      expect(d.reason).toMatch(/could not be read/i);
    }
  });

  it("a determinate form read with poor confidence is still not certain", () => {
    for (const conf of ["low", "unknown"]) {
      expect(configFromStructure("PAIR_SEMI", conf).certain).toBe(false);
      expect(configFromStructure("PAIR_SEMI", conf).config).toBe("SEMI_DETACHED");
    }
    expect(configFromStructure("PAIR_SEMI", "medium").certain).toBe(true);
    expect(configFromStructure("PAIR_SEMI", "high").certain).toBe(true);
  });

  it("an apartment block is certain — the value is a placeholder the engine ignores", () => {
    const d = configFromStructure("APARTMENT_BLOCK", "high");
    expect(d.certain).toBe(true);
    expect(d.reason).toMatch(/whole building/i);
  });

  it("every form returns a non-empty reason", () => {
    for (const form of STRUCTURE_FORMS)
      expect(configFromStructure(form, "high").reason.length).toBeGreaterThan(20);
  });

  it("legacy stored forms normalise before mapping (PAIR_OR_TERRACE → semi)", () => {
    const form = normalizeStructureForm("PAIR_OR_TERRACE", 2);
    expect(configFromStructure(form, "high").config).toBe("SEMI_DETACHED");
    const terrace = normalizeStructureForm("PAIR_OR_TERRACE", 5);
    expect(configFromStructure(terrace, "high").config).toBe("END_TERRACE");
    expect(configFromStructure(terrace, "high").certain).toBe(false);
  });
});

describe("configurationProvenance — what the estimator is shown", () => {
  it("says a terrace default is a DEFAULT, not a read", () => {
    const d = configFromStructure("TERRACE", "high");
    const c = configurationProvenance("END_TERRACE", d, "TERRACE", "high");
    expect(c.steps.some((s) => /DEFAULT, not an answer/.test(s.text))).toBe(true);
    expect(c.summary).toMatch(/needs confirming/i);
    expect(c.footnotes.join(" ")).toMatch(/Review flags/);
  });

  it("states it was determined when the drawing fixes it", () => {
    const d = configFromStructure("PAIR_SEMI", "high");
    const c = configurationProvenance("SEMI_DETACHED", d, "PAIR_SEMI", "high");
    expect(c.steps.some((s) => /determined by the drawing/.test(s.text))).toBe(true);
    expect(c.confidenceLabel).toBe("high");
  });

  it("records a human override rather than hiding it", () => {
    const d = configFromStructure("TERRACE", "high");
    const c = configurationProvenance("MID_TERRACE", d, "TERRACE", "high");
    expect(c.steps.some((s) => /Changed on review to Mid-terrace/.test(s.text))).toBe(true);
  });

  it("makes no claim when the structure could not be read", () => {
    const d = configFromStructure(null);
    const c = configurationProvenance("DETACHED", d, null, "unknown");
    expect(c.steps[0].text).toMatch(/could not be read/i);
  });
});

describe("configurationBasisFrom — which source the review screen trusts", () => {
  const RAW = { structure: { form: "PAIR_SEMI", confidence: "high" } };
  const STORED = {
    configurationBasis: {
      config: "END_TERRACE",
      certain: false,
      reason: "stored reason",
      structure: "TERRACE",
      confidence: "medium",
    },
  };

  it("prefers the verbatim model output over the stored basis", () => {
    const b = configurationBasisFrom(RAW, STORED);
    expect(b.form).toBe("PAIR_SEMI");
    expect(b.derived?.config).toBe("SEMI_DETACHED");
    expect(b.derived?.certain).toBe(true);
  });

  it("falls back to the basis the extractor stored (legacy rows keep provenance)", () => {
    const b = configurationBasisFrom(null, STORED);
    expect(b.form).toBe("TERRACE");
    expect(b.confidence).toBe("medium");
    expect(b.derived).toEqual({ config: "END_TERRACE", certain: false, reason: "stored reason" });
  });

  it("makes NO claim when there is neither (never invents certainty)", () => {
    const b = configurationBasisFrom(null, {});
    expect(b).toEqual({ derived: null, form: null, confidence: null });
    // and the card built from it states the limitation rather than asserting
    const c = configurationProvenance("DETACHED", b.derived, b.form, b.confidence);
    expect(c.steps.some((s) => /could not be read/i.test(s.text))).toBe(true);
  });

  it("a malformed stored basis degrades to uncertain, not to certain", () => {
    const b = configurationBasisFrom(null, { configurationBasis: { config: "DETACHED" } });
    expect(b.derived?.certain).toBe(false);
  });

  it("normalises a legacy structure value coming off raw", () => {
    const b = configurationBasisFrom(
      { structure: { form: "PAIR_OR_TERRACE", confidence: "high" } },
      {},
    );
    expect(b.derived?.config).toBe("SEMI_DETACHED");
  });
});


describe("resolveConfiguration — party walls decide, structure breaks the tie", () => {
  const G = (left: boolean | null, right: boolean | null) => ({ left, right });
  const NONE = G(null, null);

  it("0 party gables → DETACHED, on the party-wall basis", () => {
    const r = resolveConfiguration("DETACHED", "high", G(false, false));
    expect(r).toMatchObject({ config: "DETACHED", certain: true, basis: "party-walls" });
  });
  it("2 party gables → MID_TERRACE", () => {
    expect(resolveConfiguration("TERRACE", "high", G(true, true)).config).toBe("MID_TERRACE");
  });

  // The refinement: one party gable is a semi OR an end terrace, and only the
  // structure form can tell them apart.
  it("1 party gable + a PAIR → SEMI_DETACHED", () => {
    expect(resolveConfiguration("PAIR_SEMI", "high", G(true, false)).config).toBe("SEMI_DETACHED");
  });
  it("1 party gable + a TERRACE → END_TERRACE (not semi)", () => {
    const r = resolveConfiguration("TERRACE", "high", G(false, true));
    expect(r.config).toBe("END_TERRACE");
    expect(r.reason).toMatch(/END terrace/i);
  });
  it("1 party gable + a THREE_BLOCK → END_TERRACE", () => {
    expect(resolveConfiguration("THREE_BLOCK", "high", G(true, false)).config).toBe("END_TERRACE");
  });

  it("a TERRACE no longer DEFAULTS — the party walls give a real answer", () => {
    // Before: structure alone forced END_TERRACE with certain=false for every plot.
    expect(configFromStructure("TERRACE", "high")).toMatchObject({ certain: false });
    expect(resolveConfiguration("TERRACE", "high", G(true, true))).toMatchObject({
      config: "MID_TERRACE",
      certain: true,
    });
  });

  it("a POSITIVE party sighting beats a 'detached' form, flagged", () => {
    const r = resolveConfiguration("DETACHED", "high", G(true, false));
    expect(r.config).toBe("SEMI_DETACHED"); // the sighting wins
    expect(r.certain).toBe(false); // but it is flagged, not asserted
    expect(r.reason).toMatch(/CONTRADICTS/);
  });

  // The asymmetry — the regression found live on Bloor Sorley (2026-09-23).
  it("NO party sighting does NOT override an attached form (Sorley regression)", () => {
    const r = resolveConfiguration("PAIR_SEMI", "high", G(false, false));
    expect(r.config).toBe("SEMI_DETACHED"); // NOT downgraded to DETACHED
    expect(r.basis).toBe("structure");
  });
  it("same for a terrace with no party sighting", () => {
    expect(resolveConfiguration("TERRACE", "high", G(false, false)).config).toBe("END_TERRACE");
  });
  it("but no sighting AND a detached form still agrees → DETACHED", () => {
    const r = resolveConfiguration("DETACHED", "high", G(false, false));
    expect(r).toMatchObject({ config: "DETACHED", certain: true, basis: "party-walls" });
  });

  it("falls back to the structure form when either gable is unknown", () => {
    const r = resolveConfiguration("PAIR_SEMI", "high", G(true, null));
    expect(r.basis).toBe("structure");
    expect(r).toMatchObject({ config: "SEMI_DETACHED", certain: true });
  });
  it("unknown gables AND unreadable structure still flags rather than guessing", () => {
    const r = resolveConfiguration(null, "unknown", NONE);
    expect(r).toMatchObject({ config: "DETACHED", certain: false, basis: "structure" });
  });
});

describe("readPartyGables", () => {
  it("a gable is party when any of its segments says so", () => {
    expect(
      readPartyGables([
        { position: "gable_left", isPartyWall: null },
        { position: "gable_left", isPartyWall: true },
        { position: "gable_right", isPartyWall: false },
      ]),
    ).toEqual({ left: true, right: false });
  });
  it("is case-insensitive on the stored position (GABLE_LEFT vs gable_left)", () => {
    expect(readPartyGables([{ position: "GABLE_LEFT", isPartyWall: true }]).left).toBe(true);
  });
  it("a missing gable is unknown, not external", () => {
    expect(readPartyGables([{ position: "front", isPartyWall: false }])).toEqual({
      left: null,
      right: null,
    });
  });
});
