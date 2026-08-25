import { describe, it, expect } from "vitest";
import { extractHouseTypeRef, type PageClass } from "./classify";
import { segmentByHouseType } from "./segment";

describe("extractHouseTypeRef", () => {
  it("reads code + name from a Miller portfolio line", () => {
    const raw =
      "L464 - 4B / 8P / 1337 - CHESTERWOOD 2024 NATIONAL PORTFOLIO F R O N T";
    expect(extractHouseTypeRef(raw)).toEqual({
      code: "1337",
      name: "CHESTERWOOD",
    });
  });

  it("returns nulls when there is no portfolio line", () => {
    expect(extractHouseTypeRef("just some drawing text")).toEqual({
      code: null,
      name: null,
    });
  });
});

describe("segmentByHouseType", () => {
  const page = (
    page: number,
    code: string | null,
    name: string | null,
    relevant = true,
  ): PageClass => ({
    page,
    kind: relevant ? "ELEVATION" : "OTHER",
    relevant,
    houseTypeCode: code,
    houseTypeName: name,
    title: "",
  });

  it("groups relevant pages by house-type code across a combined pack", () => {
    const pages: PageClass[] = [
      page(1, "1337", "CHESTERWOOD"),
      page(2, "1337", "CHESTERWOOD"),
      page(3, null, null, false), // irrelevant, ignored
      page(4, "1450", "WOLLATON"),
      page(5, "1450", "WOLLATON"),
    ];
    const groups = segmentByHouseType(pages);
    expect(groups).toHaveLength(2);

    const chester = groups.find((g) => g.code === "1337")!;
    expect(chester.name).toBe("CHESTERWOOD");
    expect(chester.pages).toEqual([1, 2]);
    expect(chester.pageRange).toBe("1-2");

    const wollaton = groups.find((g) => g.code === "1450")!;
    expect(wollaton.pageRange).toBe("4-5");
  });

  it("keeps ONE house type when a digit is misread on some pages (same name)", () => {
    // Chesterwood: most pages parse 1377, the ASHP variant pages parse 1337.
    const groups = segmentByHouseType([
      page(1, "1377", "CHESTERWOOD"),
      page(2, "1377", "CHESTERWOOD"),
      page(13, "1337", "CHESTERWOOD"), // one-digit misread
      page(14, "1337", "CHESTERWOOD"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("CHESTERWOOD");
    expect(groups[0].code).toBe("1377"); // majority vote
    expect(groups[0].pages).toEqual([1, 2, 13, 14]);
  });

  it("absorbs code-less relevant pages into the file's single house type", () => {
    // Hampton: elevations carry the code; section/plan/elevation pages carry none.
    const groups = segmentByHouseType([
      page(1, "1069", "HAMPTON"),
      page(9, "1069", "HAMPTON"),
      page(12, null, null), // SECTION — no portfolio code
      page(15, null, null), // FLOOR PLAN
      page(20, null, null), // ELEVATIONS
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("HAMPTON");
    expect(groups[0].pages).toEqual([1, 9, 12, 15, 20]);
  });

  it("still splits a genuinely multi-type file, attaching code-less pages by code", () => {
    const groups = segmentByHouseType([
      page(1, "1337", "CHESTERWOOD"),
      page(2, "1450", "WOLLATON"),
      page(3, "1337", null), // code-less-name page → matches CHESTERWOOD by code
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.name === "CHESTERWOOD")!.pages).toEqual([1, 3]);
    expect(groups.find((g) => g.name === "WOLLATON")!.pages).toEqual([2]);
  });

  it("falls back to a single group when no code is present", () => {
    const groups = segmentByHouseType([
      page(1, null, null),
      page(2, null, null),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].pageRange).toBe("1-2");
  });

  it("returns nothing when no pages are relevant", () => {
    expect(segmentByHouseType([page(1, null, null, false)])).toHaveLength(0);
  });
});
