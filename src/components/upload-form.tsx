"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { uploadDocuments } from "@/server/actions/upload";
import { cn } from "@/lib/utils";

/** Drag-and-drop / click PDF upload. Posts to the uploadDocuments server action. */
export function UploadForm({ packId }: { packId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(files: FileList | null) {
    if (!files || files.length === 0) return;
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("files", f));
    startTransition(async () => {
      await uploadDocuments(packId, fd);
      router.refresh();
    });
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        submit(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center transition-colors",
        dragging ? "border-ink bg-surface" : "border-hairline-strong bg-surface",
        pending && "pointer-events-none opacity-60",
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-md border border-hairline bg-canvas">
        <Upload className="h-4 w-4 text-ink-muted" strokeWidth={1.75} />
      </div>
      <div>
        <p className="text-sm font-medium text-ink">
          {pending ? "Uploading…" : "Drop tender-pack PDFs here, or click to browse"}
        </p>
        <p className="mt-1 text-xs text-ink-subtle">
          PDF only · multiple files supported
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        multiple
        hidden
        onChange={(e) => submit(e.target.files)}
      />
    </div>
  );
}
