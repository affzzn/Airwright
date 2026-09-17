"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import {
  createSignedConstructionUploads,
  deleteConstructionAttachment,
  registerConstructionAttachments,
} from "@/server/actions/construction";
import type { ConstructionAttachmentVM } from "@/server/construction";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";

/**
 * Attachment panel (docs/19 §3/§8) — upload the enquiry email + drawings + photos.
 * Files are STORED and DISPLAYED only; they are NEVER parsed (no AI, no reading).
 * Upload goes browser → Supabase Storage via a signed URL, then registers the row.
 */
export function ConstructionAttachments({
  quoteId,
  attachments,
  locked,
}: {
  quoteId: string;
  attachments: ConstructionAttachmentVM[];
  locked: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setErr(null);
    try {
      const list = Array.from(files).map((f) => ({ name: f.name, type: f.type, size: f.size }));
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

  const remove = (id: string) =>
    start(async () => {
      await deleteConstructionAttachment(id, quoteId);
      router.refresh();
    });

  return (
    <div>
      {attachments.length === 0 ? (
        <p className="text-xs text-ink-subtle">
          No attachments yet — add the enquiry email, drawings and site photos to work from.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-2 rounded-md border border-hairline bg-surface px-3 py-2"
            >
              <a
                href={`/construction/attachments/${a.id}`}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 items-center gap-2 text-sm text-ink hover:underline"
              >
                <FileText className="h-4 w-4 shrink-0 text-ink-subtle" strokeWidth={1.75} />
                <span className="truncate">{a.fileName}</span>
                {a.sizeBytes != null && (
                  <span className="shrink-0 text-[11px] text-ink-subtle">{formatBytes(a.sizeBytes)}</span>
                )}
              </a>
              {!locked && (
                <button
                  type="button"
                  aria-label="Remove attachment"
                  onClick={() => remove(a.id)}
                  disabled={pending}
                  className="shrink-0 rounded-md p-1 text-ink-subtle transition-colors hover:bg-canvas hover:text-ink disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!locked && (
        <div className="mt-3">
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
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
          {err && <span className="ml-3 text-xs text-ink">{err}</span>}
        </div>
      )}
    </div>
  );
}
