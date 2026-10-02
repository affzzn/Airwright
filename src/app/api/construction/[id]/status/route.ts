import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Cheap status probe for a construction job (docs/22 §4.9) — the page polls THIS,
 * not a full re-render, and refreshes only when the signature changes (the
 * CLAUDE.md "never setInterval(router.refresh())" rule). Status columns only.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const q = await prisma.constructionQuote.findUnique({
    where: { id },
    relationLoadStrategy: "join",
    select: {
      ingestStatus: true,
      mode: true,
      attachments: { select: { id: true, bucket: true } },
      readRuns: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, progress: true, costUsd: true },
      },
    },
  });
  if (!q) return NextResponse.json({ active: false, signature: "none" }, { status: 404 });
  const run = q.readRuns[0] ?? null;
  const unsorted = q.attachments.some((a) => a.bucket == null);
  const active =
    q.ingestStatus === "QUEUED" || q.ingestStatus === "RUNNING" || run?.status === "QUEUED" || run?.status === "RUNNING";
  const progress = (run?.progress ?? null) as { total?: number; done?: number; failed?: number; current?: string | null } | null;
  const signature = JSON.stringify({
    i: q.ingestStatus,
    m: q.mode,
    a: q.attachments.length,
    u: unsorted,
    r: run ? `${run.id}:${run.status}:${progress?.done ?? 0}:${progress?.failed ?? 0}` : "",
  });
  return NextResponse.json({
    active,
    signature,
    ingestStatus: q.ingestStatus,
    run: run ? { id: run.id, status: run.status, progress, costUsd: Number(run.costUsd) } : null,
  });
}
