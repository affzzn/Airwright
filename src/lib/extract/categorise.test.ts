import { describe, it, expect } from "vitest";
import {
  drawingTitle,
  classifyTitle,
  classifyByText,
  type PageClass,
} from "./classify";
import {
  filenamePrefilter,
  categoriseDocument,
  isRelevantCategory,
} from "./categorise";

describe("drawingTitle — multiple title-block formats", () => {
  it("reads the consultant TITLE … STATUS anchor", () => {
    // From the real Travis Baker sheets.
    expect(
      drawingTitle("... BROMSGROVE TITLE POS AREA PROPOSED LEVELS STATUS. PRELIMINARY"),
    ).toBe("POS AREA PROPOSED LEVELS");
    expect(
      drawingTitle("TITLE SITE LAYOUT SHOWING STRIP-TRENCH FOUNDATIONS - SHT 2 STATUS."),
    ).toBe("SITE LAYOUT SHOWING STRIP-TRENCH FOUNDATIONS - SHT 2");
  });

  it("reads the Miller portfolio-line title", () => {
    expect(
      drawingTitle("L464211AW G.T. 03.01.24 ASHP GROUND FLOOR PLAN L464 - 4B / 8P"),
    ).toBe("ASHP GROUND FLOOR PLAN");
  });
});

describe("classifyByText — fallback for builders whose title block we can't parse", () => {
  it("classifies a Bloor/NSS elevation sheet by its label", () => {
    expect(classifyByText("... FRONT ELEVATION scale 1:100 ...").kind).toBe("ELEVATION");
    expect(classifyByText("SIDE ELEVATION").kind).toBe("ELEVATION");
  });
  it("classifies a floor-plan sheet", () => {
    expect(classifyByText("GROUND FLOOR PLAN").kind).toBe("FLOOR_PLAN");
    expect(classifyByText("FIRST FLOOR PLAN 1:50").kind).toBe("FLOOR_PLAN");
  });
  it("a drawing type wins over an incidental plot/site reference", () => {
    // Elevation sheets mention which plots use them — must NOT become PLOT_LAYOUT.
    expect(
      classifyByText("FRONT ELEVATION PLOTS 33 SITE PLAN REF").kind,
    ).toBe("ELEVATION");
  });
  it("excludes internal room elevations (Colin's rule)", () => {
    expect(classifyByText("KITCHEN ELEVATION").kind).toBe("OTHER");
    expect(classifyByText("CLOAK PLAN ELEVATION").kind).toBe("OTHER");
  });
  it("excludes civils long-sections", () => {
    expect(classifyByText("LONG SECTIONS SHEET 3").kind).toBe("OTHER");
  });
  it("still catches a genuine site layout with no drawing label", () => {
    expect(classifyByText("PROPOSED SITE LAYOUT").kind).toBe("PLOT_LAYOUT");
  });
});

describe("classifyTitle — site layout wins over foundations", () => {
  it("classifies a site layout that mentions foundations as PLOT_LAYOUT", () => {
    expect(
      classifyTitle("SITE LAYOUT SHOWING STRIP-TRENCH FOUNDATIONS - SHT 2"),
    ).toBe("PLOT_LAYOUT");
  });
  it("classifies proposed levels as OTHER", () => {
    expect(classifyTitle("POS AREA PROPOSED LEVELS")).toBe("OTHER");
  });
  it("classifies a bar schedule as OTHER", () => {
    expect(classifyTitle("BAR SCHEDULE")).toBe("OTHER");
  });
  it("classifies civils long-sections as OTHER (not a house SECTION)", () => {
    expect(classifyTitle("LONG SECTIONS, SHEET 3")).toBe("OTHER");
  });
  it("still classifies house drawings", () => {
    expect(classifyTitle("FRONT ELEVATION")).toBe("ELEVATION");
    expect(classifyTitle("ASHP GROUND FLOOR PLAN")).toBe("FLOOR_PLAN");
    expect(classifyTitle("SECTION A-A")).toBe("SECTION");
  });
});

