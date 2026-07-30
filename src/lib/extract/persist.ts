import { prisma } from "@/lib/db";
import type { ExtractionResult } from "./schema";
import type { Prisma } from "@prisma/client";

/** Map the AI confidence label to a 0-1 float for storage. */
function confToNumber(c: "high" | "medium" | "low" | "unknown"): number {
  return { high: 0.95, medium: 0.7, low: 0.4, unknown: 0 }[c];
}

/**
 * Turn a validated extraction into DB rows: ensure a HouseType + Takeoff exist,
 * then write the measurements and wall segments as the review/provenance layer.
 * Runs inside a transaction so a partial write never leaves an orphan Takeoff.
 */
export async function persistExtraction(
  extractionId: string,
  projectId: string,
  clientId: string,
  result: ExtractionResult,
): Promise<{ houseTypeId: string; takeoffId: string }> {
  return prisma.$transaction(async (tx) => {
    // 1. Find or create the house type (identity: builder + code, else name).
    const name = result.houseType.name ?? `Unnamed (${extractionId.slice(0, 6)})`;
    const code = result.houseType.code ?? null;

    let houseType = await tx.houseType.findFirst({
      where: code
        ? { projectId, code }
        : { projectId, name },
    });
    if (!houseType) {
      houseType = await tx.houseType.create({
        data: {
          projectId,
          clientId,
          name,
          code,
          buildType: result.buildType.value ?? undefined,
        },
      });
    }

    // 2. Link this extraction to the house type.
    await tx.extraction.update({
      where: { id: extractionId },
      data: { houseTypeId: houseType.id },
    });

    // 3. Ensure a Takeoff exists, seeded by this extraction.
    const takeoff = await tx.takeoff.upsert({
      where: { houseTypeId: houseType.id },
      create: { houseTypeId: houseType.id, seedExtractionId: extractionId },
      update: {},
    });

    // 4. Replace measurements for a clean re-run.
    await tx.takeoffMeasurement.deleteMany({ where: { takeoffId: takeoff.id } });
    await tx.wallSegment.deleteMany({ where: { takeoffId: takeoff.id } });

    const measurements: Prisma.TakeoffMeasurementCreateManyInput[] = [];
    const push = (
      key: Prisma.TakeoffMeasurementCreateManyInput["key"],
      field: {
        value: number | null;
        confidence: "high" | "medium" | "low" | "unknown";
        sourceSheet?: string | null;
        sourceDimension?: string | null;
      },
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

    push("STOREYS", result.storeys);
    push("HEIGHT_TO_SOFFIT", result.heightToSoffitM);
    push("GABLE_QTY", result.gableCount);

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

    // 5. Store AI notes as review warnings.
    if (result.notes) {
      await tx.takeoff.update({
        where: { id: takeoff.id },
        data: { warnings: { notes: result.notes } },
      });
    }

    return { houseTypeId: houseType.id, takeoffId: takeoff.id };
  });
}
