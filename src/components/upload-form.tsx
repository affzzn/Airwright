"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, FolderUp } from "lucide-react";
import { createSignedUploads, finalizeUploads } from "@/server/actions/upload";
import { ProgressBar } from "@/components/ui/progress";
import { cn, formatBytes } from "@/lib/utils";

type FileStatus = {
  key: string;
  name: string;
  state: "uploading" | "done" | "error";
  size: number;
  progress: number; // 0–100, real bytes uploaded
  error?: string;
};

/** A picked file plus its path inside the uploaded folder (docs/17 grouping signal). */
interface FileWithPath {
  file: File;
  relativePath: string;
}

const MAX_CONCURRENT = 5;
const MAX_RETRIES = 2;

/**
 * PUT a file straight to a Supabase signed upload URL via XHR (true byte-level
 * progress). Mirrors what `uploadToSignedUrl` sends (multipart FormData).
 */
function putToSignedUrl(
  signedUrl: string,
  file: File,
  anonKey: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("apikey", anonKey);
    xhr.setRequestHeader("authorization", `Bearer ${anonKey}`);
    xhr.setRequestHeader("x-upsert", "true");

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else if (xhr.status === 413)
        reject(new Error("Too large — exceeds the Storage upload limit."));
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

/** Recursively read a dropped directory (FileSystem API) into files + paths. */
async function readEntry(entry: FileSystemEntry): Promise<FileWithPath[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((res, rej) => fileEntry.file(res, rej));
    return [{ file, relativePath: entry.fullPath.replace(/^\//, "") }];
  }
  const dirReader = (entry as FileSystemDirectoryEntry).createReader();
  const entries: FileSystemEntry[] = [];
  // readEntries returns in batches — keep calling until it's empty.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) =>
      dirReader.readEntries(res, rej),
    );
    if (batch.length === 0) break;
    entries.push(...batch);
  }
  const nested = await Promise.all(entries.map(readEntry));
  return nested.flat();
}

async function filesFromDrop(dt: DataTransfer): Promise<FileWithPath[]> {
  const items = Array.from(dt.items).filter((i) => i.kind === "file");
  const entries = items
    .map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => e !== null);
  if (entries.length > 0) {
    const all = await Promise.all(entries.map(readEntry));
    return all.flat();
  }
  // Fallback: no FileSystem API — take the flat file list.
  return Array.from(dt.files).map((file) => ({ file, relativePath: file.name }));
}

