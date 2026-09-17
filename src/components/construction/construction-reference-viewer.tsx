"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, ImageIcon, Loader2, X } from "lucide-react";
import { signConstructionAttachment } from "@/server/actions/construction";
import { PdfViewerClient } from "@/components/pdf-viewer-client";
import { cn } from "@/lib/utils";

export interface RefAttachment {
  id: string;
  fileName: string;
  mimeType: string;
}

/** Is this file inline-previewable (PDF or image)? Other types get a link only. */
export function isPreviewable(a: { mimeType: string; fileName: string }): boolean {
  return kindOf(a) !== "other";
}
function kindOf(a: { mimeType: string; fileName: string }): "pdf" | "image" | "other" {
  const m = (a.mimeType || "").toLowerCase();
  const n = a.fileName.toLowerCase();
  if (m.includes("pdf") || n.endsWith(".pdf")) return "pdf";
  if (m.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(n)) return "image";
  return "other";
}

/**
 * The reference viewer body — a strip of the uploaded drawings/photos + the
 * selected file rendered inline (PDF via the app's PDF.js viewer; images inline).
 * Reused by the in-builder drawer and the pop-out window. PDFs + images only
 * (docs/19 — drawings are reference material, never parsed).
 */
export function ReferenceViewerBody({
  attachments,
  selectedId,
  onSelect,
}: {
  attachments: RefAttachment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const previewable = attachments.filter(isPreviewable);
  const selected = previewable.find((a) => a.id === selectedId) ?? previewable[0] ?? null;

  // Cache signed URLs per attachment id (fetched on demand when selected).
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const ensureUrl = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await signConstructionAttachment(id);
      if (res.url) setUrls((prev) => ({ ...prev, [id]: res.url as string }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected && !urls[selected.id]) void ensureUrl(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  return (
    <div className="flex h-full flex-col">
      {/* File strip */}
      <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-hairline bg-surface px-3 py-2">
        {previewable.length === 0 && (
          <span className="py-1 text-xs text-ink-subtle">No previewable drawings or photos.</span>
        )}
        {previewable.map((a) => {
          const k = kindOf(a);
          const active = selected?.id === a.id;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelect(a.id)}
              title={a.fileName}
              className={cn(
                "inline-flex max-w-[13rem] shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
                active
                  ? "border-ink bg-canvas font-medium text-ink"
                  : "border-hairline-strong bg-canvas text-ink-muted hover:text-ink",
              )}
            >
              {k === "pdf" ? (
                <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
              ) : (
                <ImageIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
              )}
              <span className="truncate">{a.fileName}</span>
            </button>
          );
        })}
      </div>

      {/* Viewer area */}
      <div className="min-h-0 flex-1 overflow-auto bg-surface-2 p-3">
        {!selected ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-subtle">
            Upload a drawing or photo to view it here.
          </div>
        ) : loading && !urls[selected.id] ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-subtle">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> Loading…
          </div>
        ) : urls[selected.id] ? (
          kindOf(selected) === "pdf" ? (
            <PdfViewerClient url={urls[selected.id]} fit="width" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={urls[selected.id]}
              alt={selected.fileName}
              className="mx-auto max-w-full rounded-md border border-hairline bg-canvas"
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-subtle">
            Couldn’t load this file.
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The in-builder reference DRAWER — a fixed, full-height panel on the right that
 * shows the selected drawing beside the form, so the estimator reads and types at
 * once. A pop-out button opens the same viewer in its own window (dual-monitor).
 */
export function ConstructionReferenceDrawer({
  open,
  onClose,
  quoteId,
  attachments,
  selectedId,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  quoteId: string;
  attachments: RefAttachment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const firstRef = useRef(false);
  useEffect(() => {
    if (open && !firstRef.current) firstRef.current = true;
  }, [open]);

  if (!open) return null;

  const popOut = () => {
    const q = selectedId ? `?file=${selectedId}` : "";
    window.open(
      `/construction/${quoteId}/reference${q}`,
      `ref-${quoteId}`,
      "width=900,height=1100,menubar=no,toolbar=no",
    );
    onClose();
  };

  return (
    <>
      {/* Mobile scrim */}
      <div className="fixed inset-0 z-30 bg-ink/30 lg:hidden" onClick={onClose} aria-hidden />
      <aside
        className="fixed right-0 top-14 z-40 flex h-[calc(100vh-3.5rem)] w-full flex-col border-l border-hairline bg-canvas shadow-overlay lg:w-[44vw]"
        aria-label="Reference drawings"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-hairline px-3 py-2">
          <span className="text-sm font-semibold text-ink">Reference</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={popOut}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-surface hover:text-ink"
              title="Open in a separate window (for a second monitor)"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} /> Pop out
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close reference"
              className="rounded-md p-1.5 text-ink-subtle transition-colors hover:bg-surface hover:text-ink"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <ReferenceViewerBody attachments={attachments} selectedId={selectedId} onSelect={onSelect} />
        </div>
      </aside>
    </>
  );
}
