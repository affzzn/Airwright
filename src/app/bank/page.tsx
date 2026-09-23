import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listBankEntries } from "@/server/bank";

export const dynamic = "force-dynamic";

/**
 * The House-Type Bank browse (docs/20 §7) — the shared, company-owned library of
 * confirmed take-offs, grouped by client. House-build only.
 */
export default async function BankPage({
  searchParams,
}: {
  searchParams: Promise<{ build?: string; archived?: string }>;
}) {
  const sp = await searchParams;
  const buildFilter =
    sp.build === "TIMBER_FRAME" ? "TIMBER_FRAME" : sp.build === "TRADITIONAL" ? "TRADITIONAL" : undefined;
  const includeArchived = sp.archived === "1";

  const entries = await listBankEntries({ buildType: buildFilter, includeArchived });

  // Group by client for a scannable library.
  const byClient = new Map<string, typeof entries>();
  for (const e of entries) {
    const list = byClient.get(e.clientName) ?? [];
    list.push(e);
    byClient.set(e.clientName, list);
  }
  const clients = [...byClient.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const filterHref = (build?: string) => {
    const params = new URLSearchParams();
    if (build) params.set("build", build);
    if (includeArchived) params.set("archived", "1");
    const q = params.toString();
    return q ? `/bank?${q}` : "/bank";
  };

  return (
    <AppShell>
      <div className="mb-6">
        <p className="eyebrow mb-2">House Building</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">House-Type Bank</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-subtle">
          Confirmed take-offs, owned by the company and reused across tenders. When a repeat
          arrives it is matched on its measurements — not just its name — and any drawing change
          is flagged for a sense-check.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        {[
          { label: "All", build: undefined },
          { label: "Traditional", build: "TRADITIONAL" },
          { label: "Timber frame", build: "TIMBER_FRAME" },
        ].map((f) => {
          const active = (f.build ?? undefined) === buildFilter;
          return (
            <Link
              key={f.label}
              href={filterHref(f.build)}
              className={
                active
                  ? "rounded-full border border-ink bg-ink px-3 py-1 font-medium text-canvas"
                  : "rounded-full border border-hairline-strong px-3 py-1 text-ink-muted hover:bg-surface"
              }
            >
              {f.label}
            </Link>
          );
        })}
        <span className="mx-1 h-4 w-px bg-hairline" aria-hidden />
        <Link
          href={
            includeArchived
              ? filterHref(buildFilter).replace(/([?&])archived=1&?/, "$1").replace(/[?&]$/, "")
              : `${filterHref(buildFilter)}${filterHref(buildFilter).includes("?") ? "&" : "?"}archived=1`
          }
          className={
            includeArchived
              ? "rounded-full border border-ink bg-ink px-3 py-1 font-medium text-canvas"
              : "rounded-full border border-hairline-strong px-3 py-1 text-ink-muted hover:bg-surface"
          }
        >
          Show archived
        </Link>
      </div>

      {clients.length === 0 ? (
        <Card>
          <CardBody>
            <p className="py-10 text-center text-sm text-ink-subtle">
              The bank is empty. Confirm a house-build take-off and it is saved here automatically.
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-6">
          {clients.map(([clientName, list]) => (
            <Card key={clientName}>
              <CardHeader className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink">{clientName}</h2>
                <span className="text-xs text-ink-subtle">
                  {list.length} type{list.length === 1 ? "" : "s"}
                </span>
              </CardHeader>
              <CardBody className="p-0">
                <ul className="divide-y divide-hairline">
                  {list.map((e) => (
                    <li key={e.id}>
                      <Link
                        href={`/bank/${e.id}`}
                        className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-surface"
                      >
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 text-sm font-medium text-ink">
                            <span className="truncate">{e.canonicalName}</span>
                            {e.canonicalCode && (
                              <span className="text-xs text-ink-subtle">{e.canonicalCode}</span>
                            )}
                            {e.status === "ARCHIVED" && <Badge variant="outline">Archived</Badge>}
                          </p>
                          <p className="mt-0.5 text-xs text-ink-subtle">
                            {e.buildType === "TIMBER_FRAME" ? "Timber frame" : "Traditional"}
                            {e.storeys != null && ` · ${e.storeys}-storey`}
                            {e.perimeter != null && ` · ${e.perimeter} m perimeter`}
                            {e.aliases.length > 0 && ` · also: ${e.aliases.slice(0, 3).join(", ")}`}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-4 text-xs text-ink-subtle">
                          <span title="Snapshot versions">
                            v{e.versions}
                          </span>
                          <span title="Times reused into a tender">
                            {e.timesReused > 0 ? `reused ${e.timesReused}×` : "—"}
                          </span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
