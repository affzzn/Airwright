"use client";

/**
 * Model Testing & Benchmarking — STATIC MOCKUP (front-end only, wired to nothing).
 *
 * Every figure below is hardcoded placeholder data. There is no extraction, no
 * data fetching, no server action, no DB. This exists purely to show Airwright
 * the shape of the planned testing pipeline on a call. House-type + pack names are
 * real (from the sample packs); measurements are illustrative.
 *
 * Concept: run every house type through all three model providers, compare each
 * one's extracted take-off against Airwright's benchmark (their handwritten
 * take-off sheets), and show accuracy + cost per model.
 */

import { useState } from "react";
import { ChevronRight, ArrowLeft, FileText } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ── Models under test ────────────────────────────────────────────────────────
const MODELS = [
  { id: "claude", short: "Claude", label: "Claude Opus 4.8", provider: "Anthropic" },
  { id: "gemini", short: "Gemini", label: "Gemini 3.1 Pro", provider: "Google" },
  { id: "openai", short: "OpenAI", label: "GPT-5.6", provider: "OpenAI" },
] as const;
type ModelId = (typeof MODELS)[number]["id"];

// ── Benchmark data (Airwright's take-off sheets) ─────────────────────────────
interface Bench {
  perimeter: number; // LM
  lifts: number;
  bcGF: number; // m²
  bcFF: number | null; // m² (null = single-storey, no first floor)
  gables: number;
  lowLevel: number;
  render: number; // LM (0 = not rendered)
}
interface HType {
  id: string;
  name: string;
  config: string;
  storeys: string;
  bench: Bench;
}
interface Pack {
  id: string;
  name: string;
  builder: string;
  location: string;
  types: HType[];
}

