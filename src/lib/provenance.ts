/**
 * Provenance builders — turn a stored extraction (the verbatim model output) plus
 * the engine's arithmetic into a human-readable, step-by-step "how this number
 * came to be" for every measurement on the review screen. Pure and framework-free
 * so it can be unit-tested and imported on the client.
 *
 * Two kinds of provenance:
 *   - READ / COUNTED: the model read (or counted) it off the drawing → show the
 *     printed dimension string, the sheet, and a resolvable page number.
 *   - COMPUTED: the engine derived it → show the arithmetic, each input traceable.
 *
 * Nothing here invents a source. A value with no cited sheet shows the value and
 * its confidence, and simply omits the page link.
 */

import { lowLevelQty, type ExtractionResult } from "@/lib/extract/schema";
import {
  STRUCTURE_DWELLINGS,
  STRUCTURE_LABEL,
  configFromStructure,
  isMultiHome,
  readPartyGables,
  resolveConfiguration,
  normalizeStructureForm,
  type DerivedConfiguration,
} from "@/lib/structure";
import { computeBirdcageFloor } from "@/lib/extract/birdcage";
import { computeHeight } from "@/lib/extract/height";
import { computeTimberFrameLifts, type BuildSystem } from "@/lib/takeoff/engine";

export interface ProvSource {
  sheet: string | null;
  dim: string | null;
  page: number | null;
}
export interface ProvStep {
  text: string;
  source?: ProvSource | null;
}
export interface ProvContent {
  title: string;
  /** One-line description of the method. */
  summary: string;
  method: "read" | "counted" | "computed";
  steps: ProvStep[];
  footnotes: string[];
  confidenceLabel: string | null;
  /** A short plain-language line explaining WHY the confidence is that level
   *  (shown under the label in the hover). Only set when there is a confidenceLabel. */
  reason?: string | null;
}

/**
 * A short plain-language line explaining WHY a measurement carries its confidence
 * level — shown under the label in the provenance hover. It always starts with the
 * level word so it reads clearly on its own. `detail` overrides the generic wording
 * when we know the specific reason (a divergent cross-check, a legend-wall fallback,
 * disagreeing lift counts…).
 */
export function confidenceReason(
  label: string | null | undefined,
  opts?: { method?: ProvContent["method"]; crossChecked?: boolean; detail?: string | null },
): string | null {
  if (!label) return null;
  if (opts?.detail) return opts.detail;
  const method = opts?.method ?? "read";
  switch (label) {
    case "high":
      return opts?.crossChecked
        ? "High — confirmed by a second, independent source on the drawing."
        : method === "counted"
          ? "High — clearly countable on the drawing."
          : "High — clearly legible on the drawing.";
    case "medium":
      return method === "computed"
        ? "Medium — derived from the drawing, but not independently cross-checked."
        : method === "counted"
          ? "Medium — counted, but a detail here is easy to miss — worth a glance."
          : "Medium — read directly off the plan, but not independently confirmed.";
    case "low":
      return "Low — hard to read or unverified. Please check this value against the drawing.";
    case "unknown":
      return "Unknown — not legible on the drawing. Please enter it manually.";
    default:
      return null;
  }
}

/** Birdcage-specific reason, keyed off the computed result so it always matches the label. */
function birdcageReason(r: {
  confidence: string;
  reconciled: boolean | null;
  usedLegendWall: boolean;
  assumedSymmetric: boolean;
}): string {
  switch (r.confidence) {
    case "high":
      return "High — the internal span is corroborated by the overall-minus-walls derivation.";
    case "medium":
      return r.assumedSymmetric
        ? "Medium — a wall was dimensioned on only one side, so the other was assumed equal."
        : "Medium — derived from the printed dimensions, with no second source to cross-check.";
    case "low":
      return r.reconciled === false
        ? "Low — the internal span and the overall-minus-walls check disagree. Check the dimensions."
        : r.usedLegendWall
          ? "Low — no structural wall was dimensioned, so the finished-face legend wall was used. Confirm."
          : "Low — please check this floor's dimensions against the drawing.";
    default:
      return "Unknown — no wall thickness to derive the footprint. Please enter the area manually.";
  }
}

export interface PageRef {
  pageNumber: number;
  sheetTitle: string | null;
}

const normalise = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const n2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Resolve a model sheet label (e.g. "Front Elevation") to a real document page
 * number, matched against the free classifier's per-page sheet titles and
 * restricted to the pages that were actually relevant to this extraction.
 * Returns null when it cannot be resolved — the caller then shows no page link.
 */
export function resolvePage(
  label: string | null | undefined,
  pages: PageRef[],
  allowed?: number[],
): number | null {
  if (!label) return null;
  const want = normalise(label);
  if (!want) return null;
  const inAllowed = (p: number) => !allowed || allowed.length === 0 || allowed.includes(p);

  // 1. Exact title match.
  for (const p of pages)
    if (p.sheetTitle && inAllowed(p.pageNumber) && normalise(p.sheetTitle) === want)
      return p.pageNumber;
  // 2. One contains the other (label ⊆ title or title ⊆ label).
  for (const p of pages) {
    if (!p.sheetTitle || !inAllowed(p.pageNumber)) continue;
    const t = normalise(p.sheetTitle);
    if (t && (t.includes(want) || want.includes(t))) return p.pageNumber;
  }
  return null;
}

