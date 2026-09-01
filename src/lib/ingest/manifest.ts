/**
 * The text manifest for the AI structure pass (docs/17 §4.3) — a compact,
 * text-only summary of the pack (folder tree + a sample of files with their
 * title-block text). Pure, no I/O, no images. This is ~90% of the grouping
 * signal at a fraction of the cost of sending page images.
 */

export interface ManifestEntry {
  relativePath: string;
  title?: string | null; // a title-block snippet, if the classifier read one
}

const MAX_FILES = 600; // a manifest cap so very large packs stay a bounded prompt
const MAX_TITLE = 80;

/** Build the text manifest fed to the AI recipe-inference call. */
export function buildManifest(entries: ManifestEntry[]): string {
  const folders = [
    ...new Set(entries.map((e) => e.relativePath.split("/").slice(0, -1).join("/")).filter(Boolean)),
  ].sort();

  const lines: string[] = [];
  lines.push(`PACK: ${entries.length} PDF files across ${folders.length} folders.`);
  lines.push("");
  lines.push("FOLDERS (distinct directory paths):");
  for (const f of folders.slice(0, MAX_FILES)) lines.push(`  ${f || "(root)"}`);
  if (folders.length > MAX_FILES) lines.push(`  …and ${folders.length - MAX_FILES} more folders`);
  lines.push("");
  lines.push("FILES (relative path  «title-block text if read»):");
  for (const e of entries.slice(0, MAX_FILES)) {
    const t = e.title ? `  «${e.title.slice(0, MAX_TITLE)}»` : "";
    lines.push(`  ${e.relativePath}${t}`);
  }
  if (entries.length > MAX_FILES) lines.push(`  …and ${entries.length - MAX_FILES} more files`);
  return lines.join("\n");
}
