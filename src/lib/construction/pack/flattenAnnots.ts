/**
 * Flatten a PDF page's ANNOTATIONS into its content (pdf-lib only).
 *
 * Why: a client's mark-up is often made in Bluebeam / Acrobat, and those tools
 * store the coloured zones, dimension lines and text boxes as ANNOTATIONS, not as
 * page content (Wren's measure sheet: 11 polygons, 6 lines, 4 text boxes). Our
 * tiling copies a page with `embedPage`, which takes the content stream only — so
 * every crop, and the overview, silently lost the mark-up and the reader was shown
 * a clean architect's drawing. Drawing each annotation's appearance stream into
 * the page first makes the mark-up survive every copy, crop and render.
 *
 * The placement follows the PDF spec (§12.5.5): the appearance form's BBox,
 * transformed by its Matrix, is mapped onto the annotation's Rect.
 */

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFStream, type PDFPage } from "pdf-lib";

const SKIP = new Set(["/Popup", "/Link", "/Widget"]);

const nums = (arr: PDFArray | undefined, n: number, fallback: number[]): number[] => {
  if (!arr || arr.size() < n) return fallback;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = arr.lookup(i);
    out.push(v instanceof PDFNumber ? v.asNumber() : Number(String(v)));
  }
  return out.every(Number.isFinite) ? out : fallback;
};

/** The normal appearance stream of an annotation (respecting its /AS state). */
function appearanceRef(annot: PDFDict): PDFRef | PDFStream | null {
  const ap = annot.lookupMaybe(PDFName.of("AP"), PDFDict);
  if (!ap) return null;
  const n = ap.get(PDFName.of("N"));
  if (!n) return null;
  const resolved = annot.context.lookup(n);
  if (resolved instanceof PDFStream) return n instanceof PDFRef ? n : resolved;
  if (resolved instanceof PDFDict) {
    // Several states (checkboxes, stamps): pick the one named by /AS.
    const as = annot.get(PDFName.of("AS"));
    const pick = as ? resolved.get(as as PDFName) : undefined;
    if (pick && annot.context.lookup(pick) instanceof PDFStream) return pick as PDFRef;
  }
  return null;
}

/** Draw every visible annotation's appearance into the page; returns how many. */
export function flattenPageAnnotations(page: PDFPage): number {
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!annots || annots.size() === 0) return 0;
  let drawn = 0;
  for (let i = 0; i < annots.size(); i++) {
    const annot = annots.lookupMaybe(i, PDFDict);
    if (!annot) continue;
    const subtype = String(annot.get(PDFName.of("Subtype")) ?? "");
    if (SKIP.has(subtype)) continue;
    const flags = annot.lookupMaybe(PDFName.of("F"), PDFNumber)?.asNumber() ?? 0;
    if (flags & 2 || flags & 32) continue; // Hidden / NoView
    const ref = appearanceRef(annot);
    if (!ref) continue;
    const form = annot.context.lookup(ref) as PDFStream;
    const rect = nums(annot.lookupMaybe(PDFName.of("Rect"), PDFArray), 4, []);
    if (rect.length !== 4) continue;
    const [rx0, ry0, rx1, ry1] = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
    const bbox = nums(form.dict.lookupMaybe(PDFName.of("BBox"), PDFArray), 4, [rx0, ry0, rx1, ry1]);
    const [a, b, c, d, e, f] = nums(form.dict.lookupMaybe(PDFName.of("Matrix"), PDFArray), 6, [1, 0, 0, 1, 0, 0]);
    const corners = [
      [bbox[0], bbox[1]],
      [bbox[2], bbox[1]],
      [bbox[0], bbox[3]],
      [bbox[2], bbox[3]],
    ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
    const tx0 = Math.min(...corners.map((p) => p[0]));
    const tx1 = Math.max(...corners.map((p) => p[0]));
    const ty0 = Math.min(...corners.map((p) => p[1]));
    const ty1 = Math.max(...corners.map((p) => p[1]));
    if (tx1 - tx0 <= 0 || ty1 - ty0 <= 0) continue;
    const sx = (rx1 - rx0) / (tx1 - tx0);
    const sy = (ry1 - ry0) / (ty1 - ty0);
    // Forms need /Subtype /Form to be drawable with Do.
    if (!form.dict.get(PDFName.of("Subtype"))) form.dict.set(PDFName.of("Subtype"), PDFName.of("Form"));
    const streamRef = ref instanceof PDFRef ? ref : annot.context.register(ref);
    const name = page.node.newXObject("Annot", streamRef);
    const ops = `q ${sx} 0 0 ${sy} ${rx0 - sx * tx0} ${ry0 - sy * ty0} cm ${name.asString()} Do Q`;
    const content = page.doc.context.flateStream(ops);
    page.node.addContentStream(page.doc.context.register(content));
    drawn++;
  }
  // The appearances are now page content; drop the annotations so nothing paints twice.
  page.node.delete(PDFName.of("Annots"));
  return drawn;
}

/** Flatten every page's annotations; returns the original bytes when there were none. */
export async function flattenAnnotations(bytes: Buffer): Promise<{ bytes: Buffer; flattened: number }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  let flattened = 0;
  for (const page of doc.getPages()) flattened += flattenPageAnnotations(page);
  if (flattened === 0) return { bytes, flattened: 0 };
  return { bytes: Buffer.from(await doc.save()), flattened };
}
