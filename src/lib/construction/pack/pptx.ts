/**
 * Construction pack ingest (docs/23 §5.6) — read a .pptx MARK-UP. Clients mark
 * where they want scaffold by drawing coloured shapes over a screenshot of the plan
 * in PowerPoint (CBAND: blue bands = "Internal & external scaffold", orange fill =
 * "Internal Crash Deck"). This module:
 *   - extracts each slide's text (the legend words);
 *   - re-draws each slide as ONE PDF page — the embedded plan image plus the
 *     coloured shapes (their vector paths) — so the vision reader sees exactly what
 *     the client drew. Used when the client did not also send a PDF export.
 *
 * Pure JS (fflate + pdf-lib), no rasteriser. OOXML is regular enough to read with
 * targeted regexes; group transforms and theme colours are approximated.
 */

import { unzipSync, strFromU8 } from "fflate";
import { PDFDocument, rgb, StandardFonts, type PDFPage } from "pdf-lib";

const EMU_PER_PT = 12700;

export interface PptxShape {
  kind: "FILL" | "BAND" | "LINE";
  colour: string | null; // hex
  /** Where the shape's box sits in the slide's largest picture, as fractions 0–1. */
  box: { left: number; right: number; top: number; bottom: number } | null;
  /** Corners on its outline (a fill that follows a building's walls has many). */
  vertices: number;
  lineWidthPt: number;
}

export interface PptxSlide {
  index: number; // 1-based
  text: string;
  shapeCount: number;
  imageCount: number;
  /** The drawn mark-up shapes (text boxes excluded). */
  shapes: PptxShape[];
}

const area = (b: { left: number; right: number; top: number; bottom: number }) => (b.right - b.left) * (b.bottom - b.top);

/**
 * A plain-words summary of what a mark-up slide's shapes are — the deterministic
 * fact the vision reader is given alongside the picture (a translucent fill over a
 * whole plan is easy for a model to mistake for the picture's own tint).
 */
export function describeMarkupShapes(slide: PptxSlide, allSlides: PptxSlide[] = []): string {
  if (!slide.shapes.length) return "No drawn shapes on this slide.";
  // The outermost band on any slide of this file traces the building's outside walls.
  const bands = allSlides.flatMap((sl) => sl.shapes.filter((sh) => sh.kind === "BAND" && sh.box).map((sh) => ({ sl, sh })));
  const outer = bands.sort((a, b) => area(b.sh.box!) - area(a.sh.box!))[0];
  const matchesOuter = (sh: PptxShape) =>
    Boolean(
      outer &&
        sh.box &&
        Math.abs(sh.box.left - outer.sh.box!.left) <= 0.05 &&
        Math.abs(sh.box.right - outer.sh.box!.right) <= 0.05 &&
        Math.abs(sh.box.top - outer.sh.box!.top) <= 0.05 &&
        Math.abs(sh.box.bottom - outer.sh.box!.bottom) <= 0.05,
    );
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const where = (sh: PptxShape) =>
    sh.box ? ` spanning ${pct(sh.box.left)}–${pct(sh.box.right)} across and ${pct(sh.box.top)}–${pct(sh.box.bottom)} down the plan picture` : "";
  const parts = slide.shapes.map((sh) => {
    const col = sh.colour ? `#${sh.colour}` : "a theme colour";
    if (sh.kind === "FILL")
      return `a FILLED area in ${col} with a ${sh.vertices}-corner outline,${where(sh)}${
        matchesOuter(sh) && outer!.sl !== slide ? ` — the same extent as the outer band around the building on slide ${outer!.sl.index}, so it fills the WHOLE interior` : ""
      }`;
    if (sh.kind === "BAND") return `a thick BAND (${sh.lineWidthPt.toFixed(0)} pt) in ${col},${where(sh)}`;
    return `a LINE in ${col}${where(sh)}`;
  });
  return `The slide's own drawing layer (from the .pptx) has ${slide.shapes.length} shape${slide.shapes.length === 1 ? "" : "s"}: ${parts.join("; ")}.`;
}

export interface PptxRead {
  slideCount: number;
  /** Slide size in points. */
  widthPt: number;
  heightPt: number;
  slides: PptxSlide[];
  /** All slide text joined (the legend words). */
  text: string;
  /** One page per slide: the plan image with the client's shapes drawn on it. */
  pdf: Buffer | null;
  notes: string[];
}

const num = (s: string | undefined | null, d = 0): number => {
  const n = Number(s);
  return Number.isFinite(n) ? n : d;
};

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#xA;/gi, "\n")
    .replace(/&amp;/g, "&");
}

