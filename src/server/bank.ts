import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  serializeSnapshot,
  parseSnapshot,
  geometryFingerprint,
  BANK_MEASUREMENT_KEYS,
  type BankBuildType,
  type BankConfiguration,
  type BankMeasurementKey,
  type TakeoffSnapshot,
} from "@/lib/bank/snapshot";
import {
  findRepeats,
  compareWithEntry,
  compareGeometry,
  builderKey,
  type BankEntryRef,
  type GeometryComparison,
  type Repeat,
} from "@/lib/bank/match";
import { normalizeName, normalizeCode } from "@/lib/bank/normalize";
import { summarizeSnapshot, type SnapshotSummary } from "@/lib/bank/summary";
import { ensureDefaultPlot } from "@/server/plots";

/**
 * House bank v2 (docs/20) — the server side. HOUSE-BUILD ONLY (Traditional +
 * Timber-Frame); Construction never calls in here.
 *
 *  - Nothing is saved automatically. A take-off goes into the bank only when a person
 *    presses "Save to house bank" (saveToBank), and every save is an explicit choice:
 *    a new house type, a new version of one, or "already saved as vN".
 *  - Versions are never edited or replaced; every version stays pickable.
 *  - On upload, each house type is checked against the WHOLE bank (every builder, same
 *    build type) BEFORE its drawing is read. A repeat's read is HELD — never queued —
 *    until a person picks a version (applyBankVersion → no read, no AI cost) or says
 *    "read the drawing".
 */

// ── Loading the bank ─────────────────────────────────────────────────────────

export interface BankVersionOption {
  versionId: string;
  version: number;
  savedAt: string | null;
  fromProject: string | null;
  summary: SnapshotSummary | null;
}

export interface BankRepeatOffer {
  entryId: string;
  name: string;
  code: string | null;
  builder: string;
  strength: Repeat["strength"];
  reason: Repeat["reason"];
  sameBuilder: boolean;
  /** Newest first. */
  versions: BankVersionOption[];
}

type LoadedEntry = BankEntryRef & {
  builder: string;
  versions: { id: string; version: number; snapshot: unknown; confirmedAt: Date | null; sourceProjectId: string | null }[];
};

/** Every ACTIVE bank entry of a build type (all builders), with its versions. */
async function loadBank(buildType: BankBuildType): Promise<LoadedEntry[]> {
  const entries = await prisma.houseTypeBankEntry.findMany({
    where: { buildType, status: "ACTIVE" },
    relationLoadStrategy: "join",
    include: {
      client: { select: { name: true } },
      versions: {
        select: { id: true, version: true, snapshot: true, confirmedAt: true, sourceProjectId: true },
        orderBy: { version: "desc" },
      },
    },
  });
  return entries.map((e) => ({
    entryId: e.id,
    buildType: e.buildType as BankBuildType,
    canonicalName: e.canonicalName,
    canonicalCode: e.canonicalCode,
    aliases: e.aliases,
    builderKey: builderKey(e.client.name),
    builder: e.client.name,
    versions: e.versions,
  }));
}

async function projectNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.project.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

function safeSummary(raw: unknown): SnapshotSummary | null {
  const snap = parseSnapshot(raw);
  if (!snap) return null;
  try {
    return summarizeSnapshot(snap);
  } catch {
    return null;
  }
}

/** At most this many bank entries are offered for one house type. */
const MAX_OFFERS = 3;

/**
 * The bank repeats for a set of house types (one bank load for all of them).
 * Used by the upload hold and by the project page's version picker.
 */
export async function bankRepeatsFor(
  ctx: { buildType: BankBuildType; builderName: string },
  types: { houseTypeId: string; name: string; code: string | null }[],
): Promise<Map<string, BankRepeatOffer[]>> {
  const out = new Map<string, BankRepeatOffer[]>();
  if (types.length === 0) return out;
  const bank = await loadBank(ctx.buildType);
  if (bank.length === 0) return out;
  const byId = new Map(bank.map((e) => [e.entryId, e]));
  const names = await projectNames(bank.flatMap((e) => e.versions.map((v) => v.sourceProjectId)));
  const inBuilder = builderKey(ctx.builderName);

  for (const t of types) {
    const hits = findRepeats({ buildType: ctx.buildType, name: t.name, code: t.code, builderKey: inBuilder }, bank)
      .filter((r) => (byId.get(r.entryId)?.versions.length ?? 0) > 0)
      .slice(0, MAX_OFFERS);
    if (hits.length === 0) continue;
    out.set(
      t.houseTypeId,
      hits.map((r) => {
        const e = byId.get(r.entryId)!;
        return {
          entryId: e.entryId,
          name: e.canonicalName,
          code: e.canonicalCode,
          builder: e.builder,
          strength: r.strength,
          reason: r.reason,
          sameBuilder: r.sameBuilder,
          versions: e.versions.map((v) => ({
            versionId: v.id,
            version: v.version,
            savedAt: v.confirmedAt ? v.confirmedAt.toISOString() : null,
            fromProject: v.sourceProjectId ? (names.get(v.sourceProjectId) ?? null) : null,
            summary: safeSummary(v.snapshot),
          })),
        };
      }),
    );
  }
  return out;
}

