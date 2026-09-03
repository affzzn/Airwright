import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HoverAmount, type BreakdownRow } from "@/components/ui/hover-amount";
import { isInclusionComponent } from "@/lib/pricing/engine";
import { aggregateInclusions } from "@/lib/pricing/matrix";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const CONFIG_LABEL: Record<string, string> = {
  DETACHED: "Detached",
  SEMI_DETACHED: "Semi",
  END_TERRACE: "End terrace",
  MID_TERRACE: "Mid terrace",
};
const gbp = (n: number) =>
  n.toLocaleString("en-GB", { style: "currency", currency: "GBP" });

// Payment stages render in a fixed order (matches the Excel + the pricing page).
const STAGE_SORT: Record<string, number> = { "Plot Erect": 0, "Birdcage Erect": 1, Dismantle: 2 };

// Cost buckets for the hover breakdown — group the frozen detail lines into the
// few headline numbers a reader wants behind a total. Inclusions are counted
// separately (they're covered by the rates, not a separate charge).
type Li = { component: string | null; action: string | null; amount: unknown };
const BUCKETS: { label: string; match: (l: Li) => boolean }[] = [
  { label: "External scaffold", match: (l) => (l.component === "LIFT" || l.component === "TF_EXTERNAL") && l.action === "ERECT" },
  // Timber-frame adaptions (docs/18) — the two LM lines; the legacy ADAPTION is kept
  // so quotes frozen before the split still bucket correctly.
  {
    label: "Adaptions",
    match: (l) =>
      (l.component === "ADAPTION" ||
        l.component === "ADAPTION_INSIDE_BOARD" ||
        l.component === "ADAPTION_HOP_UP") &&
      l.action === "ERECT",
  },
  { label: "Apex (table lift / scaffold + rails)", match: (l) => (l.component === "TABLE_LIFT" || l.component === "GABLE" || l.component === "GABLE_RAILS") && l.action === "ERECT" },
  { label: "Render adaption", match: (l) => l.component === "RENDER_ADAPTION" },
  { label: "Birdcage erect", match: (l) => !!l.component?.startsWith("BIRDCAGE_") && l.action === "ERECT" },
  { label: "Birdcage strip", match: (l) => !!l.component?.startsWith("BIRDCAGE_") && l.action === "DISMANTLE" },
  { label: "External dismantle", match: (l) => (l.component === "LIFT" || l.component === "TF_EXTERNAL") && l.action === "DISMANTLE" },
];
function breakdown(lines: Li[]): { rows: BreakdownRow[]; inclusionTotal: number } {
  const rows: BreakdownRow[] = [];
  for (const b of BUCKETS) {
    const amt = lines.filter((l) => b.match(l)).reduce((a, l) => a + Number(l.amount), 0);
    if (Math.round(amt * 100) !== 0) rows.push({ label: b.label, value: gbp(amt) });
  }
  const inclusionTotal = lines
    .filter((l) => l.component && isInclusionComponent(l.component))
    .reduce((a, l) => a + Number(l.amount), 0);
  return { rows, inclusionTotal };
}
const inclusionNote = (total: number): string | undefined =>
  total > 0
    ? `Plus ${gbp(total)} standard inclusions (covered by the rates — not charged separately).`
    : undefined;