const FACE: Record<string, string> = {
  front: "Front",
  rear: "Rear",
  left: "Left side",
  right: "Right side",
  other: "Other",
};

/** Looks like a raw millimetre dimension string ("5025", "9203")? */
const looksMm = (dim: string | null | undefined): boolean =>
  !!dim && /^\d{3,5}$/.test(dim.trim());

type Resolver = (
  label: string | null | undefined,
  sourcePage?: number | null,
) => number | null;

/**
 * The AI's originally-read value per measurement key — so the editor can show
 * "edited — AI read X" once a value has been corrected.
 */
export function aiMeasurementValues(raw: ExtractionResult): Record<string, number | null> {
  const apex = raw.elevations
    .map((e) => e.apexCount ?? 0)
    .reduce((a, b) => a + b, 0);
  const render = raw.elevations
    .filter((e) => e.rendered === true)
    .map((e) => e.renderLengthM ?? 0)
    .reduce((a, b) => a + b, 0);
  const floorArea = (level: "GF" | "FF" | "SF"): number | null => {
    const fa = raw.floorAreas.find((f) => f.level === level);
    if (!fa) return null;
    return computeBirdcageFloor({
      rectangles: fa.rectangles,
      readConfidence: fa.confidence,
    }).m2;
  };
  return {
    STOREYS: raw.storeys.value,
    HEIGHT_TO_SOFFIT: raw.heightToSoffitM.value,
    CORNER_COUNT: raw.cornerCount.value,
    GABLE_QTY: raw.elevations.length ? apex : null,
    RENDER_LENGTH: render > 0 ? n2(render) : null,
    BIRDCAGE_GF_M2: floorArea("GF"),
    BIRDCAGE_FF_M2: floorArea("FF"),
    BIRDCAGE_SF_M2: floorArea("SF"),
    LOW_LEVEL_QTY: lowLevelQty(raw.lowLevel),
  };
}