const PACKS: Pack[] = [
  {
    id: "whitford",
    name: "Whitford Road",
    builder: "Miller Homes",
    location: "Bromsgrove",
    types: [
      { id: "chesterwood", name: "Chesterwood", config: "Detached", storeys: "2", bench: { perimeter: 38.4, lifts: 4, bcGF: 42.1, bcFF: 42.1, gables: 2, lowLevel: 1, render: 0 } },
      { id: "braxton", name: "Braxton", config: "Semi-detached", storeys: "2", bench: { perimeter: 20.6, lifts: 4, bcGF: 35.6, bcFF: 35.6, gables: 1, lowLevel: 1, render: 0 } },
      { id: "glenwood", name: "Glenwood", config: "Detached", storeys: "2", bench: { perimeter: 41.2, lifts: 4, bcGF: 48.5, bcFF: 48.5, gables: 2, lowLevel: 1, render: 0 } },
      { id: "hampton", name: "Hampton", config: "Semi-detached", storeys: "2.5", bench: { perimeter: 22.4, lifts: 5, bcGF: 33.0, bcFF: 33.0, gables: 1, lowLevel: 1, render: 8.5 } },
      { id: "cherrywood", name: "Cherrywood", config: "Detached", storeys: "2", bench: { perimeter: 36.8, lifts: 4, bcGF: 40.2, bcFF: 40.2, gables: 2, lowLevel: 2, render: 0 } },
      { id: "denton", name: "Denton", config: "Mid-terrace", storeys: "2", bench: { perimeter: 10.6, lifts: 4, bcGF: 34.8, bcFF: 34.8, gables: 0, lowLevel: 1, render: 0 } },
      { id: "charford", name: "Charford", config: "Detached", storeys: "2", bench: { perimeter: 44.0, lifts: 4, bcGF: 52.3, bcFF: 52.3, gables: 2, lowLevel: 1, render: 12.0 } },
      { id: "millfield", name: "Millfield Bungalow", config: "Detached", storeys: "1", bench: { perimeter: 30.5, lifts: 2, bcGF: 57.0, bcFF: null, gables: 0, lowLevel: 1, render: 0 } },
    ],
  },
  {
    id: "oadby",
    name: "Oadby Phase 2B",
    builder: "Bloor Homes",
    location: "Leicester",
    types: [
      { id: "byron", name: "Byron", config: "Detached", storeys: "2", bench: { perimeter: 39.2, lifts: 4, bcGF: 44.6, bcFF: 44.6, gables: 2, lowLevel: 1, render: 0 } },
      { id: "hallam", name: "Hallam", config: "Semi-detached", storeys: "2", bench: { perimeter: 21.0, lifts: 4, bcGF: 36.1, bcFF: 36.1, gables: 1, lowLevel: 1, render: 0 } },
      { id: "kilburn", name: "Kilburn", config: "Detached", storeys: "2.5", bench: { perimeter: 42.8, lifts: 5, bcGF: 46.0, bcFF: 46.0, gables: 2, lowLevel: 1, render: 9.0 } },
      { id: "sorley", name: "Sorley", config: "Detached", storeys: "3", bench: { perimeter: 45.5, lifts: 6, bcGF: 50.2, bcFF: 50.2, gables: 2, lowLevel: 1, render: 0 } },
      { id: "lawrence", name: "Lawrence", config: "Detached", storeys: "2", bench: { perimeter: 37.6, lifts: 4, bcGF: 41.8, bcFF: 41.8, gables: 2, lowLevel: 1, render: 0 } },
      { id: "sinclair", name: "Sinclair", config: "Maisonette", storeys: "2", bench: { perimeter: 22.0, lifts: 4, bcGF: 49.7, bcFF: 49.7, gables: 1, lowLevel: 0, render: 0 } },
    ],
  },
  {
    id: "perryfields",
    name: "Perryfields 2B",
    builder: "Taylor Wimpey",
    location: "North Midlands",
    types: [
      { id: "avonsford", name: "Avonsford", config: "Semi-detached", storeys: "2", bench: { perimeter: 20.5, lifts: 4, bcGF: 38.2, bcFF: 38.2, gables: 1, lowLevel: 1, render: 0 } },
      { id: "brambleford", name: "Brambleford", config: "Detached", storeys: "2", bench: { perimeter: 40.1, lifts: 4, bcGF: 45.0, bcFF: 45.0, gables: 2, lowLevel: 1, render: 0 } },
      { id: "keeford", name: "Keeford", config: "Detached", storeys: "2.5", bench: { perimeter: 43.2, lifts: 5, bcGF: 48.8, bcFF: 48.8, gables: 2, lowLevel: 1, render: 10.5 } },
      { id: "harrton", name: "Harrton", config: "Detached", storeys: "3", bench: { perimeter: 46.0, lifts: 6, bcGF: 52.0, bcFF: 52.0, gables: 2, lowLevel: 1, render: 0 } },
      { id: "apartmentA", name: "Apartment Block A", config: "Apartments", storeys: "3", bench: { perimeter: 65.4, lifts: 6, bcGF: 128.2, bcFF: 128.2, gables: 4, lowLevel: 0, render: 22.0 } },
      { id: "carrdale", name: "Carrdale", config: "Semi-detached", storeys: "2", bench: { perimeter: 21.2, lifts: 4, bcGF: 37.5, bcFF: 37.5, gables: 1, lowLevel: 1, render: 0 } },
    ],
  },
];

// ── Measurement fields (rows of the comparison table) ────────────────────────
const FIELDS = [
  { key: "perimeter", label: "Perimeter", unit: "LM", kind: "decimal" as const },
  { key: "lifts", label: "Lifts", unit: "", kind: "int" as const },
  { key: "bcGF", label: "Birdcage — Ground floor", unit: "m²", kind: "decimal" as const },
  { key: "bcFF", label: "Birdcage — First floor", unit: "m²", kind: "decimal" as const },
  { key: "gables", label: "Gables / apex", unit: "", kind: "int" as const },
  { key: "lowLevel", label: "Low levels", unit: "", kind: "int" as const },
  { key: "render", label: "Render", unit: "LM", kind: "decimal" as const },
] as const;
type FieldKey = (typeof FIELDS)[number]["key"];

type Status = "exact" | "close" | "off" | "miss" | "na";
interface Cell {
  text: string;
  status: Status;
}

