import { describe, it, expect } from "vitest";
import { findHouseType } from "./persistPlots";

const houseTypes = [
  { id: "ht1", code: "1337", name: "Chesterwood" },
  { id: "ht2", code: "1450", name: "Wollaton" },
  { id: "ht3", code: null, name: "Bespoke Corner" },
];

describe("findHouseType", () => {
  it("matches by code first", () => {
    expect(findHouseType("1450", "wrong name", houseTypes)?.id).toBe("ht2");
  });

  it("matches by name (case-insensitive) when code is absent", () => {
    expect(findHouseType(null, "chesterwood", houseTypes)?.id).toBe("ht1");
  });

  it("matches a code-less house type by name", () => {
    expect(findHouseType(null, "Bespoke Corner", houseTypes)?.id).toBe("ht3");
  });

  it("returns null when nothing matches", () => {
    expect(findHouseType("9999", "Unknown", houseTypes)).toBeNull();
  });
});
