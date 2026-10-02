/**
 * Read a sorted construction pack (docs/22 Steps 7–9) — SERVER/WORKER ONLY, but
 * database-free: the worker (`src/server/constructionRead.ts`) and the offline
 * runner both drive this, so a job reads identically wherever it runs.
 *
 * Order: floor plans first (a colour mark-up is read against the plan's traced
 * walls), then elevations / sections / roofs, then mark-ups; at most `concurrency`
 * model calls in flight. A sheet whose bytes and reader version are unchanged
 * reuses its stored read (no second bill). Then, per building, the building model
 * (pure) turns the reads into the measurement sheet; for a scope job (mode A) the
 * scope is read too and the Wren-style numbered mark-up is assembled into draft
 * lines exactly as before (docs/20).
 */

import { mapPool } from "./ingest";
import type { SheetGeometry } from "./sheetGeometry";
import { readSheet, readKindFor, readerVersion, singlePage, type SheetReadData, type SheetReadKind } from "../readers/readSheet";
import type { ReaderMeta } from "../readers/common";
import { buildBuildingModel, type BuildingModel, type SheetForModel } from "../model/buildingModel";
import type { ResolvedParams } from "../params";
import { lengthStringToM, parseOutline } from "../model/outline";
import { describeMarkupShapes } from "./pptx";

export interface SheetToRead {
  key: string; // stable id (DB sheet id, or fileId:page offline)
  fileId: string;
  page: number;
  kind: string; // register kind
  title: string;
  level: string | null;
  buildingKey: string | null;
  geometry: SheetGeometry | null;
  rawText: string;
  contentHash: string | null;
  /** Deterministic facts for the reader (e.g. a mark-up's own .pptx shape list). */
  extraHints?: string | null;
}

export interface SheetReadRecord {
  key: string;
  readKind: SheetReadKind;
  readKey: string;
  read: SheetReadData | null;
  raw: unknown;
  meta: ReaderMeta | null;
  reused: boolean;
  tiles: number;
  error: string | null;
}

export interface PackReadResult {
  reads: SheetReadRecord[];
  models: { buildingKey: string; name: string; model: BuildingModel }[];
  costUsd: number;
  flags: string[];
}

export interface ReadPackOptions {
  sheets: SheetToRead[];
  buildings: { key: string; name: string }[];
  /** The file's bytes; for a .pptx, the rendered PDF of its slides. */
  loadFile: (fileId: string) => Promise<Buffer>;
  params: ResolvedParams;
  /** Proposed ground levels relative to FFL, per building key ("*" = the whole job). */
  groundRelMm: Record<string, number[]>;
  /** A stored read for this sheet, if its readKey still matches. */
  cached?: (key: string, readKey: string) => { read: SheetReadData; raw: unknown } | null;
  onSheet?: (rec: SheetReadRecord) => Promise<void> | void;
  concurrency?: number;
}

const PHASE: Record<SheetReadKind, number> = {
  PLAN: 0,
  ELEVATION: 1,
  SECTION: 1,
  ROOF: 1,
  MARKUP_NUMBERS: 1,
  MARKUP: 2,
};