/** Build the provenance card for every measurement/detail the model reported. */
export function buildProvenanceCards(
  raw: ExtractionResult,
  resolve: Resolver,
  buildSystem: BuildSystem = "TRADITIONAL",
): Record<string, ProvContent> {
  const isTF = buildSystem === "TIMBER_FRAME";
  const cards: Record<string, ProvContent> = {};
  const src = (
    sheet: string | null | undefined,
    dim: string | null | undefined,
    sourcePage?: number | null,
  ): ProvSource => ({
    sheet: sheet ?? null,
    dim: dim ?? null,
    page: resolve(sheet, sourcePage),
  });

  // --- Storeys ---
  if (raw.storeys.value != null) {
    cards.STOREYS = {
      title: "Storeys",
      summary: "Read off the drawing",
      method: "read",
      steps: [
        {
          text: `${raw.storeys.value} storeys`,
          source: src(raw.storeys.sourceSheet, raw.storeys.sourceDimension, raw.storeys.sourcePage),
        },
      ],
      footnotes: [
        "Observed, not priced directly — it cross-checks the height-based lift count.",
      ],
      confidenceLabel: raw.storeys.confidence,
      reason: confidenceReason(raw.storeys.confidence, { method: "read" }),
    };
  }

  // --- Height to soffit (triangulated: direct read vs storey ladder) ---
  {
    const hr = computeHeight({
      directSoffitM: raw.heightToSoffitM.value,
      storeyHeightsM: raw.storeyHeightsM,
      storeys: raw.storeys.value,
      readConfidence: raw.heightToSoffitM.confidence,
    });
    if (hr.soffitM != null) {
      const dim = raw.heightToSoffitM.sourceDimension;
      const steps: ProvStep[] = [];
      if (hr.directM != null)
        steps.push({
          text: `Direct soffit read = ${hr.directM} m`,
          source: src(raw.heightToSoffitM.sourceSheet, dim, raw.heightToSoffitM.sourcePage),
        });
      if (raw.storeyHeightsM.length > 0)
        steps.push({ text: `Storey ladder ${raw.storeyHeightsM.join(" + ")} = ${hr.ladderSumM} m` });
      // The lift count differs by build system. `computeHeight`'s note assumes the
      // traditional ÷1.5 rule, so for timber frame swap in the 450 mm + 2 m result.
      const tfLifts = isTF
        ? computeTimberFrameLifts(raw.storeys.value, raw.roomInRoof.value === true, hr.soffitM)
        : null;
      if (isTF) {
        const agree = raw.storeyHeightsM.length > 0 && hr.directM != null && hr.reconciled === true;
        steps.push({
          text: `Soffit ${hr.soffitM} m${agree ? ` ✓ (storey ladder agrees)` : ""} → timber frame ${tfLifts?.lifts ?? "?"} lift${tfLifts?.lifts === 1 ? "" : "s"}`,
        });
      } else {
        steps.push({ text: hr.note });
        steps.push({ text: `Height to soffit = ${hr.soffitM} m` });
      }
      const foot = looksMm(dim)
        ? [`Converted from the printed millimetres: ${dim} → ${hr.directM} m.`]
        : [];
      cards.HEIGHT_TO_SOFFIT = {
        title: "Height to soffit",
        summary: hr.reconciled ? "Cross-checked against the storey ladder" : "Read off the U/S wallplate",
        method: raw.storeyHeightsM.length > 0 ? "computed" : "read",
        steps,
        footnotes: [
          ...foot,
          isTF
            ? `Timber frame: 450 mm off the soffit, then 2 m boarded lifts (not ÷1.5) → ${tfLifts?.lifts ?? "?"} lift${tfLifts?.lifts === 1 ? "" : "s"}. Datum = soffit / U/S wallplate.`
            : "The lift count divides this by 1.5 m. Datum = soffit / underside of wallplate (confirmed).",
        ],
        confidenceLabel: hr.confidence,
        reason:
          hr.confidence === "low"
            ? "Low — the direct read and the storey ladder imply different lift counts. Check the height."
            : confidenceReason(hr.confidence, {
                method: raw.storeyHeightsM.length > 0 ? "computed" : "read",
                crossChecked: hr.reconciled === true,
              }),
      };
    }
  }

  // --- Corners ---
  if (raw.cornerCount.value != null) {
    cards.CORNER_COUNT = {
      title: "Corners",
      summary: "Counted off the ground-floor plan",
      method: "counted",
      steps: [
        {
          text: `${raw.cornerCount.value} external corners / returns`,
          source: src(raw.cornerCount.sourceSheet, raw.cornerCount.sourceDimension, raw.cornerCount.sourcePage),
        },
      ],
      footnotes: [
        "External returns only. Each external corner adds a 1 m scaffold allowance.",
      ],
      confidenceLabel: raw.cornerCount.confidence,
      reason: confidenceReason(raw.cornerCount.confidence, { method: "counted" }),
    };
  }

  // --- Gables / apex (counted per elevation, summed) ---
  if (raw.elevations.length > 0) {
    const withApex = raw.elevations.filter((e) => (e.apexCount ?? 0) > 0);
    const total = raw.elevations.reduce((a, e) => a + (e.apexCount ?? 0), 0);
    const steps: ProvStep[] = withApex.map((e) => ({
      text: `${FACE[e.face] ?? e.face} elevation: ${e.apexCount} apex${e.apexReason ? ` — ${e.apexReason}` : ""}`,
      source: src(e.sourceSheet, e.sourceDimension, e.sourcePage),
    }));
    if (raw.roof.overallType === "HIPPED") {
      steps.push({ text: "Hip roof — no brickwork above the scaffold, so no apex." });
    } else {
      steps.push({
        text: `Total = ${total} apex → ${total} table lift${total === 1 ? "" : "s"} + ${total} apex handrail${total === 1 ? "" : "s"}`,
      });
    }
    cards.GABLE_QTY = {
      title: "Gables / apex",
      summary: "Counted per elevation",
      method: "counted",
      steps,
      footnotes: [
        "A table lift is an extra lift above the main scaffold to reach brickwork at a gable. A hip roof needs none.",
      ],
      confidenceLabel: raw.roof.confidence,
      reason: confidenceReason(raw.roof.confidence, { method: "counted" }),
    };
  }

  // --- Render length ---
  const rendered = raw.elevations.filter((e) => e.rendered === true);
  if (rendered.length > 0) {
    const total = rendered.reduce((a, e) => a + (e.renderLengthM ?? 0), 0);
    const steps: ProvStep[] = rendered.map((e) => ({
      text: `${FACE[e.face] ?? e.face} elevation: rendered ${e.renderLengthM ?? "?"} m`,
      source: src(e.sourceSheet, e.sourceDimension, e.sourcePage),
    }));
    if (rendered.length > 1) steps.push({ text: `Render length = ${n2(total)} m` });
    cards.RENDER_LENGTH = {
      title: "Render length",
      summary: "Measured across the rendered section only",
      method: "read",
      steps,
      footnotes: [
        "Render is a separate work type: only the rendered part of the wall is measured, and it is re-erected in 2 m boarded lifts (not 1.5 m).",
      ],
      confidenceLabel: rendered[0]?.confidence ?? null,
      reason: confidenceReason(rendered[0]?.confidence ?? null, { method: "read" }),
    };
  }

  // --- Birdcage per floor — the full derivation broken down step by step ---
  for (const [key, level] of [
    ["BIRDCAGE_GF_M2", "GF"],
    ["BIRDCAGE_FF_M2", "FF"],
    ["BIRDCAGE_SF_M2", "SF"],
  ] as const) {
    const fa = raw.floorAreas.find((f) => f.level === level);
    if (!fa) continue;
    const r = computeBirdcageFloor({
      rectangles: fa.rectangles,
      readConfidence: fa.confidence,
    });
    if (r.m2 == null) continue;
    const page = resolve(fa.sourceSheet, fa.sourcePage);
    const steps: ProvStep[] = [];
    const rects = fa.rectangles ?? [];
    const multi = rects.length > 1;

    // 1) Each rectangle: show how width and depth were read/derived, then area.
    rects.forEach((raw0, i) => {
      const rc = r.rectangles[i];
      if (!rc || rc.areaM2 == null) return;
      const tag = multi ? `Rect ${i + 1}: ` : "";
      // Per-side walls (mm→m); the engine subtracts each side, not 2× one wall.
      const wa = rc.wallWidthAMm != null ? rc.wallWidthAMm / 1000 : null;
      const wb = rc.wallWidthBMm != null ? rc.wallWidthBMm / 1000 : null;
      const da = rc.wallDepthAMm != null ? rc.wallDepthAMm / 1000 : null;
      const db = rc.wallDepthBMm != null ? rc.wallDepthBMm / 1000 : null;
      const w =
        rc.widthBasis === "internal"
          ? `internal width ${rc.widthM} m (read)`
          : `width ${rc.widthM} m (${raw0.overallWidthM} − ${wa} − ${wb})`;
      const d =
        rc.depthBasis === "internal"
          ? `internal depth ${rc.depthM} m (read)`
          : `depth ${rc.depthM} m (${raw0.overallDepthM} − ${da} − ${db})`;
      steps.push({
        text: `${tag}${w} × ${d} = ${rc.areaM2} m²`,
        source: {
          sheet: fa.sourceSheet ?? null,
          dim: raw0.sourceDimension ?? null,
          page: resolve(fa.sourceSheet, raw0.sourcePage) ?? page,
        },
      });
    });
    if (multi && r.derivedM2 != null)
      steps.push({ text: `Rectangles sum = ${r.derivedM2} m²` });

    // 2) The independent overall − walls cross-check of a printed internal footprint.
    if (r.crossCheckM2 != null && r.crossCheckM2 !== r.derivedM2)
      steps.push({ text: `Cross-check (overall − walls) = ${r.crossCheckM2} m²` });

    // 3) The reconciliation + the resolved number.
    steps.push({ text: r.note });
    steps.push({ text: `Birdcage (${level}) = ${r.m2} m²` });

    const levelName = { GF: "Ground floor", FF: "First floor", SF: "Second floor" }[level];
    const summary =
      r.reconciled === true
        ? "Derived from the internal dimensions, cross-checked against overall − walls"
        : "Derived from the internal dimensions";
    const footnotes = [
      `${levelName} internal deck. Birdcage = internal area inside the external walls (structural / blockwork face); one per floor, one lift each, summed for the total.`,
    ];
    if (r.usedLegendWall)
      footnotes.push(
        "No structural wall was dimensioned on the plan — the finished-face WALL LEGEND thickness was used to strip the overall dimension. Confirm.",
      );
    if (r.assumedSymmetric)
      footnotes.push(
        "A wall was dimensioned on only one side of an axis — the other side was assumed equal. Confirm.",
      );
    if (r.reconciled === false)
      footnotes.push(
        "The two independent reads disagree by more than the tolerance — the printed value was kept, but check the dimensions before pricing.",
      );
    cards[key] = {
      title: `Birdcage (${level})`,
      summary,
      method: r.source === "derived" ? "computed" : "read",
      steps,
      footnotes,
      confidenceLabel: r.confidence,
      reason: birdcageReason(r),
    };
  }

  // --- Low level (porches + single-storey bays; two-storey bays excluded) ---
  const ll = raw.lowLevel;
  if (
    ll.porchCanopyCount != null ||
    ll.porchSolidCount != null ||
    ll.baySingleStoreyCount != null ||
    ll.bayTwoStoreyCount != null
  ) {
    const canopy = ll.porchCanopyCount ?? 0;
    const solid = ll.porchSolidCount ?? 0;
    const bay1 = ll.baySingleStoreyCount ?? 0;
    const bay2 = ll.bayTwoStoreyCount ?? 0;
    const total = lowLevelQty(ll) ?? 0;
    const porchBits = [
      canopy > 0 ? `${canopy} canopy porch` : "",
      solid > 0 ? `${solid} solid porch` : "",
      bay1 > 0 ? `${bay1} single-storey bay` : "",
    ].filter(Boolean);
    const steps: ProvStep[] = [
      {
        text: porchBits.length
          ? `${porchBits.join(" + ")} = ${total} low-level scaffold${total === 1 ? "" : "s"}`
          : `${total} low-level scaffolds`,
      },
    ];
    if (bay2 > 0)
      steps.push({
        text: `${bay2} two-storey bay — full height, NOT a low level (excluded from the count).`,
      });
    const footnotes = [
      "Porches (canopy or solid) and single-storey bays each get a small tower, re-erected after the main scaffold is struck. Type is recorded so the treatment can change without re-reading.",
    ];
    if (bay2 > 0)
      footnotes.push("A two-storey bay rises the full height and is part of the main scaffold, not a low-level tower.");
    cards.LOW_LEVEL_QTY = {
      title: "Low-level",
      summary: "Counted off the elevations, by type",
      method: "counted",
      steps,
      footnotes,
      confidenceLabel: ll.confidence,
      reason: confidenceReason(ll.confidence, { method: "counted" }),
    };
  }

  // --- Roof type ---
  if (raw.roof.overallType != null) {
    cards.ROOF_TYPE = {
      title: "Roof type",
      summary: "Read from the elevations",
      method: "read",
      steps: [
        {
          text: `Roof: ${raw.roof.overallType.toLowerCase()}`,
          source: src(raw.roof.sourceSheet, null, raw.roof.sourcePage),
        },
      ],
      footnotes: [
        "Pitched (brickwork to the apex) needs a table lift; hipped slopes back on all sides and needs none.",
      ],
      confidenceLabel: raw.roof.confidence,
      reason: confidenceReason(raw.roof.confidence, { method: "read" }),
    };
  }

  // --- Structure ---
  if (raw.structure.form != null) {
    const label = STRUCTURE_LABEL[raw.structure.form];
    const foot =
      raw.structure.form === "APARTMENT_BLOCK"
        ? "Scaffolded as one whole building — the frontage is not divided per flat."
        : isMultiHome(raw.structure.form)
          ? "The take-off is per one house; the printed frontage is divided by the dwellings-wide count."
          : "One detached house — the full frontage is used.";
    cards.STRUCTURE = {
      title: "Structure",
      summary: "Read from the drawing",
      method: "read",
      steps: [{ text: label }],
      footnotes: [foot],
      confidenceLabel: raw.structure.confidence,
      reason: confidenceReason(raw.structure.confidence, { method: "read" }),
    };
  }

  // --- Room in roof ---
  if (raw.roomInRoof.value != null) {
    cards.ROOM_IN_ROOF = {
      title: "Room in roof",
      summary: "Read from the elevations",
      method: "read",
      steps: [
        { text: raw.roomInRoof.value ? "Room in the roof (2.5-storey)" : "No room in the roof" },
      ],
      footnotes: ["A room in the roof adds one lift and one birdcage floor."],
      confidenceLabel: raw.roomInRoof.confidence,
      reason: confidenceReason(raw.roomInRoof.confidence, { method: "read" }),
    };
  }

  // --- Rendered flag ---
  if (rendered.length > 0 || raw.elevations.length > 0) {
    cards.RENDERED = {
      title: "Rendered",
      summary: "Read from the elevations",
      method: "read",
      steps: [
        {
          text:
            rendered.length > 0
              ? `Rendered section on ${rendered.length} elevation${rendered.length === 1 ? "" : "s"}`
              : "No rendered section shown",
        },
      ],
      footnotes: ["Render is priced as a separate two-metre-lift adaption over the rendered length."],
      confidenceLabel: null,
    };
  }

  // --- Chimney ---
  if (raw.chimney.value != null) {
    cards.CHIMNEY = {
      title: "Chimney",
      summary: "Detected from the drawing",
      method: "read",
      steps: [
        {
          text: raw.chimney.value ? "Chimney stack drawn" : "No chimney drawn",
          source: src(raw.chimney.sourceSheet, null, raw.chimney.sourcePage),
        },
      ],
      footnotes: [
        "If a spec asks for a chimney scaffold but none is drawn, that is flagged rather than priced.",
      ],
      confidenceLabel: raw.chimney.confidence,
      reason: confidenceReason(raw.chimney.confidence, { method: "read" }),
    };
  }

  return cards;
}

