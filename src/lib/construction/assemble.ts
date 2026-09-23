/**
 * Construction enquiry reading (docs/20 §7) · Layer 2: fuse the drawing reader's
 * OBSERVATIONS (across all drawings) into draft picking-list lines + traceable
 * measurements, mapping each observation to a library element and CROSS-CHECKING
 * the client's call-off against the drawing. PURE (no Prisma, no SDK) + unit-tested.
 *
 * It does NO pricing (the server action resolves the rate on insert) and NEVER
 * invents a library item · an unmatched feature becomes a flagged one-off line.
 */

import type { DrawingConfidence, DrawingObservations, NumberField } from "./drawingSchema";
import type { ConstructionUnit, HeightBracket } from "./types";
import { HAKI_LIFTS, heightBracketFor } from "./rules";

/** The minimal library shape assemble needs (from `loadConstructionLibrary`). */
export interface AssembleLibEl {
  id: string;
  name: string;
  aliases: string[];
  unit: ConstructionUnit;
  usesLifts: boolean;
}

/** One draft line proposed from the drawings · same shape the apply path consumes. */
export interface DrawingDraftLine {
  elementId: string | null; // null = no library match → a flagged one-off
  description: string; // the picking-list item name (or the feature, if unmatched)
  unit: ConstructionUnit;
  quantity: number | null;
  lifts: number | null;
  heightBracket: HeightBracket | null;
  confidence: DrawingConfidence;
  note: string | null; // provenance + any cross-check flag
  needsItem: boolean; // true when nothing in the library matched
  /** Weeks of hire this line asks for, when the scope stated one per line. */
  hireWeeks?: number | null;
}

/** A traceable measurement (kept separate from the priced lines, docs/19 §3). */
export interface DrawingDraftMeasurement {
  label: string;
  kind: "PERIMETER_LM" | "BIRDCAGE_M2" | "HANDRAIL_LM" | "HEIGHT_M" | "AREA_LM";
  valueNumber: number;
  lifts: number | null;
  confidence: DrawingConfidence;
  note: string | null;
}

export interface AssembleResult {
  lines: DrawingDraftLine[];
  measurements: DrawingDraftMeasurement[];
  suggestedHeightBracket: HeightBracket | null;
  buildingHeightM: number | null;
  /** Door / fire-exit counts read off the drawings → the foam SUGGESTION (not a line). */
  accessPoints: { doorways: number; fireExits: number };
  flags: string[];
}

