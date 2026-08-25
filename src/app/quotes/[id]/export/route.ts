import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { buildClientMatrix, type MatrixBuildType } from "@/lib/pricing/matrix";
import type { PricedPlot } from "@/lib/pricing/priceProject";
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
    if (!li.plot) continue;
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

  // One matrix sheet per build type present (Colin's real column layout).
  let grandTotal = 0;
  for (const [buildType, plots] of plotsByType) {
    const matrix = buildClientMatrix(plots, buildType);
    grandTotal += matrix.grandTotal;
    const ws = wb.addWorksheet(`Matrix (${BUILD_LABEL[buildType]})`);

    ws.addRow(matrix.columns.map((c) => c.header));
    ws.getRow(1).font = { bold: true };

    for (const row of matrix.rows) {
      const cells = matrix.columns.map((c) => {
        if (c.key === "plot") return safe(row.plotNumber);
        if (c.key === "code") return safe(row.houseTypeCode ?? row.houseTypeName);
        if (c.key === "config") return safe(CONFIG_LABEL[row.configuration] ?? row.configuration);
        if (c.key === "storey") return "";
        if (c.key === "total") return row.costTotal;
        return row.cells[c.key] ?? 0; // cost + stage columns
      });
      ws.addRow(cells);
    }

    // Section total = Σ plot totals (this build type's Erect & Dismantle price).
    const totalColIndex = matrix.columns.findIndex((c) => c.key === "total") + 1;
    ws.addRow([]);
    const totalRow = ws.addRow([]);
    totalRow.getCell(1).value = "Erect & Dismantle Price";
    totalRow.getCell(totalColIndex).value = matrix.grandTotal;
    totalRow.font = { bold: true };

    ws.getColumn(2).width = 22;
  }

  // Grand total (plots across build types). Garages are not priced yet (A6) — noted.
  if (plotsByType.size > 0) {
    const summary = wb.addWorksheet("Summary");
    summary.addRow(["", "Amount (£)"]);
    summary.getRow(1).font = { bold: true };
    summary.addRow(["Erect & Dismantle (plots)", round2(grandTotal)]);
    summary.addRow(["Garages", "not yet priced"]);
    const gt = summary.addRow(["Grand Total", num(quote.total)]);
    gt.font = { bold: true };
    summary.getColumn(1).width = 28;
  }

  // Line items — the true-cost audit backing (unchanged).
  const detailRows = quote.lineItems.filter((li) => li.component && !li.stage);
  const items = wb.addWorksheet("Line items");
  items.addRow(["Plot", "House type", "Description", "Component", "Action", "Lift", "Qty", "Unit", "Rate", "Amount"]);
  items.getRow(1).font = { bold: true };
  for (const li of detailRows) {
    items.addRow([
      safe(li.plot?.plotNumber),
      safe(li.plot?.houseType.name),
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
  items.getColumn(3).width = 34;

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
