import { unzipSync } from "fflate";

export interface ZipPdfEntry {
  /** Entry base filename, e.g. "House.pdf" (folders stripped). */
  name: string;
  bytes: Uint8Array;
}

export interface ZipScanResult {
  pdfs: ZipPdfEntry[];
  /** Entries that were set aside (non-PDF payloads worth telling a human about). */
  skipped: string[];
}

const MAX_DEPTH = 3;

function isJunkEntry(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  return path.startsWith("__MACOSX") || base.startsWith(".") || base.length === 0;
}

/**
 * Collect every PDF inside a ZIP, RECURSING into nested ZIPs (real tender packs
 * arrive as zips-of-zips, e.g. a OneDrive export inside a pack zip). Nested
 * archive names are prefixed onto the entry name for traceability. Non-PDF,
 * non-ZIP payload files are reported in `skipped` so nothing vanishes silently.
 */
export function collectZipPdfEntries(
  zipBytes: Uint8Array,
  depth = 0,
  prefix = "",
): ZipScanResult {
  const pdfs: ZipPdfEntry[] = [];
  const skipped: string[] = [];

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes);
  } catch {
    skipped.push(`${prefix || "(archive)"} — could not be unzipped`);
    return { pdfs, skipped };
  }

  for (const [path, bytes] of Object.entries(entries)) {
    if (isJunkEntry(path) || bytes.length === 0) continue;
    const base = path.split("/").pop()!;
    const lower = base.toLowerCase();

    if (lower.endsWith(".pdf")) {
      pdfs.push({ name: prefix ? `${prefix}/${base}` : base, bytes });
    } else if (lower.endsWith(".zip")) {
      if (depth + 1 >= MAX_DEPTH) {
        skipped.push(`${base} (nested zip too deep — not expanded)`);
        continue;
      }
      const inner = collectZipPdfEntries(
        bytes,
        depth + 1,
        prefix ? `${prefix}/${base}` : base,
      );
      pdfs.push(...inner.pdfs);
      skipped.push(...inner.skipped);
    } else if (!path.endsWith("/")) {
      // A real payload file we can't use (xls, dwg, docx…) — record, don't hide.
      skipped.push(base);
    }
  }

  return { pdfs, skipped };
}