function slideText(xml: string): string {
  const paras = xml.split(/<\/a:p>/).map((p) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1])).join(""));
  return paras.map((p) => p.trim()).filter(Boolean).join("\n");
}

/** Top-level shape/picture blocks of a slide, in drawing order. */
function blocks(xml: string): { tag: "pic" | "sp" | "cxnSp"; body: string }[] {
  const out: { tag: "pic" | "sp" | "cxnSp"; body: string }[] = [];
  // Pictures, shapes and connectors (straight / elbow lines drawn as a mark-up).
  const re = /<p:(pic|sp|cxnSp)>([\s\S]*?)<\/p:\1>/g;
  for (const m of xml.matchAll(re)) out.push({ tag: m[1] as "pic" | "sp" | "cxnSp", body: m[2] });
  return out;
}

function xfrm(body: string): { x: number; y: number; w: number; h: number } | null {
  const off = /<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>/.exec(body);
  const ext = /<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/.exec(body);
  if (!off || !ext) return null;
  return { x: num(off[1]) / EMU_PER_PT, y: num(off[2]) / EMU_PER_PT, w: num(ext[1]) / EMU_PER_PT, h: num(ext[2]) / EMU_PER_PT };
}

interface Paint {
  r: number;
  g: number;
  b: number;
  alpha: number;
  /** A theme colour we could not resolve (drawn mid-grey). */
  theme?: boolean;
}

/** The theme's named colours (accent1…, dk1…), so a `schemeClr` resolves to its real colour. */
let THEME: Map<string, string> = new Map();

function parseTheme(xml: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!xml) return map;
  const scheme = /<a:clrScheme[^>]*>([\s\S]*?)<\/a:clrScheme>/.exec(xml)?.[1] ?? "";
  for (const m of scheme.matchAll(/<a:(\w+)>\s*<a:(?:srgbClr val="([0-9A-Fa-f]{6})"|sysClr[^>]*lastClr="([0-9A-Fa-f]{6})")/g))
    map.set(m[1], (m[2] ?? m[3]).toUpperCase());
  // Slide colour maps alias these: bg1/tx1/bg2/tx2 → lt1/dk1/lt2/dk2.
  const alias: Record<string, string> = { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" };
  for (const [a, b] of Object.entries(alias)) if (map.has(b)) map.set(a, map.get(b)!);
  return map;
}

function colourIn(fragment: string | undefined): Paint | null {
  if (!fragment) return null;
  const scheme = /<a:schemeClr val="(\w+)"\s*(\/>|>([\s\S]*?)<\/a:schemeClr>)/.exec(fragment);
  if (scheme && THEME.has(scheme[1])) {
    const hex = THEME.get(scheme[1])!;
    const alpha = /<a:alpha val="(\d+)"/.exec(scheme[3] ?? "");
    return {
      r: parseInt(hex.slice(0, 2), 16) / 255,
      g: parseInt(hex.slice(2, 4), 16) / 255,
      b: parseInt(hex.slice(4, 6), 16) / 255,
      alpha: alpha ? num(alpha[1]) / 100000 : 1,
    };
  }
  const m = /<a:srgbClr val="([0-9A-Fa-f]{6})"\s*(\/>|>([\s\S]*?)<\/a:srgbClr>)/.exec(fragment);
  if (m) {
    const hex = m[1];
    const alpha = /<a:alpha val="(\d+)"/.exec(m[3] ?? "");
    return {
      r: parseInt(hex.slice(0, 2), 16) / 255,
      g: parseInt(hex.slice(2, 4), 16) / 255,
      b: parseInt(hex.slice(4, 6), 16) / 255,
      alpha: alpha ? num(alpha[1]) / 100000 : 1,
    };
  }
  // A theme colour we cannot resolve: draw it mid-grey rather than drop the shape.
  if (/<a:schemeClr/.test(fragment)) return { r: 0.45, g: 0.45, b: 0.45, alpha: 0.6, theme: true };
  return null;
}

/** The shape's fill and outline (spPr only — ignore the style fallbacks). */
function paints(body: string): { fill: Paint | null; line: Paint | null; lineW: number } {
  const spPr = /<p:spPr[^>]*>([\s\S]*?)<\/p:spPr>/.exec(body)?.[1] ?? "";
  // `<a:ln` exactly — NOT the `<a:lnTo>` path commands inside a custom geometry.
  const lnM = /<a:ln(?=[\s>])([^>]*)>([\s\S]*?)<\/a:ln>/.exec(spPr);
  const lnWidth = lnM ? /\bw="(\d+)"/.exec(lnM[1])?.[1] : undefined;
  const withoutLn = lnM ? spPr.replace(lnM[0], "") : spPr;
  const fill = /<a:noFill\s*\/>/.test(withoutLn) ? null : colourIn(/<a:solidFill>([\s\S]*?)<\/a:solidFill>/.exec(withoutLn)?.[1]);
  const lnBody = lnM?.[2] ?? "";
  const line = /<a:noFill\s*\/>/.test(lnBody) ? null : colourIn(/<a:solidFill>([\s\S]*?)<\/a:solidFill>/.exec(lnBody)?.[1]);
  return { fill, line, lineW: lnWidth ? num(lnWidth) / EMU_PER_PT : 1 };
}

