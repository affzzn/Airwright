"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/supabase/server";
import { ensureDefaultPlot } from "@/server/plots";
import { STRUCTURE_FORMS } from "@/lib/structure";

/**
 * Save Colin's corrections to an extracted take-off. Editing the OBSERVABLES
 * (measurements, wall segments, categorical facts) only — the deterministic
 * take-off line is recomputed from them, never stored. The original AI value is
 * always preserved (`aiValue` / `aiLengthM`) and the field is marked EDITED, so
 * the correction-rate metric (AI vs confirmed) stays measurable.
 */

export interface TakeoffEditsInput {
  /** Only the measurements that changed. */
  measurements: { key: string; value: number | null }[];
  /** The full intended wall set (rows missing an id are new; omitted rows are deleted). */
  walls: { id: string | null; position: string; lengthM: number }[];
  categoricals: {
    roofType: string | null;
    structure: string | null;
    dwellingsWide: number | null;
    roomInRoof: boolean | null;
    rendered: boolean | null;
    chimney: boolean | null;
  };
}

const EDITABLE_KEYS = new Set([
  "STOREYS",
  "HEIGHT_TO_SOFFIT",
  "GABLE_QTY",
  "RENDER_LENGTH",
  "BIRDCAGE_GF_M2",
  "BIRDCAGE_FF_M2",
  "BIRDCAGE_SF_M2",
  "LOW_LEVEL_QTY",
  "CORNER_COUNT",
]);
const WALL_POSITIONS = new Set(["FRONT", "REAR", "GABLE_LEFT", "GABLE_RIGHT", "OTHER"]);
const ROOF_TYPES = new Set(["PITCHED", "HIPPED", "MIXED"]);
const STRUCTURES = new Set<string>(STRUCTURE_FORMS);

type MKey = Prisma.TakeoffMeasurementCreateManyInput["key"];
type WPos = Prisma.WallSegmentCreateManyInput["position"];

