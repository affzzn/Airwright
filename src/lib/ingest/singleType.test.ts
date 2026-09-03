import { describe, it, expect } from "vitest";
import {
  isSelfContainedType,
  isOneFilePerType,
  houseTypeNameFromFileName,
  type DetectionDoc,
} from "./singleType";

const elev = { kind: "ELEVATION", relevant: true };
const plan = { kind: "FLOOR_PLAN", relevant: true };
const section = { kind: "SECTION", relevant: true };
const junk = { kind: "OTHER", relevant: false };

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
    expect(isSelfContainedType([elev, elev])).toBe(false); // elevations only (loose Vistry file)
    expect(isSelfContainedType([plan])).toBe(false); // plan only
    expect(isSelfContainedType([{ kind: "ELEVATION", relevant: false }, plan])).toBe(false); // elevation not relevant
  });
});

describe("isOneFilePerType", () => {
  it("fires for a single combined PDF (one house type)", () => {
    expect(isOneFilePerType([doc("SM1 SM2-full.pdf", [elev, plan, section])])).toBe(true);
  });
  it("fires for a flat folder of per-type combined PDFs (Bloor new-laura)", () => {
    expect(
      isOneFilePerType([
        doc("301_LAWRENCE_ISSUE_7.1.pdf", [elev, plan]),
        doc("386_KILBURN_ISSUE_4.12.pdf", [elev, plan, section]),
        doc("470_HALLAM_ISSUE_4.8.pdf", [elev, plan]),
      ]),
    ).toBe(true);
  });
  it("ignores a non-drawing answer-key / schedule (no relevant pages)", () => {
    expect(
      isOneFilePerType([
        doc("301_LAWRENCE_ISSUE_7.1.pdf", [elev, plan]),
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
        doc("EMA21-Avonsford END - 2021.pdf", [elev, plan]),
        doc("EMA21-Avonsford MID - 2021.pdf", [elev, plan]),
      ]),
    ).toBe(false); // END/MID collapse to one variant key → AI grouping handles them
  });
  it("returns false for an empty / no-drawing pack", () => {
    expect(isOneFilePerType([])).toBe(false);
    expect(isOneFilePerType([doc("site plan.pdf", [junk])])).toBe(false);
  });
  it("ignores raster-only / unreadable files in the decision", () => {
    expect(
      isOneFilePerType([
        doc("301_LAWRENCE.pdf", [elev, plan]),
        doc("scan.pdf", [], { isRasterOnly: true }),
      ]),
    ).toBe(true);
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