/** Provenance for one wall segment's length (dimension → metres). */
export function wallProvenance(
  lengthM: number,
  dim: string | null,
  page: number | null = null,
): ProvContent {
  const foot = looksMm(dim)
    ? [`Converted from the printed millimetres: ${dim} → ${lengthM} m.`]
    : ["Taken off the building line (brickwork line) of the ground-floor plan."];
  return {
    title: "Wall length",
    summary: "Read off the ground-floor plan",
    method: "read",
    steps: [
      {
        text: `${lengthM} m`,
        source: { sheet: null, dim, page },
      },
    ],
    footnotes: foot,
    confidenceLabel: null,
  };
}

const POS_LABEL: Record<string, string> = {
  front: "Front",
  rear: "Rear",
  gable_left: "Gable (left)",
  gable_right: "Gable (right)",
  other: "Other",
};

/** Provenance for the plain perimeter (all wall lengths summed, before config). */
export function wallSumProvenance(
  walls: { position: string; lengthM: number }[],
  sumM: number,
): ProvContent {
  const steps: ProvStep[] = walls.map((w) => ({
    text: `${POS_LABEL[w.position] ?? w.position}: ${n2(w.lengthM)} m`,
  }));
  steps.push({ text: `Total = ${n2(sumM)} m` });
  return {
    title: "Wall lengths",
    summary: "Off the building line, ground-floor plan",
    method: "computed",
    steps,
    footnotes: [
      "This is the raw sum of every wall. The configuration (which walls apply) and the 1 m/corner allowance are applied per configuration in the computed take-off below.",
    ],
    confidenceLabel: null,
  };
}

