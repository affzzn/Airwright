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

import type { ExtractionResult } from "@/lib/extract/schema";

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

type Resolver = (label: string | null | undefined) => number | null;

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
    if (fa.internalAreaM2 != null) return n2(fa.internalAreaM2);
    if (fa.internalLengthM != null && fa.internalWidthM != null)
      return n2(fa.internalLengthM * fa.internalWidthM);
    return null;
  };
  const low =
    raw.lowLevel.porchCount == null && raw.lowLevel.bayCount == null
      ? null
      : (raw.lowLevel.porchCount ?? 0) + (raw.lowLevel.bayCount ?? 0);
  return {
    STOREYS: raw.storeys.value,
    HEIGHT_TO_SOFFIT: raw.heightToSoffitM.value,
    CORNER_COUNT: raw.cornerCount.value,
    GABLE_QTY: raw.elevations.length ? apex : null,
    RENDER_LENGTH: render > 0 ? n2(render) : null,
    BIRDCAGE_GF_M2: floorArea("GF"),
    BIRDCAGE_FF_M2: floorArea("FF"),
    BIRDCAGE_SF_M2: floorArea("SF"),
    LOW_LEVEL_QTY: low,
  };
}

/** Build the provenance card for every measurement/detail the model reported. */
export function buildProvenanceCards(
  raw: ExtractionResult,
  resolve: Resolver,
): Record<string, ProvContent> {
  const cards: Record<string, ProvContent> = {};
  const src = (sheet: string | null | undefined, dim: string | null | undefined): ProvSource => ({
    sheet: sheet ?? null,
    dim: dim ?? null,
    page: resolve(sheet),
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
          source: src(raw.storeys.sourceSheet, raw.storeys.sourceDimension),
        },
      ],
      footnotes: [
        "Observed, not priced directly — it cross-checks the height-based lift count.",
      ],
      confidenceLabel: raw.storeys.confidence,
    };
  }

  // --- Height to soffit ---
  if (raw.heightToSoffitM.value != null) {
    const dim = raw.heightToSoffitM.sourceDimension;
    const foot = looksMm(dim)
      ? [`Converted from the printed millimetres: ${dim} → ${raw.heightToSoffitM.value} m.`]
      : [];
    cards.HEIGHT_TO_SOFFIT = {
      title: "Height to soffit",
      summary: "Read off a vertical dimension",
      method: "read",
      steps: [
        {
          text: `Height to soffit = ${raw.heightToSoffitM.value} m`,
          source: src(raw.heightToSoffitM.sourceSheet, dim),
        },
      ],
      footnotes: [
        ...foot,
        "This is the height the lift count divides by (÷ 1.5 m). Datum (soffit / eaves / wall plate) is being confirmed with Colin.",
      ],
      confidenceLabel: raw.heightToSoffitM.confidence,
    };
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
          source: src(raw.cornerCount.sourceSheet, raw.cornerCount.sourceDimension),
        },
      ],
      footnotes: [
        "External returns only. Each corner adds a 1 m scaffold allowance (quantum being confirmed with Colin).",
      ],
      confidenceLabel: raw.cornerCount.confidence,
    };
  }

  // --- Gables / apex (counted per elevation, summed) ---
  if (raw.elevations.length > 0) {
    const withApex = raw.elevations.filter((e) => (e.apexCount ?? 0) > 0);
    const total = raw.elevations.reduce((a, e) => a + (e.apexCount ?? 0), 0);
    const steps: ProvStep[] = withApex.map((e) => ({
      text: `${FACE[e.face] ?? e.face} elevation: ${e.apexCount} apex`,
      source: src(e.sourceSheet, e.sourceDimension),
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
    };
  }

  // --- Render length ---
  const rendered = raw.elevations.filter((e) => e.rendered === true);
  if (rendered.length > 0) {
    const total = rendered.reduce((a, e) => a + (e.renderLengthM ?? 0), 0);
    const steps: ProvStep[] = rendered.map((e) => ({
      text: `${FACE[e.face] ?? e.face} elevation: rendered ${e.renderLengthM ?? "?"} m`,
      source: src(e.sourceSheet, e.sourceDimension),
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
    };
  }

  // --- Birdcage per floor ---
  for (const [key, level] of [
    ["BIRDCAGE_GF_M2", "GF"],
    ["BIRDCAGE_FF_M2", "FF"],
    ["BIRDCAGE_SF_M2", "SF"],
  ] as const) {
    const fa = raw.floorAreas.find((f) => f.level === level);
    if (!fa) continue;
    const page = resolve(fa.sourceSheet);
    let steps: ProvStep[];
    let method: ProvContent["method"];
    let summary: string;
    if (fa.internalAreaM2 != null) {
      steps = [
        {
          text: `Stated internal area (GIA) = ${n2(fa.internalAreaM2)} m²`,
          source: { sheet: fa.sourceSheet ?? null, dim: null, page },
        },
      ];
      method = "read";
      summary = "Taken from the stated floor area";
    } else if (fa.internalLengthM != null && fa.internalWidthM != null) {
      steps = [
        {
          text: `Internal ${fa.internalLengthM} m × ${fa.internalWidthM} m`,
          source: { sheet: fa.sourceSheet ?? null, dim: null, page },
        },
        { text: `= ${n2(fa.internalLengthM * fa.internalWidthM)} m²` },
      ];
      method = "computed";
      summary = "Internal length × width";
    } else {
      continue;
    }
    const levelName = { GF: "Ground floor", FF: "First floor", SF: "Second floor" }[level];
    cards[key] = {
      title: `Birdcage (${level})`,
      summary,
      method,
      steps,
      footnotes: [
        `${levelName} internal deck. Birdcage = internal area inside the external walls; one per floor, one lift each, summed for the total.`,
      ],
      confidenceLabel: fa.confidence,
    };
  }

  // --- Low level (porch + bay) ---
  const { porchCount, bayCount } = raw.lowLevel;
  if (porchCount != null || bayCount != null) {
    const p = porchCount ?? 0;
    const b = bayCount ?? 0;
    cards.LOW_LEVEL_QTY = {
      title: "Low-level",
      summary: "Counted off the elevations",
      method: "counted",
      steps: [{ text: `${p} porch + ${b} bay window = ${p + b} low-level scaffold${p + b === 1 ? "" : "s"}` }],
      footnotes: [
        "Porches and bay windows each get a small tower, re-erected after the main scaffold is struck. Unit-priced.",
      ],
      confidenceLabel: raw.lowLevel.confidence,
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
          source: src(raw.roof.sourceSheet, null),
        },
      ],
      footnotes: [
        "Pitched (brickwork to the apex) needs a table lift; hipped slopes back on all sides and needs none.",
      ],
      confidenceLabel: raw.roof.confidence,
    };
  }

  // --- Structure ---
  if (raw.structure.form != null) {
    const label = {
      SINGLE: "Single dwelling",
      PAIR_OR_TERRACE: "Pair / terrace of houses",
      APARTMENT_BLOCK: "Apartment block",
    }[raw.structure.form];
    const foot =
      raw.structure.form === "APARTMENT_BLOCK"
        ? "Scaffolded as one whole building — the frontage is not divided per flat."
        : raw.structure.form === "PAIR_OR_TERRACE"
          ? "The take-off is per one house; the printed frontage is divided by the dwellings-wide count."
          : "One detached dwelling — the full frontage is used.";
    cards.STRUCTURE = {
      title: "Structure",
      summary: "Read from the drawing",
      method: "read",
      steps: [{ text: label }],
      footnotes: [foot],
      confidenceLabel: raw.structure.confidence,
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
          source: src(raw.chimney.sourceSheet, null),
        },
      ],
      footnotes: [
        "If a spec asks for a chimney scaffold but none is drawn, that is flagged rather than priced.",
      ],
      confidenceLabel: raw.chimney.confidence,
    };
  }

  return cards;
}

/** Provenance for one wall segment's length (dimension → metres). */
export function wallProvenance(lengthM: number, dim: string | null): ProvContent {
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
        source: { sheet: null, dim, page: null },
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

/** Provenance for the lift count (height ÷ 1.5, storey cross-check). */
export function liftsProvenance(
  heightM: number | null,
  storeys: number | null,
  roomInRoof: boolean,
  heightLifts: number | null,
  storeyLifts: number | null,
  chosen: number | null,
  flag: boolean,
): ProvContent {
  const steps: ProvStep[] = [];
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
  const footnotes = [
    "One lift ≈ 1.5 m of height, rounded up. The storey template is a cross-check.",
  ];
  if (flag)
    footnotes.push(
      "Height and storey template disagree — the template wins for whole storeys, height for a 2.5-storey. Flagged for review.",
    );
  return {
    title: "Lifts",
    summary: "Height ÷ 1.5, rounded up",
    method: "computed",
    steps,
    footnotes,
    confidenceLabel: null,
  };
}
