import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { assembleHouseTypePdf, type AssemblySource } from "./assemble";
import type { HouseTypeGrouping } from "./group";

/** Build a small PDF with `n` pages, each tagged so we can verify order later. */
async function makePdf(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([200, 200]);
  return doc.save();
}

describe("assembleHouseTypePdf", () => {
  it("merges pages from multiple source files into one PDF, in group order", async () => {
    const front = await makePdf(1); // Aspen front elevation (1pp)
    const plans = await makePdf(2); // Aspen GF + FF plans (2pp)

    const sources = new Map<string, AssemblySource>([
      ["front", { documentId: "front", relativePath: "Aspen/Front.pdf", bytes: front }],
      ["plans", { documentId: "plans", relativePath: "Aspen/Plans.pdf", bytes: plans }],
    ]);

    const group: HouseTypeGrouping = {
      name: "ASPEN",
      pages: [
        { documentId: "front", relativePath: "Aspen/Front.pdf", page: 1, drawingKind: "FRONT_ELEVATION", relevant: true },
        { documentId: "plans", relativePath: "Aspen/Plans.pdf", page: 1, drawingKind: "FLOOR_PLAN", relevant: true },
        { documentId: "plans", relativePath: "Aspen/Plans.pdf", page: 2, drawingKind: "FLOOR_PLAN", relevant: false },
      ],
      files: ["Aspen/Front.pdf", "Aspen/Plans.pdf"],
      relevantPageCount: 2,
      totalPageCount: 3,
      confidence: "high",
      flags: [],
    };

    const res = await assembleHouseTypePdf(group, sources);

    expect(res.pageCount).toBe(3);
    expect(res.skipped).toEqual([]);
    // Manifest maps assembled page → source file + page, in order, with relevance.
    expect(res.pageManifest.map((m) => `${m.relativePath}#${m.sourcePage}`)).toEqual([
      "Aspen/Front.pdf#1",
      "Aspen/Plans.pdf#1",
      "Aspen/Plans.pdf#2",
    ]);
    expect(res.pageManifest.map((m) => m.relevant)).toEqual([true, true, false]);
    // The output is a real, loadable PDF with the right page count.
    const reloaded = await PDFDocument.load(res.bytes);
    expect(reloaded.getPageCount()).toBe(3);
  });

  it("skips (does not crash on) a missing source or out-of-range page", async () => {
    const plans = await makePdf(1);
    const sources = new Map<string, AssemblySource>([
      ["plans", { documentId: "plans", relativePath: "X/Plans.pdf", bytes: plans }],
    ]);
    const group: HouseTypeGrouping = {
      name: "X",
      pages: [
        { documentId: "plans", relativePath: "X/Plans.pdf", page: 1, drawingKind: "FLOOR_PLAN", relevant: true },
        { documentId: "plans", relativePath: "X/Plans.pdf", page: 9, drawingKind: "FLOOR_PLAN", relevant: true }, // out of range
        { documentId: "missing", relativePath: "X/Gone.pdf", page: 1, drawingKind: "SECTION", relevant: true }, // no source
      ],
      files: ["X/Plans.pdf"],
      relevantPageCount: 3,
      totalPageCount: 3,
      confidence: "medium",
      flags: [],
    };

    const res = await assembleHouseTypePdf(group, sources);
    expect(res.pageCount).toBe(1);
    expect(res.skipped).toHaveLength(2);
    expect(res.skipped.map((s) => s.reason).sort()).toEqual(["page out of range", "source missing"]);
  });
});
