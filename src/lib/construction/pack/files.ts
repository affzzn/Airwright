/**
 * Construction pack ingest (docs/23 §5.3) — PURE file typing and the junk rules.
 * No I/O: the worker and the offline runner both call these, so a pack is sorted
 * the same way wherever it is read.
 */

export type PackFileType =
  | "PDF"
  | "IMAGE"
  | "EMAIL"
  | "SPREADSHEET"
  | "TEXT"
  | "PPTX"
  | "DOCUMENT"
  | "ZIP"
  | "OTHER";

const ext = (name: string): string => {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
};

export function fileTypeOf(name: string, mimeType?: string | null): PackFileType {
  const e = ext(name);
  const m = (mimeType ?? "").toLowerCase();
  if (e === "pdf" || m === "application/pdf") return "PDF";
  if (e === "zip" || m === "application/zip" || m === "application/x-zip-compressed") return "ZIP";
  if (e === "pptx" || m.includes("presentationml")) return "PPTX";
  if (e === "eml" || e === "msg" || m === "message/rfc822") return "EMAIL";
  if (["xlsx", "xlsm", "xls", "csv"].includes(e) || m.includes("spreadsheetml") || m === "application/vnd.ms-excel")
    return "SPREADSHEET";
  if (["png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff", "webp", "heic"].includes(e) || m.startsWith("image/"))
    return "IMAGE";
  if (e === "txt" || m === "text/plain") return "TEXT";
  if (["docx", "doc", "rtf"].includes(e)) return "DOCUMENT";
  return "OTHER";
}

/** A best-effort mime type for a file unpacked from a zip (the browser gave none). */
export function mimeTypeFor(name: string): string {
  switch (ext(name)) {
    case "pdf":
      return "application/pdf";
    case "zip":
      return "application/zip";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "xlsx":
    case "xlsm":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "xls":
      return "application/vnd.ms-excel";
    case "csv":
      return "text/csv";
    case "eml":
      return "message/rfc822";
    case "txt":
      return "text/plain";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "bmp":
      return "image/bmp";
    case "gif":
      return "image/gif";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "application/octet-stream";
  }
}

export const baseName = (relativePath: string): string => relativePath.split("/").pop() ?? relativePath;

export const dirName = (relativePath: string): string => {
  const i = relativePath.lastIndexOf("/");
  return i < 0 ? "" : relativePath.slice(0, i);
};

/**
 * Why a file is junk, or null. Software backups and OS files are never read and
 * never shown by default (KE: nine `.pdf.~qsbak` QS-software backups).
 */
export function junkReason(relativePath: string): string | null {
  const name = baseName(relativePath);
  const lower = name.toLowerCase();
  if (lower === ".ds_store" || lower === "thumbs.db" || lower === "desktop.ini") return "System file";
  if (relativePath.split("/").some((seg) => seg === "__MACOSX")) return "System file";
  if (lower.startsWith("._")) return "System file";
  if (/\.~[a-z0-9]+$/i.test(lower) || /\.(bak|tmp|temp)$/i.test(lower)) return "Software backup copy";
  if (lower.startsWith("~$") || lower.startsWith(".~lock")) return "Temporary lock file";
  return null;
}

/**
 * Our OWN priced quote, re-uploaded (e.g. `Quote-1350-1-2.pdf`). Never sent to a
 * model — reading it would just echo our prices back (docs/23 §5.7).
 */
export function looksLikeOurOwnQuote(name: string): boolean {
  return /^\s*quote[-_ ]?\d/i.test(baseName(name));
}

/**
 * The three upload boxes (2026-10-02). The box a file went into IS its label —
 * nothing is guessed from its name or content. Stored on
 * `ConstructionAttachment.kind`; a file unpacked from a zip takes the zip's box.
 */
export type EnquiryBox = "SCOPE" | "DRAWINGS" | "EMAIL";

export const ENQUIRY_BOXES: EnquiryBox[] = ["SCOPE", "DRAWINGS", "EMAIL"];

/**
 * The box a file belongs to. A file uploaded before the boxes existed (no box,
 * or an old kind label) gets one from its type — a fixed rule, not a guess:
 * an email → Email, a spreadsheet / text / Word file → Scope, everything else → Drawings.
 */
export function boxOf(kind: string | null | undefined, relativePath: string, mimeType?: string | null): EnquiryBox {
  if (kind === "SCOPE" || kind === "DRAWINGS" || kind === "EMAIL") return kind;
  if (kind === "DRAWING" || kind === "SITE_PLAN" || kind === "ROOF_PLAN" || kind === "LOGISTICS_PLAN" || kind === "PHOTO") return "DRAWINGS";
  const type = fileTypeOf(relativePath, mimeType);
  if (type === "EMAIL") return "EMAIL";
  if (type === "SPREADSHEET" || type === "TEXT" || type === "DOCUMENT") return "SCOPE";
  return "DRAWINGS";
}

/**
 * The job's scenario, from the boxes alone:
 *   A (Scenario 1) — a scope was uploaded: price the client's lines as given;
 *   B (Scenario 2) — drawings but no scope: read the sure things off the drawings;
 *   C (Scenario 3) — anything else: nothing is read, the estimator fills the cards.
 * OS clutter does not count as a file.
 */
export function scenarioFromBoxes(files: { box: EnquiryBox; relativePath: string }[]): "A" | "B" | "C" {
  const real = files.filter((f) => junkReason(f.relativePath) == null);
  if (real.some((f) => f.box === "SCOPE")) return "A";
  if (real.some((f) => f.box === "DRAWINGS")) return "B";
  return "C";
}

export const SCENARIO_COPY: Record<"A" | "B" | "C", { number: 1 | 2 | 3; title: string; body: string }> = {
  A: {
    number: 1,
    title: "Scenario 1 · Scope",
    body: "The client's scope is priced exactly as written (plus any extra lines in the email). The drawings are not read — they are here to look at.",
  },
  B: {
    number: 2,
    title: "Scenario 2 · Drawings",
    body: "No scope: the drawings are read for the sure things only (heights, a confirmed rectangle, gables). You finish the cards and tick the add-ons. The email is for reference.",
  },
  C: {
    number: 3,
    title: "Scenario 3 · By hand",
    body: "No scope and no drawings: nothing is read. Fill in the cards yourself — the measuring tool works on a photo or plan once you set its scale.",
  },
};
