import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { priceProject } from "@/lib/pricing/priceProject";

export const dynamic = "force-dynamic";

const CONFIG_LABEL: Record<string, string> = {
  DETACHED: "Detached",
  SEMI_DETACHED: "Semi",
  END_TERRACE: "End terrace",
  MID_TERRACE: "Mid terrace",
};

const gbp = (n: number) =>
  n.toLocaleString("en-GB", { style: "currency", currency: "GBP" });

export default async function PricingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    relationLoadStrategy: "join",
    include: {
      client: true,
      houseTypes: {
        include: {
          takeoff: {
            include: { measurements: true, wallSegments: true },
          },
        },
      },
      plots: true,
    },
  });
  if (!project) notFound();

  const rateCard = await prisma.rateCard.findFirst({
    where: { mode: "HOUSE_BUILD", isActive: true },
    orderBy: { effectiveFrom: "desc" },
    include: { items: true, stageSplits: true },
  });

  const pricing = priceProject({
    houseTypes: project.houseTypes.map((h) => ({
      id: h.id,
      name: h.name,
      code: h.code,
      takeoffStatus: h.takeoff?.status ?? "DRAFT",
      measurements: (h.takeoff?.measurements ?? []).map((m) => ({
        key: m.key as string,
        valueNumber: m.valueNumber !== null ? Number(m.valueNumber) : null,
      })),
      walls: (h.takeoff?.wallSegments ?? []).map((w) => ({
        position: w.position as string,
        lengthM: Number(w.lengthM),
      })),
      warnings:
        h.takeoff?.warnings && typeof h.takeoff.warnings === "object"
          ? (h.takeoff.warnings as Record<string, unknown>)
          : {},
    })),
    plots: project.plots.map((p) => ({
      id: p.id,
      plotNumber: p.plotNumber,
      houseTypeId: p.houseTypeId,
      configuration: p.configuration,
      isRendered: p.isRendered,
      hasGarage: p.hasGarage,
    })),
    rateItems: (rateCard?.items ?? []).map((i) => ({
      component: i.component,
      action: i.action,
      band: i.band,
      rate: Number(i.rate),
    })),
    stageSplits: (rateCard?.stageSplits ?? []).map((s) => ({
      scenario: s.scenario,
      name: s.name,
      percent: Number(s.percent),
    })),
    band: project.client.defaultBand,
  });

  const stageNames = pricing.plots.find((p) => p.stages.length)?.stages.map((s) => s.name) ?? [];

  return (
    <AppShell>
      <Link
        href={`/projects/${project.id}`}
        className="text-sm text-ink-muted hover:text-ink"
      >
        ← Back to project
      </Link>

      <div className="mt-4 mb-6">
        <p className="eyebrow mb-2">Pricing matrix</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{project.name}</h1>
        <p className="mt-1 text-sm text-ink-subtle">
          {project.client.name} · band {project.client.defaultBand.toLowerCase().replace("_", " ")}
          {rateCard ? ` · rate card ${rateCard.name}` : ""}
        </p>
      </div>

      {/* Flags */}
      {(!rateCard ||
        pricing.confirmedCount < pricing.plots.length ||
        pricing.unpricedComponents.length > 0 ||
        pricing.garageCount > 0) && (
        <div className="mb-6 space-y-1.5 rounded-lg border border-hairline bg-surface px-4 py-3 text-xs text-ink-muted">
          {!rateCard && (
            <p>⚠ No active house-build rate card — prices are £0. Create one under Rates.</p>
          )}
          {rateCard && pricing.unpricedComponents.length > 0 && (
            <p>
              ⚠ No rate for: {pricing.unpricedComponents.join(", ")} — those lines price at £0
              until a rate is added.
            </p>
          )}
          {pricing.confirmedCount < pricing.plots.length && (
            <p>
              ⚠ {pricing.plots.length - pricing.confirmedCount} plot(s) can’t be priced — their
              take-off isn’t confirmed yet.
            </p>
          )}
          {pricing.garageCount > 0 && (
            <p>
              ⚠ {pricing.garageCount} plot(s) have a garage — garage pricing is not applied yet
              (own staged set, pending).
            </p>
          )}
          <p>
            Shared items (loading bay, chute, access) and builder-profile extras are not yet
            applied — pending Phase 4/7.
          </p>
        </div>
      )}

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Plots</h2>
          <span className="text-xs text-ink-subtle">{pricing.plots.length}</span>
        </CardHeader>
        <CardBody className="p-0">
          {pricing.plots.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-ink-subtle">
              No plots yet — a plot list is read from the site layout.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-xs text-ink-subtle">
                    <th className="px-5 py-2.5 font-medium">Plot</th>
                    <th className="px-5 py-2.5 font-medium">House type</th>
                    <th className="px-5 py-2.5 font-medium">Config</th>
                    {stageNames.map((n) => (
                      <th key={n} className="px-3 py-2.5 text-right font-medium">
                        {n}
                      </th>
                    ))}
                    <th className="px-5 py-2.5 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {pricing.plots.map((p) => (
                    <tr key={p.plotId} className="border-b border-hairline last:border-0">
                      <td className="px-5 py-2.5 font-medium text-ink">
                        {p.plotNumber}
                        {p.hasGarage && (
                          <span className="ml-1.5 text-[11px] text-ink-subtle">+G</span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-ink-muted">
                        {p.houseTypeName}
                        {p.houseTypeCode && (
                          <span className="ml-1.5 text-ink-subtle">{p.houseTypeCode}</span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-ink-muted">
                        {CONFIG_LABEL[p.configuration] ?? p.configuration}
                      </td>
                      {p.status !== "PRICED" ? (
                        <td
                          colSpan={stageNames.length + 1}
                          className="px-5 py-2.5 text-right"
                        >
                          <Badge variant="outline">
                            {p.status === "NOT_CONFIRMED"
                              ? "Take-off not confirmed"
                              : "No house type"}
                          </Badge>
                        </td>
                      ) : (
                        <>
                          {p.stages.map((s) => (
                            <td
                              key={s.name}
                              className="px-3 py-2.5 text-right tabular-nums text-ink-muted"
                            >
                              {gbp(s.amount)}
                            </td>
                          ))}
                          <td className="px-5 py-2.5 text-right font-medium tabular-nums text-ink">
                            {gbp(p.subtotal)}
                            {p.unpricedCount > 0 && (
                              <span
                                className="ml-1 text-ink-subtle"
                                title={`${p.unpricedCount} line(s) with no rate`}
                              >
                                *
                              </span>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-hairline-strong">
                    <td
                      colSpan={3 + stageNames.length}
                      className="px-5 py-3 text-right text-xs font-medium text-ink-muted"
                    >
                      Grand total
                    </td>
                    <td className="px-5 py-3 text-right text-sm font-semibold tabular-nums text-ink">
                      {gbp(pricing.grandTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <p className="mt-3 text-[11px] text-ink-subtle">
        Stage columns are the payment-stage split (a share of the total), not the true cost of
        those items. Each plot’s stages reconcile back to its total; the plots sum to the grand
        total.
      </p>
    </AppShell>
  );
}
