"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Check, Loader2, Minus, Plus, Ruler, Undo2, X } from "lucide-react";
import { signConstructionAttachment } from "@/server/actions/construction";
import type { ConstructionQuoteVM, SheetRef } from "@/server/construction";
import { calibrate, measure, metresPerPoint, scaleDenominator, snapOrtho, type Pt } from "@/lib/construction/measureGeometry";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const MeasureCanvas = dynamic(() => import("./measure-canvas"), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-ink-muted">Loading the drawing…</p>,
});

/**
 * The measuring tool (2026-10-02): click around the corners on the drawing; code
 * turns the clicks into metres with the drawing's scale. The scale comes from the
 * title block ("1:50"); measuring one printed dimension checks it (or sets it, when
 * there is none — a photo-only plan). Lines snap level / plumb by default.
 *   outline — a closed shape: the perimeter, its outside corners (and area);
 *   run     — an open line: its length;
 *   area    — a closed shape: its area.
 */

export interface MeasureTarget {
  label: string;
  mode: "outline" | "run" | "area";
  buildingId: string | null;
}

export interface MeasureOutcome {
  lengthM: number;
  areaM2: number | null;
  corners: number | null;
  closed: boolean;
  sheetRef: SheetRef;
  provenance: string[];
  scaleNote: string;
}

