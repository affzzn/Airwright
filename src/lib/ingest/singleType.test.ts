import { describe, it, expect } from "vitest";
import {
  isSelfContainedType,
  isHouseTypeFile,
  houseTypeDocs,
  isOneFilePerType,
  houseTypeNameFromFileName,
  type DetectionDoc,
} from "./singleType";

const elev = { kind: "ELEVATION", relevant: true };
const plan = { kind: "FLOOR_PLAN", relevant: true };
const section = { kind: "SECTION", relevant: true };
const junk = { kind: "OTHER", relevant: false };
/** N relevant elevation-ish pages (no classified floor plan). */
const elevs = (n: number) => Array.from({ length: n }, () => elev);

const doc = (fileName: string, pages: { kind: string; relevant: boolean }[], extra?: Partial<DetectionDoc>): DetectionDoc => ({
  isReadable: true,
  isRasterOnly: false,
  fileName,
  relativePath: fileName,
  pages,
  ...extra,
});

describe("isSelfContainedType", () => {
  it("needs BOTH a relevant elevation and a relevant floor plan", () => {
    expect(isSelfContainedType([elev, plan, section])).toBe(true);
    expect(isSelfContainedType([elev, elev])).toBe(false);
    expect(isSelfContainedType([plan])).toBe(false);
  });
});

describe("isHouseTypeFile", () => {
  it("is a whole set: elevation + floor plan", () => {
    expect(isHouseTypeFile([elev, plan, section])).toBe(true);
  });
  it("accepts an elevation set with ≥3 relevant sheets even if the floor plan was mis-classified", () => {
    // The real Taywood case: 9 relevant, elevation present, no page classified FLOOR_PLAN.
    expect(isHouseTypeFile([...elevs(9), junk, junk])).toBe(true);
  });
  it("rejects a lone auxiliary sheet (block/site plan: 1 relevant elevation-ish page)", () => {
    expect(isHouseTypeFile([elev])).toBe(false);
    expect(isHouseTypeFile([elev, junk])).toBe(false);
  });
  it("rejects a big booklet/spec with only a few relevant pages", () => {
    const spec = [...elevs(5), ...Array.from({ length: 80 }, () => junk)]; // 5 relevant / 85 pages
    expect(isHouseTypeFile(spec)).toBe(false);
  });
  it("rejects a file with no elevation", () => {
    expect(isHouseTypeFile([plan, plan, section])).toBe(false);
  });
});

describe("isOneFilePerType", () => {
  it("fires for a single combined PDF (one house type)", () => {
    expect(isOneFilePerType([doc("SM1 SM2-full.pdf", [elev, plan, section])])).toBe(true);
  });
  it("fires for a Miller pack: many combined PDFs + junk files (the Whitford case)", () => {
    expect(
      isOneFilePerType([
        doc("9. 250813 Charford (L356 DT).pdf", elevs(18)),
        doc("28. L361_Braxton_Combined Working Drawings Rev A.pdf", [...elevs(14), plan]),
        doc("24. AL40_Taywood_Combined Working Drawings.pdf", elevs(9)), // plan mis-classified
        doc("20. B12 Millfield Bungalow_Combined Working Drawings.pdf", [...elevs(7), plan]),
        // junk / auxiliaries — must not block the fast path:
        doc("33. Block Plans-BLOCK 01.pdf", [elev]), // 1 relevant page
        doc("1. BRO-PSP-01 - site plan.pdf", [elev]),
        doc("40. Standard House Type Construction Specification.pdf", [...elevs(5), ...Array.from({ length: 80 }, () => junk)]),
        doc("2. Materials Schedule.pdf", [junk, junk]), // 0 relevant
      ]),
    ).toBe(true);
  });
  it("ignores a non-drawing answer-key / schedule (no relevant pages)", () => {
    expect(
      isOneFilePerType([
        doc("301_LAWRENCE_ISSUE_7.1.pdf", [elev, plan]),
        doc("386_KILBURN_ISSUE_4.12.pdf", [...elevs(3), plan]),
        doc("BLOOR OADBY PH2A TAKE OFFS.pdf", [junk, junk]),
      ]),
    ).toBe(true);
  });
  it("does NOT fire for loose single-sheet packs (Vistry/Tilia)", () => {
    expect(
      isOneFilePerType([
        doc("Aspen-Front Elevation.pdf", [elev]),
        doc("Aspen-Ground Floor Plan.pdf", [plan]),
        doc("Aspen-Section.pdf", [section]),
      ]),
    ).toBe(false);
  });
  it("does NOT fire when two files are variants of the same type (Taylor Wimpey)", () => {
    expect(
      isOneFilePerType([
        doc("EMA21-Avonsford END - 2021.pdf", [...elevs(3), plan]),
        doc("EMA21-Avonsford MID - 2021.pdf", [...elevs(3), plan]),
      ]),
    ).toBe(false);
  });
  it("does NOT fire when loose auxiliaries outnumber the house-type files", () => {
    expect(
      isOneFilePerType([
        doc("Braxton_Combined.pdf", [...elevs(8), plan]),
        doc("sheet1.pdf", [elev]),
        doc("sheet2.pdf", [elev]),
        doc("sheet3.pdf", [plan]),
      ]),
    ).toBe(false);
  });
  it("returns false for an empty / no-drawing pack", () => {
    expect(isOneFilePerType([])).toBe(false);
    expect(isOneFilePerType([doc("site plan.pdf", [junk])])).toBe(false);
  });
});

describe("houseTypeDocs", () => {
  it("returns only the whole house-type files (skips junk)", () => {
    const docs = [
      doc("Charford.pdf", elevs(18)),
      doc("Braxton.pdf", [...elevs(14), plan]),
      doc("BlockPlan.pdf", [elev]),
      doc("Materials.pdf", [junk]),
    ];
    expect(houseTypeDocs(docs).map((d) => d.fileName)).toEqual(["Charford.pdf", "Braxton.pdf"]);
  });
});

describe("houseTypeNameFromFileName", () => {
  it("strips leading code, revision, and -full suffix", () => {
    expect(houseTypeNameFromFileName("301_LAWRENCE_ISSUE_7.1.pdf")).toBe("LAWRENCE");
    expect(houseTypeNameFromFileName("386_KILBURN_ISSUE_4.12.pdf")).toBe("KILBURN");
    expect(houseTypeNameFromFileName("2B4P_SINCLAIR_ISSUE_4.3.pdf")).toBe("SINCLAIR");
    expect(houseTypeNameFromFileName("470_HALLAM_ISSUE_4.8.pdf")).toBe("HALLAM");
    expect(houseTypeNameFromFileName("SM1 SM2-full.pdf")).toBe("SM1 SM2");
  });
  it("never returns empty", () => {
    expect(houseTypeNameFromFileName("x.pdf").length).toBeGreaterThan(0);
  });
});