/** Provenance for a configuration's perimeter (config walls + corners × lifts). */
export function perimeterProvenance(
  corners: number,
  cornerAllowanceM: number,
  wallsM: number,
  perLiftM: number,
  lifts: number | null,
  totalM: number | null,
): ProvContent {
  const steps: ProvStep[] = [
    { text: `Walls for this configuration = ${n2(wallsM)} m` },
    {
      text: `+ ${corners} corner${corners === 1 ? "" : "s"} × ${cornerAllowanceM} m = ${n2(perLiftM)} m per lift`,
    },
  ];
  if (lifts != null && totalM != null)
    steps.push({ text: `× ${lifts} lift${lifts === 1 ? "" : "s"} = ${n2(totalM)} m total` });
  return {
    title: "Perimeter",
    summary: "Config walls + corner allowance, per lift",
    method: "computed",
    steps,
    footnotes: [
      "Detached scaffolds 4 sides, semi/end 3, mid-terrace front + rear. Strike is keyed with the total; the per-lift figure drives the pay matrix.",
    ],
    confidenceLabel: null,
  };
}

const CONFIG_LABEL: Record<string, string> = {
  DETACHED: "Detached",
  SEMI_DETACHED: "Semi-detached",
  END_TERRACE: "End terrace",
  MID_TERRACE: "Mid-terrace",
};

