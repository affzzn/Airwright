"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/supabase/server";
import { saveTakeoffToBank, materializeBankEntry, reuseBankEntryIntoHouseType } from "@/server/bank";
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

/** Explicitly link a take-off to a chosen bank entry (a human override of the match). */
export async function linkTakeoffToBank(
  takeoffId: string,
  entryId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  const res = await saveTakeoffToBank(takeoffId, { userId: user?.id ?? null, forceEntryId: entryId });
  if (res.ok) {
    const projectId = await projectIdForTakeoff(takeoffId);
    if (projectId) revalidatePath(`/projects/${projectId}`);
    revalidatePath("/bank");
  }
  return { ok: res.ok, error: res.error };
}

/** Force a new bank entry for a take-off (a human saying "this is not that type"). */
export async function markTakeoffAsNewBankType(
  takeoffId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  const res = await saveTakeoffToBank(takeoffId, { userId: user?.id ?? null, markNew: true });
  if (res.ok) {
    const projectId = await projectIdForTakeoff(takeoffId);
    if (projectId) revalidatePath(`/projects/${projectId}`);
    revalidatePath("/bank");
  }
  return { ok: res.ok, error: res.error };
}

/** Unlink a house type from the bank (does not touch the bank entry itself). */
export async function detachHouseTypeFromBank(
  houseTypeId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const ht = await prisma.houseType.update({
      where: { id: houseTypeId },
      data: { bankEntryId: null, bankMatchState: "DETACHED" },
      select: { projectId: true },
    });
    revalidatePath(`/projects/${ht.projectId}`);
    revalidatePath("/bank");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "detach failed" };
  }
}

/** Reuse a bank entry into a project — skip-read materialise (docs/20 §6c). */
export async function reuseBankEntry(
  projectId: string,
  entryId: string,
): Promise<{ ok: boolean; houseTypeId?: string; error?: string }> {
  const user = await getCurrentUser();
  const res = await materializeBankEntry(projectId, entryId, { userId: user?.id ?? null });
  if (res.ok) {
    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/bank");
  }
  return res;
}

/**
 * Accept the upload-time suggestion: reuse a bank entry into an existing house type
 * (skip-read), so an obvious repeat isn't re-read. Revalidates the project page.
 */
export async function reuseBankIntoHouseType(
  projectId: string,
  houseTypeId: string,
  entryId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  const res = await reuseBankEntryIntoHouseType(houseTypeId, entryId, { userId: user?.id ?? null });
  if (res.ok) {
    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/bank");
  }
  return res;
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

export async function setBankCurrentVersion(entryId: string, versionId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const version = await prisma.houseTypeBankVersion.findUnique({
      where: { id: versionId },
      select: { bankEntryId: true },
    });
    if (!version || version.bankEntryId !== entryId) return { ok: false, error: "version not in this entry" };
    await prisma.houseTypeBankEntry.update({
      where: { id: entryId },
      data: { currentVersionId: versionId },
    });
    revalidatePath(`/bank/${entryId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "set-version failed" };
  }
}

/**
 * Merge two bank entries that turned out to be the same real type. Moves the
 * merged entry's versions + instances onto the survivor, folds its aliases, then
 * deletes it. Both must be the same client + build type.
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
      if (survivor.clientId !== merged.clientId || survivor.buildType !== merged.buildType)
        throw new Error("entries are different clients or build types");

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
