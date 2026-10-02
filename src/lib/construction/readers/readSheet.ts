/**
 * Read ONE register sheet with the right reader (docs/23 §12). SERVER/WORKER ONLY.
 * Prepares the document (the single page, tiled when it is bigger than A4 so the
 * small print is legible — docs/20 §3.2), builds the hint block from the sheet's
 * deterministic geometry, and calls the reader for its kind.
 *
 * A mark-up that carries PRINTED NUMBERS (Wren's measure sheet: blue / red / green
 * zones with lengths and lift counts written on) keeps the proven docs/20 reader
 * (`readDrawing`), because its numbers are the answer. A colour-only mark-up
 * (CBAND) goes to the new mark-up reader with the building's plan beside it.
 */

import { PDFDocument } from "pdf-lib";
import type { SheetGeometry } from "../pack/sheetGeometry";
import { buildTiledPdf } from "../drawingTiles";
import { flattenAnnotations } from "../pack/flattenAnnots";
import { readDrawing } from "../readDrawing";
import type { DrawingObservations } from "../drawingSchema";
import { callSheetReader, type ReaderMeta } from "./common";
import { PROMPTS, READER_VERSIONS, buildSheetHints } from "./prompts";
import {
  ELEVATION_TOOL,
  MARKUP_TOOL,
  PLAN_TOOL,
  ROOF_TOOL,
  SECTION_TOOL,
  elevationSchema,
  markupSchema,
  planSchema,
  roofSchema,
  sectionSchema,
  type ElevationRead,
  type MarkupRead,
  type PlanRead,
  type RoofRead,
  type SectionRead,
} from "./schemas";

export type SheetReadKind = "PLAN" | "ELEVATION" | "SECTION" | "ROOF" | "MARKUP" | "MARKUP_NUMBERS";

/** Which reader a register sheet gets. */
export function readKindFor(kind: string, geometry: SheetGeometry | null): SheetReadKind | null {
  switch (kind) {
    case "PLAN":
      return "PLAN";
    case "ROOF_PLAN":
      return "ROOF";
    case "ELEVATION":
      return "ELEVATION";
    case "SECTION":
      return "SECTION";
    case "MARKUP":
      // Numbers written on a vector mark-up → the proven numbers reader.
      return geometry && geometry.dimensions.length >= 5 ? "MARKUP_NUMBERS" : "MARKUP";
    default:
      return null;
  }
}

/** The version that decides whether an unchanged sheet must be re-read. */
export function readerVersion(kind: SheetReadKind): string {
  return kind === "MARKUP_NUMBERS" ? "legacy-docs20-flattened" : READER_VERSIONS[kind];
}

/** Copy one page out of a PDF (1-based). */
export async function singlePage(bytes: Buffer, page: number): Promise<Buffer> {
  const src = await PDFDocument.load(bytes, { updateMetadata: false });
  if (src.getPageCount() === 1) return bytes;
  const out = await PDFDocument.create();
  const [p] = await out.copyPages(src, [page - 1]);
  out.addPage(p);
  return Buffer.from(await out.save());
}

export type SheetReadData =
  | { kind: "PLAN"; data: PlanRead }
  | { kind: "ELEVATION"; data: ElevationRead }
  | { kind: "SECTION"; data: SectionRead }
  | { kind: "ROOF"; data: RoofRead }
  | { kind: "MARKUP"; data: MarkupRead }
  | { kind: "MARKUP_NUMBERS"; data: DrawingObservations };

export interface SheetReadOutput {
  read: SheetReadData;
  raw: unknown;
  meta: ReaderMeta;
  tiles: number;
}

export interface SheetReadInput {
  kind: SheetReadKind;
  title: string;
  /** The whole file (the page is cut out of it). */
  fileBytes: Buffer;
  page: number;
  geometry: SheetGeometry | null;
  rawText: string;
  /** Mark-up only: the building's floor plan page and its traced wall segments. */
  planContext?: { planPdf: Buffer; segments: string; rooms: string } | null;
  /** Deterministic facts to state alongside the hints (e.g. the mark-up's shape list). */
  extraHints?: string | null;
}

