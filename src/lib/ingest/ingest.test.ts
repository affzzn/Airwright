import { describe, it, expect } from "vitest";
import {
  parsePath,
  drawingKindFromName,
  parseRevision,
  parsePlots,
  parseConfigHint,
  parseMaterialVariant,
  revisionStrippedKey,
} from "./parsePath";
import { detectBuilder, isIgnoredPath, BUILDER_PROFILES } from "./profiles";
import { groupPack, type IngestFile } from "./group";

const profile = (id: string) => BUILDER_PROFILES.find((p) => p.id === id)!;

// Real relative paths from data/first-ones-sent/ (gitignored PII — paths only).
const V = "VISTRY SOUTH EAST MIDLANDS TOP WIGHAY";
const B = "BLOOR OADBY PH2A/OneDrive_1_17-02-2025";
const T = "TILIA HAWKESBURY/Housetypes 1";
const TW = "TAYLOR WIMPEY NORTH MIDS PERRYFIELDS 2B";

describe("parsePath — drawing kinds", () => {
  it("names the elevation face", () => {
    expect(drawingKindFromName("The Aspen-Front Elevation (Brick)")).toBe("FRONT_ELEVATION");
    expect(drawingKindFromName("The Aspen-R.H. Side Elevation (Brick)")).toBe("SIDE_ELEVATION");
    expect(drawingKindFromName("Rear Elevation")).toBe("REAR_ELEVATION");
  });
  it("reads plans, section, setting-out, roof", () => {
    expect(drawingKindFromName("Ground Floor Plan")).toBe("FLOOR_PLAN");
    expect(drawingKindFromName("Section A-A")).toBe("SECTION");
    expect(drawingKindFromName("Setting-out Plan")).toBe("SETTING_OUT");
    expect(drawingKindFromName("Roof Plan")).toBe("ROOF");
    expect(drawingKindFromName("GA ELEVATIONS")).toBe("GA_ELEVATION");
  });
  it("flags non-scaffold trades as JUNK first", () => {
    expect(drawingKindFromName("Symphony Option 1 Kitchen")).toBe("JUNK");
    expect(drawingKindFromName("Ground Floor M+E Services Layout")).toBe("JUNK");
    expect(drawingKindFromName("EMA21 Structural Appraisal")).toBe("JUNK");
    expect(drawingKindFromName("KITCHEN LAYOUT")).toBe("JUNK");
    expect(drawingKindFromName("Metsa FF Joists")).toBe("JUNK");
    expect(drawingKindFromName("BLOOR OADBY PH2A TAKE OFFS")).toBe("JUNK");
  });
});

describe("parsePath — revision / plots / variants", () => {
  it("orders revisions latest-first", () => {
    expect(parseRevision("470_HALLAM_ISSUE_7.1")!.order).toBeGreaterThan(
      parseRevision("470_HALLAM_ISSUE_4.8")!.order,
    );
    expect(parseRevision("CROMFORD-201-03D … _Ver4")!.order).toBeGreaterThan(
      parseRevision("CROMFORD-201-03D … _Ver3")!.order,
    );
  });
  it("reads plot lists", () => {
    expect(parsePlots("Front Elevation Plots 4, 21, 39, 40")).toEqual([4, 21, 39, 40]);
    expect(parsePlots("Side Elevation Plot 18")).toEqual([18]);
  });
  it("reads config + material variants", () => {
    expect(parseConfigHint("EMA21-Avonsford END - 2021")).toBe("END");
    expect(parseConfigHint("EMA21-Avonsford MID - 2021 AFFORDABLE")).toBe("MID");
    expect(parseMaterialVariant("Front Elevation (Brick)")).toBe("BRICK");
    expect(parseMaterialVariant("Front Elevation (Gable Render)")).toBe("RENDER");
  });
  it("collapses revisions to one dedupe key", () => {
    expect(revisionStrippedKey("470_HALLAM_ISSUE_4.8")).toBe(
      revisionStrippedKey("470_HALLAM_ISSUE_7.1"),
    );
    expect(revisionStrippedKey("CROMFORD-201-03D Front Elevation_Ver3")).toBe(
      revisionStrippedKey("CROMFORD-201-03D Front Elevation_Ver4"),
    );
    // Different faces do NOT collapse.
    expect(revisionStrippedKey("Aspen-Front Elevation_P01")).not.toBe(
      revisionStrippedKey("Aspen-Rear Elevation_P01"),
    );
  });
});

