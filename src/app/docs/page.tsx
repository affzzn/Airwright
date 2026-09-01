import { AppShell } from "@/components/app-shell";
import { env } from "@/lib/env";
import { LIVE } from "@/lib/dev-spec/live";
import {
  CROSS_CHECKS,
  DOCTRINES,
  ENGINE_RULES,
  GLOSSARY,
  LAYERS,
  MEASUREMENTS,
  OVERVIEW_INTRO,
  PIPELINE,
  SCHEMA_FIELDS,
  SMART_UPLOAD_INTRO,
  SMART_UPLOAD_IDEAS,
  SMART_UPLOAD_PIPELINE,
  SMART_UPLOAD_AI_NOTE,
  SMART_UPLOAD_GATE_NOTE,
} from "@/lib/dev-spec";
import { Badge } from "@/components/ui/badge";
import { SpecShell, type NavGroup } from "@/components/dev/spec-shell";
import { Section } from "@/components/dev/section";
import { Callout } from "@/components/dev/callout";
import { SpecTable } from "@/components/dev/spec-table";
import { StatusBadge } from "@/components/dev/badges";
import { MeasurementCatalogue } from "@/components/dev/measurement-catalogue";
import { GlossaryPanel } from "@/components/dev/glossary-panel";
import { PromptView } from "@/components/dev/prompt-view";

export const dynamic = "force-dynamic";

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { id: "overview", title: "Overview" },
      { id: "classification", title: "Which pages" },
    ],
  },
  {
    label: "Smart upload",
    items: [{ id: "smart-upload", title: "Smart upload & grouping" }],
  },
  {
    label: "Reading the drawing",
    items: [{ id: "measurements", title: "Measurements" }],
  },
  {
    label: "The engine",
    items: [
      { id: "engine-rules", title: "Rules & formulas" },
      { id: "constants", title: "Constants" },
    ],
  },
  {
    label: "Reference",
    items: [
      { id: "prompt", title: "The prompt" },
      { id: "contract", title: "Extraction contract" },
      { id: "cross-checks", title: "Cross-checks" },
      { id: "glossary", title: "Glossary" },
    ],
  },
];

const fmtMap = (m: Record<string, number>) =>
  Object.entries(m)
    .map(([k, v]) => `${k}: ${v}`)
    .join(",  ");

const RUNS_IN: Record<string, string> = { browser: "Browser", worker: "Worker", app: "App" };