/** A shape's geometry as an SVG path in points, relative to its own top-left. */
function shapePath(body: string, w: number, h: number): string | null {
  const cust = /<a:pathLst>([\s\S]*?)<\/a:pathLst>/.exec(body);
  if (!cust) {
    const prstLine = /<a:prstGeom prst="(line|straightConnector1|bentConnector\d|curvedConnector\d)"/.exec(body);
    if (prstLine) {
      const flipH = /<a:xfrm[^>]*flipH="1"/.test(body);
      const flipV = /<a:xfrm[^>]*flipV="1"/.test(body);
      const x0 = flipH ? w : 0;
      const x1 = flipH ? 0 : w;
      const y0 = flipV ? h : 0;
      const y1 = flipV ? 0 : h;
      return `M${x0} ${y0} L${x1} ${y1}`;
    }
    const prst = /<a:prstGeom prst="(\w+)"/.exec(body)?.[1];
    if (prst === "rect" || prst === "roundRect" || prst === "snipRect") return `M0 0 L${w} 0 L${w} ${h} L0 ${h} Z`;
    if (prst === "ellipse") {
      const rx = w / 2;
      const ry = h / 2;
      return `M0 ${ry} A${rx} ${ry} 0 1 0 ${w} ${ry} A${rx} ${ry} 0 1 0 0 ${ry} Z`;
    }
    return null;
  }
  const parts: string[] = [];
  for (const pm of cust[1].matchAll(/<a:path(?:\s+w="(\d+)")?(?:\s+h="(\d+)")?[^>]*>([\s\S]*?)<\/a:path>/g)) {
    const pw = num(pm[1], 0) || w * EMU_PER_PT;
    const ph = num(pm[2], 0) || h * EMU_PER_PT;
    const sx = w / pw;
    const sy = h / ph;
    const pt = (x: string, y: string) => `${(num(x) * sx).toFixed(2)} ${(num(y) * sy).toFixed(2)}`;
    for (const cm of pm[3].matchAll(/<a:(moveTo|lnTo|cubicBezTo|quadBezTo|arcTo|close)\b[^>]*?(?:\/>|>([\s\S]*?)<\/a:\1>)/g)) {
      const pts = [...(cm[2] ?? "").matchAll(/<a:pt x="(-?\d+)" y="(-?\d+)"\s*\/>/g)].map((p) => pt(p[1], p[2]));
      switch (cm[1]) {
        case "moveTo":
          if (pts[0]) parts.push(`M${pts[0]}`);
          break;
        case "lnTo":
          if (pts[0]) parts.push(`L${pts[0]}`);
          break;
        case "cubicBezTo":
          if (pts.length === 3) parts.push(`C${pts.join(" ")}`);
          break;
        case "quadBezTo":
          if (pts.length === 2) parts.push(`Q${pts.join(" ")}`);
          break;
        case "close":
          parts.push("Z");
          break;
        default:
          break; // arcTo: rare in hand-drawn free-forms; skipped
      }
    }
  }
  return parts.length ? parts.join(" ") : null;
}

function drawSlideText(page: PDFPage, font: Awaited<ReturnType<PDFDocument["embedFont"]>>, text: string, at: { x: number; y: number; w: number; h: number }, pageH: number) {
  const size = Math.max(9, Math.min(20, at.h * 0.6));
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return;
  page.drawText(line.slice(0, 80), { x: at.x + 4, y: pageH - at.y - at.h / 2 - size / 3, size, font, color: rgb(0, 0, 0) });
}

