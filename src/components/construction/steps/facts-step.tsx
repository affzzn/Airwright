"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import {
  addConstructionLineFromElement,
  updateConstructionQuote,
} from "@/server/actions/construction";
import type { ConstructionElementLibVM, ConstructionQuoteVM } from "@/server/construction";
import {
  HAKI_LIFTS,
  foamCount,
  heightBracketFor,
  inspectionWeeks,
  needsScaffoldMat,
  suggestedLiftsFor,
} from "@/lib/construction/rules";
import {
  BAND_LABEL,
  BRACKET_LABEL,
  SITE_TYPE_LABEL,
  type HeightBracket,
  type RateBand,
  type SiteType,
} from "@/lib/construction/types";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field, Panel } from "@/components/construction/parts";
import { cn, formatGBP } from "@/lib/utils";

/**
 * Step 2 — the site facts the rules key off (docs/19 §8). Each field shows what
 * it changes, so the engine's behaviour is visible rather than implied.
 */

const SITE_EFFECT: Record<SiteType, string> = {
  SCHOOL: "Suggests a scaffold mat",
  PUBLIC_STREET: "Suggests a scaffold mat",
  CONSTRUCTION_SITE: "No access rules",
  COMMERCIAL: "No access rules",
  OTHER: "No access rules",
};
const SITE_ORDER: SiteType[] = ["SCHOOL", "PUBLIC_STREET", "CONSTRUCTION_SITE", "COMMERCIAL"];

const BRACKETS = (Object.keys(BRACKET_LABEL) as HeightBracket[]).filter((b) => b !== "ANY");