// ── Upload: hold the read of a repeat ────────────────────────────────────────

/**
 * Of these freshly-created PENDING extractions, which belong to a house type that is
 * already in the bank? Those are set to HELD (and must NOT be queued); the rest are
 * returned to be queued as normal. House-build only — construction never gets here.
 * Best-effort: if the bank cannot be checked, nothing is held (the read goes ahead).
 */
export async function holdBankRepeats(extractionIds: string[]): Promise<{ held: Set<string> }> {
  const held = new Set<string>();
  if (extractionIds.length === 0) return { held };
  try {
    const rows = await prisma.extraction.findMany({
      where: { id: { in: extractionIds }, status: "PENDING" },
      relationLoadStrategy: "join",
      select: {
        id: true,
        houseType: {
          select: {
            id: true,
            name: true,
            code: true,
            project: { select: { buildType: true, estimatingMode: true, client: { select: { name: true } } } },
          },
        },
      },
    });
    const first = rows.find((r) => r.houseType)?.houseType;
    if (!first || first.project.estimatingMode !== "HOUSE_BUILD") return { held };
    const ctx = {
      buildType: (first.project.buildType ?? "TRADITIONAL") as BankBuildType,
      builderName: first.project.client.name,
    };
    const offers = await bankRepeatsFor(
      ctx,
      rows.flatMap((r) => (r.houseType ? [{ houseTypeId: r.houseType.id, name: r.houseType.name, code: r.houseType.code }] : [])),
    );
    const toHold = rows.filter((r) => r.houseType && offers.has(r.houseType.id)).map((r) => r.id);
    if (toHold.length > 0) {
      await prisma.extraction.updateMany({ where: { id: { in: toHold }, status: "PENDING" }, data: { status: "HELD" } });
      toHold.forEach((id) => held.add(id));
    }
  } catch (err) {
    console.error("[bank] hold check failed — reads go ahead", err);
  }
  return { held };
}

// ── Picking a version ────────────────────────────────────────────────────────

/**
 * Fill a house type's take-off from one bank version and confirm it — picking the
 * version IS the person's confirmation. No drawing is read: any held / queued read
 * for this house type is marked SKIPPED (the row is kept so the review page still
 * shows the drawing). A read already mid-flight can't be recalled, but it can never
 * overwrite this (persist bails on a CONFIRMED take-off) — and the worker skips a
 * SKIPPED read before calling the model.
 */