describe("drawingTitle regression — Miller title block", () => {
  it("does not grab the 'DRAWN BY' label on a Miller sheet", () => {
    const raw =
      "... TITLE DRAWN BY G.T. CHECKED BY MJE 03.01.24 ASHP GROUND FLOOR PLAN L464 - 4B / 8P / 1337 - CHESTERWOOD";
    // Miller portfolio line wins; we get the real title, not "DRAWN BY".
    expect(drawingTitle(raw)).toBe("ASHP GROUND FLOOR PLAN");
  });
});

describe("filenamePrefilter", () => {
  it("skips clear junk by filename", () => {
    expect(filenamePrefilter("22091-1310-01 Bar Schedule.pdf")?.category).toBe(
      "NOT_RELEVANT",
    );
    expect(filenamePrefilter("105 POS Area Proposed Levels.pdf")?.category).toBe(
      "NOT_RELEVANT",
    );
  });
  it("never skips a file whose name mentions site/plot/elevation", () => {
    // Contains "Foundations" but is a site layout — must NOT be skipped.
    expect(
      filenamePrefilter("22091-1001B Site Layout Showing Strip Trench Foundations.pdf"),
    ).toBeNull();
    expect(filenamePrefilter("L464_Chesterwood_Rev C4.pdf")).toBeNull();
  });
});

describe("categoriseDocument", () => {
  const page = (kind: PageClass["kind"]): PageClass => ({
    page: 1,
    kind,
    relevant: kind === "ELEVATION" || kind === "FLOOR_PLAN" || kind === "SECTION",
    houseTypeCode: null,
    houseTypeName: null,
    title: "",
  });

  it("house drawings when there are elevations/floor plans", () => {
    expect(
      categoriseDocument({ fileName: "x.pdf", pages: [page("ELEVATION")], hasText: true }).category,
    ).toBe("HOUSE_TYPE_DRAWINGS");
  });
  it("a lone SECTION file is NOT a house type", () => {
    expect(
      categoriseDocument({ fileName: "Long Sections.pdf", pages: [page("SECTION")], hasText: true }).category,
    ).not.toBe("HOUSE_TYPE_DRAWINGS");
  });
  it("UNCERTAIN when there's text but nothing recognisable and no junk name", () => {
    // e.g. an image-only 'NB - Delamont (AL21)' drawing with no text titles.
    expect(
      categoriseDocument({
        fileName: "NB - Delamont (AL21) - Rev A.pdf",
        pages: [page("OTHER")],
        hasText: true,
      }).category,
    ).toBe("UNCERTAIN");
  });
  it("site layout when there are plot-layout pages", () => {
    expect(
      categoriseDocument({ fileName: "x.pdf", pages: [page("PLOT_LAYOUT")], hasText: true }).category,
    ).toBe("SITE_LAYOUT");
  });
  it("not relevant when nothing useful, with a filename detail", () => {
    const r = categoriseDocument({
      fileName: "Bar Schedule.pdf",
      pages: [page("OTHER")],
      hasText: true,
    });
    expect(r.category).toBe("NOT_RELEVANT");
    expect(r.detail).toBe("Reinforcement schedule");
  });
  it("unreadable when there is no text layer", () => {
    expect(
      categoriseDocument({ fileName: "scan.pdf", pages: [], hasText: false }).category,
    ).toBe("UNREADABLE");
  });

  it("relevance flags line up", () => {
    expect(isRelevantCategory("HOUSE_TYPE_DRAWINGS")).toBe(true);
    expect(isRelevantCategory("SITE_LAYOUT")).toBe(true);
    expect(isRelevantCategory("NOT_RELEVANT")).toBe(false);
    expect(isRelevantCategory("UNREADABLE")).toBe(false);
  });
});