export default async function QuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const quote = await prisma.quote.findUnique({
    where: { id },
    relationLoadStrategy: "join",
    include: {
      project: { include: { client: true } },
      rateCard: { select: { name: true } },
      lineItems: {
        include: {
          plot: { include: { houseType: { select: { name: true, code: true } } } },
        },
      },
    },
  });
  if (!quote) notFound();

  // The plot matrix + house-type summary are the MAIN section only; garages are a
  // separate section folded into the grand total (docs/15 §6).
  const stageRows = quote.lineItems.filter((li) => li.stage && li.group !== "GARAGE");
  const detailRows = quote.lineItems.filter((li) => li.component && !li.stage && li.group !== "GARAGE");
  const garageTotal = quote.lineItems
    .filter((li) => li.group === "GARAGE" && li.component && !li.stage)
    .reduce((a, li) => a + Number(li.amount), 0);

  // True-cost detail lines grouped per plot — the backing for the hover breakdown.
  const linesByPlot = new Map<string, Li[]>();
  for (const li of detailRows) {
    if (!li.plotId) continue;
    (linesByPlot.get(li.plotId) ?? linesByPlot.set(li.plotId, []).get(li.plotId)!).push(li);
  }

  // Per-plot stage matrix.
  const stageNames: string[] = [];
  const byPlot = new Map<
    string,
    {
      plotId: string;
      plotNumber: string;
      houseTypeName: string;
      houseTypeCode: string | null;
      config: string;
      stages: Map<string, number>;
    }
  >();
  for (const li of stageRows) {
    if (!li.plot || !li.stage) continue;
    if (!stageNames.includes(li.stage)) stageNames.push(li.stage);
    const k = li.plot.id;
    if (!byPlot.has(k))
      byPlot.set(k, {
        plotId: li.plot.id,
        plotNumber: li.plot.plotNumber,
        houseTypeName: li.plot.houseType.name,
        houseTypeCode: li.plot.houseType.code,
        config: li.plot.configuration,
        stages: new Map(),
      });
    byPlot.get(k)!.stages.set(li.stage, Number(li.amount));
  }
  stageNames.sort((a, b) => (STAGE_SORT[a] ?? 9) - (STAGE_SORT[b] ?? 9));
  const plots = [...byPlot.values()].sort((a, b) => {
    const na = parseInt(a.plotNumber, 10);
    const nb = parseInt(b.plotNumber, 10);
    if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
    return a.plotNumber.localeCompare(b.plotNumber);
  });

  // Summary by house type — the CHARGED total (columned lines only; inclusions
  // are covered by the rates and listed separately, so excluded here).
  const byHt = new Map<
    string,
    { code: string | null; plots: Set<string>; total: number; lines: Li[] }
  >();
  for (const li of detailRows) {
    const name = li.plot?.houseType.name ?? "—";
    if (!byHt.has(name))
      byHt.set(name, { code: li.plot?.houseType.code ?? null, plots: new Set(), total: 0, lines: [] });
    const e = byHt.get(name)!;
    if (li.plotId) e.plots.add(li.plotId);
    e.lines.push(li);
    if (!(li.component && isInclusionComponent(li.component))) e.total += Number(li.amount);
  }
  const houseTypes = [...byHt.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  // Standard inclusions (P6) — listed once, informational, not in any total.
  const inclusions = aggregateInclusions(
    detailRows
      .filter((li) => li.component && isInclusionComponent(li.component))
      .map((li) => ({
        component: li.component as string,
        quantity: Number(li.quantity),
        plotNumber: li.plot?.plotNumber ?? "—",
      })),
  );

  return (
    <AppShell>
      <div className="print:hidden">
        <Link
          href={`/projects/${quote.projectId}/pricing`}
          className="text-sm text-ink-muted hover:text-ink"
        >
          ← Back to pricing
        </Link>
      </div>

      <div className="mt-4 mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">Quote v{quote.version}</p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {quote.project.name}
          </h1>
          <p className="mt-1 text-sm text-ink-subtle">
            {quote.project.client.name} · band{" "}
            {quote.band.toLowerCase().replace("_", " ")} · {formatDate(quote.createdAt)}
            {quote.rateCard ? ` · ${quote.rateCard.name}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Badge variant="muted">{quote.status.toLowerCase()}</Badge>
          <a href={`/quotes/${quote.id}/export`}>
            <Button variant="secondary" className="gap-2">
              Export Excel
            </Button>
          </a>
        </div>
      </div>

      {/* Summary by house type */}
      <Card className="mb-6">
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Summary by house type</h2>
          <span className="text-xs text-ink-subtle">{houseTypes.length}</span>
        </CardHeader>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs text-ink-subtle">
                  <th className="px-5 py-2.5 font-medium">House type</th>
                  <th className="px-5 py-2.5 text-right font-medium">Plots</th>
                  <th className="px-5 py-2.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {houseTypes.map(([name, e]) => {
                  const bd = breakdown(e.lines);
                  return (
                    <tr key={name} className="border-b border-hairline last:border-0">
                      <td className="px-5 py-2.5 text-ink">
                        {name}
                        {e.code && <span className="ml-1.5 text-ink-subtle">{e.code}</span>}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-ink-muted">
                        {e.plots.size}
                      </td>
                      <td className="px-5 py-2.5 text-right font-medium tabular-nums text-ink">
                        <HoverAmount
                          display={gbp(e.total)}
                          title={`${name} — breakdown`}
                          rows={bd.rows}
                          note={inclusionNote(bd.inclusionTotal)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* Pricing matrix (per plot, stage split) */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Pricing matrix</h2>
          <span className="text-xs text-ink-subtle">{plots.length} plots</span>
        </CardHeader>
        <CardBody className="p-0">
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
                {plots.map((p) => {
                  const total = [...p.stages.values()].reduce((a, v) => a + v, 0);
                  const bd = breakdown(linesByPlot.get(p.plotId) ?? []);
                  return (
                    <tr key={p.plotNumber} className="border-b border-hairline last:border-0">
                      <td className="px-5 py-2.5 font-medium text-ink">{p.plotNumber}</td>
                      <td className="px-5 py-2.5 text-ink-muted">
                        {p.houseTypeName}
                        {p.houseTypeCode && (
                          <span className="ml-1.5 text-ink-subtle">{p.houseTypeCode}</span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-ink-muted">
                        {CONFIG_LABEL[p.config] ?? p.config}
                      </td>
                      {stageNames.map((n) => {
                        const amount = p.stages.get(n) ?? 0;
                        const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
                        return (
                          <td key={n} className="px-3 py-2.5 text-right tabular-nums text-ink-muted">
                            <HoverAmount
                              display={gbp(amount)}
                              note={`${n} — ${pct}% of the ${gbp(total)} plot total (a payment-stage share, not item cost).`}
                            />
                          </td>
                        );
                      })}
                      <td className="px-5 py-2.5 text-right font-medium tabular-nums text-ink">
                        <HoverAmount
                          display={gbp(total)}
                          title={`Plot ${p.plotNumber} — breakdown`}
                          rows={bd.rows}
                          note={inclusionNote(bd.inclusionTotal)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                {garageTotal > 0 && (
                  <tr className="border-t border-hairline">
                    <td
                      colSpan={3 + stageNames.length}
                      className="px-5 py-2 text-right text-xs text-ink-subtle"
                    >
                      Garages (separate section)
                    </td>
                    <td className="px-5 py-2 text-right text-sm tabular-nums text-ink-muted">
                      {gbp(garageTotal)}
                    </td>
                  </tr>
                )}
                <tr className="border-t border-hairline-strong">
                  <td
                    colSpan={3 + stageNames.length}
                    className="px-5 py-3 text-right text-xs font-medium text-ink-muted"
                  >
                    Grand total
                  </td>
                  <td className="px-5 py-3 text-right text-sm font-semibold tabular-nums text-ink">
                    {gbp(Number(quote.total))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardBody>
      </Card>

      {inclusions.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <h2 className="text-sm font-semibold text-ink">Standard inclusions</h2>
          </CardHeader>
          <CardBody className="p-0">
            <p className="border-b border-hairline px-5 py-2 text-[11px] text-ink-subtle">
              Included in the rates — no separate charge.
            </p>
            <ul className="divide-y divide-hairline">
              {inclusions.map((inc) => (
                <li key={inc.component} className="flex items-center justify-between px-5 py-2.5 text-sm">
                  <span className="text-ink">{inc.label}</span>
                  <span className="text-xs text-ink-subtle">
                    {inc.totalQty} · plot{inc.plots.length === 1 ? "" : "s"} {inc.plots.join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <p className="mt-3 text-[11px] text-ink-subtle">
        Immutable snapshot — quantities and rates are frozen at quote time. Stage columns are the
        payment-stage split (a share of the total), not the true item cost. Hover any figure for its
        breakdown.
      </p>
    </AppShell>
  );
}