// Each model's characteristic behaviour, applied deterministically to a benchmark
// so the mock reads consistently (Claude strongest; Gemini cheap but drops render
// + the odd apex; OpenAI over-reads birdcage). Returns the model's value, or "miss".
function modelValue(model: ModelId, key: FieldKey, b: number): number | "miss" {
  if (model === "claude") {
    if (key === "bcGF" || key === "bcFF") return b + 0.6; // near, not exact
    return b;
  }
  if (model === "gemini") {
    if (key === "perimeter") return b - 0.3;
    if (key === "bcGF" || key === "bcFF") return b - 1.3;
    if (key === "gables") return b >= 2 ? b - 1 : b;
    if (key === "render") return b > 0 ? "miss" : 0;
    return b;
  }
  // openai
  if (key === "perimeter") return b + 0.4;
  if (key === "bcGF" || key === "bcFF") return b + 4.1;
  if (key === "lowLevel") return b >= 2 ? b - 1 : b;
  if (key === "render") return b > 0 ? b - 1.5 : 0;
  return b;
}

function statusFor(kind: "int" | "decimal", key: FieldKey, b: number, v: number | "miss"): Status {
  if (v === "miss") return "miss";
  const d = Math.abs(v - b);
  if (kind === "int") return d === 0 ? "exact" : "off";
  const closeTol = key === "perimeter" ? 0.6 : key === "render" ? 2 : 2; // birdcage/render 2 m², LM 0.6
  if (d < 0.05) return "exact";
  if (d <= closeTol) return "close";
  return "off";
}

function fmt(v: number, kind: "int" | "decimal", unit: string): string {
  const n = kind === "int" ? String(Math.round(v)) : v.toFixed(1);
  return unit ? `${n} ${unit}` : n;
}

interface Row {
  key: FieldKey;
  label: string;
  unit: string;
  bench: Cell;
  claude: Cell;
  gemini: Cell;
  openai: Cell;
}

function rowsFor(t: HType): Row[] {
  return FIELDS.map((f) => {
    const b = t.bench[f.key];
    const na = b === null || (f.key === "render" && b === 0);
    const benchCell: Cell = { text: na ? "—" : fmt(b as number, f.kind, f.unit), status: na ? "na" : "exact" };
    const cell = (m: ModelId): Cell => {
      if (na) return { text: "—", status: "na" };
      const v = modelValue(m, f.key, b as number);
      const status = statusFor(f.kind, f.key, b as number, v);
      const text = v === "miss" ? "not read" : fmt(v, f.kind, f.unit);
      return { text, status };
    };
    return { key: f.key, label: f.label, unit: f.unit, bench: benchCell, claude: cell("claude"), gemini: cell("gemini"), openai: cell("openai") };
  });
}

const STATUS_WEIGHT: Record<Status, number> = { exact: 1, close: 0.8, off: 0.25, miss: 0, na: 0 };

function scoreFor(t: HType, m: ModelId): number {
  const rows = rowsFor(t).filter((r) => r[m].status !== "na");
  const sum = rows.reduce((a, r) => a + STATUS_WEIGHT[r[m].status], 0);
  return Math.round((sum / rows.length) * 100);
}

function fieldsCorrect(t: HType, m: ModelId): { hit: number; total: number } {
  const rows = rowsFor(t).filter((r) => r[m].status !== "na");
  const hit = rows.filter((r) => r[m].status === "exact" || r[m].status === "close").length;
  return { hit, total: rows.length };
}

function costFor(t: HType, m: ModelId): number {
  const p = t.bench.perimeter;
  const base = m === "claude" ? 0.45 + p * 0.006 : m === "gemini" ? 0.07 + p * 0.0009 : 0.24 + p * 0.0026;
  return Math.round(base * 100) / 100;
}

const AVG_TIME: Record<ModelId, number> = { claude: 34, gemini: 21, openai: 28 };

const ALL_TYPES = PACKS.flatMap((p) => p.types);
const avg = (ns: number[]) => Math.round(ns.reduce((a, b) => a + b, 0) / ns.length);
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const overallAcc = (m: ModelId) => avg(ALL_TYPES.map((t) => scoreFor(t, m)));
const overallCost = (m: ModelId) => sum(ALL_TYPES.map((t) => costFor(t, m)));
const packAcc = (pk: Pack, m: ModelId) => avg(pk.types.map((t) => scoreFor(t, m)));
const packCost = (pk: Pack, m: ModelId) => sum(pk.types.map((t) => costFor(t, m)));
const bestModel = (score: (m: ModelId) => number): ModelId =>
  MODELS.map((m) => m.id).reduce((best, m) => (score(m) > score(best) ? m : best), "claude" as ModelId);

