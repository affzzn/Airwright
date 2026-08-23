import { prisma } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { RatesManager, type RateCardVM } from "@/components/rates-manager";

export const dynamic = "force-dynamic";

export default async function RatesPage() {
  const cards = await prisma.rateCard.findMany({
    orderBy: [{ isActive: "desc" }, { effectiveFrom: "desc" }],
    relationLoadStrategy: "join",
    include: {
      items: { orderBy: [{ component: "asc" }, { band: "asc" }, { action: "asc" }] },
      stageSplits: { orderBy: [{ scenario: "asc" }, { sortOrder: "asc" }] },
    },
  });

  const data: RateCardVM[] = cards.map((c) => ({
    id: c.id,
    name: c.name,
    mode: c.mode,
    effectiveFrom: c.effectiveFrom.toISOString(),
    isActive: c.isActive,
    items: c.items.map((i) => ({
      id: i.id,
      rateCardId: c.id,
      component: i.component,
      action: i.action,
      band: i.band,
      unit: i.unit,
      rate: Number(i.rate),
    })),
    stageSplits: c.stageSplits.map((s) => ({
      id: s.id,
      scenario: s.scenario,
      name: s.name,
      percent: Number(s.percent),
    })),
  }));

  return (
    <AppShell>
      <RatesManager cards={data} />
    </AppShell>
  );
}
