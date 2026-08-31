import { describe, it, expect } from "vitest";
import { recipeSchema, compileRecipe, type Recipe } from "./recipe";
import { isIgnoredPath } from "./profiles";

const V = "VISTRY SOUTH EAST MIDLANDS TOP WIGHAY";
const B = "BLOOR OADBY PH2A/OneDrive_1_17-02-2025";
const T = "TILIA HAWKESBURY/Housetypes 1";
const TW = "TAYLOR WIMPEY NORTH MIDS PERRYFIELDS 2B";

const make = (r: Partial<Recipe> & Pick<Recipe, "strategy">) => recipeSchema.parse(r);

describe("compileRecipe — strategy vocabulary maps to correct grouping", () => {
  it("folder-after-marker (Vistry): type = folder after the marker; buckets → null", () => {
    const p = compileRecipe(make({ strategy: "folder-after-marker", folderMarker: "Scaffold" }));
    const f = p.grouping.houseTypeFromPath;
    expect(f(`${V}/Scaffold/Aspen/240780-…_The Aspen-Ground Floor Plan_P02.pdf`)).toBe("ASPEN");
    expect(f(`${V}/Scaffold/Beech/x.pdf`)).toBe("BEECH");
    expect(f(`${V}/Scaffold/Block Plans/24-078 B001.pdf`)).toBeNull();
    expect(f(`${V}/Scaffold/Boundaries/x.pdf`)).toBeNull();
  });

  it("folder-after-marker with MULTIPLE markers (mixed pack: houses + apartments)", () => {
    const p = compileRecipe(
      make({ strategy: "folder-after-marker", folderMarkers: ["Masonry", "Apartment_Block_Type"] }),
    );
    const f = p.grouping.houseTypeFromPath;
    // Houses live under "Masonry"; apartments under "Apartment_Block_Type" — both resolve.
    expect(
      f(`${TW}/House_Type/Masonry/EMA21_Avonsford/00_House_Type_PDF/EMA21-Avonsford END - 2021.pdf`),
    ).toBe("EMA21 AVONSFORD");
    expect(
      f(`${TW}/Apartment_Block_Type/APARTMENT_BLOCK_A_PLOTS_107_127/51_GA ELEVATIONS.pdf`),
    ).toBe("APARTMENT BLOCK A PLOTS 107 127");
    // A pack-level bucket after a marker is still not a house type.
    expect(f(`${TW}/House_Type/Masonry/Site Plans/x.pdf`)).toBeNull();
  });

  it("folder-parent: type = the folder that contains the file", () => {
    const p = compileRecipe(make({ strategy: "folder-parent" }));
    const f = p.grouping.houseTypeFromPath;
    expect(f(`${V}/Scaffold/Aspen/x.pdf`)).toBe("ASPEN");
    expect(f(`${TW}/Apartment_Block_Type/APARTMENT_BLOCK_A_PLOTS_107_127/51_GA ELEVATIONS.pdf`)).toBe(
      "APARTMENT BLOCK A PLOTS 107 127",
    );
    // A loose file directly under the pack root is NOT a house type (no bogus
    // group named after the whole pack).
    expect(f(`${V}/some-loose-file.pdf`)).toBeNull();
  });

  it("filename-prefix (Tilia): type = prefix before the sheet number", () => {
    const p = compileRecipe(make({ strategy: "filename-prefix" }));
    const f = p.grouping.houseTypeFromPath;
    expect(f(`${T}/CROMFORD-201-03D Front Elevation Plots 4, 21_Ver3.pdf`)).toBe("CROMFORD");
    expect(f(`${T}/SM1_SM2-201-01D Ground Floor Plan Plots 9_Ver6.pdf`)).toBe("SM1 SM2");
  });

  it("filename-name-token (Bloor): type = name after the code, before the revision", () => {
    const p = compileRecipe(make({ strategy: "filename-name-token" }));
    const f = p.grouping.houseTypeFromPath;
    expect(f(`${B}/372_BYRON_ISSUE_4.13.pdf`)).toBe("BYRON");
    expect(f(`${B}/470-1_HALLAM_ISSUE_7.1.pdf`)).toBe("HALLAM");
  });

  it("combined-pdf (TW): type = the folder above the combined-PDF folder; loose → parent", () => {
    const p = compileRecipe(
      make({ strategy: "combined-pdf", combinedPdfFolder: "00_House_Type_PDF" }),
    );
    const f = p.grouping.houseTypeFromPath;
    expect(
      f(`${TW}/House_Type/Masonry/EMA21_Avonsford/00_House_Type_PDF/EMA21-Avonsford END - 2021.pdf`),
    ).toBe("EMA21 AVONSFORD");
    // A loose sheet (apartment GA) falls back to its parent folder.
    expect(f(`${TW}/Apartment_Block_Type/APARTMENT_BLOCK_A_PLOTS_1_12/51_GA ELEVATIONS.pdf`)).toBe(
      "APARTMENT BLOCK A PLOTS 1 12",
    );
    expect(p.grouping.isCombinedPdf?.(
      `${TW}/House_Type/Masonry/EMA21_Avonsford/00_House_Type_PDF/x.pdf`,
    )).toBe(true);
  });
});

describe("compileRecipe — junk keywords → ignore rules", () => {
  it("junkFolderKeywords + junkFileKeywords compile to safe ignore patterns", () => {
    const p = compileRecipe(
      make({
        strategy: "combined-pdf",
        combinedPdfFolder: "00_House_Type_PDF",
        junkFolderKeywords: ["Kitchens", "Wardrobes", "SAP"],
        junkFileKeywords: ["Materials Layout", "Take Off"],
      }),
    );
    expect(isIgnoredPath(p, `${TW}/…/EMA21_Avonsford/06_Kitchens/x.pdf`)).toBe(true);
    expect(isIgnoredPath(p, `${TW}/…/EMA21_Avonsford/11_Wardrobes/x.pdf`)).toBe(true);
    expect(isIgnoredPath(p, `${TW}/…/MI114 (Materials Layout).pdf`)).toBe(true);
    // The combined drawing itself is NOT junk.
    expect(isIgnoredPath(p, `${TW}/…/EMA21_Avonsford/00_House_Type_PDF/x.pdf`)).toBe(false);
  });

  it("special-regex characters in keywords don't break compilation", () => {
    const p = compileRecipe(make({ strategy: "folder-parent", junkFileKeywords: ["M+E (services)"] }));
    expect(isIgnoredPath(p, `X/Y/M+E (services) layout.pdf`)).toBe(true);
  });
});

describe("recipeSchema", () => {
  it("applies defaults for the array/meta fields", () => {
    const r = recipeSchema.parse({ strategy: "folder-parent" });
    expect(r.junkFolderKeywords).toEqual([]);
    expect(r.confidence).toBe("medium");
  });
});
