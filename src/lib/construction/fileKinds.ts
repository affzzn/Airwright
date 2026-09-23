/**
 * Construction enquiry reading (docs/20 §9) — PURE file-type classification, shared
 * by the client (which files show the "AI" badge) and the server (how each ticked
 * file is read). A PDF is a DRAWING (vision reader); an email / spreadsheet / text
 * file is SCOPE (text reader). The internal answer files are never eligible.
 */

const ext = (name: string): string => {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
};

/** A drawing PDF → the vision reader. */
export function isDrawingFile(mimeType: string, fileName: string): boolean {
  return (mimeType || "").toLowerCase() === "application/pdf" || ext(fileName) === "pdf";
}

/** An email / spreadsheet / text scope document → the text scope reader. */
export function isScopeTextFile(mimeType: string, fileName: string): boolean {
  const m = (mimeType || "").toLowerCase();
  const e = ext(fileName);
  return (
    m === "message/rfc822" || e === "eml" ||
    m.startsWith("text/") || e === "txt" || e === "csv" ||
    m.includes("spreadsheetml") || m === "application/vnd.ms-excel" || e === "xlsx" || e === "xls"
  );
}

/** Any file the AI can read as part of an enquiry (drawing or scope). */
export function isDraftableFile(mimeType: string, fileName: string): boolean {
  return isDrawingFile(mimeType, fileName) || isScopeTextFile(mimeType, fileName);
}

/**
 * Our OWN priced quote, re-uploaded (e.g. `Quote-1375-1-1.pdf`). Reading our own
 * output back would just echo our prices, so these default to not being read.
 *
 * A client's **scaffolding schedule** is NOT one of these: a schedule listing the
 * items and quantities the client wants, with no prices, is the "scope of works
 * (Excel)" enquiry shape (docs/19 §1.2) and is exactly what we want to read.
 * (User-confirmed 2026-09-24: the Wren Park schedule came FROM Stepnell.)
 */
export function looksLikeOurOwnQuote(name: string): boolean {
  return /^\s*quote[-_ ]?\d/i.test(name);
}
