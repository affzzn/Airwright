import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Excel export of a frozen quote — a Matrix sheet (per plot, stage split) and a
 * Line items sheet (the true-cost operations). Every text cell is sanitised so a
 * value read off a drawing can't be treated as a live formula when the file opens.
 */

// Prefix a leading formula/command char so spreadsheets treat it as text.
function safe(v: unknown): string {
  const s = String(v ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
const num = (v: unknown) => Number(v ?? 0);

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
          plot: { include: { houseType: { select: { name: true, code: true } } } },
        },
      },
    },
  });
  if (!quote) return new NextResponse("Not found", { status: 404 });

  const stageRows = quote.lineItems.filter((li) => li.stage);
  const detailRows = quote.lineItems.filter((li) => li.component && !li.stage);

  // Per-plot stage matrix.
  const stageNames: string[] = [];
  const byPlot = new Map<
    string,
    { plotNumber: string; house: string; config: string; stages: Map<string, number> }
  >();
  for (const li of stageRows) {
    if (!li.plot || !li.stage) continue;
    if (!stageNames.includes(li.stage)) stageNames.push(li.stage);
    const k = li.plot.id;
    if (!byPlot.has(k))
      byPlot.set(k, {
        plotNumber: li.plot.plotNumber,
        house: li.plot.houseType.name,
        config: li.plot.configuration,
        stages: new Map(),
      });
    byPlot.get(k)!.stages.set(li.stage, num(li.amount));
  }
  const plots = [...byPlot.values()].sort((a, b) => {
    const na = parseInt(a.plotNumber, 10);
    const nb = parseInt(b.plotNumber, 10);
    if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
    return a.plotNumber.localeCompare(b.plotNumber);
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Airwright";

  const matrix = wb.addWorksheet("Matrix");
  matrix.addRow(["Plot", "House type", "Config", ...stageNames, "Total"]);
  matrix.getRow(1).font = { bold: true };
  for (const p of plots) {
    const total = [...p.stages.values()].reduce((a, v) => a + v, 0);
    matrix.addRow([
      safe(p.plotNumber),
      safe(p.house),
      safe(p.config),
      ...stageNames.map((n) => p.stages.get(n) ?? 0),
      total,
    ]);
  }
  matrix.addRow([]);
  matrix.addRow(["", "", "", ...stageNames.map(() => ""), num(quote.total)]);
  matrix.lastRow!.getCell(3 + stageNames.length + 1).font = { bold: true };
  matrix.getColumn(2).width = 26;

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
