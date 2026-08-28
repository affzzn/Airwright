import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Cheap pack-status probe for the project page's live poller. Returns only what
 * the poller needs — `active` (is the pipeline still working) and a `signature`
 * that changes whenever the visible state changes — so the client can decide
 * when to trigger the (expensive) full server re-render, instead of hammering it
 * on every tick. Selects only status columns, so it stays fast.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // One joined query (relationJoins) — status columns only, so it stays cheap.
  const project = await prisma.project.findUnique({
    where: { id },
    relationLoadStrategy: "join",
    select: {
      packs: {
        orderBy: { version: "asc" },
        take: 1,
        select: {
          groupingStatus: true,
          uploads: { select: { status: true } },
          documents: {
            select: {
              id: true,
              classifiedAt: true,
              isReadable: true,
              category: true,
              included: true,
              kind: true,
            },
          },
        },
      },
      houseTypes: {
        select: { id: true, extractions: { select: { status: true, documentId: true } } },
      },
    },
  });

  const pack = project?.packs[0];
  if (!pack) return NextResponse.json({ active: false, signature: "none" });

  const uploads = pack.uploads;
  const documents = pack.documents;
  const houseTypes = project!.houseTypes;
  const extractions = houseTypes.flatMap((h) => h.extractions);

  const groupingStatus = pack.groupingStatus;
  const grouping = groupingStatus === "GROUPING";
  const awaitingConfirm = groupingStatus === "PROPOSED"; // waiting on a human — idle

  const uploadsPending = uploads.some((u) => u.status === "PENDING");
  const unclassified = documents.some((d) => d.classifiedAt === null && d.isReadable);
  const extractionsRunning = extractions.some(
    (e) => e.status === "PROCESSING" || (e.status === "PENDING" && !awaitingConfirm),
  );
  // The window after classification, before grouping has run (worker about to group).
  const sourceDocs = documents.filter((d) => d.kind !== "ASSEMBLED");
  const preGroup =
    groupingStatus === null &&
    sourceDocs.length > 0 &&
    !unclassified &&
    sourceDocs.some((d) => d.included && d.classifiedAt !== null);

  const active =
    uploadsPending || unclassified || grouping || preGroup || (!awaitingConfirm && extractionsRunning);

  const signature = JSON.stringify({
    g: groupingStatus ?? "",
    u: uploads.map((u) => u.status).sort(),
    d: documents
      .map((d) => `${d.id}:${d.classifiedAt ? 1 : 0}:${d.category}:${d.included ? 1 : 0}`)
      .sort(),
    e: extractions.map((e) => `${e.documentId}:${e.status}`).sort(),
    h: houseTypes.length,
  });

  return NextResponse.json({ active, signature });
}