/** Provenance for the party-wall line — its own unit-priced item (never grouped
 *  with the apex/table-lift items). One per non-detached house; removable per job. */
export function partyWallProvenance(
  config: string,
  include: boolean,
  qty: number,
): ProvContent {
  const detached = config === "DETACHED";
  const steps: ProvStep[] = [];
  if (detached) {
    steps.push({ text: "Detached → no party wall." });
  } else {
    steps.push({ text: `${CONFIG_LABEL[config] ?? config} → 1 party-wall scaffold` });
    if (!include) steps.push({ text: "Excluded on this job (opt-out) → 0." });
    steps.push({ text: `Result: ${qty} party wall${qty === 1 ? "" : "s"}` });
  }
  return {
    title: "Party wall",
    summary: "Its own unit-priced item",
    method: "computed",
    steps,
    footnotes: [
      "The party wall is the inside apex (apex shape, no rails) on a shared wall — a separate unit-priced spec item (£165 provisional), one per non-detached house.",
      "Removable per job with the toggle. It is NOT part of the apex / table-lift items.",
    ],
    confidenceLabel: null,
  };
}

const FLOOR_NAME: Record<string, string> = {
  GF: "Ground floor",
  FF: "First floor",
  SF: "Second floor",
  TF: "Third floor",
};

/** Provenance for the birdcage total — the internal decks summed (one lift each). */
export function birdcageTotalProvenance(
  floors: { level: string; m2: number }[],
  total: number,
): ProvContent {
  const steps: ProvStep[] = floors.map((f) => ({
    text: `${FLOOR_NAME[f.level] ?? f.level} = ${n2(f.m2)} m²`,
  }));
  steps.push({
    text: `Total = ${n2(total)} m² across ${floors.length} floor${floors.length === 1 ? "" : "s"} (1 lift each)`,
  });
  return {
    title: "Birdcage total",
    summary: "Internal decks summed, one lift per floor",
    method: "computed",
    steps,
    footnotes: [
      "Internal area inside the external walls, per floor. Per house — the same whatever the house type; never divided.",
    ],
    confidenceLabel: null,
  };
}

/** Provenance for the lift count. Traditional: height ÷ 1.5 with a storey
 *  cross-check. Timber frame: 450 mm off the soffit + 2 m boarded lifts, storey
 *  template primary (docs/18). The lift numbers are already computed by the engine
 *  and passed in — this only explains them. */
