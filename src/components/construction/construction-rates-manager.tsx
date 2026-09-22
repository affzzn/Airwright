"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  createConstructionElement,
  deleteConstructionElement,
  deleteConstructionRate,
  saveConstructionRate,
  updateConstructionElement,
} from "@/server/actions/constructionRates";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Toggle } from "@/components/ui/toggle";
import { Badge } from "@/components/ui/badge";
import {
  BAND_LABEL,
  BRACKET_LABEL,
  UNIT_LABEL,
  type ConstructionUnit,
  type HeightBracket,
  type RateBand,
} from "@/lib/construction/types";

export interface ConstructionRateVM {
  id: string;
  band: string;
  bracket: string;
  rate: number;
}
export interface ConstructionElementVM {
  id: string;
  name: string;
  aliases: string[];
  category: string | null;
  unit: string;
  usesLifts: boolean;
  usesHeightBracket: boolean;
  defaultRuleNote: string | null;
  isActive: boolean;
  rates: ConstructionRateVM[];
}

const UNIT_OPTS = (Object.keys(UNIT_LABEL) as ConstructionUnit[]).map((u) => ({
  value: u,
  label: `${u.replace(/_/g, " ").toLowerCase()} · ${UNIT_LABEL[u]}`,
}));
const BAND_OPTS = (Object.keys(BAND_LABEL) as RateBand[]).map((b) => ({ value: b, label: BAND_LABEL[b] }));
const BRACKET_OPTS = (Object.keys(BRACKET_LABEL) as HeightBracket[]).map((b) => ({
  value: b,
  label: BRACKET_LABEL[b],
}));
const CATEGORY_ORDER = ["Access", "Protection", "Internal", "Extras"];

