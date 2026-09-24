import { describe, it, expect } from "vitest";
import {
  serializeSnapshot,
  parseSnapshot,
  geometryFingerprint,
  perimeterTotal,
  wallSums,
  type TakeoffSnapshot,
} from "./snapshot";
import { normalizeName, normalizeCode, nameSimilarity } from "./normalize";
import { compareGeometry, matchAgainstBank, nameCodeMatch, type BankCandidateInput } from "./match";

/**
 * The bank matcher proves the core doctrine (docs/20 §1): identity is GEOMETRY,
 * the name is only a hint. These cover the snapshot round-trip + fingerprint, the
 * Denton/Denton-XYZ name problem, the geometry verdicts (identical / changed /
 * different) and the end-to-end match decision table.
 */

// A Miller "Denton": detached, 2-storey, pitched, 4 walls.
function dentonSnapshot(overrides: Partial<TakeoffSnapshot> = {}): TakeoffSnapshot {
  return {
    snapshotVersion: 1,
    buildType: "TRADITIONAL",
    configuration: "DETACHED",
    includePartyWall: false,
    measurements: {
      STOREYS: 2,
      HEIGHT_TO_SOFFIT: 5.2,
      GABLE_QTY: 2,
      BIRDCAGE_GF_M2: 45.7,
      BIRDCAGE_FF_M2: 45.7,
      CORNER_COUNT: 4,
      LOW_LEVEL_QTY: 1,
    },
    walls: [
      { position: "FRONT", lengthM: 8.2 },
      { position: "REAR", lengthM: 8.2 },
      { position: "GABLE_LEFT", lengthM: 6.5 },
      { position: "GABLE_RIGHT", lengthM: 6.5 },
    ],
    warnings: { roofType: "PITCHED", structure: "DETACHED", dwellingsWide: 1, roomInRoof: false },
    ...overrides,
  };
}

describe("snapshot", () => {
  it("serialises stored rows into a snapshot (only the editable keys, coerced)", () => {
    const snap = serializeSnapshot({
      buildType: "TRADITIONAL",
      configuration: "SEMI_DETACHED",
      includePartyWall: true,
      measurements: [
        { key: "STOREYS", valueNumber: 2 },
        { key: "HEIGHT_TO_SOFFIT", valueNumber: "5.2" },
        { key: "LIFTS", valueNumber: 4 }, // not a bank key → dropped
      ],
      walls: [{ position: "front", lengthM: "8.201" }],
      warnings: { structure: "PAIR_SEMI", dwellingsWide: 2, junk: "x" },
    });
    expect(snap.measurements.STOREYS).toBe(2);
    expect(snap.measurements.HEIGHT_TO_SOFFIT).toBe(5.2);
    expect("LIFTS" in snap.measurements).toBe(false);
    expect(snap.walls).toEqual([{ position: "FRONT", lengthM: 8.201 }]);
    expect(snap.warnings.structure).toBe("PAIR_SEMI");
    expect((snap.warnings as Record<string, unknown>).junk).toBeUndefined();
  });

  it("round-trips through parseSnapshot", () => {
    const snap = dentonSnapshot();
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(snap)));
    expect(parsed).not.toBeNull();
    expect(parsed!.measurements.STOREYS).toBe(2);
    expect(perimeterTotal(parsed!.walls)).toBeCloseTo(29.4, 3);
    expect(wallSums(parsed!.walls).GABLE_LEFT).toBeCloseTo(6.5, 3);
  });

  it("parseSnapshot rejects junk", () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot("nope")).toBeNull();
  });

  it("fingerprint is stable to sub-tolerance jitter and changes on a real change", () => {
    const base = geometryFingerprint(dentonSnapshot());
    const jitter = geometryFingerprint(
      dentonSnapshot({ measurements: { ...dentonSnapshot().measurements, HEIGHT_TO_SOFFIT: 5.203 } }),
    );
    expect(jitter).toBe(base); // 5.2 vs 5.203 rounds identically
    const changed = geometryFingerprint(
      dentonSnapshot({
        walls: [
          { position: "FRONT", lengthM: 8.6 },
          { position: "REAR", lengthM: 8.2 },
          { position: "GABLE_LEFT", lengthM: 6.5 },
          { position: "GABLE_RIGHT", lengthM: 6.5 },
        ],
      }),
    );
    expect(changed).not.toBe(base);
  });
});

