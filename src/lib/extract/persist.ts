import { prisma } from "@/lib/db";
import type { ExtractionResult } from "./schema";
import type { Prisma } from "@prisma/client";

/** Map the AI confidence label to a 0-1 float for storage. */
function confToNumber(c: "high" | "medium" | "low" | "unknown"): number {
  return { high: 0.95, medium: 0.7, low: 0.4, unknown: 0 }[c];
}

/**
 * Write a validated extraction into the take-off for its house type. The house
 * type is normally created up front by pack segmentation and linked on the
 * Extraction; if not (single-PDF fallback), we create it from the AI output.
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

    if (result.notes) {
      await tx.takeoff.update({
        where: { id: takeoff.id },
        data: { warnings: { notes: result.notes } },
      });
    }

    return { houseTypeId, takeoffId: takeoff.id };
  });
}
