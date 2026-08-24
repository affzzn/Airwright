import { prisma } from "@/lib/db";
import type { ExtractionResult } from "./schema";
import type { Prisma } from "@prisma/client";
import { computeBirdcageFloor } from "./birdcage";

type Conf = "high" | "medium" | "low" | "unknown";
const CONF_RANK: Record<Conf, number> = { unknown: 0, low: 1, medium: 2, high: 3 };

/** Map the AI confidence label to a 0-1 float for storage. */
function confToNumber(c: Conf): number {
  return { high: 0.95, medium: 0.7, low: 0.4, unknown: 0 }[c];
}

/** Worst-case confidence across parts — a derived total is only as good as its weakest input. */
function worstConf(cs: Conf[]): Conf {
  if (cs.length === 0) return "unknown";
  return cs.reduce((a, b) => (CONF_RANK[b] < CONF_RANK[a] ? b : a));
}

/**
 * Write a validated extraction into the take-off for its house type. Measurements
 * only (Layer 1): counts and dimensions read off the drawing, with provenance.
 * Lifts, perimeter totals, birdcage areas beyond length×width, and pricing are
 * NOT computed here — those are the deterministic engine (docs/11 §4).
 *
 * The house type is normally created up front by pack segmentation and linked on
 * the Extraction; if not (single-PDF fallback), we create it from the AI output.
 * Runs in a transaction so a partial write never leaves an orphan take-off.
 */
