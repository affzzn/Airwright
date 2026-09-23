/**
 * "Draft from enquiry" (docs/19) — extract TEXT from an uploaded scope-of-works
 * file. Server-only (imports exceljs + pdfjs). We only ever read the TEXT of a
 * scope document — never images, never CAD, never a drawing. The estimator sees
 * the extracted text in an editable box before anything is sent to the model.
 *
 * Supported: .txt / .csv (utf-8), .xlsx / .xls (flattened to a tab table),
 * .pdf (text layer only — a scanned/image-only PDF yields little, by design).
 */

import ExcelJS from "exceljs";

/** Hard cap so a stray huge file can't blow the model context / payload. */
const MAX_TEXT_CHARS = 200_000;

const clamp = (s: string): string =>
  s.length > MAX_TEXT_CHARS ? s.slice(0, MAX_TEXT_CHARS) + "\n…(truncated)" : s;

const extOf = (name: string): string => {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
};

/** utf-8 text (.txt / .csv). */
export function plainToText(bytes: Buffer): string {
  return clamp(bytes.toString("utf8").replace(/\r\n/g, "\n").trim());
}

/** One spreadsheet cell → a plain string (handles ExcelJS rich/formula/hyperlink cells). */
export function cellToText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.text === "string") return v.text.trim();
    if (typeof v.result === "string" || typeof v.result === "number") return String(v.result);
    if (Array.isArray(v.richText)) {
      return (v.richText as { text?: string }[]).map((r) => r.text ?? "").join("").trim();
    }
    if (typeof v.hyperlink === "string") return String(v.text ?? v.hyperlink);
  }
  return "";
}

/** Flatten every worksheet to tab-separated rows (blank rows/cells dropped). */
export async function xlsxToText(bytes: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const blocks: string[] = [];
  wb.eachSheet((sheet) => {
    const rows: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      // row.values is 1-indexed (index 0 is unused); collect non-empty cells.
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      for (const v of values) {
        const text = cellToText(v);
        if (text) cells.push(text);
      }
      if (cells.length) rows.push(cells.join("\t"));
    });
    if (rows.length) {
      const title = sheet.name ? `# ${sheet.name}` : "";
      blocks.push([title, ...rows].filter(Boolean).join("\n"));
    }
  });
  return clamp(blocks.join("\n\n").trim());
}

/** PDF text layer only (server-side). Empty for a scanned/image-only PDF.
 *  pdfjs is imported lazily so the non-PDF paths (and unit tests) never load it. */
export async function pdfToText(bytes: Buffer): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(bytes);
  const doc = await getDocument({ data, isEvalSupported: false }).promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      try {
        const content = await page.getTextContent();
        const text = content.items
          .map((it) => ("str" in it ? it.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (text) pages.push(text);
      } finally {
        page.cleanup();
      }
    }
    return clamp(pages.join("\n\n").trim());
  } finally {
    await doc.destroy();
  }
}

/** Decode quoted-printable, reassembling multi-byte UTF-8 (=C3=97 → "×"). */
function decodeQP(s: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "=") {
      if (s[i + 1] === "\n") { i += 1; continue; } // soft line break
      const hex = s.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) { bytes.push(parseInt(hex, 16)); i += 2; continue; }
    }
    const code = c.charCodeAt(0);
    if (code < 128) bytes.push(code);
    else for (const b of Buffer.from(c, "utf8")) bytes.push(b);
  }
  return Buffer.from(bytes).toString("utf8");
}

const stripHtml = (s: string): string =>
  s
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');

/** Pull one MIME part's body (text/plain preferred) out of a raw .eml. */
function mimePart(raw: string, type: "plain" | "html"): string | null {
  const m = new RegExp(`content-type:\\s*text/${type}`, "i").exec(raw);
  if (!m) return null;
  const afterHdr = raw.indexOf("\n\n", m.index);
  if (afterHdr < 0) return null;
  let body = raw.slice(afterHdr + 2);
  const b = body.search(/\n--[^\n]+\n/); // next MIME boundary
  if (b >= 0) body = body.slice(0, b);
  return body;
}

/** Extract the readable text of an email (.eml) — the client's written scope. */
export function emlToText(bytes: Buffer): string {
  const raw = bytes.toString("utf8").replace(/\r\n/g, "\n");
  const plain = mimePart(raw, "plain");
  let body: string;
  if (plain) body = decodeQP(plain);
  else {
    const html = mimePart(raw, "html");
    body = html ? stripHtml(decodeQP(html)) : stripHtml(decodeQP(raw));
  }
  // Drop long base64-ish lines (inline attachments) + collapse whitespace.
  body = body
    .split("\n")
    .filter((l) => !/^[A-Za-z0-9+/=]{120,}$/.test(l.trim()))
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return clamp(body);
}

export interface ScopeFile {
  name: string;
  mimeType: string;
  bytes: Buffer;
}

/**
 * Dispatch by file type. Throws a friendly error for an unsupported type; the
 * server action turns that into a message the estimator sees.
 */
export async function extractScopeText(file: ScopeFile): Promise<string> {
  const ext = extOf(file.name);
  const mime = (file.mimeType || "").toLowerCase();

  if (ext === "txt" || ext === "csv" || mime.startsWith("text/") || mime === "text/csv") {
    return plainToText(file.bytes);
  }
  if (
    ext === "xlsx" ||
    ext === "xls" ||
    mime.includes("spreadsheetml") ||
    mime === "application/vnd.ms-excel"
  ) {
    return xlsxToText(file.bytes);
  }
  if (ext === "eml" || mime === "message/rfc822") {
    return emlToText(file.bytes);
  }
  if (ext === "pdf" || mime === "application/pdf") {
    return pdfToText(file.bytes);
  }
  throw new Error(
    `Unsupported file type "${ext || file.mimeType || "unknown"}". Upload a .xlsx, .csv, .pdf or .txt scope, or paste the text.`,
  );
}
