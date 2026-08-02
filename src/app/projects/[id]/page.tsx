import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { AppShell } from "@/components/app-shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { UploadForm } from "@/components/upload-form";
import { AutoRefresh } from "@/components/auto-refresh";
import { formatBytes } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      client: true,
      houseTypes: {
        orderBy: { createdAt: "asc" },
        include: {
          takeoff: { select: { status: true } },
          extractions: { orderBy: { createdAt: "asc" } },
          _count: { select: { plots: true } },
        },
      },
      plots: {
        include: { houseType: { select: { name: true, code: true } } },
      },
      packs: {
        orderBy: { version: "asc" },
        include: {
          uploads: true,
          documents: {
            orderBy: { uploadedAt: "desc" },
            include: { pages: { select: { relevant: true } } },
          },
        },
      },
    },
  });

  if (!project) notFound();

  const pack = project.packs[0];
  const uploadsPending = pack.uploads.some((u) => u.status === "PENDING");
  const unclassified = pack.documents.some(
    (d) => d.classifiedAt === null && d.isReadable,
  );
  const extractionsRunning = project.houseTypes.some((ht) =>
    ht.extractions.some(
      (e) => e.status === "PENDING" || e.status === "PROCESSING",
    ),
  );
  const processing = uploadsPending || unclassified || extractionsRunning;

  // Natural sort plots (so "2" comes before "10").
  const plots = [...project.plots].sort((a, b) => {
    const na = parseInt(a.plotNumber, 10);
    const nb = parseInt(b.plotNumber, 10);
    if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
    return a.plotNumber.localeCompare(b.plotNumber);
  });
  const configLabel = (c: string) =>
    ({
      DETACHED: "Detached",
      SEMI_DETACHED: "Semi",
      END_TERRACE: "End terrace",
      MID_TERRACE: "Mid terrace",
    })[c] ?? c;

  return (
    <AppShell>
      {processing && <AutoRefresh />}

      <Link href="/" className="text-sm text-ink-muted hover:text-ink">
        ← Projects
      </Link>

      <div className="mt-4 mb-8">
        <p className="eyebrow mb-2">{project.client.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {project.name}
        </h1>
        <p className="mt-1 text-sm text-ink-subtle">
          {project.estimatingMode === "CONSTRUCTION"
            ? "Construction"
            : "House build"}{" "}
          · Pack v{pack?.version ?? 1}
          {processing && " · processing…"}
        </p>
      </div>

      <div className="mb-8">
        <UploadForm packId={pack.id} bucket={env.storageBucket} />
      </div>

      {/* House types */}
      <Card className="mb-6">
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">House types</h2>
          <span className="text-xs text-ink-subtle">
            {project.houseTypes.length}
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {project.houseTypes.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-ink-subtle">
              {processing
                ? "Reading the pack — house types will appear here."
                : "No house types yet. Upload a tender pack above."}
            </p>
          ) : (
            <ul className="divide-y divide-hairline">
              {project.houseTypes.map((ht) => {
                const ex = ht.extractions[ht.extractions.length - 1];
                return (
                  <li
                    key={ht.id}
                    className="flex items-center justify-between px-5 py-4"
                  >
                    <div>
                      <p className="text-sm font-medium text-ink">
                        {ht.name}
                        {ht.code && (
                          <span className="ml-2 text-xs text-ink-subtle">
                            {ht.code}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        {ex ? `pages ${ex.pageRange ?? "all"}` : "—"}
                        {ht._count.plots > 0 &&
                          ` · ${ht._count.plots} plot${ht._count.plots === 1 ? "" : "s"}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {ex && <StatusBadge status={ex.status} />}
                      {ex?.status === "COMPLETED" && (
                        <Link
                          href={`/extractions/${ex.id}`}
                          className="text-xs font-medium text-ink hover:underline"
                        >
                          Review →
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* Plots (from the plot list) */}
      {plots.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Plots</h2>
            <span className="text-xs text-ink-subtle">{plots.length}</span>
          </CardHeader>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left">
                    <th className="px-5 py-2.5 font-medium text-ink-subtle">Plot</th>
                    <th className="px-5 py-2.5 font-medium text-ink-subtle">House type</th>
                    <th className="px-5 py-2.5 font-medium text-ink-subtle">Configuration</th>
                    <th className="px-5 py-2.5 font-medium text-ink-subtle">Render</th>
                  </tr>
                </thead>
                <tbody>
                  {plots.map((p) => (
                    <tr key={p.id} className="border-b border-hairline last:border-0">
                      <td className="px-5 py-2.5 font-medium text-ink">{p.plotNumber}</td>
                      <td className="px-5 py-2.5 text-ink-muted">
                        {p.houseType.name}
                        {p.houseType.code && (
                          <span className="ml-1.5 text-ink-subtle">{p.houseType.code}</span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-ink-muted">
                        {configLabel(p.configuration)}
                      </td>
                      <td className="px-5 py-2.5 text-ink-subtle">
                        {p.isRendered ? "Yes" : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Documents */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Documents</h2>
          <span className="text-xs text-ink-subtle">
            {pack.documents.length} file{pack.documents.length === 1 ? "" : "s"}
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {pack.documents.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-ink-subtle">
              {uploadsPending
                ? "Unpacking upload…"
                : "No documents yet."}
            </p>
          ) : (
            <ul className="divide-y divide-hairline">
              {pack.documents.map((doc) => {
                const relevant = doc.pages.filter((p) => p.relevant).length;
                return (
                  <li key={doc.id} className="px-5 py-4">
                    <div className="flex items-center justify-between">
                      <p className="truncate text-sm font-medium text-ink">
                        {doc.fileName}
                      </p>
                      <span className="ml-3 shrink-0 text-xs text-ink-subtle">
                        {doc.kind.replace("_", " ").toLowerCase()}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-subtle">
                      {doc.pageCount ?? "?"} pages
                      {doc.pages.length > 0 && ` · ${relevant} relevant`}
                      {doc.sizeBytes ? ` · ${formatBytes(doc.sizeBytes)}` : ""}
                      {doc.needsReview && (
                        <>
                          {" · "}
                          <Badge variant="dashed">needs review</Badge>
                        </>
                      )}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </AppShell>
  );
}