describe("detectBuilder", () => {
  it("detects each builder from the top folder keyword", () => {
    expect(detectBuilder({ folders: [V] })?.id).toBe("vistry");
    expect(detectBuilder({ folders: ["BLOOR OADBY PH2A"] })?.id).toBe("bloor");
    expect(detectBuilder({ folders: ["TILIA HAWKESBURY"] })?.id).toBe("tilia");
    expect(detectBuilder({ folders: [TW] })?.id).toBe("taylor-wimpey");
  });
  it("detects structurally even when the branded top folder is stripped", () => {
    // Vistry — the SGP code in the filename.
    expect(
      detectBuilder({
        folders: ["Scaffold", "Aspen"],
        fileNames: ["240780-SGP-C414001A-XX-D2-A-0401B_The Aspen-Front Elevation (Brick)_P01.pdf"],
      })?.id,
    ).toBe("vistry");
    // Bloor — the _ISSUE_ filename signature.
    expect(detectBuilder({ fileNames: ["372_BYRON_ISSUE_4.13.pdf"] })?.id).toBe("bloor");
    // Tilia — the CODE-NNN-ND sheet numbering.
    expect(
      detectBuilder({ fileNames: ["CROMFORD-201-03D Front Elevation Plots 4, 21_Ver3.pdf"] })?.id,
    ).toBe("tilia");
    // Taylor Wimpey — the trade-folder structure.
    expect(detectBuilder({ folders: ["House_Type", "EMA21_Avonsford"] })?.id).toBe("taylor-wimpey");
  });
  it("returns null for an unknown builder", () => {
    expect(detectBuilder({ folders: ["SOME NEW HOUSEBUILDER SITE"], fileNames: ["plan.pdf"] })).toBeNull();
  });
});

describe("houseTypeFromPath", () => {
  it("Vistry: folder under Scaffold/ is the type; buckets are not", () => {
    const p = profile("vistry").grouping.houseTypeFromPath;
    expect(p(`${V}/Scaffold/Aspen/240780-…_The Aspen-Ground Floor Plan_P02.pdf`)).toBe("ASPEN");
    expect(p(`${V}/Scaffold/Block Plans/24-078 B001_The Beech Block Plan.pdf`)).toBeNull();
    expect(p(`${V}/Scaffold/Site Plans/240780-…_Site Plan.pdf`)).toBeNull();
  });
  it("Bloor: name from the filename", () => {
    const p = profile("bloor").grouping.houseTypeFromPath;
    expect(p(`${B}/372_BYRON_ISSUE_4.13.pdf`)).toBe("BYRON");
    expect(p(`${B}/470-1_HALLAM_ISSUE_7.1.pdf`)).toBe("HALLAM");
  });
  it("Tilia: filename prefix is the type", () => {
    const p = profile("tilia").grouping.houseTypeFromPath;
    expect(p(`${T}/CROMFORD-201-03D Front Elevation Plots 4, 21_Ver3.pdf`)).toBe("CROMFORD");
    expect(p(`${T}/BENINGTON-201-06 Section A-A Plot 18_Ver3.pdf`)).toBe("BENINGTON");
  });
  it("Taylor Wimpey: house folder or apartment folder is the type", () => {
    const p = profile("taylor-wimpey").grouping.houseTypeFromPath;
    expect(
      p(`${TW}/House_Type/Masonry/EMA21_Avonsford/00_House_Type_PDF/EMA21-Avonsford END - 2021.pdf`),
    ).toBe("EMA21_AVONSFORD");
    expect(
      p(`${TW}/Apartment_Block_Type/APARTMENT_BLOCK_A_PLOTS_107_127/51_GA ELEVATIONS.pdf`),
    ).toBe("APARTMENT_BLOCK_A_PLOTS_107_127");
  });
});

describe("isIgnoredPath", () => {
  it("drops TW trade folders + junk files", () => {
    const tw = profile("taylor-wimpey");
    expect(isIgnoredPath(tw, `${TW}/…/EMA21_Avonsford/04_Roofs/EMA21 End 30deg.pdf`)).toBe(true);
    expect(isIgnoredPath(tw, `${TW}/…/EMA21_Avonsford/06_Kitchens/01_Symphony/Kitchen.pdf`)).toBe(true);
    expect(isIgnoredPath(tw, `${TW}/…/APARTMENT_BLOCK_A/91_KITCHEN LAYOUT.pdf`)).toBe(true);
    // The combined drawing folder is NOT ignored.
    expect(isIgnoredPath(tw, `${TW}/…/EMA21_Avonsford/00_House_Type_PDF/x.pdf`)).toBe(false);
  });
  it("drops Tilia M+E / schedules / superstructure details", () => {
    const t = profile("tilia");
    expect(isIgnoredPath(t, `${T}/CROMFORD-203-01E Ground Floor M+E Services Layout_Ver4.pdf`)).toBe(true);
    expect(isIgnoredPath(t, `${T}/HAW-…-0102-C1 - Superstructure Details - Housetype CROMFORD_Ver2.pdf`)).toBe(true);
  });
});

// ── Grouping: build small packs of classified files and assert the outcome.
function relevant(kind = 1) {
  return Array.from({ length: kind }, (_, i) => ({ page: i + 1, relevant: true }));
}

