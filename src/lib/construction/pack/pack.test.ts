import { describe, it, expect } from "vitest";
import { boxOf, fileTypeOf, junkReason, looksLikeOurOwnQuote, scenarioFromBoxes } from "./files";
import { identifySheet, parseFileName, revisionOrder, scaleFromText, paperFromSize } from "./titleBlock";
import { buildRegister, type RegisterFileInput, type PageProbe } from "./register";
import {
  buildChains,
  extractDimensions,
  extractGrid,
  extractHeights,
  extractLevels,
  extractPitches,
  extractRooms,
  extractSpotLevels,
  extractWallplates,
  joinItems,
  mmPerPtFor,
  parseDimension,
  type TextItem,
} from "./sheetGeometry";

// ---------- files ----------
describe("pack files", () => {
  it("types files by extension / mime", () => {
    expect(fileTypeOf("a.pdf")).toBe("PDF");
    expect(fileTypeOf("Hall - Scaffold mark up.pptx")).toBe("PPTX");
    expect(fileTypeOf("CN215 Scaffold Schedule.xlsx")).toBe("SPREADSHEET");
    expect(fileTypeOf("Re_ Scaffolding quote.eml")).toBe("EMAIL");
    expect(fileTypeOf("Pasted Image #1 FCF0E0B2.bmp")).toBe("IMAGE");
    expect(fileTypeOf("pack.zip")).toBe("ZIP");
  });
  it("junk: QS backups, OS files, lock files", () => {
    expect(junkReason("1.Arch/1100/2591.1102.T9 Proposed Second Floor Plan.pdf.~qsbak")).toBe("Software backup copy");
    expect(junkReason("a/.DS_Store")).toBe("System file");
    expect(junkReason("__MACOSX/a/b.pdf")).toBe("System file");
    expect(junkReason("~$schedule.xlsx")).toBe("Temporary lock file");
    expect(junkReason("1.Arch/2591.1100.T9 Proposed Ground Floor Plan.pdf")).toBeNull();
  });
  it("our own quote is recognised by name", () => {
    expect(looksLikeOurOwnQuote("Quote-1350-1-2.pdf")).toBe(true);
    expect(looksLikeOurOwnQuote("CBAND Banbury/Quote-1350-1-2.pdf")).toBe(true);
    expect(looksLikeOurOwnQuote("CN215 Scaffold Schedule.xlsx")).toBe(false);
  });
});

