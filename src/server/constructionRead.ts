/**
 * Construction pack reading — the DATABASE side (docs/22 Steps 7 + 10). Runs in
 * the worker (`construction-read` job) or in-process from a script; never inside a
 * web request.
 *
 * A read RUN is saved (status, progress, cost, result) so it survives a reload and
 * a retry; every sheet's read is saved on the sheet as it finishes, keyed by file
 * hash + page + reader version, so a retry — or a re-run after one more file
 * arrives — pays only for what changed. At the end each building's measurement
 * sheet replaces the previous AI run's measurements (hand-entered ones are never
 * touched), and a scope job's draft lines are kept on the run for review.
 *
 * The scenario (from the upload boxes) decides what is read:
 *   A (Scenario 1) — the scope + email ONLY; the client's numbers as given (`scopeOnly.ts`);
 *   B (Scenario 2) — the drawings ONLY, for the sure things;
 *   C (Scenario 3) — nothing (the action refuses to start a run).
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { downloadFromStorage } from "@/lib/supabase/storage";
import { fileTypeOf } from "@/lib/construction/pack/files";
import { probePdf, type ProbedPdf } from "@/lib/construction/pack/pdfProbe";
import { readPptx, type PptxRead, describeMarkupShapes } from "@/lib/construction/pack/pptx";
import { readPack, type PackReadResult, type SheetToRead } from "@/lib/construction/pack/readPack";
import type { SheetGeometry } from "@/lib/construction/pack/sheetGeometry";
import type { SheetReadData } from "@/lib/construction/readers/readSheet";
import { resolveJobParams } from "@/lib/construction/params";
import { createHash } from "node:crypto";
import { readScopeFile } from "@/lib/construction/scopeText";
import { draftFromScope } from "@/lib/construction/draftFromScope";
import { SCOPE_PROMPT_VERSION } from "@/lib/construction/scopePrompt";
import { keepPrintedSections, type ReconciledDraftLine } from "@/lib/construction/scopeDraft";
import { applyScopeFixes } from "@/lib/construction/scopeFixes";
import type { ScopeTable } from "@/lib/construction/scopeTable";
import { bindScope, type InfoItem, type ScopeAccount } from "@/lib/construction/bindScope";
import { scopeOnlyLines } from "@/lib/construction/scopeOnly";
import type { MeasureRow } from "@/lib/construction/cards";
import type { Hint } from "@/lib/construction/model/buildingModel";
import {
  assembleDrawingDraft,
  callOffsFromScope,
  type AssembleLibEl,
  type DrawingDraftLine,
} from "@/lib/construction/assemble";
import type { ConstructionUnit } from "@/lib/construction/types";
import { loadConstructionLibrary } from "@/server/construction";
import { env } from "@/lib/env";

export interface RunProgress {
  total: number;
  done: number;
  failed: number;
  reused: number;
  current: string | null;
}

export interface RunResult {
  buildings: { id: string; name: string; measurements: number; flags: string[]; hints?: Hint[] }[];
  draftLines: DrawingDraftLine[];
  draftFlags: string[];
  /** Scope mode (docs/23 §11): drawing features the scope did not ask for (never priced). */
  info?: InfoItem[];
  /** Sections the client listed with nothing under them ("confirm none required"). */
  emptySections?: string[];
  /** Every scope line accounted for. */
  account?: ScopeAccount | null;
  flags: string[];
  costUsd: number;
  sheetsRead: number;
  sheetsReused: number;
  sheetsFailed: number;
}

/** The scope read saved on `ConstructionQuote.draftRawOutput` — reused while its key matches. */
interface StoredScopeRead {
  kind: "scope-read";
  key: string;
  lines: ReconciledDraftLine[];
  sections: string[];
  notes: string;
  costUsd: number;
  raw: unknown;
}

/** A stored sheet read as saved on `ConstructionSheet.readRawOutput`. */
interface StoredRead {
  read: SheetReadData;
  raw: unknown;
}

const stem = (name: string) => name.replace(/\.[a-z0-9]+$/i, "").trim().toLowerCase();
const dir = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