export async function readSheet(input: SheetReadInput): Promise<SheetReadOutput> {
  // Mark-ups made in Bluebeam / Acrobat are ANNOTATIONS; draw them into the page
  // first or tiling (and some renderers) drop them (Wren's measure sheet).
  const pagePdf = (await flattenAnnotations(await singlePage(input.fileBytes, input.page))).bytes;

  if (input.kind === "MARKUP_NUMBERS") {
    const r = await readDrawing(pagePdf);
    return {
      read: { kind: "MARKUP_NUMBERS", data: r.observations },
      raw: r.meta.raw,
      meta: { ...r.meta, promptVersion: readerVersion("MARKUP_NUMBERS") },
      tiles: r.tiles,
    };
  }

  const tiled = await buildTiledPdf(pagePdf, 0).catch(() => null);
  const doc = tiled?.bytes ?? pagePdf;
  const guide = tiled
    ? "HOW THE SHEET IS SENT: page 1 is the WHOLE sheet; the pages after it are magnified overlapping crops of it:\n" +
      tiled.pageGuide.map((g) => `  ${g}`).join("\n") +
      "\nRead small print on the crops; use page 1 for where things sit. Never count a feature twice.\n\n"
    : "";
  const hints =
    buildSheetHints(input.geometry, input.rawText, { title: input.title }) +
    (input.extraHints ? `\n\nFACTS FROM THE FILE ITSELF: ${input.extraHints}` : "");

  switch (input.kind) {
    case "PLAN": {
      const r = await callSheetReader({
        promptVersion: READER_VERSIONS.PLAN,
        documents: [doc],
        system: PROMPTS.PLAN,
        userText: guide + hints,
        toolName: PLAN_TOOL,
        toolDescription: "Record the floor plan: the external wall outline (clockwise), rooms, cores, openings and features.",
        schema: planSchema,
      });
      return { read: { kind: "PLAN", data: r.data }, raw: r.raw, meta: r.meta, tiles: tiled?.plan.tiles.length ?? 0 };
    }
    case "ELEVATION": {
      const r = await callSheetReader({
        promptVersion: READER_VERSIONS.ELEVATION,
        documents: [doc],
        system: PROMPTS.ELEVATION,
        userText: guide + hints,
        toolName: ELEVATION_TOOL,
        toolDescription: "Record the elevation: heights by part, level markers, ground line, roof shape and gable apexes.",
        schema: elevationSchema,
      });
      return { read: { kind: "ELEVATION", data: r.data }, raw: r.raw, meta: r.meta, tiles: tiled?.plan.tiles.length ?? 0 };
    }
    case "SECTION": {
      const r = await callSheetReader({
        promptVersion: READER_VERSIONS.SECTION,
        documents: [doc],
        system: PROMPTS.SECTION,
        userText: guide + hints,
        toolName: SECTION_TOOL,
        toolDescription: "Record the section: heights, internal clear heights, pitch, stairs, lift pit and overrun.",
        schema: sectionSchema,
      });
      return { read: { kind: "SECTION", data: r.data }, raw: r.raw, meta: r.meta, tiles: tiled?.plan.tiles.length ?? 0 };
    }
    case "ROOF": {
      const r = await callSheetReader({
        promptVersion: READER_VERSIONS.ROOF,
        documents: [doc],
        system: PROMPTS.ROOF,
        userText: guide + hints,
        toolName: ROOF_TOOL,
        toolDescription: "Record the roof plan: form, gables (main vs porch), edges by type, access, overruns, rooflights.",
        schema: roofSchema,
      });
      return { read: { kind: "ROOF", data: r.data }, raw: r.raw, meta: r.meta, tiles: tiled?.plan.tiles.length ?? 0 };
    }
    case "MARKUP": {
      const docs = [doc, ...(input.planContext ? [input.planContext.planPdf] : [])];
      const ctx = input.planContext
        ? `THE BUILDING'S FLOOR PLAN is the second document. Its external wall segments, traced clockwise:\n${input.planContext.segments}\nIts rooms: ${input.planContext.rooms}\n\n`
        : "No floor plan of this building was read — describe the covered walls in plain words.\n\n";
      const r = await callSheetReader({
        promptVersion: READER_VERSIONS.MARKUP,
        documents: docs,
        system: PROMPTS.MARKUP,
        userText: guide + ctx + hints,
        toolName: MARKUP_TOOL,
        toolDescription: "Record what each colour of the mark-up means and which walls / rooms it covers.",
        schema: markupSchema,
      });
      return { read: { kind: "MARKUP", data: r.data }, raw: r.raw, meta: r.meta, tiles: tiled?.plan.tiles.length ?? 0 };
    }
  }
}
