"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/supabase/server";
import { getBoss } from "@/lib/queue/boss";
import { EXTRACT_DRAWING_QUEUE } from "@/lib/queue/jobs";
import { saveOptions, saveToBank, applyBankVersion, type SaveChoice, type SaveOptions } from "@/server/bank";
import { normalizeName, normalizeCode } from "@/lib/bank/normalize";

/**
 * Server actions for the House-Type Bank (docs/20). Mutations only — the reads
 * live in `src/server/bank.ts`. All revalidate the pages that show bank state.
 */

async function projectIdForTakeoff(takeoffId: string): Promise<string | null> {
  const t = await prisma.takeoff.findUnique({
    where: { id: takeoffId },
    select: { houseType: { select: { projectId: true } } },
  });
  return t?.houseType.projectId ?? null;
}

async function revalidateHouseType(houseTypeId: string) {
  const ht = await prisma.houseType.findUnique({
    where: { id: houseTypeId },
    select: { projectId: true, extractions: { select: { id: true } } },
  });
  if (!ht) return;
  revalidatePath(`/projects/${ht.projectId}`);
  for (const e of ht.extractions) revalidatePath(`/extractions/${e.id}`);
}

/** What "Save to house bank" can do for this take-off (read-only, for the dialog). */
export async function getSaveToBankOptions(takeoffId: string): Promise<SaveOptions | null> {
  return saveOptions(takeoffId);
}

/** "Save to house bank" — the only way a take-off enters the bank (docs/20 v2). */
export async function saveTakeoffToHouseBank(
  takeoffId: string,
  choice: SaveChoice,
): Promise<{ ok: boolean; version?: number; entryId?: string; error?: string }> {
  const user = await getCurrentUser();
  const res = await saveToBank(takeoffId, choice, { userId: user?.id ?? null });
  if (res.ok) {
    const projectId = await projectIdForTakeoff(takeoffId);
    if (projectId) revalidatePath(`/projects/${projectId}`);
    revalidatePath("/bank");
    if (res.entryId) revalidatePath(`/bank/${res.entryId}`);
  }
  return res;
}

/** Pick a bank version for a house type: its take-off is filled + confirmed, no read. */
export async function pickBankVersion(
  houseTypeId: string,
  versionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  const res = await applyBankVersion(houseTypeId, versionId, { userId: user?.id ?? null });
  if (res.ok) {
    await revalidateHouseType(houseTypeId);
    revalidatePath("/bank");
  }
  return res;
}

async function queueRead(extraction: { id: string; documentId: string; pageRange: string | null }) {
  const boss = await getBoss();
  await boss.send(EXTRACT_DRAWING_QUEUE, {
    documentId: extraction.documentId,
    extractionId: extraction.id,
    pageRange: extraction.pageRange,
  });
}

/** "Not this house — read the drawing": release a HELD read to the queue. */
export async function readDrawingInsteadOfBank(houseTypeId: string): Promise<{ ok: boolean; error?: string }> {
  const ex = await prisma.extraction.findFirst({
    where: { houseTypeId, status: "HELD" },
    orderBy: { createdAt: "desc" },
    select: { id: true, documentId: true, pageRange: true },
  });
  if (!ex) return { ok: false, error: "nothing is waiting to be read" };
  await prisma.extraction.update({ where: { id: ex.id }, data: { status: "PENDING", errorMessage: null } });
  await queueRead(ex);
  await revalidateHouseType(houseTypeId);
  return { ok: true };
}

/**
 * "Check against this drawing" for a house type picked from the bank: read the
 * drawing now. The take-off is re-opened so the read can fill it, and the review page
 * then compares it with the picked version (same / what changed). "Use vN again"
 * puts the bank numbers back.
 */
export async function checkBankPickAgainstDrawing(houseTypeId: string): Promise<{ ok: boolean; error?: string }> {
  const ht = await prisma.houseType.findUnique({
    where: { id: houseTypeId },
    select: {
      bankMatchState: true,
      takeoff: { select: { id: true } },
      extractions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, documentId: true, pageRange: true },
      },
    },
  });
  const ex = ht?.extractions[0];
  if (!ht || ht.bankMatchState !== "FROM_BANK") return { ok: false, error: "this house type wasn't picked from the bank" };
  if (!ex) return { ok: false, error: "there is no drawing for this house type" };
  if (ex.status === "PENDING" || ex.status === "PROCESSING") return { ok: true };
  if (ht.takeoff) {
    await prisma.takeoff.update({
      where: { id: ht.takeoff.id },
      data: { status: "IN_REVIEW", confirmedAt: null, confirmedById: null },
    });
  }
  await prisma.extraction.update({ where: { id: ex.id }, data: { status: "PENDING", errorMessage: null } });
  await queueRead(ex);
  await revalidateHouseType(houseTypeId);
  return { ok: true };
}

