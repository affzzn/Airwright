/**
 * Construction pack ingest (docs/23 §5) — the drawing REGISTER. PURE: given every
 * file of an enquiry (already probed: its type, content hash and, for PDFs, each
 * page's size + text layer), decide
 *   - what each FILE is (read, context, scope, reference, junk, duplicate);
 *   - what each PAGE is (kind, level, face, bucket) and which are superseded;
 *   - which BUILDING each sheet belongs to (CBAND has two);
 *   - the job's SCENARIO, from the upload boxes alone (A scope · B drawings · C by hand).
 * Every file carries the box it was uploaded into (Scope / Drawings / Email) — that
 * box decides how it is treated; nothing is guessed from a file's name.
 * The worker and the offline runner both call this, so a pack sorts identically.
 */

import { baseName, boxOf, dirName, fileTypeOf, junkReason, looksLikeOurOwnQuote, scenarioFromBoxes, type EnquiryBox, type PackFileType } from "./files";
import { identifySheet, kindFromText, paperFromSize, type SheetIdentity, type SheetKind } from "./titleBlock";

export type FileBucket =
  | "CORE"
  | "CONTEXT"
  | "SCOPE"
  | "REGISTER"
  | "REFERENCE"
  | "NOT_RELEVANT"
  | "JUNK"
  | "DUPLICATE"
  | "ARCHIVE";

export type SheetBucket = "CORE" | "CONTEXT" | "REGISTER" | "SCOPE" | "NOT_RELEVANT";

export type JobMode = "A" | "B" | "C";

export interface PageProbe {
  page: number; // 1-based
  widthPt: number;
  heightPt: number;
  hasText: boolean;
  imageCount: number;
  /** The page's text layer, joined (for identity + keyword checks). */
  text: string;
}

export interface RegisterFileInput {
  id: string;
  relativePath: string;
  mimeType?: string | null;
  /** The upload box (the attachment's `kind`); missing on files from before the boxes. */
  box?: string | null;
  sizeBytes?: number | null;
  contentHash?: string | null;
  /** Characters of readable text, for scope-type files (email, spreadsheet, text). */
  textLength?: number | null;
  /** PDFs only. */
  pages?: PageProbe[];
  /** .pptx only: the slide text, joined, and the slides (one register sheet each when read). */
  slideText?: string | null;
  slides?: { index: number; text: string; widthPt: number; heightPt: number }[];
}

export interface RegisterFile {
  id: string;
  relativePath: string;
  type: PackFileType;
  box: EnquiryBox;
  bucket: FileBucket;
  reason: string;
  duplicateOfId?: string;
  /** For a .pptx mark-up: the PDF export of the same slides, which is read instead. */
  readViaFileId?: string;
  kind?: SheetKind;
  buildingKey: string | null;
}

export interface RegisterSheet {
  fileId: string;
  page: number;
  identity: SheetIdentity;
  paper: string;
  widthPt: number;
  heightPt: number;
  hasText: boolean;
  /** No text layer and at least one image: a scan / Print-to-PDF picture. */
  raster: boolean;
  bucket: SheetBucket;
  reason: string;
  superseded: boolean;
  /** True when the title said nothing we recognise — the AI triage may rescue it. */
  needsTriage: boolean;
  buildingKey: string | null;
}

export interface RegisterBuilding {
  key: string;
  name: string;
  code: string | null;
}

export interface RegisterResult {
  files: RegisterFile[];
  sheets: RegisterSheet[];
  buildings: RegisterBuilding[];
  mode: JobMode;
  modeReason: string;
  counts: Record<FileBucket, number>;
}

const SHEET_BUCKET: Record<SheetKind, SheetBucket> = {
  PLAN: "CORE",
  ROOF_PLAN: "CORE",
  ELEVATION: "CORE",
  SECTION: "CORE",
  MARKUP: "CORE",
  SITE_PLAN: "CONTEXT",
  LOGISTICS_PLAN: "CONTEXT",
  SURVEY: "CONTEXT",
  REGISTER: "REGISTER",
  SCOPE: "SCOPE",
  SCHEDULE: "NOT_RELEVANT",
  DETAIL: "NOT_RELEVANT",
  FINISHES: "NOT_RELEVANT",
  FURNITURE: "NOT_RELEVANT",
  SPEC: "NOT_RELEVANT",
  OTHER: "NOT_RELEVANT",
};

