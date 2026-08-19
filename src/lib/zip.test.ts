import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { collectZipPdfEntries } from "./zip";

const pdf = (s: string) => strToU8(`%PDF-1.4 ${s}`);

describe("collectZipPdfEntries — recursive, nothing vanishes silently", () => {
  it("collects top-level PDFs and skips junk entries", () => {
    const zip = zipSync({
      "House A.pdf": pdf("a"),
      "__MACOSX/House A.pdf": pdf("junk"),
      "folder/.hidden.pdf": pdf("junk"),
      "folder/House B.pdf": pdf("b"),
    });
    const { pdfs, skipped } = collectZipPdfEntries(zip);
    expect(pdfs.map((p) => p.name).sort()).toEqual(["House A.pdf", "House B.pdf"]);
    expect(skipped).toEqual([]);
  });

  it("recurses into nested zips (the real Oadby pack shape)", () => {
    const inner = zipSync({ "Wollaton.pdf": pdf("w"), "Dawlish.pdf": pdf("d") });
    const outer = zipSync({
      "Site Layout.pdf": pdf("s"),
      "OneDrive_1_16-12-2025 (1).zip": inner,
    });
    const { pdfs } = collectZipPdfEntries(outer);
    const names = pdfs.map((p) => p.name).sort();
    expect(names).toContain("Site Layout.pdf");
    expect(names).toContain("OneDrive_1_16-12-2025 (1).zip/Wollaton.pdf");
    expect(names).toContain("OneDrive_1_16-12-2025 (1).zip/Dawlish.pdf");
    expect(pdfs).toHaveLength(3);
  });

  it("reports non-PDF payload files in skipped instead of hiding them", () => {
    const zip = zipSync({
      "Drawing.pdf": pdf("x"),
      "Pricing Matrix.xls": strToU8("xls-bytes"),
      "notes.docx": strToU8("docx-bytes"),
    });
    const { pdfs, skipped } = collectZipPdfEntries(zip);
    expect(pdfs).toHaveLength(1);
    expect(skipped.sort()).toEqual(["Pricing Matrix.xls", "notes.docx"]);
  });

  it("expands three levels but stops at the depth limit rather than recursing forever", () => {
    const l4 = zipSync({ "way-too-deep.pdf": pdf("x") });
    const l3 = zipSync({ "deep.pdf": pdf("deep"), "l4.zip": l4 });
    const l2 = zipSync({ "l3.zip": l3 });
    const l1 = zipSync({ "l2.zip": l2, "top.pdf": pdf("top") });
    const { pdfs, skipped } = collectZipPdfEntries(l1);
    const names = pdfs.map((p) => p.name);
    expect(names).toContain("top.pdf");
    // three levels of nesting still expand (real packs are zips-of-zips)…
    expect(names.some((n) => n.endsWith("deep.pdf"))).toBe(true);
    // …but the fourth level is flagged, not silently followed forever.
    expect(names.some((n) => n.endsWith("way-too-deep.pdf"))).toBe(false);
    expect(skipped.some((s) => s.includes("too deep"))).toBe(true);
  });

  it("flags a corrupt archive instead of throwing", () => {
    const { pdfs, skipped } = collectZipPdfEntries(strToU8("not a zip at all"));
    expect(pdfs).toEqual([]);
    expect(skipped.some((s) => s.includes("could not be unzipped"))).toBe(true);
  });
});