function ChipList({ label, items }: { label: string; items: readonly string[] }) {
  return (
    <div>
      <p className="eyebrow mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((t) => (
          <span
            key={t}
            className="inline-flex items-center rounded border border-hairline-strong bg-surface px-1.5 py-0.5 font-mono text-[11px] text-ink-muted"
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function DevSpecPage() {
  const model = env.extractionModel;

  const constantRows: React.ReactNode[][] = [
    ["Lift height", `${LIVE.engine.liftHeightM} m`, <StatusBadge key="s" status="open" owner="colin" />, mono("takeoff/engine.ts")],
    ["Corner allowance", `${LIVE.engine.cornerAllowanceM} m per external corner`, <StatusBadge key="s" status="confirmed" />, mono("takeoff/engine.ts")],
    ["Storey → lifts (Standard)", fmtMap(LIVE.engine.standardStoreyLifts), <StatusBadge key="s" status="confirmed" />, mono("takeoff/engine.ts")],
    ["Render lifts by storey", fmtMap(LIVE.engine.renderLiftsByStorey), <StatusBadge key="s" status="open" owner="colin" />, mono("takeoff/engine.ts")],
    ["Expected birdcage floors", fmtMap(LIVE.engine.expectedFloorsByStorey), <StatusBadge key="s" status="confirmed" />, mono("takeoff/engine.ts")],
    ["Birdcage: internal vs derived tolerance", LIVE.birdcage.internalXCheckTolerancePct, <StatusBadge key="s" status="open" owner="rayyan" />, mono("extract/birdcage.ts")],
    ["Height: gap-note threshold", `${LIVE.height.gapNoteM} m`, <StatusBadge key="s" status="confirmed" />, mono("extract/height.ts")],
    ["max_tokens", String(LIVE.request.maxTokens), <StatusBadge key="s" status="confirmed" />, mono("extract/config.ts")],
    ["Model cost (input)", `$${LIVE.request.inputCostPerMtok} / 1M tokens`, <StatusBadge key="s" status="confirmed" />, mono("extract/config.ts")],
    ["Model cost (output)", `$${LIVE.request.outputCostPerMtok} / 1M tokens`, <StatusBadge key="s" status="confirmed" />, mono("extract/config.ts")],
  ];

  return (
    <AppShell>
      <SpecShell groups={NAV_GROUPS}>
          {/* Header */}
          <header>
            <p className="eyebrow mb-2">Airwright · documentation</p>
            <h1 className="text-3xl font-semibold tracking-tight text-ink">Extraction spec</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline">prompt {LIVE.prompt.version}</Badge>
              <Badge variant="outline">{model}</Badge>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-ink-muted">{OVERVIEW_INTRO}</p>
          </header>

          {/* Overview */}
          <Section id="overview" eyebrow="How it works" title="Overview">
            <div className="grid gap-3 md:grid-cols-3">
              {LAYERS.map((l) => (
                <div key={l.id} className="rounded-lg border border-hairline bg-canvas p-4">
                  <h3 className="text-sm font-semibold text-ink">{l.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{l.body}</p>
                  <p className="mt-2 font-mono text-[11px] text-ink-subtle">{l.files}</p>
                </div>
              ))}
            </div>

            <h3 className="mt-8 text-sm font-semibold text-ink">The pipeline</h3>
            <ol className="mt-3 grid gap-2 sm:grid-cols-2">
              {PIPELINE.map((s, i) => (
                <li key={s.id} className="rounded-lg border border-hairline bg-canvas p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-ink">
                      {i + 1}. {s.name}
                    </span>
                    <Badge variant="muted">{RUNS_IN[s.runsIn]}</Badge>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{s.what}</p>
                </li>
              ))}
            </ol>

            <h3 className="mt-8 text-sm font-semibold text-ink">The doctrines</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {DOCTRINES.map((d) => (
                <div key={d.title} className="rounded-lg border border-hairline bg-canvas p-4">
                  <p className="text-sm font-medium text-ink">{d.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-muted">{d.body}</p>
                </div>
              ))}
            </div>

            <Callout label="Legend" className="mt-6">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <span className="inline-flex items-center gap-2"><StatusBadge status="confirmed" /> a settled rule, safe to rely on</span>
                <span className="inline-flex items-center gap-2"><StatusBadge status="open" owner="colin" /> awaiting the owner — built as a flag/param, never a guess</span>
              </div>
            </Callout>
          </Section>

          {/* Classification */}
          <Section
            id="classification"
            eyebrow="Before the AI"
            title="Which pages get read"
            intro="Cheap, AI-free code reads the PDF text layer and decides which pages of which files matter, and which house type each belongs to. Only take-off-relevant pages are sent to the model."
          >
            <div className="grid gap-5 rounded-lg border border-hairline bg-canvas p-5 sm:grid-cols-2">
              <ChipList label="Take-off-relevant page kinds" items={LIVE.classification.takeoffKinds} />
              <ChipList label="Site / plot layouts → OTHER (not used)" items={LIVE.classification.siteLayoutTerms} />
              <ChipList label="Exclusion title keywords → OTHER" items={LIVE.classification.exclusionTerms} />
              <ChipList label="Setting-out plan civils guards" items={LIVE.classification.settingOutCivilGuards} />
            </div>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              A building &ldquo;Setting Out Plan&rdquo; is treated as a floor plan (it carries the internal footprint dimensions) unless
              it is a civils one. Internal room elevations (Kitchen / Cloak) and civils long-sections are excluded. Pages are
              then grouped into house types by NAME. Source: <span className="font-mono text-xs">extract/classify-rules.ts</span>.
            </p>
          </Section>

          {/* Smart upload & grouping */}
          <Section
            id="smart-upload"
            eyebrow="Before the extractor"
            title="Smart upload & grouping"
            intro={SMART_UPLOAD_INTRO}
          >
            <div className="grid gap-3 md:grid-cols-2">
              {SMART_UPLOAD_IDEAS.map((idea) => (
                <div key={idea.title} className="rounded-lg border border-hairline bg-canvas p-4">
                  <p className="text-sm font-medium text-ink">{idea.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-muted">{idea.body}</p>
                </div>
              ))}
            </div>

            <h3 className="mt-8 text-sm font-semibold text-ink">The pipeline</h3>
            <div className="mt-3">
              <SpecTable
                head={["Step", "By", "What happens"]}
                colClass={["w-40", "w-24", undefined]}
                rows={SMART_UPLOAD_PIPELINE.map((s) => [
                  <span key="s" className="font-medium text-ink">{s.step}</span>,
                  <Badge key="b" variant={s.by === "Human" ? "solid" : s.by === "Code" ? "muted" : "outline"}>{s.by}</Badge>,
                  s.what,
                ])}
              />
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2">
              <Callout label="AI vs deterministic">{SMART_UPLOAD_AI_NOTE}</Callout>
              <Callout label="The human gate">{SMART_UPLOAD_GATE_NOTE}</Callout>
            </div>
          </Section>

          {/* Measurements */}
          <Section
            id="measurements"
            eyebrow="The heart"
            title="Measurement catalogue"
            intro="Every observable the extractor reads and the engine derives. Expand a row for how it's read, the formula, the fallbacks, the confidence rule and a worked example. Filter by layer, status or owner."
          >
            <MeasurementCatalogue items={MEASUREMENTS} crossChecks={CROSS_CHECKS} />
          </Section>

          {/* Engine rules */}
          <Section
            id="engine-rules"
            eyebrow="Layer 2"
            title="Rules & formulas"
            intro="The deterministic take-off engine's rules. The tunable numbers appear live in Constants below; the config/logic tables here are fixed rules."
          >
            <div className="space-y-4">
              {ENGINE_RULES.map((r) => (
                <div key={r.id} className="rounded-lg border border-hairline bg-canvas p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-ink">{r.name}</h3>
                    <StatusBadge status={r.status} owner={r.owner} />
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{r.plain}</p>
                  {r.plainExtra && <p className="mt-2 text-sm leading-relaxed text-ink-muted">{r.plainExtra}</p>}
                  {r.formula && (
                    <pre className="mt-3 whitespace-pre-wrap rounded-md border border-hairline bg-surface px-3 py-2 font-mono text-[12.5px] text-ink">
                      {r.formula}
                    </pre>
                  )}
                  {r.table && (
                    <div className="mt-3">
                      <SpecTable head={r.table.head} caption={r.table.caption} rows={r.table.rows} />
                    </div>
                  )}
                  <p className="mt-2 font-mono text-[11px] text-ink-subtle">{r.codeRefs.join("  ·  ")}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* Constants */}
          <Section
            id="constants"
            eyebrow="Live from code"
            title="Constants & tolerances"
            intro="These values are imported straight from the code, so this table cannot drift from what the engine actually uses."
          >
            <SpecTable
              head={["Constant", "Value", "Status", "Source"]}
              rows={constantRows}
              colClass={[undefined, undefined, "w-32", "w-44"]}
            />
          </Section>

          {/* Prompt */}
          <Section
            id="prompt"
            eyebrow="Layer 1"
            title="The prompt"
            intro="Exactly what we send the model. Forced tool-use returns structured JSON validated against the schema; the system prompt and tool schema are cached, so only the PDF and the per-page dimension candidates vary per call."
          >
            <div className="space-y-4">
              <SpecTable
                head={["Setting", "Value"]}
                colClass={["w-48", undefined]}
                rows={[
                  ["Model", mono(model)],
                  ["Prompt version", mono(LIVE.prompt.version)],
                  ["temperature", "not set (Opus 4.8 rejects it)"],
                  ["max_tokens", String(LIVE.request.maxTokens)],
                  ["Tool", <>forced tool-use → {mono("record_takeoff")}</>],
                  ["Input", "base64 PDF document block + user instruction + per-page dimension candidates"],
                  ["Caching", "system prompt + tool schema (ephemeral)"],
                  ["Validation", "returned JSON parsed with Zod; a failure fails the extraction"],
                ]}
              />
              <PromptView label="System prompt (verbatim)" text={LIVE.prompt.system} />
              <PromptView label="User instruction (verbatim)" text={LIVE.prompt.user} />
              <p className="text-sm leading-relaxed text-ink-muted">
                On every call the per-page text-layer dimension candidates are appended, so the model snaps its reading to a
                real printed string (in <span className="font-mono text-xs">sourceDimension</span>) rather than re-reading
                digits off the linework.
              </p>
            </div>
          </Section>

          {/* Contract */}
          <Section
            id="contract"
            eyebrow="Layer 1"
            title="Extraction contract"
            intro="Every top-level field the model must return. Each value carries a confidence and, where relevant, its source (sheet, printed dimension string, page). The field names are asserted against the live Zod schema in a test, so this table can't silently rot."
          >
            <SpecTable
              head={["Field", "Type", "Meaning"]}
              colClass={["w-44", "w-64", undefined]}
              rows={SCHEMA_FIELDS.map((f) => [mono(f.name), <span key="t" className="text-xs">{f.type}</span>, f.meaning])}
            />
          </Section>

          {/* Cross-checks */}
          <Section
            id="cross-checks"
            eyebrow="Guardrails"
            title="Cross-checks & flags"
            intro="Every automated check the extractor runs. What we already catch — and where the two remaining ones (A2, W2) still need Colin."
          >
            <SpecTable
              head={["Check", "Trigger", "Effect", "Writes", "Status"]}
              colClass={["w-52", undefined, undefined, "w-40", "w-28"]}
              rows={CROSS_CHECKS.map((c) => [
                <span key="n" className="text-ink">{c.code ? `${c.code} · ${c.name}` : c.name}</span>,
                c.trigger,
                c.effect,
                c.warningKey ? mono(c.warningKey) : "—",
                <StatusBadge key="s" status={c.status} />,
              ])}
            />
          </Section>

          {/* Glossary */}
          <Section id="glossary" eyebrow="Vocabulary" title="Glossary" intro="Every scaffolding term as Airwright uses it.">
            <GlossaryPanel terms={GLOSSARY} />
          </Section>
      </SpecShell>
    </AppShell>
  );
}

/** A monospace inline code fragment (used in the static tables). */
function mono(text: string) {
  return <span className="font-mono text-xs text-ink-muted">{text}</span>;
}
