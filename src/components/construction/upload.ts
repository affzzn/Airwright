"use client";

import {
  createSignedConstructionUploads,
  registerConstructionAttachments,
} from "@/server/actions/construction";
import { startConstructionIngest } from "@/server/actions/constructionPack";
import { junkReason, type EnquiryBox } from "@/lib/construction/pack/files";

/**
 * Browser-side upload for a construction enquiry (docs/22 Step 3). A whole folder
 * (or loose files, or a zip) goes straight to Supabase Storage via signed URLs —
 * five at a time, with byte progress and retries — keeping each file's folder
 * path, registering files in batches as they finish (so an interrupted upload
 * resumes: re-dropping the same folder skips what already arrived), then queueing
 * the pack sort in the worker. Nothing is parsed here. Each file carries the
 * upload BOX it was put in (Scope / Drawings / Email), saved as its label.
 */

export interface FileWithPath {
  file: File;
  relativePath: string;
  /** The upload box it was put in — the file's label from now on. */
  box?: EnquiryBox;
}

export interface UploadProgress {
  total: number;
  done: number;
  failed: number;
  skipped: number;
  bytesTotal: number;
  bytesDone: number;
  current: string | null;
}

const MAX_CONCURRENT = 5;
const RETRY_DELAYS_MS = [0, 1000, 3000];
const FLUSH_EVERY = 10;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function normalizePath(raw: string, fallback: string): string {
  const cleaned = (raw || fallback)
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\/{2,}/g, "/")
    .trim();
  return cleaned || fallback;
}

/** PUT one file to a Supabase signed upload URL with byte progress. */
function putToSignedUrl(signedUrl: string, file: File, onProgress: (loaded: number) => void): Promise<void> {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    if (anonKey) {
      xhr.setRequestHeader("apikey", anonKey);
      xhr.setRequestHeader("authorization", `Bearer ${anonKey}`);
    }
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.addEventListener("progress", (e) => e.lengthComputable && onProgress(e.loaded));
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else if (xhr.status === 413) reject(new Error("Too large for the storage upload limit"));
      else reject(new Error(`Upload failed (HTTP ${xhr.status})`));
    });
    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", file);
    xhr.send(form);
  });
}

/**
 * Upload a pack to a job and queue its sort. OS clutter (.DS_Store, Thumbs.db)
 * is not uploaded at all; everything else is, so the register can account for it.
 */
export async function uploadConstructionPack(
  quoteId: string,
  picked: FileWithPath[],
  onProgress?: (p: UploadProgress) => void,
): Promise<UploadProgress> {
  const files = picked.filter((f) => junkReason(f.relativePath) !== "System file");
  const progress: UploadProgress = {
    total: files.length,
    done: 0,
    failed: 0,
    skipped: 0,
    bytesTotal: files.reduce((a, f) => a + f.file.size, 0),
    bytesDone: 0,
    current: null,
  };
  const emit = () => onProgress?.({ ...progress });
  if (files.length === 0) return progress;

  const prep = await createSignedConstructionUploads(
    quoteId,
    files.map((f) => ({ name: f.file.name, type: f.file.type, size: f.file.size, relativePath: f.relativePath })),
  );
  progress.skipped = prep.alreadyDone;
  progress.total = prep.targets.length;
  progress.bytesTotal = prep.targets.reduce((a, t) => a + files[t.index].file.size, 0);
  emit();

  const buffer: { path: string; name: string; type: string; size: number; relativePath: string; kind?: string }[] = [];
  const flush = async (force = false) => {
    while (buffer.length >= FLUSH_EVERY || (force && buffer.length > 0)) {
      const batch = buffer.splice(0, FLUSH_EVERY);
      try {
        await registerConstructionAttachments(quoteId, batch);
      } catch {
        buffer.unshift(...batch);
        break;
      }
    }
  };

  const loaded = new Map<number, number>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < prep.targets.length) {
      const t = prep.targets[cursor++];
      const item = files[t.index];
      progress.current = t.relativePath;
      emit();
      let ok = false;
      for (let attempt = 0; attempt < RETRY_DELAYS_MS.length && !ok; attempt++) {
        if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt]);
        try {
          await putToSignedUrl(t.signedUrl, item.file, (b) => {
            loaded.set(t.index, b);
            progress.bytesDone = [...loaded.values()].reduce((a, x) => a + x, 0);
            emit();
          });
          ok = true;
        } catch {
          loaded.set(t.index, 0);
        }
      }
      if (ok) {
        progress.done++;
        loaded.set(t.index, item.file.size);
        buffer.push({ path: t.path, name: t.name, type: t.type, size: t.size, relativePath: t.relativePath, kind: item.box });
        if (buffer.length >= FLUSH_EVERY) await flush();
      } else progress.failed++;
      emit();
    }
  };
  await Promise.all(Array.from({ length: MAX_CONCURRENT }, worker));
  await flush(true);
  progress.current = null;
  emit();

  // Sort whatever arrived (a partial upload is still worth sorting; the rest resumes).
  if (progress.done > 0 || progress.skipped > 0) await startConstructionIngest(quoteId);
  return progress;
}

/** Collect every file from a drop, recursing into dropped folders, with folder paths. */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<FileWithPath[]> {
  const items = Array.from(dt.items ?? []).filter((i) => i.kind === "file");
  const entries = items
    .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => e != null);
  if (entries.length === 0) return Array.from(dt.files ?? []).map((file) => ({ file, relativePath: file.name }));
  const out: FileWithPath[] = [];
  await Promise.all(entries.map((e) => walkEntry(e, out)));
  return out;
}

async function walkEntry(entry: FileSystemEntry, out: FileWithPath[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File | null>((res) => (entry as FileSystemFileEntry).file(res, () => res(null)));
    if (file) out.push({ file, relativePath: normalizePath(entry.fullPath, file.name) });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res) => reader.readEntries(res, () => res([])));
    if (batch.length === 0) break;
    await Promise.all(batch.map((e) => walkEntry(e, out)));
  }
}

/** Files from an <input type="file"> — with `webkitdirectory`, their folder paths too. */
export function filesFromInput(list: FileList | null): FileWithPath[] {
  return Array.from(list ?? []).map((file) => ({
    file,
    relativePath: normalizePath((file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "", file.name),
  }));
}

/** A short, human label for an enquiry file, used as the row's kind chip. */
export function fileKindLabel(mimeType: string, fileName: string): string {
  const n = fileName.toLowerCase();
  const m = (mimeType || "").toLowerCase();
  if (m === "message/rfc822" || n.endsWith(".eml")) return "Email";
  if (m.includes("spreadsheetml") || n.endsWith(".xlsx") || n.endsWith(".xls")) return "Spreadsheet";
  if (n.endsWith(".pptx")) return "Slides";
  if (n.endsWith(".zip")) return "Zip";
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
