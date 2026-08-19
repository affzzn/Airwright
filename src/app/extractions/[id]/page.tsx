import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { createSignedUrl } from "@/lib/supabase/storage";
import { parseRangeString } from "@/lib/pdf";
import { extractionResultSchema } from "@/lib/extract/schema";
import { AppShell } from "@/components/app-shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ReviewWorkspace } from "@/components/review-workspace";
import type { EditorCategoricals } from "@/components/takeoff-editor";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const extraction = await prisma.extraction.findUnique({
    where: { id },
    relationLoadStrategy: "join",
    include: {
      document: {
        include: {
          pack: true,
          pages: { select: { pageNumber: true, sheetTitle: true } },
        },
      },
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
  const rawWarnings =
    takeoff?.warnings && typeof takeoff.warnings === "object" && !Array.isArray(takeoff.warnings)
      ? (takeoff.warnings as Record<string, unknown>)
      : {};
  const notes = rawWarnings.notes != null ? String(rawWarnings.notes) : null;

  // Serialise the take-off for the editable client component (Prisma Decimals →
  // plain numbers). The deterministic take-off line is recomputed there, live.
  const editorMeasurements = (takeoff?.measurements ?? []).map((m) => ({
    key: m.key as string,
    valueNumber: m.valueNumber !== null ? Number(m.valueNumber) : null,
    confidence: m.confidence,
    source: m.source as string,
  }));
  const editorWalls = (takeoff?.wallSegments ?? []).map((w) => ({
    id: w.id,
    position: w.position as string,
    lengthM: Number(w.lengthM),
    confidence: w.confidence,
    sourceDimension: w.sourceDimension,
    source: w.source as string,
  }));
  const asEnum = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
    typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
  const categoricals: EditorCategoricals = {
    roofType: asEnum(rawWarnings.roofType, ["PITCHED", "HIPPED", "MIXED"] as const),
    structure: asEnum(rawWarnings.structure, [
      "SINGLE",
      "PAIR_OR_TERRACE",
      "APARTMENT_BLOCK",
    ] as const),
    dwellingsWide:
      typeof rawWarnings.dwellingsWide === "number" ? rawWarnings.dwellingsWide : null,
    roomInRoof:
      typeof rawWarnings.roomInRoof === "boolean" ? rawWarnings.roomInRoof : null,
    rendered: typeof rawWarnings.rendered === "boolean" ? rawWarnings.rendered : null,
    chimney: typeof rawWarnings.chimney === "boolean" ? rawWarnings.chimney : null,
  };

  let pdfUrl: string | null = null;
  try {
    // 4 hours, not the 10-minute default — Colin keeps a review open while he
    // cross-checks, and the zoom lightbox re-fetches this URL when opened.
    pdfUrl = await createSignedUrl(extraction.document.storagePath, 60 * 60 * 4);
  } catch {
    pdfUrl = null;
  }

  // Only show the pages that were actually relevant for this house type — the
  // exact range sent to the model — not the whole document.
  const relevantPages = extraction.pageRange
    ? parseRangeString(extraction.pageRange)
    : undefined;

  // The verbatim model output (for provenance) + the per-page sheet titles
  // (for resolving a cited sheet to a page number).
  const parsedRaw = extractionResultSchema.safeParse(extraction.rawOutput);
  const raw = parsedRaw.success ? parsedRaw.data : null;
  const documentPages = extraction.document.pages.map((p) => ({
    pageNumber: p.pageNumber,
    sheetTitle: p.sheetTitle,
  }));

  return (
    <AppShell>
      <Link
        href={`/projects/${extraction.document.pack.projectId}`}
        className="text-sm text-ink-muted hover:text-ink"
      >
        ← Back to project
      </Link>

      <div className="mt-4 mb-8">
        <p className="eyebrow mb-2">Review</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {extraction.houseType?.name ?? "Extraction"}
        </h1>
        <p className="mt-1 text-sm text-ink-subtle">
          {extraction.document.fileName} · pages{" "}
          {extraction.pageRange ?? "all"} of {extraction.document.pageCount}
        </p>
      </div>

      {takeoff ? (
        <ReviewWorkspace
          pdfUrl={pdfUrl}
          relevantPages={relevantPages}
          takeoffId={takeoff.id}
          measurements={editorMeasurements}
          walls={editorWalls}
          warnings={rawWarnings}
          categoricals={categoricals}
          notes={notes}
          raw={raw}
          documentPages={documentPages}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-ink">Drawing</h2>
            </CardHeader>
            <CardBody>
              <p className="py-10 text-center text-sm text-ink-subtle">
                Drawing preview unavailable.
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-ink">Extracted take-off</h2>
            </CardHeader>
            <CardBody>
              <p className="py-4 text-sm text-ink-subtle">
                No take-off yet — the extraction hasn’t completed.
              </p>
            </CardBody>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