const KIND_LABEL: Record<SheetKind, string> = {
  PLAN: "Floor plan",
  ROOF_PLAN: "Roof plan",
  ELEVATION: "Elevation",
  SECTION: "Section",
  MARKUP: "Scaffold mark-up",
  SITE_PLAN: "Site plan",
  LOGISTICS_PLAN: "Compound / logistics plan",
  SURVEY: "Existing site / survey",
  REGISTER: "Drawing register",
  SCOPE: "Scope of works",
  SCHEDULE: "Door / window schedule",
  DETAIL: "Construction detail",
  FINISHES: "Finishes / ceiling layout",
  FURNITURE: "Furniture layout",
  SPEC: "Specification",
  OTHER: "Unrecognised sheet",
};

export function kindLabel(kind: SheetKind): string {
  return KIND_LABEL[kind];
}

function sheetReason(kind: SheetKind, bucket: SheetBucket): string {
  switch (bucket) {
    case "CORE":
      return `${KIND_LABEL[kind]} — read for measurements`;
    case "CONTEXT":
      return `${KIND_LABEL[kind]} — read for site context (text only)`;
    case "REGISTER":
      return "Drawing register — used to check revisions";
    case "SCOPE":
      return "Scope of works — read for what is asked";
    default:
      return kind === "OTHER"
        ? "Title not recognised — not read unless you switch it on"
        : `${KIND_LABEL[kind]} — not needed for scaffold`;
  }
}

const wordCount = (text: string): number => (text ? text.split(" | ").filter((t) => t.trim()).length : 0);

/** A multi-page A4 document (spec, report) is represented by its first page. */
function pagesToRegister(pages: PageProbe[]): PageProbe[] {
  if (pages.length <= 3) return pages;
  const big = pages.filter((p) => paperFromSize(p.widthPt, p.heightPt) !== "A4" && paperFromSize(p.widthPt, p.heightPt) !== "A5");
  return big.length > 0 ? big : pages.slice(0, 1);
}

const RANK: Record<FileBucket, number> = {
  CORE: 0,
  SCOPE: 1,
  CONTEXT: 2,
  REGISTER: 3,
  REFERENCE: 4,
  NOT_RELEVANT: 5,
  DUPLICATE: 6,
  JUNK: 7,
  ARCHIVE: 8,
};

