"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { createSignedUploads, finalizeUploads } from "@/server/actions/upload";
import { ProgressBar } from "@/components/ui/progress";
import { cn, formatBytes } from "@/lib/utils";

type FileStatus = {
  name: string;
  state: "uploading" | "done" | "error";
  size: number;
  progress: number; // 0–100, real bytes uploaded
  error?: string;
};

/**
 * PUT a file straight to a Supabase signed upload URL via XHR — mirrors what
 * `uploadToSignedUrl` sends (multipart FormData: cacheControl + the file under
 * an empty field name), but XHR exposes `upload.onprogress` so we get true
 * byte-level progress the fetch-based SDK helper can't provide.
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
        reject(
          new Error(
            "Too large — exceeds the Storage upload limit. Raise it in Supabase → Storage → Settings.",
          ),
        );
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
 * Direct-to-Storage upload: the browser uploads each PDF/ZIP straight to
 * Supabase via a signed URL (no server body limit → large packs upload fast),
 * then finalize kicks off the process-pack job.
 */
export function UploadForm({ packId }: { packId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statuses, setStatuses] = useState<FileStatus[]>([]);
  const router = useRouter();

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).filter((f) => /\.(pdf|zip)$/i.test(f.name));
    if (files.length === 0) return;

    setBusy(true);
    setStatuses(
      files.map((f) => ({
        name: f.name,
        state: "uploading",
        size: f.size,
        progress: 0,
      })),
    );

    const setProgress = (name: string, progress: number) =>
      setStatuses((prev) =>
        prev.map((s) => (s.name === name ? { ...s, progress } : s)),
      );
    const setState = (
      name: string,
      state: FileStatus["state"],
      error?: string,
    ) =>
      setStatuses((prev) =>
        prev.map((s) =>
          s.name === name
            ? { ...s, state, error, progress: state === "done" ? 100 : s.progress }
            : s,
        ),
      );

    try {
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
      const targets = await createSignedUploads(
        packId,
        files.map((f) => ({ name: f.name, type: f.type, size: f.size })),
      );

      const uploaded: {
        path: string;
        name: string;
        type: string;
        size: number;
        isArchive: boolean;
      }[] = [];

      await Promise.all(
        targets.map(async (t) => {
          const file = files.find((f) => f.name === t.name);
          if (!file) return;
          try {
            await putToSignedUrl(t.signedUrl, file, anonKey, (fraction) =>
              setProgress(t.name, Math.round(fraction * 100)),
            );
            setState(t.name, "done");
            uploaded.push({
              path: t.path,
              name: t.name,
              type: t.type,
              size: t.size,
              isArchive: t.isArchive,
            });
          } catch (err) {
            setState(
              t.name,
              "error",
              err instanceof Error ? err.message : "Upload failed",
            );
          }
        }),
      );

      if (uploaded.length) await finalizeUploads(packId, uploaded);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => !busy && inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center transition-colors",
          dragging ? "border-ink bg-surface" : "border-hairline-strong bg-surface",
          busy && "pointer-events-none opacity-60",
        )}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-hairline bg-canvas">
          <Upload className="h-4 w-4 text-ink-muted" strokeWidth={1.75} />
        </div>
        <div>
          <p className="text-sm font-medium text-ink">
            {busy
              ? "Uploading…"
              : "Drop tender-pack files here, or click to browse"}
          </p>
          <p className="mt-1 text-xs text-ink-subtle">
            PDF or ZIP · multiple files · large packs supported
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf,.zip,application/zip"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {statuses.length > 0 && (
        <ul className="mt-3 space-y-1.5">
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
                key={s.name}
                className="rounded-md border border-hairline bg-canvas px-3 py-2 text-xs"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-ink">{s.name}</span>
                  <span className="ml-3 shrink-0 text-ink-subtle">
                    {formatBytes(s.size)} · {label}
                  </span>
                </div>
                {s.state === "uploading" && (
                  <div className="mt-2 flex items-center gap-2">
                    <ProgressBar value={s.progress} className="flex-1" />
                    <span className="w-9 shrink-0 text-right tabular-nums text-[11px] text-ink-subtle">
                      {s.progress}%
                    </span>
                  </div>
                )}
                {s.state === "error" && s.error && (
                  <p className="mt-1.5 text-[11px] text-ink-muted">{s.error}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
