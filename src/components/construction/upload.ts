"use client";

import {
  createSignedConstructionUploads,
  registerConstructionAttachments,
} from "@/server/actions/construction";

/**
 * Browser-side upload for construction enquiry files: mint a signed URL per file
 * (server), PUT the bytes straight to Supabase Storage, then register the rows.
 * Shared by the new-job form and the enquiry step so both behave identically.
 */
export async function uploadConstructionFiles(
  quoteId: string,
  files: File[],
): Promise<void> {
  if (files.length === 0) return;
  const { targets } = await createSignedConstructionUploads(
    quoteId,
    files.map((f) => ({ name: f.name, type: f.type, size: f.size })),
  );
  const done: { path: string; name: string; type: string; size: number }[] = [];
  for (const t of targets) {
    const file = files[t.index];
    const res = await fetch(t.signedUrl, {
      method: "PUT",
      body: file,
      headers: { "content-type": file.type || "application/octet-stream" },
    });
    if (!res.ok) throw new Error(`Upload failed for ${t.name}`);
    done.push({ path: t.path, name: t.name, type: t.type, size: t.size });
  }
  await registerConstructionAttachments(quoteId, done);
}

/** Collect every file from a drop, recursing into any dropped folders. */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items ?? []);
  const entries = items
    .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
    .filter(Boolean) as FileSystemEntry[];
  if (entries.length === 0) return Array.from(dt.files ?? []);
  const out: File[] = [];
  await Promise.all(entries.map((e) => walkEntry(e, out)));
  return out;
}

function walkEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  return new Promise((resolve) => {
    if (entry.isFile) {
      (entry as FileSystemFileEntry).file(
        (f) => {
          out.push(f);
          resolve();
        },
        () => resolve(),
      );
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const readAll = () => {
        reader.readEntries(
          async (batch) => {
            if (batch.length === 0) return resolve();
            await Promise.all(batch.map((e) => walkEntry(e, out)));
            readAll(); // readEntries returns in chunks
          },
          () => resolve(),
        );
      };
      readAll();
    } else {
      resolve();
    }
  });
}

/** A short, human label for an enquiry file, used as the row's kind chip. */
export function fileKindLabel(mimeType: string, fileName: string): string {
  const n = fileName.toLowerCase();
  const m = (mimeType || "").toLowerCase();
  if (m === "message/rfc822" || n.endsWith(".eml")) return "Email";
  if (m.includes("spreadsheetml") || n.endsWith(".xlsx") || n.endsWith(".xls")) return "Spreadsheet";
  if (m.startsWith("image/")) return "Photo";
  if (n.includes("measure") || n.includes("mark")) return "Marked up";
  if (n.includes("elevation")) return "Elevation";
  if (n.includes("roof")) return "Roof plan";
  if (n.includes("site") || n.includes("logistic")) return "Site plan";
  if (n.includes("floor") || n.includes("plan")) return "Plan";
  if (m === "application/pdf" || n.endsWith(".pdf")) return "Drawing";
  if (m.startsWith("text/") || n.endsWith(".txt") || n.endsWith(".csv")) return "Text";
  return "File";
}