export function buildRegister(inputs: RegisterFileInput[]): RegisterResult {
  // Stable order: Scope, then Email, then Drawings, each by path — so "first" is
  // deterministic for duplicates, and a scope also dropped inside the drawings
  // folder keeps its Scope-box copy.
  const BOX_RANK: Record<EnquiryBox, number> = { SCOPE: 0, EMAIL: 1, DRAWINGS: 2 };
  const rankOf = (f: RegisterFileInput) => BOX_RANK[boxOf(f.box, f.relativePath, f.mimeType)];
  const sorted = [...inputs].sort((a, b) => rankOf(a) - rankOf(b) || a.relativePath.localeCompare(b.relativePath));

  const files: RegisterFile[] = [];
  const sheets: RegisterSheet[] = [];
  const byHash = new Map<string, string>();

  // Directories that hold drawing PDFs (a loose image there is a CAD asset).
  const pdfDirs = new Set(
    sorted.filter((f) => fileTypeOf(f.relativePath, f.mimeType) === "PDF" && !junkReason(f.relativePath)).map((f) => dirName(f.relativePath)),
  );
  // PDF stems by folder, so a .pptx mark-up with its own PDF export is read once.
  const pdfByStem = new Map<string, string>();
  for (const f of sorted)
    if (fileTypeOf(f.relativePath, f.mimeType) === "PDF")
      pdfByStem.set(`${dirName(f.relativePath)}/${baseName(f.relativePath).replace(/\.[a-z0-9]+$/i, "").trim().toLowerCase()}`, f.id);

  // The scenario comes from the boxes, before anything is sorted: it decides
  // whether the email is read (Scenario 1) or only shown.
  const boxes = new Map(sorted.map((f) => [f.id, boxOf(f.box, f.relativePath, f.mimeType)]));
  const mode = scenarioFromBoxes(sorted.map((f) => ({ box: boxes.get(f.id)!, relativePath: f.relativePath })));

  for (const f of sorted) {
    const type = fileTypeOf(f.relativePath, f.mimeType);
    const name = baseName(f.relativePath);
    const box = boxes.get(f.id)!;
    const push = (bucket: FileBucket, reason: string, extra: Partial<RegisterFile> = {}) =>
      files.push({ id: f.id, relativePath: f.relativePath, type, box, bucket, reason, buildingKey: null, ...extra });

    const junk = junkReason(f.relativePath);
    if (junk) {
      push("JUNK", junk);
      continue;
    }
    if (f.contentHash) {
      const first = byHash.get(f.contentHash);
      if (first) {
        const firstPath = sorted.find((x) => x.id === first)?.relativePath ?? first;
        push("DUPLICATE", `Identical to ${baseName(firstPath)}`, { duplicateOfId: first });
        continue;
      }
      byHash.set(f.contentHash, f.id);
    }

    if (type === "ZIP") {
      push("ARCHIVE", "Archive — its contents are unpacked and sorted");
      continue;
    }
    if (looksLikeOurOwnQuote(name)) {
      push("REFERENCE", "Our own quote — shown for reference, never read by the AI");
      continue;
    }
    // --- The Scope and Email boxes: read as text, never as drawings.
    if (box === "SCOPE" || box === "EMAIL") {
      const what = box === "EMAIL" ? "Enquiry email" : "Scope";
      if (type === "IMAGE" || type === "PPTX" || type === "OTHER") push("REFERENCE", `${what} box — no readable text, shown for reference`);
      else if (f.textLength === 0) push("REFERENCE", `${what} box — no readable text`);
      else if (box === "SCOPE") push("SCOPE", "Scope — read for what the client asks");
      else if (mode === "A") push("SCOPE", "Enquiry email — read for any extra lines");
      else push("REFERENCE", "Enquiry email — for reference");
      continue;
    }

    // --- The Drawings box: drawings are tidied and registered; anything else is shown only.
    if (type === "IMAGE") {
      if (pdfDirs.has(dirName(f.relativePath)) && dirName(f.relativePath) !== "")
        push("JUNK", "Loose image beside the drawings (a CAD image asset)");
      else push("REFERENCE", "Photo — shown for reference");
      continue;
    }
    if (type === "EMAIL" || type === "SPREADSHEET" || type === "TEXT" || type === "DOCUMENT") {
      push("REFERENCE", "In the Drawings box — shown for reference, not read");
      continue;
    }
    if (type === "PPTX") {
      const kind = kindFromText(`${name} ${f.slideText ?? ""}`);
      const stemKey = `${dirName(f.relativePath)}/${name.replace(/\.[a-z0-9]+$/i, "").trim().toLowerCase()}`;
      const pdfTwin = pdfByStem.get(stemKey);
      const isMarkup = kind === "MARKUP" || /scaffold/i.test(`${name} ${f.slideText ?? ""}`);
      if (isMarkup && pdfTwin)
        push("REFERENCE", "Slides of a mark-up — its PDF export is read instead", { readViaFileId: pdfTwin, kind: "MARKUP" });
      else if (isMarkup) {
        push("CORE", "Scaffold mark-up slides — read for where scaffold goes", { kind: "MARKUP" });
        // Each slide is a sheet the mark-up reader looks at (rendered from the slide).
        for (const sl of f.slides ?? []) {
          sheets.push({
            fileId: f.id,
            page: sl.index,
            identity: {
              drawingNo: null,
              title: `${name.replace(/\.[a-z0-9]+$/i, "").trim()} — slide ${sl.index}`,
              revision: null,
              revisionOrder: null,
              status: null,
              scale: null,
              kind: "MARKUP",
              kindSource: "title",
              level: null,
              face: null,
              buildingCode: null,
            },
            paper: paperFromSize(sl.widthPt, sl.heightPt),
            widthPt: sl.widthPt,
            heightPt: sl.heightPt,
            hasText: false,
            raster: true,
            bucket: "CORE",
            reason: `Scaffold mark-up slide — read for where scaffold goes${sl.text ? ` (“${sl.text.split("\n")[0].slice(0, 60)}”)` : ""}`,
            superseded: false,
            needsTriage: false,
            buildingKey: null,
          });
        }
      }
      else push("REFERENCE", "Slides — shown for reference");
      continue;
    }
    if (type !== "PDF") {
      push("REFERENCE", "Unsupported file type — shown for reference");
      continue;
    }

    // --- A PDF: register its pages -------------------------------------------------
    const pages = f.pages ?? [];
    if (pages.length === 0) {
      push("REFERENCE", "Could not be opened as a PDF");
      continue;
    }
    const folders = dirName(f.relativePath).split("/").filter(Boolean);
    let best: FileBucket = "NOT_RELEVANT";
    let fileKind: SheetKind | undefined;
    for (const p of pagesToRegister(pages)) {
      const identity = identifySheet({ fileName: name, folders, pageText: p.text });
      const bucket = SHEET_BUCKET[identity.kind];
      // A picture of a drawing: images and at most a caption or two of text
      // (CBAND's mark-up exports carry one line, "Internal & external scaffold").
      const raster = p.imageCount > 0 && wordCount(p.text) < 20;
      sheets.push({
        fileId: f.id,
        page: p.page,
        identity,
        paper: paperFromSize(p.widthPt, p.heightPt),
        widthPt: p.widthPt,
        heightPt: p.heightPt,
        hasText: p.hasText,
        raster,
        bucket,
        reason: sheetReason(identity.kind, bucket) + (raster && bucket === "CORE" ? " (a picture of the drawing, no measurable text)" : ""),
        superseded: false,
        needsTriage: identity.kind === "OTHER",
        buildingKey: null,
      });
      if (RANK[bucket as FileBucket] < RANK[best]) {
        best = bucket as FileBucket;
        fileKind = identity.kind;
      }
      fileKind ??= identity.kind;
    }
    const pageNote = pages.length > 3 && pagesToRegister(pages).length < pages.length ? ` (${pages.length}-page document)` : "";
    // A drawing that looks like a scope is still a drawing: the box decides.
    if (best === "SCOPE") push("REFERENCE", "Looks like a scope, but it is in the Drawings box — shown, not read" + pageNote, { kind: fileKind });
    else push(best, sheetReason(fileKind ?? "OTHER", best as SheetBucket) + pageNote, { kind: fileKind });
  }

  markSuperseded(sheets);
  // Scenario 1 never reads the drawings, so they are not split into buildings:
  // the whole job is one list of the client's lines.
  if (mode === "A") for (const s of sheets) if (s.bucket === "CORE" || s.bucket === "CONTEXT") s.reason = `${kindLabel(s.identity.kind)} — to look at (Scenario 1 does not read drawings)`;
  const buildings = mode === "A" ? [] : assignBuildings(sheets, files);
  const modeReason = modeReasonFor(mode, files);

  const counts = Object.fromEntries(Object.keys(RANK).map((k) => [k, 0])) as Record<FileBucket, number>;
  for (const f of files) counts[f.bucket]++;

  return { files, sheets, buildings, mode, modeReason, counts };
}

