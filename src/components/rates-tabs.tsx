"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { RatesManager, type RateCardVM } from "@/components/rates-manager";
import {
  ConstructionRatesManager,
  type ConstructionElementVM,
} from "@/components/construction/construction-rates-manager";

type Tab = "traditional" | "timber" | "construction";
const TABS: { id: Tab; label: string }[] = [
  { id: "traditional", label: "Traditional" },
  { id: "timber", label: "Timber frame" },
  { id: "construction", label: "Construction" },
];

/**
 * The Rates screen, split into three tabs (docs/19 §9). Traditional and Timber
 * frame are two views over the house-build rate cards (filtered by build system);
 * Construction is the separate scaffold-element picking-list library.
 */
export function RatesTabs({
  cards,
  constructionElements,
}: {
  cards: RateCardVM[];
  constructionElements: ConstructionElementVM[];
}) {
  const [tab, setTab] = useState<Tab>("traditional");

  return (
    <div>
      <p className="eyebrow mb-1">Admin</p>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight text-ink">Rates</h1>

      <div className="mb-6 flex gap-1 border-b border-hairline">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              tab === t.id
                ? "border-ink font-medium text-ink"
                : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "construction" ? (
        <ConstructionRatesManager elements={constructionElements} />
      ) : (
        <RatesManager cards={cards} view={tab} />
      )}
    </div>
  );
}