// ---------- title block ----------
describe("sheet identity", () => {
  it("KE file names: number, revision, title", () => {
    expect(parseFileName("2591.1100.T9 Proposed Ground Floor Plan.pdf")).toEqual({
      drawingNo: "2591.1100",
      revision: "T9",
      title: "Proposed Ground Floor Plan",
      status: null,
    });
  });
  it("Bovis file names: number, title, status, revision", () => {
    expect(parseFileName("CBAND-BOV-CCH01-XX-D2-A-AS-0304_Section A-A_For Construction_05.pdf")).toEqual({
      drawingNo: "CBAND-BOV-CCH01-XX-D2-A-AS-0304",
      title: "Section A-A",
      status: "For Construction",
      revision: "05",
    });
  });
  it("kinds from the titles in the real packs", () => {
    const k = (fileName: string, folders: string[] = []) => identifySheet({ fileName, folders, pageText: "" }).kind;
    expect(k("2591.1100.T9 Proposed Ground Floor Plan.pdf")).toBe("PLAN");
    expect(k("2591.1103.T8 Proposed Roof Plan.pdf")).toBe("ROOF_PLAN");
    expect(k("2591.1201.T8 Proposed Building Elevations (North).pdf")).toBe("ELEVATION");
    expect(k("2591.2001.T8 Proposed Sections (Long).pdf")).toBe("SECTION");
    expect(k("2591.3000.T4 Detail Section Drawings - Sheet 01.pdf")).toBe("DETAIL");
    expect(k("2591.3021.T2 Canopy Section Details.pdf")).toBe("DETAIL");
    expect(k("CBAND-BOV-CSH01-XX-D2-A-AS-0305_Section Details_For Construction_00.pdf")).toBe("SECTION");
    expect(k("2591.1500.T6 Proposed Ground Floor Finishes Plan.pdf")).toBe("FINISHES");
    expect(k("2591.1700.T6 Proposed Ground Floor Ceiling Finishes Plan.pdf")).toBe("FINISHES");
    expect(k("2591.4000.T6 Proposed Ground Floor Funiture Plan.pdf")).toBe("FURNITURE");
    expect(k("2591.2200.T5 Internal Door Schedule.pdf")).toBe("SCHEDULE");
    expect(k("2591-King Edwards NBS-2026-02-13.pdf")).toBe("SPEC");
    expect(k("King Ed's- Issue Sheet Technical.pdf")).toBe("REGISTER");
    expect(k("2591.0100.T2 Existing Site Plan.pdf")).toBe("SURVEY");
    expect(k("2591.1001.T2 Proposed Compound Plan.pdf")).toBe("LOGISTICS_PLAN");
    expect(k("2591.1000.T8 Proposed Site Plan.pdf")).toBe("SITE_PLAN");
    expect(k("Hall - Scaffold mark up.pdf")).toBe("MARKUP");
    expect(k("Wren - Scaffolding Measure.pdf")).toBe("MARKUP");
    expect(k("wren park roofing plan.pdf")).toBe("ROOF_PLAN");
    expect(k("Wren park elevation plan 2.pdf")).toBe("ELEVATION");
    expect(k("wren park way in to site and overall site plan.pdf")).toBe("SITE_PLAN");
    expect(k("XWM.12.233_06.pdf", ["1.Arch", "3000 Details"])).toBe("DETAIL");
  });
  it("level, face and building code", () => {
    const id = identifySheet({ fileName: "2591.1101.T9 Proposed First Floor Plan.pdf", folders: [], pageText: "1:50 @ A1" });
    expect(id.level).toBe("1F");
    expect(id.scale).toBe("1:50");
    const roof = identifySheet({ fileName: "CBAND-BOV-CCH01-RD-D2-A-AS-0308_Roof Plan_For Construction_04.pdf", folders: [], pageText: "" });
    expect(roof.level).toBe("RF");
    expect(roof.buildingCode).toBe("CCH01");
    expect(identifySheet({ fileName: "CBAND-BOV-CSH01-XX-D2-A-AS-0401_Front Elevation_For Construction_07.pdf", folders: [], pageText: "" }).face).toBe("FRONT");
    expect(identifySheet({ fileName: "2591.1204.T8 Proposed Building Elevations (East).pdf", folders: [], pageText: "" }).face).toBe("EAST");
  });
  it("revision order: T9 > T8, construction > tender, 07 > 05", () => {
    expect(revisionOrder("T9")!).toBeGreaterThan(revisionOrder("T8")!);
    expect(revisionOrder("C1")!).toBeGreaterThan(revisionOrder("T9")!);
    expect(revisionOrder("07")!).toBeGreaterThan(revisionOrder("05")!);
    expect(revisionOrder(null)).toBeNull();
  });
  it("scale and paper", () => {
    expect(scaleFromText("1 : 50")).toBe("1:50");
    // CBAND notes cite a standard's year — not a drawing scale.
    expect(scaleFromText("COMPLY WITH | BS 5499:PART 1:1990 ILLUMINATED | Class | A2 | 1 : 50")).toBe("1:50");
    expect(scaleFromText("1:100 | 1:50 @ A1")).toBe("1:50");
    expect(scaleFromText("NTS")).toBe("NTS");
    expect(paperFromSize(2384, 1684)).toBe("A1");
    expect(paperFromSize(1684, 1191)).toBe("A2");
    expect(paperFromSize(1191, 842)).toBe("A3");
    expect(paperFromSize(595, 842)).toBe("A4");
  });
});

// ---------- register ----------
const page = (n: number, text = "1:50", w = 2384, h = 1684, hasText = true, imageCount = 0): PageProbe => ({
  page: n,
  widthPt: w,
  heightPt: h,
  hasText,
  imageCount,
  text,
});
const pdf = (id: string, relativePath: string, extra: Partial<RegisterFileInput> = {}): RegisterFileInput => ({
  id,
  relativePath,
  contentHash: id,
  pages: [page(1)],
  ...extra,
});