export function liftsProvenance(
  heightM: number | null,
  storeys: number | null,
  roomInRoof: boolean,
  heightLifts: number | null,
  storeyLifts: number | null,
  chosen: number | null,
  flag: boolean,
  buildSystem: BuildSystem = "TRADITIONAL",
): ProvContent {
  const steps: ProvStep[] = [];
  const isTF = buildSystem === "TIMBER_FRAME";
  if (isTF) {
    if (storeyLifts != null)
      steps.push({
        text: `Storey template: ${storeys}-storey → ${storeyLifts} lift${storeyLifts === 1 ? "" : "s"}`,
      });
    if (heightM != null)
      steps.push({
        text: `Height method (450 mm off soffit + 2 m lifts): ${heightM} m → ${heightLifts ?? "?"} lift${heightLifts === 1 ? "" : "s"}`,
      });
    steps.push({ text: `Result: ${chosen ?? "?"} lift${chosen === 1 ? "" : "s"}` });
  } else {
    if (heightM != null) {
      const base = Math.ceil(heightM / 1.5);
      steps.push({ text: `⌈${heightM} m ÷ 1.5 m⌉ = ${base} lift${base === 1 ? "" : "s"}` });
      if (roomInRoof) steps.push({ text: `+ 1 for the room in roof = ${heightLifts}` });
    }
    if (storeyLifts != null)
      steps.push({
        text: `Storey template cross-check: ${storeys}-storey → ${storeyLifts} lift${storeyLifts === 1 ? "" : "s"}`,
      });
    steps.push({ text: `Result: ${chosen ?? "?"} lift${chosen === 1 ? "" : "s"}` });
  }
  const footnotes = isTF
    ? [
        "Timber frame: 450 mm off the soffit is the top lift, then 2 m boarded lifts come down and the bottom “kicker” takes the rest. Every lift prices the same. Storey template is the primary rule (2-storey → 3, 2.5 → 4, 3 → 4).",
      ]
    : ["One lift ≈ 1.5 m of height, rounded up. The storey template is a cross-check."];
  if (flag)
    footnotes.push(
      isTF
        ? "The 450 mm + 2 m height method and the storey template disagree — the storey template wins; flagged for review (an unusual house height)."
        : "Height and storey template disagree — the template wins for whole storeys, height for a 2.5-storey. Flagged for review.",
    );
  return {
    title: "Lifts",
    summary: isTF ? "450 mm + 2 m lifts (timber frame)" : "Height ÷ 1.5, rounded up",
    method: "computed",
    steps,
    footnotes,
    confidenceLabel: null,
  };
}

// ── Timber-frame provenance (docs/18) — the review's TF take-off hovers ─────────

/** Adaption-lift count = total lifts − the 2.5-storey's short 1 m lift (docs/18). */
export function adaptionLiftsProvenance(
  totalLifts: number | null,
  adaptionLifts: number | null,
): ProvContent {
  const excluded =
    totalLifts != null && adaptionLifts != null && adaptionLifts < totalLifts;
  const steps: ProvStep[] = [{ text: `Total lifts (external scaffold) = ${totalLifts ?? "?"}` }];
  if (excluded)
    steps.push({ text: `− 1: the 2.5-storey's 1 m lift comes off before adaptions` });
  steps.push({ text: `Adaption lifts = ${adaptionLifts ?? "?"}` });
  return {
    title: "Adaption lifts",
    summary: excluded ? "Total lifts − the short 1 m lift" : "Every lift gets adaptions",
    method: "computed",
    steps,
    footnotes: [
      "Inside-board and hop-up adaptions are priced per adaption lift. On a 2.5-storey the extra 1 m lift is removed before any boards are adapted — it gets a scaffold lift but no adaptions (2→3, 2.5→3, 3→4).",
    ],
    confidenceLabel: null,
  };
}

/** Inside-board / hop-up adaption working (docs/18, Laura's revised email). */
export function tfAdaptionProvenance(
  kind: "inside-board" | "hop-up",
  perLiftM: number,
  adaptionLifts: number,
  lm: number,
  apexUnits: number,
): ProvContent {
  const liftsUsed = kind === "inside-board" ? adaptionLifts : Math.max(0, adaptionLifts - 1);
  const steps: ProvStep[] = [
    {
      text:
        kind === "inside-board"
          ? `${n2(perLiftM)} m/lift × ${liftsUsed} adaption lift${liftsUsed === 1 ? "" : "s"} = ${n2(lm)} LM`
          : `${n2(perLiftM)} m/lift × ${liftsUsed} lift${liftsUsed === 1 ? "" : "s"} (all except the 1st/kicker) = ${n2(lm)} LM`,
    },
  ];
  if (apexUnits > 0)
    steps.push({ text: `+ apex adaption × ${apexUnits} (unit — priced separately)` });
  return {
    title: kind === "inside-board" ? "Inside-board adaption" : "Hop-up adaption",
    summary:
      kind === "inside-board"
        ? "Perimeter × every adaption lift"
        : "Perimeter × adaption lifts, dropping the kicker",
    method: "computed",
    steps,
    footnotes: [
      kind === "inside-board"
        ? "Inside boards are adapted on every lift. Each apex is priced as its own unit (not converted to LM)."
        : "Hop-up brackets go on every lift except the bottom kicker. Each apex is priced as its own unit.",
    ],
    confidenceLabel: null,
  };
}