/** A client call-off (from the scope reader) to cross-check the drawing against. */
export interface CallOff {
  keyword: string; // matches an item, e.g. "lift gate", "external", "lv pit"
  quantity: number | null;
  lifts: number | null;
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Find the library element whose name or aliases contain any of the keywords. */
function matchEl(library: AssembleLibEl[], keywords: string[]): AssembleLibEl | null {
  const keys = keywords.map(norm);
  for (const el of library) {
    const hay = [norm(el.name), ...el.aliases.map(norm)];
    if (keys.some((k) => hay.some((h) => h.includes(k)))) return el;
  }
  return null;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const val = (f: NumberField): number | null =>
  f && f.value != null && Number.isFinite(f.value) && f.value > 0 ? round3(f.value) : null;
const posInt = (n: number | null | undefined): number | null => {
  if (n == null || !Number.isFinite(n)) return null;
  const t = Math.trunc(n);
  return t > 0 ? t : null;
};

/**
 * Assemble draft lines + measurements from all the drawings' observations.
 * `callOffs` (optional) are the client's stated numbers to cross-check against.
 */
export function assembleDrawingDraft(
  observations: DrawingObservations[],
  library: AssembleLibEl[],
  callOffs: CallOff[] = [],
): AssembleResult {
  const lines: DrawingDraftLine[] = [];
  const measurements: DrawingDraftMeasurement[] = [];
  const flags: string[] = [];

  const callOffFor = (keyword: string): CallOff | undefined =>
    callOffs.find((c) => norm(c.keyword).includes(norm(keyword)) || norm(keyword).includes(norm(c.keyword)));

  // Cross-check a drawing quantity against the client's call-off; return a note fragment.
  const crossCheck = (keyword: string, drawingQty: number | null, drawingLifts: number | null): string | null => {
    const co = callOffFor(keyword);
    if (!co) return null;
    const q = co.quantity;
    if (q != null && drawingQty != null && Math.abs(q - drawingQty) / Math.max(q, drawingQty) > 0.05)
      return `call-off ${q}${co.lifts ? ` / ${co.lifts} lifts` : ""} vs drawing ${drawingQty}${drawingLifts ? ` / ${drawingLifts} lifts` : ""} · verify`;
    if (co.lifts != null && drawingLifts != null && co.lifts !== drawingLifts)
      return `call-off ${co.lifts} lifts vs drawing ${drawingLifts} lifts · verify`;
    return null;
  };

  const add = (line: Omit<DrawingDraftLine, "needsItem"> & { needsItem?: boolean }) =>
    lines.push({ needsItem: line.elementId == null, ...line });

  // --- Building height → bracket + a measurement (from the elevation) --------
  let buildingHeightM: number | null = null;
  let heightConf: DrawingConfidence = "unknown";
  for (const o of observations) {
    const h = val(o.buildingHeightM);
    if (h != null && (buildingHeightM == null || o.buildingHeightM.confidence === "high")) {
      buildingHeightM = h;
      heightConf = o.buildingHeightM.confidence;
    }
  }
  if (buildingHeightM != null) {
    measurements.push({
      label: "Building height",
      kind: "HEIGHT_M",
      valueNumber: buildingHeightM,
      lifts: null,
      confidence: heightConf,
      note: "From elevation",
    });
  }
  const suggestedHeightBracket = heightBracketFor(buildingHeightM);

  // --- External / independent scaffold runs ---------------------------------
  const indEl = matchEl(library, ["independent scaffold", "working platform"]);
  for (const o of observations) {
    for (const r of o.externalRuns) {
      const q = val(r.lengthM);
      if (q == null) continue;
      const lifts = posInt(r.liftsMarked);
      const cc = crossCheck("external", q, lifts);
      if (cc) flags.push(`External scaffold: ${cc}`);
      measurements.push({
        label: `External perimeter${r.zone ? ` (${r.zone})` : ""}`,
        kind: "PERIMETER_LM",
        valueNumber: q,
        lifts,
        confidence: r.lengthM.confidence,
        note: r.lengthM.sourceDimension,
      });
      add({
        elementId: indEl?.id ?? null,
        description: indEl?.name ?? "Independent scaffold (external run)",
        unit: "LM_PER_LIFT",
        quantity: q,
        lifts,
        heightBracket: suggestedHeightBracket,
        confidence: r.lengthM.confidence,
        note: [`External run${r.zone ? ` · ${r.zone}` : ""}`, cc].filter(Boolean).join(" · ") || null,
      });
    }
  }

  // --- Birdcages / crash decks ----------------------------------------------
  const bcEl = matchEl(library, ["birdcage", "crash deck"]);
  for (const o of observations) {
    for (const b of o.birdcages) {
      const q = val(b.areaM2);
      if (q == null) continue;
      const lifts = posInt(b.liftsMarked);
      measurements.push({
        label: `Birdcage${b.zone ? ` (${b.zone})` : ""}`,
        kind: "BIRDCAGE_M2",
        valueNumber: q,
        lifts,
        confidence: b.areaM2.confidence,
        note: b.areaM2.sourceDimension,
      });
      add({
        elementId: bcEl?.id ?? null,
        description: bcEl?.name ?? "Internal birdcage (crash deck)",
        unit: "M2_PER_LIFT",
        quantity: q,
        lifts,
        heightBracket: null,
        confidence: b.areaM2.confidence,
        note: `Birdcage${b.zone ? ` · ${b.zone}` : ""}`,
      });
    }
  }

  // --- Roof edge protection (triple handrail) -------------------------------
  const tripleEl = matchEl(library, ["triple handrail", "roof edge"]);
  for (const o of observations) {
    const q = val(o.roofEdgePerimeterM);
    if (q == null) continue;
    const cc = crossCheck("edge protection", q, null);
    if (cc) flags.push(`Roof edge protection: ${cc}`);
    measurements.push({
      label: "Roof edge protection perimeter",
      kind: "HANDRAIL_LM",
      valueNumber: q,
      lifts: null,
      confidence: o.roofEdgePerimeterM.confidence,
      note: o.roofEdgePerimeterM.sourceDimension,
    });
    add({
      elementId: tripleEl?.id ?? null,
      description: tripleEl?.name ?? "Triple handrail (roof / edge)",
      unit: "LM",
      quantity: q,
      lifts: null,
      heightBracket: suggestedHeightBracket,
      confidence: o.roofEdgePerimeterM.confidence,
      note: ["Roof edge protection (default triple)", cc].filter(Boolean).join(" · "),
    });
  }

  // --- Haki stair towers (per lift, normally 3) ------------------------------
  const hakiEl = matchEl(library, ["haki", "hacky"]);
  for (const o of observations) {
    for (const h of o.hakiStairs) {
      const lifts = posInt(h.liftsMarked) ?? HAKI_LIFTS;
      add({
        elementId: hakiEl?.id ?? null,
        description: hakiEl?.name ?? "Haki stair tower",
        unit: "NR_PER_LIFT",
        quantity: 1,
        lifts,
        heightBracket: suggestedHeightBracket,
        confidence: "high",
        note: `${h.label}${h.liftsMarked == null ? " (Haki = 3 lifts)" : ""}`,
      });
    }
  }

  // --- Loading bays (per lift) ----------------------------------------------
  const lbEl = matchEl(library, ["loading bay"]);
  for (const o of observations) {
    for (const b of o.loadingBays) {
      add({
        elementId: lbEl?.id ?? null,
        description: lbEl?.name ?? "Loading bay",
        unit: "NR_PER_LIFT",
        quantity: 1,
        lifts: posInt(b.liftsMarked),
        heightBracket: suggestedHeightBracket,
        confidence: "high",
        note: b.label,
      });
    }
  }

  // --- Lift gates: one per entrance per floor, cross-checked -----------------
  const gateEl = matchEl(library, ["lift gate", "safegate"]);
  for (const o of observations) {
    for (const s of o.liftShafts) {
      const total = val(s.totalEntrances);
      if (total == null) continue;
      const cc = crossCheck(s.label, total, null) ?? crossCheck("lift gate", total, null);
      if (cc) flags.push(`${s.label}: ${cc}`);
      const breakdown = s.entrancesByFloor.map((e) => `${e.floor}:${e.count}`).join(", ");
      add({
        elementId: gateEl?.id ?? null,
        description: gateEl?.name ?? "Lift gate (Safegate)",
        unit: "NR",
        quantity: total,
        lifts: null,
        heightBracket: null,
        confidence: s.totalEntrances.confidence,
        note: [`${s.label} · entrances ${breakdown || "counted"}`, cc].filter(Boolean).join(" · "),
      });
    }
  }

  // --- LV pit edge protection (handrail) ------------------------------------
  const dblEl = matchEl(library, ["double handrail"]);
  for (const o of observations) {
    for (const p of o.lvPits) {
      const q = val(p.perimeterM);
      if (q == null) continue;
      const cc = crossCheck("lv", q, null);
      if (cc) flags.push(`${p.label}: ${cc}`);
      measurements.push({
        label: `LV pit perimeter (${p.label})`,
        kind: "HANDRAIL_LM",
        valueNumber: q,
        lifts: null,
        confidence: p.perimeterM.confidence,
        note: p.perimeterM.sourceDimension,
      });
      add({
        elementId: dblEl?.id ?? tripleEl?.id ?? null,
        description: dblEl?.name ?? "Double handrail",
        unit: "LM",
        quantity: q,
        lifts: null,
        heightBracket: suggestedHeightBracket,
        confidence: p.perimeterM.confidence,
        note: [`${p.label} edge protection · confirm double / triple`, cc].filter(Boolean).join(" · "),
      });
    }
  }

  // --- Building stairs (precast / straight / up-over / access) ---------------
  for (const o of observations) {
    for (const s of o.stairs) {
      const h = val(s.heightM);
      const p = val(s.perimeterM);
      // Edge protection wrapping the stair (precast/access) → handrail LM if a perimeter is known.
      if (p != null) {
        add({
          elementId: tripleEl?.id ?? dblEl?.id ?? null,
          description: tripleEl?.name ?? "Edge protection to stair",
          unit: "LM",
          quantity: p,
          lifts: null,
          heightBracket: suggestedHeightBracket,
          confidence: s.perimeterM.confidence,
          note: `${s.label} (${s.kind.toLowerCase()}) edge protection`,
        });
      } else {
        // A stair set (straight / up-over) with only a height → a flagged one-off for the estimator.
        add({
          elementId: null,
          description: `${s.label} · ${s.kind.replace("_", " ").toLowerCase()} stair set`,
          unit: "NR",
          quantity: null,
          lifts: null,
          heightBracket: null,
          confidence: s.heightM.confidence,
          note: [`${s.kind.toLowerCase()} stair set${h != null ? ` (~${h} m)` : ""}`, "needs a picking-list item / measure by hand"].join(" · "),
        });
      }
    }
  }

  // --- Foam: an INFORMATIONAL flag, NEVER an auto-priced line ----------------
  // Construction scope is matter-of-fact: price exactly what's asked (Ben). Foam is
  // Colin's judgment (schools / public), not something the drawing dictates, and the
  // door/exit count is noisy (it can pick up internal doors). So we surface the count
  // as a suggestion and let the estimator add foam by hand if the scope requires it.
  const doors = observations.reduce((a, o) => a + (val(o.accessPoints.doorways) ?? 0), 0);
  const exits = observations.reduce((a, o) => a + (val(o.accessPoints.fireExits) ?? 0), 0);
  if (Math.trunc(doors + exits) > 0) {
    flags.push(
      `Drawing shows ~${Math.trunc(doors)} doorway(s) + ${Math.trunc(exits)} fire exit(s) · add foam by hand if the scope requires it.`,
    );
  }

  // Any raster/no-text drawing → flag that its measurements are manual.
  if (observations.some((o) => !o.sheet.hasTextLayer)) {
    flags.push("One or more drawings are images with no dimensions · measure those by hand.");
  }

  // Collapse features reported identically by more than one drawing (docs/20 §13).
  const dd = dedupeLines(lines);
  if (dd.collapsed > 0)
    flags.push(`Collapsed ${dd.collapsed} duplicate line(s) reported by more than one drawing.`);

  return {
    lines: dd.lines,
    measurements,
    suggestedHeightBracket,
    buildingHeightM,
    accessPoints: { doorways: Math.trunc(doors), fireExits: Math.trunc(exits) },
    flags,
  };
}

/** Collapse lines reported identically (same element/unit/qty/lifts) by >1 drawing. */
function dedupeLines(lines: DrawingDraftLine[]): { lines: DrawingDraftLine[]; collapsed: number } {
  const seen = new Set<string>();
  const out: DrawingDraftLine[] = [];
  let collapsed = 0;
  for (const l of lines) {
    if (l.elementId == null) {
      out.push(l); // never collapse one-off / unmatched lines
      continue;
    }
    const key = `${l.elementId}|${l.unit}|${round3(l.quantity ?? 0)}|${l.lifts ?? ""}`;
    if (seen.has(key)) {
      collapsed++;
      continue;
    }
    seen.add(key);
    out.push(l);
  }
  return { lines: out, collapsed };
}

// --- Scope × drawing fusion (docs/20 §7) -----------------------------------

/** One mapped scope item from the text reader (a client's stated call-off). */
export interface ScopeItem {
  elementId: string | null;
  quantity: number | null;
  lifts: number | null;
  clientText: string;
  /** A real scope states hire PER LINE (docs/19 §1.6); carry it to the line. */
  hireWeeks?: number | null;
  location?: string | null;
  /** How the quantity was derived from the scope's dimension cell. */
  quantityBasis?: string | null;
}

/** Turn scope items into call-offs the drawing pass cross-checks against. */
export function callOffsFromScope(scopeItems: ScopeItem[], library: AssembleLibEl[]): CallOff[] {
  const out: CallOff[] = [];
  for (const s of scopeItems) {
    if (!s.elementId) continue;
    const el = library.find((e) => e.id === s.elementId);
    if (el) out.push({ keyword: el.name, quantity: s.quantity, lifts: s.lifts });
  }
  return out;
}

/**
 * Fuse the client's scope with the drawing draft: an item the scope ASKS FOR but
 * no drawing produced is appended as a flagged line (Ben: price exactly the scope).
 * Items already covered by a drawing line are skipped (the drawing holds the real
 * quantity); a null-mapped scope item is left to the scope reader's own review.
 * Returns ONLY the extra scope-only lines, deduped by element.
 */
export function scopeOnlyLines(
  drawingLines: DrawingDraftLine[],
  scopeItems: ScopeItem[],
  library: AssembleLibEl[],
): DrawingDraftLine[] {
  const covered = new Set(drawingLines.map((l) => l.elementId).filter(Boolean) as string[]);
  const seen = new Set<string>();
  const extra: DrawingDraftLine[] = [];
  for (const s of scopeItems) {
    if (!s.elementId || covered.has(s.elementId) || seen.has(s.elementId)) continue;
    const el = library.find((e) => e.id === s.elementId);
    if (!el) continue;
    seen.add(s.elementId);
    extra.push({
      elementId: el.id,
      description: el.name,
      unit: el.unit,
      quantity: s.quantity,
      lifts: el.usesLifts ? s.lifts : null,
      heightBracket: null,
      confidence: "low",
      hireWeeks: s.hireWeeks ?? null,
      note: [
        `From scope · "${s.clientText.trim()}"`,
        s.location ? `at ${s.location}` : null,
        s.quantityBasis,
        s.hireWeeks ? `${s.hireWeeks} week hire` : null,
        "not on a drawing, verify quantity",
      ]
        .filter(Boolean)
        .join(" · "),
      needsItem: false,
    });
  }
  return extra;
}