export function FactsStep({
  quote,
  library,
  locked,
  compact,
  extraHirePerWeek,
}: {
  quote: ConstructionQuoteVM;
  library: ConstructionElementLibVM[];
  locked: boolean;
  /** True when the drawing pane is open: stack instead of squeezing. */
  compact: boolean;
  extraHirePerWeek: number | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const save = (patch: Parameters<typeof updateConstructionQuote>[1]) =>
    start(async () => {
      await updateConstructionQuote(quote.id, patch);
      router.refresh();
    });

  const bracket = (quote.defaultHeightBracket as HeightBracket | null) ?? null;
  const derived = heightBracketFor(quote.buildingHeightM);
  const lifts = suggestedLiftsFor(quote.buildingHeightM);
  const foam = foamCount(quote.doorwayCount, quote.fireExitCount, quote.pedestrianAccessCount);
  const foamEl = library.find((e) => /foam/i.test(e.name));
  const hasFoamLine = quote.lines.some((l) => /foam/i.test(l.description));
  const weeks = inspectionWeeks(quote.durationWeeks);

  const addFoam = () =>
    start(async () => {
      if (!foamEl) return;
      await addConstructionLineFromElement(quote.id, {
        elementId: foamEl.id,
        quantity: foam,
        lifts: null,
        bracket,
      });
      router.refresh();
    });

  const rules: string[] = [];
  if (bracket) rules.push(`Bracketed rates price in the ${BRACKET_LABEL[bracket]} band`);
  rules.push(`A Haki stair tower counts as ${HAKI_LIFTS} lifts`);
  rules.push("Roof and building edges default to a triple handrail");
  rules.push("Loading bays, Haki towers and chutes price per lift");
  if (needsScaffoldMat(quote.siteType as SiteType | null))
    rules.push("A scaffold mat is suggested for the first lift");
  if (weeks > 0) rules.push(`${weeks} weekly inspection${weeks === 1 ? "" : "s"} can be added`);
  if (foam > 0 && !hasFoamLine) rules.push("Foam is never priced for you");

  return (
    <div className={cn("grid gap-4", !compact && "xl:grid-cols-3")}>
      <div className={cn("flex flex-col gap-4", !compact && "xl:col-span-2")}>
        <Panel title="Job">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Reference" htmlFor="f-ref">
              <TextField
                id="f-ref"
                value={quote.reference}
                disabled={locked}
                onSave={(v) => save({ reference: v })}
              />
            </Field>
            <Field label="Customer" htmlFor="f-cust">
              <TextField
                id="f-cust"
                value={quote.customerName}
                disabled={locked}
                onSave={(v) => save({ customerName: v })}
              />
            </Field>
            <Field label="Site address" htmlFor="f-site">
              <TextField
                id="f-site"
                value={quote.siteAddress}
                disabled={locked}
                onSave={(v) => save({ siteAddress: v })}
              />
            </Field>
            <Field label="Rate band" htmlFor="f-band">
              <Select
                id="f-band"
                value={quote.band}
                disabled={locked}
                onChange={(e) => save({ band: e.target.value })}
              >
                {(Object.keys(BAND_LABEL) as RateBand[]).map((b) => (
                  <option key={b} value={b}>
                    {BAND_LABEL[b]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Panel>

        <Panel title="Site type">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {SITE_ORDER.map((s) => {
              const on = quote.siteType === s;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={locked}
                  onClick={() => save({ siteType: on ? null : s })}
                  className={cn(
                    "rounded-xl border px-3.5 py-3 text-left transition-colors disabled:opacity-60",
                    on
                      ? "border-ink bg-ink text-canvas"
                      : "border-hairline bg-canvas text-ink hover:border-hairline-strong",
                  )}
                >
                  <span className="block text-[13px] font-semibold">{SITE_TYPE_LABEL[s]}</span>
                  <span className={cn("mt-1 block text-[11px] leading-snug", on ? "text-canvas/70" : "text-ink-muted")}>
                    {SITE_EFFECT[s]}
                  </span>
                </button>
              );
            })}
          </div>
        </Panel>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Height and band">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Building height (m)" htmlFor="f-height">
                <NumberField
                  id="f-height"
                  value={quote.buildingHeightM}
                  disabled={locked}
                  onSave={(v) =>
                    save({
                      buildingHeightM: v,
                      // Adopt the derived band when none has been chosen yet.
                      ...(bracket ? {} : { defaultHeightBracket: heightBracketFor(v) }),
                    })
                  }
                />
              </Field>
              <Field label="Rate band" htmlFor="f-bracket">
                <Select
                  id="f-bracket"
                  value={bracket ?? ""}
                  disabled={locked}
                  onChange={(e) => save({ defaultHeightBracket: e.target.value || null })}
                >
                  <option value="">Not set</option>
                  {BRACKETS.map((b) => (
                    <option key={b} value={b}>
                      {BRACKET_LABEL[b]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Readout>
              {quote.buildingHeightM != null ? (
                <>
                  {derived && (!bracket || bracket === derived)
                    ? `Prices in the ${BRACKET_LABEL[derived]} band`
                    : bracket
                      ? `Prices in the ${BRACKET_LABEL[bracket]} band`
                      : "No band set"}
                  {lifts != null ? `, about ${lifts} lift${lifts === 1 ? "" : "s"}` : ""}
                </>
              ) : (
                "Measure the height, or pick a band"
              )}
            </Readout>
          </Panel>

          <Panel title="Hire">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Inclusive weeks" htmlFor="f-weeks">
                <NumberField
                  id="f-weeks"
                  value={quote.durationWeeks}
                  disabled={locked}
                  onSave={(v) => save({ durationWeeks: v })}
                />
              </Field>
              <Field label="Extra hire (% a week)" htmlFor="f-extra">
                <NumberField
                  id="f-extra"
                  step="0.01"
                  value={quote.extraHirePctPerWeek}
                  disabled={locked}
                  onSave={(v) => save({ extraHirePctPerWeek: v })}
                />
              </Field>
            </div>
            <Readout>
              {weeks > 0 ? `${weeks} weekly inspection${weeks === 1 ? "" : "s"}` : "No duration set"}
              {extraHirePerWeek != null ? `, then ${formatGBP(extraHirePerWeek)} a week` : ""}
            </Readout>
          </Panel>
        </div>

        <Panel
          title="Access points"
          action={
            !locked && foamEl && foam > 0 && !hasFoamLine ? (
              <Button variant="secondary" size="sm" onClick={addFoam} disabled={pending} className="gap-1.5">
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
                Add foam for {foam}
              </Button>
            ) : hasFoamLine ? (
              <span className="text-xs font-semibold text-ink-muted">Foam priced</span>
            ) : undefined
          }
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Doorways" htmlFor="f-door">
              <NumberField
                id="f-door"
                value={quote.doorwayCount}
                disabled={locked}
                onSave={(v) => save({ doorwayCount: v })}
              />
            </Field>
            <Field label="Fire exits" htmlFor="f-fire">
              <NumberField
                id="f-fire"
                value={quote.fireExitCount}
                disabled={locked}
                onSave={(v) => save({ fireExitCount: v })}
              />
            </Field>
            <Field label="Walk unders" htmlFor="f-ped">
              <NumberField
                id="f-ped"
                value={quote.pedestrianAccessCount}
                disabled={locked}
                onSave={(v) => save({ pedestrianAccessCount: v })}
              />
            </Field>
          </div>
        </Panel>
      </div>

      <Panel
        title="Rules that apply"
        className={cn(!compact && "xl:sticky xl:top-20 xl:self-start")}
      >
        <ul className="flex flex-col gap-3">
          {rules.map((r, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-surface">
                <Check className="h-3 w-3 text-ink-muted" strokeWidth={3} />
              </span>
              <span className="text-[13px] leading-snug text-ink">{r}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function Readout({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 rounded-lg border border-hairline bg-surface/70 px-3.5 py-2.5 text-xs leading-relaxed text-ink">
      {children}
    </p>
  );
}

/** A text input that saves on blur (and on Enter), not on every keystroke. */
function TextField({
  id,
  value,
  onSave,
  disabled,
}: {
  id: string;
  value: string | null;
  onSave: (v: string) => void;
  disabled?: boolean;
}) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  return (
    <Input
      id={id}
      value={v}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== (value ?? "")) onSave(v);
      }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

/** A number input that saves on blur (and on Enter), not on every keystroke. */
function NumberField({
  id,
  value,
  onSave,
  disabled,
  step,
}: {
  id: string;
  value: number | null;
  onSave: (v: number | null) => void;
  disabled?: boolean;
  step?: string;
}) {
  const [v, setV] = useState(value != null ? String(value) : "");
  useEffect(() => setV(value != null ? String(value) : ""), [value]);
  return (
    <Input
      id={id}
      inputMode="decimal"
      step={step}
      value={v}
      disabled={disabled}
      className="tabular-nums"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const next = v === "" ? null : Number(v);
        if ((next === null ? null : next) !== value) onSave(next);
      }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}