export async function readPptx(bytes: Uint8Array | Buffer): Promise<PptxRead> {
  const notes: string[] = [];
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(new Uint8Array(bytes));
  } catch {
    return { slideCount: 0, widthPt: 0, heightPt: 0, slides: [], text: "", pdf: null, notes: ["Could not open the .pptx"] };
  }
  const xmlOf = (path: string): string | null => (zip[path] ? strFromU8(zip[path]) : null);
  const pres = xmlOf("ppt/presentation.xml") ?? "";
  THEME = parseTheme(xmlOf("ppt/theme/theme1.xml"));
  const sz = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(pres);
  const pageW = sz ? num(sz[1]) / EMU_PER_PT : 960;
  const pageH = sz ? num(sz[2]) / EMU_PER_PT : 540;

  const slidePaths = Object.keys(zip)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => num(/(\d+)\.xml$/.exec(a)?.[1]) - num(/(\d+)\.xml$/.exec(b)?.[1]));

  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const slides: PptxSlide[] = [];

  for (const [i, path] of slidePaths.entries()) {
    const xml = xmlOf(path) ?? "";
    const rels = xmlOf(path.replace("slides/", "slides/_rels/").replace(/\.xml$/, ".xml.rels")) ?? "";
    const relTarget = (rid: string): string | null => {
      const m = new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels) ?? new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels);
      if (!m) return null;
      return ("ppt/slides/" + m[1]).replace(/[^/]+\/\.\.\//g, "");
    };

    const page = out.addPage([pageW, pageH]);
    let shapeCount = 0;
    let imageCount = 0;
    const shapes: PptxShape[] = [];
    let biggestPic: { x: number; y: number; w: number; h: number } | null = null;
    const shapeBoxes: { x: number; y: number; w: number; h: number }[] = [];
    for (const blk of blocks(xml)) {
      const box = xfrm(blk.body);
      if (!box) continue;
      if (blk.tag === "pic") {
        const rid = /<a:blip r:embed="(rId\d+)"/.exec(blk.body)?.[1];
        const target = rid ? relTarget(rid) : null;
        const data = target ? zip[target] : undefined;
        if (!data) continue;
        try {
          const img = /\.png$/i.test(target!) ? await out.embedPng(data) : /\.jpe?g$/i.test(target!) ? await out.embedJpg(data) : null;
          if (!img) {
            notes.push(`Slide ${i + 1}: image format not drawable (${target})`);
            continue;
          }
          page.drawImage(img, { x: box.x, y: pageH - box.y - box.h, width: box.w, height: box.h });
          imageCount++;
          if (!biggestPic || box.w * box.h > biggestPic.w * biggestPic.h) biggestPic = box;
        } catch {
          notes.push(`Slide ${i + 1}: an image could not be embedded`);
        }
        continue;
      }
      // A shape: its path, fill and outline; a text box also carries words.
      const { fill, line, lineW } = paints(blk.body);
      const path = shapePath(blk.body, box.w, box.h);
      const words = slideText(blk.body);
      if (path && (fill || line)) {
        page.drawSvgPath(path, {
          x: box.x,
          y: pageH - box.y,
          color: fill ? rgb(fill.r, fill.g, fill.b) : undefined,
          opacity: fill ? Math.min(0.55, fill.alpha) : undefined,
          borderColor: line ? rgb(line.r, line.g, line.b) : undefined,
          borderOpacity: line ? line.alpha : undefined,
          borderWidth: line ? Math.max(1, lineW) : 0,
        });
        shapeCount++;
        // A caption box (a shape carrying words) is a legend, not a mark-up.
        if (!words) {
          const hex = (c: Paint | null) =>
            c && !c.theme ? [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase() : null;
          shapes.push({
            // A thick stroke (≥ 6 pt) is a band drawn along walls; thin is a line.
            kind: fill ? "FILL" : lineW >= 6 ? "BAND" : "LINE",
            colour: hex(fill ?? line),
            box: null,
            vertices: (path.match(/[MLCQ]/g) ?? []).length,
            lineWidthPt: line ? lineW : 0,
          });
          shapeBoxes.push(box);
        }
      }
      if (words) drawSlideText(page, font, words, box, pageH);
    }
    if (biggestPic) {
      const pic = biggestPic;
      const f = (v: number) => Math.max(0, Math.min(1, Math.round(v * 100) / 100));
      shapes.forEach((sh, k) => {
        const b = shapeBoxes[k];
        sh.box = { left: f((b.x - pic.x) / pic.w), right: f((b.x + b.w - pic.x) / pic.w), top: f((b.y - pic.y) / pic.h), bottom: f((b.y + b.h - pic.y) / pic.h) };
      });
    }
    slides.push({ index: i + 1, text: slideText(xml), shapeCount, imageCount, shapes });
  }

  const pdf = slides.length ? Buffer.from(await out.save()) : null;
  return {
    slideCount: slides.length,
    widthPt: pageW,
    heightPt: pageH,
    slides,
    text: slides.map((s) => s.text).filter(Boolean).join("\n"),
    pdf,
    notes,
  };
}