export async function applyBankVersion(
  houseTypeId: string,
  versionId: string,
  opts: { userId?: string | null } = {},
): Promise<{ ok: boolean; error?: string }> {
  const [houseType, version] = await Promise.all([
    prisma.houseType.findUnique({
      where: { id: houseTypeId },
      relationLoadStrategy: "join",
      select: {
        id: true,
        name: true,
        code: true,
        projectId: true,
        project: { select: { buildType: true, estimatingMode: true } },
        takeoff: { select: { id: true } },
      },
    }),
    prisma.houseTypeBankVersion.findUnique({
      where: { id: versionId },
      relationLoadStrategy: "join",
      include: { bankEntry: { select: { id: true, buildType: true, status: true, aliases: true, canonicalName: true, canonicalCode: true } } },
    }),
  ]);
  if (!houseType) return { ok: false, error: "house type not found" };
  if (houseType.project.estimatingMode !== "HOUSE_BUILD") return { ok: false, error: "the house bank is house-build only" };
  if (!version) return { ok: false, error: "that bank version no longer exists" };
  const projectBuild = houseType.project.buildType ?? "TRADITIONAL";
  if (version.bankEntry.buildType !== projectBuild)
    return {
      ok: false,
      error: `that house type is ${version.bankEntry.buildType === "TIMBER_FRAME" ? "timber frame" : "traditional"} — this tender is ${projectBuild === "TIMBER_FRAME" ? "timber frame" : "traditional"}`,
    };
  const snapshot = parseSnapshot(version.snapshot);
  if (!snapshot) return { ok: false, error: "that bank version can't be read" };

  const measurementsCreate = (Object.keys(snapshot.measurements) as BankMeasurementKey[])
    .filter((k) => BANK_MEASUREMENT_KEYS.includes(k) && snapshot.measurements[k] != null)
    .map((k) => ({ key: k, valueNumber: snapshot.measurements[k]!, source: "MANUAL" as const, confidence: null, ambiguous: false }));
  const wallsCreate = snapshot.walls.map((w) => ({
    position: w.position,
    lengthM: w.lengthM,
    isPartyWall: w.isPartyWall ?? null,
    source: "MANUAL" as const,
    confidence: null,
  }));
  const takeoffData = {
    status: "CONFIRMED" as const,
    configuration: snapshot.configuration,
    includePartyWall: snapshot.includePartyWall,
    confirmedById: opts.userId ?? null,
    confirmedAt: new Date(),
    // bankPickedAt: when the numbers were put in from the bank — a drawing read that
    // started before this is no longer what the take-off shows (bankOriginFor).
    warnings: { ...snapshot.warnings, bankPickedAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
  };
  const aliases = learnAlias(version.bankEntry, houseType.name, houseType.code);

  try {
    await prisma.$transaction(async (tx) => {
      if (houseType.takeoff) {
        await tx.takeoffMeasurement.deleteMany({ where: { takeoffId: houseType.takeoff.id } });
        await tx.wallSegment.deleteMany({ where: { takeoffId: houseType.takeoff.id } });
        await tx.takeoff.update({
          where: { id: houseType.takeoff.id },
          data: { ...takeoffData, measurements: { create: measurementsCreate }, wallSegments: { create: wallsCreate } },
        });
      } else {
        await tx.takeoff.create({
          data: {
            houseTypeId: houseType.id,
            ...takeoffData,
            measurements: { create: measurementsCreate },
            wallSegments: { create: wallsCreate },
          },
        });
      }
      // A person said "this IS that house type": take the bank's clean name + code (the
      // tender's raw title-block text, e.g. "MILLFIELD BUNGALOW", was learned as an alias).
      // The code is only taken if no other house type in this tender already uses it.
      const code = version.bankEntry.canonicalCode;
      const codeClash = code
        ? await tx.houseType.findFirst({
            where: { projectId: houseType.projectId, code, NOT: { id: houseType.id } },
            select: { id: true },
          })
        : null;
      await tx.houseType.update({
        where: { id: houseType.id },
        data: {
          bankEntryId: version.bankEntry.id,
          bankVersionId: version.id,
          bankMatchState: "FROM_BANK",
          name: version.bankEntry.canonicalName,
          ...(code && !codeClash ? { code } : {}),
        },
      });
      // The read is not needed: never queue / never run it.
      await tx.extraction.updateMany({
        where: { houseTypeId: houseType.id, status: { in: ["PENDING", "HELD"] } },
        data: { status: "SKIPPED", errorMessage: null },
      });
      await tx.houseTypeBankEntry.update({
        where: { id: version.bankEntry.id },
        data: { timesReused: { increment: 1 }, ...(aliases ? { aliases } : {}) },
      });
    });
    await ensureDefaultPlot(houseType.id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "could not use that version" };
  }
}

/**
 * When a person says "this IS that house type", remember the name/code they saw so it
 * is an exact hit next time. Returns the new alias list, or null if nothing to add.
 */
function learnAlias(
  entry: { aliases: string[]; canonicalName: string; canonicalCode: string | null },
  name: string,
  code: string | null,
): string[] | null {
  const next = [...entry.aliases];
  const has = (v: string) =>
    next.some((a) => normalizeName(a) === normalizeName(v) && (normalizeCode(a) ?? "") === (normalizeCode(v) ?? ""));
  const nm = name.trim();
  if (nm && normalizeName(nm) && normalizeName(nm) !== normalizeName(entry.canonicalName) && !has(nm)) next.push(nm);
  const cd = code?.trim();
  if (cd && normalizeCode(cd) && normalizeCode(cd) !== normalizeCode(entry.canonicalCode) && !next.some((a) => normalizeCode(a) === normalizeCode(cd)))
    next.push(cd);
  return next.length !== entry.aliases.length ? next.slice(0, 50) : null;
}

// ── Saving to the bank (only on the button) ──────────────────────────────────

/** Build a frozen snapshot from a persisted take-off (+ its project's build type). */
export async function snapshotFromTakeoff(takeoffId: string): Promise<{
  snapshot: TakeoffSnapshot;
  status: string;
  houseType: {
    id: string;
    name: string;
    code: string | null;
    clientId: string;
    builderName: string;
    projectId: string;
    bankEntryId: string | null;
    bankVersionId: string | null;
    bankMatchState: string | null;
  };
} | null> {
  const takeoff = await prisma.takeoff.findUnique({
    where: { id: takeoffId },
    relationLoadStrategy: "join",
    include: {
      measurements: { select: { key: true, valueNumber: true } },
      wallSegments: { select: { position: true, lengthM: true, isPartyWall: true } },
      houseType: {
        select: {
          id: true,
          name: true,
          code: true,
          clientId: true,
          projectId: true,
          bankEntryId: true,
          bankVersionId: true,
          bankMatchState: true,
          client: { select: { name: true } },
          project: { select: { buildType: true, estimatingMode: true } },
        },
      },
    },
  });
  if (!takeoff?.houseType) return null;
  if (takeoff.houseType.project.estimatingMode !== "HOUSE_BUILD") return null;

  const buildType = (takeoff.houseType.project.buildType ?? "TRADITIONAL") as BankBuildType;
  const snapshot = serializeSnapshot({
    buildType,
    configuration: takeoff.configuration as BankConfiguration,
    includePartyWall: takeoff.includePartyWall,
    measurements: takeoff.measurements,
    walls: takeoff.wallSegments,
    warnings: takeoff.warnings,
  });
  const h = takeoff.houseType;
  return {
    snapshot,
    status: takeoff.status,
    houseType: {
      id: h.id,
      name: h.name,
      code: h.code,
      clientId: h.clientId,
      builderName: h.client.name,
      projectId: h.projectId,
      bankEntryId: h.bankEntryId,
      bankVersionId: h.bankVersionId,
      bankMatchState: h.bankMatchState,
    },
  };
}

export interface SaveCandidate {
  entryId: string;
  name: string;
  code: string | null;
  builder: string;
  strength: Repeat["strength"] | "LINKED";
  versionCount: number;
  /** A stored version with the same numbers — nothing new to save. */
  identicalTo: { versionId: string; version: number } | null;
  /** How this take-off differs from the newest version (empty when identical). */
  diffs: GeometryComparison["diffs"];
  /** DIFFERENT = the numbers look like another house (storeys/structure/perimeter). */
  verdict: GeometryComparison["verdict"] | null;
  latestVersion: number | null;
  nextVersion: number;
}

export interface SaveOptions {
  takeoffId: string;
  confirmed: boolean;
  houseTypeName: string;
  houseTypeCode: string | null;
  builder: string;
  summary: SnapshotSummary | null;
  /** Where this house type already sits in the bank (picked from / saved as). */
  linked: { entryId: string; name: string; version: number | null; state: string } | null;
  candidates: SaveCandidate[];
}

/** What "Save to house bank" can do for this take-off (read-only — writes nothing). */
export async function saveOptions(takeoffId: string): Promise<SaveOptions | null> {
  const s = await snapshotFromTakeoff(takeoffId);
  if (!s) return null;
  const bank = await loadBank(s.snapshot.buildType);
  const repeats = findRepeats(
    { buildType: s.snapshot.buildType, name: s.houseType.name, code: s.houseType.code, builderKey: builderKey(s.houseType.builderName) },
    bank,
  );
  const ids: { entryId: string; strength: SaveCandidate["strength"] }[] = repeats
    .slice(0, MAX_OFFERS)
    .map((r) => ({ entryId: r.entryId, strength: r.strength }));
  // The entry this house type was picked from / saved to always comes first.
  if (s.houseType.bankEntryId && bank.some((e) => e.entryId === s.houseType.bankEntryId)) {
    const i = ids.findIndex((x) => x.entryId === s.houseType.bankEntryId);
    if (i >= 0) ids.splice(i, 1);
    ids.unshift({ entryId: s.houseType.bankEntryId, strength: "LINKED" });
  }
  const byId = new Map(bank.map((e) => [e.entryId, e]));
  const candidates: SaveCandidate[] = ids.map(({ entryId, strength }) => {
    const e = byId.get(entryId)!;
    const cmp = compareWithEntry(
      s.snapshot,
      e.versions.map((v) => ({ versionId: v.id, version: v.version, snapshot: parseSnapshot(v.snapshot) })),
    );
    return {
      entryId,
      name: e.canonicalName,
      code: e.canonicalCode,
      builder: e.builder,
      strength,
      versionCount: e.versions.length,
      identicalTo: cmp.identicalTo,
      diffs: cmp.identicalTo ? [] : (cmp.latest?.comparison?.diffs ?? []),
      verdict: cmp.identicalTo ? "IDENTICAL" : (cmp.latest?.comparison?.verdict ?? null),
      latestVersion: cmp.latest?.version ?? null,
      nextVersion: cmp.nextVersion,
    };
  });

  let linked: SaveOptions["linked"] = null;
  if (s.houseType.bankEntryId) {
    const e = byId.get(s.houseType.bankEntryId);
    const v = e?.versions.find((x) => x.id === s.houseType.bankVersionId);
    if (e) linked = { entryId: e.entryId, name: e.canonicalName, version: v?.version ?? null, state: s.houseType.bankMatchState ?? "" };
  }

  let summary: SnapshotSummary | null = null;
  try {
    summary = summarizeSnapshot(s.snapshot);
  } catch {
    summary = null;
  }

  return {
    takeoffId,
    confirmed: s.status === "CONFIRMED",
    houseTypeName: s.houseType.name,
    houseTypeCode: s.houseType.code,
    builder: s.houseType.builderName,
    summary,
    linked,
    candidates,
  };
}

export type SaveChoice =
  | { kind: "NEW_ENTRY" }
  | { kind: "NEW_VERSION"; entryId: string }
  | { kind: "SAME_AS"; entryId: string };

/**
 * "Save to house bank" — the ONLY way anything enters the bank. The take-off must be
 * confirmed. Every choice is re-checked here against the stored versions, so the bank
 * can never get a duplicate version or a "same as" link whose numbers differ.
 */
export async function saveToBank(
  takeoffId: string,
  choice: SaveChoice,
  opts: { userId?: string | null; note?: string | null } = {},
): Promise<{ ok: boolean; entryId?: string; version?: number; error?: string }> {
  const s = await snapshotFromTakeoff(takeoffId);
  if (!s) return { ok: false, error: "only a house-build take-off can go in the house bank" };
  if (s.status !== "CONFIRMED") return { ok: false, error: "confirm the take-off first" };
  const snapshotJson = s.snapshot as unknown as Prisma.InputJsonValue;
  const fingerprint = geometryFingerprint(s.snapshot);

  const createVersion = (tx: Prisma.TransactionClient, bankEntryId: string, version: number) =>
    tx.houseTypeBankVersion.create({
      data: {
        bankEntryId,
        version,
        snapshot: snapshotJson,
        geometryFingerprint: fingerprint,
        sourceTakeoffId: takeoffId,
        sourceProjectId: s.houseType.projectId,
        note: opts.note ?? null,
        confirmedById: opts.userId ?? null,
        confirmedAt: new Date(),
      },
    });

  const writeChoice = async (
    tx: Prisma.TransactionClient,
  ): Promise<{ entryId: string; versionId: string; version: number }> => {
    if (choice.kind === "NEW_ENTRY") {
      // One entry per builder + code + build type: a clashing code is not kept
      // (the name still identifies it, and the person chose "a different type").
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
          matchKey: normalizeName(s.houseType.name),
          createdById: opts.userId ?? null,
        },
      });
      const version = await createVersion(tx, entry.id, 1);
      await tx.houseTypeBankEntry.update({ where: { id: entry.id }, data: { currentVersionId: version.id } });
      return { entryId: entry.id, versionId: version.id, version: 1 };
    }

    const entry = await tx.houseTypeBankEntry.findUnique({
      where: { id: choice.entryId },
      relationLoadStrategy: "join",
      include: { versions: { select: { id: true, version: true, snapshot: true } } },
    });
    if (!entry || entry.status !== "ACTIVE") throw new Error("that house type is no longer in the bank");
    if (entry.buildType !== s.snapshot.buildType) throw new Error("that bank house type is a different build type");
    const cmp = compareWithEntry(
      s.snapshot,
      entry.versions.map((v) => ({ versionId: v.id, version: v.version, snapshot: parseSnapshot(v.snapshot) })),
    );
    const aliases = learnAlias(entry, s.houseType.name, s.houseType.code);
    if (aliases) await tx.houseTypeBankEntry.update({ where: { id: entry.id }, data: { aliases } });

    if (choice.kind === "SAME_AS") {
      if (!cmp.identicalTo) throw new Error("the numbers differ from every saved version — save it as a new version");
      return { entryId: entry.id, versionId: cmp.identicalTo.versionId, version: cmp.identicalTo.version };
    }
    if (cmp.identicalTo) throw new Error(`already saved as v${cmp.identicalTo.version} — nothing new to save`);
    const version = await createVersion(tx, entry.id, cmp.nextVersion);
    await tx.houseTypeBankEntry.update({ where: { id: entry.id }, data: { currentVersionId: version.id } });
    return { entryId: entry.id, versionId: version.id, version: cmp.nextVersion };
  };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const r = await writeChoice(tx);
      await tx.houseType.update({
        where: { id: s.houseType.id },
        data: { bankEntryId: r.entryId, bankVersionId: r.versionId, bankMatchState: "SAVED" },
      });
      return r;
    });
    return { ok: true, entryId: result.entryId, version: result.version };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "could not save to the house bank" };
  }
}

