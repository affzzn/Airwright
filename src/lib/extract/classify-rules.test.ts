import { describe, expect, it } from "vitest";
import {
  classifyByText,
  classifyTitle,
  extractHouseTypeRef,
} from "./classify-rules";

describe("classifyTitle", () => {
  it("keeps take-off sheets", () => {
    expect(classifyTitle("Front Elevation")).toBe("ELEVATION");
    expect(classifyTitle("Ground Floor Plan")).toBe("FLOOR_PLAN");
    expect(classifyTitle("Section A-A")).toBe("SECTION");
    expect(classifyTitle("House Type Specification")).toBe("SPEC");
  });

  it("treats a building Setting Out Plan as a floor plan, but not a civils one", () => {
    expect(classifyTitle("Setting Out Plan")).toBe("FLOOR_PLAN");
    expect(classifyTitle("Road Setting Out Plan")).toBe("OTHER");
    expect(classifyTitle("Site Setting Out Plan")).toBe("OTHER");
  });

  it("excludes irrelevant disciplines and site/plot layouts", () => {
    expect(classifyTitle("Site Layout")).toBe("OTHER");
    expect(classifyTitle("Plot Schedule")).toBe("OTHER");
    expect(classifyTitle("Drainage Layout")).toBe("OTHER");
    expect(classifyTitle("Bar Schedule")).toBe("OTHER");
    expect(classifyTitle("Long Section")).toBe("OTHER");
    expect(classifyTitle("Kitchen Layout")).toBe("OTHER");
  });
});

describe("classifyByText fallback", () => {
  it("recognises external elevations but not internal room elevations", () => {
    expect(classifyByText("PROPOSED FRONT ELEVATION").kind).toBe("ELEVATION");
    expect(classifyByText("KITCHEN ELEVATIONS").kind).toBe("OTHER");
  });

  it("does not treat civils long-sections as a house section", () => {
    expect(classifyByText("LONG SECTIONS SHEET 3").kind).toBe("OTHER");
    expect(classifyByText("SECTION A-A").kind).toBe("SECTION");
  });
});

describe("extractHouseTypeRef", () => {
  it("reads the portfolio line code + name", () => {
    const ref = extractHouseTypeRef(
      "L464 - 4B / 8P / 1337 - CHESTERWOOD 2024 NATIONAL PORTFOLIO",
    );
    expect(ref.code).toBe("1337");
    expect(ref.name).toBe("CHESTERWOOD");
  });
});
