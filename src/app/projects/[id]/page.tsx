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
        },
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