export function UploadForm({ packId }: { packId: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statuses, setStatuses] = useState<FileStatus[]>([]);
  const router = useRouter();

  async function handleFiles(picked: FileWithPath[]) {
    const files = picked.filter((p) => /\.(pdf|zip)$/i.test(p.file.name));
    if (files.length === 0) return;

    setBusy(true);
    setStatuses(
      files.map((f, i) => ({
        key: `${i}-${f.relativePath}`,
        name: f.relativePath,
        state: "uploading",
        size: f.file.size,
        progress: 0,
      })),
    );

    const setProgress = (key: string, progress: number) =>
      setStatuses((prev) => prev.map((s) => (s.key === key ? { ...s, progress } : s)));
    const setState = (key: string, state: FileStatus["state"], error?: string) =>
      setStatuses((prev) =>
        prev.map((s) =>
          s.key === key
            ? { ...s, state, error, progress: state === "done" ? 100 : s.progress }
            : s,
        ),
      );

    try {
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
      const targets = await createSignedUploads(
        packId,
        files.map((f) => ({
          name: f.file.name,
          type: f.file.type,
          size: f.file.size,
          relativePath: f.relativePath,
        })),
      );

      const uploaded: {
        path: string;
        name: string;
        relativePath: string;
        type: string;
        size: number;
        isArchive: boolean;
      }[] = [];

      // Concurrency-limited pool with per-file retry (robust on big folders).
      let cursor = 0;
      async function worker() {
        while (cursor < targets.length) {
          const t = targets[cursor++];
          const picked = files[t.index];
          if (!picked) continue;
          const key = `${t.index}-${t.relativePath}`;
          let lastErr: unknown;
          for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
              await putToSignedUrl(t.signedUrl, picked.file, anonKey, (frac) =>
                setProgress(key, Math.round(frac * 100)),
              );
              setState(key, "done");
              uploaded.push({
                path: t.path,
                name: t.name,
                relativePath: t.relativePath,
                type: t.type,
                size: t.size,
                isArchive: t.isArchive,
              });
              lastErr = null;
              break;
            } catch (err) {
              lastErr = err;
            }
          }
          if (lastErr)
            setState(key, "error", lastErr instanceof Error ? lastErr.message : "Upload failed");
        }
      }
      await Promise.all(Array.from({ length: MAX_CONCURRENT }, worker));

      if (uploaded.length) await finalizeUploads(packId, uploaded);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  const doneCount = statuses.filter((s) => s.state === "done").length;
  const errorCount = statuses.filter((s) => s.state === "error").length;

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragging(false);
          if (busy) return;
          const files = await filesFromDrop(e.dataTransfer);
          void handleFiles(files);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-14 text-center transition-colors",
          dragging ? "border-ink bg-surface" : "border-hairline-strong bg-surface",
          busy && "pointer-events-none opacity-60",
        )}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-hairline bg-canvas">
          <Upload className="h-4 w-4 text-ink-muted" strokeWidth={1.75} />
        </div>
        <div>
          <p className="text-sm font-medium text-ink">
            {busy ? "Uploading…" : "Drop a tender-pack folder or files here"}
          </p>
          <p className="mt-1 text-xs text-ink-subtle">
            A whole folder (subfolders and all), loose PDFs, or a ZIP — the system
            sorts pages into house types
          </p>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={() => !busy && folderInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md border border-hairline-strong px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-canvas"
          >
            <FolderUp className="h-3.5 w-3.5" strokeWidth={1.75} />
            Choose folder
          </button>
          <button
            type="button"
            onClick={() => !busy && fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md border border-hairline-strong px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-canvas"
          >
            Choose files
          </button>
        </div>

        {/* Folder picker (webkitdirectory → webkitRelativePath preserved). */}
        <input
          ref={folderInputRef}
          type="file"
          hidden
          multiple
          // @ts-expect-error non-standard but widely supported directory picker
          webkitdirectory=""
          directory=""
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []).map((file) => ({
              file,
              relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
            }));
            void handleFiles(list);
          }}
        />
        {/* Flat file picker. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf,.zip,application/zip"
          multiple
          hidden
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []).map((file) => ({ file, relativePath: file.name }));
            void handleFiles(list);
          }}
        />
      </div>

      {statuses.length > 0 && (
        <>
          <p className="mt-3 text-xs text-ink-subtle">
            {doneCount} of {statuses.length} uploaded
            {errorCount > 0 && ` · ${errorCount} failed`}
          </p>
          {statuses.length <= 40 && (
            <ul className="mt-2 space-y-1.5">
              {statuses.map((s) => {
                const label =
                  s.state === "done"
                    ? "Uploaded"
                    : s.state === "error"
                      ? "Failed"
                      : s.progress >= 100
                        ? "Finishing…"
                        : "Uploading";
                return (
                  <li
                    key={s.key}
                    className="rounded-md border border-hairline bg-canvas px-3 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-ink">{s.name}</span>
                      <span className="ml-3 shrink-0 text-ink-subtle">
                        {formatBytes(s.size)} · {label}
                      </span>
                    </div>
                    {s.state === "uploading" && (
                      <div className="mt-2">
                        <ProgressBar value={s.progress} />
                      </div>
                    )}
                    {s.state === "error" && s.error && (
                      <p className="mt-1 text-ink-muted">{s.error}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