/** Where the apex count flows on timber frame — four unit-priced items (docs/18). */
export function tfApexProvenance(apexCount: number): ProvContent {
  return {
    title: "Apex",
    summary: "Feeds four unit-priced items",
    method: "computed",
    steps: [
      { text: `${apexCount} apex → apex scaffold (unit)` },
      { text: `${apexCount} apex → apex rails (unit)` },
      { text: `${apexCount} apex → inside-board apex adaption (unit)` },
      { text: `${apexCount} apex → hop-up apex adaption (unit)` },
    ],
    footnotes: [
      "On timber frame the apex is a unit cost across all four items (never converted to LM). Reduced by configuration — a semi/end drops the party-wall gable, a mid-terrace drops both.",
    ],
    confidenceLabel: null,
  };
}

/**
 * Provenance for the house-type CONFIGURATION (the plot's position in its block).
 * Configuration is the highest-leverage single field in the take-off — it decides
 * which walls are scaffolded (~50% of the perimeter), how many apexes survive and
 * whether there is a party wall — so it gets the same "how was this derived"
 * treatment as every measured field, including an explicit note when the drawing
 * only gives a DEFAULT rather than an answer.
 */
export function configurationProvenance(
  current: string,
  derived: DerivedConfiguration | null,
  structureForm: string | null,
  structureConfidence: string | null,
): ProvContent {
  const steps: ProvStep[] = [];
  // When the party walls decided it, lead with that — it is the direct reading; the
  // building type is then only the semi-vs-end tie-breaker.
  if (derived && (derived as { basis?: string }).basis === "party-walls")
    steps.push({ text: "Decided by the party walls read off the plan (not the building type)." });
  const form = normalizeStructureForm(structureForm, null);
  if (form) {
    const homes = STRUCTURE_DWELLINGS[form];
    steps.push({
      text: `Drawing reads: ${STRUCTURE_LABEL[form]}${homes ? ` — ${homes} home${homes === 1 ? "" : "s"} joined` : " — 4+ homes joined"}`,
    });
  } else {
    steps.push({ text: "The drawing's building type could not be read." });
  }
  if (derived) {
    steps.push({
      text: derived.certain
        ? `→ ${CONFIG_LABEL[derived.config] ?? derived.config} (determined by the drawing)`
        : `→ ${CONFIG_LABEL[derived.config] ?? derived.config} — a DEFAULT, not an answer`,
    });
    if (current !== derived.config)
      steps.push({
        text: `Changed on review to ${CONFIG_LABEL[current] ?? current}.`,
      });
  }
  const footnotes = [
    "Party walls read off the plan decide this where the drawing shows them; the building type is the fallback, and the tie-breaker between a semi and an end terrace (they take off identically).",
    "Configuration decides which walls are scaffolded (detached 4 sides · semi/end 3 · mid-terrace front+rear only), the corner allowance, how many apexes survive, and the party-wall item.",
    "Semi-detached and end terrace produce an identical take-off — the difference is labelling only.",
  ];
  if (derived && !derived.certain)
    footnotes.push("An uncertain derivation is flagged in Review flags — confirm it before pricing.");
  return {
    title: "House type (position in the block)",
    summary: derived?.certain ? "Read from the drawing's building type" : "Defaulted — needs confirming",
    method: "computed",
    steps,
    footnotes,
    confidenceLabel: structureConfidence,
    reason: derived?.reason ?? null,
  };
}

/** The inputs `configurationProvenance` needs, resolved from whichever source the
 *  take-off actually has: the verbatim model output first, else the basis the
 *  extractor stored on `warnings`, else no claim at all (legacy rows). Pure, so
 *  the review screen stays a thin wrapper over a tested function. */
export function configurationBasisFrom(
  raw: {
    structure?: { form: string | null; confidence: string };
    wallSegments?: { position: string; isPartyWall?: boolean | null }[];
  } | null,
  warnings: Record<string, unknown>,
): { derived: DerivedConfiguration | null; form: string | null; confidence: string | null } {
  if (raw?.structure)
    return {
      // Must use the SAME rule the extractor used when it set the value, or the
      // review screen would explain a different answer from the one on the record.
      derived: resolveConfiguration(
        normalizeStructureForm(raw.structure.form, null),
        raw.structure.confidence,
        readPartyGables(raw.wallSegments ?? []),
      ),
      form: raw.structure.form ?? null,
      confidence: raw.structure.confidence ?? null,
    };
  const b = warnings.configurationBasis;
  if (b && typeof b === "object" && !Array.isArray(b)) {
    const o = b as Record<string, unknown>;
    return {
      derived: {
        config: String(o.config ?? "DETACHED") as DerivedConfiguration["config"],
        certain: o.certain === true,
        reason: typeof o.reason === "string" ? o.reason : "",
        ...(o.basis === "party-walls" || o.basis === "structure" ? { basis: o.basis } : {}),
      } as DerivedConfiguration,
      form: typeof o.structure === "string" ? o.structure : null,
      confidence: typeof o.confidence === "string" ? o.confidence : null,
    };
  }
  return { derived: null, form: null, confidence: null };
}