describe("register — CBAND shape (two buildings, no scope)", () => {
  const files: RegisterFileInput[] = [
    pdf("q", "CBAND Banbury/Quote-1350-1-2.pdf", { pages: [page(1, "", 595, 842)] }),
    pdf("h1", "CBAND Banbury/Community Hall/CBAND-BOV-CCH01-GF-D2-A-AS-0201_Ground Floor Plan_For Construction_05.pdf"),
    pdf("h2", "CBAND Banbury/Community Hall/CBAND-BOV-CCH01-XX-D2-A-AS-0401_Front Elevation_For Construction_03.pdf"),
    pdf("h3", "CBAND Banbury/Community Hall/CBAND-BOV-CCH01-XX-D2-A-AS-0402_Side Elevation_For Construction_04.pdf", { contentHash: "same" }),
    pdf("h4", "CBAND Banbury/Community Hall/hall side elevation.pdf", { contentHash: "same" }),
    pdf("h5", "CBAND Banbury/Community Hall/Hall - Scaffold mark up.pdf", { pages: [page(1, "", 842, 595, false, 5)] }),
    { id: "h6", relativePath: "CBAND Banbury/Community Hall/Hall - Scaffold mark up.pptx", slideText: "Internal & external scaffold" },
    pdf("s1", "CBAND Banbury/Sports Pavillion/CBAND-BOV-CSH01-GF-D2-A-AS-0201_Ground Floor Plan_For Construction_07.pdf"),
    pdf("s2", "CBAND Banbury/Sports Pavillion/CBAND-BOV-CSH01-XX-D2-A-AS-0401_Front Elevation_For Construction_07.pdf"),
    { id: "ds", relativePath: "CBAND Banbury/.DS_Store" },
  ];
  const r = buildRegister(files);
  const bucketOf = (id: string) => r.files.find((f) => f.id === id)!.bucket;

  it("two buildings, named from their folders, keyed by code", () => {
    expect(r.buildings.map((b) => [b.key, b.name])).toEqual([
      ["CCH01", "Community Hall"],
      ["CSH01", "Sports Pavillion"],
    ]);
    expect(r.sheets.find((s) => s.fileId === "s1")!.buildingKey).toBe("CSH01");
  });
  it("our quote held back, a duplicate caught, the pptx read via its PDF export, junk dropped", () => {
    expect(bucketOf("q")).toBe("REFERENCE");
    expect(bucketOf("h4")).toBe("DUPLICATE");
    expect(bucketOf("h6")).toBe("REFERENCE");
    expect(r.files.find((f) => f.id === "h6")!.readViaFileId).toBe("h5");
    expect(bucketOf("h5")).toBe("CORE");
    expect(bucketOf("ds")).toBe("JUNK");
  });
  it("Scenario 2 — drawings and no scope", () => {
    expect(r.mode).toBe("B");
  });
});