// ── Small presentational pieces ──────────────────────────────────────────────
const DOT: Record<Status, string> = {
  exact: "bg-emerald-500",
  close: "bg-amber-500",
  off: "bg-red-500",
  miss: "border border-dashed border-red-400 bg-transparent",
  na: "bg-hairline-strong",
};

function StatusDot({ status }: { status: Status }) {
  return <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", DOT[status])} aria-hidden />;
}

function AccBar({ value, strong = false }: { value: number; strong?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-full min-w-[64px] overflow-hidden rounded-full bg-surface-2">
        <div className={cn("h-full rounded-full", strong ? "bg-ink" : "bg-ink-muted")} style={{ width: `${value}%` }} />
      </div>
      <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-ink">{value}%</span>
    </div>
  );
}

const money = (n: number) => `$${n.toFixed(2)}`;

function ModelName({ m }: { m: (typeof MODELS)[number] }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-sm font-semibold text-ink">{m.label}</span>
      <span className="text-[11px] text-ink-subtle">{m.provider}</span>
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────
type View = { level: "packs" } | { level: "pack"; packId: string } | { level: "type"; packId: string; typeId: string };

export function TestingDashboard() {
  const [view, setView] = useState<View>({ level: "packs" });
  const pack = "packId" in view ? PACKS.find((p) => p.id === view.packId)! : null;
  const type = view.level === "type" && pack ? pack.types.find((t) => t.id === view.typeId)! : null;

  return (
    <div className="space-y-8">
      <Breadcrumb view={view} pack={pack} type={type} onNav={setView} />
      {view.level === "packs" && <PacksView onOpen={(packId) => setView({ level: "pack", packId })} />}
      {view.level === "pack" && pack && (
        <PackView pack={pack} onOpen={(typeId) => setView({ level: "type", packId: pack.id, typeId })} />
      )}
      {view.level === "type" && pack && type && <TypeView pack={pack} type={type} />}
    </div>
  );
}

function Breadcrumb({
  view,
  pack,
  type,
  onNav,
}: {
  view: View;
  pack: Pack | null;
  type: HType | null;
  onNav: (v: View) => void;
}) {
  if (view.level === "packs") return null;
  return (
    <div className="flex items-center gap-1.5 text-sm text-ink-subtle">
      <button onClick={() => onNav({ level: "packs" })} className="inline-flex items-center gap-1 hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} /> Testing
      </button>
      {pack && (
        <>
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.75} />
          <button
            onClick={() => onNav({ level: "pack", packId: pack.id })}
            className={cn("hover:text-ink", view.level === "pack" && "text-ink")}
          >
            {pack.name}
          </button>
        </>
      )}
      {type && (
        <>
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span className="text-ink">{type.name}</span>
        </>
      )}
    </div>
  );
}

// ── Header block (shared) ────────────────────────────────────────────────────
function PageIntro() {
  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Model Testing &amp; Benchmarking</h1>
        <Badge variant="dashed">Mockup · sample data</Badge>
      </div>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-muted">
        Every house type is read by all three model providers and its take-off compared against
        Airwright&rsquo;s benchmark take-off sheets. See which model is most accurate, where each one
        falls short, and what each costs.
      </p>
    </div>
  );
}

