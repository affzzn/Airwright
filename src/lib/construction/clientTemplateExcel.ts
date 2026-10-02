/**
 * The client's own schedule, filled in (docs/22 §4.10, docs/23 §11.1) — server
 * side (ExcelJS). The scope reader recorded where each line sits (sheet + row) and
 * what each column means; this opens the client's ORIGINAL workbook and writes
 * our figures into their rows, so they get their template back, not ours.
 *
 * What goes where, per row (several lines on one row — e.g. one per building —
 * are summed): l = the run (linear items), h = the scaffold height, Lifts, Hire
 * (weeks), Weekly rate = our extra hire per week beyond the weeks the rates
 * include (⚠ §13 #4 — noted on the header cell), Cost = our price. A cell holding
 * the client's own formula is left alone. Sections confirmed "none required" say
 * so in the comment column. Everything else goes on an "Airwright notes" sheet.
 */

import ExcelJS from "exceljs";
import type { ScopeColumn, ScopeColumnRole } from "./scopeTable";

function safe(v: unknown): string {
  const s = String(v ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export interface TemplateTableRef {
  sheet: string;
  itemCol: number;
  headerRows: number[];
  columns: ScopeColumn[];
  sections: { name: string; row: number; itemCount: number }[];
}

export interface TemplateLine {
  description: string;
  unit: string;
  quantity: number;
  lifts: number | null;
  durationWeeks: number | null;
  rate: number;
  /** The line's price as quoted (with its hire when P18 includes it). */
  cost: number;
  extraHirePerWeek: number;
  heightM: number | null;
  sheet: string | null;
  rowRef: string | null;
}

export interface FillResult {
  bytes: ExcelJS.Buffer;
  filledRows: number;
  /** Lines with no row on the client's schedule (listed on the notes sheet). */
  unplaced: TemplateLine[];
}

const rowOf = (ref: string): number | null => {
  const m = /R(\d+)$/.exec(ref);
  return m ? Number(m[1]) : null;
};

export async function fillClientTemplate(
  original: Buffer,
  tables: TemplateTableRef[],
  lines: TemplateLine[],
  opts: { noneRequired: string[]; notes: string[]; reference: string | null },
): Promise<FillResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(original as unknown as ExcelJS.Buffer);
  // The client's own totals (SUM formulas) recalculate when the file opens.
  wb.calcProperties = { ...(wb.calcProperties ?? {}), fullCalcOnLoad: true };

  const byRow = new Map<string, TemplateLine[]>();
  const unplaced: TemplateLine[] = [];
  for (const l of lines) {
    const t = tables.find((x) => x.sheet === l.sheet);
    const row = l.rowRef ? rowOf(l.rowRef) : null;
    if (!t || row == null) {
      unplaced.push(l);
      continue;
    }
    const k = `${t.sheet}|${row}`;
    byRow.set(k, [...(byRow.get(k) ?? []), l]);
  }

  let filled = 0;
  for (const t of tables) {
    const ws = wb.getWorksheet(t.sheet);
    if (!ws) continue;
    const col = (role: ScopeColumnRole) => t.columns.find((c) => c.role === role)?.col ?? null;
    const put = (row: number, role: ScopeColumnRole, value: number | string | null) => {
      const c = col(role);
      if (c == null || value == null || value === "") return;
      const cell = ws.getCell(row, c);
      const v = cell.value as { formula?: string; sharedFormula?: string } | null;
      if (v && typeof v === "object" && ("formula" in v || "sharedFormula" in v)) return; // the client's own formula
      cell.value = typeof value === "number" ? value : safe(value);
    };
    // Say what the weekly-rate column holds (an open question with Airwright).
    const wr = col("WEEKLY_RATE");
    if (wr != null) {
      const h = ws.getCell(t.headerRows[0], wr);
      h.note = "Airwright: the Cost is the price for the hire period stated on the row. Weekly Rate = extra hire per week beyond the weeks our rates include.";
    }
    for (const [k, all] of byRow) {
      const [sheet, rowS] = k.split("|");
      if (sheet !== t.sheet) continue;
      const row = Number(rowS);
      // A line still to be measured stays BLANK on the client's sheet — never a 0.
      const ls = all.filter((l) => l.quantity > 0);
      if (ls.length === 0) {
        put(row, "COMMENT", "To be measured — see Airwright notes");
        continue;
      }
      const linear = ls.filter((l) => l.unit === "LM" || l.unit === "LM_PER_LIFT");
      if (linear.length) put(row, "L", round3(linear.reduce((a, l) => a + l.quantity, 0)));
      if (!col("L")) put(row, "QTY", round3(ls.reduce((a, l) => a + l.quantity, 0)));
      const heights = ls.map((l) => l.heightM).filter((h): h is number => h != null);
      if (heights.length && ls.some((l) => l.lifts != null)) put(row, "H", round3(Math.max(...heights)));
      const lifts = ls.map((l) => l.lifts).filter((x): x is number => x != null);
      if (lifts.length) put(row, "LIFTS", Math.max(...lifts));
      const weeks = ls.map((l) => l.durationWeeks).filter((x): x is number => x != null);
      if (weeks.length) put(row, "HIRE_WEEKS", Math.max(...weeks));
      if (!col("WEEKLY_RATE") && col("RATE")) put(row, "RATE", ls.length === 1 ? round2(ls[0].rate) : null);
      const weekly = ls.reduce((a, l) => a + l.extraHirePerWeek, 0);
      if (weekly > 0) put(row, "WEEKLY_RATE", round2(weekly));
      const cost = ls.reduce((a, l) => a + l.cost, 0);
      if (cost > 0) put(row, "COST", round2(cost));
      filled++;
    }
    for (const s of t.sections)
      if (s.itemCount === 0 && opts.noneRequired.includes(s.name)) {
        const c = col("COMMENT");
        if (c != null) ws.getCell(s.row, c).value = "None required";
      }
    for (const c of ["WEEKLY_RATE", "COST", "RATE"] as const) {
      const n = col(c);
      if (n != null) ws.getColumn(n).numFmt = "£#,##0.00";
    }
  }

  const notes = wb.addWorksheet("Airwright notes");
  notes.addRow([safe(`Airwright Midland — ${opts.reference ?? "quotation"}`)]).font = { bold: true, size: 13 };
  notes.addRow([]);
  for (const n of opts.notes) notes.addRow([safe(n)]);
  const toMeasure = lines.filter((l) => !(l.quantity > 0));
  if (toMeasure.length) {
    notes.addRow([]);
    notes.addRow(["Still to be measured (left blank on your schedule)"]).font = { bold: true };
    for (const l of toMeasure) notes.addRow([safe(l.description)]);
  }
  if (unplaced.length) {
    notes.addRow([]);
    notes.addRow(["Also quoted (not on your schedule)", "Lifts", "Quantity", "Hire (wks)", "Cost (£)"]).font = { bold: true };
    for (const l of unplaced) notes.addRow([safe(l.description), l.lifts ?? "", round3(l.quantity), l.durationWeeks ?? "", round2(l.cost)]);
  }
  notes.getColumn(1).width = 90;
  return { bytes: await wb.xlsx.writeBuffer(), filledRows: filled, unplaced };
}
