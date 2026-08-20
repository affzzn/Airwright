import { prisma } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import {
  ProjectsWorkspace,
  type ProjectStatus,
  type WorkspaceProject,
} from "@/components/projects-workspace";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    relationLoadStrategy: "join",
    include: {
      client: { select: { name: true } },
      _count: { select: { houseTypes: true, plots: true, quotes: true } },
      packs: {
        select: {
          uploads: { select: { status: true } },
          documents: { select: { classifiedAt: true, isReadable: true } },
        },
      },
      houseTypes: { select: { extractions: { select: { status: true } } } },
    },
  });

  const items: WorkspaceProject[] = projects.map((p) => {
    const exts = p.houseTypes.flatMap((h) => h.extractions);
    const extTotal = exts.length;
    const extDone = exts.filter((e) => e.status === "COMPLETED").length;
    const uploadsPending = p.packs.some((pk) =>
      pk.uploads.some((u) => u.status === "PENDING"),
    );
    const unclassified = p.packs.some((pk) =>
      pk.documents.some((d) => d.classifiedAt === null && d.isReadable),
    );
    const running = exts.some(
      (e) => e.status === "PENDING" || e.status === "PROCESSING",
    );

    let status: ProjectStatus;
    if (p._count.quotes > 0) status = "QUOTED";
    else if (uploadsPending || unclassified || running) status = "READING";
    else if (extDone > 0) status = "READY";
    else status = "NEW";

    return {
      id: p.id,
      name: p.name,
      clientName: p.client.name,
      mode: p.estimatingMode,
      houseTypes: p._count.houseTypes,
      plots: p._count.plots,
      createdAt: p.createdAt.toISOString(),
      archived: p.archivedAt !== null,
      status,
      extDone,
      extTotal,
    };
  });

  return (
    <AppShell>
      <ProjectsWorkspace projects={items} />
    </AppShell>
  );
}
