"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, FileText, ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import {
  createSignedConstructionUploads,
  deleteConstructionAttachment,
  registerConstructionAttachments,
} from "@/server/actions/construction";
import type { ConstructionAttachmentVM } from "@/server/construction";
import { isPreviewable } from "@/components/construction/construction-reference-viewer";
import { Button } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";

/**
 * Attachment panel (docs/19 §3/§8) — upload the enquiry drawings + photos. Files
 * are STORED and DISPLAYED only; NEVER parsed (no AI, no reading). Upload goes
 * browser → Supabase Storage via a signed URL. Supports multi-file select AND
 * folder drag-and-drop. "View" opens a file in the reference viewer beside the
 * form; a non-previewable file just opens in a new tab.
 */
export function ConstructionAttachments({
  quoteId,
  attachments,
  locked,
  onView,
}: {
  quoteId: string;
  attachments: ConstructionAttachmentVM[];
  locked: boolean;
  onView?: (id: string) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setErr(null);
    try {
      const list = files.map((f) => ({ name: f.name, type: f.type, size: f.size }));
      const { targets } = await createSignedConstructionUploads(quoteId, list);
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
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (locked) return;
    const files = await filesFromDataTransfer(e.dataTransfer);
    if (files.length) await uploadFiles(files);
  };

  const remove = (id: string) =>
    start(async () => {
      await deleteConstructionAttachment(id, quoteId);
      router.refresh();
    });

  return (
    <div
      onDragOver={(e) => {
        if (locked) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={cn(
        "rounded-md",
        dragOver && "outline-dashed outline-2 outline-offset-2 outline-ink/40",
      )}
    >
      {attachments.length === 0 ? (
        <p className="text-xs text-ink-subtle">
          No attachments yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {attachments.map((a) => {
            const canView = isPreviewable(a);
            const isImg = (a.mimeType || "").startsWith("image/");
            return (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2 rounded-md border border-hairline bg-surface px-3 py-2"
              >
                <button
                  type="button"
                  onClick={() => window.open(`/construction/attachments/${a.id}`, "_blank")}
                  className="flex min-w-0 items-center gap-2 text-left text-sm text-ink hover:underline"
                  title="Open in a new tab"
                >
                  {isImg ? (
                    <ImageIcon className="h-4 w-4 shrink-0 text-ink-subtle" strokeWidth={1.75} />
                  ) : (
                    <FileText className="h-4 w-4 shrink-0 text-ink-subtle" strokeWidth={1.75} />
                  )}
                  <span className="truncate">{a.fileName}</span>
                  {a.sizeBytes != null && (
                    <span className="shrink-0 text-[11px] text-ink-subtle">{formatBytes(a.sizeBytes)}</span>
                  )}
                </button>
                <div className="flex shrink-0 items-center gap-0.5">
                  {canView && onView && (
                    <button
                      type="button"
                      aria-label="View drawing beside the form"
                      onClick={() => onView(a.id)}
                      className="hidden rounded-md p-1 text-ink-subtle transition-colors hover:bg-canvas hover:text-ink lg:inline-flex"
                      title="View beside the form"
                    >
                      <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                  )}
                  {!locked && (
                    <button
                      type="button"
                      aria-label="Remove attachment"
                      onClick={() => remove(a.id)}
                      disabled={pending}
                      className="rounded-md p-1 text-ink-subtle transition-colors hover:bg-canvas hover:text-ink disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!locked && (
        <div className="mt-3">
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && uploadFiles(Array.from(e.target.files))}
          />
          <Button
            variant="secondary"
            size="sm"
            className="gap-2"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            Add files
          </Button>
          <span className="ml-2 text-[11px] text-ink-subtle">or drag a folder here</span>
          {err && <span className="ml-3 text-xs text-ink">{err}</span>}
        </div>
      )}
    </div>
  );
}

/** Collect all files from a drop, recursing into any dropped folders. */
async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
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
      (entry as FileSystemFileEntry).file((f) => {
        out.push(f);
        resolve();
      }, () => resolve());
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const readAll = () => {
        reader.readEntries(async (batch) => {
          if (batch.length === 0) return resolve();
          await Promise.all(batch.map((e) => walkEntry(e, out)));
          readAll(); // keep reading — readEntries returns in chunks
        }, () => resolve());
      };
      readAll();
    } else {
      resolve();
    }
  });
}