export async function archiveBankEntry(entryId: string, archived: boolean): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.houseTypeBankEntry.update({
      where: { id: entryId },
      data: { status: archived ? "ARCHIVED" : "ACTIVE" },
    });
    revalidatePath("/bank");
    revalidatePath(`/bank/${entryId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "archive failed" };
  }
}

export async function renameBankEntry(
  entryId: string,
  name: string,
  code: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const trimmedName = name.trim();
  if (!trimmedName) return { ok: false, error: "name required" };
  const trimmedCode = code?.trim() || null;
  try {
    const entry = await prisma.houseTypeBankEntry.findUnique({
      where: { id: entryId },
      select: { clientId: true, buildType: true },
    });
    if (!entry) return { ok: false, error: "not found" };
    // Respect the unique (clientId, canonicalCode, buildType).
    if (trimmedCode) {
      const clash = await prisma.houseTypeBankEntry.findFirst({
        where: { clientId: entry.clientId, buildType: entry.buildType, canonicalCode: trimmedCode, NOT: { id: entryId } },
        select: { id: true },
      });
      if (clash) return { ok: false, error: "another bank entry already uses that code" };
    }
    await prisma.houseTypeBankEntry.update({
      where: { id: entryId },
      data: { canonicalName: trimmedName, canonicalCode: trimmedCode, matchKey: normalizeName(trimmedName) },
    });
    revalidatePath("/bank");
    revalidatePath(`/bank/${entryId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "rename failed" };
  }
}

export async function updateBankAliases(entryId: string, aliases: string[]): Promise<{ ok: boolean; error?: string }> {
  // Dedupe (by normalised form) + cap.
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const a of aliases) {
    const t = a.trim();
    if (!t) continue;
    const norm = normalizeName(t) || normalizeCode(t) || t.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    clean.push(t);
  }
  try {
    await prisma.houseTypeBankEntry.update({
      where: { id: entryId },
      data: { aliases: clean.slice(0, 50) },
    });
    revalidatePath(`/bank/${entryId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "update failed" };
  }
}

/**
 * Merge two bank entries that turned out to be the same real type. Moves the
 * merged entry's versions + instances onto the survivor, folds its aliases, then
 * deletes it. Both must be the same build type (the builder may differ — the bank is
 * company-wide).
 */
export async function mergeBankEntries(
  survivorId: string,
  mergedId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (survivorId === mergedId) return { ok: false, error: "pick two different entries" };
  try {
    await prisma.$transaction(async (tx) => {
      const [survivor, merged] = await Promise.all([
        tx.houseTypeBankEntry.findUnique({
          where: { id: survivorId },
          include: { versions: { select: { version: true } } },
        }),
        tx.houseTypeBankEntry.findUnique({
          where: { id: mergedId },
          relationLoadStrategy: "join",
          include: { versions: { orderBy: { version: "asc" } } },
        }),
      ]);
      if (!survivor || !merged) throw new Error("entry not found");
      if (survivor.buildType !== merged.buildType)
        throw new Error("one is timber frame and the other traditional — they can't be merged");

      // Move merged's versions onto the survivor, renumbered above its current max.
      let next = survivor.versions.reduce((m, v) => Math.max(m, v.version), 0) + 1;
      for (const v of merged.versions) {
        await tx.houseTypeBankVersion.update({
          where: { id: v.id },
          data: { bankEntryId: survivorId, version: next++ },
        });
      }
      // Relink instances.
      await tx.houseType.updateMany({ where: { bankEntryId: mergedId }, data: { bankEntryId: survivorId } });
      // Fold aliases (+ the merged entry's own name/code as aliases), deduped.
      const seen = new Set(survivor.aliases.map((a) => normalizeName(a) || normalizeCode(a) || a.toLowerCase()));
      const merge = (val: string | null | undefined) => {
        if (!val) return;
        const norm = normalizeName(val) || normalizeCode(val) || val.toLowerCase();
        if (norm === normalizeName(survivor.canonicalName) || norm === normalizeCode(survivor.canonicalCode)) return;
        if (seen.has(norm)) return;
        seen.add(norm);
        survivor.aliases.push(val);
      };
      for (const a of merged.aliases) merge(a);
      merge(merged.canonicalName);
      merge(merged.canonicalCode);
      await tx.houseTypeBankEntry.update({
        where: { id: survivorId },
        data: { aliases: survivor.aliases.slice(0, 50) },
      });
      // Detach the merged entry's currentVersion pointer, then delete it (its
      // versions have already moved, so nothing cascades away).
      await tx.houseTypeBankEntry.update({ where: { id: mergedId }, data: { currentVersionId: null } });
      await tx.houseTypeBankEntry.delete({ where: { id: mergedId } });
    });
    revalidatePath("/bank");
    revalidatePath(`/bank/${survivorId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "merge failed" };
  }
}
