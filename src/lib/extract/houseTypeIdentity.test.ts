import { describe, it, expect } from "vitest";
import { cleanHouseTypeName, cleanHouseTypeCode, resolveHouseTypeIdentity } from "./houseTypeIdentity";

describe("cleanHouseTypeName", () => {
  it("strips leading index + combined-working-drawings + rev noise", () => {
    expect(cleanHouseTypeName("19. B11 Burcot Bungalow_Combined Working Drawings")).toBe(
      "B11 Burcot Bungalow",
    );
    expect(cleanHouseTypeName("24. AL40_Taywood_Combined Working Drawings")).toBe("AL40 Taywood");
    expect(cleanHouseTypeName("22. AL22_Shermont_Combined Working Drawings_Rev A")).toBe(
      "AL22 Shermont",
    );
  });
  it("never returns empty (falls back to the raw)", () => {
    expect(cleanHouseTypeName("Working Drawings")).toBe("Working Drawings");
  });
});

describe("cleanHouseTypeCode", () => {
  it("strips the bed/person/area schedule tail", () => {
    expect(cleanHouseTypeCode("B11 - 1B / 2P / 531")).toBe("B11");
    expect(cleanHouseTypeCode("L363 - 3B / 5P / 1069")).toBe("L363");
    expect(cleanHouseTypeCode("L356 3B / 5P / 908")).toBe("L356");
    expect(cleanHouseTypeCode("AL21 2B / 4P / 702")).toBe("AL21");
    expect(cleanHouseTypeCode("L201 DT 2B / 4P / 1081")).toBe("L201 DT");
  });
  it("returns null for a schedule-only or pure-number code", () => {
    expect(cleanHouseTypeCode("3B / 5P / 1116")).toBeNull();
    expect(cleanHouseTypeCode("758")).toBeNull();
    expect(cleanHouseTypeCode(null)).toBeNull();
  });
  it("keeps a clean code untouched", () => {
    expect(cleanHouseTypeCode("L461")).toBe("L461");
    expect(cleanHouseTypeCode("ROSEWOOD")).toBe("ROSEWOOD");
  });
});

describe("resolveHouseTypeIdentity", () => {
  it("prefers the AI-read name + code when confident", () => {
    const r = resolveHouseTypeIdentity({
      extractedName: "Burcot",
      extractedConfidence: "high",
      extractedCode: "B11",
      currentName: "19. B11 Burcot Bungalow_Combined Working Drawings",
      currentCode: null,
    });
    expect(r).toEqual({ name: "Burcot", code: "B11", usedExtractedName: true });
  });

  it("falls back to a cleaned file name when the AI name is unknown", () => {
    const r = resolveHouseTypeIdentity({
      extractedName: null,
      extractedConfidence: "unknown",
      extractedCode: null,
      currentName: "24. AL40_Taywood_Combined Working Drawings",
      currentCode: null,
    });
    expect(r.name).toBe("AL40 Taywood");
    expect(r.usedExtractedName).toBe(false);
  });

  it("keeps a stored code when the AI didn't read one", () => {
    const r = resolveHouseTypeIdentity({
      extractedName: "Delmont",
      extractedConfidence: "high",
      extractedCode: null,
      currentName: "Delmont",
      currentCode: "L255",
    });
    expect(r.code).toBe("L255");
  });
});