export function ConstructionRatesManager({ elements }: { elements: ConstructionElementVM[] }) {
  const [newOpen, setNewOpen] = useState(false);

  const grouped = useMemo(() => {
    const by = new Map<string, ConstructionElementVM[]>();
    for (const el of elements) {
      const cat = el.category ?? "Other";
      if (!by.has(cat)) by.set(cat, []);
      by.get(cat)!.push(el);
    }
    return [...by.entries()].sort(
      (a, b) =>
        (CATEGORY_ORDER.indexOf(a[0]) + 1 || 99) - (CATEGORY_ORDER.indexOf(b[0]) + 1 || 99),
    );
  }, [elements]);

  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-4">
        <p className="max-w-2xl text-xs text-ink-subtle">
          The construction picking list. Each element has a rate per band and height bracket.
        </p>
        <Button variant="secondary" onClick={() => setNewOpen(true)} className="shrink-0 gap-2">
          <Plus className="h-4 w-4" strokeWidth={1.75} /> New element
        </Button>
      </div>

      {elements.length === 0 ? (
        <Card>
          <CardBody className="py-12 text-center text-sm text-ink-subtle">
            No elements yet. Add one, or run <code>npm run db:seed</code>.
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-6">
          {grouped.map(([cat, els]) => (
            <div key={cat}>
              <p className="eyebrow mb-2">{cat}</p>
              <div className="space-y-3">
                {els.map((el) => (
                  <ElementBlock key={el.id} element={el} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <NewElementModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

function ElementBlock({ element }: { element: ConstructionElementVM }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editOpen, setEditOpen] = useState(false);

  const toggleActive = () =>
    start(async () => {
      await updateConstructionElement(element.id, { isActive: !element.isActive });
      router.refresh();
    });
  const remove = () =>
    start(async () => {
      await deleteConstructionElement(element.id);
      router.refresh();
    });

  return (
    <Card className={element.isActive ? "" : "opacity-60"}>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">{element.name}</h3>
            <Badge variant="muted">{UNIT_LABEL[element.unit as ConstructionUnit]}</Badge>
            {element.usesLifts && <Badge variant="outline">per lift</Badge>}
            {element.usesHeightBracket && <Badge variant="outline">bracketed</Badge>}
          </div>
          {element.defaultRuleNote && (
            <p className="mt-1 text-xs text-ink-subtle">{element.defaultRuleNote}</p>
          )}
          {element.aliases.length > 0 && (
            <p className="mt-0.5 text-[11px] text-ink-subtle">
              aka {element.aliases.join(", ")}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-ink-muted">
            Active
            <Toggle checked={element.isActive} onChange={toggleActive} disabled={pending} label="Active" />
          </label>
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-surface hover:text-ink"
          >
            Edit
          </button>
          <button
            type="button"
            aria-label="Delete element"
            onClick={remove}
            disabled={pending}
            className="rounded-md p-1.5 text-ink-subtle transition-colors hover:bg-surface hover:text-ink disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </CardHeader>
      <CardBody className="py-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs text-ink-subtle">
              <th className="py-1.5 pr-3 font-medium">Band</th>
              <th className="py-1.5 pr-3 font-medium">Bracket</th>
              <th className="py-1.5 pr-3 text-right font-medium">Rate (£)</th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody>
            {element.rates.length === 0 && (
              <tr>
                <td colSpan={4} className="py-2 text-xs text-ink-subtle">
                  No rate yet.
                </td>
              </tr>
            )}
            {element.rates.map((r) => (
              <RateRow key={r.id} elementId={element.id} rate={r} />
            ))}
          </tbody>
        </table>
        <AddRateRow element={element} />
      </CardBody>
      <EditElementModal element={element} open={editOpen} onClose={() => setEditOpen(false)} />
    </Card>
  );
}

function RateRow({ elementId, rate }: { elementId: string; rate: ConstructionRateVM }) {
  const router = useRouter();
  const [val, setVal] = useState(String(rate.rate));
  const [pending, start] = useTransition();
  useEffect(() => setVal(String(rate.rate)), [rate.rate]);

  const save = () => {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) return setVal(String(rate.rate));
    if (n === rate.rate) return;
    start(async () => {
      await saveConstructionRate({ elementId, band: rate.band, bracket: rate.bracket, rate: n });
      router.refresh();
    });
  };
  const remove = () =>
    start(async () => {
      await deleteConstructionRate(rate.id);
      router.refresh();
    });

  return (
    <tr className="border-b border-hairline last:border-0">
      <td className="py-1.5 pr-3 text-ink-muted">{BAND_LABEL[rate.band as RateBand] ?? rate.band}</td>
      <td className="py-1.5 pr-3 text-ink-muted">{BRACKET_LABEL[rate.bracket as HeightBracket] ?? rate.bracket}</td>
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

function AddRateRow({ element }: { element: ConstructionElementVM }) {
  const router = useRouter();
  const [band, setBand] = useState("COMPETITIVE");
  const [bracket, setBracket] = useState(element.usesHeightBracket ? "UP_TO_6M" : "ANY");
  const [rate, setRate] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const brackets = element.usesHeightBracket
    ? BRACKET_OPTS.filter((b) => b.value !== "ANY")
    : BRACKET_OPTS.filter((b) => b.value === "ANY");

  const add = () => {
    const n = Number(rate);
    if (!Number.isFinite(n) || n < 0) return setErr("Enter a rate.");
    setErr(null);
    start(async () => {
      const res = await saveConstructionRate({ elementId: element.id, band, bracket, rate: n });
      if (res?.ok) {
        setRate("");
        router.refresh();
      } else setErr(res?.error ?? "Couldn’t add.");
    });
  };

  const sel =
    "h-8 rounded-md border border-hairline-strong bg-canvas px-2 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink";

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
      <select className={sel} value={band} onChange={(e) => setBand(e.target.value)}>
        {BAND_OPTS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <select
        className={sel}
        value={bracket}
        disabled={!element.usesHeightBracket}
        onChange={(e) => setBracket(e.target.value)}
      >
        {brackets.map((o) => (
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
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        ) : (
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        )}
        Add rate
      </Button>
      {err && <span className="text-xs text-ink">{err}</span>}
    </div>
  );
}

function ElementFields({
  name, setName, category, setCategory, unit, setUnit,
  usesLifts, setUsesLifts, usesHeightBracket, setUsesHeightBracket,
  aliases, setAliases, ruleNote, setRuleNote,
}: {
  name: string; setName: (v: string) => void;
  category: string; setCategory: (v: string) => void;
  unit: string; setUnit: (v: string) => void;
  usesLifts: boolean; setUsesLifts: (v: boolean) => void;
  usesHeightBracket: boolean; setUsesHeightBracket: (v: boolean) => void;
  aliases: string; setAliases: (v: string) => void;
  ruleNote: string; setRuleNote: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="ce-name">Name</Label>
        <Input id="ce-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Independent Scaffold" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="ce-cat">Category</Label>
          <Select id="ce-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            {["Access", "Protection", "Internal", "Extras", "Other"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ce-unit">Unit</Label>
          <Select id="ce-unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {UNIT_OPTS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap gap-5">
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <Toggle checked={usesLifts} onChange={setUsesLifts} label="Per lift" /> Per lift
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <Toggle checked={usesHeightBracket} onChange={setUsesHeightBracket} label="Bracketed" /> Height-bracketed
        </label>
      </div>
      <div>
        <Label htmlFor="ce-aliases">Aliases (comma-separated)</Label>
        <Input id="ce-aliases" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="working platform, ConInscaff" />
      </div>
      <div>
        <Label htmlFor="ce-note">Default rule note</Label>
        <Input id="ce-note" value={ruleNote} onChange={(e) => setRuleNote(e.target.value)} placeholder="A hint shown in the quote builder" />
      </div>
    </div>
  );
}

function NewElementModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Access");
  const [unit, setUnit] = useState("LM_PER_LIFT");
  const [usesLifts, setUsesLifts] = useState(true);
  const [usesHeightBracket, setUsesHeightBracket] = useState(true);
  const [aliases, setAliases] = useState("");
  const [ruleNote, setRuleNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const create = () => {
    if (!name.trim()) return setErr("Enter a name.");
    setErr(null);
    start(async () => {
      const res = await createConstructionElement({
        name, category, unit, usesLifts, usesHeightBracket,
        aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean),
        defaultRuleNote: ruleNote,
      });
      if (res?.ok) {
        setName(""); setAliases(""); setRuleNote("");
        onClose();
        router.refresh();
      } else setErr(res?.error ?? "Couldn’t create.");
    });
  };

  return (
    <Modal open={open} onClose={onClose} label="New element" className="max-w-md">
      <div className="border-b border-hairline px-5 py-4">
        <h2 className="text-sm font-semibold text-ink">New construction element</h2>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
        <ElementFields
          name={name} setName={setName} category={category} setCategory={setCategory}
          unit={unit} setUnit={setUnit} usesLifts={usesLifts} setUsesLifts={setUsesLifts}
          usesHeightBracket={usesHeightBracket} setUsesHeightBracket={setUsesHeightBracket}
          aliases={aliases} setAliases={setAliases} ruleNote={ruleNote} setRuleNote={setRuleNote}
        />
        {err && <p className="mt-3 text-xs text-ink">{err}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={create} disabled={pending} className="gap-1.5">
            {pending && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />} Create
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function EditElementModal({
  element, open, onClose,
}: {
  element: ConstructionElementVM;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(element.name);
  const [category, setCategory] = useState(element.category ?? "Other");
  const [unit, setUnit] = useState(element.unit);
  const [usesLifts, setUsesLifts] = useState(element.usesLifts);
  const [usesHeightBracket, setUsesHeightBracket] = useState(element.usesHeightBracket);
  const [aliases, setAliases] = useState(element.aliases.join(", "));
  const [ruleNote, setRuleNote] = useState(element.defaultRuleNote ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    setName(element.name);
    setCategory(element.category ?? "Other");
    setUnit(element.unit);
    setUsesLifts(element.usesLifts);
    setUsesHeightBracket(element.usesHeightBracket);
    setAliases(element.aliases.join(", "));
    setRuleNote(element.defaultRuleNote ?? "");
  }, [open, element]);

  const save = () => {
    if (!name.trim()) return setErr("Enter a name.");
    setErr(null);
    start(async () => {
      const res = await updateConstructionElement(element.id, {
        name, category, unit, usesLifts, usesHeightBracket,
        aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean),
        defaultRuleNote: ruleNote,
      });
      if (res?.ok) {
        onClose();
        router.refresh();
      } else setErr(res?.error ?? "Couldn’t save.");
    });
  };

  return (
    <Modal open={open} onClose={onClose} label="Edit element" className="max-w-md">
      <div className="border-b border-hairline px-5 py-4">
        <h2 className="text-sm font-semibold text-ink">Edit element</h2>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
        <ElementFields
          name={name} setName={setName} category={category} setCategory={setCategory}
          unit={unit} setUnit={setUnit} usesLifts={usesLifts} setUsesLifts={setUsesLifts}
          usesHeightBracket={usesHeightBracket} setUsesHeightBracket={setUsesHeightBracket}
          aliases={aliases} setAliases={setAliases} ruleNote={ruleNote} setRuleNote={setRuleNote}
        />
        {err && <p className="mt-3 text-xs text-ink">{err}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={save} disabled={pending} className="gap-1.5">
            {pending && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />} Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
