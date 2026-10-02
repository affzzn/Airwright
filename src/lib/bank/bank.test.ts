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
import { compareGeometry, findRepeats, compareWithEntry, builderKey, type BankEntryRef } from "./match";

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

describe("findRepeats (upload-time, whole bank, no geometry)", () => {
  const MILLER = builderKey("Miller Homes");
  const BLOOR = builderKey("Bloor Homes");
  const entry = (id: string, name: string, code: string | null, extra: Partial<BankEntryRef> = {}): BankEntryRef => ({
    entryId: id,
    buildType: "TRADITIONAL",
    canonicalName: name,
    canonicalCode: code,
    aliases: [],
    builderKey: MILLER,
    ...extra,
  });
  const bank = [
    entry("denton", "Denton", "L356"),
    entry("delmont", "Delmont", "L255"),
    entry("millfield", "Millfield", "BUNG12"),
    entry("trent", "The Trent", "B5", { builderKey: builderKey("Vistry") }),
    entry("tf-b5", "B5", "B5", { buildType: "TIMBER_FRAME", builderKey: builderKey("Vistry") }),
  ];
  const find = (name: string, code: string | null, builder = MILLER, buildType: "TRADITIONAL" | "TIMBER_FRAME" = "TRADITIONAL") =>
    findRepeats({ name, code, builderKey: builder, buildType }, bank);

  it.each([
    "Denton",
    "DENTON",
    "Denton-XYZ",
    "Denton XYZ",
    "The Denton (Semi)",
    "Denton 2B",
    "11. 250814 Denton",
    "Denton LH",
    "Denton House Type",
  ])("finds Denton for %s (not too strict)", (name) => {
    const r = find(name, null);
    expect(r[0]?.entryId).toBe("denton");
    expect(r[0]?.strength).toBe("STRONG");
  });

  it("finds a repeat from ANOTHER builder — the builder is never a filter", () => {
    const r = find("Denton", null, BLOOR);
    expect(r[0]).toMatchObject({ entryId: "denton", strength: "STRONG", sameBuilder: false });
  });

  it("ranks the same builder's entry first when two builders have the name", () => {
    const two = [...bank, entry("denton-bloor", "Denton", null, { builderKey: BLOOR })];
    const r = findRepeats({ name: "Denton", code: null, builderKey: BLOOR, buildType: "TRADITIONAL" }, two);
    expect(r.map((x) => x.entryId).slice(0, 2)).toEqual(["denton-bloor", "denton"]);
  });

  it("the same code finds it whatever the name (same builder)", () => {
    const r = find("Type A", "L356");
    expect(r[0]).toMatchObject({ entryId: "denton", strength: "STRONG", reason: "code" });
  });

  it("a short code from another builder with an unrelated name is only POSSIBLE", () => {
    const r = find("Aspen", "B5", MILLER);
    expect(r[0]).toMatchObject({ entryId: "trent", strength: "POSSIBLE", reason: "code" });
  });

  it("a learned alias is a STRONG hit", () => {
    const withAlias = [entry("denton", "Denton", "L356", { aliases: ["Kensington"] })];
    const r = findRepeats({ name: "Kensington", code: null, builderKey: BLOOR, buildType: "TRADITIONAL" }, withAlias);
    expect(r[0]).toMatchObject({ strength: "STRONG", reason: "alias" });
  });

  it("a typo is still found (Milfield → Millfield)", () => {
    expect(find("Milfield", null)[0]?.entryId).toBe("millfield");
  });

  it("'The Sowe' and 'Sowe' are the same name", () => {
    const r = findRepeats(
      { name: "Sowe", code: null, builderKey: MILLER, buildType: "TRADITIONAL" },
      [entry("sowe", "The Sowe", null)],
    );
    expect(r[0]?.strength).toBe("STRONG");
  });

  it("a similar-but-different name is offered as POSSIBLE, not STRONG", () => {
    const r = find("Benton", null);
    expect(r[0]).toMatchObject({ entryId: "denton", strength: "POSSIBLE" });
  });

  it("an unrelated name finds nothing", () => {
    expect(find("Aspen", null)).toEqual([]);
    expect(find("Hayton", "AL30")).toEqual([]);
  });

  it("never matches across build types (TF B5 vs traditional B5)", () => {
    const r = find("B5", "B5", builderKey("Vistry"), "TIMBER_FRAME");
    expect(r.map((x) => x.entryId)).toEqual(["tf-b5"]);
  });

  it("builderKey folds case, spacing and punctuation", () => {
    expect(builderKey(" Bloor  Homes ")).toBe(builderKey("BLOOR homes"));
  });
});

describe("compareWithEntry (Save to house bank)", () => {
  const v = (n: number, snap: TakeoffSnapshot) => ({ versionId: `v${n}`, version: n, snapshot: snap });
  const moved = dentonSnapshot({
    walls: [
      { position: "FRONT", lengthM: 8.6 },
      { position: "REAR", lengthM: 8.6 },
      { position: "GABLE_LEFT", lengthM: 6.5 },
      { position: "GABLE_RIGHT", lengthM: 6.5 },
    ],
  });

  it("same numbers as a stored version → nothing new to save", () => {
    const c = compareWithEntry(dentonSnapshot(), [v(1, dentonSnapshot())]);
    expect(c.identicalTo).toEqual({ versionId: "v1", version: 1 });
  });

  it("matches an OLDER version too (v1 picked again after v2 was saved)", () => {
    const c = compareWithEntry(dentonSnapshot(), [v(1, dentonSnapshot()), v(2, moved)]);
    expect(c.identicalTo?.version).toBe(1);
    expect(c.nextVersion).toBe(3);
  });

  it("different numbers → the diff against the newest version + the next version number", () => {
    const c = compareWithEntry(moved, [v(1, dentonSnapshot())]);
    expect(c.identicalTo).toBeNull();
    expect(c.latest?.comparison?.verdict).toBe("CHANGED");
    expect(c.latest?.comparison?.diffs.map((d) => d.label)).toEqual(["Front wall", "Rear wall"]);
    expect(c.nextVersion).toBe(2);
  });
});
