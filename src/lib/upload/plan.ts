/**
 * Pure helpers for the upload path (shared by the client uploader and the server
 * actions so they can't disagree on what's uploadable). No I/O.
 */

/** A file we accept into a tender pack: a PDF or a ZIP. */
export function isUploadableName(name: string): boolean {
  return /\.(pdf|zip)$/i.test(name);
}

export function isArchiveName(name: string): boolean {
  return /\.zip$/i.test(name);
}

/**
 * Normalise a browser-supplied relative path (from `webkitRelativePath` or a
 * dropped directory entry's `fullPath`) to a clean POSIX path with no leading
 * slash and no `./` — the grouping signal stored on each file.
 */
export function normalizeRelativePath(raw: string, fallbackName: string): string {
  const cleaned = (raw || fallbackName)
    .replace(/\\/g, "/") // Windows separators
    .replace(/^\.?\//, "") // leading ./ or /
    .replace(/\/{2,}/g, "/") // collapse //
    .trim();
  return cleaned || fallbackName;
}