describe("register — KE shape (one building, type folders, a blank schedule)", () => {
  const files: RegisterFileInput[] = [
    { id: "x", relativePath: "KE/CN215 Scaffold Schedule.xlsx", textLength: 900 },
    pdf("p1", "KE/1.Arch/1100 Proposed Floor Plans/2591.1100.T9 Proposed Ground Floor Plan.pdf"),
    pdf("p2", "KE/1.Arch/1100 Proposed Floor Plans/2591.1103.T8 Proposed Roof Plan.pdf"),
    { id: "bk", relativePath: "KE/1.Arch/1100 Proposed Floor Plans/2591.1103.T8 Proposed Roof Plan.pdf.~qsbak" },
    pdf("e1", "KE/1.Arch/1200 Proposed Elevations/2591.1201.T8 Proposed Building Elevations (North).pdf"),
    pdf("f1", "KE/1.Arch/1500 Proposed Floor Finishes Layouts/2591.1500.T6 Proposed Ground Floor Finishes Plan.pdf"),
    pdf("c1", "KE/1.Arch/1000 Proposed Site Plans/2591.1001.T2 Proposed Compound Plan.pdf"),
    { id: "im", relativePath: "KE/1.Arch/1000 Proposed Site Plans/Img_BCF0212A BCF0212A.png" },
    pdf("nbs", "KE/1.Arch/2591-King Edwards NBS-2026-02-13.pdf", {
      pages: Array.from({ length: 105 }, (_, i) => page(i + 1, "spec text", 595, 842)),
    }),
  ];
  const r = buildRegister(files);
  const bucketOf = (id: string) => r.files.find((f) => f.id === id)!.bucket;

  it("Scenario 1 does not split the drawings into buildings (they are not read)", () => {
    expect(r.buildings).toEqual([]);
  });
  it("as drawings only, the type folders are not buildings → one building", () => {
    const d = buildRegister(files.filter((f) => f.id !== "x"));
    expect(d.mode).toBe("B");
    expect(d.buildings).toEqual([{ key: "main", name: "Main building", code: null }]);
  });
  it("buckets", () => {
    expect(bucketOf("x")).toBe("SCOPE");
    expect(bucketOf("p1")).toBe("CORE");
    expect(bucketOf("bk")).toBe("JUNK");
    expect(bucketOf("f1")).toBe("NOT_RELEVANT");
    expect(bucketOf("c1")).toBe("CONTEXT");
    expect(bucketOf("im")).toBe("JUNK");
    expect(bucketOf("nbs")).toBe("NOT_RELEVANT");
  });
  it("a 105-page spec is one register row, not 105", () => {
    expect(r.sheets.filter((s) => s.fileId === "nbs")).toHaveLength(1);
  });
  it("Scenario 1 — a scope was uploaded (no box: a spreadsheet goes to Scope)", () => {
    expect(r.mode).toBe("A");
    expect(r.modeReason).toContain("CN215 Scaffold Schedule.xlsx");
  });
});

describe("register — revisions", () => {
  it("an older revision of the same drawing number is superseded", () => {
    const r = buildRegister([
      pdf("a", "p/2591.1100.T8 Proposed Ground Floor Plan.pdf"),
      pdf("b", "p/2591.1100.T9 Proposed Ground Floor Plan.pdf"),
      pdf("c", "p/2591.1201.T8 Proposed Building Elevations (North).pdf"),
    ]);
    expect(r.sheets.find((s) => s.fileId === "a")!.superseded).toBe(true);
    expect(r.sheets.find((s) => s.fileId === "b")!.superseded).toBe(false);
  });
  it("a picture-only drawing with no scope is still Scenario 2 — the box decides, not the content", () => {
    const r = buildRegister([pdf("a", "Block F Roof Plan.pdf", { pages: [page(1, "", 842, 595, false, 1)] })]);
    expect(r.mode).toBe("B");
    expect(r.sheets[0].raster).toBe(true);
  });
});