export async function saveTakeoffEdits(
  takeoffId: string,
  edits: TakeoffEditsInput,
): Promise<{ ok: boolean; error?: string }> {
  const takeoff = await prisma.takeoff.findUnique({
    where: { id: takeoffId },
    include: {
      wallSegments: { select: { id: true } },
      houseType: { select: { project: { select: { id: true } } } },
    },
  });
  if (!takeoff) return { ok: false, error: "Take-off not found" };

  try {
    await prisma.$transaction(async (tx) => {
      // --- Measurements: upsert changed keys; keep aiValue, mark EDITED ---
      for (const m of edits.measurements) {
        if (!EDITABLE_KEYS.has(m.key)) continue;
        const key = m.key as MKey;
        await tx.takeoffMeasurement.upsert({
          where: { takeoffId_key: { takeoffId, key } },
          create: {
            takeoffId,
            key,
            valueNumber: m.value,
            aiValue: null,
            source: "MANUAL",
            confidence: null,
            ambiguous: false,
          },
          update: {
            valueNumber: m.value,
            source: "EDITED",
            ambiguous: false,
          },
        });
      }

      // --- Wall segments: reconcile against the incoming set ---
      const incomingIds = new Set(
        edits.walls.map((w) => w.id).filter((id): id is string => !!id),
      );
      const toDelete = takeoff.wallSegments
        .filter((w) => !incomingIds.has(w.id))
        .map((w) => w.id);
      if (toDelete.length) {
        await tx.wallSegment.deleteMany({ where: { id: { in: toDelete } } });
      }
      for (const w of edits.walls) {
        if (!WALL_POSITIONS.has(w.position)) continue;
        const position = w.position as WPos;
        if (w.id) {
          await tx.wallSegment.update({
            where: { id: w.id },
            data: { position, lengthM: w.lengthM, source: "EDITED", ambiguous: false },
          });
        } else {
          await tx.wallSegment.create({
            data: {
              takeoffId,
              position,
              lengthM: w.lengthM,
              aiLengthM: null,
              source: "MANUAL",
              confidence: null,
            },
          });
        }
      }

      // --- Categorical facts → warnings JSON (merge; keep elevations/notes/…) ---
      const current: Prisma.JsonObject =
        takeoff.warnings && typeof takeoff.warnings === "object" && !Array.isArray(takeoff.warnings)
          ? (takeoff.warnings as Prisma.JsonObject)
          : {};
      const next: Prisma.JsonObject = { ...current };
      const c = edits.categoricals;
      if (c.roofType && ROOF_TYPES.has(c.roofType)) next.roofType = c.roofType;
      else delete next.roofType;
      if (c.structure && STRUCTURES.has(c.structure)) next.structure = c.structure;
      else delete next.structure;
      if (typeof c.dwellingsWide === "number" && c.dwellingsWide >= 1)
        next.dwellingsWide = c.dwellingsWide;
      else delete next.dwellingsWide;
      if (typeof c.roomInRoof === "boolean") next.roomInRoof = c.roomInRoof;
      else delete next.roomInRoof;
      if (typeof c.rendered === "boolean") next.rendered = c.rendered;
      else delete next.rendered;
      if (typeof c.chimney === "boolean") next.chimney = c.chimney;
      else delete next.chimney;

      await tx.takeoff.update({
        where: { id: takeoffId },
        data: { warnings: next, status: "IN_REVIEW" },
      });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }

  // Audit trail — best-effort, never blocks the save.
  try {
    const user = await getCurrentUser();
    let userId: string | null = null;
    if (user) {
      const u = await prisma.user.findUnique({
        where: { id: user.id },
        select: { id: true },
      });
      userId = u?.id ?? null;
    }
    await prisma.auditLog.create({
      data: {
        userId,
        entity: "Takeoff",
        entityId: takeoffId,
        action: "EDIT",
        after: edits as unknown as Prisma.JsonObject,
      },
    });
  } catch {
    // ignore audit failures
  }

  const projectId = takeoff.houseType?.project.id;
  if (projectId) revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

/**
 * Lock a take-off. The confirmed measurements become the frozen basis for
 * pricing — nothing is priced off an unconfirmed take-off. Records who/when.
 */
export async function confirmTakeoff(
  takeoffId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = await getCurrentUser();
    const tk = await prisma.takeoff.update({
      where: { id: takeoffId },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        confirmedById: user?.id ?? null,
      },
      select: { houseTypeId: true },
    });
    await writeAudit(takeoffId, "CONFIRM");
    // Auto-create a plot to price if the house type has none yet (the common
    // no-site-layout case), so pricing needs no manual plot-building.
    await ensureDefaultPlot(tk.houseTypeId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Confirm failed" };
  }
  await revalidateForTakeoff(takeoffId);
  return { ok: true };
}

/** Re-open a confirmed take-off for editing (back to IN_REVIEW). */
export async function reopenTakeoff(
  takeoffId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.takeoff.update({
      where: { id: takeoffId },
      data: { status: "IN_REVIEW", confirmedAt: null, confirmedById: null },
    });
    await writeAudit(takeoffId, "REOPEN");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Re-open failed" };
  }
  await revalidateForTakeoff(takeoffId);
  return { ok: true };
}

async function revalidateForTakeoff(takeoffId: string): Promise<void> {
  const t = await prisma.takeoff.findUnique({
    where: { id: takeoffId },
    select: { houseType: { select: { projectId: true } } },
  });
  if (t?.houseType.projectId) revalidatePath(`/projects/${t.houseType.projectId}`);
}

async function writeAudit(takeoffId: string, action: string): Promise<void> {
  try {
    const user = await getCurrentUser();
    let userId: string | null = null;
    if (user) {
      const u = await prisma.user.findUnique({ where: { id: user.id }, select: { id: true } });
      userId = u?.id ?? null;
    }
    await prisma.auditLog.create({
      data: { userId, entity: "Takeoff", entityId: takeoffId, action },
    });
  } catch {
    // ignore audit failures
  }
}