export async function readPack(opts: ReadPackOptions): Promise<PackReadResult> {
  const conc = opts.concurrency ?? 3;
  const records = new Map<string, SheetReadRecord>();
  const fileCache = new Map<string, Promise<Buffer>>();
  const load = (id: string) => {
    if (!fileCache.has(id)) fileCache.set(id, opts.loadFile(id));
    return fileCache.get(id)!;
  };

  const jobs = opts.sheets
    .map((s) => ({ s, kind: readKindFor(s.kind, s.geometry) }))
    .filter((j): j is { s: SheetToRead; kind: SheetReadKind } => j.kind != null);

  for (const phase of [0, 1, 2]) {
    const batch = jobs.filter((j) => PHASE[j.kind] === phase);
    await mapPool(batch, conc, async ({ s, kind }) => {
      // Hash first (the ingest keeps a read only while the file is unchanged), then the
      // page — two slides / pages of one file are different sheets — then the reader.
      const readKey = `${s.contentHash ?? "nohash"}|p${s.page}|${readerVersion(kind)}|${kind}`;
      const hit = opts.cached?.(s.key, readKey);
      let rec: SheetReadRecord;
      if (hit) {
        rec = { key: s.key, readKind: kind, readKey, read: hit.read, raw: hit.raw, meta: null, reused: true, tiles: 0, error: null };
      } else {
        try {
          const planContext = kind === "MARKUP" ? await markupPlanContext(s, opts, records, load) : null;
          const out = await readSheet({
            kind,
            title: s.title,
            fileBytes: await load(s.fileId),
            page: s.page,
            geometry: s.geometry,
            rawText: s.rawText,
            planContext,
            extraHints: s.extraHints ?? null,
          });
          rec = { key: s.key, readKind: kind, readKey, read: out.read, raw: out.raw, meta: out.meta, reused: false, tiles: out.tiles, error: null };
        } catch (e) {
          rec = {
            key: s.key,
            readKind: kind,
            readKey,
            read: null,
            raw: null,
            meta: null,
            reused: false,
            tiles: 0,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }
      records.set(s.key, rec);
      await opts.onSheet?.(rec);
    });
  }

  // --- Building models ---------------------------------------------------------------
  const models: PackReadResult["models"] = [];
  const flags: string[] = [];
  for (const b of opts.buildings) {
    const mine = opts.sheets.filter((s) => s.buildingKey === b.key);
    const forModel: SheetForModel[] = [];
    for (const s of mine) {
      const rec = records.get(s.key);
      const kind = readKindFor(s.kind, s.geometry);
      if (!kind || kind === "MARKUP_NUMBERS") continue;
      const base = { sheetId: s.key, title: s.title, level: s.level, geometry: s.geometry, rawText: s.rawText };
      const r = rec?.read;
      if (kind === "PLAN") forModel.push({ ...base, kind: "PLAN", plan: r?.kind === "PLAN" ? r.data : undefined });
      else if (kind === "ELEVATION") forModel.push({ ...base, kind: "ELEVATION", elevation: r?.kind === "ELEVATION" ? r.data : undefined });
      else if (kind === "SECTION") forModel.push({ ...base, kind: "SECTION", section: r?.kind === "SECTION" ? r.data : undefined });
      else if (kind === "ROOF") forModel.push({ ...base, kind: "ROOF", roof: r?.kind === "ROOF" ? r.data : undefined });
      else if (kind === "MARKUP") forModel.push({ ...base, kind: "MARKUP", markup: r?.kind === "MARKUP" ? r.data : undefined });
    }
    if (forModel.length === 0) continue;
    const ground = opts.groundRelMm[b.key] ?? opts.groundRelMm["*"] ?? [];
    const model = buildBuildingModel(b.name, forModel, { params: opts.params, groundRelMm: ground });
    models.push({ buildingKey: b.key, name: b.name, model });
  }
  for (const r of records.values()) if (r.error) flags.push(`${opts.sheets.find((s) => s.key === r.key)?.title}: could not be read — ${r.error}`);

  const costUsd = [...records.values()].reduce((a, r) => a + (r.meta?.costUsd ?? 0), 0);
  return { reads: [...records.values()], models, costUsd: Math.round(costUsd * 10000) / 10000, flags };
}

/** The mark-up reader sees the building's ground-floor plan + its traced wall segments. */
async function markupPlanContext(
  s: SheetToRead,
  opts: ReadPackOptions,
  records: Map<string, SheetReadRecord>,
  load: (id: string) => Promise<Buffer>,
): Promise<{ planPdf: Buffer; segments: string; rooms: string } | null> {
  const plans = opts.sheets.filter((x) => x.kind === "PLAN" && x.buildingKey === s.buildingKey);
  const plan = plans.find((x) => x.level === "GF") ?? plans[0];
  if (!plan) return null;
  const rec = records.get(plan.key);
  const read = rec?.read?.kind === "PLAN" ? rec.read.data : null;
  const planPdf = await singlePage(await load(plan.fileId), plan.page);
  const parsed = read ? parseOutline(read.outline).segments : [];
  const segments = parsed.length
    ? parsed
        .map((seg) => {
          const len = seg.lengthStrings.map(lengthStringToM).filter((v): v is number => v != null);
          return `  ${seg.id}: travelling ${seg.direction}${len.length ? `, ${len.reduce((a, b) => a + b, 0).toFixed(3)} m` : ""}${seg.feature !== "WALL" ? ` (${seg.feature.toLowerCase()})` : ""}${seg.note ? ` — ${seg.note}` : ""}`;
        })
        .join("\n") + `\n  (starting at ${read!.startCorner ?? "the top-left corner"}; ${read!.outlineReason})`
    : "  (the plan's outline was not traced)";
  const rooms = read?.rooms.map((r) => r.label).join(", ") || "(none read)";
  return { planPdf, segments, rooms };
}

/**
 * For each mark-up sheet, the drawing-layer facts of its .pptx (the file itself, or
 * the slides it was exported from): which shapes are fills and which are bands.
 */
export function markupShapeHints(
  files: { id: string; pptx?: { slides: import("./pptx").PptxSlide[] } }[],
  readVia: { pptxFileId: string; pdfFileId: string }[],
): Map<string, string> {
  const out = new Map<string, string>();
  const byId = new Map(files.map((f) => [f.id, f]));
  const add = (fileId: string, slides: import("./pptx").PptxSlide[]) => {
    for (const sl of slides) out.set(`${fileId}:${sl.index}`, describeMarkupShapes(sl, slides));
  };
  for (const f of files) if (f.pptx) add(f.id, f.pptx.slides);
  for (const r of readVia) {
    const slides = byId.get(r.pptxFileId)?.pptx?.slides;
    if (slides) add(r.pdfFileId, slides);
  }
  return out;
}
