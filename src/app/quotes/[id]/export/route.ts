import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { buildClientMatrix, buildGarageMatrix, type MatrixBuildType } from "@/lib/pricing/matrix";
import type { PricedPlot, PricedGarage } from "@/lib/pricing/priceProject";
import type { PricedLine, Action } from "@/lib/pricing/engine";

export const dynamic = "force-dynamic";

/**
 * Excel export of a frozen quote in COLIN'S client-matrix format (docs/16):
 * one Matrix sheet per build type present (Traditional / Timber-Frame), each with
 * the real column layout — per-lift / table+rails / render / birdcage erect+strip
 * per floor / dismantle / the payment-stage columns / Erect & Strip total — plus a
 * Line-items sheet (the true-cost audit backing). It renders the IMMUTABLE snapshot
 * (reconstructed from the frozen line items), never a re-price.
 *
 * Every text cell is sanitised so a value read off a drawing can't be treated as a
 * live formula when the file opens.
 */

const CONFIG_LABEL: Record<string, string> = {
  DETACHED: "Detached",
  SEMI_DETACHED: "Semi",
  END_TERRACE: "End terrace",
  MID_TERRACE: "Mid terrace",
};

// Prefix a leading formula/command char so spreadsheets treat it as text.
function safe(v: unknown): string {
  const s = String(v ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
const num = (v: unknown) => Number(v ?? 0);

type QuoteLineItem = {
  stage: string | null;
  component: string | null;
  action: string | null;
  liftLevel: number | null;
  group: string;
  description: string | null;
  quantity: unknown;
  unit: string | null;
  rate: unknown;
  amount: unknown;
  plotId: string | null;
  plot: {
    id: string;
    plotNumber: string;
    configuration: string;
    garageType: string | null;
    houseType: { name: string; code: string | null; buildType: string | null };
  } | null;
};

/**
 * Reconstruct the priced plots from the frozen line items — the detail rows
 * (component, no stage) become the true-cost `PricedLine[]`, the stage rows become
 * the payment split. Grouped so we can build one matrix per build type.
 */
function pricedPlotsByBuildType(lineItems: QuoteLineItem[]): Map<MatrixBuildType, PricedPlot[]> {
  const byPlot = new Map<string, { plot: NonNullable<QuoteLineItem["plot"]>; lines: PricedLine[]; stages: { name: string; percent: number; amount: number }[] }>();
  for (const li of lineItems) {
    if (!li.plot || li.group === "GARAGE") continue; // garages handled separately
    const e =
      byPlot.get(li.plot.id) ??
      byPlot.set(li.plot.id, { plot: li.plot, lines: [], stages: [] }).get(li.plot.id)!;
    if (li.stage) {
      e.stages.push({ name: li.stage, percent: 0, amount: num(li.amount) });
    } else if (li.component) {
      e.lines.push({
        component: li.component,
        action: (li.action as Action) ?? "ERECT",
        liftLevel: li.liftLevel,
        quantity: num(li.quantity),
        unit: li.unit ?? "",
        rate: num(li.rate),
        amount: num(li.amount),
        priced: true,
        note: li.description ?? undefined,
      });
    }
  }

  const out = new Map<MatrixBuildType, PricedPlot[]>();
  for (const { plot, lines, stages } of byPlot.values()) {
    const bt: MatrixBuildType = plot.houseType.buildType === "TIMBER_FRAME" ? "TIMBER_FRAME" : "TRADITIONAL";
    const subtotal = Math.round(lines.reduce((a, l) => a + l.amount * 100, 0)) / 100;
    const priced: PricedPlot = {
      plotId: plot.id,
      plotNumber: plot.plotNumber,
      houseTypeName: plot.houseType.name,
      houseTypeCode: plot.houseType.code,
      configuration: plot.configuration,
      status: "PRICED",
      subtotal,
      stages,
      lines,
      unpricedCount: 0,
      hasGarage: false,
    };
    if (!out.has(bt)) out.set(bt, []);
    out.get(bt)!.push(priced);
  }
  return out;
}

/** Reconstruct the priced garages from the frozen GARAGE line items. */
function pricedGarages(lineItems: QuoteLineItem[]): PricedGarage[] {
  const byPlot = new Map<string, PricedGarage>();
  for (const li of lineItems) {
    if (li.group !== "GARAGE" || !li.plot) continue;
    const g =
      byPlot.get(li.plot.id) ??
      byPlot
        .set(li.plot.id, {
          plotId: li.plot.id,
          plotNumber: li.plot.plotNumber,
          garageType: li.plot.garageType ?? "SINGLE",
          subtotal: 0,
          stages: [],
          lines: [],
          unpricedCount: 0,
        })
        .get(li.plot.id)!;
    if (li.stage) {
      g.stages.push({ name: li.stage, percent: 0, amount: num(li.amount) });
    } else if (li.component) {
      g.lines.push({
        component: li.component,
        action: (li.action as Action) ?? "ERECT",
        liftLevel: li.liftLevel,
        quantity: num(li.quantity),
        unit: li.unit ?? "",
        rate: num(li.rate),
        amount: num(li.amount),
        priced: true,
        note: li.description ?? undefined,
      });
      g.subtotal = Math.round((g.subtotal + num(li.amount)) * 100) / 100;
    }
  }
  return [...byPlot.values()];
}

const BUILD_LABEL: Record<MatrixBuildType, string> = {
  TRADITIONAL: "Traditional",
  TIMBER_FRAME: "Timber Frame",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const quote = await prisma.quote.findUnique({
    where: { id },
    relationLoadStrategy: "join",
    include: {
      project: { include: { client: true } },
      lineItems: {
        include: {
          plot: {
            include: {
              houseType: { select: { name: true, code: true, buildType: true } },
            },
          },
        },
      },
    },
  });
  if (!quote) return new NextResponse("Not found", { status: 404 });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Airwright";

  const plotsByType = pricedPlotsByBuildType(quote.lineItems as unknown as QuoteLineItem[]);
  const garages = pricedGarages(quote.lineItems as unknown as QuoteLineItem[]);

  // ONE stacked sheet, laid out like Colin's template: plot matrix (per build
  // type), then the garages block, then the 3-line grand-total block.
  const sheetName =
    (quote.project.name || "Pricing Matrix").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 28) || "Matrix";
  const ws = wb.addWorksheet(sheetName);

  const title = ws.addRow([`${quote.project.name} — Pricing Matrix (v${quote.version})`]);
  title.font = { bold: true, size: 13 };
  ws.addRow([]);

  /** Append a header + rows + a section-total line, then a spacer. */
  const addBlock = (
    label: string,
    columns: { key: string; header: string }[],
    rows: unknown[][],
    totalKey: string,
    totalLabel: string,
    totalValue: number,
  ) => {
    const lbl = ws.addRow([label]);
    lbl.font = { bold: true };
    ws.addRow(columns.map((c) => c.header)).font = { bold: true };
    for (const r of rows) ws.addRow(r);
    const totalCol = columns.findIndex((c) => c.key === totalKey) + 1;
    const tr = ws.addRow([]);
    tr.getCell(1).value = totalLabel;
    if (totalCol > 0) tr.getCell(totalCol).value = totalValue;
    tr.font = { bold: true };
    ws.addRow([]);
  };

  let grandTotal = 0;
  for (const [buildType, plots] of plotsByType) {
    const matrix = buildClientMatrix(plots, buildType);
    grandTotal += matrix.grandTotal;
    const rows = matrix.rows.map((row) =>
      matrix.columns.map((c) => {
        if (c.key === "plot") return safe(row.plotNumber);
        if (c.key === "code") return safe(row.houseTypeCode ?? row.houseTypeName);
        if (c.key === "config") return safe(CONFIG_LABEL[row.configuration] ?? row.configuration);
        if (c.key === "storey") return "";
        if (c.key === "total") return row.costTotal;
        return row.cells[c.key] ?? 0; // cost + stage columns
      }),
    );
    addBlock(
      `Plots — ${BUILD_LABEL[buildType]}`,
      matrix.columns,
      rows,
      "total",
      "Erect & Dismantle Price",
      matrix.grandTotal,
    );
  }

  // Garages — Colin's garage block (docs/15 §6).
  let garageTotal = 0;
  if (garages.length > 0) {
    const gm = buildGarageMatrix(garages);
    garageTotal = gm.total;
    const rows = gm.rows.map((row) =>
      gm.columns.map((c) => {
        if (c.key === "plot") return safe(row.plotNumber);
        if (c.key === "type") return safe(row.garageType);
        if (c.key === "total") return row.costTotal;
        return row.cells[c.key] ?? 0;
      }),
    );
    addBlock("Garages", gm.columns, rows, "total", "Garages", gm.total);
  }

  // Grand-total block (plots across build types + garages).
  const g1 = ws.addRow([]);
  g1.getCell(1).value = "Erect & Dismantle (plots)";
  g1.getCell(2).value = round2(grandTotal);
  const g2 = ws.addRow([]);
  g2.getCell(1).value = "Garages";
  g2.getCell(2).value = round2(garageTotal);
  const g3 = ws.addRow([]);
  g3.getCell(1).value = "Grand Total";
  g3.getCell(2).value = num(quote.total);
  g3.font = { bold: true };
  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 20;

  // Line items — the true-cost audit backing (unchanged).
  const detailRows = quote.lineItems.filter((li) => li.component && !li.stage);
  const items = wb.addWorksheet("Line items");
  items.addRow(["Plot", "House type", "Group", "Description", "Component", "Action", "Lift", "Qty", "Unit", "Rate", "Amount"]);
  items.getRow(1).font = { bold: true };
  for (const li of detailRows) {
    items.addRow([
      safe(li.plot?.plotNumber),
      safe(li.plot?.houseType.name),
      safe(li.group),
      safe(li.description),
      safe(li.component),
      safe(li.action),
      li.liftLevel ?? "",
      num(li.quantity),
      safe(li.unit),
      num(li.rate),
      num(li.amount),
    ]);
  }
  items.getColumn(4).width = 34;

  const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
  return new NextResponse(bytes, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="quote-v${quote.version}-${quote.project.name.replace(/[^a-z0-9]+/gi, "-")}.xlsx"`,
    },
  });
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