describe("groupPack — Vistry (folder = type; group everything, tag relevance)", () => {
  const files: IngestFile[] = [
    { documentId: "d1", relativePath: `${V}/Scaffold/Aspen/…_The Aspen-Front Elevation (Brick)_P01.pdf`, pages: relevant() },
    { documentId: "d2", relativePath: `${V}/Scaffold/Aspen/…_The Aspen-Ground Floor Plan_P02.pdf`, pages: relevant() },
    { documentId: "d3", relativePath: `${V}/Scaffold/Aspen/…_The Aspen-Section A-A_P01.pdf`, pages: relevant() },
    { documentId: "d4", relativePath: `${V}/Scaffold/Beech/…_The Beech-Front Elevation (Brick)_P01.pdf`, pages: relevant() },
    { documentId: "d5", relativePath: `${V}/Scaffold/Boundaries/24-078 B001.pdf`, pages: relevant() },
  ];
  const res = groupPack(files, profile("vistry"));

  it("makes one group per house-type folder", () => {
    expect(res.groups.map((g) => g.name).sort()).toEqual(["ASPEN", "BEECH"]);
  });
  it("collects all pages of a type, relevant-first", () => {
    const aspen = res.groups.find((g) => g.name === "ASPEN")!;
    expect(aspen.totalPageCount).toBe(3);
    expect(aspen.relevantPageCount).toBe(3);
    expect(aspen.pages[0].relevant).toBe(true);
    expect(aspen.pages[0].drawingKind).toBe("FRONT_ELEVATION");
  });
  it("leaves the Boundaries folder unplaced (no house type)", () => {
    expect(res.unplacedFiles.some((f) => /Boundaries/.test(f))).toBe(true);
  });
});

describe("groupPack — Bloor (latest revision wins)", () => {
  const files: IngestFile[] = [
    { documentId: "d1", relativePath: `${B}/470_HALLAM_ISSUE_4.8.pdf`, pages: relevant(3) },
    { documentId: "d2", relativePath: `${B}/470_HALLAM_ISSUE_7.1.pdf`, pages: relevant(3) },
    { documentId: "d3", relativePath: `${B}/372_BYRON_ISSUE_4.13.pdf`, pages: relevant(3) },
    { documentId: "d4", relativePath: `${B}/MI114-SL-402.2EE (Materials Layout) (1).pdf`, pages: relevant() },
  ];
  const res = groupPack(files, profile("bloor"));

  it("keeps only the latest ISSUE of a duplicated type", () => {
    const hallam = res.groups.find((g) => g.name === "HALLAM")!;
    expect(hallam.files).toEqual([`${B}/470_HALLAM_ISSUE_7.1.pdf`]);
  });
  it("leaves the materials layout unplaced (no house type)", () => {
    expect(res.unplacedFiles.some((f) => /Materials Layout/.test(f))).toBe(true);
  });
});

describe("groupPack — Taylor Wimpey (group everything; trades tagged not-relevant)", () => {
  const base = `${TW}/House_Type/Masonry/EMA21_Avonsford`;
  const files: IngestFile[] = [
    { documentId: "d1", relativePath: `${base}/00_House_Type_PDF/EMA21-Avonsford END - 2021.pdf`, pages: relevant(30) },
    { documentId: "d2", relativePath: `${base}/04_Roofs/EMA21 End 30deg.pdf`, pages: relevant() },
    { documentId: "d3", relativePath: `${base}/06_Kitchens/01_Symphony/Kitchen.pdf`, pages: relevant() },
    { documentId: "d4", relativePath: `${base}/09_Lintels/EMA21 Keystone Lintels.pdf`, pages: relevant() },
  ];
  const res = groupPack(files, profile("taylor-wimpey"));

  it("groups every file under the house type, but only the combined PDF is relevant", () => {
    expect(res.groups.map((g) => g.name)).toEqual(["EMA21_AVONSFORD"]);
    const g = res.groups[0];
    expect(g.files.length).toBe(4); // dossier includes the trade files
    expect(g.totalPageCount).toBe(33); // 30 + 1 + 1 + 1
    expect(g.relevantPageCount).toBe(30); // trades tagged not-relevant
    // Relevant pages sort first.
    expect(g.pages.slice(0, 30).every((p) => p.relevant)).toBe(true);
    expect(g.pages.slice(30).every((p) => !p.relevant)).toBe(true);
  });
});

describe("groupPack — unknown builder falls back", () => {
  it("marks everything unplaced + needs LLM when no profile", () => {
    const res = groupPack(
      [{ documentId: "d1", relativePath: "NEW BUILDER/whatever.pdf", pages: relevant() }],
      null,
    );
    expect(res.needsLlmFallback).toBe(true);
    expect(res.unplacedFiles.length).toBe(1);
  });
});
