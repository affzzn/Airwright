"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { Pt } from "@/lib/construction/measureGeometry";

// Bundle the pdf.js worker locally (no external CDN — CSP-safe), as the viewer does.
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

/**
 * One drawing page with a clickable overlay, for the measuring tool. Everything is
 * kept in PDF points of the page as displayed (rotation included), so a distance is
 * the same at any zoom. Browser-only (react-pdf): loaded with `dynamic`, no SSR.
 */
export default function MeasureCanvas({
  url,
  page,
  zoom,
  points,
  closed,
  calibration,
  onClick,
}: {
  url: string;
  page: number;
  zoom: number;
  points: Pt[];
  closed: boolean;
  /** The two ends of a printed dimension, while checking the scale. */
  calibration: Pt[];
  onClick: (p: Pt, ptPerPx: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [baseW, setBaseW] = useState(900);
  const [vp, setVp] = useState<{ w: number; h: number } | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBaseW(Math.max(320, el.clientWidth - 24)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const width = Math.round(baseW * zoom);
  const ptPerPx = vp ? vp.w / width : 1;
  const toPt = (e: React.MouseEvent<SVGSVGElement>): Pt | null => {
    if (!vp) return null;
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * vp.w, ((e.clientY - r.top) / r.height) * vp.h];
  };
  const stroke = Math.max(1, 1.6 * ptPerPx);
  const dot = Math.max(2.5, 4 * ptPerPx);
  const path = (pts: Pt[]) => pts.map((p) => `${p[0]},${p[1]}`).join(" ");

  return (
    <div ref={box} className="h-full overflow-auto bg-surface p-3">
      <Document file={url} loading={<p className="p-6 text-sm text-ink-muted">Loading the drawing…</p>} error={<p className="p-6 text-sm text-ink">This drawing could not be opened.</p>}>
        <div className="relative inline-block border border-hairline bg-white" style={{ width }}>
          <Page
            pageNumber={page}
            width={width}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            onLoadSuccess={(p) => {
              const v = p.getViewport({ scale: 1 });
              setVp({ w: v.width, h: v.height });
            }}
          />
          {vp && (
            <svg
              className="absolute inset-0 h-full w-full cursor-crosshair"
              viewBox={`0 0 ${vp.w} ${vp.h}`}
              onClick={(e) => {
                const p = toPt(e);
                if (p) onClick(p, ptPerPx);
              }}
              onMouseMove={(e) => setHover(toPt(e))}
              onMouseLeave={() => setHover(null)}
            >
              {points.length > 1 && (
                <polyline points={path(closed ? [...points, points[0]] : points)} fill={closed ? "rgba(17,17,17,0.08)" : "none"} stroke="#111" strokeWidth={stroke} />
              )}
              {!closed && hover && points.length > 0 && (
                <line x1={points[points.length - 1][0]} y1={points[points.length - 1][1]} x2={hover[0]} y2={hover[1]} stroke="#111" strokeDasharray={`${4 * ptPerPx} ${3 * ptPerPx}`} strokeWidth={stroke} />
              )}
              {points.map((p, i) => (
                <circle key={i} cx={p[0]} cy={p[1]} r={i === 0 ? dot * 1.4 : dot} fill={i === 0 ? "#fff" : "#111"} stroke="#111" strokeWidth={stroke} />
              ))}
              {calibration.length > 0 && (
                <>
                  {calibration.length === 2 && <line x1={calibration[0][0]} y1={calibration[0][1]} x2={calibration[1][0]} y2={calibration[1][1]} stroke="#111" strokeWidth={stroke * 1.5} strokeDasharray={`${2 * ptPerPx} ${2 * ptPerPx}`} />}
                  {calibration.map((p, i) => (
                    <rect key={i} x={p[0] - dot} y={p[1] - dot} width={dot * 2} height={dot * 2} fill="#fff" stroke="#111" strokeWidth={stroke} />
                  ))}
                </>
              )}
            </svg>
          )}
        </div>
      </Document>
    </div>
  );
}