export async function runConstructionRead(runId: string): Promise<RunResult> {
  const run = await prisma.constructionReadRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error(`Read run ${runId} not found`);
  const quoteId = run.quoteId;
  await prisma.constructionReadRun.update({
    where: { id: runId },
    data: { status: "RUNNING", startedAt: run.startedAt ?? new Date(), error: null },
  });

  try {
    const quote = await prisma.constructionQuote.findUniqueOrThrow({
      where: { id: quoteId },
      include: { attachments: true, buildings: { orderBy: { sortOrder: "asc" } }, sheets: true },
    });
    const params = resolveJobParams(quote.jobParams);
    // Scenario 1 reads the scope only — never the drawings.
    const scopeScenario = quote.mode === "A";
    const atts = new Map(quote.attachments.map((a) => [a.id, a]));

    // --- Files: downloaded once, probed for the page text / slides the readers need.
    const bytes = new Map<string, Promise<Buffer>>();
    const load = (id: string) => {
      if (!bytes.has(id)) bytes.set(id, downloadFromStorage(atts.get(id)!.storagePath));
      return bytes.get(id)!;
    };
    const pdfProbe = new Map<string, Promise<ProbedPdf>>();
    const probe = (id: string) => {
      if (!pdfProbe.has(id)) pdfProbe.set(id, load(id).then((b) => probePdf(b)));
      return pdfProbe.get(id)!;
    };
    const pptxRead = new Map<string, Promise<PptxRead>>();
    const pptx = (id: string) => {
      if (!pptxRead.has(id)) pptxRead.set(id, load(id).then((b) => readPptx(b)));
      return pptxRead.get(id)!;
    };
    const isPptx = (id: string) => {
      const a = atts.get(id)!;
      return fileTypeOf(a.fileName, a.mimeType) === "PPTX";
    };
    /** The .pptx a PDF mark-up was exported from (same folder, same name). */
    const twinPptx = (pdfId: string): string | null => {
      const a = atts.get(pdfId)!;
      const key = `${dir(a.relativePath ?? a.fileName)}/${stem(a.fileName)}`;
      const twin = quote.attachments.find(
        (x) => x.id !== pdfId && fileTypeOf(x.fileName, x.mimeType) === "PPTX" && `${dir(x.relativePath ?? x.fileName)}/${stem(x.fileName)}` === key,
      );
      return twin?.id ?? null;
    };

    // --- What to read: included core sheets, latest revision only (none in Scenario 1).
    const toRead = scopeScenario ? [] : quote.sheets.filter((s) => s.bucket === "CORE" && s.included && !s.superseded);
    const sheets: SheetToRead[] = [];
    for (const s of toRead) {
      const a = atts.get(s.attachmentId)!;
      let rawText = "";
      let extraHints: string | null = null;
      if (isPptx(a.id)) {
        const p = await pptx(a.id);
        const slide = p.slides.find((sl) => sl.index === s.page);
        rawText = slide?.text ?? "";
        if (slide) extraHints = describeMarkupShapes(slide, p.slides);
      } else {
        rawText = (await probe(a.id)).pages.find((p) => p.page === s.page)?.text ?? "";
        if (s.kind === "MARKUP") {
          const twin = twinPptx(a.id);
          if (twin) {
            const p = await pptx(twin);
            const slide = p.slides.find((sl) => sl.index === s.page);
            if (slide) extraHints = describeMarkupShapes(slide, p.slides);
          }
        }
      }
      sheets.push({
        key: s.id,
        fileId: a.id,
        page: s.page,
        kind: s.kind,
        title: `${s.drawingNo ? s.drawingNo + " " : ""}${s.title ?? a.fileName}`,
        level: s.level,
        buildingKey: s.buildingId,
        geometry: (s.geometry as unknown as SheetGeometry | null) ?? null,
        rawText,
        contentHash: a.contentHash,
        extraHints,
      });
    }

    // Proposed ground levels (relative to FFL) from the job's site plans.
    const groundRel: number[] = [];
    for (const s of quote.sheets.filter((x) => x.bucket === "CONTEXT")) {
      const g = s.geometry as unknown as SheetGeometry | null;
      for (const sp of g?.spotLevels ?? []) if (sp.relMm != null) groundRel.push(sp.relMm);
    }

    const progress: RunProgress = { total: sheets.length, done: 0, failed: 0, reused: 0, current: null };
    let spent = 0;
    await prisma.constructionReadRun.update({ where: { id: runId }, data: { progress: progress as unknown as Prisma.InputJsonValue, mode: quote.mode } });
    const bySheet = new Map(quote.sheets.map((s) => [s.id, s]));

    const result: PackReadResult = scopeScenario ? { reads: [], models: [], costUsd: 0, flags: [] } : await readPack({
      sheets,
      buildings: quote.buildings.map((b) => ({ key: b.id, name: b.name })),
      loadFile: async (id) => (isPptx(id) ? ((await pptx(id)).pdf ?? Buffer.alloc(0)) : load(id)),
      params,
      groundRelMm: { "*": groundRel },
      cached: (key, readKey) => {
        const s = bySheet.get(key);
        if (!s || s.readStatus !== "READ" || s.readKey !== readKey || !s.readRawOutput) return null;
        const stored = s.readRawOutput as unknown as StoredRead;
        return stored?.read ? stored : null;
      },
      onSheet: async (rec) => {
        if (rec.error) progress.failed++;
        else progress.done++;
        if (rec.reused) progress.reused++;
        spent += rec.meta?.costUsd ?? 0;
        progress.current = bySheet.get(rec.key)?.title ?? null;
        if (!rec.reused)
          await prisma.constructionSheet.update({
            where: { id: rec.key },
            data: rec.error
              ? { readStatus: "FAILED", readError: rec.error.slice(0, 500), readKind: rec.readKind }
              : {
                  readStatus: "READ",
                  readKind: rec.readKind,
                  readKey: rec.readKey,
                  readError: null,
                  readAt: new Date(),
                  readRawOutput: { read: rec.read, raw: rec.raw } as unknown as Prisma.InputJsonValue,
                  readMeta: { ...rec.meta, tiles: rec.tiles } as unknown as Prisma.InputJsonValue,
                },
          });
        await prisma.constructionReadRun.update({
          where: { id: runId },
          data: { progress: progress as unknown as Prisma.InputJsonValue, costUsd: Math.round(spent * 10000) / 10000 },
        });
      },
      concurrency: 3,
    });

    // --- Scope (mode A) + a Wren-style numbered mark-up → draft lines (docs/23 §11).
    const library = await loadConstructionLibrary();
    const libAssemble: AssembleLibEl[] = library.map((e) => ({
      id: e.id,
      name: e.name,
      aliases: e.aliases,
      unit: e.unit as ConstructionUnit,
      usesLifts: e.usesLifts,
    }));
    let scopeItems: ReconciledDraftLine[] = [];
    let scopeSections: string[] = [];
    let scopeCost = 0;
    const draftFlags: string[] = [];
    // A fixed order, so the scope text — and the cache key of its read — never changes between runs.
    const scopeFiles = quote.attachments
      .filter((a) => a.bucket === "SCOPE" && a.useForDrafting)
      .sort((a, b) => (a.relativePath ?? a.fileName).localeCompare(b.relativePath ?? b.fileName));
    const scopeTexts: string[] = [];
    const tables: (ScopeTable & { attachmentId: string; fileName: string })[] = [];
    if (scopeScenario && scopeFiles.length) {
      for (const a of scopeFiles) {
        const read = await readScopeFile({ name: a.fileName, mimeType: a.mimeType, bytes: await load(a.id) }).catch(() => ({ text: "", tables: [] }));
        if (read.text.trim()) scopeTexts.push(read.text);
        for (const t of read.tables) tables.push({ ...t, attachmentId: a.id, fileName: a.fileName });
      }
    }
    if (scopeTexts.length && env.constructionAI) {
      // The scope read is cached: same text + same reader + same picking list = no second bill.
      const text = scopeTexts.join("\n\n---\n\n");
      const libSig = library.map((e) => `${e.id}:${e.name}:${e.aliases.join(",")}`).join("|");
      const key = createHash("sha256").update(`${SCOPE_PROMPT_VERSION}\n${libSig}\n${text}`).digest("hex");
      const stored = quote.draftRawOutput as unknown as StoredScopeRead | null;
      if (stored?.kind === "scope-read" && stored.key === key) {
        const kept = keepPrintedSections(stored.lines, stored.sections, text);
        scopeItems = applyScopeFixes(kept.lines, library.map((e) => ({ id: e.id, name: e.name, aliases: e.aliases, unit: e.unit })));
        scopeSections = kept.sections;
      } else {
        try {
          const d = await draftFromScope(
            text,
            library.map((e) => ({ id: e.id, name: e.name, aliases: e.aliases, unit: e.unit, usesLifts: e.usesLifts, category: e.category })),
            tables,
          );
          scopeItems = d.lines;
          scopeSections = d.sections;
          scopeCost = d.meta.costUsd;
          const save: StoredScopeRead = { kind: "scope-read", key, lines: d.lines, sections: d.sections, notes: d.notes, costUsd: d.meta.costUsd, raw: d.meta.raw };
          await prisma.constructionQuote.update({ where: { id: quoteId }, data: { draftRawOutput: save as unknown as Prisma.InputJsonValue } });
        } catch (e) {
          draftFlags.push(`The scope could not be read: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } else if (scopeTexts.length) draftFlags.push("AI reading is turned off, so the scope was not mapped to the picking list.");

    const numbered = result.reads.filter((r) => r.read?.kind === "MARKUP_NUMBERS").map((r) => (r.read as Extract<SheetReadData, { kind: "MARKUP_NUMBERS" }>).data);
    const callOffs = callOffsFromScope(
      scopeItems.map((i) => ({ elementId: i.elementId, quantity: i.quantity, lifts: i.lifts, clientText: i.clientText })),
      libAssemble,
    );
    const assembled = numbered.length ? assembleDrawingDraft(numbered, libAssemble, callOffs) : null;
    if (assembled) draftFlags.push(...assembled.flags);
    let draftLines: DrawingDraftLine[] = assembled?.lines ?? [];
    let info: InfoItem[] = [];
    let emptySections: string[] = [];
    let account: ScopeAccount | null = null;
    if (scopeScenario) {
      // Scenario 1: the client's lines with the client's numbers — nothing to cross-check.
      const only = scopeOnlyLines({
        items: scopeItems,
        library: library.map((e) => ({
          id: e.id,
          name: e.name,
          aliases: e.aliases,
          unit: e.unit as ConstructionUnit,
          usesLifts: e.usesLifts,
          usesHeightBracket: e.usesHeightBracket,
          category: e.category,
        })),
        sections: scopeSections,
        emptyTableSections: tables.flatMap((t) => t.sections.filter((x) => x.itemCount === 0).map((x) => x.name)),
      });
      draftLines = only.lines;
      emptySections = only.emptySections;
      draftFlags.push(...only.flags);
    } else if (scopeItems.length || scopeSections.length) {
      // The estimator's own measurements (entered / measured on the drawing) beat the read.
      const manual = await prisma.constructionMeasurement.findMany({ where: { quoteId, runId: null } });
      const manualRows: MeasureRow[] = manual.map((m) => ({
        key: m.key,
        label: m.label,
        valueNumber: Number(m.valueNumber),
        unit: m.unit,
        lifts: m.lifts,
        confidence: m.confidence,
        source: m.source,
        provenance: Array.isArray(m.provenance) ? (m.provenance as string[]) : [],
        note: m.note,
        buildingId: m.buildingId,
        runId: null,
      }));
      const bound = bindScope({
        items: scopeItems,
        buildings: result.models.map((m) => ({ key: m.buildingKey, name: m.name, model: m.model, manual: manualRows.filter((r) => r.buildingId === m.buildingKey) })),
        library: library.map((e) => ({
          id: e.id,
          name: e.name,
          aliases: e.aliases,
          unit: e.unit as ConstructionUnit,
          usesLifts: e.usesLifts,
          usesHeightBracket: e.usesHeightBracket,
          category: e.category,
        })),
        params,
        sections: scopeSections,
        emptyTableSections: tables.flatMap((t) => t.sections.filter((x) => x.itemCount === 0).map((x) => x.name)),
        markupLines: draftLines,
      });
      draftLines = bound.lines;
      info = bound.info;
      emptySections = bound.emptySections;
      account = bound.account;
      draftFlags.push(...bound.flags);
    }

    // --- Measurements: replace the previous AI run's rows (hand-entered ones stay).
    await prisma.constructionMeasurement.deleteMany({ where: { quoteId, runId: { not: null } } });
    const rows: Prisma.ConstructionMeasurementCreateManyInput[] = [];
    let sort = 1000;
    // Which sheets a measurement came from: its provenance names them by title.
    const sheetByTitle = sheets.map((sh) => ({ title: sh.title, ref: { sheetId: sh.key, attachmentId: sh.fileId, page: sh.page, title: sh.title } }));
    const refsFor = (prov: string[]) => {
      const hits = sheetByTitle.filter((x) => prov.some((p) => p.startsWith(x.title) || p.includes(`${x.title}:`)));
      return hits.length ? (hits.map((h) => h.ref) as unknown as Prisma.InputJsonValue) : undefined;
    };
    for (const b of result.models)
      for (const m of b.model.measurements)
        rows.push({
          quoteId,
          buildingId: b.buildingKey,
          key: m.key,
          sheetRefs: refsFor(m.provenance),
          label: m.label,
          kind: m.kind,
          valueNumber: m.valueNumber,
          unit: m.unit,
          lifts: m.lifts,
          heightBracket: m.heightBracket,
          source: "DRAWING",
          confidence: m.confidence,
          provenance: m.provenance as unknown as Prisma.InputJsonValue,
          paramsUsed: m.paramsUsed as unknown as Prisma.InputJsonValue,
          note: m.note,
          runId,
          sortOrder: (sort += 10),
        });
    // The numbered mark-up's own measurements (Wren) join the sheet of the only building.
    const mainBuilding = quote.buildings[0]?.id ?? null;
    const numberedKind: Record<string, string> = { PERIMETER_LM: "markup-ext", BIRDCAGE_M2: "markup-birdcage", HANDRAIL_LM: "markup-edge", HEIGHT_M: "height", AREA_LM: "markup-area" };
    const markupSheets = sheets.filter((sh) => result.reads.some((r) => r.key === sh.key && r.readKind === "MARKUP_NUMBERS"));
    for (const [i, m] of (assembled?.measurements ?? []).entries())
      rows.push({
        quoteId,
        buildingId: mainBuilding,
        // The written-on mark-up's numbers (docs/20): keyed like the engine's, so the sheet groups them.
        key: `${numberedKind[m.kind] ?? "markup"}:numbers:${i}`,
        sheetRefs: markupSheets.length
          ? (markupSheets.map((sh) => ({ sheetId: sh.key, attachmentId: sh.fileId, page: sh.page, title: sh.title })) as unknown as Prisma.InputJsonValue)
          : undefined,
        label: m.label,
        kind: m.kind,
        valueNumber: m.valueNumber,
        lifts: m.lifts,
        source: "DRAWING",
        confidence: m.confidence,
        provenance: (m.note ? [m.note] : []) as unknown as Prisma.InputJsonValue,
        note: m.note,
        runId,
        sortOrder: (sort += 10),
      });
    if (rows.length) await prisma.constructionMeasurement.createMany({ data: rows });

    // Files whose sheets were read (or whose scope was read) count as read on the
    // job's step rail.
    const readFiles = new Set<string>();
    for (const r of result.reads) if (!r.error) readFiles.add(bySheet.get(r.key)?.attachmentId ?? "");
    if (scopeTexts.length) for (const a of scopeFiles) readFiles.add(a.id);
    readFiles.delete("");
    if (readFiles.size)
      await prisma.constructionAttachment.updateMany({ where: { id: { in: [...readFiles] } }, data: { readStatus: "READ" } });

    // --- The job: adopt the drawing height / band only where the estimator set none.
    const maxH = Math.max(0, ...result.models.map((m) => m.model.maxScaffoldHeightM ?? 0));
    const band = result.models.map((m) => m.model.suggestedBracket).find(Boolean) ?? null;
    const qData: Prisma.ConstructionQuoteUpdateInput = {};
    if (quote.buildingHeightM == null && maxH > 0) qData.buildingHeightM = maxH;
    if (quote.defaultHeightBracket == null && band) qData.defaultHeightBracket = band;
    if (scopeTexts.length) qData.enquiryText = scopeTexts.join("\n\n---\n\n").slice(0, 200_000);
    // The client's own schedule layout, for the client-template export (docs/22 §4.10).
    if (tables.length)
      qData.clientTemplate = {
        tables: tables.map((t) => ({
          attachmentId: t.attachmentId,
          fileName: t.fileName,
          sheet: t.sheet,
          sheetIndex: t.sheetIndex,
          title: t.title,
          headerRows: t.headerRows,
          itemCol: t.itemCol,
          columns: t.columns,
          sections: t.sections,
        })),
      } as unknown as Prisma.InputJsonValue;
    if (Object.keys(qData).length) await prisma.constructionQuote.update({ where: { id: quoteId }, data: qData });

    const out: RunResult = {
      buildings: result.models.map((b) => ({
        id: b.buildingKey,
        name: b.name,
        measurements: b.model.measurements.length,
        flags: b.model.flags,
        hints: b.model.hints,
      })),
      draftLines,
      draftFlags,
      info,
      emptySections,
      account,
      flags: result.flags,
      costUsd: Math.round((result.costUsd + scopeCost) * 10000) / 10000,
      sheetsRead: result.reads.filter((r) => !r.reused && !r.error).length,
      sheetsReused: result.reads.filter((r) => r.reused).length,
      sheetsFailed: result.reads.filter((r) => r.error).length,
    };
    progress.current = null;
    await prisma.constructionReadRun.update({
      where: { id: runId },
      data: {
        status: "DONE",
        finishedAt: new Date(),
        costUsd: out.costUsd,
        progress: progress as unknown as Prisma.InputJsonValue,
        result: out as unknown as Prisma.InputJsonValue,
      },
    });
    return out;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.constructionReadRun.update({
      where: { id: runId },
      data: { status: "FAILED", finishedAt: new Date(), error: message.slice(0, 1000) },
    });
    throw e;
  }
}