describe("upload boxes — the box is the label", () => {
  it("a file keeps the box it was put in; old files get one from their type", () => {
    expect(boxOf("SCOPE", "anything.pdf")).toBe("SCOPE");
    expect(boxOf("EMAIL", "Re enquiry.pdf")).toBe("EMAIL");
    expect(boxOf("DRAWINGS", "schedule.xlsx")).toBe("DRAWINGS");
    expect(boxOf(null, "Re_ Scaffolding quote.eml")).toBe("EMAIL");
    expect(boxOf(null, "CN215 Scaffold Schedule.xlsx")).toBe("SCOPE");
    expect(boxOf(null, "plan.pdf")).toBe("DRAWINGS");
    expect(boxOf("SITE_PLAN", "notes.txt")).toBe("DRAWINGS");
  });
  it("scenario: a scope → 1 (A); drawings, no scope → 2 (B); anything else → 3 (C)", () => {
    expect(scenarioFromBoxes([{ box: "SCOPE", relativePath: "s.xlsx" }, { box: "DRAWINGS", relativePath: "a.pdf" }])).toBe("A");
    expect(scenarioFromBoxes([{ box: "DRAWINGS", relativePath: "a.pdf" }, { box: "EMAIL", relativePath: "e.eml" }])).toBe("B");
    expect(scenarioFromBoxes([{ box: "EMAIL", relativePath: "e.eml" }])).toBe("C");
    expect(scenarioFromBoxes([])).toBe("C");
    expect(scenarioFromBoxes([{ box: "DRAWINGS", relativePath: "pack/.DS_Store" }])).toBe("C");
  });

  const email = { id: "e", relativePath: "Re enquiry.eml", box: "EMAIL", textLength: 400 };
  const plan = pdf("p", "pack/2591.1100.T9 Proposed Ground Floor Plan.pdf", { box: "DRAWINGS" });
  it("Scenario 1: the scope and the email are read; the drawings are listed, not read, not split into buildings", () => {
    const r = buildRegister([{ id: "s", relativePath: "scope.pdf", box: "SCOPE", textLength: 900 }, email, plan]);
    expect(r.mode).toBe("A");
    expect(r.files.find((f) => f.id === "s")!.bucket).toBe("SCOPE");
    expect(r.files.find((f) => f.id === "e")!.bucket).toBe("SCOPE");
    expect(r.buildings).toEqual([]);
    expect(r.sheets.find((x) => x.fileId === "p")!.reason).toContain("not read");
  });
  it("Scenario 2: the email is for reference only", () => {
    const r = buildRegister([email, plan]);
    expect(r.mode).toBe("B");
    expect(r.files.find((f) => f.id === "e")!.bucket).toBe("REFERENCE");
    expect(r.files.find((f) => f.id === "p")!.bucket).toBe("CORE");
  });
  it("a spreadsheet inside the Drawings box is not a scope — shown, not read", () => {
    const r = buildRegister([{ id: "x", relativePath: "pack/schedule.xlsx", box: "DRAWINGS", textLength: 500 }, plan]);
    expect(r.mode).toBe("B");
    expect(r.files.find((f) => f.id === "x")!.bucket).toBe("REFERENCE");
  });
  it("the same scope in the Scope box and inside the drawings folder: the Scope copy is kept", () => {
    const r = buildRegister([
      { id: "d", relativePath: "a-pack/schedule.xlsx", box: "DRAWINGS", contentHash: "h", textLength: 500 },
      { id: "s", relativePath: "schedule.xlsx", box: "SCOPE", contentHash: "h", textLength: 500 },
    ]);
    expect(r.files.find((f) => f.id === "s")!.bucket).toBe("SCOPE");
    expect(r.files.find((f) => f.id === "d")!.bucket).toBe("DUPLICATE");
  });
  it("an empty scope (no readable text) is shown, not read — but it still makes Scenario 1", () => {
    const r = buildRegister([{ id: "s", relativePath: "scan.pdf", box: "SCOPE", textLength: 0 }, plan]);
    expect(r.mode).toBe("A");
    expect(r.files.find((f) => f.id === "s")!.bucket).toBe("REFERENCE");
  });
});

// ---------- sheet geometry ----------
const T = (s: string, x = 0, y = 0, extra: Partial<TextItem> = {}): TextItem => ({ s, x, y, w: 10, h: 4, vertical: false, ...extra });