/** Latest revision of each drawing wins; older ones stay listed but are not read. */
function markSuperseded(sheets: RegisterSheet[]): void {
  const groups = new Map<string, RegisterSheet[]>();
  for (const s of sheets) {
    const key = s.identity.drawingNo
      ? `no:${s.identity.drawingNo.toUpperCase()}|${s.page}`
      : `title:${s.identity.title.toUpperCase().replace(/\s+/g, " ")}|${s.page}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => (b.identity.revisionOrder ?? -1) - (a.identity.revisionOrder ?? -1));
    const top = ordered[0].identity.revisionOrder;
    // Only supersede when revisions actually differ (identical names are separate files).
    for (const s of ordered.slice(1))
      if (top != null && (s.identity.revisionOrder ?? -1) < top) {
        s.superseded = true;
        s.reason = `Superseded by revision ${ordered[0].identity.revision}`;
      }
  }
}

const hasPlanAndElevation = (ss: RegisterSheet[]) =>
  ss.some((s) => s.identity.kind === "PLAN" || s.identity.kind === "ROOF_PLAN") && ss.some((s) => s.identity.kind === "ELEVATION");

/**
 * Split a job into buildings (docs/23 §5.5). A building has its OWN plans AND
 * elevations, so a folder of just floor plans (KE "1100 Proposed Floor Plans")
 * is a drawing-type folder, not a building. Signals: a building code in the
 * drawing number, then folders at any depth. Otherwise one building.
 */
function assignBuildings(sheets: RegisterSheet[], files: RegisterFile[]): RegisterBuilding[] {
  const core = sheets.filter((s) => s.bucket === "CORE" && !s.superseded);
  const pathOf = new Map(files.map((f) => [f.id, f.relativePath]));
  const folderAt = (s: RegisterSheet, depth: number): string | null => {
    const segs = dirName(pathOf.get(s.fileId) ?? "").split("/").filter(Boolean);
    return depth < segs.length ? segs[depth] : null;
  };

  let groups: Map<string, RegisterSheet[]> | null = null;
  let codeBased = false;

  // 1. Building codes.
  const byCode = new Map<string, RegisterSheet[]>();
  for (const s of core) if (s.identity.buildingCode) byCode.set(s.identity.buildingCode, [...(byCode.get(s.identity.buildingCode) ?? []), s]);
  if (byCode.size >= 2 && [...byCode.values()].every(hasPlanAndElevation)) {
    groups = byCode;
    codeBased = true;
  }

  // 2. Folders, shallowest depth that splits the core sheets into ≥ 2 buildings.
  if (!groups) {
    for (let depth = 0; depth < 4 && !groups; depth++) {
      const byFolder = new Map<string, RegisterSheet[]>();
      for (const s of core) {
        const f = folderAt(s, depth);
        if (f) byFolder.set(f, [...(byFolder.get(f) ?? []), s]);
      }
      const buildingLike = [...byFolder.entries()].filter(([, ss]) => hasPlanAndElevation(ss));
      if (buildingLike.length >= 2) groups = new Map(buildingLike);
    }
  }

  if (!groups) {
    const only: RegisterBuilding = { key: "main", name: "Main building", code: null };
    for (const s of sheets) if (s.bucket === "CORE" || s.bucket === "CONTEXT") s.buildingKey = "main";
    for (const f of files) if (f.bucket === "CORE" || f.bucket === "CONTEXT") f.buildingKey = "main";
    return core.length > 0 ? [only] : [];
  }

  const buildings: RegisterBuilding[] = [];
  const folderOf = (s: RegisterSheet): string => dirName(pathOf.get(s.fileId) ?? "");
  for (const [key, ss] of groups) {
    // Name: the folder the building's sheets share, else the code itself.
    let name = key;
    if (codeBased) {
      const folders = new Map<string, number>();
      for (const s of ss) {
        const leaf = folderOf(s).split("/").filter(Boolean).pop();
        if (leaf) folders.set(leaf, (folders.get(leaf) ?? 0) + 1);
      }
      const top = [...folders.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top) name = top[0];
    }
    buildings.push({ key, name: tidyName(name), code: codeBased ? key : null });
  }
  buildings.sort((a, b) => a.name.localeCompare(b.name));

  // Every sheet/file joins the building whose key or folder it carries.
  const matchKey = (s: RegisterSheet): string | null => {
    if (codeBased && s.identity.buildingCode && groups!.has(s.identity.buildingCode)) return s.identity.buildingCode;
    const path = pathOf.get(s.fileId) ?? "";
    for (const b of buildings) {
      const segs = path.split("/");
      if (segs.slice(0, -1).includes(b.key) || (codeBased && segs.slice(0, -1).some((seg) => tidyName(seg) === b.name))) return b.key;
    }
    return null;
  };
  for (const s of sheets) if (s.bucket === "CORE" || s.bucket === "CONTEXT") s.buildingKey = matchKey(s);
  for (const f of files) {
    if (f.bucket !== "CORE" && f.bucket !== "CONTEXT" && f.bucket !== "REFERENCE") continue;
    const segs = f.relativePath.split("/").slice(0, -1);
    const b = buildings.find((b) => segs.includes(b.key) || segs.some((seg) => tidyName(seg) === b.name));
    f.buildingKey = b?.key ?? null;
  }
  return buildings;
}

const tidyName = (s: string): string =>
  s
    .replace(/^\d+[.)_\s-]+/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Why the job is in its scenario — always the boxes (docs/22 "As built 2026-10-02 b"). */
function modeReasonFor(mode: JobMode, files: RegisterFile[]): string {
  const names = (box: EnquiryBox) => [...new Set(files.filter((f) => f.box === box && f.bucket !== "JUNK").map((f) => baseName(f.relativePath)))];
  if (mode === "A") return `A scope was uploaded: ${names("SCOPE").join(", ")}`;
  if (mode === "B") return "Drawings were uploaded, and no scope";
  return "No scope and no drawings were uploaded";
}
