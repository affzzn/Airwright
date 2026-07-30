import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { UploadForm } from "@/components/upload-form";
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
      packs: {
        orderBy: { version: "asc" },
        include: {
          documents: {
            orderBy: { uploadedAt: "desc" },
            include: {
              extractions: { orderBy: { createdAt: "asc" } },
            },
          },
        },
      },
    },
  });

  if (!project) notFound();

  const pack = project.packs[0];

  return (
    <AppShell>
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
        </p>
      </div>

      <div className="mb-8">
        <UploadForm packId={pack.id} />
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Documents</h2>
          <span className="text-xs text-ink-subtle">
            {pack.documents.length} file
            {pack.documents.length === 1 ? "" : "s"}
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {pack.documents.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-ink-subtle">
              No documents uploaded yet.
            </p>
          ) : (
            <ul className="divide-y divide-hairline">
              {pack.documents.map((doc) => (
                <li key={doc.id} className="px-5 py-4">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {doc.fileName}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        {doc.pageCount ?? "?"} pages ·{" "}
                        {doc.sizeBytes ? formatBytes(doc.sizeBytes) : "—"}
                        {!doc.isReadable && (
                          <>
                            {" · "}
                            <Badge variant="dashed">unreadable — manual</Badge>
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  {doc.extractions.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {doc.extractions.map((ex) => (
                        <li
                          key={ex.id}
                          className="flex items-center justify-between rounded-md border border-hairline bg-surface px-3 py-2"
                        >
                          <span className="text-xs text-ink-muted">
                            Pages {ex.pageRange ?? "all"}
                          </span>
                          <div className="flex items-center gap-3">
                            <StatusBadge status={ex.status} />
                            {ex.status === "COMPLETED" && (
                              <Link
                                href={`/extractions/${ex.id}`}
                                className="text-xs font-medium text-ink hover:underline"
                              >
                                Review →
                              </Link>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </AppShell>
  );
}
