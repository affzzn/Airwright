import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFArray } from "pdf-lib";
import { flattenAnnotations } from "./flattenAnnots";
import { buildTiledPdf } from "../drawingTiles";

/** A page with one Square annotation whose appearance is a filled box. */
async function pdfWithAnnotation(width = 2384, height = 1684): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([width, height]);
  const ctx = doc.context;
  const ap = ctx.flateStream("0 0 1 rg 0 0 100 50 re f", {
    Type: "XObject",
    Subtype: "Form",
    BBox: [0, 0, 100, 50],
  });
  const apRef = ctx.register(ap);
  const annot = ctx.obj({
    Type: "Annot",
    Subtype: "Square",
    Rect: [200, 300, 300, 350],
    AP: { N: apRef },
  });
  const popup = ctx.obj({ Type: "Annot", Subtype: "Popup", Rect: [0, 0, 10, 10] });
  page.node.set(PDFName.of("Annots"), ctx.obj([ctx.register(annot), ctx.register(popup)]));
  return Buffer.from(await doc.save());
}

describe("flattenAnnotations — mark-ups survive tiling", () => {
  it("draws the appearance into the page and removes the annotations", async () => {
    const src = await pdfWithAnnotation();
    const { bytes, flattened } = await flattenAnnotations(src);
    expect(flattened).toBe(1); // the popup is skipped
    const doc = await PDFDocument.load(bytes);
    const page = doc.getPage(0);
    expect(page.node.lookupMaybe(PDFName.of("Annots"), PDFArray)).toBeUndefined();
    const xobjects = page.node.Resources()?.lookupMaybe(PDFName.of("XObject"), (await import("pdf-lib")).PDFDict);
    expect(xobjects?.keys().some((k) => k.asString().startsWith("/Annot"))).toBe(true);
  });
  it("is a no-op (same bytes) for a page with no annotations", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const src = Buffer.from(await doc.save());
    const r = await flattenAnnotations(src);
    expect(r.flattened).toBe(0);
    expect(r.bytes).toBe(src);
  });
  it("a flattened A1 sheet still tiles", async () => {
    const { bytes } = await flattenAnnotations(await pdfWithAnnotation());
    const tiled = await buildTiledPdf(bytes, 0);
    expect(tiled?.plan.tiles.length).toBeGreaterThan(1);
  });
});