describe("sheet geometry — the real strings", () => {
  it("KE level markers, incl. ± and a marker with no AOD", () => {
    const joined =
      "±0.000 | 0 GF-Ground Floor (78.150) | +3.225 | 1 01-First Floor (81.375) | +6.450 | 2 02 - Second Floor (84.600) | +9.725 | 3 RF-Roof (87.875) | +11.575 | 4 Parapet (89.725) | -0.900 | -1 F1-Foundation";
    const lv = extractLevels(joined);
    expect(lv.map((l) => l.valueM)).toEqual([-0.9, 0, 3.225, 6.45, 9.725, 11.575]);
    expect(lv.find((l) => l.valueM === 11.575)!.aodM).toBe(89.725);
    expect(lv.find((l) => l.valueM === -0.9)!.aodM).toBeNull();
  });
  it("CBAND printed heights, glued and spaced", () => {
    const h = extractHeights([
      T("3300 DPC TO U/S SOFFIT"),
      T("3300DPC TO UNDERSIDE OF SOFFIT"),
      T("3750 DPC - TOP OF WALLPLATE"),
      T("4882 FFL - FCL"),
      T("4897 DPC TO U/S TRUSS"),
      T("2990 Floor to ceiling"),
      T("2100 D1"),
    ]);
    expect(h.map((x) => `${x.mm}:${x.from}:${x.to}`)).toEqual([
      "3300:DPC:SOFFIT",
      "3300:DPC:SOFFIT",
      "3750:DPC:WALLPLATE",
      "4882:FFL:CEILING",
      "4897:DPC:TRUSS",
      "2990:FFL:CEILING",
    ]);
  });
  it("wall plates and pitch", () => {
    expect(extractWallplates([T("6560WALLPLATE"), T("O/A WALLPLATE 8560"), T("2775WALLPLATE")]).map((w) => w.mm)).toEqual([6560, 8560, 2775]);
    expect(extractPitches([T("40°"), T("35.00°"), T("400°")])).toEqual([35, 40]);
  });
  it("dimensions: commas, plain, and not dates / drawing numbers / levels", () => {
    expect(parseDimension("28,903")).toBe(28903);
    expect(parseDimension("20793")).toBe(20793);
    expect(parseDimension("303")).toBe(303);
    expect(parseDimension("2591.1100")).toBeNull();
    expect(parseDimension("78.150")).toBeNull();
    expect(parseDimension("13/05/2022")).toBeNull();
  });
  it("KE room areas with the split ²", () => {
    const rooms = extractRooms("x | Classroom 01 | CA: | 50.467 m | 2 | Stair Core | CA: | 31.864 m | 2 | y");
    expect(rooms.map((r) => [r.label, r.areaM2])).toEqual([
      ["Classroom 01", 50.467],
      ["Stair Core", 31.864],
    ]);
  });
  it("spot levels, including the decimal-less one", () => {
    const s = extractSpotLevels([T("78.850 (+700)"), T("77800 (-350)"), T("78000(-150)"), T("78.838")], { bareAod: false });
    expect(s.map((x) => [x.aodM, x.relMm])).toEqual([
      [78.85, 700],
      [77.8, -350],
      [78, -150],
    ]);
    expect(extractSpotLevels([T("78.838")], { bareAod: true })[0].aodM).toBe(78.838);
  });
  it("chains group dimensions on one line", () => {
    const dims = extractDimensions([
      T("303", 115, 335),
      T("8360", 600, 335.5),
      T("303", 1276, 335),
      T("20793", 692, 267),
      T("8965", 1347, 696, { vertical: true }),
    ]);
    const chains = buildChains(dims);
    const row = chains.find((c) => !c.vertical && c.items.length === 3)!;
    expect(row.items.map((i) => i.mm)).toEqual([303, 8360, 303]);
    expect(row.sumMm).toBe(8966);
  });
  it("grid bubbles at 1:50 measure the spacing and find the printed chain", () => {
    const big = { h: 14 };
    const items: TextItem[] = [];
    // Body text at the real KE median height (7.8 pt); bubbles are bigger.
    for (let i = 0; i < 40; i++) items.push(T("note", 0, 0, { h: 7.8 }));
    // A→F bubbles at the real KE positions (x in pt), top and bottom.
    const xs: [string, number][] = [["A", 95], ["B", 305], ["C", 490], ["D", 900], ["E", 1097], ["F", 1734]];
    for (const [l, x] of xs) items.push(T(l, x, 1600, big), T(l, x, 100, big));
    const mmPerPt = mmPerPtFor("1:50");
    items.push(T("3,713", 200, 1550)); // printed between A and B
    const g = extractGrid(items, mmPerPt, extractDimensions(items));
    expect(g.vertical.map((l) => l.label)).toEqual(["A", "B", "C", "D", "E", "F"]);
    const total = g.spacings.reduce((s, x) => s + x.measuredMm, 0);
    expect(Math.abs(total - (1734 - 95) * mmPerPt!)).toBeLessThan(3);
    expect(g.spacings[0].printedMm).toBe(3713);
  });
  it("joinItems keeps item boundaries", () => {
    expect(joinItems([T(" a "), T(""), T("b")])).toBe("a | b");
  });
});
