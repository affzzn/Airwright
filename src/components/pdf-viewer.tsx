"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

// Bundle the pdf.js worker locally (no external CDN — CSP-safe).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * Inline drawing preview (click to enlarge) + a zoomable / pannable lightbox.
 * This IS PDF.js (via react-pdf); view-only — no annotation.
 *
 * `pages` restricts the viewer to a specific set of 1-indexed pages (the ones
 * relevant to this house type). Navigation steps through only those pages. When
 * omitted, the whole document is shown.
 */
export default function PdfViewer({
  url,
  pages,
  goTo,
}: {
  url: string;
  pages?: number[];
  goTo?: { page: number; nonce: number } | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [numPages, setNumPages] = useState(0);
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(false);

  // The pages actually shown: the supplied relevant set (clamped to the real
  // page count once known), else every page.
  const shownPages = useMemo(() => {
    if (pages && pages.length > 0) {
      const inRange = numPages
        ? pages.filter((p) => p >= 1 && p <= numPages)
        : pages;
      return inRange.length > 0 ? inRange : pages;
    }
    if (numPages > 0) return Array.from({ length: numPages }, (_, i) => i + 1);
    return [];
  }, [pages, numPages]);

  const count = shownPages.length;
  const safeIdx = Math.min(idx, Math.max(0, count - 1));
  const currentPage = shownPages[safeIdx] ?? 1;
  const isFiltered = Boolean(pages && pages.length > 0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Jump to a specific document page when a provenance link asks for it, and
  // bring the viewer into view. Ignored if that page isn't in the shown set.
  useEffect(() => {
    if (!goTo) return;
    const target = shownPages.indexOf(goTo.page);
    if (target < 0) return;
    setIdx(target);
    containerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goTo?.nonce]);

  return (
    <div ref={containerRef} className="w-full">
      <Document
        file={url}
        onLoadSuccess={({ numPages }) => setNumPages(numPages)}
        loading={
          <div
            className="animate-pulse rounded-md bg-surface-2"
            style={{ height: 420 }}
          />
        }
        error={<ViewerMessage>Could not render this PDF.</ViewerMessage>}
      >
        <div
          role="button"
          tabIndex={0}
          aria-label="Enlarge drawing"
          onClick={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen(true);
            }
          }}
          className="group relative block cursor-zoom-in overflow-hidden rounded-md border border-hairline bg-surface outline-none focus-visible:ring-2 focus-visible:ring-ink"
        >
          <Page
            pageNumber={currentPage}
            width={width}
            renderAnnotationLayer={false}
            renderTextLayer={false}
            loading={
              <div
                className="animate-pulse rounded-md bg-surface-2"
                style={{ height: 420 }}
              />
            }
          />
          <span className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-md border border-hairline bg-canvas/90 px-2 py-1 text-[11px] text-ink-muted opacity-0 transition-opacity group-hover:opacity-100">
            <Maximize2 className="h-3 w-3" strokeWidth={1.75} />
            Click to enlarge
          </span>
        </div>

        {count > 1 && (
          <div className="mt-3">
            <p className="mb-2 text-xs text-ink-subtle">
              {isFiltered ? "Relevant pages" : "Pages"} · {safeIdx + 1} of {count}{" "}
              · p.{currentPage}
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {shownPages.map((p, i) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setIdx(i)}
                  aria-label={`Page ${p}`}
                  aria-current={i === safeIdx}
                  className={cn(
                    "shrink-0 rounded-md border bg-surface p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink",
                    i === safeIdx
                      ? "border-ink"
                      : "border-hairline hover:border-hairline-strong",
                  )}
                >
                  <Page
                    pageNumber={p}
                    width={56}
                    renderAnnotationLayer={false}
                    renderTextLayer={false}
                    loading={
                      <div className="h-16 w-14 animate-pulse rounded bg-surface-2" />
                    }
                  />
                  <span
                    className={cn(
                      "mt-1 block text-center text-[10px]",
                      i === safeIdx ? "text-ink" : "text-ink-subtle",
                    )}
                  >
                    p.{p}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Document>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        label="Drawing viewer"
        className="w-[94vw] max-w-[1400px]"
      >
        <Lightbox
          url={url}
          shownPages={shownPages}
          idx={safeIdx}
          setIdx={setIdx}
          isFiltered={Boolean(pages && pages.length > 0)}
          onClose={() => setOpen(false)}
        />
      </Modal>
    </div>
  );
}

/** The full-screen viewer: zoom, fit-width, drag-to-pan, keyboard nav. */
function Lightbox({
  url,
  shownPages,
  idx,
  setIdx,
  isFiltered,
  onClose,
}: {
  url: string;
  shownPages: number[];
  idx: number;
  setIdx: React.Dispatch<React.SetStateAction<number>>;
  isFiltered: boolean;
  onClose: () => void;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [fitWidth, setFitWidth] = useState(800);
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const count = Math.max(shownPages.length, 1);
  const currentPage = shownPages[idx] ?? 1;

  const goPrev = useCallback(() => setIdx((i) => Math.max(0, i - 1)), [setIdx]);
  const goNext = useCallback(
    () => setIdx((i) => Math.min(count - 1, i + 1)),
    [setIdx, count],
  );

  // Fit-width tracks the available area width.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setFitWidth(Math.max(200, Math.floor(entry.contentRect.width) - 32));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ⌘/Ctrl + wheel and trackpad pinch (fires wheel with ctrlKey) → zoom.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.1 : 0.9)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Keyboard: page nav + zoom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "+" || e.key === "=")
        setZoom((z) => clampZoom(z + 0.25));
      else if (e.key === "-" || e.key === "_")
        setZoom((z) => clampZoom(z - 0.25));
      else if (e.key === "0") setZoom(1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [goNext, goPrev]);

  // Drag-to-pan when the drawing overflows the viewport.
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(
    null,
  );
  const onMouseDown = (e: React.MouseEvent) => {
    const el = areaRef.current;
    if (!el) return;
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
    };
    setDragging(true);
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const el = areaRef.current;
    if (!el || !drag.current) return;
    el.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
    el.scrollTop = drag.current.top - (e.clientY - drag.current.y);
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  const zoomPct = Math.round(zoom * 100);

  return (
    <div className="flex h-[92vh] flex-col">
      {/* Control strip */}
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-3 py-2">
        <div className="flex items-center gap-1">
          <IconButton onClick={goPrev} disabled={idx <= 0} label="Previous page">
            <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
          </IconButton>
          <span className="min-w-[132px] text-center text-xs tabular-nums text-ink-muted">
            {isFiltered ? "Relevant page" : "Page"} {idx + 1} / {count}
            <span className="text-ink-muted/70"> · p.{currentPage}</span>
          </span>
          <IconButton
            onClick={goNext}
            disabled={idx >= count - 1}
            label="Next page"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
          </IconButton>
        </div>

        <div className="flex items-center gap-1">
          <IconButton
            onClick={() => setZoom((z) => clampZoom(z - 0.25))}
            disabled={zoom <= MIN_ZOOM}
            label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" strokeWidth={1.75} />
          </IconButton>
          <button
            type="button"
            onClick={() => setZoom(1)}
            title="Reset zoom (fit width)"
            className="min-w-[52px] rounded-md px-1.5 py-1 text-center text-xs tabular-nums text-ink-muted hover:bg-surface hover:text-ink"
          >
            {zoomPct}%
          </button>
          <IconButton
            onClick={() => setZoom((z) => clampZoom(z + 0.25))}
            disabled={zoom >= MAX_ZOOM}
            label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" strokeWidth={1.75} />
          </IconButton>

          <span className="mx-1 h-4 w-px bg-hairline" />

          <IconButton onClick={() => setZoom(1)} label="Fit width">
            <Maximize2 className="h-4 w-4" strokeWidth={1.75} />
          </IconButton>

          <span className="mx-1 h-4 w-px bg-hairline" />

          <IconButton onClick={onClose} label="Close">
            <X className="h-4 w-4" strokeWidth={1.75} />
          </IconButton>
        </div>
      </div>

      {/* Canvas area */}
      <div
        ref={areaRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        className={cn(
          "flex-1 overflow-auto bg-surface-2",
          dragging ? "cursor-grabbing" : "cursor-grab select-none",
        )}
      >
        <div className="flex min-h-full min-w-full items-start justify-center p-4">
          <Document
            file={url}
            loading={
              <div className="flex h-[60vh] items-center justify-center text-sm text-ink-subtle">
                Loading drawing…
              </div>
            }
            error={<ViewerMessage>Could not render this PDF.</ViewerMessage>}
          >
            <Page
              pageNumber={currentPage}
              width={Math.round(fitWidth * zoom)}
              renderAnnotationLayer={false}
              renderTextLayer={false}
              loading={
                <div
                  className="animate-pulse rounded-md bg-surface"
                  style={{ height: "60vh", width: Math.round(fitWidth * zoom) }}
                />
              }
            />
          </Document>
        </div>
      </div>
    </div>
  );
}

function IconButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface hover:text-ink disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
    >
      {children}
    </button>
  );
}

function ViewerMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-64 items-center justify-center text-sm text-ink-subtle">
      {children}
    </div>
  );
}