// ── The review page: how a picked house type compares with its version ──────

export interface BankOrigin {
  entryId: string;
  versionId: string;
  name: string;
  code: string | null;
  builder: string;
  version: number;
  savedAt: string | null;
  fromProject: string | null;
  /** The drawing was read after picking (Check against this drawing). */
  drawingRead: boolean;
  /** That read is queued / running right now. */
  checking: boolean;
  /** The drawing was read, but the bank version's numbers were put back afterwards. */
  restored: boolean;
  /** This take-off vs the picked version (null if it can't be compared). */
  comparison: GeometryComparison | null;
}

/** For a house type picked from the bank: where it came from and whether it still matches. */
export async function bankOriginFor(houseTypeId: string): Promise<BankOrigin | null> {
  const ht = await prisma.houseType.findUnique({
    where: { id: houseTypeId },
    relationLoadStrategy: "join",
    select: {
      bankMatchState: true,
      takeoff: { select: { id: true, warnings: true } },
      extractions: { select: { status: true, processingStartedAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
      bankVersion: {
        select: {
          id: true,
          version: true,
          snapshot: true,
          confirmedAt: true,
          sourceProjectId: true,
          bankEntry: { select: { id: true, canonicalName: true, canonicalCode: true, client: { select: { name: true } } } },
        },
      },
    },
  });
  if (!ht || ht.bankMatchState !== "FROM_BANK" || !ht.bankVersion) return null;
  const v = ht.bankVersion;
  let comparison: GeometryComparison | null = null;
  if (ht.takeoff) {
    const s = await snapshotFromTakeoff(ht.takeoff.id);
    const stored = parseSnapshot(v.snapshot);
    if (s && stored) comparison = compareGeometry(stored, s.snapshot);
  }
  const names = await projectNames([v.sourceProjectId]);
  const ex = ht.extractions[0];
  const w = ht.takeoff?.warnings as Record<string, unknown> | null | undefined;
  const pickedAt = typeof w?.bankPickedAt === "string" ? Date.parse(w.bankPickedAt) : null;
  const readAt = ex?.processingStartedAt?.getTime() ?? null;
  const readDone = ex?.status === "COMPLETED";
  const readIsCurrent = readDone && (pickedAt === null || (readAt !== null && readAt > pickedAt));
  return {
    entryId: v.bankEntry.id,
    versionId: v.id,
    name: v.bankEntry.canonicalName,
    code: v.bankEntry.canonicalCode,
    builder: v.bankEntry.client.name,
    version: v.version,
    savedAt: v.confirmedAt ? v.confirmedAt.toISOString() : null,
    fromProject: v.sourceProjectId ? (names.get(v.sourceProjectId) ?? null) : null,
    drawingRead: readIsCurrent,
    checking: ex?.status === "PENDING" || ex?.status === "PROCESSING",
    restored: readDone && !readIsCurrent,
    comparison,
  };
}

// ── Entry admin (the /bank page) ─────────────────────────────────────────────

/** List bank entries (all builders) for the /bank browse page. */
export async function listBankEntries(filter: { buildType?: BankBuildType; includeArchived?: boolean } = {}) {
  const entries = await prisma.houseTypeBankEntry.findMany({
    where: {
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
      perimeter: snap ? Math.round(snap.walls.reduce((a, w) => a + w.lengthM, 0) * 10) / 10 : null,
    };
  });
}
