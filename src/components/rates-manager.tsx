"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  createRateCard,
  deleteRateCard,
  deleteRateItem,
  saveRateItem,
  setRateCardActive,
  setStageSplitPercent,
} from "@/server/actions/rates";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Toggle } from "@/components/ui/toggle";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

// --- View-model types (serialisable) ---
export interface RateItemVM {
  id: string;
  rateCardId: string;
  component: string;
  action: string;
  band: string;
  unit: string;
  rate: number;
  liftLevel: number; // 0 = base rate; 1..8 = a specific lift level
}
export interface StageSplitVM {
  id: string;
  scenario: string;
  name: string;
  percent: number;
}
export interface RateCardVM {
  id: string;
  name: string;
  mode: string;
  effectiveFrom: string;
  isActive: boolean;
  items: RateItemVM[];
  stageSplits: StageSplitVM[];
}

const COMPONENT_OPTS: { value: string; label: string }[] = [
  { value: "LIFT", label: "Lift" },
  { value: "GABLE", label: "Gable / apex" },
  { value: "GABLE_RAILS", label: "Gable rails" },
  { value: "TABLE_LIFT", label: "Table lift" },
  { value: "RENDER_ADAPTION", label: "Render adaption" },
  { value: "TF_EXTERNAL", label: "TF external (timber frame)" },
  { value: "ADAPTION", label: "Adaption (timber frame)" },
  { value: "BIRDCAGE_GF", label: "Birdcage (GF)" },
  { value: "BIRDCAGE_FF", label: "Birdcage (FF)" },
  { value: "BIRDCAGE_SF", label: "Birdcage (SF)" },
  { value: "BIRDCAGE_TF", label: "Birdcage (TF)" },
  { value: "LOADING_BAY", label: "Loading bay" },
  { value: "RUBBISH_CHUTE", label: "Rubbish chute" },
  { value: "HAKI", label: "Haki stair" },
  { value: "LADDER_TOWER", label: "Ladder tower" },
  { value: "JOIST_SUPPORT", label: "Joist support" },
  { value: "FOOT_SCAFFOLD", label: "Foot scaffold" },
  { value: "LOW_LEVEL", label: "Low level" },
  { value: "PARTY_WALL", label: "Party wall" },
  { value: "CONSTRUCTION_LINE", label: "Construction line" },
  { value: "OTHER", label: "Other" },
];
const ACTION_OPTS = [
  { value: "ERECT", label: "Erect" },
  { value: "DISMANTLE", label: "Dismantle" },
];
const BAND_OPTS = [
  { value: "SUPER_COMPETITIVE", label: "Super comp" },
  { value: "COMPETITIVE", label: "Competitive" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "CUSTOM", label: "Custom" },
];
const UNIT_OPTS = [
  { value: "LM", label: "LM" },
  { value: "M2", label: "m²" },
  { value: "EACH", label: "each" },
  { value: "LIFT", label: "lift" },
  { value: "WEEK", label: "week" },
];
const label = (opts: { value: string; label: string }[], v: string) =>
  opts.find((o) => o.value === v)?.label ?? v;
const SCENARIO_LABEL: Record<string, string> = {
  STANDARD: "Standard",
  BUNGALOW: "Bungalow",
  NO_BIRDCAGE: "No birdcage",
  GARAGE: "Garage",
  GARAGE_NO_BCAGE: "Garage (no birdcage)",
  TIMBER_FRAME: "Timber frame",
};
// A lift level 1..8 only means something for per-lift components (LIFT erect,
// and timber-frame ADAPTION); everything else is the base rate (0), shown as "—".
const usesLiftLevel = (component: string) => component === "LIFT" || component === "ADAPTION";
const liftLevelLabel = (component: string, level: number) =>
  usesLiftLevel(component) && level > 0 ? `${level}` : "—";