describe("normalize", () => {
  it("strips file/revision noise + variant tokens", () => {
    expect(normalizeName("19. Denton_Combined Working Drawings Rev B")).toBe("denton");
    expect(normalizeName("Denton LH")).toBe("denton");
    expect(normalizeName("Denton (End)")).toBe("denton");
    expect(normalizeName("Denton Integral Garage")).toBe("denton");
  });

  it("Denton vs Denton-XYZ reads as a strong name candidate (prefix)", () => {
    const sim = nameSimilarity(normalizeName("Denton"), normalizeName("Denton XYZ"));
    expect(sim.prefix).toBe(true);
    expect(sim.score).toBeGreaterThanOrEqual(0.85);
  });

  it("a genuinely different name scores low", () => {
    const sim = nameSimilarity(normalizeName("Denton"), normalizeName("Aspen"));
    expect(sim.score).toBeLessThan(0.6);
  });

  it("normalizeCode reuses the shared cleaner", () => {
    expect(normalizeCode("L363")).toBe("l363");
    expect(normalizeCode("758")).toBeNull(); // pure number = area, not a code
  });
});

describe("compareGeometry", () => {
  it("IDENTICAL when everything is within tolerance", () => {
    const a = dentonSnapshot();
    const b = dentonSnapshot({
      measurements: { ...dentonSnapshot().measurements, HEIGHT_TO_SOFFIT: 5.25 }, // within 0.2
    });
    const cmp = compareGeometry(a, b);
    expect(cmp.verdict).toBe("IDENTICAL");
    expect(cmp.diffs).toHaveLength(0);
  });

  it("CHANGED when a wall moved beyond tolerance but the type is the same", () => {
    const a = dentonSnapshot();
    const b = dentonSnapshot({
      walls: [
        { position: "FRONT", lengthM: 8.55 }, // +0.35 → beyond 0.2
        { position: "REAR", lengthM: 8.2 },
        { position: "GABLE_LEFT", lengthM: 6.5 },
        { position: "GABLE_RIGHT", lengthM: 6.5 },
      ],
    });
    const cmp = compareGeometry(a, b);
    expect(cmp.verdict).toBe("CHANGED");
    expect(cmp.diffs.some((d) => d.field === "wall_front")).toBe(true);
    expect(cmp.breakers).toHaveLength(0);
  });

  it("DIFFERENT when storeys differ (an identity breaker)", () => {
    const a = dentonSnapshot();
    const b = dentonSnapshot({ measurements: { ...dentonSnapshot().measurements, STOREYS: 3 } });
    const cmp = compareGeometry(a, b);
    expect(cmp.verdict).toBe("DIFFERENT");
    expect(cmp.breakers).toContain("storeys");
  });

  it("DIFFERENT when the perimeter drifts far (a different house)", () => {
    const a = dentonSnapshot();
    const b = dentonSnapshot({
      walls: [
        { position: "FRONT", lengthM: 12 },
        { position: "REAR", lengthM: 12 },
        { position: "GABLE_LEFT", lengthM: 9 },
        { position: "GABLE_RIGHT", lengthM: 9 },
      ],
    });
    const cmp = compareGeometry(a, b);
    expect(cmp.verdict).toBe("DIFFERENT");
    expect(cmp.breakers).toContain("perimeter");
  });
});

