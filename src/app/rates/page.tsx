import { prisma } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { RatesTabs } from "@/components/rates-tabs";
import type { RateCardVM } from "@/components/rates-manager";
import type { ConstructionElementVM } from "@/components/construction/construction-rates-manager";

export const dynamic = "force-dynamic";

export default async function RatesPage() {
  const [cards, elements] = await Promise.all([
    prisma.rateCard.findMany({
      orderBy: [{ isActive: "desc" }, { effectiveFrom: "desc" }],
      relationLoadStrategy: "join",
      include: {
        items: {
          orderBy: [
            { component: "asc" },
            { band: "asc" },
            { action: "asc" },
            { liftLevel: "asc" },
          ],
        },
        stageSplits: { orderBy: [{ scenario: "asc" }, { sortOrder: "asc" }] },
      },
    }),
    prisma.constructionElement.findMany({
      orderBy: [{ line: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      relationLoadStrategy: "join",
      include: { rates: { orderBy: [{ band: "asc" }, { bracket: "asc" }] } },
    }),
  ]);

  const cardData: RateCardVM[] = cards.map((c) => ({
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
      liftLevel: i.liftLevel,
    })),
    stageSplits: c.stageSplits.map((s) => ({
      id: s.id,
      scenario: s.scenario,
      name: s.name,
      percent: Number(s.percent),
    })),
  }));

  const elementData: ConstructionElementVM[] = elements.map((e) => ({
    line: e.line,
    sourceTitle: e.sourceTitle,
    id: e.id,
    name: e.name,
    aliases: e.aliases,
    category: e.category,
    unit: e.unit,
    usesLifts: e.usesLifts,
    usesHeightBracket: e.usesHeightBracket,
    defaultRuleNote: e.defaultRuleNote,
    isActive: e.isActive,
    rates: e.rates.map((r) => ({
      id: r.id,
      band: r.band,
      bracket: r.bracket,
      rate: Number(r.rate),
      baseHireWeeks: r.baseHireWeeks,
      extraHirePerWeek: Number(r.extraHirePerWeek),
      extraHireChargePct: Number(r.extraHireChargePct),
    })),
  }));

  return (
    <AppShell>
      <RatesTabs cards={cardData} constructionElements={elementData} />
    </AppShell>
  );
}