export async function persistExtraction(
  extractionId: string,
  result: ExtractionResult,
): Promise<{ houseTypeId: string; takeoffId: string }> {
  return prisma.$transaction(async (tx) => {
    const extraction = await tx.extraction.findUniqueOrThrow({
      where: { id: extractionId },
      include: {
        document: { include: { pack: { include: { project: true } } } },
      },
    });

    let houseTypeId = extraction.houseTypeId;

    // Fallback path (single PDF with no pre-segmented house type).
    if (!houseTypeId) {
      const project = extraction.document.pack.project;
      const name = result.houseType.name ?? `Unnamed (${extractionId.slice(0, 6)})`;
      const code = result.houseType.code ?? null;
      const existing = await tx.houseType.findFirst({
        where: code ? { projectId: project.id, code } : { projectId: project.id, name },
      });
      const houseType =
        existing ??
        (await tx.houseType.create({
          data: {
            projectId: project.id,
            clientId: project.clientId,
            name,
            code,
            buildType: result.buildType.value ?? undefined,
          },
        }));
      houseTypeId = houseType.id;
      await tx.extraction.update({
        where: { id: extractionId },
        data: { houseTypeId },
      });
    } else if (result.buildType.value) {
      // Fill in build type if segmentation didn't know it.
      await tx.houseType.update({
        where: { id: houseTypeId },
        data: { buildType: result.buildType.value },
      });
    }

    // Ensure a Takeoff exists; seed it from this extraction if not already seeded.
    const takeoff = await tx.takeoff.upsert({
      where: { houseTypeId },
      create: { houseTypeId, seedExtractionId: extractionId },
      update: {},
    });

    // Replace measurements/walls for a clean (re-)run.
    await tx.takeoffMeasurement.deleteMany({ where: { takeoffId: takeoff.id } });
    await tx.wallSegment.deleteMany({ where: { takeoffId: takeoff.id } });

    const measurements: Prisma.TakeoffMeasurementCreateManyInput[] = [];
    type Field = {
      value: number | null;
      confidence: Conf;
      sourceSheet?: string | null;
      sourceDimension?: string | null;
    };
    const push = (
      key: Prisma.TakeoffMeasurementCreateManyInput["key"],
      field: Field,
    ) => {
      measurements.push({
        takeoffId: takeoff.id,
        key,
        valueNumber: field.value ?? null,
        aiValue: field.value === null ? null : String(field.value),
        confidence: confToNumber(field.confidence),
        sourceSheet: field.sourceSheet ?? null,
        sourceDimension: field.sourceDimension ?? null,
        ambiguous: field.confidence === "low" || field.confidence === "unknown",
      });
    };
    // Only record optional fields when the model actually read a value, so the
    // review panel isn't cluttered with "—" rows for things that don't apply.
    const pushIf = (
      key: Prisma.TakeoffMeasurementCreateManyInput["key"],
      field: Field,
    ) => {
      if (field.value !== null && field.value !== undefined) push(key, field);
    };

    // --- Core, always shown ---
    push("STOREYS", result.storeys);
    push("HEIGHT_TO_SOFFIT", result.heightToSoffitM);

    // --- Apexes: total across elevations (= table-lift qty = apex-handrail qty) ---
    const apexParts = result.elevations
      .map((e) => e.apexCount)
      .filter((n): n is number => n !== null);
    const apexTotal = apexParts.length ? apexParts.reduce((a, b) => a + b, 0) : null;
    const apexConf = worstConf(
      result.elevations.filter((e) => e.apexCount !== null).map((e) => e.confidence),
    );
    // Hipped roof with no legible apex data still means zero apexes.
    const apexValue =
      apexTotal === null && result.roof.overallType === "HIPPED" ? 0 : apexTotal;
    push("GABLE_QTY", { value: apexValue, confidence: apexTotal === null && apexValue === 0 ? result.roof.confidence : apexConf });

    // --- Render: total LM across rendered faces ---
    const renderedFaces = result.elevations.filter((e) => e.rendered === true);
    const renderParts = renderedFaces
      .map((e) => e.renderLengthM ?? null)
      .filter((n): n is number => n !== null);
    if (renderParts.length) {
      pushIf("RENDER_LENGTH", {
        value: renderParts.reduce((a, b) => a + b, 0),
        confidence: worstConf(renderedFaces.map((e) => e.confidence)),
      });
    }

    // --- Birdcage m² per floor — the geometry (subtract/multiply/reconcile) is done
    //     deterministically in birdcage.ts, NOT by the model. The stored confidence is
    //     COMPUTED (does the derived footprint match the stated gross-internal area?). ---
    const BIRDCAGE_KEY: Record<string, Prisma.TakeoffMeasurementCreateManyInput["key"] | undefined> = {
      GF: "BIRDCAGE_GF_M2",
      FF: "BIRDCAGE_FF_M2",
      SF: "BIRDCAGE_SF_M2",
    };
    const dwellingsWide =
      result.dwellingsWide.value !== null && result.dwellingsWide.value >= 1
        ? result.dwellingsWide.value
        : 1;
    const birdcageDerivation: Prisma.JsonObject[] = [];
    for (const fa of result.floorAreas) {
      const key = BIRDCAGE_KEY[fa.level];
      if (!key) continue; // TF (4th floor) — extremely rare for housing; skip.
      const r = computeBirdcageFloor(
        {
          statedGrossInternalM2: fa.statedGrossInternalM2,
          statedNdssM2: fa.statedNdssM2 ?? null,
          rectangles: fa.rectangles,
          readConfidence: fa.confidence,
        },
        dwellingsWide,
      );
      if (r.m2 === null) continue;
      push(key, { value: r.m2, confidence: r.confidence, sourceSheet: fa.sourceSheet ?? null });
      birdcageDerivation.push({
        level: fa.level,
        m2: r.m2,
        source: r.source,
        derivedM2: r.derivedM2,
        statedM2: r.statedM2,
        ndssM2: r.ndssM2,
        reconciled: r.reconciled,
        confidence: r.confidence,
        usedDefaultWall: r.usedDefaultWall,
        note: r.note,
      });
    }

    // --- Low-level features (porches + bays) as a single count ---
    const lowLevelTotal =
      result.lowLevel.porchCount === null && result.lowLevel.bayCount === null
        ? null
        : (result.lowLevel.porchCount ?? 0) + (result.lowLevel.bayCount ?? 0);
    pushIf("LOW_LEVEL_QTY", { value: lowLevelTotal, confidence: result.lowLevel.confidence });

    push("CORNER_COUNT", result.cornerCount);

    if (measurements.length) {
      await tx.takeoffMeasurement.createMany({ data: measurements });
    }

    if (result.wallSegments.length) {
      await tx.wallSegment.createMany({
        data: result.wallSegments.map((w) => ({
          takeoffId: takeoff.id,
          position: w.position.toUpperCase() as Prisma.WallSegmentCreateManyInput["position"],
          label: w.label ?? null,
          lengthM: w.lengthM,
          aiLengthM: w.lengthM,
          confidence: confToNumber(w.confidence),
          sourceDimension: w.sourceDimension ?? null,
          ambiguous: w.confidence === "low" || w.confidence === "unknown",
        })),
      });
    }

    // Categorical facts + per-elevation provenance that don't fit a numeric
    // measurement row live on the take-off's warnings JSON (read by review).
    const warnings: Prisma.JsonObject = {};
    if (result.notes) warnings.notes = result.notes;
    if (result.dwellingsWide.value !== null && result.dwellingsWide.value >= 1)
      warnings.dwellingsWide = result.dwellingsWide.value;
    if (result.structure.form) warnings.structure = result.structure.form;
    if (result.roof.overallType) warnings.roofType = result.roof.overallType;
    if (result.roomInRoof.value !== null) warnings.roomInRoof = result.roomInRoof.value;
    if (renderedFaces.length > 0) warnings.rendered = true;
    else if (result.elevations.length > 0) warnings.rendered = false;
    if (result.chimney.value !== null) warnings.chimney = result.chimney.value;
    if (result.smartRoofPeakHeightM.value !== null)
      warnings.smartRoofPeakM = result.smartRoofPeakHeightM.value;
    if (result.elevations.length > 0) {
      warnings.elevations = result.elevations.map((e) => ({
        face: e.face,
        apexCount: e.apexCount,
        rendered: e.rendered,
        renderLengthM: e.renderLengthM ?? null,
      }));
    }
    // The step-by-step birdcage derivation (per floor) for the review tooltip.
    if (birdcageDerivation.length > 0) warnings.birdcageDerivation = birdcageDerivation;
    if (Object.keys(warnings).length) {
      await tx.takeoff.update({
        where: { id: takeoff.id },
        data: { warnings },
      });
    }

    return { houseTypeId, takeoffId: takeoff.id };
  });
}
