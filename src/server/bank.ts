import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  serializeSnapshot,
  parseSnapshot,
  geometryFingerprint,
  type BankBuildType,
  type BankConfiguration,
  type TakeoffSnapshot,
} from "@/lib/bank/snapshot";
import {
  matchAgainstBank,
  compareGeometry,
  nameCodeMatch,
  type BankCandidateInput,
  type MatchResult,
} from "@/lib/bank/match";
import { normalizeName, normalizeCode } from "@/lib/bank/normalize";
import { ensureDefaultPlot } from "@/server/plots";
import type { BankMeasurementKey } from "@/lib/bank/snapshot";
import { BANK_MEASUREMENT_KEYS } from "@/lib/bank/snapshot";

/**
 * Server-side orchestration for the House-Type Bank (docs/20 §6). The pure matcher
 * (src/lib/bank) does the geometry/name work; this loads/writes Prisma. HOUSE-BUILD
 * ONLY — Construction never calls in here.
 */

/** Build a frozen snapshot from a persisted take-off (+ its project's build type). */
export async function snapshotFromTakeoff(
  takeoffId: string,
): Promise<{
  snapshot: TakeoffSnapshot;
  houseType: { id: string; name: string; code: string | null; clientId: string; projectId: string };
} | null> {
  const takeoff = await prisma.takeoff.findUnique({
    where: { id: takeoffId },
    relationLoadStrategy: "join",
    include: {
      measurements: { select: { key: true, valueNumber: true } },
      wallSegments: { select: { position: true, lengthM: true } },
      houseType: {
        select: {
          id: true,
          name: true,
          code: true,
          clientId: true,
          projectId: true,
          project: { select: { buildType: true, estimatingMode: true } },
        },
      },
    },
  });
  if (!takeoff?.houseType) return null;
  // Bank is house-build only.
  if (takeoff.houseType.project.estimatingMode === "CONSTRUCTION") return null;

  const buildType = (takeoff.houseType.project.buildType ?? "TRADITIONAL") as BankBuildType;
  const snapshot = serializeSnapshot({
    buildType,
    configuration: takeoff.configuration as BankConfiguration,
    includePartyWall: takeoff.includePartyWall,
    measurements: takeoff.measurements,
    walls: takeoff.wallSegments,
    warnings: takeoff.warnings,
  });
  return {
    snapshot,
    houseType: {
      id: takeoff.houseType.id,
      name: takeoff.houseType.name,
      code: takeoff.houseType.code,
      clientId: takeoff.houseType.clientId,
      projectId: takeoff.houseType.projectId,
    },
  };
}

/** Load the client's bank entries (of one build type) as matcher candidates. */
export async function bankCandidates(
  clientId: string,
  buildType: BankBuildType,
): Promise<BankCandidateInput[]> {
  const entries = await prisma.houseTypeBankEntry.findMany({
    where: { clientId, buildType, status: "ACTIVE" },
    relationLoadStrategy: "join",
    include: { currentVersion: { select: { snapshot: true } } },
  });
  return entries.map((e) => ({
    entryId: e.id,
    buildType: e.buildType as BankBuildType,
    canonicalName: e.canonicalName,
    canonicalCode: e.canonicalCode,
    aliases: e.aliases,
    snapshot: e.currentVersion ? parseSnapshot(e.currentVersion.snapshot) : null,
  }));
}

/** Run the matcher for a take-off without writing anything (for the review panel). */
export async function matchTakeoff(takeoffId: string): Promise<
  | {
      match: MatchResult;
      candidateNames: Record<string, { name: string; code: string | null }>;
      currentBankEntryId: string | null;
      houseType: { name: string; code: string | null; clientId: string };
    }
  | null
> {
  const s = await snapshotFromTakeoff(takeoffId);
  if (!s) return null;
  const candidates = await bankCandidates(s.houseType.clientId, s.snapshot.buildType);
  const match = matchAgainstBank(
    { buildType: s.snapshot.buildType, name: s.houseType.name, code: s.houseType.code, snapshot: s.snapshot },
    candidates,
  );
  // Resolve entry ids → display names for the UI.
  const ids = new Set(match.candidates.map((c) => c.entryId));
  const names: Record<string, { name: string; code: string | null }> = {};
  if (ids.size) {
    const rows = await prisma.houseTypeBankEntry.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, canonicalName: true, canonicalCode: true },
    });
    for (const r of rows) names[r.id] = { name: r.canonicalName, code: r.canonicalCode };
  }
  const ht = await prisma.houseType.findUnique({
    where: { id: s.houseType.id },
    select: { bankEntryId: true },
  });
  return {
    match,
    candidateNames: names,
    currentBankEntryId: ht?.bankEntryId ?? null,
    houseType: { name: s.houseType.name, code: s.houseType.code, clientId: s.houseType.clientId },
  };
}