export function RatesManager({ cards }: { cards: RateCardVM[] }) {
  const [newOpen, setNewOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RateCardVM | null>(null);

  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-1">Admin</p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Rate cards</h1>
        </div>
        <Button variant="secondary" onClick={() => setNewOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" strokeWidth={1.75} /> New rate card
        </Button>
      </div>

      <p className="mb-6 max-w-2xl text-xs text-ink-subtle">
        ⚠ The rates and bands below are placeholders until Laura’s rate sheet arrives.
        Cards are versioned and effective-dated — a historic quote reprices at the rates
        it was made with, and each quote keeps its own frozen snapshot.
      </p>

      {cards.length === 0 ? (
        <Card>
          <CardBody className="py-12 text-center text-sm text-ink-subtle">
            No rate cards yet. Create one to start entering rates.
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-6">
          {cards.map((c) => (
            <RateCardBlock key={c.id} card={c} onDelete={() => setDeleteTarget(c)} />
          ))}
        </div>
      )}

      <NewRateCardModal open={newOpen} onClose={() => setNewOpen(false)} />
      <DeleteCardModal target={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </div>
  );
}

function RateCardBlock({ card, onDelete }: { card: RateCardVM; onDelete: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const toggleActive = () =>
    start(async () => {
      await setRateCardActive(card.id, !card.isActive);
      router.refresh();
    });

  const scenarios = useMemo(() => {
    const by = new Map<string, StageSplitVM[]>();
    for (const s of card.stageSplits) {
      if (!by.has(s.scenario)) by.set(s.scenario, []);
      by.get(s.scenario)!.push(s);
    }
    return [...by.entries()];
  }, [card.stageSplits]);

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-ink">{card.name}</h2>
          <Badge variant="muted">
            {card.mode === "CONSTRUCTION" ? "Construction" : "House build"}
          </Badge>
          <span className="text-xs text-ink-subtle">
            from {formatDate(card.effectiveFrom)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            Active
            <Toggle checked={card.isActive} onChange={toggleActive} disabled={pending} label="Active" />
          </label>
          <button
            type="button"
            aria-label="Delete rate card"
            onClick={onDelete}
            className="rounded-md p-1.5 text-ink-subtle transition-colors hover:bg-surface hover:text-ink"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </CardHeader>
      <CardBody className="space-y-6">
        {/* Rates */}
        <div>
          <p className="eyebrow mb-2">Rates</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs text-ink-subtle">
                  <th className="py-2 pr-3 font-medium">Component</th>
                  <th className="py-2 pr-3 font-medium">Action</th>
                  <th className="py-2 pr-3 font-medium">Band</th>
                  <th className="py-2 pr-3 font-medium">Lift</th>
                  <th className="py-2 pr-3 font-medium">Unit</th>
                  <th className="py-2 pr-3 text-right font-medium">Rate (£)</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {card.items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-sm text-ink-subtle">
                      No rates yet — add one below.
                    </td>
                  </tr>
                )}
                {card.items.map((it) => (
                  <RateRow key={it.id} item={it} />
                ))}
              </tbody>
            </table>
          </div>
          <AddRateRow rateCardId={card.id} />
        </div>

        {/* Stage splits */}
        <div>
          <p className="eyebrow mb-2">Payment stage splits</p>
          <div className="space-y-3">
            {scenarios.map(([scenario, splits]) => {
              const sum = splits.reduce((a, s) => a + s.percent, 0);
              return (
                <div key={scenario} className="rounded-md border border-hairline bg-surface px-3 py-2.5">
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <span className="text-xs font-medium text-ink-muted">
                      {SCENARIO_LABEL[scenario] ?? scenario}
                    </span>
                    <span
                      className={
                        Math.round(sum) === 100
                          ? "text-[11px] text-ink-subtle"
                          : "text-[11px] text-ink"
                      }
                    >
                      {sum}%{Math.round(sum) !== 100 ? " ⚠ should total 100%" : ""}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1.5">
                    {splits.map((s) => (
                      <SplitRow key={s.id} split={s} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function RateRow({ item }: { item: RateItemVM }) {
  const router = useRouter();
  const [val, setVal] = useState(String(item.rate));
  const [pending, start] = useTransition();
  useEffect(() => setVal(String(item.rate)), [item.rate]);

  const save = () => {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) return setVal(String(item.rate));
    if (n === item.rate) return;
    start(async () => {
      await saveRateItem({
        rateCardId: item.rateCardId,
        component: item.component,
        action: item.action,
        band: item.band,
        unit: item.unit,
        rate: n,
        liftLevel: item.liftLevel,
      });
      router.refresh();
    });
  };
  const remove = () =>
    start(async () => {
      await deleteRateItem(item.id);
      router.refresh();
    });

  return (
    <tr className="border-b border-hairline last:border-0">
      <td className="py-1.5 pr-3 text-ink">{label(COMPONENT_OPTS, item.component)}</td>
      <td className="py-1.5 pr-3 text-ink-muted">{label(ACTION_OPTS, item.action)}</td>
      <td className="py-1.5 pr-3 text-ink-muted">{label(BAND_OPTS, item.band)}</td>
      <td className="py-1.5 pr-3 tabular-nums text-ink-muted">
        {liftLevelLabel(item.component, item.liftLevel)}
      </td>
      <td className="py-1.5 pr-3 text-ink-muted">{label(UNIT_OPTS, item.unit)}</td>
      <td className="py-1.5 pr-3 text-right">
        <span className="inline-flex items-center gap-1">
          <span className="text-ink-subtle">£</span>
          <input
            inputMode="decimal"
            value={val}
            disabled={pending}
            onChange={(e) => setVal(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="w-20 rounded-md border border-hairline bg-canvas px-2 py-1 text-right text-sm tabular-nums text-ink focus:border-hairline-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          />
        </span>
      </td>
      <td className="py-1.5 pl-2">
        <button
          type="button"
          aria-label="Remove rate"
          onClick={remove}
          disabled={pending}
          className="rounded-md p-1 text-ink-subtle transition-colors hover:bg-surface hover:text-ink disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </td>
    </tr>
  );
}

function AddRateRow({ rateCardId }: { rateCardId: string }) {
  const router = useRouter();
  const [component, setComponent] = useState("LIFT");
  const [action, setAction] = useState("ERECT");
  const [band, setBand] = useState("MEDIUM");
  const [unit, setUnit] = useState("LM");
  const [liftLevel, setLiftLevel] = useState(0);
  const [rate, setRate] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Lift level only applies to per-lift components; force base (0) otherwise.
  const effectiveLevel = usesLiftLevel(component) ? liftLevel : 0;

  const add = () => {
    const n = Number(rate);
    if (!Number.isFinite(n) || n < 0) return setErr("Enter a rate.");
    setErr(null);
    start(async () => {
      const res = await saveRateItem({
        rateCardId,
        component,
        action,
        band,
        unit,
        rate: n,
        liftLevel: effectiveLevel,
      });
      if (res?.ok) {
        setRate("");
        router.refresh();
      } else {
        setErr(res?.error ?? "Couldn’t add.");
      }
    });
  };

  const sel =
    "h-8 rounded-md border border-hairline-strong bg-canvas px-2 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink";

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
      <select className={sel} value={component} onChange={(e) => setComponent(e.target.value)}>
        {COMPONENT_OPTS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <select className={sel} value={action} onChange={(e) => setAction(e.target.value)}>
        {ACTION_OPTS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <select className={sel} value={band} onChange={(e) => setBand(e.target.value)}>
        {BAND_OPTS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <select
        className={sel}
        value={effectiveLevel}
        disabled={!usesLiftLevel(component)}
        title="Lift level (per-lift components only): base rate, or a specific lift"
        onChange={(e) => setLiftLevel(Number(e.target.value))}
      >
        <option value={0}>Base lift</option>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
          <option key={n} value={n}>{`${n} lift`}</option>
        ))}
      </select>
      <select className={sel} value={unit} onChange={(e) => setUnit(e.target.value)}>
        {UNIT_OPTS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <span className="inline-flex items-center gap-1">
        <span className="text-xs text-ink-subtle">£</span>
        <input
          inputMode="decimal"
          value={rate}
          placeholder="0.00"
          onChange={(e) => setRate(e.target.value)}
          className="h-8 w-20 rounded-md border border-hairline-strong bg-canvas px-2 text-right text-xs tabular-nums text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        />
      </span>
      <Button size="sm" variant="secondary" onClick={add} disabled={pending} className="gap-1.5">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />}
        Add rate
      </Button>
      {err && <span className="text-xs text-ink">{err}</span>}
    </div>
  );
}

function SplitRow({ split }: { split: StageSplitVM }) {
  const router = useRouter();
  const [val, setVal] = useState(String(split.percent));
  const [pending, start] = useTransition();
  useEffect(() => setVal(String(split.percent)), [split.percent]);

  const save = () => {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0 || n > 100) return setVal(String(split.percent));
    if (n === split.percent) return;
    start(async () => {
      await setStageSplitPercent(split.id, n);
      router.refresh();
    });
  };

  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className="text-ink-muted">{split.name}</span>
      <input
        inputMode="decimal"
        value={val}
        disabled={pending}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="w-12 rounded-md border border-hairline bg-canvas px-1.5 py-0.5 text-right text-sm tabular-nums text-ink focus:border-hairline-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
      />
      <span className="text-ink-subtle">%</span>
    </span>
  );
}

function NewRateCardModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [mode, setMode] = useState("HOUSE_BUILD");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const create = () => {
    if (!name.trim()) return setErr("Enter a name.");
    setErr(null);
    start(async () => {
      const res = await createRateCard({ name, mode, effectiveFrom });
      if (res?.ok) {
        setName("");
        setEffectiveFrom("");
        onClose();
        router.refresh();
      } else {
        setErr(res?.error ?? "Couldn’t create.");
      }
    });
  };

  return (
    <Modal open={open} onClose={onClose} label="New rate card" className="max-w-md">
      <div className="border-b border-hairline px-5 py-4">
        <h2 className="text-sm font-semibold text-ink">New rate card</h2>
      </div>
      <div className="space-y-4 px-5 py-4">
        <div>
          <Label htmlFor="rc-name">Name</Label>
          <Input
            id="rc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="2026 Q4"
          />
        </div>
        <div>
          <Label htmlFor="rc-mode">Mode</Label>
          <Select id="rc-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="HOUSE_BUILD">House build</option>
            <option value="CONSTRUCTION">Construction</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="rc-eff">Effective from</Label>
          <Input
            id="rc-eff"
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
        </div>
        {err && <p className="text-xs text-ink">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={create} disabled={pending} className="gap-1.5">
            {pending && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
            Create
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DeleteCardModal({
  target,
  onClose,
}: {
  target: RateCardVM | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const confirm = () => {
    if (!target) return;
    setErr(null);
    start(async () => {
      const res = await deleteRateCard(target.id);
      if (res?.ok) {
        onClose();
        router.refresh();
      } else {
        setErr(res?.error ?? "Couldn’t delete.");
      }
    });
  };

  return (
    <Modal open={target !== null} onClose={() => (pending ? null : onClose())} label="Delete rate card" className="max-w-md">
      <div className="border-b border-hairline px-5 py-4">
        <h2 className="text-sm font-semibold text-ink">Delete rate card</h2>
      </div>
      <div className="px-5 py-4">
        <p className="text-sm text-ink-muted">
          Delete <span className="font-medium text-ink">{target?.name}</span> and its rates
          and stage splits. Existing quotes keep their own frozen figures.
        </p>
        {err && <p className="mt-3 text-xs text-ink">{err}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={pending} onClick={confirm} className="gap-1.5">
            {pending && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
            Delete
          </Button>
        </div>
      </div>
    </Modal>
  );
}
