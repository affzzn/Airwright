import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { createSignedUrl } from "@/lib/supabase/storage";
import { AppShell } from "@/components/app-shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, ConfidenceDot } from "@/components/ui/badge";
import { PdfViewerClient } from "@/components/pdf-viewer-client";

export const dynamic = "force-dynamic";

const MEASUREMENT_LABEL: Record<string, string> = {
  STOREYS: "Storeys",
  HEIGHT_TO_SOFFIT: "Height to soffit",
  GABLE_QTY: "Gables / apex",
  ROOF_PITCH: "Roof pitch",
  LIFTS: "Number of lifts",
  RENDER_LENGTH: "Render length",
  BIRDCAGE_GF_M2: "Birdcage (GF)",
  BIRDCAGE_FF_M2: "Birdcage (FF)",
  LOW_LEVEL_QTY: "Low-level",
  FOOT_SCAFFOLD_QTY: "Foot scaffold",
  CORNER_COUNT: "Corners",
};

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const extraction = await prisma.extraction.findUnique({
    where: { id },
    include: {
      document: { include: { pack: true } },
      houseType: {
        include: {
          takeoff: {
            include: {
              measurements: true,
              wallSegments: { orderBy: { createdAt: "asc" } },
            },
          },
        },
      },
    },
  });

  if (!extraction) notFound();

  const takeoff = extraction.houseType?.takeoff;
  const measurements = takeoff?.measurements ?? [];
  const walls = takeoff?.wallSegments ?? [];
  const perimeter = walls.reduce((sum, w) => sum + Number(w.lengthM), 0);
  const notes =
    takeoff?.warnings &&
    typeof takeoff.warnings === "object" &&
    "notes" in takeoff.warnings
      ? String((takeoff.warnings as { notes: unknown }).notes)
      : null;

  let pdfUrl: string | null = null;
  try {
    pdfUrl = await createSignedUrl(extraction.document.storagePath);
  } catch {
    pdfUrl = null;
  }

  return (
    <AppShell>
      <Link
        href={`/projects/${extraction.document.pack.projectId}`}
        className="text-sm text-ink-muted hover:text-ink"
      >
        ← Back to project
      </Link>

      <div className="mt-4 mb-8 flex items-end justify-between">
        <div>
          <p className="eyebrow mb-2">Review · read-only</p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {extraction.houseType?.name ?? "Extraction"}
          </h1>
          <p className="mt-1 text-sm text-ink-subtle">
            {extraction.document.fileName} · AI read pages{" "}
            {extraction.pageRange ?? "all"} of {extraction.document.pageCount}{" "}
            (elevations, floor plans, section)
          </p>
        </div>
        <Badge variant="muted">
          {extraction.model} · {extraction.latencyMs ?? "—"}ms
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Drawing */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Drawing</h2>
            {pdfUrl && (
              <a
                href={pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-ink-muted hover:text-ink"
              >
                Open original ↗
              </a>
            )}
          </CardHeader>
          <CardBody>
            {pdfUrl ? (
              <PdfViewerClient url={pdfUrl} />
            ) : (
              <p className="py-10 text-center text-sm text-ink-subtle">
                Drawing preview unavailable (Storage not configured).
              </p>
            )}
          </CardBody>
        </Card>

        {/* Extracted fields */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-ink">Extracted take-off</h2>
          </CardHeader>
          <CardBody className="space-y-6">
            <div>
              <p className="eyebrow mb-3">Measurements</p>
              <dl className="divide-y divide-hairline">
                {measurements.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between py-2.5"
                  >
                    <dt className="text-sm text-ink-muted">
                      {MEASUREMENT_LABEL[m.key] ?? m.key}
                    </dt>
                    <dd className="flex items-center gap-2.5">
                      <span className="text-sm font-medium tabular-nums text-ink">
                        {m.valueNumber !== null ? String(m.valueNumber) : "—"}
                      </span>
                      <ConfidenceDot value={m.confidence} />
                    </dd>
                  </div>
                ))}
                {measurements.length === 0 && (
                  <p className="py-4 text-sm text-ink-subtle">
                    No measurements extracted.
                  </p>
                )}
              </dl>
            </div>

            <div>
              <div className="mb-3 flex items-baseline justify-between">
                <p className="eyebrow">Wall segments → perimeter</p>
                <span className="text-sm font-medium tabular-nums text-ink">
                  {perimeter.toFixed(3)} m
                </span>
              </div>
              <ul className="divide-y divide-hairline">
                {walls.map((w) => (
                  <li
                    key={w.id}
                    className="flex items-center justify-between py-2.5"
                  >
                    <div>
                      <span className="text-sm text-ink">
                        {w.position.replace("_", " ").toLowerCase()}
                      </span>
                      {w.sourceDimension && (
                        <span className="ml-2 text-xs text-ink-subtle">
                          dim {w.sourceDimension}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-medium tabular-nums text-ink">
                        {String(w.lengthM)} m
                      </span>
                      <ConfidenceDot value={w.confidence} />
                    </div>
                  </li>
                ))}
                {walls.length === 0 && (
                  <p className="py-4 text-sm text-ink-subtle">
                    No wall segments extracted.
                  </p>
                )}
              </ul>
            </div>

            {notes && (
              <div>
                <p className="eyebrow mb-2">AI notes</p>
                <p className="rounded-md border border-hairline bg-surface px-3 py-2.5 text-sm text-ink-muted">
                  {notes}
                </p>
              </div>
            )}

            <p className="border-t border-hairline pt-4 text-xs text-ink-subtle">
              Read-only in Week 1. Editing, confirm &amp; quote generation land in
              Week 4.
            </p>
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