/** Which existing bank entry (if any) an auto-confirm should attach to. */
function pickTarget(match: MatchResult): { entryId: string; changed: boolean } | null {
  const best = match.best;
  if (!best) return null;
  // Attach to a strong reuse/changed match, or whenever the code/alias is an exact
  // hit (the code is authoritative identity — and the unique-code constraint means
  // we must not spawn a second entry with the same code).
  if (best.kind === "REUSE" || best.kind === "CHANGED" || best.aliasHit || best.codeEqual) {
    return { entryId: best.entryId, changed: best.geometry ? best.geometry.verdict !== "IDENTICAL" : false };
  }
  return null;
}

/**
 * Write a confirmed take-off into the bank (docs/20 §6a — automatic on confirm).
 * Idempotent on the geometry fingerprint: attaching to an entry whose current
 * version is identical creates NO new version (so a reuse/re-confirm never dupes).
 * Best-effort — the caller must not let a bank failure break the confirm.
 */
export async function saveTakeoffToBank(
  takeoffId: string,
  opts: {
    userId?: string | null;
    note?: string | null;
    /** Skip matching and attach to this entry (a human's explicit "link to X"). */
    forceEntryId?: string;
    /** Skip matching and create a fresh entry (a human's explicit "mark as new"). */
    markNew?: boolean;
  } = {},
): Promise<{ ok: boolean; bankEntryId?: string; created?: boolean; error?: string }> {
  const s = await snapshotFromTakeoff(takeoffId);
  if (!s) return { ok: false, error: "not a house-build take-off" };

  const fingerprint = geometryFingerprint(s.snapshot);
  const candidates = await bankCandidates(s.houseType.clientId, s.snapshot.buildType);
  const match = matchAgainstBank(
    { buildType: s.snapshot.buildType, name: s.houseType.name, code: s.houseType.code, snapshot: s.snapshot },
    candidates,
  );
  // Explicit override (from the review panel) wins over the auto-match.
  const target: { entryId: string; changed: boolean } | null = opts.markNew
    ? null
    : opts.forceEntryId
      ? {
          entryId: opts.forceEntryId,
          changed:
            match.candidates.find((c) => c.entryId === opts.forceEntryId)?.geometry?.verdict !== "IDENTICAL",
        }
      : pickTarget(match);

  const snapshotJson = s.snapshot as unknown as Prisma.InputJsonValue;
  const inName = normalizeName(s.houseType.name);
  const inCodeNorm = normalizeCode(s.houseType.code);

  try {
    const result = await prisma.$transaction(async (tx) => {
      if (target) {
        const entry = await tx.houseTypeBankEntry.findUnique({
          where: { id: target.entryId },
          relationLoadStrategy: "join",
          include: {
            currentVersion: { select: { geometryFingerprint: true, snapshot: true } },
            versions: { select: { version: true } },
          },
        });
        if (!entry) return { bankEntryId: null, created: false, identical: false };

        // "Identical" is TOLERANCE-aware, not byte-exact: a repeat drawing is never
        // pixel-identical, so we compare the geometry (compareGeometry) against the
        // current version. Only a change BEYOND tolerance writes a new version / flags
        // CHANGED — a within-tolerance re-read is MATCHED and adds no version (docs/20 §4).
        const currentSnapshot = entry.currentVersion ? parseSnapshot(entry.currentVersion.snapshot) : null;
        const cmp = currentSnapshot ? compareGeometry(currentSnapshot, s.snapshot) : null;
        const identical = cmp
          ? cmp.verdict === "IDENTICAL"
          : entry.currentVersion?.geometryFingerprint === fingerprint;
        if (!identical) {
          const nextVersion = entry.versions.reduce((m, v) => Math.max(m, v.version), 0) + 1;
          const version = await tx.houseTypeBankVersion.create({
            data: {
              bankEntryId: entry.id,
              version: nextVersion,
              snapshot: snapshotJson,
              geometryFingerprint: fingerprint,
              sourceTakeoffId: takeoffId,
              sourceProjectId: s.houseType.projectId,
              note: opts.note ?? null,
              confirmedById: opts.userId ?? null,
              confirmedAt: new Date(),
            },
          });
          await tx.houseTypeBankEntry.update({
            where: { id: entry.id },
            data: { currentVersionId: version.id },
          });
        }

        // Learn the name/code as an alias when it differs from the canonical identity.
        const aliasSet = new Set(entry.aliases);
        const canonName = normalizeName(entry.canonicalName);
        const canonCode = normalizeCode(entry.canonicalCode);
        if (inName && inName !== canonName && !entry.aliases.some((a) => normalizeName(a) === inName)) {
          aliasSet.add(s.houseType.name.trim());
        }
        if (inCodeNorm && inCodeNorm !== canonCode && !entry.aliases.some((a) => normalizeCode(a) === inCodeNorm)) {
          if (s.houseType.code) aliasSet.add(s.houseType.code.trim());
        }
        if (aliasSet.size !== entry.aliases.length) {
          await tx.houseTypeBankEntry.update({
            where: { id: entry.id },
            data: { aliases: [...aliasSet].slice(0, 50) },
          });
        }

        await tx.houseType.update({
          where: { id: s.houseType.id },
          data: { bankEntryId: entry.id, bankMatchState: identical ? "MATCHED" : "CHANGED" },
        });
        return { bankEntryId: entry.id, created: false, identical };
      }

      // No suitable match → create a new entry + version 1.
      // Guard the unique (clientId, canonicalCode, buildType): only keep the code if
      // no ACTIVE entry already owns it for this client + build type.
      let canonicalCode = s.houseType.code?.trim() || null;
      if (canonicalCode) {
        const clash = await tx.houseTypeBankEntry.findFirst({
          where: { clientId: s.houseType.clientId, buildType: s.snapshot.buildType, canonicalCode },
          select: { id: true },
        });
        if (clash) canonicalCode = null;
      }
      const entry = await tx.houseTypeBankEntry.create({
        data: {
          clientId: s.houseType.clientId,
          buildType: s.snapshot.buildType,
          canonicalName: s.houseType.name.trim() || "Unnamed",
          canonicalCode,
          matchKey: inName,
          createdById: opts.userId ?? null,
        },
      });
      const version = await tx.houseTypeBankVersion.create({
        data: {
          bankEntryId: entry.id,
          version: 1,
          snapshot: snapshotJson,
          geometryFingerprint: fingerprint,
          sourceTakeoffId: takeoffId,
          sourceProjectId: s.houseType.projectId,
          note: opts.note ?? null,
          confirmedById: opts.userId ?? null,
          confirmedAt: new Date(),
        },
      });
      await tx.houseTypeBankEntry.update({
        where: { id: entry.id },
        data: { currentVersionId: version.id },
      });
      await tx.houseType.update({
        where: { id: s.houseType.id },
        data: { bankEntryId: entry.id, bankMatchState: "NEW" },
      });
      return { bankEntryId: entry.id, created: true, identical: false };
    });

    return { ok: true, bankEntryId: result.bankEntryId ?? undefined, created: result.created };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "bank write failed" };
  }
}