// ── View 1: packs + overall summary ──────────────────────────────────────────
function PacksView({ onOpen }: { onOpen: (packId: string) => void }) {
  const leader = bestModel(overallAcc);
  return (
    <div className="space-y-8">
      <PageIntro />

      {/* Overall per-model summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {MODELS.map((m) => {
          const isLeader = m.id === leader;
          return (
            <Card key={m.id} className={cn(isLeader && "border-hairline-strong")}>
              <CardBody className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <ModelName m={m} />
                  {isLeader && <Badge variant="solid">Most accurate</Badge>}
                </div>
                <div>
                  <div className="text-3xl font-semibold tracking-tight text-ink tabular-nums">{overallAcc(m.id)}%</div>
                  <div className="mt-1 text-[11px] uppercase tracking-wide text-ink-subtle">overall accuracy</div>
                </div>
                <AccBar value={overallAcc(m.id)} strong={isLeader} />
                <div className="flex items-center justify-between border-t border-hairline pt-3 text-sm">
                  <div>
                    <div className="font-medium text-ink tabular-nums">{money(overallCost(m.id))}</div>
                    <div className="text-[11px] text-ink-subtle">total cost · {ALL_TYPES.length} types</div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-ink tabular-nums">{AVG_TIME[m.id]}s</div>
                    <div className="text-[11px] text-ink-subtle">avg / type</div>
                  </div>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {/* Packs */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Tender packs</h2>
          <span className="text-xs text-ink-subtle">{PACKS.length} packs · {ALL_TYPES.length} house types</span>
        </CardHeader>
        <div className="divide-y divide-hairline">
          <div className="hidden grid-cols-[1.6fr_repeat(3,1fr)_auto] gap-4 px-5 py-2.5 text-[11px] uppercase tracking-wide text-ink-subtle sm:grid">
            <span>Pack</span>
            {MODELS.map((m) => (
              <span key={m.id}>{m.short}</span>
            ))}
            <span className="text-right">Open</span>
          </div>
          {PACKS.map((pk) => (
            <button
              key={pk.id}
              onClick={() => onOpen(pk.id)}
              className="grid w-full grid-cols-1 gap-4 px-5 py-4 text-left transition-colors hover:bg-surface sm:grid-cols-[1.6fr_repeat(3,1fr)_auto] sm:items-center"
            >
              <div>
                <div className="font-medium text-ink">{pk.name}</div>
                <div className="text-xs text-ink-subtle">
                  {pk.builder} · {pk.location} · {pk.types.length} house types
                </div>
              </div>
              {MODELS.map((m) => (
                <div key={m.id} className="min-w-0">
                  <div className="mb-1 text-[11px] text-ink-subtle sm:hidden">{m.short}</div>
                  <AccBar value={packAcc(pk, m.id)} strong={m.id === leader} />
                </div>
              ))}
              <ChevronRight className="hidden h-4 w-4 justify-self-end text-ink-subtle sm:block" strokeWidth={1.75} />
            </button>
          ))}
        </div>
      </Card>

      <Legend />
    </div>
  );
}

// ── View 2: a pack's house types ─────────────────────────────────────────────
function PackView({ pack, onOpen }: { pack: Pack; onOpen: (typeId: string) => void }) {
  const leader = bestModel((m) => packAcc(pack, m));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{pack.name}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {pack.builder} · {pack.location} · {pack.types.length} house types · {FIELDS.length} measurements each
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {MODELS.map((m) => (
          <Card key={m.id} className={cn(m.id === leader && "border-hairline-strong")}>
            <CardBody className="flex items-center justify-between">
              <div>
                <ModelName m={m} />
                <div className="mt-2 text-2xl font-semibold tabular-nums text-ink">{packAcc(pack, m.id)}%</div>
              </div>
              <div className="text-right text-sm">
                <div className="font-medium tabular-nums text-ink">{money(packCost(pack, m.id))}</div>
                <div className="text-[11px] text-ink-subtle">pack cost</div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-ink">House types</h2>
        </CardHeader>
        <div className="divide-y divide-hairline">
          <div className="hidden grid-cols-[1.6fr_0.9fr_repeat(3,1fr)_auto] gap-4 px-5 py-2.5 text-[11px] uppercase tracking-wide text-ink-subtle sm:grid">
            <span>House type</span>
            <span>Config</span>
            {MODELS.map((m) => (
              <span key={m.id}>{m.short}</span>
            ))}
            <span className="text-right">Open</span>
          </div>
          {pack.types.map((t) => (
            <button
              key={t.id}
              onClick={() => onOpen(t.id)}
              className="grid w-full grid-cols-1 gap-4 px-5 py-4 text-left transition-colors hover:bg-surface sm:grid-cols-[1.6fr_0.9fr_repeat(3,1fr)_auto] sm:items-center"
            >
              <div>
                <div className="font-medium text-ink">{t.name}</div>
                <div className="text-xs text-ink-subtle sm:hidden">{t.config} · {t.storeys}-storey</div>
              </div>
              <div className="hidden text-sm text-ink-muted sm:block">{t.config}</div>
              {MODELS.map((m) => (
                <div key={m.id}>
                  <div className="mb-1 text-[11px] text-ink-subtle sm:hidden">{m.short}</div>
                  <AccBar value={scoreFor(t, m.id)} strong={m.id === leader} />
                </div>
              ))}
              <ChevronRight className="hidden h-4 w-4 justify-self-end text-ink-subtle sm:block" strokeWidth={1.75} />
            </button>
          ))}
        </div>
      </Card>

      <Legend />
    </div>
  );
}

// ── View 3: one house type — full comparison ─────────────────────────────────
function TypeView({ pack, type }: { pack: Pack; type: HType }) {
  const rows = rowsFor(type);
  const leader = bestModel((m) => scoreFor(type, m));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">{type.name}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {pack.name} · {pack.builder} · {type.config} · {type.storeys}-storey
            {type.bench.render > 0 ? " · rendered" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-dashed border-hairline-strong px-3 py-2 text-xs text-ink-subtle">
          <FileText className="h-4 w-4" strokeWidth={1.5} /> Drawing preview
        </div>
      </div>

      {/* Per-model summary for this house type */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {MODELS.map((m) => {
          const { hit, total } = fieldsCorrect(type, m.id);
          return (
            <Card key={m.id} className={cn(m.id === leader && "border-hairline-strong")}>
              <CardBody className="space-y-3">
                <div className="flex items-center justify-between">
                  <ModelName m={m} />
                  {m.id === leader && <Badge variant="solid">Best</Badge>}
                </div>
                <div className="text-2xl font-semibold tabular-nums text-ink">{scoreFor(type, m.id)}%</div>
                <AccBar value={scoreFor(type, m.id)} strong={m.id === leader} />
                <div className="flex items-center justify-between border-t border-hairline pt-3 text-sm">
                  <span className="text-ink-muted">
                    <span className="font-medium tabular-nums text-ink">{hit}/{total}</span> fields
                  </span>
                  <span className="text-ink-muted">
                    <span className="font-medium tabular-nums text-ink">{money(costFor(type, m.id))}</span> · {AVG_TIME[m.id]}s
                  </span>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {/* Comparison table */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-ink">Take-off vs Airwright benchmark</h2>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-wide text-ink-subtle">
                <th className="px-5 py-2.5 font-medium">Measurement</th>
                <th className="px-4 py-2.5 font-medium">Benchmark</th>
                {MODELS.map((m) => (
                  <th key={m.id} className="px-4 py-2.5 font-medium">{m.short}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="px-5 py-3 text-ink-muted">{r.label}</td>
                  <td className="px-4 py-3 font-medium tabular-nums text-ink">{r.bench.text}</td>
                  {(["claude", "gemini", "openai"] as const).map((m) => (
                    <td key={m} className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <StatusDot status={r[m].status} />
                        <span
                          className={cn(
                            "tabular-nums",
                            r[m].status === "exact" && "text-ink",
                            r[m].status === "close" && "text-ink-muted",
                            (r[m].status === "off" || r[m].status === "miss") && "font-medium text-ink",
                            r[m].status === "miss" && "italic text-ink-subtle",
                            r[m].status === "na" && "text-ink-subtle",
                          )}
                        >
                          {r[m].text}
                        </span>
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Verdict type={type} />
      <Legend />
    </div>
  );
}

// A one-line plain-English read of where each model stood, generated from the cells.
function Verdict({ type }: { type: HType }) {
  const rows = rowsFor(type);
  const lines = MODELS.map((m) => {
    const bad = rows.filter((r) => r[m.id].status === "off" || r[m.id].status === "miss");
    const { hit, total } = fieldsCorrect(type, m.id);
    if (bad.length === 0) return { m, text: `matched all ${total} fields` };
    const where = bad.map((r) => r.label.replace(" — ", " ").toLowerCase()).join(", ");
    return { m, text: `${hit}/${total} fields — off on ${where}` };
  });
  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-ink">Verdict</h2>
      </CardHeader>
      <CardBody className="space-y-2">
        {lines.map(({ m, text }) => (
          <div key={m.id} className="flex gap-2 text-sm">
            <span className="w-16 shrink-0 font-medium text-ink">{m.short}</span>
            <span className="text-ink-muted">{text}</span>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

function Legend() {
  const items: { status: Status; label: string }[] = [
    { status: "exact", label: "Exact match" },
    { status: "close", label: "Within tolerance" },
    { status: "off", label: "Off / over-read" },
    { status: "miss", label: "Not read" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-ink-subtle">
      {items.map((i) => (
        <span key={i.status} className="inline-flex items-center gap-1.5">
          <StatusDot status={i.status} /> {i.label}
        </span>
      ))}
    </div>
  );
}
