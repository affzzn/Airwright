"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createSignedUploads, finalizeUploads } from "@/server/actions/upload";
import { cn, formatBytes } from "@/lib/utils";

type FileStatus = { name: string; state: "uploading" | "done" | "error"; size: number };

/**
 * Direct-to-Storage upload: the browser uploads each PDF/ZIP straight to
 * Supabase via a signed URL (no server body limit → large packs upload fast),
 * then finalize kicks off the process-pack job.
 */
export function UploadForm({ packId, bucket }: { packId: string; bucket: string }) {
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
    setStatuses(files.map((f) => ({ name: f.name, state: "uploading", size: f.size })));

    try {
      const supabase = createSupabaseBrowserClient();
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
          const { error } = await supabase.storage
            .from(bucket)
            .uploadToSignedUrl(t.path, t.token, file);
          setStatuses((prev) =>
            prev.map((s) =>
              s.name === t.name ? { ...s, state: error ? "error" : "done" } : s,
            ),
          );
          if (!error) {
            uploaded.push({
              path: t.path,
              name: t.name,
              type: t.type,
              size: t.size,
              isArchive: t.isArchive,
            });
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
          {statuses.map((s) => (
            <li
              key={s.name}
              className="flex items-center justify-between rounded-md border border-hairline bg-canvas px-3 py-2 text-xs"
            >
              <span className="truncate text-ink">{s.name}</span>
              <span className="ml-3 shrink-0 text-ink-subtle">
                {formatBytes(s.size)} ·{" "}
                {s.state === "uploading"
                  ? "uploading…"
                  : s.state === "done"
                    ? "uploaded"
                    : "failed"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