// ── Reuse (docs/20 §6c — skip-read by default) ───────────────────────────────

/**
 * Materialise a bank entry's current version into a project as a fresh, confirmed
 * house type + take-off (skip-read reuse — no drawing is read). The instance is
 * flagged "reused from bank, not yet verified against a drawing" so change-detection
 * can still be run on demand (the "Verify against drawing" safeguard). House-build
 * only; the entry's build type must match the project's.
 */
export async function materializeBankEntry(
  projectId: string,
  bankEntryId: string,
  opts: { userId?: string | null } = {},
): Promise<{ ok: boolean; houseTypeId?: string; error?: string }> {
  const [project, entry] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, clientId: true, buildType: true, estimatingMode: true },
    }),
    prisma.houseTypeBankEntry.findUnique({
      where: { id: bankEntryId },
      relationLoadStrategy: "join",
      include: { currentVersion: true },
    }),
  ]);
  if (!project) return { ok: false, error: "project not found" };
  if (project.estimatingMode === "CONSTRUCTION")
    return { ok: false, error: "the bank is house-build only" };
  if (!entry || !entry.currentVersion) return { ok: false, error: "bank entry has no confirmed version" };
  if (entry.clientId !== project.clientId)
    return { ok: false, error: "that house type belongs to a different client" };
  if (entry.buildType !== project.buildType)
    return { ok: false, error: `that house type is ${entry.buildType.toLowerCase()} — this tender is ${String(project.buildType).toLowerCase()}` };

  const snapshot = parseSnapshot(entry.currentVersion.snapshot);
  if (!snapshot) return { ok: false, error: "bank snapshot unreadable" };

  try {
    const houseTypeId = await prisma.$transaction(async (tx) => {
      // Guard @@unique([projectId, code]) — drop the code if the project already uses it.
      let code = entry.canonicalCode;
      if (code) {
        const clash = await tx.houseType.findFirst({
          where: { projectId, code },
          select: { id: true },
        });
        if (clash) code = null;
      }
      const houseType = await tx.houseType.create({
        data: {
          projectId,
          clientId: project.clientId,
          name: entry.canonicalName,
          code,
          buildType: entry.buildType,
          bankEntryId: entry.id,
          bankMatchState: "MATCHED",
        },
      });

      const warnings = {
        ...snapshot.warnings,
        bankReused: true,
        bankReusedFrom: { entryId: entry.id, version: entry.currentVersion!.version },
        // The safeguard flag: no drawing has been read for this instance yet.
        bankReusedUnverified: true,
      } as unknown as Prisma.InputJsonValue;

      await tx.takeoff.create({
        data: {
          houseTypeId: houseType.id,
          status: "CONFIRMED",
          configuration: snapshot.configuration,
          includePartyWall: snapshot.includePartyWall,
          confirmedById: opts.userId ?? null,
          confirmedAt: new Date(),
          warnings,
          measurements: {
            create: (Object.keys(snapshot.measurements) as BankMeasurementKey[])
              .filter((k) => BANK_MEASUREMENT_KEYS.includes(k) && snapshot.measurements[k] != null)
              .map((k) => ({
                key: k,
                valueNumber: snapshot.measurements[k]!,
                source: "MANUAL" as const,
                confidence: null,
                ambiguous: false,
              })),
          },
          wallSegments: {
            create: snapshot.walls.map((w) => ({
              position: w.position,
              lengthM: w.lengthM,
              source: "MANUAL" as const,
              confidence: null,
            })),
          },
        },
      });

      await tx.houseTypeBankEntry.update({
        where: { id: entry.id },
        data: { timesReused: { increment: 1 } },
      });
      return houseType.id;
    });

    await ensureDefaultPlot(houseTypeId);
    return { ok: true, houseTypeId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "reuse failed" };
  }
}

