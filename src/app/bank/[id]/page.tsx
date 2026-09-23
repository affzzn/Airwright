import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BankEntryAdmin } from "@/components/bank/bank-entry-admin";
import { BankVersionActions } from "@/components/bank/bank-version-actions";
import { parseSnapshot, wallSums, perimeterTotal, type TakeoffSnapshot } from "@/lib/bank/snapshot";
import { compareGeometry } from "@/lib/bank/match";

export const dynamic = "force-dynamic";

const WALL_LABEL: Record<string, string> = {
  FRONT: "Front",
  REAR: "Rear",
  GABLE_LEFT: "Gable L",
  GABLE_RIGHT: "Gable R",
  OTHER: "Other",
};

function SnapshotReadout({ snapshot }: { snapshot: TakeoffSnapshot }) {
  const m = snapshot.measurements;
  const sums = wallSums(snapshot.walls);
  const rows: [string, string][] = [];
  rows.push(["Storeys", m.STOREYS != null ? String(m.STOREYS) : "—"]);
  rows.push(["Height to soffit", m.HEIGHT_TO_SOFFIT != null ? `${m.HEIGHT_TO_SOFFIT} m` : "—"]);
  rows.push(["Structure", snapshot.warnings.structure ?? "—"]);
  rows.push(["Roof", snapshot.warnings.roofType ?? "—"]);
  rows.push(["Configuration", snapshot.configuration]);
  rows.push(["Apex count", m.GABLE_QTY != null ? String(m.GABLE_QTY) : "—"]);
  rows.push(["Corners", m.CORNER_COUNT != null ? String(m.CORNER_COUNT) : "—"]);
  rows.push(["Low levels", m.LOW_LEVEL_QTY != null ? String(m.LOW_LEVEL_QTY) : "—"]);
  if (m.RENDER_LENGTH != null) rows.push(["Render", `${m.RENDER_LENGTH} m`]);
  for (const [k, label] of [
    ["BIRDCAGE_GF_M2", "Birdcage GF"],
    ["BIRDCAGE_FF_M2", "Birdcage FF"],
    ["BIRDCAGE_SF_M2", "Birdcage SF"],
  ] as const) {
    if (m[k] != null) rows.push([label, `${m[k]} m²`]);
  }
  const wallRows = (["FRONT", "REAR", "GABLE_LEFT", "GABLE_RIGHT", "OTHER"] as const).filter(
    (p) => sums[p] > 0,
  );
  return (
    <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
      <dl className="space-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 text-sm">
            <dt className="text-ink-subtle">{k}</dt>
            <dd className="font-medium text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <dl className="space-y-2">
        <div className="flex justify-between gap-4 text-sm">
          <dt className="text-ink-subtle">Perimeter</dt>
          <dd className="font-medium text-ink">{perimeterTotal(snapshot.walls)} m</dd>
        </div>
        {wallRows.map((p) => (
          <div key={p} className="flex justify-between gap-4 text-sm">
            <dt className="text-ink-subtle">{WALL_LABEL[p]} wall</dt>
            <dd className="font-medium text-ink">{sums[p]} m</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default async function BankEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const entry = await prisma.houseTypeBankEntry.findUnique({
    where: { id },
    relationLoadStrategy: "join",
    include: {
      client: { select: { id: true, name: true } },
      versions: { orderBy: { version: "desc" } },
      houseTypes: {
        select: {
          id: true,
          name: true,
          code: true,
          projectId: true,
          bankMatchState: true,
          project: { select: { name: true } },
        },
      },
    },
  });
  if (!entry) notFound();

  const mergeable = await prisma.houseTypeBankEntry.findMany({
    where: { clientId: entry.clientId, buildType: entry.buildType, status: "ACTIVE", NOT: { id: entry.id } },
    select: { id: true, canonicalName: true, canonicalCode: true },
    orderBy: { canonicalName: "asc" },
  });

  // Parse each version's snapshot + a diff from the previous (older) version.
  const versionsAsc = [...entry.versions].sort((a, b) => a.version - b.version);
  const snapshotById = new Map<string, TakeoffSnapshot | null>();
  for (const v of entry.versions) snapshotById.set(v.id, parseSnapshot(v.snapshot));

  const diffFromPrev = new Map<string, ReturnType<typeof compareGeometry> | null>();
  for (let i = 1; i < versionsAsc.length; i++) {
    const prev = snapshotById.get(versionsAsc[i - 1].id);
    const cur = snapshotById.get(versionsAsc[i].id);
    diffFromPrev.set(versionsAsc[i].id, prev && cur ? compareGeometry(prev, cur) : null);
  }

  const currentSnapshot = entry.currentVersionId ? snapshotById.get(entry.currentVersionId) ?? null : null;

  return (
    <AppShell>
      <Link href="/bank" className="text-sm text-ink-muted hover:text-ink">
        ← House-Type Bank
      </Link>

      <div className="mt-4 mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">{entry.client.name}</p>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-ink">
            {entry.canonicalName}
            {entry.canonicalCode && (
              <span className="text-base font-normal text-ink-subtle">{entry.canonicalCode}</span>
            )}
          </h1>
          <p className="mt-1 text-sm text-ink-subtle">
            {entry.buildType === "TIMBER_FRAME" ? "Timber frame" : "Traditional"} ·{" "}
            {entry.versions.length} version{entry.versions.length === 1 ? "" : "s"}
            {entry.timesReused > 0 && ` · reused ${entry.timesReused}×`}
            {entry.status === "ARCHIVED" && " · archived"}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Current confirmed take-off */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-ink">Current take-off</h2>
            </CardHeader>
            <CardBody>
              {currentSnapshot ? (
                <SnapshotReadout snapshot={currentSnapshot} />
              ) : (
                <p className="py-4 text-sm text-ink-subtle">No confirmed version.</p>
              )}
            </CardBody>
          </Card>

          {/* Version history */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Version history</h2>
              <span className="text-xs text-ink-subtle">{entry.versions.length}</span>
            </CardHeader>
            <CardBody className="p-0">
              <ul className="divide-y divide-hairline">
                {entry.versions.map((v) => {
                  const diff = diffFromPrev.get(v.id);
                  const isCurrent = v.id === entry.currentVersionId;
                  return (
                    <li key={v.id} className="px-5 py-3.5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="flex items-center gap-2 text-sm font-medium text-ink">
                            v{v.version}
                            {isCurrent && <Badge variant="solid">Current</Badge>}
                          </p>
                          <p className="mt-0.5 text-xs text-ink-subtle">
                            {v.confirmedAt ? new Date(v.confirmedAt).toLocaleDateString() : "—"}
                            {v.note ? ` · ${v.note}` : ""}
                          </p>
                        </div>
                        {!isCurrent && (
                          <BankVersionActions entryId={entry.id} versionId={v.id} />
                        )}
                      </div>
                      {diff && diff.diffs.length > 0 && (
                        <p className="mt-1.5 text-xs text-ink-muted">
                          Changed from v{v.version - 1}:{" "}
                          {diff.diffs
                            .map((d) => `${d.label} ${d.from ?? "—"}→${d.to ?? "—"}`)
                            .join(", ")}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </CardBody>
          </Card>

          {/* Where used */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Where used</h2>
              <span className="text-xs text-ink-subtle">{entry.houseTypes.length}</span>
            </CardHeader>
            <CardBody className="p-0">
              {entry.houseTypes.length === 0 ? (
                <p className="px-5 py-6 text-center text-sm text-ink-subtle">Not linked to any tender yet.</p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {entry.houseTypes.map((ht) => (
                    <li key={ht.id} className="flex items-center justify-between px-5 py-3">
                      <Link href={`/projects/${ht.projectId}`} className="text-sm text-ink hover:underline">
                        {ht.project.name}
                        <span className="ml-2 text-xs text-ink-subtle">
                          {ht.name}
                          {ht.code ? ` · ${ht.code}` : ""}
                        </span>
                      </Link>
                      {ht.bankMatchState === "CHANGED" && <Badge variant="outline">drawing differs</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Admin */}
        <div className="lg:col-span-1">
          <BankEntryAdmin
            entryId={entry.id}
            name={entry.canonicalName}
            code={entry.canonicalCode}
            aliases={entry.aliases}
            archived={entry.status === "ARCHIVED"}
            mergeable={mergeable.map((m) => ({
              id: m.id,
              label: m.canonicalCode ? `${m.canonicalName} (${m.canonicalCode})` : m.canonicalName,
            }))}
          />
        </div>
      </div>
    </AppShell>
  );
}
