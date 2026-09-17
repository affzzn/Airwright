/**
 * Build the Excel workbook for a construction quote in Airwright's own
 * scaffolding-schedule layout (docs/19 §2 / §10 — the `Wren - Scaffolding
 * Schedule.xlsx` shape): Item · Nr of Lifts · Unit · Quantity · Rate · Total ·
 * Notes, with a header block + a total + the hire / extra-hire terms.
 *
 * Every text cell is sanitised so a value can't be treated as a live formula when
 * the file opens (formula-injection guard, same as the house-build export).
 */

import ExcelJS from "exceljs";
import { BAND_LABEL, UNIT_LABEL, type ConstructionUnit, type RateBand } from "./types";

function safe(v: unknown): string {
  const s = String(v ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface ConstructionLineForExcel {
  description: string;
  lifts: number | null;
  unit: string;
  quantity: number;
  rate: number;
  amount: number;
  note: string | null;
}
export interface ConstructionQuoteForExcel {
  reference: string | null;
  customerName: string | null;
  siteAddress: string | null;
  band: string;
  durationWeeks: number | null;
  extraHirePctPerWeek: number | null;
  lines: ConstructionLineForExcel[];
  total: number;
  extraHirePerWeek: number | null;
  assumptions: string[] | null;
}

export async function buildConstructionWorkbook(
  q: ConstructionQuoteForExcel,
): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Airwright";
  const ws = wb.addWorksheet("Scaffolding Schedule");

  const bold = { bold: true } as const;
  const title = (t: string) => {
    const r = ws.addRow([safe(t)]);
    r.font = { bold: true, size: 13 };
  };
  const meta = (label: string, value: string) => {
    const r = ws.addRow([safe(label), safe(value)]);
    r.getCell(1).font = { color: { argb: "FF666666" } };
  };

  title("Scaffolding Schedule");
  if (q.reference) meta("Project", q.reference);
  if (q.customerName) meta("Customer", q.customerName);
  if (q.siteAddress) meta("Site", q.siteAddress);
  meta("Rate band", BAND_LABEL[q.band as RateBand] ?? q.band);
  if (q.durationWeeks != null) meta("Hire duration", `${q.durationWeeks} weeks (inclusive)`);
  ws.addRow([]);

  // Column headers (Airwright's schedule).
  const header = ws.addRow(["Item", "Nr of Lifts", "Unit", "Quantity", "Rate (£)", "Total (£)", "Notes"]);
  header.font = bold;
  header.eachCell((c) => {
    c.border = { bottom: { style: "thin", color: { argb: "FFCCCCCC" } } };
  });

  for (const l of q.lines) {
    ws.addRow([
      safe(l.description),
      l.lifts ?? "",
      UNIT_LABEL[l.unit as ConstructionUnit] ?? l.unit,
      round2(l.quantity),
      round2(l.rate),
      round2(l.amount),
      safe(l.note ?? ""),
    ]);
  }

  ws.addRow([]);
  const totalRow = ws.addRow(["", "", "", "", "Total", round2(q.total), ""]);
  totalRow.getCell(5).font = bold;
  totalRow.getCell(6).font = bold;

  if (q.extraHirePerWeek != null) {
    ws.addRow([
      "",
      "",
      "",
      "",
      "Extra hire / week",
      round2(q.extraHirePerWeek),
      safe(`${q.extraHirePctPerWeek ?? 0}% of job cost per week beyond the ${q.durationWeeks ?? "?"}-week inclusive period`),
    ]);
  }

  // Money formatting on the rate / total columns.
  ["E", "F"].forEach((col) => {
    ws.getColumn(col).numFmt = "£#,##0.00";
  });
  ws.columns.forEach((c, i) => {
    c.width = i === 0 ? 40 : i === 6 ? 40 : 14;
  });

  if (q.assumptions && q.assumptions.length > 0) {
    ws.addRow([]);
    const a = ws.addRow(["Assumptions & exclusions"]);
    a.font = bold;
    for (const line of q.assumptions) ws.addRow([safe(line)]);
  }

  return wb.xlsx.writeBuffer();
}