// ── Entry admin (docs/20 §7) ─────────────────────────────────────────────────

/** List a client's bank entries for the reuse picker / browse, of an optional build type. */
export async function listBankEntries(filter: { clientId?: string; buildType?: BankBuildType; includeArchived?: boolean } = {}) {
  const entries = await prisma.houseTypeBankEntry.findMany({
    where: {
      clientId: filter.clientId,
      buildType: filter.buildType,
      status: filter.includeArchived ? undefined : "ACTIVE",
    },
    relationLoadStrategy: "join",
    include: {
      client: { select: { name: true } },
      currentVersion: { select: { version: true, snapshot: true, confirmedAt: true } },
      _count: { select: { versions: true, houseTypes: true } },
    },
    orderBy: [{ updatedAt: "desc" }],
  });
  return entries.map((e) => {
    const snap = e.currentVersion ? parseSnapshot(e.currentVersion.snapshot) : null;
    return {
      id: e.id,
      clientName: e.client.name,
      buildType: e.buildType as BankBuildType,
      canonicalName: e.canonicalName,
      canonicalCode: e.canonicalCode,
      aliases: e.aliases,
      status: e.status,
      timesReused: e.timesReused,
      versions: e._count.versions,
      instances: e._count.houseTypes,
      lastConfirmed: e.currentVersion?.confirmedAt ?? null,
      storeys: snap?.measurements.STOREYS ?? null,
      perimeter: snap ? Math.round((snap.walls.reduce((a, w) => a + w.lengthM, 0)) * 10) / 10 : null,
    };
  });
}

// ── Upload-time auto-detect (docs/20 §6c) ────────────────────────────────────

/**
 * Suggest bank repeats for a set of house types by NAME/CODE only (pre-read). Used
 * on the project page the moment a house type is segmented — before/while its
 * drawing is read — so an obvious repeat can be reused without spending the read.
 * One entries load for the whole project; matching is in-memory.
 */
export async function suggestBankForTypes(
  clientId: string,
  buildType: BankBuildType,
  types: { houseTypeId: string; name: string; code: string | null }[],
): Promise<Map<string, { entryId: string; name: string; code: string | null }>> {
  const out = new Map<string, { entryId: string; name: string; code: string | null }>();
  if (types.length === 0) return out;
  const candidates = await bankCandidates(clientId, buildType);
  if (candidates.length === 0) return out;
  const nameById = new Map(candidates.map((c) => [c.entryId, { name: c.canonicalName, code: c.canonicalCode }]));
  for (const t of types) {
    const hits = nameCodeMatch({ buildType, name: t.name, code: t.code }, candidates);
    const best = hits[0];
    if (best) {
      const nm = nameById.get(best.entryId);
      if (nm) out.set(t.houseTypeId, { entryId: best.entryId, name: nm.name, code: nm.code });
    }
  }
  return out;
}

