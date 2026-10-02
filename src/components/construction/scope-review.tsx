"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setConstructionSectionNoneRequired } from "@/server/actions/constructionReview";
import type { ConstructionQuoteVM, ConstructionRunVM } from "@/server/construction";
import type { LineStatus } from "@/lib/construction/assemble";
import { Panel, ToggleButton } from "@/components/construction/parts";

/**
 * The scope review (docs/23 §11.3): every scope line accounted for, the sections
 * the client listed with nothing under them ("confirm none required"), and what
 * the drawings show that the scope did not ask for — information, never priced.
 */

export const STATUS_LABEL: Record<LineStatus, string> = {
  MEASURED: "Measured",
  STATED: "Client's figure",
  AGREES: "Agrees with client",
  DIFFERS: "Differs from client",
  MEASURE_BY_HAND: "Measure by hand",
  UNKNOWN_BASIS: "Basis not confirmed",
  NEEDS_ITEM: "Needs an item",
};

export function ScopeReviewPanel({
  quote,
  result,
  locked,
}: {
  quote: ConstructionQuoteVM;
  result: NonNullable<ConstructionRunVM["result"]>;
  locked: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const a = result.account;
  const empty = result.emptySections ?? [];
  const info = result.info ?? [];
  const toggle = (section: string, on: boolean) =>
    start(async () => {
      await setConstructionSectionNoneRequired(quote.id, section, on);
      router.refresh();
    });

  const parts = a
    ? [
        a.measured ? `${a.measured} measured from the drawings` : null,
        a.agrees ? `${a.agrees} agree with the client` : null,
        a.differs ? `${a.differs} differ from the client` : null,
        a.stated ? `${a.stated} the client's figure` : null,
        a.measureByHand ? `${a.measureByHand} to measure by hand` : null,
        a.unknownBasis ? `${a.unknownBasis} waiting on a basis` : null,
        a.needsItem ? `${a.needsItem} need an item` : null,
      ].filter(Boolean)
    : [];

  return (
    <Panel title="Scope review">
      {a && (
        <p className="text-[13px] leading-relaxed text-ink">
          All {a.scopeLines} scope line{a.scopeLines === 1 ? "" : "s"} accounted for: {parts.join(" · ") || "none"}.
        </p>
      )}

      {empty.length > 0 && (
        <div className="mt-3">
          <p className="eyebrow mb-1.5">Listed with nothing under them</p>
          <ul className="flex flex-col">
            {empty.map((s) => {
              const on = quote.scopeReview.noneRequired.includes(s);
              return (
                <li key={s} className="flex items-center justify-between gap-3 border-t border-hairline py-2">
                  <span className="text-[13px] text-ink">
                    {s}
                    <span className="ml-2 text-[11px] text-ink-muted">{on ? "confirmed: none required" : "the client left this section empty"}</span>
                  </span>
                  {!locked && (
                    <ToggleButton on={on} disabled={pending} onClick={() => toggle(s, !on)} onLabel="None required" offLabel="Confirm none required" />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {info.length > 0 && (
        <div className="mt-3">
          <p className="eyebrow mb-1.5">On the drawings, not in the scope — not priced</p>
          <ul className="flex flex-col">
            {info.map((i, k) => (
              <li key={k} className="flex items-start justify-between gap-3 border-t border-hairline py-2">
                <span className="min-w-0">
                  <span className="block text-[13px] text-ink">
                    {i.label}
                    {i.buildingName && quote.buildings.length > 1 ? <span className="ml-1.5 text-ink-muted">· {i.buildingName}</span> : null}
                  </span>
                  <span className="block text-[11px] text-ink-muted">{i.note}</span>
                </span>
                <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink">{i.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
