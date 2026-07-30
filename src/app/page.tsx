import Link from "next/link";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { createProject } from "@/server/actions/projects";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      client: true,
      _count: { select: { houseTypes: true, plots: true } },
    },
  });

  return (
    <AppShell>
      <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
        <section>
          <p className="eyebrow mb-2">Projects</p>
          <h1 className="mb-6 text-2xl font-semibold tracking-tight text-ink">
            Tenders
          </h1>

          {projects.length === 0 ? (
            <Card>
              <CardBody className="py-14 text-center text-sm text-ink-subtle">
                No projects yet. Create one to upload a tender pack.
              </CardBody>
            </Card>
          ) : (
            <div className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline">
              {projects.map((p) => (
                <Link
                  key={p.id}
                  href={`/projects/${p.id}`}
                  className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-surface"
                >
                  <div>
                    <p className="text-sm font-medium text-ink">{p.name}</p>
                    <p className="mt-0.5 text-xs text-ink-subtle">
                      {p.client.name} · {p.estimatingMode === "CONSTRUCTION" ? "Construction" : "House build"}
                    </p>
                  </div>
                  <div className="text-right text-xs text-ink-subtle">
                    <p>{p._count.houseTypes} house types</p>
                    <p className="mt-0.5">{formatDate(p.createdAt)}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <aside>
          <Card>
            <CardBody>
              <p className="eyebrow mb-3">New project</p>
              <form action={createProject} className="space-y-4">
                <div>
                  <Label htmlFor="clientName">House builder</Label>
                  <Input
                    id="clientName"
                    name="clientName"
                    required
                    placeholder="Miller Homes"
                  />
                </div>
                <div>
                  <Label htmlFor="projectName">Project / development</Label>
                  <Input
                    id="projectName"
                    name="projectName"
                    required
                    placeholder="Chesterwood Phase 2"
                  />
                </div>
                <div>
                  <Label htmlFor="mode">Estimating mode</Label>
                  <Select id="mode" name="mode" defaultValue="HOUSE_BUILD">
                    <option value="HOUSE_BUILD">House build</option>
                    <option value="CONSTRUCTION">Construction</option>
                  </Select>
                </div>
                <Button type="submit" className="w-full">
                  Create project
                </Button>
              </form>
            </CardBody>
          </Card>
        </aside>
      </div>
    </AppShell>
  );
}