/**
 * Reuse a bank entry into an EXISTING house type (skip-read from the upload-time
 * suggestion). Fills that house type's take-off from the bank snapshot, confirms
 * it, links it, and cancels any not-yet-started read so the drawing isn't billed.
 * A late-completing read cannot clobber it (persist bails on a CONFIRMED take-off).
 */
export async function reuseBankEntryIntoHouseType(
  houseTypeId: string,
  bankEntryId: string,
  opts: { userId?: string | null } = {},
): Promise<{ ok: boolean; error?: string }> {
  const [houseType, entry] = await Promise.all([
    prisma.houseType.findUnique({
      where: { id: houseTypeId },
      relationLoadStrategy: "join",
      select: {
        id: true,
        clientId: true,
        projectId: true,
        project: { select: { buildType: true, estimatingMode: true } },
        takeoff: { select: { id: true } },
      },
    }),
    prisma.houseTypeBankEntry.findUnique({
      where: { id: bankEntryId },
      relationLoadStrategy: "join",
      include: { currentVersion: true },
    }),
  ]);
  if (!houseType) return { ok: false, error: "house type not found" };
  if (houseType.project.estimatingMode === "CONSTRUCTION")
    return { ok: false, error: "the bank is house-build only" };
  if (!entry || !entry.currentVersion) return { ok: false, error: "bank entry has no confirmed version" };
  if (entry.clientId !== houseType.clientId) return { ok: false, error: "different client" };
  if (entry.buildType !== houseType.project.buildType)
    return { ok: false, error: `that house type is ${entry.buildType.toLowerCase()}` };
  const snapshot = parseSnapshot(entry.currentVersion.snapshot);
  if (!snapshot) return { ok: false, error: "bank snapshot unreadable" };

  const warnings = {
    ...snapshot.warnings,
    bankReused: true,
    bankReusedFrom: { entryId: entry.id, version: entry.currentVersion.version },
    bankReusedUnverified: true,
  } as unknown as Prisma.InputJsonValue;
  const measurementsCreate = (Object.keys(snapshot.measurements) as BankMeasurementKey[])
    .filter((k) => BANK_MEASUREMENT_KEYS.includes(k) && snapshot.measurements[k] != null)
    .map((k) => ({ key: k, valueNumber: snapshot.measurements[k]!, source: "MANUAL" as const, confidence: null, ambiguous: false }));
  const wallsCreate = snapshot.walls.map((w) => ({ position: w.position, lengthM: w.lengthM, source: "MANUAL" as const, confidence: null }));

  try {
    await prisma.$transaction(async (tx) => {
      if (houseType.takeoff) {
        // Replace the (possibly AI-seeded) take-off content with the bank values.
        await tx.takeoffMeasurement.deleteMany({ where: { takeoffId: houseType.takeoff.id } });
        await tx.wallSegment.deleteMany({ where: { takeoffId: houseType.takeoff.id } });
        await tx.takeoff.update({
          where: { id: houseType.takeoff.id },
          data: {
            status: "CONFIRMED",
            configuration: snapshot.configuration,
            includePartyWall: snapshot.includePartyWall,
            confirmedById: opts.userId ?? null,
            confirmedAt: new Date(),
            warnings,
            measurements: { create: measurementsCreate },
            wallSegments: { create: wallsCreate },
          },
        });
      } else {
        await tx.takeoff.create({
          data: {
            houseTypeId: houseType.id,
            status: "CONFIRMED",
            configuration: snapshot.configuration,
            includePartyWall: snapshot.includePartyWall,
            confirmedById: opts.userId ?? null,
            confirmedAt: new Date(),
            warnings,
            measurements: { create: measurementsCreate },
            wallSegments: { create: wallsCreate },
          },
        });
      }
      await tx.houseType.update({
        where: { id: houseType.id },
        data: { bankEntryId: entry.id, bankMatchState: "MATCHED" },
      });
      await tx.houseTypeBankEntry.update({ where: { id: entry.id }, data: { timesReused: { increment: 1 } } });
      // Cancel a not-yet-started read for this type (save the drawing bill). A read
      // already in flight is left to finish — persist won't overwrite a CONFIRMED take-off.
      await tx.extraction.deleteMany({ where: { houseTypeId: houseType.id, status: "PENDING" } });
    });
    await ensureDefaultPlot(houseType.id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "reuse failed" };
  }
}