describe("matchAgainstBank", () => {
  const dentonEntry: BankCandidateInput = {
    entryId: "e-denton",
    buildType: "TRADITIONAL",
    canonicalName: "Denton",
    canonicalCode: "L363",
    aliases: [],
    snapshot: dentonSnapshot(),
  };

  it("NEW when nothing matches", () => {
    const r = matchAgainstBank(
      { buildType: "TRADITIONAL", name: "Aspen", code: null, snapshot: dentonSnapshot() },
      [dentonEntry],
    );
    expect(r.state).toBe("NEW");
    expect(r.best).toBeNull();
  });

  it("REUSE: same name + identical geometry → one-click reuse", () => {
    const r = matchAgainstBank(
      { buildType: "TRADITIONAL", name: "Denton", code: "L363", snapshot: dentonSnapshot() },
      [dentonEntry],
    );
    expect(r.state).toBe("REUSE");
    expect(r.best?.kind).toBe("REUSE");
    expect(r.best?.codeEqual).toBe(true);
  });

  it("CHANGED: Denton-XYZ, same geometry-family but a wall moved → flag the diff", () => {
    const moved = dentonSnapshot({
      walls: [
        { position: "FRONT", lengthM: 8.6 },
        { position: "REAR", lengthM: 8.2 },
        { position: "GABLE_LEFT", lengthM: 6.5 },
        { position: "GABLE_RIGHT", lengthM: 6.5 },
      ],
    });
    const r = matchAgainstBank(
      { buildType: "TRADITIONAL", name: "Denton XYZ", code: null, snapshot: moved },
      [dentonEntry],
    );
    expect(r.state).toBe("CHANGED");
    expect(r.best?.geometry?.diffs.some((d) => d.field === "wall_front")).toBe(true);
  });

  it("AMBIGUOUS: named like Denton but the measurements are a different house", () => {
    const big = dentonSnapshot({
      walls: [
        { position: "FRONT", lengthM: 12 },
        { position: "REAR", lengthM: 12 },
        { position: "GABLE_LEFT", lengthM: 9 },
        { position: "GABLE_RIGHT", lengthM: 9 },
      ],
    });
    const r = matchAgainstBank(
      { buildType: "TRADITIONAL", name: "Denton", code: null, snapshot: big },
      [dentonEntry],
    );
    expect(r.state).toBe("AMBIGUOUS");
    expect(r.best?.kind).toBe("AMBIGUOUS");
  });

  it("a learned alias makes Denton-XYZ an exact hit", () => {
    const withAlias: BankCandidateInput = { ...dentonEntry, aliases: ["Denton XYZ"] };
    const r = matchAgainstBank(
      { buildType: "TRADITIONAL", name: "Denton XYZ", code: null, snapshot: dentonSnapshot() },
      [withAlias],
    );
    expect(r.best?.aliasHit).toBe(true);
    expect(r.state).toBe("REUSE");
  });

  it("never matches across build types", () => {
    const r = matchAgainstBank(
      { buildType: "TIMBER_FRAME", name: "Denton", code: "L363", snapshot: dentonSnapshot({ buildType: "TIMBER_FRAME" }) },
      [dentonEntry],
    );
    expect(r.state).toBe("NEW");
  });
});

describe("nameCodeMatch (upload-time, no geometry)", () => {
  const dentonEntry: BankCandidateInput = {
    entryId: "e-denton",
    buildType: "TRADITIONAL",
    canonicalName: "Denton",
    canonicalCode: "L363",
    aliases: ["Denton XYZ"],
    snapshot: null,
  };

  it("suggests on an exact code match", () => {
    const hits = nameCodeMatch({ buildType: "TRADITIONAL", name: "Something", code: "L363" }, [dentonEntry]);
    expect(hits[0]?.entryId).toBe("e-denton");
    expect(hits[0]?.codeEqual).toBe(true);
  });

  it("suggests on a learned alias", () => {
    const hits = nameCodeMatch({ buildType: "TRADITIONAL", name: "Denton XYZ", code: null }, [dentonEntry]);
    expect(hits[0]?.aliasHit).toBe(true);
  });

  it("suggests on a strong name (prefix), no code", () => {
    const hits = nameCodeMatch({ buildType: "TRADITIONAL", name: "Denton", code: null }, [dentonEntry]);
    expect(hits[0]?.entryId).toBe("e-denton");
  });

  it("does NOT suggest on a weak/unrelated name", () => {
    expect(nameCodeMatch({ buildType: "TRADITIONAL", name: "Aspen", code: null }, [dentonEntry])).toHaveLength(0);
  });

  it("does NOT suggest across build types", () => {
    expect(nameCodeMatch({ buildType: "TIMBER_FRAME", name: "Denton", code: "L363" }, [dentonEntry])).toHaveLength(0);
  });
});
