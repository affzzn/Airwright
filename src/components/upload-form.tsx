"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderUp, FileUp } from "lucide-react";
import {
  createSignedUploads,
  registerUploads,
  startProcessing,
} from "@/server/actions/upload";
import { isUploadableName, normalizeRelativePath } from "@/lib/upload/plan";
import { ProgressBar } from "@/components/ui/progress";
import { cn, formatBytes } from "@/lib/utils";

type FileStatus = {
  key: string;
  name: string;
  state: "uploading" | "done" | "error";
  size: number;
  progress: number; // 0–100
  error?: string;
};

interface FileWithPath {
  file: File;
  relativePath: string;
}

const MAX_CONCURRENT = 5;
const RETRY_DELAYS_MS = [0, 1000, 3000]; // attempt 1 immediate, then backoff
const FLUSH_EVERY = 20; // register completed files in batches (durability + resume)

/** PUT a file to a Supabase signed upload URL via XHR (true byte progress). */
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Recursively read a dropped directory (FileSystem API) into files + paths. */
async function readEntry(entry: FileSystemEntry): Promise<FileWithPath[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((res, rej) => fileEntry.file(res, rej));
    return [{ file, relativePath: normalizeRelativePath(entry.fullPath, file.name) }];
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const entries: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) =>
      reader.readEntries(res, rej),
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
  return Array.from(dt.files).map((file) => ({ file, relativePath: file.name }));
}

export function UploadForm({ packId }: { packId: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statuses, setStatuses] = useState<FileStatus[]>([]);
  const [resumed, setResumed] = useState(0);
  const router = useRouter();

  async function handleFiles(picked: FileWithPath[]) {
    const files = picked.filter((p) => isUploadableName(p.file.name));
    if (files.length === 0) return;

    setBusy(true);
    setResumed(0);

    const setStatus = (key: string, patch: Partial<FileStatus>) =>
      setStatuses((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));

    try {
      const prep = await createSignedUploads(
        packId,
        files.map((f) => ({
          name: f.file.name,
          type: f.file.type,
          size: f.file.size,
          relativePath: f.relativePath,
        })),
      );
      setResumed(prep.alreadyDone);

      const targetByIndex = new Map(prep.targets.map((t) => [t.index, t]));
      // Initial UI: files not in the target set were already uploaded (resumed).
      setStatuses(
        files.map((f, i) => ({
          key: `${i}-${f.relativePath}`,
          name: f.relativePath,
          state: targetByIndex.has(i) ? "uploading" : "done",
          size: f.file.size,
          progress: targetByIndex.has(i) ? 0 : 100,
        })),
      );

      if (prep.targets.length === 0) {
        await startProcessing(packId); // everything already uploaded → just process
        return;
      }

      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
      const targets = prep.targets;

      // Completed-but-unregistered buffer, flushed in batches for durability.
      type Desc = {
        path: string;
        name: string;
        relativePath: string;
        type: string;
        size: number;
        isArchive: boolean;
      };
      const buffer: Desc[] = [];
      async function flush(force = false) {
        while (buffer.length >= FLUSH_EVERY || (force && buffer.length > 0)) {
          const batch = buffer.splice(0, FLUSH_EVERY);
          try {
            await registerUploads(packId, batch);
          } catch {
            buffer.unshift(...batch); // put back; retried on the final force-flush
            break;
          }
        }
      }

      let cursor = 0;
      async function worker() {
        while (cursor < targets.length) {
          const t = targets[cursor++];
          const item = files[t.index];
          if (!item) continue;
          const key = `${t.index}-${t.relativePath}`;

          let ok = false;
          let lastErr: unknown;
          for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
            if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt]);
            try {
              await putToSignedUrl(t.signedUrl, item.file, anonKey, (frac) =>
                setStatus(key, { progress: Math.round(frac * 100) }),
              );
              ok = true;
              break;
            } catch (err) {
              lastErr = err;
            }
          }

          if (ok) {
            setStatus(key, { state: "done", progress: 100 });
            buffer.push({
              path: t.path,
              name: t.name,
              relativePath: t.relativePath,
              type: t.type,
              size: t.size,
              isArchive: t.isArchive,
            });
            if (buffer.length >= FLUSH_EVERY) await flush();
          } else {
            setStatus(key, {
              state: "error",
              error: lastErr instanceof Error ? lastErr.message : "Upload failed",
            });
          }
        }
      }

      await Promise.all(Array.from({ length: MAX_CONCURRENT }, worker));
      await flush(true); // register any stragglers
      await startProcessing(packId);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  const total = statuses.length;
  const done = statuses.filter((s) => s.state === "done").length;
  const errors = statuses.filter((s) => s.state === "error").length;

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
          void handleFiles(await filesFromDrop(e.dataTransfer));
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-14 text-center transition-colors",
          dragging ? "border-ink bg-surface" : "border-hairline-strong bg-surface",
          busy && "pointer-events-none opacity-60",
        )}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-hairline bg-canvas">
          <FolderUp className="h-4 w-4 text-ink-muted" strokeWidth={1.75} />
        </div>
        <div>
          <p className="text-sm font-medium text-ink">
            {busy ? "Uploading…" : "Drop the tender-pack folder here"}
          </p>
          <p className="mt-1 text-xs text-ink-subtle">
            The whole folder — subfolders and all. The system sorts the pages into
            house types and ignores the non-scaffolding files.
          </p>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={() => !busy && folderInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3.5 py-1.5 text-xs font-medium text-canvas transition-opacity hover:opacity-90"
          >
            <FolderUp className="h-3.5 w-3.5" strokeWidth={1.75} />
            Choose folder
          </button>
          <button
            type="button"
            onClick={() => !busy && fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md border border-hairline-strong px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-canvas"
          >
            <FileUp className="h-3.5 w-3.5" strokeWidth={1.75} />
            Files or ZIP
          </button>
        </div>
        <p className="text-[11px] text-ink-subtle">
          Tip: uploading the folder is more reliable than a single large ZIP.
        </p>

        {/* Folder picker (webkitdirectory → webkitRelativePath preserved). */}
        <input
          ref={folderInputRef}
          type="file"
          hidden
          multiple
          // @ts-expect-error non-standard directory picker attributes
          webkitdirectory=""
          directory=""
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []).map((file) => ({
              file,
              relativePath: normalizeRelativePath(
                (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "",
                file.name,
              ),
            }));
            e.target.value = "";
            void handleFiles(list);
          }}
        />
        {/* Loose files / ZIP picker. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf,.zip,application/zip"
          multiple
          hidden
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []).map((file) => ({
              file,
              relativePath: file.name,
            }));
            e.target.value = "";
            void handleFiles(list);
          }}
        />
      </div>

      {total > 0 && (
        <>
          <p className="mt-3 text-xs text-ink-subtle">
            {done} of {total} uploaded
            {errors > 0 && ` · ${errors} failed`}
            {resumed > 0 && ` · ${resumed} already uploaded (resumed)`}
          </p>
          {errors > 0 && !busy && (
            <p className="mt-1 text-xs text-ink-muted">
              Some files failed — drop the same folder again to retry just those.
            </p>
          )}
          {total <= 40 && (
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
