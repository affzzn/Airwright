"use client";

/**
 * Shared client quote view — STATIC MOCKUP (front-end only, wired to nothing).
 *
 * The "builder opens a unique link to see their quotation" concept: the pricing
 * (today an Excel matrix) presented as a clean, readable client page. Every figure
 * is hardcoded placeholder data. No data fetch, no server action, no DB, no
 * pricing engine. Renders standalone — this is the CLIENT's view, so it has its
 * own minimal chrome, not the internal app nav.
 *
 * A Client / Airwright toggle flips a thin internal overlay (cost + margin) on and
 * off, to show it's the same page both sides work from.
 */

import { useState } from "react";
import {
  ChevronDown,
  Check,
  FileText,
  Sheet,
  MessageSquare,
  ShieldCheck,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

const gbp = (n: number) =>
  `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Mock quotation data ──────────────────────────────────────────────────────
const QUOTE = {
  ref: "AW-Q-2609-042",
  site: "Oadby Grange, Phase 2B",
  location: "Leicester",
  issued: "2 Sept 2026",
  validTo: "2 Oct 2026",
  hireWeeks: 12,
  client: { contact: "James Hartley", company: "Bloor Homes", estimator: "Colin Weeks" },
};

interface TakeoffLine {
  label: string;
  detail: string;
}
interface Plot {
  no: number;
  type: string;
  config: string;
  code: string;
  storeys: string;
  builtBefore?: number;
  total: number;
  cost: number; // internal
  takeoff: TakeoffLine[];
}

const PLOTS: Plot[] = [
  {
    no: 1, type: "Byron", config: "Detached", code: "372", storeys: "2-storey", builtBefore: 26, total: 3124.5, cost: 1749.7,
    takeoff: [
      { label: "External scaffold", detail: "39.2 LM × 4 lifts" },
      { label: "Internal birdcage", detail: "44.6 m² × 2 floors" },
      { label: "Gable / apex access", detail: "2 gables" },
      { label: "Low-level towers", detail: "1 (porch)" },
    ],
  },
  {
    no: 2, type: "Hallam", config: "Semi-detached", code: "470", storeys: "2-storey", builtBefore: 11, total: 2186.4, cost: 1224.4,
    takeoff: [
      { label: "External scaffold", detail: "21.0 LM × 4 lifts" },
      { label: "Internal birdcage", detail: "36.1 m² × 2 floors" },
      { label: "Gable / apex access", detail: "1 gable" },
      { label: "Low-level towers", detail: "1 (porch)" },
    ],
  },
  {
    no: 3, type: "Kilburn", config: "Detached", code: "386", storeys: "2.5-storey", total: 3542.8, cost: 1984.0,
    takeoff: [
      { label: "External scaffold", detail: "42.8 LM × 5 lifts" },
      { label: "Internal birdcage", detail: "46.0 m² × 3 floors" },
      { label: "Gable / apex access", detail: "2 gables + table lifts" },
      { label: "Render adaption", detail: "9.0 LM × 3 lifts" },
      { label: "Low-level towers", detail: "1 (bay)" },
    ],
  },
  {
    no: 4, type: "Sinclair", config: "Maisonette", code: "2B4P", storeys: "2-storey", builtBefore: 4, total: 2361.2, cost: 1322.3,
    takeoff: [
      { label: "External scaffold", detail: "22.0 LM × 4 lifts" },
      { label: "Internal birdcage", detail: "49.7 m² × 2 floors" },
      { label: "Gable / apex access", detail: "1 gable" },
    ],
  },
  {
    no: 5, type: "Sorley", config: "Detached", code: "3B5P", storeys: "3-storey", total: 3978.6, cost: 2228.0,
    takeoff: [
      { label: "External scaffold", detail: "45.5 LM × 6 lifts" },
      { label: "Internal birdcage", detail: "50.2 m² × 3 floors" },
      { label: "Gable / apex access", detail: "2 gables + table lifts" },
      { label: "Low-level towers", detail: "1 (porch)" },
    ],
  },
];

const GRAND_TOTAL = PLOTS.reduce((a, p) => a + p.total, 0);
const TOTAL_COST = PLOTS.reduce((a, p) => a + p.cost, 0);

// Stage split (Airwright's standard 50 / 25 / 25 — from the priced matrix).
const STAGES = [
  { label: "Plot erect", pct: 50 },
  { label: "Birdcage erect", pct: 25 },
  { label: "Dismantle", pct: 25 },
] as const;

const INCLUDED = [
  `Erect, ${QUOTE.hireWeeks} weeks hire, and dismantle`,
  "Low-level towers to porches and bays",
  "Weekly inspections and handover certificates",
  "Design, drawings, insurance and RAMS",
];
const EXCLUDED = [
  `Hire beyond ${QUOTE.hireWeeks} weeks, at £42 per plot per week`,
  "Loading bays, temporary roofs and pavement licences",
  "Out-of-hours working and standing time caused by others",
  "VAT · CIS applies · payment 30 days from application",
];

const MESSAGES = [
  { from: "Colin Weeks", side: "airwright" as const, when: "2 Sept, 09:14", body: "Morning James — Phase 2B priced off the pack you sent on the 28th. Dismantle is inside the rates, same as Phase 1." },
  { from: "James Hartley", side: "client" as const, when: "2 Sept, 11:02", body: "Thanks Colin. Is Sinclair measured or taken from a similar type?" },
];

const DOCS = [
  { kind: "PDF", title: "Quotation", sub: `${QUOTE.ref} · ${QUOTE.issued}`, icon: FileText },
  { kind: "PDF", title: "Take-off drawings", sub: "23 pages", icon: FileText },
  { kind: "XLS", title: "Pricing in Excel", sub: "same figures as this page", icon: Sheet },
];

// ── Small pieces ─────────────────────────────────────────────────────────────
function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-subtle">{children}</div>;
}

// ── Root ─────────────────────────────────────────────────────────────────────
export function ClientQuote({ reference }: { reference: string }) {
  const [openPlot, setOpenPlot] = useState<number | null>(1);
  const [asAirwright, setAsAirwright] = useState(false);
  const ref = reference && reference !== "demo" ? reference : QUOTE.ref;

  return (
    <div className="min-h-screen bg-page text-ink">
      {/* Portal top bar */}
      <header className="sticky top-0 z-10 border-b border-hairline bg-page/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 grid-cols-2 gap-0.5 rounded bg-ink p-1" aria-hidden>
              {Array.from({ length: 4 }).map((_, i) => (
                <span key={i} className="rounded-[1px] bg-canvas/90" />
              ))}
            </span>
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight">Airwright Midland</div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-ink-subtle">Client portal</div>
            </div>
          </div>
          <ViewToggle value={asAirwright} onChange={setAsAirwright} />
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-10 px-5 py-10">
        {/* Quotation header */}
        <section>
          <div className="flex items-center justify-between">
            <Eyebrow>Scaffolding quotation</Eyebrow>
            <span className="rounded border border-dashed border-hairline-strong px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-subtle">
              Demo · sample data
            </span>
          </div>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight sm:text-[32px]">{QUOTE.site}</h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            {PLOTS.length} plots · {QUOTE.location} · {ref} · issued {QUOTE.issued}
          </p>
          <p className="mt-0.5 text-sm text-ink-subtle">
            Prepared for {QUOTE.client.contact}, {QUOTE.client.company}
          </p>

          <div className="mt-6 rounded-lg border border-hairline bg-canvas p-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">{gbp(GRAND_TOTAL)}</div>
                <div className="mt-1 text-sm text-ink-subtle">excluding VAT · erect and dismantle</div>
              </div>
              <div className="flex items-center gap-1.5 text-sm text-ink-muted">
                <Clock className="h-4 w-4" strokeWidth={1.75} />
                Awaiting your decision · valid to {QUOTE.validTo}
              </div>
            </div>
            {asAirwright && (
              <div className="mt-5 flex flex-wrap gap-x-8 gap-y-1 border-t border-hairline pt-4 text-sm">
                <span className="text-ink-subtle">Internal cost <span className="font-medium text-ink tabular-nums">{gbp(TOTAL_COST)}</span></span>
                <span className="text-ink-subtle">Margin <span className="font-medium text-ink tabular-nums">{Math.round(((GRAND_TOTAL - TOTAL_COST) / GRAND_TOTAL) * 100)}%</span></span>
                <span className="text-ink-subtle">Rate band <span className="font-medium text-ink">Competitive</span></span>
              </div>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              <button className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-canvas transition-opacity hover:opacity-90">
                Accept quotation
              </button>
              <button className="rounded-md border border-hairline-strong bg-canvas px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface">
                Ask a question
              </button>
              <button className="rounded-md px-4 py-2 text-sm text-ink-subtle transition-colors hover:text-ink">
                Decline
              </button>
            </div>
          </div>
        </section>

        {/* Plots */}
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">The {PLOTS.length} plots</h2>
            <span className="text-xs text-ink-subtle">tap a plot for the detail</span>
          </div>
          <div className="overflow-hidden rounded-lg border border-hairline bg-canvas">
            {PLOTS.map((p) => {
              const open = openPlot === p.no;
              return (
                <div key={p.no} className="border-b border-hairline last:border-b-0">
                  <button
                    onClick={() => setOpenPlot(open ? null : p.no)}
                    className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-surface"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-hairline-strong text-xs font-medium tabular-nums text-ink-muted">
                      {p.no}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.type}</span>
                        {p.builtBefore && (
                          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-subtle">
                            Built {p.builtBefore}× before
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-ink-subtle">
                        {p.config} · {p.storeys} · {p.code}
                      </div>
                    </div>
                    <span className="shrink-0 font-medium tabular-nums">{gbp(p.total)}</span>
                    <ChevronDown className={cn("h-4 w-4 shrink-0 text-ink-subtle transition-transform", open && "rotate-180")} strokeWidth={1.75} />
                  </button>
                  {open && (
                    <div className="border-t border-hairline bg-surface/50 px-5 py-4 pl-16">
                      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                        <div>
                          <Eyebrow>Take-off</Eyebrow>
                          <ul className="mt-2 space-y-1.5">
                            {p.takeoff.map((l) => (
                              <li key={l.label} className="flex justify-between gap-4 text-sm">
                                <span className="text-ink-muted">{l.label}</span>
                                <span className="text-right tabular-nums text-ink">{l.detail}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <Eyebrow>Payment stages</Eyebrow>
                          <ul className="mt-2 space-y-1.5">
                            {STAGES.map((s) => (
                              <li key={s.label} className="flex justify-between gap-4 text-sm">
                                <span className="text-ink-muted">{s.label} <span className="text-ink-subtle">({s.pct}%)</span></span>
                                <span className="tabular-nums text-ink">{gbp((p.total * s.pct) / 100)}</span>
                              </li>
                            ))}
                            <li className="flex justify-between gap-4 border-t border-hairline pt-1.5 text-sm font-medium">
                              <span>Plot total</span>
                              <span className="tabular-nums">{gbp(p.total)}</span>
                            </li>
                            {asAirwright && (
                              <li className="flex justify-between gap-4 text-xs text-ink-subtle">
                                <span>Internal cost / margin</span>
                                <span className="tabular-nums">{gbp(p.cost)} · {Math.round(((p.total - p.cost) / p.total) * 100)}%</span>
                              </li>
                            )}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="flex items-center justify-between bg-surface px-5 py-3.5 text-sm">
              <span className="font-medium">Total · erect and dismantle</span>
              <span className="text-base font-semibold tabular-nums">{gbp(GRAND_TOTAL)}</span>
            </div>
          </div>
        </section>

        {/* Payment schedule */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">Payment schedule</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {STAGES.map((s, i) => (
              <div key={s.label} className="rounded-lg border border-hairline bg-canvas p-4">
                <div className="flex items-center gap-2 text-xs text-ink-subtle">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-surface-2 text-[10px] font-medium text-ink-muted">{i + 1}</span>
                  {s.label} · {s.pct}%
                </div>
                <div className="mt-2 text-xl font-semibold tabular-nums">{gbp((GRAND_TOTAL * s.pct) / 100)}</div>
                <div className="mt-0.5 text-xs text-ink-subtle">on stage handover</div>
              </div>
            ))}
          </div>
        </section>

        {/* What the price covers */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">What the price covers</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-hairline bg-canvas p-5">
              <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" strokeWidth={1.75} /><span className="text-sm font-medium">Included</span></div>
              <ul className="mt-3 space-y-2">
                {INCLUDED.map((t) => (
                  <li key={t} className="flex gap-2 text-sm text-ink-muted">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink" strokeWidth={2.25} /> {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-hairline bg-canvas p-5">
              <div className="text-sm font-medium">Not included</div>
              <ul className="mt-3 space-y-2">
                {EXCLUDED.map((t) => (
                  <li key={t} className="flex gap-2 text-sm text-ink-subtle">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-hairline-strong" aria-hidden /> {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Messages */}
        <section>
          <div className="mb-3 flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-ink-muted" strokeWidth={1.75} />
            <h2 className="text-sm font-semibold">Messages</h2>
          </div>
          <div className="space-y-3 rounded-lg border border-hairline bg-canvas p-5">
            {MESSAGES.map((m, i) => (
              <div key={i} className={cn("flex flex-col", m.side === "client" && "items-end")}>
                <div className={cn("max-w-[80%] rounded-lg border px-3.5 py-2.5", m.side === "client" ? "border-transparent bg-ink text-canvas" : "border-hairline bg-surface")}>
                  <p className="text-sm leading-relaxed">{m.body}</p>
                </div>
                <span className="mt-1 text-[11px] text-ink-subtle">{m.from} · {m.when}</span>
              </div>
            ))}
            <div className="flex items-center gap-2 border-t border-hairline pt-3">
              <input
                disabled
                placeholder="Write a reply…"
                className="min-w-0 flex-1 rounded-md border border-hairline bg-page px-3 py-2 text-sm text-ink placeholder:text-ink-subtle"
              />
              <button className="rounded-md bg-ink px-3.5 py-2 text-sm font-medium text-canvas opacity-90">Send</button>
            </div>
          </div>
        </section>

        {/* Documents */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">Documents</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {DOCS.map((d) => (
              <div key={d.title} className="flex items-center gap-3 rounded-lg border border-hairline bg-canvas p-4 transition-colors hover:bg-surface">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-2 text-ink-muted">
                  <d.icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{d.title}</div>
                  <div className="truncate text-[11px] text-ink-subtle">{d.kind} · {d.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <footer className="border-t border-hairline pt-6 text-center text-xs text-ink-subtle">
          Airwright Midland · prepared by {QUOTE.client.estimator} · {ref}
          <div className="mt-1">This quotation is a demo mockup with sample figures.</div>
        </footer>
      </main>
    </div>
  );
}

function ViewToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-[11px] text-ink-subtle sm:inline">Viewing as</span>
      <div className="inline-flex rounded-md border border-hairline bg-canvas p-0.5 text-xs">
        <button
          onClick={() => onChange(false)}
          className={cn("rounded px-2.5 py-1 font-medium transition-colors", !value ? "bg-ink text-canvas" : "text-ink-muted hover:text-ink")}
        >
          Client
        </button>
        <button
          onClick={() => onChange(true)}
          className={cn("rounded px-2.5 py-1 font-medium transition-colors", value ? "bg-ink text-canvas" : "text-ink-muted hover:text-ink")}
        >
          Airwright
        </button>
      </div>
    </div>
  );
}