export function MeasureDialog({
  open,
  onClose,
  quote,
  target,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  quote: ConstructionQuoteVM;
  target: MeasureTarget;
  onDone: (o: MeasureOutcome) => Promise<void> | void;
}) {
  // The drawings that can be measured: PDF pages, the target building's plans first.
  const sheets = useMemo(() => {
    const pdf = new Set(quote.attachments.filter((a) => /pdf/i.test(a.mimeType) || /\.pdf$/i.test(a.fileName)).map((a) => a.id));
    const rank = (s: ConstructionQuoteVM["sheets"][number]) =>
      (s.buildingId === target.buildingId ? 0 : 10) + (s.kind === "PLAN" ? 0 : s.kind === "ROOF_PLAN" ? 1 : s.kind === "MARKUP" ? 2 : 5) + (s.level === "GF" ? 0 : 0.5);
    return quote.sheets
      .filter((s) => pdf.has(s.attachmentId) && !s.superseded && (s.bucket === "CORE" || s.bucket === "CONTEXT"))
      .sort((a, b) => rank(a) - rank(b));
  }, [quote.attachments, quote.sheets, target.buildingId]);
  const loose = useMemo(
    () => (sheets.length ? [] : quote.attachments.filter((a) => /pdf/i.test(a.mimeType) || /\.pdf$/i.test(a.fileName))),
    [sheets.length, quote.attachments],
  );

  const [sheetId, setSheetId] = useState<string>("");
  const sheet = sheets.find((s) => s.id === sheetId) ?? null;
  const attachmentId = sheet?.attachmentId ?? (sheetId.startsWith("att:") ? sheetId.slice(4) : null);
  const page = sheet?.page ?? 1;
  const title = sheet ? `${sheet.drawingNo ? `${sheet.drawingNo} ` : ""}${sheet.title ?? ""}`.trim() : (loose.find((a) => `att:${a.id}` === sheetId)?.fileName ?? "");
  const titleDen = scaleDenominator(sheet?.scale);

  const [url, setUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [points, setPoints] = useState<Pt[]>([]);
  const [closed, setClosed] = useState(false);
  const [ortho, setOrtho] = useState(true);
  const [calib, setCalib] = useState<Pt[] | null>(null); // null = not checking
  const [calibValue, setCalibValue] = useState("");
  const [mPerPt, setMPerPt] = useState<number | null>(null);
  const [scaleNote, setScaleNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSheetId((cur) => cur || sheets[0]?.id || (loose[0] ? `att:${loose[0].id}` : ""));
  }, [open, sheets, loose]);
  useEffect(() => {
    setPoints([]);
    setClosed(false);
    setCalib(null);
    setZoom(1);
    setError(null);
    if (titleDen) {
      setMPerPt(metresPerPoint(titleDen));
      setScaleNote(`1:${titleDen} from the title block`);
    } else {
      setMPerPt(null);
      setScaleNote("");
    }
    if (!attachmentId) return;
    setUrl(null);
    void signConstructionAttachment(attachmentId).then((r) => setUrl(r.url));
  }, [attachmentId, page, titleDen]);

  const needClosed = target.mode !== "run";
  const result = mPerPt && points.length >= 2 ? measure(points, closed, mPerPt) : null;

  const click = (p: Pt, ptPerPx: number) => {
    if (calib) {
      if (calib.length < 2) setCalib([...calib, p]);
      return;
    }
    if (closed) return;
    // Close the shape by clicking near the first point.
    if (points.length >= 3 && Math.hypot(p[0] - points[0][0], p[1] - points[0][1]) < 14 * ptPerPx) {
      setClosed(true);
      return;
    }
    setPoints([...points, ortho ? snapOrtho(points[points.length - 1] ?? null, p) : p]);
  };

  const applyCalibration = () => {
    if (!calib || calib.length < 2) return;
    const raw = Number(calibValue.replace(/,/g, ""));
    // A printed dimension is in millimetres ("20,793"); a small number is metres.
    const realM = raw > 200 ? raw / 1000 : raw;
    const c = calibrate(calib[0], calib[1], realM, titleDen);
    if (!c) return setError("Click both ends of a printed dimension, then type its value.");
    setMPerPt(c.mPerPt);
    setScaleNote(
      c.offBy == null
        ? `set from the printed ${calibValue} (no scale in the title block)`
        : c.offBy <= 0.01
          ? `1:${titleDen} — checked against the printed ${calibValue} (within ${(c.offBy * 100).toFixed(1)}%)`
          : `set from the printed ${calibValue} — the title block's 1:${titleDen} was ${(c.offBy * 100).toFixed(0)}% off`,
    );
    setCalib(null);
    setCalibValue("");
    setError(null);
  };

  const done = async () => {
    if (!result || !attachmentId) return;
    if (needClosed && !closed) return setError("Close the shape: click the first point again.");
    setSaving(true);
    const kind = closed ? `closed outline, ${result.sides.length} sides` : `run of ${result.sides.length} side${result.sides.length === 1 ? "" : "s"}`;
    const provenance = [
      `${title}${page > 1 ? ` (page ${page})` : ""}: measured — ${kind}: ${result.sides.map((s) => s.toFixed(2)).join(" + ")} = ${result.lengthM} m`,
      `Scale: ${scaleNote}`,
      ...(target.mode === "area" && result.areaM2 != null ? [`Area of the shape: ${result.areaM2} m²`] : []),
    ];
    try {
      await onDone({
        lengthM: result.lengthM,
        areaM2: result.areaM2,
        corners: result.externalCorners,
        closed,
        sheetRef: { sheetId: sheet?.id ?? `att:${attachmentId}`, attachmentId, page, title, points, closed },
        provenance,
        scaleNote,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the measurement.");
    } finally {
      setSaving(false);
    }
  };

  const headline =
    target.mode === "area"
      ? result?.areaM2 != null
        ? `${result.areaM2} m²`
        : "—"
      : result
        ? `${result.lengthM} m${closed && result.externalCorners != null ? ` · ${result.externalCorners} outside corners` : ""}`
        : "—";

  return (
    <Modal open={open} onClose={onClose} label={`Measure: ${target.label}`} className="h-[92vh] max-w-[1400px]">
      <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-3">
        <Ruler className="h-4 w-4 text-ink-muted" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">Measure: {target.label}</p>
          <p className="text-[11px] text-ink-muted">
            {calib
              ? "Checking the scale: click both ends of a printed dimension, then type its value."
              : target.mode === "run"
                ? "Click along the run, corner by corner."
                : "Click around the outside, corner by corner. Click the first point again to close the shape."}
          </p>
        </div>
        <Select value={sheetId} onChange={(e) => setSheetId(e.target.value)} className="h-9 max-w-[22rem] text-xs" aria-label="Drawing">
          {sheets.map((s) => (
            <option key={s.id} value={s.id}>
              {`${s.drawingNo ? `${s.drawingNo} ` : ""}${s.title ?? ""}`.trim() || s.kind} {s.scale ? `· ${s.scale}` : "· no scale"}
            </option>
          ))}
          {loose.map((a) => (
            <option key={a.id} value={`att:${a.id}`}>
              {a.fileName}
            </option>
          ))}
        </Select>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-ink-subtle hover:bg-surface hover:text-ink">
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2 text-xs">
        <Button size="sm" variant="secondary" className="gap-1" onClick={() => setZoom((z) => Math.max(0.5, z / 1.4))} aria-label="Zoom out">
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <span className="w-12 text-center tabular-nums text-ink-muted">{Math.round(zoom * 100)}%</span>
        <Button size="sm" variant="secondary" className="gap-1" onClick={() => setZoom((z) => Math.min(8, z * 1.4))} aria-label="Zoom in">
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <label className="ml-2 flex items-center gap-1.5 text-ink">
          <input type="checkbox" checked={ortho} onChange={(e) => setOrtho(e.target.checked)} className="h-3.5 w-3.5 accent-black" />
          Square lines
        </label>
        <Button size="sm" variant="secondary" className="gap-1" disabled={!points.length} onClick={() => (closed ? setClosed(false) : setPoints(points.slice(0, -1)))}>
          <Undo2 className="h-3.5 w-3.5" /> Undo
        </Button>
        <Button size="sm" variant="secondary" disabled={!points.length} onClick={() => (setPoints([]), setClosed(false))}>
          Clear
        </Button>
        <Button size="sm" variant={calib ? "primary" : "secondary"} onClick={() => setCalib(calib ? null : [])}>
          {titleDen ? "Check the scale" : "Set the scale"}
        </Button>
        {calib && calib.length === 2 && (
          <span className="flex items-center gap-1.5">
            <input
              autoFocus
              value={calibValue}
              onChange={(e) => setCalibValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyCalibration()}
              placeholder="printed value, e.g. 20793"
              className="h-8 w-44 rounded-md border border-hairline-strong px-2 text-xs"
            />
            <Button size="sm" onClick={applyCalibration}>
              Use
            </Button>
          </span>
        )}
        <span className={cn("ml-auto text-[11px]", mPerPt ? "text-ink-muted" : "font-semibold text-ink")}>
          {mPerPt ? `Scale: ${scaleNote}` : "No scale on this drawing — set it from a printed dimension first."}
        </span>
      </div>

      <div className="min-h-0 flex-1">
        {url ? (
          <MeasureCanvas url={url} page={page} zoom={zoom} points={points} closed={closed} calibration={calib ?? []} onClick={click} />
        ) : (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the drawing…
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-hairline px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold tabular-nums text-ink">{headline}</p>
          {result && (
            <p className="truncate text-[11px] tabular-nums text-ink-muted" title={result.sides.join(" + ")}>
              {result.sides.map((s) => s.toFixed(2)).join(" + ")} m
            </p>
          )}
          {error && <p className="text-xs text-ink">{error}</p>}
        </div>
        <Button onClick={done} disabled={saving || !result || !mPerPt || (needClosed && !closed)} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Use this measurement
        </Button>
      </div>
    </Modal>
  );
}
